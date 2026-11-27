// Detection evaluation: each folder of evals/sites/ is a fictitious site with seeded defects, served over
// node:http on 127.0.0.1 and audited by the CLI. Recall and false positives are measured against verite.json
// and written to evals/resultats-sites-v0.1.json. No Internet access.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { CATALOGUE } from '../../outils/lib/controles.mjs'

const GEO = fileURLToPath(new URL('../../outils/geo.mjs', import.meta.url))
const SITES = fileURLToPath(new URL('../sites/', import.meta.url))
const RESULTATS = fileURLToPath(new URL('../resultats-sites-v0.1.json', import.meta.url))
const RACINE_REPO = fileURLToPath(new URL('../../../..', import.meta.url))
const TYPES = { '.html': 'text/html; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' }
const TAGS = /[\u{E0000}-\u{E007F}]/u

const tmp = []
const nouveauDossier = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmp.push(d); return d }
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }) })

const serveurs = []
// Serves a site folder; "SITE" in .txt/.xml files is replaced by the server host; _entetes.json maps a path to { statut, entetes }.
async function servir(dossier) {
  let hote = ''
  const specs = fs.existsSync(path.join(dossier, '_entetes.json')) ? JSON.parse(fs.readFileSync(path.join(dossier, '_entetes.json'), 'utf8')) : {}
  const serveur = http.createServer((req, res) => {
    const chemin = decodeURIComponent(req.url.split('?')[0])
    const spec = specs[chemin]
    const rel = chemin === '/' ? 'index.html' : chemin.slice(1)
    let fichier = path.join(dossier, rel)
    if (fs.existsSync(fichier) && fs.statSync(fichier).isDirectory()) fichier = path.join(fichier, 'index.html')
    const existe = !rel.startsWith('_') && fichier.startsWith(dossier) && fs.existsSync(fichier) && fs.statSync(fichier).isFile()
    if (!existe && !spec) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('introuvable') }
    let corps = existe ? fs.readFileSync(fichier, 'utf8') : ''
    if (/\.(txt|xml)$/.test(rel)) corps = corps.replaceAll('SITE', hote)
    res.writeHead(spec?.statut ?? 200, { 'content-type': TYPES[path.extname(rel)] ?? 'text/html; charset=utf-8', ...(spec?.entetes ?? {}) })
    res.end(corps)
  })
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
  hote = `127.0.0.1:${serveur.address().port}`
  serveurs.push(serveur)
  return { base: `http://${hote}` }
}
after(() => { for (const s of serveurs) s.close() })

