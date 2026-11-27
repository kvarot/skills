// CLI tests: node geo.mjs as a subprocess, GEO_HOME in a temp dir, node:http server on 127.0.0.1. No Internet.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { rapportMarkdown, rapportJson, SECTIONS, PLATEFORMES, PHRASE_LIMITE, passagesComplets } from '../../outils/lib/rapports.mjs'

const GEO = fileURLToPath(new URL('../../outils/geo.mjs', import.meta.url))
const RACINE_GEO = fileURLToPath(new URL('../..', import.meta.url))

const PARAGRAPHES = [
  'Lumivia est un logiciel de planification pour les entreprises du bâtiment. Il permet de planifier les interventions et de suivre les chantiers chaque jour.',
  'Selon https://exemple.example/etude, les équipes qui planifient leurs tournées gagnent du temps. Nous publions des guides pratiques pour les artisans.',
]
const pageBonne = (titre = 'Lumivia, planification de chantier') => `<!doctype html><html lang="fr"><head><title>${titre}</title>
<meta name="description" content="Planification de chantier"><meta name="viewport" content="width=device-width"><meta name="author" content="Équipe Lumivia">
<link rel="canonical" href="/"></head><body><h1>${titre}</h1>
<h2>Qu'est-ce que Lumivia ?</h2><p>${PARAGRAPHES[0]}</p>
<h2>Pourquoi planifier ?</h2><p>${PARAGRAPHES[1]}</p></body></html>`
const pageVide = '<!doctype html><html lang="fr"><head><title>App</title></head><body><div id="app"></div></body></html>'

