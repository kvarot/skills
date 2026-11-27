// CLI tests: node geo.mjs as a subprocess, GEO_HOME in a temp dir, node:http server on 127.0.0.1. No Internet.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { rapportMarkdown, rapportJson, SECTIONS, PLATEFORMES, PHRASE_LIMITE, passagesComplets, assainirConstat, resumerEntite } from '../../outils/lib/rapports.mjs'
import { analyserEntite } from '../../outils/lib/entites.mjs'
import { trouverIdeesFausses } from '../../outils/lib/idees.mjs'

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

test('init : une nouvelle session repart sans hôte autorisé', async () => {
  const home = await homeAutorise()
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8')).hotes_autorises, ['127.0.0.1'])
  const r = await geo(['init'], home)
  assert.equal(r.code, 0)
  assert.deepEqual(json(r).session.hotes_autorises, [])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'session.json'), 'utf8')).hotes_autorises, [])
  assert.equal((await geo(['auditer', '--url', base, '--autoriser-local'], home)).code, 3)
})

test('auditer après autoriser : code 0, JSON valide, clés attendues dans l’ordre', async () => {
  const home = await homeAutorise()
  const r = await geo(['auditer', '--url', base, '--autoriser-local'], home)
  assert.equal(r.code, 0, r.stderr)
  const s = json(r)
  assert.equal(r.stderr, '')
  assert.deepEqual(Object.keys(s), ['audit_id', 'origine', 'constats', 'scores', 'robots_ia', 'robots_txt', 'contenu_resume', 'entite', 'erreurs', 'exploration'])
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
  // Folder fixture known to give important findings (no sitemap, no Organization) and no bloquant one.
  const site = path.join(home, 'site-important')
  fs.mkdirSync(site)
  fs.writeFileSync(path.join(site, 'index.html'), `<!doctype html><html lang="fr"><head><title>Lumivia</title><meta name="description" content="x"><meta name="viewport" content="width=device-width"><meta name="author" content="A"></head><body><h1>Lumivia</h1><h2>Qu'est-ce que Lumivia ?</h2><p>${PARAGRAPHES[0]}</p><p>${PARAGRAPHES[1]}</p></body></html>`)
  const sans = await geo(['auditer', '--dossier', site], home)
  const severites = json(sans).constats.map((c) => c.severite)
  assert.ok(severites.includes('important') && !severites.includes('bloquant'))
  assert.equal(sans.code, 0)
  assert.equal((await geo(['auditer', '--dossier', site, '--echec-si', 'bloquant'], home)).code, 0)
  const r = await geo(['auditer', '--dossier', site, '--echec-si', 'important'], home)
  assert.equal(r.code, 2)
  assert.ok(json(r).audit_id)
})

test('auditer --wikidata sans hôte wikidata autorisé : code 3, stdout vide', async () => {
  const home = await homeAutorise()
  const r = await geo(['auditer', '--url', base, '--autoriser-local', '--wikidata'], home)
  assert.equal(r.code, 3)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /www\.wikidata\.org/)
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
  assert.deepEqual(s.ids, passagesAudit.map((p) => p.id))
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
    for (const k of ['id', 'affirmation', 'pourquoi', 'verifie_le']) assert.ok(typeof i[k] === 'string' && i[k], `${i.id}.${k}`)
    assert.ok([].concat(i.source).length >= 1)
    for (const u of [].concat(i.source)) assert.match(u, /^https:\/\//)
    assert.equal(i.verifie_le, '2026-11-27')
    assert.ok(Array.isArray(i.motifs) && i.motifs.length >= 1)
    for (const m of i.motifs) new RegExp(m, 'iu')
  }
})

