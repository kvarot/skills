// Generic campaign runner of validation-produit. Product specifics live in an adapter JSON
// (references/adaptateur.md). Resumable: campagne.json records every run; a re-run skips
// what is done. Bounded: parallelism, per-run and total budgets, mode decides how many agents.
//
//   node campagne.mjs --adaptateur a.json --sortie <folder> [--mode rapide|standard|approfondi|pre-release]
//        [--personas a,b] [--parcours x,y] [--essais 2] [--paralleles 3] [--budget-total-usd 15]
//        [--etapes passages,consolider,expert,arbitre,contre-expertise] [--modele sonnet]
//
// Adapter JSON (paths relative to the adapter file):
// { "produit": "demo", "binaire": "bin/app.exe",                       // optional, passed as {bin}
//   "verifier_build": "bin/build.json",                                 // optional: refuse unless {ok:true}
//   "instance": {"commande": ["node","start.mjs","{travail}","{port}"], "url_regex": "(http://127\\.0\\.0\\.1:\\d+/\\S*)", "masquer_regex": "token=([0-9a-f]+)"},
//   "verite": {"commande": ["node","valider.mjs","{bin}","{travail}/data","{run}"]},   // optional
//   "parcours": {"premier-lancement": "parcours.md"}, "personas": ["debutant", ...] or "dossier/",
//   "defauts": "defauts.json", "interdits": "interdits.txt", "aide_regex": "aide|help",
//   "chemin_reference": {"premier-lancement": 8}, "depot_produit": "../repo" }       // for the expert
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyser } from './analyser-journal.mjs'
import { lirePersona, ecrireFiche } from './persona.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const skill = path.resolve(here, '..')
const a = {}
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
const adFile = path.resolve(a.adaptateur)
const ad = JSON.parse(readFileSync(adFile, 'utf8'))
const rel = (p) => (p ? path.resolve(path.dirname(adFile), p) : p)
const out = path.resolve(a.sortie)
mkdirSync(out, { recursive: true })

const MODES = {
  rapide: { personas: 1, essais: 1, passages: ['propre'], expert: false, arbitre: false, contre: false },
  standard: { personas: 3, essais: 1, passages: ['propre', 'seme'], expert: false, arbitre: true, contre: false },
  approfondi: { personas: 4, essais: 2, passages: ['propre', 'seme'], expert: true, arbitre: true, contre: true },
  'pre-release': { personas: 99, essais: 2, passages: ['propre', 'seme'], expert: true, arbitre: true, contre: true },
}
const mode = MODES[a.mode || 'standard']
if (!mode) { console.error('mode inconnu'); process.exit(2) }
if (ad.verifier_build) {
  const b = existsSync(rel(ad.verifier_build)) ? JSON.parse(readFileSync(rel(ad.verifier_build), 'utf8')) : null
  if (!b || !b.ok) { console.error('REFUS : construction non prouvée (' + ad.verifier_build + ')'); process.exit(2) }
}
const dossierPersonas = typeof ad.personas === 'string' ? rel(ad.personas) : path.join(skill, 'modeles', 'personas')
const tousPersonas = Array.isArray(ad.personas) ? ad.personas : readdirSync(dossierPersonas).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter((p) => p !== 'rejoueur')
const personas = a.personas ? a.personas.split(',') : tousPersonas.slice(0, mode.personas)
const parcours = a.parcours ? a.parcours.split(',') : Object.keys(ad.parcours).slice(0, a.mode === 'pre-release' ? 99 : 1)
const essais = Number(a.essais || mode.essais)
const passages = (mode.passages).filter((p) => p === 'propre' || ad.defauts)
const etapes = (a.etapes || 'passages,consolider,expert,arbitre,contre-expertise').split(',')
const paralleles = Number(a.paralleles || 3)
const budgetTotal = Number(a['budget-total-usd'] || 15)