let serveur, base
const sites = { '/': pageBonne(), '/robots.txt': 'User-agent: GPTBot\nDisallow: /\n' }
before(async () => {
  serveur = http.createServer((req, res) => {
    const corps = sites[req.url.split('?')[0]]
    if (corps === undefined) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('non') }
    res.writeHead(200, { 'content-type': req.url.endsWith('robots.txt') ? 'text/plain' : 'text/html; charset=utf-8' })
    res.end(corps)
  })
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${serveur.address().port}`
})
after(() => serveur.close())

const dossiers = []
const nouveauHome = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-cli-')); dossiers.push(d); return d }
after(() => { for (const d of dossiers) fs.rmSync(d, { recursive: true, force: true }) })

// Async spawn: the test process must keep serving HTTP while the CLI runs.
function geo(args, home, { env = {} } = {}) {
  return new Promise((resolve) => {
    const enfant = spawn(process.execPath, [GEO, ...args], { env: { ...process.env, GEO_HOME: home, GEO_DELAI_MS: '0', ...env }, cwd: home })
    let stdout = '', stderr = ''
    enfant.stdout.on('data', (d) => { stdout += d })
    enfant.stderr.on('data', (d) => { stderr += d })
    enfant.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
const json = (r) => JSON.parse(r.stdout)

async function homeAutorise() {
  const home = nouveauHome()
  assert.equal((await geo(['init'], home)).code, 0)
  assert.equal((await geo(['autoriser', '127.0.0.1'], home)).code, 0)
  return home
}

test('auditer sur un hôte non autorisé : code 3, stdout vide', async () => {
  const home = nouveauHome()
  await geo(['init'], home)
  const r = await geo(['auditer', '--url', base, '--autoriser-local'], home)
  assert.equal(r.code, 3)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /127\.0\.0\.1/)
  assert.doesNotMatch(r.stderr, /\n\s+at /)
})

test('init crée session.json vide et la base ; autoriser ajoute sans doublon', async () => {
  const home = nouveauHome()
  assert.equal((await geo(['init'], home)).code, 0)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8')), { hotes_autorises: [] })
  assert.ok(fs.existsSync(path.join(home, 'geo.sqlite')))
  await geo(['autoriser', 'B.example,a.example'], home)
  const r = await geo(['autoriser', 'a.example'], home)
  assert.deepEqual(json(r).hotes_autorises, ['a.example', 'b.example'])
  assert.equal((await geo(['autoriser'], home)).code, 1)
})

test('auditer après autoriser : code 0, JSON valide, clés attendues dans l’ordre', async () => {
  const home = await homeAutorise()
  const r = await geo(['auditer', '--url', base, '--autoriser-local'], home)
  assert.equal(r.code, 0, r.stderr)
  const s = json(r)
  assert.equal(r.stderr, '')
  assert.deepEqual(Object.keys(s), ['audit_id', 'origine', 'constats', 'scores', 'robots_ia', 'contenu_resume', 'entite', 'erreurs', 'exploration'])
  assert.equal(s.origine, base)
  assert.ok(Number.isInteger(s.audit_id))
  assert.ok(s.scores.length >= 4)
  assert.ok(s.exploration.pages >= 1)
  const gptbot = s.robots_ia.find((x) => x.jeton === 'GPTBot')
  assert.ok(gptbot.chemins_bloques.length > 0)
  // no raw page text anywhere on stdout
  assert.ok(!r.stdout.includes(PARAGRAPHES[0]))
})

test('auditer --echec-si bloquant : code 2 sur GEO-HTML-VIDE, stdout reste du JSON', async () => {
  const home = await homeAutorise()
  sites['/vide/'] = pageVide
  try {
    const r = await geo(['auditer', '--url', base + '/vide/', '--autoriser-local', '--echec-si', 'bloquant'], home)
    assert.equal(r.code, 2)
    assert.ok(json(r).constats.some((c) => c.id === 'GEO-HTML-VIDE'))
    const ok = await geo(['auditer', '--url', base + '/vide/', '--autoriser-local'], home)
    assert.equal(ok.code, 0)
  } finally { delete sites['/vide/'] }
})

test('auditer --echec-si important : seuil plus bas que bloquant ; valeur inconnue : code 1', async () => {
  const home = await homeAutorise()
  const mauvais = await geo(['auditer', '--url', base, '--autoriser-local', '--echec-si', 'mineur'], home)
  assert.equal(mauvais.code, 1)
  assert.equal(mauvais.stdout, '')
  const r = await geo(['auditer', '--url', base, '--autoriser-local', '--echec-si', 'important'], home)
  const s = json(r)
  const attendu = s.constats.some((c) => c.severite === 'bloquant' || c.severite === 'important') ? 2 : 0
  assert.equal(r.code, attendu)
})

test('option inconnue : code 1, usage sur stderr, stdout vide', async () => {
  const home = nouveauHome()
  for (const args of [['auditer', '--url', base, '--nimporte'], ['scores', '--foo'], ['init', '--x'], ['inconnue']]) {
    const r = await geo(args, home)
    assert.equal(r.code, 1, args.join(' '))
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /Usage/)
  }
})

test('auditer sans --url ni --dossier, ou avec les deux : code 1', async () => {
  const home = await homeAutorise()
  assert.equal((await geo(['auditer'], home)).code, 1)
  assert.equal((await geo(['auditer', '--url', base, '--dossier', home], home)).code, 1)
})

test('auditer --dossier : collecte locale sans réseau', async () => {
  const home = nouveauHome()
  const site = path.join(home, 'site')
  fs.mkdirSync(site)
  fs.writeFileSync(path.join(site, 'index.html'), pageBonne())
  const r = await geo(['auditer', '--dossier', site], home)
  assert.equal(r.code, 0, r.stderr)
  const s = json(r)
  assert.equal(s.origine, 'dossier:site')
  assert.equal(s.exploration.pages, 1)
})

test('rapport --format md : les neuf titres dans l’ordre ; json valide ; --sortie confinée', async () => {
  const home = await homeAutorise()
  const id = json(await geo(['auditer', '--url', base, '--autoriser-local'], home)).audit_id
  const md = await geo(['rapport', '--audit', String(id), '--format', 'md'], home)
  assert.equal(md.code, 0, md.stderr)
  let pos = -1
  for (const t of SECTIONS) {
    const i = md.stdout.indexOf(`\n## ${t}\n`)
    assert.ok(i > pos, `section « ${t} » absente ou hors ordre`)
    pos = i
  }
  assert.match(md.stdout, /un score de potentiel élevé ne garantit aucune citation/i)
  assert.ok(!md.stdout.includes(PARAGRAPHES[0]))
  const js = await geo(['rapport', '--audit', String(id), '--format', 'json'], home)
  assert.equal(json(js).audit_id, id)
  // deterministic output
  assert.equal((await geo(['rapport', '--audit', String(id), '--format', 'json'], home)).stdout, js.stdout)

  const sortie = await geo(['rapport', '--audit', String(id), '--format', 'md', '--sortie', 'rapports/r.md'], home)
  assert.equal(sortie.code, 0)
  assert.ok(fs.existsSync(path.join(home, 'rapports', 'r.md')))
  const dehors = await geo(['rapport', '--audit', String(id), '--format', 'md', '--sortie', path.join(os.tmpdir(), 'geo-dehors.md')], home)
  assert.equal(dehors.code, 1)
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'geo-dehors.md')))
  const traverse = await geo(['rapport', '--audit', String(id), '--format', 'md', '--sortie', '../x.md'], home)
  assert.equal(traverse.code, 1)
})

