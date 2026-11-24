// Offline self-test of the deterministic tools (no browser, no model, no network).
//   node evals/test-outils.mjs        -> exit 0 if every check passes
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { parseFrontMatter, validerPersona, reglagesLancement, lirePersona } from '../outils/persona.mjs'
import { analyser } from '../outils/analyser-journal.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const outils = path.join(here, '..', 'outils')
let ko = 0
const ok = (cond, msg) => { console.log((cond ? 'ok  ' : 'KO  ') + msg); if (!cond) ko++ }
const tmp = mkdtempSync(path.join(os.tmpdir(), 'vp-test-'))

// 1. Persona cards: every shipped card is valid; settings are enforced from the card.
for (const f of readdirSync(path.join(here, '..', 'modeles', 'personas'))) {
  try { lirePersona(path.join(here, '..', 'modeles', 'personas', f)); ok(true, 'fiche valide : ' + f) } catch (e) { ok(false, 'fiche valide : ' + f + ' — ' + e.message) }
}
const { meta } = parseFrontMatter('---\nid: x\nenvironnement:\n  ecran: 1280x800\n  saisie: clavier-seul\naccessibilite:\n  zoom: 200\npatience: basse\n---\ncorps')
const r = reglagesLancement(meta)
ok(r.viewport === '640x400', 'zoom 200 % divise la fenêtre CSS')
ok(!r.outils.includes('click') && r.outils.includes('press_key'), 'clavier seul retire le clic')
ok(r.budget_actions === 60, 'budget patience basse ×3 au clavier')
ok(validerPersona(meta).some((e) => e.includes('metier')), 'champ manquant détecté')

// 2. Hook: fail closed, origin, budget.
const hook = (input, env) => {
  try { execFileSync(process.env.PYTHON || 'python', ['-I', '-X', 'utf8', path.join(outils, 'garde-url.py')], { input, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }); return 0 } catch (e) { return e.status }
}
const env = { GARDE_ORIGINE: 'http://127.0.0.1:1', GARDE_OUTILS: 'm__n__click,m__n__navigate_page' }
ok(hook('pas du json', env) === 2, 'hook : entrée illisible refusée')
ok(hook('{"tool_name":"m__n__evaluate"}', env) === 2, 'hook : outil hors liste refusé')
ok(hook('{"tool_name":"m__n__navigate_page","tool_input":{"url":"file:///c:/x"}}', env) === 2, 'hook : file:// refusé')
ok(hook('{"tool_name":"m__n__navigate_page","tool_input":{"url":"http://127.0.0.1:10/"}}', env) === 2, 'hook : autre port refusé')
ok(hook('{"tool_name":"m__n__navigate_page","tool_input":{"url":"http://127.0.0.1:1/#/a"}}', env) === 0, 'hook : origine du produit permise')
const cpt = path.join(tmp, 'c')
const envB = { ...env, GARDE_COMPTEUR: cpt, GARDE_MAX_ACTIONS: '1' }
hook('{"tool_name":"m__n__click"}', envB)
ok(hook('{"tool_name":"m__n__click"}', envB) === 2, 'hook : budget de patience appliqué')

// 3. Analyser: citations checked against what the tool really returned.
const run = path.join(tmp, 'run')
mkdirSync(run)
const L = (o) => JSON.stringify(o)
writeFileSync(path.join(run, 'journal.jsonl'), [
  L({ type: 'assistant', message: { content: [{ type: 'text', text: 'PAS 1 | cherche: début | vois: Accueil | comprends: non (dépendances) | hesitation: deux boutons | action: clic' }, { type: 'tool_use', id: 't1', name: 'mcp__n__click', input: { uid: '1_2' } }] } }),
  L({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'uid=1_0 RootWebArea url="http://127.0.0.1:1/#/a"\n uid=1_2 button "Voir les résultats"\n uid=1_3 alert\n  uid=1_4 "Impossible de continuer sans compte."' }] }] } }),
  L({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'mcp__n__navigate_page', input: { type: 'back' } }] } }),
].join('\n'))
writeFileSync(path.join(run, 'resultat.md'), 'Récit.\nAIDE: que veut dire dépendances ?\n```json\n' + L({ objectif_atteint: 'non', frictions: [
  { ecran: 'a', quoi: 'bloqué', preuve_verbatim: 'Impossible de continuer sans compte.', gravite: 'bloquant' },
  { ecran: 'a', quoi: 'inventé', preuve_verbatim: 'Ce texte n\'existe nulle part à l\'écran', gravite: 'gênant' }] }) + '\n```')