const POSITIFS = {
  'llms-txt-visibilite': ['Le fichier llms.txt améliore la visibilité du site.', 'llms.txt is read by AI crawlers.'],
  'geo-plus-40-pourcent': ['Le GEO augmente la visibilité de 40 %.', 'GEO increases your visibility by 40%.', 'Gagnez 40 % de visibilité grâce au GEO.', 'Gain 40% more visibility with GEO.'],
  'schema-fait-citer': ['Le balisage schema fait citer votre site.', 'Structured data gets you cited by ChatGPT.'],
  'longueur-ideale': ['La longueur idéale est de 300 mots.', 'The ideal length for AI answers is short.'],
  'google-extended-ai-overviews': ['Bloquer Google-Extended retire votre site d’AI Overviews.', 'Bloquer Google-Extended retire d’AI Overviews.', 'Blocking Google-Extended removes you from AI Overviews.'],
  'robots-txt-bloque-tout': ['Le fichier robots.txt bloque tous les robots IA.', 'robots.txt blocks all AI bots.'],
  'rang-chatgpt': ['Votre marque est n° 3 dans ChatGPT.', 'Your brand is ranked 2 in ChatGPT.'],
  'api-egale-interface': ['Les réponses API sont celles que voient les utilisateurs.', 'API responses are the same as what users see.'],
  'robots-non-documentes': ['GrokBot est un robot documenté.', 'anthropic-ai is an official crawler.'],
  'mentions-web-citations': ['Les mentions sur le web provoquent des citations.', 'Web mentions cause AI citations.'],
  'api-officielle-ai-overviews': ['Cet outil mesure AI Overviews via une API officielle.', 'This tool measures Copilot through the official API.'],
  'indexnow-copilot': ['IndexNow garantit une place dans Copilot.', 'IndexNow guarantees Copilot visibility.'],
}
// One correct refutation per entry, FR and EN: never flagged.
const REFUTATIONS = {
  'llms-txt-visibilite': ['llms.txt n’améliore pas la visibilité.', "llms.txt n'est lu par aucun robot documenté.", 'llms.txt does not improve visibility.'],
  'geo-plus-40-pourcent': ['Le GEO n’augmente pas la visibilité de 40 %.', 'Le GEO n’augmente pas, selon cette étude, la visibilité de 40 %.', 'GEO does not, according to the study, increase visibility by 40%.', 'GEO does not increase visibility by 40%.'],
  'schema-fait-citer': ['Le balisage schema ne fait pas citer un site.', "Structured data doesn't get you cited."],
  'longueur-ideale': ["Il n'y a pas de longueur idéale.", 'There is no ideal length.', 'Aucune longueur idéale n’est documentée.'],
  'google-extended-ai-overviews': ['Bloquer Google-Extended ne retire pas d’AI Overviews.', 'Blocking Google-Extended does not remove you from AI Overviews.'],
  'robots-txt-bloque-tout': ['robots.txt ne bloque pas tous les robots IA.', 'robots.txt does not block all AI bots.'],
  'rang-chatgpt': ['Ne dites jamais : votre marque est n° 3 dans ChatGPT.', 'Never say your brand is ranked 2 in ChatGPT.', 'Never say: your brand is ranked 2 in ChatGPT.'],
  'api-egale-interface': ['Les réponses API ne sont pas celles que voient les utilisateurs.', 'API responses are not the same as what users see.'],
  'robots-non-documentes': ['GrokBot n’est pas un robot documenté.', 'GrokBot is not a documented crawler.'],
  'mentions-web-citations': ['Les mentions sur le web ne provoquent pas de citations.', 'Web mentions do not cause AI citations.'],
  'api-officielle-ai-overviews': ['Aucun outil ne mesure AI Overviews via une API officielle.', 'No tool measures AI Overviews through an official API.'],
  'indexnow-copilot': ['IndexNow ne garantit pas de place dans Copilot.', 'IndexNow does not guarantee Copilot visibility.'],
}
const NEGATIFS = Object.values(REFUTATIONS).flat()

test('idees-fausses : chaque motif détecte l’affirmation énoncée comme un fait, FR et EN', () => {
  for (const i of registre) {
    const phrases = POSITIFS[i.id]
    assert.ok(phrases, `phrases d’essai manquantes pour ${i.id}`)
    for (const ph of phrases) assert.ok(trouverIdeesFausses(ph, [i]).length > 0, `${i.id} ne détecte pas : ${ph}`)
  }
})

test('idees-fausses : une réfutation par entrée, FR et EN, jamais détectée', () => {
  assert.deepEqual(Object.keys(REFUTATIONS).sort(), registre.map((i) => i.id).sort())
  for (const ph of NEGATIFS) assert.deepEqual(trouverIdeesFausses(ph, registre), [], ph)
})