test('scores et rapport sur un audit inconnu : code 1', async () => {
  const home = await homeAutorise()
  assert.equal((await geo(['scores', '--audit', '99'], home)).code, 1)
  assert.equal((await geo(['rapport', '--audit', '99', '--format', 'md'], home)).code, 1)
  assert.equal((await geo(['rapport', '--audit', '1', '--format', 'pdf'], home)).code, 1)
})

test('scores --audit restitue les scores enregistrés', async () => {
  const home = await homeAutorise()
  const a = json(await geo(['auditer', '--url', base, '--autoriser-local'], home))
  const s = json(await geo(['scores', '--audit', String(a.audit_id)], home))
  assert.deepEqual(s.scores, a.scores)
})

test('robots --url : un verdict par robot du registre', async () => {
  const home = await homeAutorise()
  const r = await geo(['robots', '--url', base, '--autoriser-local'], home)
  assert.equal(r.code, 0, r.stderr)
  const s = json(r)
  const reg = JSON.parse(fs.readFileSync(path.join(RACINE_GEO, 'donnees/robots.json'), 'utf8')).robots
  assert.equal(s.robots.length, reg.length)
  assert.equal(s.robots.find((x) => x.jeton === 'GPTBot').politique, 'bloqué')
  assert.equal(s.robots.find((x) => x.jeton === 'OAI-SearchBot').politique, 'autorisé')
  assert.equal((await geo(['robots', '--url', base], nouveauHome())).code, 3)
})

const profil = {
  categorie: ['logiciel de planification', 'application de suivi de chantier', 'outil de devis'],
  besoins: ['planifier les interventions', 'suivre les chantiers', 'envoyer des devis', 'gérer les plannings'],
  zones: ['Lyon', 'Nantes', 'Lille'], concurrents: ['Planorama', 'Chantiflow'], contraintes: ['conformité RGPD'],
  marque: { nom: 'Lumivia', alias: [] }, langue: 'fr',
}

test('scenarios generer : même graine, stdout identique ; graine ou niveau invalide : code 1', async () => {
  const home = nouveauHome()
  const f = path.join(home, 'profil.json')
  fs.writeFileSync(f, JSON.stringify(profil))
  const a = await geo(['scenarios', 'generer', '--profil', f, '--niveau', 'rapide', '--graine', '7'], home)
  const b = await geo(['scenarios', 'generer', '--profil', f, '--niveau', 'rapide', '--graine', '7'], home)
  assert.equal(a.code, 0, a.stderr)
  assert.equal(a.stdout, b.stdout)
  assert.ok(json(a).scenarios.length > 0)
  const c = await geo(['scenarios', 'generer', '--profil', f, '--niveau', 'rapide', '--graine', '8'], home)
  assert.notEqual(c.stdout, a.stdout)
  assert.equal((await geo(['scenarios', 'generer', '--profil', f, '--niveau', 'xx', '--graine', '7'], home)).code, 1)
  assert.equal((await geo(['scenarios', 'generer', '--profil', f, '--niveau', 'rapide', '--graine', 'abc'], home)).code, 1)
  assert.equal((await geo(['scenarios', 'generer', '--niveau', 'rapide', '--graine', '1'], home)).code, 1)
})