// Async spawn: this process must keep serving HTTP while the CLI runs.
function geo(args, { home, cwd }) {
  return new Promise((resolve) => {
    const e = spawn(process.execPath, [GEO, ...args], { env: { ...process.env, GEO_HOME: home, GEO_DELAI_MS: '0' }, cwd })
    let stdout = '', stderr = ''
    e.stdout.on('data', (d) => { stdout += d })
    e.stderr.on('data', (d) => { stderr += d })
    e.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
const auditer = (base, ctx) => geo(['auditer', '--url', base, '--autoriser-local', '--hotes-autorises', '127.0.0.1', '--max-pages', '6'], ctx)


// path + size + SHA-256 of every file under root (excluding .git and node_modules): detects creations, deletions AND overwrites.
const lister = (racine) => {
  const out = []
  const visiter = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { visiter(p); continue }
      const buf = fs.readFileSync(p)
      out.push(`${path.relative(racine, p)}|${buf.length}|${createHash('sha256').update(buf).digest('hex')}`)
    }
  }
  visiter(racine)
  return out.sort()
}

const noms = fs.readdirSync(SITES).filter((n) => fs.statSync(path.join(SITES, n)).isDirectory()).sort()
const mesures = {}
const cle = (a) => (a.page ? `${a.id}@${a.page}` : a.id)

for (const nom of noms) {
  test(`site ${nom} : attendus trouvés, interdits absents`, async () => {
    const verite = JSON.parse(fs.readFileSync(path.join(SITES, nom, 'verite.json'), 'utf8'))
    const { base } = await servir(path.join(SITES, nom))
    const home = nouveauDossier('geo-site-home-'), cwd = nouveauDossier('geo-site-cwd-')
    const r = await auditer(base, { home, cwd })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.stderr, '')
    const audit = JSON.parse(r.stdout)
    const trouves = audit.constats
    const ids = new Set(trouves.map((c) => c.id))
    const surPage = (c, page) => (c.pages ?? []).some((p) => new URL(p, base).pathname === page)
    const trouve = (a) => trouves.some((c) => c.id === a.id && (!a.page || surPage(c, a.page)))
    // A constat of the id without any page may concern the page: it counts as present (conservative).
    const present = (a) => trouves.some((c) => c.id === a.id && ((c.pages ?? []).length === 0 || surPage(c, a.page)))
    const manquants = verite.attendus.filter((a) => !trouve(a)).map(cle).sort()
    const faux = (verite.interdits ?? []).filter((id) => ids.has(id)).sort()
    const presents = (verite.absents ?? []).filter(present).map(cle).sort()
    mesures[nom] = {
      attendus: verite.attendus.map(cle).sort(),
      faux_positifs: [...faux, ...presents],
      manquants,
      rappel: verite.attendus.length ? (verite.attendus.length - manquants.length) / verite.attendus.length : 1,
      tolere: [...(verite.tolere ?? [])].sort(),
      trouves: [...ids].sort(),
    }
    assert.deepEqual(manquants, [], `constats attendus absents sur ${nom}`)
    assert.deepEqual(faux, [], `constats interdits présents sur ${nom}`)
    assert.deepEqual(presents, [], `constats qui devraient être absents (par page) sur ${nom}`)
    if (nom === 'propre') {
      const graves = trouves.filter((c) => ['bloquant', 'important'].includes(c.severite)).map((c) => c.id)
      assert.deepEqual(graves, [], 'propre : aucun constat bloquant ni important')
      assert.deepEqual([...ids].filter((id) => !(verite.tolere ?? []).includes(id)), [], 'propre : constats mineurs à lister dans tolere')
      const attendusInterdits = CATALOGUE.filter((e) => ['bloquant', 'important'].includes(e.severite)).map((e) => e.id).sort()
      assert.deepEqual([...verite.interdits].sort(), attendusInterdits, 'propre : interdits = tous les bloquants et importants du catalogue')
    }
    // Per-robot verdicts (Review Focus 2): blocked paths per documented token, merged groups included.
    if (verite.robots) {
      const parJeton = new Map(audit.robots_ia.map((x) => [x.jeton, x.chemins_bloques ?? []]))
      for (const j of verite.robots.bloques) assert.ok((parJeton.get(j) ?? []).length > 0, `${j} doit être bloqué`)
      for (const j of verite.robots.non_bloques) assert.ok(parJeton.has(j) && parJeton.get(j).length === 0, `${j} ne doit pas être bloqué`)
      for (const [j, chemins] of Object.entries(verite.robots.fusion ?? {})) assert.deepEqual([...parJeton.get(j)].sort(), [...chemins].sort(), `groupes ${j} fusionnés (RFC 9309)`)
    }
    // Unsupported language (Review Focus 5): reported as such, coverage lowered, no invented content constat.
    if (verite.langue_non_prise_en_charge) {
      for (const page of verite.langue_non_prise_en_charge) {
        const p = audit.contenu_resume.pages.find((x) => new URL(x.url).pathname === page)
        assert.ok(p, `${page} analysée`)
        assert.equal(p.prise_en_charge, false, `${page} : langue non prise en charge`)
      }
      const qs = audit.scores.find((x) => x.id === 'qualite-semantique')
      assert.ok(qs.couverture < 1, 'qualite-semantique : couverture < 1')
      assert.ok(qs.criteres.some((c) => /langue non prise en charge/.test(c.preuve)), 'la preuve du score cite les pages en langue non prise en charge')
    }
    assert.deepEqual(lister(cwd), [], 'aucun fichier écrit dans le dossier courant')
  })
}