function fichiersMd(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? fichiersMd(p) : p.endsWith('.md') ? [p] : []
  })
}

// Lines starting with "> Idée fausse :" may quote a claim in order to refute it (handled by trouverIdeesFausses).

const trouvaillesIdees = (texte) => trouverIdeesFausses(texte, registre)

test('idees-fausses : le modèle de rapport et les .md des skills, références, agents, docs et de la racine du plugin ne reprennent aucune affirmation', () => {
  const modele = rapportMarkdown({ origine: 'https://x.example' }) + rapportMarkdown({ origine: 'https://x.example', constats: [], exploration: { pages: 3 } })
  assert.deepEqual(trouvaillesIdees(modele), [])
  const racineMd = fs.readdirSync(RACINE_GEO).filter((n) => n.endsWith('.md')).map((n) => path.join(RACINE_GEO, n))
  for (const f of [...['skills', 'references', 'commands', 'agents', 'docs'].flatMap((d) => fichiersMd(path.join(RACINE_GEO, d))), ...racineMd]) {
    assert.deepEqual(trouvaillesIdees(fs.readFileSync(f, 'utf8')), [], f)
  }
})

test('idees-fausses : le marqueur « > Idée fausse : » autorise la citation réfutée, pas le reste', () => {
  assert.deepEqual(trouvaillesIdees('> Idée fausse : « llms.txt améliore la visibilité ».'), [])
  assert.equal(trouvaillesIdees('llms.txt améliore la visibilité.').length, 1)
})

// --- untrusted output: stdout and Markdown ------------------------------------------

const LONG = 'x'.repeat(600)
const NOM_PIEGE = '[Cliquez](javascript:alert(1)) ![](https://tracker.example/p.gif)'
const jsonLdPiege = JSON.stringify({
  '@context': 'https://schema.org', '@type': ['Organization', '<img src=x onerror=alert(1)>' + LONG], name: NOM_PIEGE,
  sameAs: ['https://evil.example/<img src=x onerror=alert(1)>' + LONG, 'https://ok.example/profil'],
})