test('scenarios figer puis lister ; figer deux fois : code 1', async () => {
  const home = nouveauHome()
  const f = path.join(home, 'profil.json')
  fs.writeFileSync(f, JSON.stringify(profil))
  const args = ['scenarios', 'figer', '--profil', f, '--niveau', 'rapide', '--graine', '7', '--origine', 'https://lumivia.example']
  const r = await geo(args, home)
  assert.equal(r.code, 0, r.stderr)
  const l = json(await geo(['scenarios', 'lister'], home))
  assert.equal(l.jeux.length, 1)
  assert.equal(l.jeux[0].empreinte, json(r).empreinte)
  assert.equal(l.jeux[0].nb_scenarios, json(r).scenarios)
  assert.equal((await geo(args, home)).code, 1)
  assert.equal((await geo(['scenarios', 'figer', '--profil', f, '--niveau', 'rapide', '--graine', '7'], home)).code, 1)
  assert.equal((await geo(['scenarios'], home)).code, 1)
})

test('exporter-contenu : lot copié sous tmp/, lot hors plage refusé, --purger vide tmp/', async () => {
  const home = await homeAutorise()
  const a = json(await geo(['auditer', '--url', base, '--autoriser-local'], home))
  const passagesAudit = JSON.parse(fs.readFileSync(path.join(home, 'tmp', `audit-${a.audit_id}`, 'passages.json'), 'utf8'))
  assert.ok(passagesAudit.length >= 2)
  assert.ok(passagesAudit.some((p) => p.texte.includes('Lumivia est un logiciel de planification')))
  const r = await geo(['exporter-contenu', '--audit', String(a.audit_id), '--lot', '1'], home)
  assert.equal(r.code, 0, r.stderr)
  const s = json(r)
  assert.equal(s.lot, 1)
  assert.equal(s.passages, passagesAudit.length)
  assert.ok(!r.stdout.includes('Lumivia est un logiciel'))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'tmp', 'lot-1', 'passages.json'), 'utf8')), passagesAudit)
  assert.equal((await geo(['exporter-contenu', '--audit', String(a.audit_id), '--lot', '2'], home)).code, 1)
  assert.equal((await geo(['exporter-contenu', '--audit', String(a.audit_id), '--lot', '0'], home)).code, 1)
  assert.equal((await geo(['exporter-contenu', '--audit', '999', '--lot', '1'], home)).code, 1)
  assert.equal((await geo(['exporter-contenu', '--purger'], home)).code, 0)
  assert.ok(!fs.existsSync(path.join(home, 'tmp')))
})

test('passagesComplets : mêmes identifiants que analyserContenu, [] si désaccord', () => {
  const page = { url: 'https://x.example/', blocs: [{ type: 'titre', texte: 'T1' }, { type: 'p', texte: 'Corps un.' }, { type: 'titre', texte: 'T2' }, { type: 'titre', texte: 'T3' }, { type: 'p', texte: 'Corps deux.' }, { type: 'p', texte: 'caché', nosnippet: true }] }
  const contenu = { passages: [{ id: 'https://x.example/#1' }, { id: 'https://x.example/#2' }] }
  const r = passagesComplets(page, contenu)
  assert.deepEqual(r.map((p) => [p.id, p.titre, p.texte]), [['https://x.example/#1', 'T1', 'Corps un.'], ['https://x.example/#2', 'T3', 'Corps deux.']])
  assert.deepEqual(passagesComplets(page, { passages: [{ id: 'a' }] }), [])
})

// --- report rendering on degenerate audits ----------------------------------------

const titresDe = (md) => [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1])

test('rapportMarkdown : neuf sections même pour un audit vide ou minimal', () => {
  for (const a of [{}, null, undefined, { origine: 'https://x.example', constats: [], scores: [], exploration: { pages: 0 }, erreurs: [], contenu_resume: { pages: [] } }]) {
    const md = rapportMarkdown(a)
    assert.deepEqual(titresDe(md), SECTIONS)
    assert.match(md, /non mesuré/)
  }
})

