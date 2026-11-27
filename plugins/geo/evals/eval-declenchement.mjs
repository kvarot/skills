// Trigger evaluation of the geo plugin skills.
// Adapted from plugins/seo/evals/eval-declenchement.mjs (same author, MIT), itself adapted from
// validation-produit/evals/eval-declenchement.mjs and inspired by the anthropics/skills
// skill-creator runner (Apache-2.0). For each case: a headless `claude -p` from an empty folder,
// with this plugin loaded (--plugin-dir), built-in tools limited to Skill (--tools Skill) and no
// MCP server (--strict-mcp-config); tools the harness adds on its own may still be listed. Cases marked
// `deux_plugins: true` also load the sibling seo plugin, to check that the two plugins share
// requests correctly. Observed skill = the skill named by the first tool call if it is Skill on a
// geo* or seo* skill. A case passes when the observed skill equals `skill_attendu` (null = no
// geo* / seo* skill called); for `deux_plugins` cases the plugin is compared (geo-technique counts
// as geo). The process is stopped at the first tool call to keep the cost low.
//   node eval-declenchement.mjs [--runs 1] [--modele sonnet] [--skill geo,geo-technique]
//                               [--parallele 4] [--sortie resultats.json]
// --skill keeps only the cases expecting one of these skills, plus every negative case.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.resolve(here, '..')
const pluginSeo = path.resolve(here, '../../seo')
const a = {}
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
const runs = Number(a.runs || 1)
const modele = a.modele || 'sonnet'
const parallele = Math.max(1, Number(a.parallele || 4))
const filtre = a.skill ? a.skill.split(',').map((s) => s.trim()).filter(Boolean) : null
const tous = JSON.parse(readFileSync(path.join(here, 'declenchement.json'), 'utf8'))
const cas = filtre ? tous.filter((x) => x.skill_attendu === null || filtre.includes(x.skill_attendu)) : tous

// Name of the plugin skill called, or null when the call is not a geo* / seo* skill.
// Accepts "geo:geo-contenu" (namespaced) and "geo-contenu"; "geo" never matches "geo-contenu".
function skillObserve(input) {
  const brut = String(input?.skill ?? input?.name ?? input?.command ?? '').trim().replace(/^\//, '')
  const nom = brut.replace(/^(geo|seo):/, '')
  return /^(geo|seo)(-[a-z]+)*$/.test(nom) ? nom : null
}
const famille = (s) => (s === null ? null : s.split('-')[0])
const reussi = (x, observe) => (x.deux_plugins ? famille(observe) === famille(x.skill_attendu) : observe === x.skill_attendu)

function essai(query, deuxPlugins) {
  return new Promise((resolve) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'geo-trig-'))
    const env = { ...process.env }
    delete env.CLAUDECODE
    const plugins = deuxPlugins ? ['--plugin-dir', pluginDir, '--plugin-dir', pluginSeo] : ['--plugin-dir', pluginDir]
    const c = spawn('claude', ['-p', query, '--model', modele, ...plugins, '--tools', 'Skill',
      '--strict-mcp-config', '--permission-prompts', 'none', '--no-session-persistence',
      '--output-format', 'stream-json', '--verbose'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    // statut: 'ok' (a tool call or a normal end was seen), 'timeout', or 'erreur' (spawn error,
    // crash, or an error result). Only 'ok' trials are scored.
    let buf = ''
    let fini = false
    let observe = null
    let brut = null
    let statut = 'erreur'
    // Token usage of the first assistant turn(s), for the cost note of the results file.
    const jetons = { entree: 0, cache_ecrit: 0, cache_lu: 0, sortie: 0 }
    const fin = (s, v, b) => { if (fini) return; fini = true; statut = s; observe = v; brut = b; try { c.kill() } catch {} }
    let regle = false
    const t = setTimeout(() => fin('timeout', null, 'timeout'), 120000)
    const clore = (raison) => {
      if (regle) return
      regle = true
      clearTimeout(t); fin('erreur', null, raison)
      try { rmSync(cwd, { recursive: true, force: true }) } catch {}
      resolve({ statut, observe, brut, jetons })
    }
    c.stdout.on('data', (d) => {
      buf += d
      let k
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k); buf = buf.slice(k + 1)
        let j
        try { j = JSON.parse(line) } catch { continue }
        const u = j.type === 'assistant' ? j.message?.usage : null
        if (u && !fini) {
          jetons.entree += u.input_tokens || 0; jetons.cache_ecrit += u.cache_creation_input_tokens || 0
          jetons.cache_lu += u.cache_read_input_tokens || 0; jetons.sortie += u.output_tokens || 0
        }
        if (j.type === 'assistant') for (const b of j.message?.content || []) {
          // Only the tool and skill names are kept: other inputs may hold local paths.
          if (b.type === 'tool_use') fin('ok', b.name === 'Skill' ? skillObserve(b.input) : null, b.name === 'Skill' ? 'Skill ' + String(b.input?.skill ?? '') : b.name)
        }
        if (j.type === 'result') {
          if (j.is_error || (j.subtype && j.subtype !== 'success')) fin('erreur', null, 'result ' + (j.subtype || 'error'))
          else fin('ok', null, null)
        }
      }
    })
    c.stderr.on('data', () => {})
    c.on('error', (e) => clore('spawn ' + (e.code || e.message)))
    c.on('close', (code) => clore('exit ' + code))
  })
}