test('entité : JSON-LD hostile (types, sameAs, nom) : stdout ne porte que des extraits bornés ; Markdown sans lien ni image actifs', async () => {
  sites['/piege/'] = pageBonne().replace('</head>', `<script type="application/ld+json">${jsonLdPiege}</script></head>`)
  try {
    const home = await homeAutorise()
    const r = await geo(['auditer', '--url', base + '/piege/', '--autoriser-local'], home)
    assert.equal(r.code, 0, r.stderr)
    assert.ok(!r.stdout.includes('<img'))
    const s = json(r)
    for (const o of [...s.entite.types, ...s.entite.sameAs, ...s.entite.noms]) {
      assert.equal(o.non_fiable, true)
      assert.ok(o.extrait.length <= 280)
    }
    assert.ok(s.entite.sameAs.length >= 1)
    assert.equal(typeof s.entite.wikidata.statut, 'string')
    const md = (await geo(['rapport', '--audit', String(s.audit_id), '--format', 'md'], home)).stdout
    assert.ok(!md.includes('<img'))
    assert.doesNotMatch(md, /\]\(/)
    assert.doesNotMatch(md, /!\[/)
  } finally { delete sites['/piege/'] }
})

test('rapportMarkdown : extrait, nom, type, détail et erreur hostiles : aucun lien ni image actifs', () => {
  const md = rapportMarkdown({
    origine: 'https://x.example',
    constats: [{ id: 'GEO-X', severite: 'bloquant', pages: [], preuve: { type: 'html', url: 'u', detail: NOM_PIEGE }, detail: NOM_PIEGE, extrait: { extrait: NOM_PIEGE, non_fiable: true } }],
    entite: { noms: [{ extrait: NOM_PIEGE, non_fiable: true }], types: [{ extrait: NOM_PIEGE, non_fiable: true }], sameAs: [], wikidata: { statut: 'non_verifie', raison: { extrait: NOM_PIEGE, non_fiable: true } }, constats: [] },
    erreurs: [{ url: 'https://x.example/', raison: NOM_PIEGE }],
  })
  assert.doesNotMatch(md, /\]\(/)
  assert.doesNotMatch(md, /!\[/)
  assert.ok(md.includes('Cliquez'))
})

test('« Ce qui n’a pas été mesuré » repose sur les quatre identifiants, pas sur l’absence de critères', () => {
  const md = rapportMarkdown({ origine: 'https://x.example', scores: [{ id: 'seo-technique', valeur: null, couverture: 0, criteres: [], raison: 'rien' }] })
  const part = md.split("## Ce qui n'a pas été mesuré")[1].split('## Limites')[0]
  for (const id of ['autorite-thematique', 'reputation-externe', 'positionnement-concurrentiel', 'visibilite-mesuree']) assert.match(part, new RegExp(id + ' : non mesuré'))
  assert.ok(!part.includes('seo-technique'))
  assert.ok(md.split('## Scores de potentiel')[1].split('## Entité')[0].includes('seo-technique'))
})

// --- robots.txt status ---------------------------------------------------------------

async function avecServeur(robots, fn) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(robots.statut, { 'content-type': 'text/plain' })
      return res.end(robots.corps ?? 'non')
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(pageBonne())
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try { await fn(`http://127.0.0.1:${srv.address().port}`) } finally { srv.close() }
}

test('statut de robots.txt : 5xx inaccessible, 404 absent, 200 présent, dossier sans robots.txt', async () => {
  const home = await homeAutorise()
  await avecServeur({ statut: 503 }, async (b) => {
    const s = json(await geo(['auditer', '--url', b, '--autoriser-local'], home))
    assert.equal(s.robots_txt.etat, 'inaccessible')
    assert.ok(s.robots_ia.every((r) => r.chemins_bloques.length > 0))
    const md = (await geo(['rapport', '--audit', String(s.audit_id), '--format', 'md'], home)).stdout
    assert.match(md, /robots\.txt inaccessible : tout est considéré interdit \(RFC 9309\)/)
    const rb = json(await geo(['robots', '--url', b, '--autoriser-local'], home))
    assert.equal(rb.robots_txt.etat, 'inaccessible')
    assert.ok(rb.robots.every((r) => r.politique.startsWith('inaccessible')))
  })
  await avecServeur({ statut: 404 }, async (b) => {
    const s = json(await geo(['auditer', '--url', b, '--autoriser-local'], home))
    assert.equal(s.robots_txt.etat, 'absent')
    assert.ok(s.robots_ia.every((r) => r.chemins_bloques.length === 0))
    const md = (await geo(['rapport', '--audit', String(s.audit_id), '--format', 'md'], home)).stdout
    assert.match(md, /Aucun robots\.txt observé : rien n'est interdit/)
  })
  await avecServeur({ statut: 200, corps: 'User-agent: *\nAllow: /\n' }, async (b) => {
    const s = json(await geo(['auditer', '--url', b, '--autoriser-local'], home))
    assert.equal(s.robots_txt.etat, 'present')
    const md = (await geo(['rapport', '--audit', String(s.audit_id), '--format', 'md'], home)).stdout
    assert.match(md, /robots\.txt observé \(statut 200\)/)
  })
  const site = path.join(home, 'dossier-sans-robots')
  fs.mkdirSync(site)
  fs.writeFileSync(path.join(site, 'index.html'), pageBonne())
  const d = json(await geo(['auditer', '--dossier', site], home))
  assert.equal(d.robots_txt.etat, 'dossier-absent')
  const md = (await geo(['rapport', '--audit', String(d.audit_id), '--format', 'md'], home)).stdout
  assert.match(md, /Aucun robots\.txt dans le dossier/)
  fs.writeFileSync(path.join(site, 'robots.txt'), 'User-agent: *\nAllow: /\n')
  assert.equal(json(await geo(['auditer', '--dossier', site], home)).robots_txt.etat, 'dossier-present')
})

test('erreurs : url et raison passent par extrait (échappées, bornées)', async () => {
  const home = await homeAutorise()
  await avecServeur({ statut: 503 }, async (b) => {
    const s = json(await geo(['auditer', '--url', b, '--autoriser-local'], home))
    assert.ok(s.erreurs.length >= 1)
    for (const e of s.erreurs) { assert.ok(e.raison.length <= 280); assert.ok(!/[<>]/.test(e.raison + e.url)) }
  })
})

test('rapport --sortie refuse les fichiers de l’outil (session.json, geo.sqlite, cache, tmp)', async () => {
  const home = await homeAutorise()
  const id = json(await geo(['auditer', '--url', base, '--autoriser-local'], home)).audit_id
  const avant = fs.readFileSync(path.join(home, 'session.json'), 'utf8')
  for (const cible of ['session.json', 'geo.sqlite', 'geo.sqlite-wal', './session.json', 'tmp/x.md', 'cache/x.md']) {
    const r = await geo(['rapport', '--audit', String(id), '--format', 'md', '--sortie', cible], home)
    assert.equal(r.code, 1, cible)
  }
  assert.equal(fs.readFileSync(path.join(home, 'session.json'), 'utf8'), avant)
})

test('idees-fausses : sources alignées sur les affirmations réfutées', () => {
  const src = (id) => [].concat(registre.find((i) => i.id === id).source)
  assert.deepEqual(src('indexnow-copilot'), ['https://blogs.bing.com/webmaster/February-2026/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview'])
  assert.ok(src('rang-chatgpt')[0].startsWith('https://sparktoro.com/blog/'))
  assert.ok(src('llms-txt-visibilite').includes('https://ahrefs.com/blog/llmstxt-study/'))
  assert.ok(src('robots-non-documentes').length >= 3)
  assert.ok(!src('robots-non-documentes').some((u) => u.includes('google.com')))
})

// --- boundary sanitiser and clause-level negation --------------------------------------

test('constats : detail et preuve.detail sont des extraits sur stdout et dans la base ; URL bornées', async () => {
  const hostile = '<img src=x onerror=alert(1)>Evil'
  sites['/hostile/'] = pageBonne().replace('</head>', `<meta property="og:site_name" content="${hostile.replace(/"/g, '')}"><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Autre Nom', sameAs: ['https://ok.example/p'] })}</script></head>`)
  try {
    const home = await homeAutorise()
    const r = await geo(['auditer', '--url', base + '/hostile/', '--autoriser-local'], home)
    assert.equal(r.code, 0, r.stderr)
    assert.ok(!r.stdout.includes('<img'))
    const s = json(r)
    assert.ok(s.constats.length > 0)
    const verifier = (constats) => {
      for (const c of constats) {
        assert.equal(c.detail.non_fiable, true, c.id)
        assert.ok(c.detail.extrait.length <= 280)
        assert.equal(c.preuve.detail.non_fiable, true, c.id)
        assert.ok(c.preuve.detail.extrait.length <= 280)
        for (const u of [c.preuve.url, ...c.pages]) assert.ok(typeof u === 'string' && u.length <= 2048)
      }
    }
    verifier(s.constats)
    verifier(s.entite.constats)
    // the stored row is the same: the JSON report reads it back
    const relu = json(await geo(['rapport', '--audit', String(s.audit_id), '--format', 'json'], home))
    assert.deepEqual(relu.constats, s.constats)
    assert.ok(!JSON.stringify(relu).includes('<img'))
    const md = (await geo(['rapport', '--audit', String(s.audit_id), '--format', 'md'], home)).stdout
    assert.doesNotMatch(md, /\[object Object\]/)
  } finally { delete sites['/hostile/'] }
})

test('assainirConstat : extraits, URL bornées, idempotent ; Wikidata : identifiants Q seulement', async () => {
  const c = { id: 'X', severite: 'important', pages: ['https://x.example/' + 'a'.repeat(3000)], preuve: { type: 'http', url: 'https://x.example/' + 'b'.repeat(3000), detail: '<b>' + 'z'.repeat(500) }, detail: '<i>d</i>' }
  const a = assainirConstat(c)
  assert.equal(a.detail.extrait, '&lt;i&gt;d&lt;/i&gt;')
  assert.equal(a.preuve.detail.extrait.length, 280)
  assert.equal(a.pages[0].length, 2048)
  assert.equal(a.preuve.url.length, 2048)
  assert.deepEqual(assainirConstat(a), a)
  const client = { demander: async () => ({ statut: 200, corps: JSON.stringify({ search: [{ id: 'Q1', label: 'Lumivia' }, { id: 'Q2', label: 'Lumivia' }, { id: '<img src=x>', label: 'Lumivia' }, { id: 'Q3x', label: 'Lumivia' }] }) }) }
  const collecte = { pages: [{ url: 'https://x.example/', lang: 'fr', jsonld: [], blocs: [] }], site: {}, erreurs: [] }
  const e = await analyserEntite(collecte, { marque: 'Lumivia', client, wikidata: true })
  assert.deepEqual(e.wikidata.ids, ['Q1', 'Q2'])
  const refus = { demander: async () => ({ statut: 500, corps: null, raison: '<script>mauvais</script>' }) }
  const e2 = await analyserEntite(collecte, { marque: 'Lumivia', client: refus, wikidata: true })
  assert.ok(!e2.wikidata.raison.includes('<script>'))
  assert.ok(!JSON.stringify(resumerEntite(e2)).includes('<script>'))
})

test('idees-fausses : la négation est évaluée par proposition, pas par ligne', () => {
  for (const ph of [
    'Le GEO augmente la visibilité de 40 %, ne le manquez pas.',
    'Ne vous fiez pas à ce mythe. Le balisage schema fait citer votre site.',
    'Your brand is no. 3 in ChatGPT.',
  ]) assert.ok(trouverIdeesFausses(ph, registre).length >= 1, ph)
  assert.deepEqual(trouverIdeesFausses('Ne vous fiez pas à ce mythe : llms.txt n’améliore pas la visibilité.', registre), [])
})

// --- final review ---------------------------------------------------------------------

// Server whose answers are read from `etat` at request time (robots.txt can change between two audits).
async function serveurVariable(etat, fn) {
  const srv = http.createServer((req, res) => {
    const r = (typeof etat.routes === 'function' ? etat.routes() : etat.routes)[req.url.split('?')[0]]
    if (!r) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('non') }
    res.writeHead(r.statut ?? 200, { 'content-type': r.type ?? 'text/html; charset=utf-8', ...(r.entetes ?? {}) })
    res.end(r.corps ?? '')
  })
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
  try { await fn(`http://127.0.0.1:${srv.address().port}`) } finally { srv.closeAllConnections?.(); srv.close() }
}
const idsDe = (s) => s.constats.map((c) => c.id)
const scoreDe = (s, id) => s.scores.find((x) => x.id === id)

test('C1 : zéro page (dossier vide avec Disallow: /, robots.txt 503) : identite-numerique non affiché, rien crédité', async () => {
  const home = await homeAutorise()
  const vide = path.join(home, 'vide')
  fs.mkdirSync(vide)
  fs.writeFileSync(path.join(vide, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
  const d = json(await geo(['auditer', '--dossier', vide], home))
  await avecServeur({ statut: 503 }, async (b) => {
    const s = json(await geo(['auditer', '--url', b, '--autoriser-local'], home))
    for (const a of [d, s]) {
      const id = scoreDe(a, 'identite-numerique')
      assert.equal(id.valeur, null, JSON.stringify(id))
      assert.ok(id.criteres.every((c) => c.acquis === null))
    }
  })
})

test('I1 : robots.txt 503 : constat bloquant GEO-ROBOTSTXT-INACCESSIBLE, aucun faux GEO-SITEMAP-ABSENT, llms.txt non vérifié', async () => {
  const home = await homeAutorise()
  await avecServeur({ statut: 503 }, async (b) => {
    const r = await geo(['auditer', '--url', b, '--autoriser-local', '--echec-si', 'bloquant'], home)
    assert.equal(r.code, 2)
    const s = json(r)
    const c = s.constats.find((x) => x.id === 'GEO-ROBOTSTXT-INACCESSIBLE')
    assert.equal(c.severite, 'bloquant')
    assert.equal(c.preuve.commande, `curl -sI '${b}/robots.txt'`)
    assert.ok(!idsDe(s).includes('GEO-SITEMAP-ABSENT'))
    assert.match(s.constats.find((x) => x.id === 'GEO-LLMSTXT').detail.extrait, /non vérifié/)
    assert.equal(scoreDe(s, 'seo-technique').criteres.find((x) => x.id === 'sitemap-present').acquis, null)
    const md = (await geo(['rapport', '--audit', String(s.audit_id), '--format', 'md'], home)).stdout
    assert.match(md.split('## Accès des robots IA')[0], /GEO-ROBOTSTXT-INACCESSIBLE/)
  })
})

test('I1 : Disallow: / avec Sitemap: déclaré : pas de GEO-SITEMAP-ABSENT, sitemap jamais demandé', async () => {
  const home = await homeAutorise()
  let demandes = 0
  const etat = {}
  etat.routes = () => ({ '/robots.txt': { type: 'text/plain', corps: `User-agent: *\nDisallow: /\nSitemap: ${etat.base}/plan.xml\n` }, '/plan.xml': { type: 'application/xml', get corps() { demandes++; return '<urlset/>' } } })
  await serveurVariable(etat, async (b) => {
    etat.base = b
    const s = json(await geo(['auditer', '--url', b, '--autoriser-local'], home))
    assert.ok(idsDe(s).includes('GEO-ROBOTSTXT-BLOQUE-TOUT'))
    assert.ok(!idsDe(s).includes('GEO-SITEMAP-ABSENT'))
    assert.equal(demandes, 0)
  })
})

test('I3 : un nouvel audit relit le site (robots.txt passé de Allow à Disallow) ; exploration.depuis_cache', async () => {
  const home = await homeAutorise()
  const etat = { robots: 'User-agent: *\nAllow: /\n' }
  etat.routes = () => ({ '/': { corps: pageBonne() }, '/robots.txt': { type: 'text/plain', corps: etat.robots } })
  await serveurVariable(etat, async (b) => {
    const a = json(await geo(['auditer', '--url', b, '--autoriser-local'], home))
    assert.ok(!idsDe(a).includes('GEO-ROBOTSTXT-BLOQUE-TOUT'))
    assert.equal(a.exploration.depuis_cache, 0)
    etat.robots = 'User-agent: *\nDisallow: /\n'
    const s = json(await geo(['auditer', '--url', b, '--autoriser-local'], home))
    assert.ok(idsDe(s).includes('GEO-ROBOTSTXT-BLOQUE-TOUT'), 'le second audit voit le nouveau robots.txt')
    assert.equal(s.exploration.pages, 0)
    assert.equal(s.exploration.depuis_cache, 0)
  })
  assert.ok(!fs.existsSync(path.join(home, 'cache')), 'aucune réponse écrite sur disque')
})

test('I4 : auditer charge le dernier jeu figé de l’origine ; sans jeu, couverture-intentions non calculée', async () => {
  const home = await homeAutorise()
  const sans = json(await geo(['auditer', '--url', base, '--autoriser-local'], home))
  const ci = scoreDe(sans, 'couverture-intentions')
  assert.equal(ci.criteres[0].acquis, null)
  assert.match(ci.criteres[0].preuve, /aucun jeu de scénarios figé pour ce site/)
  const f = path.join(home, 'profil.json')
  fs.writeFileSync(f, JSON.stringify(profil))
  const jeu = json(await geo(['scenarios', 'figer', '--profil', f, '--niveau', 'rapide', '--graine', '7', '--origine', base], home))
  const avec = json(await geo(['auditer', '--url', base, '--autoriser-local'], home))
  const c = scoreDe(avec, 'couverture-intentions').criteres[0]
  assert.notEqual(c.acquis, null, c.preuve)
  assert.match(c.preuve, new RegExp(`^jeu n° ${jeu.jeu_id} : `))
})

test('I5 : Node < 22.13 : erreur claire en français, code 1 ; 22.13 accepté', async () => {
  const home = nouveauHome()
  const r = await geo(['--version'], home, { env: { GEO_TEST_VERSION_NODE: '22.12.0' } })
  assert.equal(r.code, 1)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /Node 22\.13\.0 ou plus est requis \(version actuelle : 22\.12\.0\)/)
  assert.equal((await geo(['--version'], home, { env: { GEO_TEST_VERSION_NODE: '22.13.0' } })).code, 0)
  assert.equal((await geo(['--version'], home, { env: { GEO_TEST_VERSION_NODE: '24.1.0' } })).code, 0)
})

test('M5 : mode dossier : --max-pages respecté, aucune commande curl sans origine', async () => {
  const home = nouveauHome()
  const site = path.join(home, 'site-max')
  fs.mkdirSync(site)
  for (const n of ['index', 'a', 'b']) fs.writeFileSync(path.join(site, n + '.html'), pageBonne('Page ' + n).replace('<head>', '<head><meta name="robots" content="noindex">'))
  const r = await geo(['auditer', '--dossier', site, '--max-pages', '2'], home)
  assert.equal(r.code, 0, r.stderr)
  const s = json(r)
  assert.equal(s.exploration.pages, 2)
  assert.equal(s.exploration.limite_atteinte, true)
  assert.ok(!r.stdout.includes('curl'))
  assert.match(s.constats.find((c) => c.id === 'GEO-NOINDEX').preuve.detail.extrait, /mode dossier : fichier index\.html/)
})

test('M6 : page de départ redirigée vers un hôte non autorisé : code 3 nommant cet hôte', async () => {
  const home = await homeAutorise()
  await serveurVariable({ routes: { '/': { statut: 302, entetes: { location: 'http://ailleurs.example/' } }, '/robots.txt': { type: 'text/plain', corps: '' } } }, async (b) => {
    const r = await geo(['auditer', '--url', b, '--autoriser-local'], home)
    assert.equal(r.code, 3)
    assert.equal(r.stdout, '')
    assert.match(r.stderr, /ailleurs\.example/)
    assert.match(r.stderr, /accord/)
  })
})

test('preuve.commande : curl -sI rejouable sur stdout et dans le Markdown (non échappée)', async () => {
  const home = await homeAutorise()
  sites['/liens/'] = pageBonne().replace('</body>', '<a href="/casse?a=1&b=2">x</a></body>')
  try {
    const s = json(await geo(['auditer', '--url', base + '/liens/', '--autoriser-local'], home))
    const c = s.constats.find((x) => x.id === 'GEO-HTTP-ERREUR')
    assert.equal(c.preuve.commande, `curl -sI '${base}/casse?a=1&b=2'`)
    assert.doesNotMatch(JSON.stringify(c.preuve.detail), /curl/)
    const md = (await geo(['rapport', '--audit', String(s.audit_id), '--format', 'md'], home)).stdout
    assert.ok(md.includes('`' + c.preuve.commande + '`'))
  } finally { delete sites['/liens/'] }
})

test('M1 : rapport : jetons de contrôle et autres robots ont un titre lisible', () => {
  const md = rapportMarkdown({ origine: 'https://x.example', robots_ia: [
    { jeton: 'Google-Extended', editeur: 'Google', role: 'controle', documente: true, chemins_bloques: [] },
    { jeton: 'Inconnu', editeur: null, role: 'autre', documente: false, chemins_bloques: [] },
  ] })
  assert.match(md, /### Jetons de contrôle/)
  assert.match(md, /### Autres robots/)
  assert.doesNotMatch(md, /### controle/)
})

test('assainirConstat : une commande hors de la forme curl -x \'url\' est retirée', () => {
  const mauvaises = ["curl -sI 'https://x.example/'; rm -rf /", "curl -sI 'https://x.example/a b'", 'wget https://x.example/', "curl -sI 'https://x.example/" + 'a'.repeat(600) + "'"]
  for (const commande of mauvaises) {
    const a = assainirConstat({ id: 'X', severite: 'important', pages: [], preuve: { type: 'http', url: 'https://x.example/', detail: 'd', commande }, detail: 'd' })
    assert.equal(a.preuve.commande, undefined, commande)
  }
  const ok = assainirConstat({ id: 'X', severite: 'important', pages: [], preuve: { type: 'http', url: 'https://x.example/', detail: 'd', commande: "curl -sI 'https://x.example/a?b=1&c=2'" }, detail: 'd' })
  assert.equal(ok.preuve.commande, "curl -sI 'https://x.example/a?b=1&c=2'")
})