writeFileSync(path.join(run, 'mesures.json'), L({ persona: 'p1', secondes: 9, reglages_imposes: { outils: ['click'] } }))
const a = analyser(run, { cheminReference: 1 })
ok(a.citations.verifiees === 1 && a.citations.non_retrouvees === 1, 'analyse : citation inventée détectée')
ok(a.mesure.clics === 1 && a.mesure.retours_arriere === 1, 'analyse : clics et retour arrière comptés')
ok(a.pas_declares.nombre === 1 && a.pas_declares.hesitations === 1, 'analyse : ligne de pas lue')
ok(a.demandes_aide.length === 1, 'analyse : demande d\'aide lue')
ok(a.mesure.alertes_vues.includes('Impossible de continuer sans compte.'), 'analyse : alerte vue')
ok(a.mesure.etapes_superflues === 1, 'analyse : étapes superflues')

// 4. Consolidation: two personas, same verified quotation => one anomaly, frequency 2/2.
const pass = path.join(tmp, 'passage')
for (const p of ['p1', 'p2']) {
  const d = path.join(pass, p)
  mkdirSync(d, { recursive: true })
  for (const f of ['journal.jsonl', 'resultat.md']) writeFileSync(path.join(d, f), readFileSync(path.join(run, f)))
  writeFileSync(path.join(d, 'mesures.json'), L({ persona: p, secondes: 9 }))
  analyser(d)
}
execFileSync('node', [path.join(outils, 'consolider.mjs'), pass], { stdio: 'pipe' })
const an = JSON.parse(readFileSync(path.join(pass, 'anomalies.json'), 'utf8'))
const bloq = an.find((x) => x.gravite === 'bloquant')
ok(bloq && bloq.frequence === '2/2' && bloq.confiance === 'haute' && bloq.statut === 'observé', 'consolidation : doublon fusionné, fréquence 2/2, confiance haute')
ok(bloq && bloq.etapes_reproduction.some((e) => e.includes('Voir les résultats')), 'consolidation : étapes de reproduction réelles')
ok(an.some((x) => x.statut === 'hypothèse'), 'consolidation : citation inventée = hypothèse')
ok(bloq && /^VP-[0-9a-f]{8}$/.test(bloq.id), 'consolidation : identifiant stable')

// 5. Comparison.
execFileSync('node', [path.join(outils, 'comparer.mjs'), pass, pass, '--sortie', path.join(tmp, 'cmp.json')], { stdio: 'pipe' })
const cmp = JSON.parse(readFileSync(path.join(tmp, 'cmp.json'), 'utf8'))
ok(cmp.nouvelles.length === 0 && cmp.persistantes.length === an.length, 'comparaison : identique => tout persiste')

// 6. Proxy: hide, replace, fake success, against a tiny local server.
const srv = http.createServer((q, s) => {
  if (q.url.startsWith('/api/items/7') && q.method === 'GET') return s.end(JSON.stringify({ id: 7, status: 'open' }))
  if (q.url.startsWith('/api/items')) return s.end(JSON.stringify([{ id: 'A-1' }, { id: 'B-2' }]))
  if (q.url === '/app.js') { s.setHeader('content-type', 'text/javascript'); return s.end('label="Voir"') }
  s.statusCode = 500; s.end('reached')
}).listen(0, '127.0.0.1')
await new Promise((res) => srv.once('listening', res))
const port = srv.address().port
const def = path.join(tmp, 'def.json')
writeFileSync(def, L({ masquer: [{ chemin: '^/api/items$', contient: 'B-2' }], remplacer: [{ chemin: '\\.js$', de: 'Voir', vers: 'Jargon' }], fauxSucces: [{ methode: 'POST', chemin: '^/api/items/[^/]+/decision$', corps: 'relire-puis-modifier' }] }))
const pp = port + 1
const px = spawn('node', [path.join(outils, 'proxy-defauts.mjs'), String(pp), `http://127.0.0.1:${port}`, def], { stdio: 'ignore' })
await new Promise((res) => setTimeout(res, 800))
const get = (u, m = 'GET') => new Promise((res) => { const q = http.request(`http://127.0.0.1:${pp}${u}`, { method: m }, (s) => { let b = ''; s.on('data', (d) => { b += d }); s.on('end', () => res(b)) }); q.end(m === 'POST' ? '{"action":"defer"}' : undefined) })
ok(!(await get('/api/items')).includes('B-2'), 'proxy : élément masqué')
ok((await get('/app.js')).includes('Jargon'), 'proxy : libellé remplacé')
const fs = await get('/api/items/7/decision', 'POST')
ok(fs.includes('"decided"') && !fs.includes('reached'), 'proxy : faux succès sans toucher au produit')
px.kill(); srv.close()

rmSync(tmp, { recursive: true, force: true })
console.log(ko ? `${ko} échec(s)` : 'tout est vert')
process.exit(ko ? 1 : 0)