async function evaluer(x) {
  const essais = []
  for (let r = 0; r < runs; r++) essais.push(await essai(x.query, x.deux_plugins === true))
  const valides = essais.filter((e) => e.statut === 'ok')
  const base = { query: x.query, skill_attendu: x.skill_attendu, deux_plugins: x.deux_plugins === true, essais: essais.map((e) => ({ statut: e.statut, appel: e.brut, jetons: e.jetons })) }
  if (!valides.length) {
    // No usable trial: the case is reported but left out of every score.
    const statut = essais.some((e) => e.statut === 'timeout') ? 'timeout' : 'erreur'
    console.error(`${statut.toUpperCase().padEnd(3)} ${String(x.skill_attendu).padEnd(24)} -> ${'?'.padEnd(24)} ${x.query.slice(0, 60)}`)
    return { ...base, statut, observe: null, taux: null, pass: null }
  }
  const bons = valides.filter((e) => reussi(x, e.observe)).length
  // Majority observation, used for the precision count.
  const compte = {}
  for (const e of valides) compte[e.observe] = (compte[e.observe] || 0) + 1
  const majoritaire = Object.entries(compte).sort((p, q) => q[1] - p[1])[0][0]
  const r = {
    ...base, statut: 'ok', observe: majoritaire === 'null' ? null : majoritaire,
    taux: bons / valides.length, pass: bons / valides.length >= 0.5,
  }
  console.error(`${r.pass ? 'ok ' : 'KO '} ${(x.deux_plugins ? '2p ' : '') + String(x.skill_attendu).padEnd(24)} -> ${String(r.observe).padEnd(24)} ${x.query.slice(0, 60)}`)
  return r
}

const debut = Date.now()
const res = new Array(cas.length)
let suivant = 0
await Promise.all(Array.from({ length: Math.min(parallele, cas.length) }, async () => {
  while (suivant < cas.length) { const i = suivant++; res[i] = await evaluer(cas[i]) }
}))

const ratio = (n, d) => (d ? Number((n / d).toFixed(3)) : null)
const scores = res.filter((r) => r.statut === 'ok')
const exclus = { erreur: res.filter((r) => r.statut === 'erreur').length, timeout: res.filter((r) => r.statut === 'timeout').length }
function mesures(lignes) {
  const pos = lignes.filter((r) => r.skill_attendu !== null)
  const predits = lignes.filter((r) => r.observe !== null)
  return {
    cas: lignes.length, reussis: lignes.filter((r) => r.pass).length,
    rappel: ratio(pos.filter((r) => r.pass).length, pos.length),
    precision: ratio(predits.filter((r) => r.observe === r.skill_attendu).length, predits.length),
    faux_declenchements: lignes.filter((r) => r.skill_attendu === null && r.observe !== null).length,
  }
}
const parSkill = {}
for (const s of [...new Set(scores.map((r) => r.skill_attendu).concat(scores.map((r) => r.observe)).filter(Boolean))].sort()) {
  const attendus = scores.filter((r) => r.skill_attendu === s)
  const predits = scores.filter((r) => r.observe === s)
  parSkill[s] = {
    cas: attendus.length,
    rappel: ratio(attendus.filter((r) => r.observe === s).length, attendus.length),
    precision: ratio(predits.filter((r) => r.skill_attendu === s).length, predits.length),
  }
}
// Categories of the task thresholds: geo positives (one plugin), negatives, two-plugin cases.
const unique = scores.filter((r) => !r.deux_plugins)
const positifs = unique.filter((r) => r.skill_attendu !== null)
const negatifs = unique.filter((r) => r.skill_attendu === null)
const deux = scores.filter((r) => r.deux_plugins)
const categories = {
  positifs: { cas: positifs.length, reussis: positifs.filter((r) => r.pass).length, taux: ratio(positifs.filter((r) => r.pass).length, positifs.length),
    vers_un_skill_geo: positifs.filter((r) => famille(r.observe) === 'geo').length },
  negatifs: { cas: negatifs.length, declenches: negatifs.filter((r) => r.observe !== null).length },
  deux_plugins: { cas: deux.length, reussis: deux.filter((r) => r.pass).length },
}
const jetons = { entree: 0, cache_ecrit: 0, cache_lu: 0, sortie: 0 }
for (const r of res) for (const e of r.essais) for (const k of Object.keys(jetons)) jetons[k] += e.jetons?.[k] || 0
const summary = { total: res.length, ...mesures(unique), exclus, categories, jetons, par_skill: parSkill }
// Earlier runs kept in the same results file (`historique`), so a re-run never erases them.
const fichierSortie = a.sortie ? path.resolve(a.sortie) : path.join(here, 'resultats-declenchement.json')
let historique = []
try {
  const avant = JSON.parse(readFileSync(fichierSortie, 'utf8'))
  historique = Array.isArray(avant.historique) ? avant.historique : []
  if (avant.summary) historique.push({ modele: avant.modele, runs: avant.runs, date: avant.date, duree_s: avant.duree_s, summary: avant.summary,
    echecs: (avant.results || []).filter((r) => r.pass === false).map((r) => ({ query: r.query, skill_attendu: r.skill_attendu, observe: r.observe })) })
} catch {}
const out = { filtre, modele, runs, date: new Date().toISOString(), duree_s: Math.round((Date.now() - debut) / 1000), summary, results: res, historique }
writeFileSync(fichierSortie, JSON.stringify(out, null, 1))
console.log(JSON.stringify(summary, null, 1))
if (exclus.erreur || exclus.timeout) process.exitCode = 1