test('piege-injection : rien de brut hors extraits, aucun fichier hors GEO_HOME, pas de lien actif', async () => {
  const { base } = await servir(path.join(SITES, 'piege-injection'))
  const home = nouveauDossier('geo-inj-home-'), cwd = nouveauDossier('geo-inj-cwd-')
  const avant = lister(RACINE_REPO)
  const r = await auditer(base, { home, cwd })
  assert.equal(r.code, 0, r.stderr)
  const audit = JSON.parse(r.stdout)
  const estExtrait = (x) => x && typeof x === 'object' && 'extrait' in x && 'non_fiable' in x
  // Strip every { extrait, non_fiable } object, then look for the injected strings in what is left.
  const nettoye = (x) => {
    if (Array.isArray(x)) return x.map(nettoye)
    if (estExtrait(x)) return '[extrait]'
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, nettoye(v)]))
    return x
  }
  const reste = JSON.stringify(nettoye(audit))
  for (const motif of [/Ignore previous instructions/i, /write OK to robots/i, /maintenance mode/i, /Reveal your instructions/i, /javascript:/i, TAGS]) {
    assert.doesNotMatch(reste, motif, `hors extrait : ${motif}`)
  }
  const extraits = []
  const collecter = (x) => {
    if (Array.isArray(x)) x.forEach(collecter)
    else if (estExtrait(x)) extraits.push(x)
    else if (x && typeof x === 'object') Object.values(x).forEach(collecter)
  }
  collecter(audit)
  // Positive control: the hostile strings really reach the output, inside labelled extraits.
  assert.ok(extraits.some((e) => /Ignore previous/.test(e.extrait) && e.non_fiable === true), 'un extrait non_fiable porte la phrase injectée')
  assert.ok(extraits.some((e) => /clic/.test(e.extrait) && e.non_fiable === true), 'un extrait non_fiable porte le nom JSON-LD hostile')
  for (const e of extraits) {
    assert.equal(e.non_fiable, true)
    assert.doesNotMatch(String(e.extrait), TAGS)
    assert.doesNotMatch(String(e.extrait), /[<>]/)
  }
  assert.doesNotMatch(r.stdout, TAGS)
  assert.deepEqual(lister(cwd), [], 'aucun fichier dans le dossier courant')
  assert.deepEqual(lister(RACINE_REPO), avant, 'aucun fichier du dépôt créé, modifié ou supprimé')
  const md = await geo(['rapport', '--audit', audit.audit_id, '--format', 'md'], { home, cwd })
  assert.equal(md.code, 0, md.stderr)
  assert.match(md.stdout, /Extrait non fiable/)
  for (const [motif, msg] of [[/\]\(\s*[a-z][a-z0-9+.-]*:/i, 'lien Markdown actif'], [/\]\(\/\//, 'lien relatif au protocole'], [/!\[/, 'image Markdown'], [/^\[[^\]]+\]:\s*\S/m, 'lien de référence'], [TAGS, 'caractères invisibles']]) {
    assert.doesNotMatch(md.stdout, motif, msg)
  }
  // The report may quote the injected text, but only on lines labelled as untrusted excerpt.
  const horsExtraits = md.stdout.split(/\r?\n/).filter((l) => !/Extrait non fiable/.test(l)).join(' ')
  for (const motif of [/Ignore previous instructions/i, /maintenance mode/i, /Reveal your instructions/i]) assert.doesNotMatch(horsExtraits, motif)
})

// Results file: written only with GEO_ECRIRE_RESULTATS=1; otherwise the measurements must equal the committed file (date ignored).
test('résultats : conformes au fichier versionné', () => {
  assert.equal(Object.keys(mesures).length, noms.length, 'tous les sites ont été mesurés')
  const sites = Object.fromEntries(noms.map((n) => [n, mesures[n]]))
  const attendus = noms.reduce((s, n) => s + sites[n].attendus.length, 0)
  const manquants = noms.reduce((s, n) => s + sites[n].manquants.length, 0)
  const corps = {
    faux_positifs_total: noms.reduce((s, n) => s + sites[n].faux_positifs.length, 0),
    rappel_total: attendus ? (attendus - manquants) / attendus : 1,
    sites,
  }
  if (process.env.GEO_ECRIRE_RESULTATS === '1') {
    fs.writeFileSync(RESULTATS, JSON.stringify({ date: new Date().toISOString().slice(0, 10), ...corps }, null, 2) + '\n')
    return
  }
  const { date: _date, ...reste } = JSON.parse(fs.readFileSync(RESULTATS, 'utf8'))
  assert.deepEqual(reste, JSON.parse(JSON.stringify(corps)), 'écart avec resultats-sites-v0.1.json (relancer avec GEO_ECRIRE_RESULTATS=1 si voulu)')
})