test('rapportMarkdown : site derrière un défi WAF et site bloqué par robots.txt', () => {
  const waf = rapportMarkdown({ origine: 'https://w.example', constats: [{ id: 'GEO-WAF-DEFI', severite: 'bloquant', pages: ['https://w.example/'], preuve: { type: 'http', url: 'https://w.example/', detail: 'cf-mitigated: challenge' }, detail: 'Défi WAF.' }], exploration: { pages: 0, waf: true }, erreurs: [{ url: 'https://w.example/', raison: 'défi' }] })
  assert.deepEqual(titresDe(waf), SECTIONS)
  assert.match(waf, /GEO-WAF-DEFI/)
  assert.match(waf, /WAF/)
  const robots = rapportMarkdown({ origine: 'https://r.example', constats: [], exploration: { pages: 0 }, erreurs: [{ url: 'https://r.example/', raison: 'interdit par robots.txt' }], robots_ia: [{ jeton: 'GPTBot', editeur: 'OpenAI', role: 'entrainement', documente: true, chemins_bloques: ['/'] }] })
  assert.deepEqual(titresDe(robots), SECTIONS)
  assert.match(robots, /GPTBot/)
  assert.match(robots, /bloqué/)
})

test('rapportMarkdown : les quatre scores mesurés et toutes les plateformes sont « non mesuré »', () => {
  const md = rapportMarkdown({ origine: 'https://x.example', scores: [
    { id: 'seo-technique', valeur: 80, couverture: 1, criteres: [{ id: 'a', acquis: 1 }, { id: 'b', acquis: null }] },
    ...['autorite-thematique', 'reputation-externe', 'positionnement-concurrentiel', 'visibilite-mesuree'].map((id) => ({ id, valeur: null, couverture: 0, criteres: [], raison: 'nécessite une mesure (v0.2)' })),
  ] })
  const part = md.split('## Ce qui n\'a pas été mesuré')[1].split('## Limites')[0]
  for (const id of ['autorite-thematique', 'reputation-externe', 'positionnement-concurrentiel', 'visibilite-mesuree', ...PLATEFORMES]) assert.match(part, new RegExp(`${id} : non mesuré`))
  const scores = md.split('## Scores de potentiel')[1].split('## Entité')[0]
  assert.match(scores, /seo-technique/)
  assert.match(scores, /80\/100/)
  assert.match(scores, /\bb\b/)
  assert.ok(!scores.includes('autorite-thematique'))
  assert.ok(md.includes(PHRASE_LIMITE))
})

test('rapportMarkdown : extrait marqué non fiable, cellules sans saut de ligne ni pipe', () => {
  const md = rapportMarkdown({ origine: 'https://x.example', constats: [{ id: 'GEO-X', severite: 'important', pages: [], preuve: { type: 'html', url: 'u', detail: 'd' }, detail: 'a|b\nc', extrait: { extrait: 'texte &lt;b&gt;', non_fiable: true } }] })
  assert.match(md, /Extrait non fiable/)
  assert.match(md, /a\\\|b c/)
})

test('rapportJson : ordre des clés fixe', () => {
  const a = { exploration: {}, origine: 'o', audit_id: 1, constats: [] }
  assert.deepEqual(Object.keys(JSON.parse(rapportJson(a))), ['audit_id', 'origine', 'constats', 'exploration'])
  assert.equal(rapportJson(a), rapportJson({ ...a }))
})

// --- false-claims registry ----------------------------------------------------------

const registre = JSON.parse(fs.readFileSync(path.join(RACINE_GEO, 'donnees/idees-fausses.json'), 'utf8')).idees