// Manifest: the plan and the state of every run. Re-running resumes.
const manFile = path.join(out, 'campagne.json')
const man = existsSync(manFile) ? JSON.parse(readFileSync(manFile, 'utf8')) : { cree_le: new Date().toISOString(), mode: a.mode || 'standard', produit: ad.produit, runs: [] }
for (const ps of passages) for (const pc of parcours) for (const p of personas) for (let e = 1; e <= essais; e++) {
  const nomP = path.basename(p).replace(/\.md$/, '')
  const id = `${ps}/${pc}/${nomP}${essais > 1 ? '-e' + e : ''}`
  // A card given by path is stored relative to the campaign folder: no absolute path on disk.
  const pStock = p.endsWith('.md') ? path.relative(out, path.resolve(p)) : p
  if (!man.runs.find((r) => r.id === id)) man.runs.push({ id, passage: ps, parcours: pc, persona: pStock, essai: e, statut: 'a_faire' })
}
const save = () => writeFileSync(manFile, JSON.stringify(man, null, 1))
save()
const depense = () => man.runs.reduce((s, r) => s + (r.cout_usd || 0), 0)

function killTree(pid) {
  try { if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-pid) } catch {}
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
    let o = ''
    c.stdout.on('data', (d) => { o += d }); c.stderr.on('data', (d) => { o += d })
    c.on('exit', (code) => resolve({ code, out: o }))
  })
}
const subst = (arr, v) => arr.map((x) => String(x).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? `{${k}}`)))