test('idees-fausses : 12 entrées complètes avec motifs valides', () => {
  assert.equal(registre.length, 12)
  assert.equal(new Set(registre.map((i) => i.id)).size, 12)
  for (const i of registre) {
    for (const k of ['id', 'affirmation', 'pourquoi', 'source', 'verifie_le']) assert.ok(typeof i[k] === 'string' && i[k], `${i.id}.${k}`)
    assert.match(i.source, /^https:\/\//)
    assert.equal(i.verifie_le, '2026-11-27')
    assert.ok(Array.isArray(i.motifs) && i.motifs.length >= 1)
    for (const m of i.motifs) new RegExp(m, 'iu')
  }
})

const POSITIFS = {
  'llms-txt-visibilite': ['Le fichier llms.txt améliore la visibilité du site.', 'llms.txt is read by AI crawlers.'],
  'geo-plus-40-pourcent': ['Le GEO augmente la visibilité de 40 %.', 'GEO increases your visibility by 40%.'],
  'schema-fait-citer': ['Le balisage schema fait citer votre site.', 'Structured data gets you cited by ChatGPT.'],
  'longueur-ideale': ['La longueur idéale est de 300 mots.', 'The ideal length for AI answers is short.'],
  'google-extended-ai-overviews': ['Bloquer Google-Extended retire votre site d’AI Overviews.', 'Blocking Google-Extended removes you from AI Overviews.'],
  'robots-txt-bloque-tout': ['Le fichier robots.txt bloque tous les robots IA.', 'robots.txt blocks all AI bots.'],
  'rang-chatgpt': ['Votre marque est n° 3 dans ChatGPT.', 'Your brand is ranked 2 in ChatGPT.'],
  'api-egale-interface': ['Les réponses API sont celles que voient les utilisateurs.', 'API responses are the same as what users see.'],
  'robots-non-documentes': ['GrokBot est un robot documenté.', 'anthropic-ai is an official crawler.'],
  'mentions-web-citations': ['Les mentions sur le web provoquent des citations.', 'Web mentions cause AI citations.'],
  'api-officielle-ai-overviews': ['Cet outil mesure AI Overviews via une API officielle.', 'This tool measures Copilot through the official API.'],
  'indexnow-copilot': ['IndexNow garantit une place dans Copilot.', 'IndexNow guarantees Copilot visibility.'],
}
const NEGATIFS = [
  'llms.txt n’améliore pas la visibilité et n\'est lu par aucun robot documenté.',
  'Un fichier robots.txt n’empêche pas tous les accès IA.',
  'Aucune longueur idéale n’est documentée.',
  'GrokBot n’est pas un robot documenté.',
]

test('idees-fausses : chaque motif détecte l’affirmation énoncée comme un fait, FR et EN', () => {
  for (const i of registre) {
    const phrases = POSITIFS[i.id]
    assert.ok(phrases, `phrases d’essai manquantes pour ${i.id}`)
    for (const ph of phrases) assert.ok(i.motifs.some((m) => new RegExp(m, 'iu').test(ph)), `${i.id} ne détecte pas : ${ph}`)
  }
})

test('idees-fausses : les formulations négatives ne sont pas détectées', () => {
  for (const ph of NEGATIFS) for (const i of registre) for (const m of i.motifs) assert.ok(!new RegExp(m, 'iu').test(ph), `${i.id} détecte à tort : ${ph}`)
})

function fichiersMd(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? fichiersMd(p) : p.endsWith('.md') ? [p] : []
  })
}

// Lines starting with "> Idée fausse :" may quote a claim in order to refute it.
function trouvaillesIdees(texte) {
  const trouves = []
  for (const ligne of texte.split('\n')) {
    if (/^\s*>\s*Idée fausse :/.test(ligne)) continue
    for (const i of registre) for (const m of i.motifs) if (new RegExp(m, 'iu').test(ligne)) trouves.push(`${i.id} : ${ligne.trim().slice(0, 120)}`)
  }
  return trouves
}

test('idees-fausses : le modèle de rapport et les .md des skills et références ne reprennent aucune affirmation', () => {
  const modele = rapportMarkdown({ origine: 'https://x.example' }) + rapportMarkdown({ origine: 'https://x.example', constats: [], exploration: { pages: 3 } })
  assert.deepEqual(trouvaillesIdees(modele), [])
  for (const f of [...fichiersMd(path.join(RACINE_GEO, 'skills')), ...fichiersMd(path.join(RACINE_GEO, 'references'))]) {
    assert.deepEqual(trouvaillesIdees(fs.readFileSync(f, 'utf8')), [], f)
  }
})

test('idees-fausses : le marqueur « > Idée fausse : » autorise la citation réfutée, pas le reste', () => {
  assert.deepEqual(trouvaillesIdees('> Idée fausse : « llms.txt améliore la visibilité ».'), [])
  assert.equal(trouvaillesIdees('llms.txt améliore la visibilité.').length, 1)
})