function demarrer(travail, port) {
  return new Promise((resolve, reject) => {
    const cmd = subst(ad.instance.commande, { travail, port, bin: rel(ad.binaire) || '' })
    // Adapter env values may use {bin}, {travail}, {port}.
    const envAd = Object.fromEntries(Object.entries(ad.instance.env || {}).map(([k, v]) => [k, subst([v], { travail, port, bin: rel(ad.binaire) || '' })[0]]))
    const c = spawn(cmd[0], cmd.slice(1), { cwd: path.dirname(adFile), env: { ...process.env, ...envAd }, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    const t = setTimeout(() => { killTree(c.pid); reject(new Error('instance non démarrée')) }, 90000)
    const lire = (d) => {
      buf += d
      const m = buf.match(new RegExp(ad.instance.url_regex))
      if (m) { clearTimeout(t); const s = ad.instance.masquer_regex ? (buf.match(new RegExp(ad.instance.masquer_regex)) || [])[1] : null; resolve({ proc: c, url: m[1], secret: s }) }
    }
    c.stdout.on('data', lire); c.stderr.on('data', lire)
    c.on('exit', () => { clearTimeout(t); reject(new Error('instance arrêtée : ' + buf.slice(-200))) })
  })
}

async function unRun(r, slot) {
  const dir = path.join(out, r.id)
  const travail = path.join(out, '.tmp', r.id.replace(/\//g, '_'))
  rmSync(dir, { recursive: true, force: true }); rmSync(dir + '.conf', { recursive: true, force: true }); rmSync(travail, { recursive: true, force: true })
  mkdirSync(path.dirname(dir), { recursive: true }); mkdirSync(travail, { recursive: true })
  const base = Number(a['port-base'] || 18900) + slot * 2
  let inst, px
  try {
    inst = await demarrer(travail, base)
    const cible = new URL(inst.url)
    const pport = base + 1
    const pargs = [path.join(here, 'proxy-defauts.mjs'), String(pport), cible.origin]
    if (r.passage === 'seme') pargs.push(rel(ad.defauts))
    px = spawn('node', pargs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let pxlog = ''
    px.stdout.on('data', (d) => { pxlog += d })
    await new Promise((res) => setTimeout(res, 1200))
    const url = inst.url.replace(cible.origin, `http://127.0.0.1:${pport}`)
    const persona = r.persona.endsWith('.md') ? path.resolve(out, r.persona) : path.join(dossierPersonas, r.persona + '.md')
    const fichierParcours = r.parcoursFichier ? path.resolve(out, r.parcoursFichier) : rel(ad.parcours[r.parcours])
    const largs = [path.join(here, 'lancer-persona.mjs'), '--persona', fs(persona), '--parcours', fichierParcours, '--url', url, '--dossier', dir,
      '--modele', a.modele || 'sonnet', '--budget-usd', a['budget-usd'] || '3', '--minutes', a.minutes || '15', '--masquer', travail, '--masquer', travail.replaceAll('\\', '\\\\')]
    if (inst.secret) largs.push('--masquer', inst.secret)
    // The replayer's steps name the screens on purpose: no anti-leak check for replays.
    if (ad.interdits && !r.contre) largs.push('--interdits', rel(ad.interdits))
    const lr = await run('node', largs)
    if (lr.code === 2) throw new Error(lr.out.trim().slice(-400))
    analyser(dir, { aide: ad.aide_regex, cheminReference: (ad.chemin_reference || {})[r.parcours] })
    if (ad.verite) {
      const v = subst(ad.verite.commande, { bin: rel(ad.binaire) || '', travail, run: dir })
      await run(v[0], v.slice(1), { cwd: path.dirname(adFile) })
    }
    const hits = (pxlog.trim().split('\n').filter((l) => l.startsWith('hits ')).pop() || 'hits {}').slice(5)
    writeFileSync(path.join(dir, 'proxy.json'), hits)
    const m = JSON.parse(readFileSync(path.join(dir, 'mesures.json'), 'utf8'))
    delete r.erreur
    Object.assign(r, { statut: 'fait', cout_usd: m.cout_equivalent_usd || 0, secondes: m.secondes, fin: m.fin })
  } catch (e) {
    Object.assign(r, { statut: 'echec', erreur: String(e.message).slice(0, 400) })
  } finally {
    if (px) killTree(px.pid)
    if (inst) killTree(inst.proc.pid)
    await new Promise((res) => setTimeout(res, 1000))
    rmSync(travail, { recursive: true, force: true })
    rmSync(dir + '.conf', { recursive: true, force: true })
    save()
  }
}
function fs(p) { return p }

async function executer(liste) {
  let i = 0
  const worker = async (slot) => {
    while (i < liste.length) {
      const r = liste[i++]
      if (depense() >= budgetTotal) { r.statut = 'saute_budget'; save(); continue }
      r.statut = 'en_cours'; save()
      await unRun(r, slot)
    }
  }
  await Promise.all(Array.from({ length: Math.min(paralleles, liste.length) }, (_, s) => worker(s)))
}

const t0 = Date.now()
if (etapes.includes('passages')) await executer(man.runs.filter((r) => r.statut !== 'fait' && !r.contre))

// Consolidation per passage/journey folder (deterministic).
const dossiersPassage = [...new Set(man.runs.filter((r) => r.statut === 'fait' && !r.contre).map((r) => path.join(out, r.passage, r.parcours)))]
if (etapes.includes('consolider')) for (const d of dossiersPassage) await run('node', [path.join(here, 'consolider.mjs'), d, '--total-personas', String(personas.length * essais)])

// Expert (reads the product, never the personas' prompts) and arbiter (reads evidence only):
// both are separate claude -p processes whose final JSON block is saved by this runner.
async function agent(nom, cwd, outils, consigne, fichier) {
  const md = readFileSync(path.join(skill, 'agents', nom + '.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '')
  const r = await run('claude', ['-p', '--model', a.modele || 'sonnet', '--tools', outils, '--strict-mcp-config', '--setting-sources', '',
    '--allowedTools', outils, '--permission-prompts', 'none', '--no-session-persistence', '--max-budget-usd', '3', '--system-prompt', md,
    '--output-format', 'json', consigne], { cwd })
  let res = ''
  try { res = JSON.parse(r.out.slice(r.out.indexOf('{'))).result || '' } catch { res = r.out }
  const b = [...res.matchAll(/```json\s*([\s\S]*?)```/g)].pop()
  writeFileSync(fichier, b ? b[1] : JSON.stringify({ erreur: 'pas de bloc JSON', brut: res.slice(0, 2000) }))
  try { const j = JSON.parse(r.out.slice(r.out.indexOf('{'))); man.agents = [...(man.agents || []), { nom, cout_usd: j.total_cost_usd, secondes: Math.round((j.duration_ms || 0) / 1000) }]; save() } catch {}
}
if (etapes.includes('expert') && mode.expert && ad.depot_produit) {
  await agent('expert-produit', rel(ad.depot_produit), 'Read,Grep,Glob',
    `Parcours de la campagne :\n${parcours.map((p) => `- ${p} : ${readFileSync(rel(ad.parcours[p]), 'utf8').slice(0, 1500)}`).join('\n')}\nProduis expert.json (bloc json).`, path.join(out, 'expert.json'))
}
if (etapes.includes('arbitre') && mode.arbitre) {
  for (const d of dossiersPassage) {
    const exp = existsSync(path.join(out, 'expert.json')) ? '\nLis aussi ../../expert.json.' : ''
    const sem = d.includes(path.sep + 'seme' + path.sep) && ad.defauts ? `\nDéfauts semés dans ce passage (pour compter les détections) : ${readFileSync(rel(ad.defauts), 'utf8').slice(0, 1500)}` : ''
    await agent('arbitre', d, 'Read', `Dossier courant = un passage. Lis anomalies.json, synthese.json et, pour chaque persona, resultat.md, analyse.json, validation.json.${exp}${sem}\nProduis arbitrage.json (bloc json).`, path.join(d, 'arbitrage.json'))
  }
}
// Independent replay of anomalies the arbiter marks "à_rejouer" (or bloquant), by a separate
// verifier persona that only gets the written steps. Not the agent that found or fixed it.
if (etapes.includes('contre-expertise') && mode.contre) {
  const aRejouer = []
  for (const d of dossiersPassage) {
    const arb = existsSync(path.join(d, 'arbitrage.json')) ? JSON.parse(readFileSync(path.join(d, 'arbitrage.json'), 'utf8')) : { decisions: [] }
    const ano = JSON.parse(readFileSync(path.join(d, 'anomalies.json'), 'utf8'))
    for (const dec of (arb.decisions || []).filter((x) => x.statut === 'à_rejouer' || x.contre_expertise === 'requise').slice(0, 5)) {
      const an = ano.find((x) => x.id === dec.id)
      if (!an || !d.includes(path.sep + 'propre' + path.sep)) continue
      const pf = path.join(out, 'contre', an.id + '.parcours.md')
      mkdirSync(path.dirname(pf), { recursive: true })
      writeFileSync(pf, `Ouvre {URL}. Rejoue ces étapes dans l'ordre :\n${an.etapes_reproduction.map((e, i) => `${i + 1}. ${e.replace(/[«»]/g, '"')}`).join('\n')}\nPuis dis si ceci se reproduit : ${an.resultat_observe.replace(/[«»]/g, '"')}\nDans "specifique", donne {"reproduit": "oui | non | impossible à dire", "anomalie": "${an.id}"}.`)
      // The replayer inherits the screen, zoom and input mode of the persona that saw it.
      const rej = lirePersona(path.join(dossierPersonas, 'rejoueur.md'))
      const origine = (an.personas[0] || '').replace(/-e\d+$/, '')
      const fo = path.join(dossierPersonas, origine + '.md')
      if (existsSync(fo)) { const o = lirePersona(fo); rej.meta.environnement = o.meta.environnement; rej.meta.accessibilite = o.meta.accessibilite }
      const carte = path.join(out, 'contre', an.id + '.rejoueur.md')
      writeFileSync(carte, ecrireFiche(rej.meta, rej.corps))
      const r = { id: `contre/${an.id}`, passage: 'propre', parcours: path.basename(d), persona: path.relative(out, carte), essai: 1, statut: 'a_faire', contre: true, parcoursFichier: path.relative(out, pf) }
      if (!man.runs.find((x) => x.id === r.id)) { man.runs.push(r); aRejouer.push(r) }
    }
  }
  save()
  await executer(aRejouer.concat(man.runs.filter((r) => r.contre && r.statut !== 'fait' && !aRejouer.includes(r))))
}
man.duree_secondes = (man.duree_secondes || 0) + Math.round((Date.now() - t0) / 1000)
man.cout_total_usd = depense() + (man.agents || []).reduce((s, x) => s + (x.cout_usd || 0), 0)
save()
rmSync(path.join(out, '.tmp'), { recursive: true, force: true })
console.log(JSON.stringify({ runs: man.runs.map((r) => [r.id, r.statut, r.cout_usd ?? null]), agents: man.agents || [], cout_total_usd: man.cout_total_usd }, null, 1))
