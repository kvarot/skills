// Trigger evaluation of the seo plugin skills. Adapted from
// validation-produit/evals/eval-declenchement.mjs (same repository), itself inspired by the
// anthropics/skills skill-creator runner (Apache-2.0). For each case: a headless `claude -p`
// from an empty folder, with this plugin loaded (--plugin-dir) and only the Skill tool offered.
// Observed skill = the skill named by the first tool call if it is Skill on a seo* skill.
// A case passes when the observed skill equals `skill_attendu` (null = no seo* skill called).
// The process is stopped at the first tool call to keep the cost low.
//   node eval-declenchement.mjs [--runs 1] [--modele sonnet] [--skill seo,seo-profil]
//                               [--parallele 4] [--sortie resultats.json]
// --skill keeps only the cases expecting one of these skills, plus every negative case.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = path.resolve(here, '..')
const a = {}
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
const runs = Number(a.runs || 1)
const modele = a.modele || 'sonnet'
const parallele = Math.max(1, Number(a.parallele || 4))
const filtre = a.skill ? a.skill.split(',').map((s) => s.trim()).filter(Boolean) : null
const tous = JSON.parse(readFileSync(path.join(here, 'declenchement.json'), 'utf8'))
const cas = filtre ? tous.filter((x) => x.skill_attendu === null || filtre.includes(x.skill_attendu)) : tous

// Name of the plugin skill called, or null when the call is not a seo* skill.
// Accepts "seo:seo-contenu" (namespaced) and "seo-contenu"; "seo" never matches "seo-contenu".
function skillSeo(input) {
  const brut = String(input?.skill ?? input?.name ?? input?.command ?? '').trim().replace(/^\//, '')
  const nom = brut.startsWith('seo:') ? brut.slice(4) : brut
  return /^seo(-[a-z]+)*$/.test(nom) ? nom : null
}

function essai(query) {
  return new Promise((resolve) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'seo-trig-'))
    const env = { ...process.env }
    delete env.CLAUDECODE
    const c = spawn('claude', ['-p', query, '--model', modele, '--plugin-dir', pluginDir, '--tools', 'Skill',
      '--strict-mcp-config', '--permission-prompts', 'none', '--no-session-persistence',
      '--output-format', 'stream-json', '--verbose'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    // statut: 'ok' (a tool call or a normal end was seen), 'timeout', or 'erreur' (spawn error,
    // crash, or an error result). Only 'ok' trials are scored.
    let buf = ''
    let fini = false
    let observe = null
    let brut = null
    let statut = 'erreur'
    const fin = (s, v, b) => { if (fini) return; fini = true; statut = s; observe = v; brut = b; try { c.kill() } catch {} }
    let regle = false
    const t = setTimeout(() => fin('timeout', null, 'timeout'), 120000)
    const clore = (raison) => {
      if (regle) return
      regle = true
      clearTimeout(t); fin('erreur', null, raison)
      try { rmSync(cwd, { recursive: true, force: true }) } catch {}
      resolve({ statut, observe, brut })
    }
    c.stdout.on('data', (d) => {
      buf += d
      let k
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k); buf = buf.slice(k + 1)
        let j
        try { j = JSON.parse(line) } catch { continue }
        if (j.type === 'assistant') for (const b of j.message?.content || []) {
          // Only the tool and skill names are kept: other inputs may hold local paths.
          if (b.type === 'tool_use') fin('ok', b.name === 'Skill' ? skillSeo(b.input) : null, b.name === 'Skill' ? 'Skill ' + String(b.input?.skill ?? '') : b.name)
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
  for (let r = 0; r < runs; r++) essais.push(await essai(x.query))
  const valides = essais.filter((e) => e.statut === 'ok')
  const base = { query: x.query, skill_attendu: x.skill_attendu, essais: essais.map((e) => ({ statut: e.statut, appel: e.brut })) }
  if (!valides.length) {
    // No usable trial: the case is reported but left out of every score.
    const statut = essais.some((e) => e.statut === 'timeout') ? 'timeout' : 'erreur'
    console.error(`${statut.toUpperCase().padEnd(3)} ${String(x.skill_attendu).padEnd(24)} -> ${'?'.padEnd(24)} ${x.query.slice(0, 60)}`)
    return { ...base, statut, observe: null, taux: null, pass: null }
  }
  const bons = valides.filter((e) => e.observe === x.skill_attendu).length
  // Majority observation, used for the precision count.
  const compte = {}
  for (const e of valides) compte[e.observe] = (compte[e.observe] || 0) + 1
  const majoritaire = Object.entries(compte).sort((p, q) => q[1] - p[1])[0][0]
  const r = {
    ...base, statut: 'ok', observe: majoritaire === 'null' ? null : majoritaire,
    taux: bons / valides.length, pass: bons / valides.length >= 0.5,
  }
  console.error(`${r.pass ? 'ok ' : 'KO '} ${String(x.skill_attendu).padEnd(24)} -> ${String(r.observe).padEnd(24)} ${x.query.slice(0, 60)}`)
  return r
}

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
const summary = { total: res.length, ...mesures(scores), exclus, par_skill: parSkill }
const out = { filtre, modele, runs, date: new Date().toISOString(), summary, results: res }
writeFileSync(a.sortie ? path.resolve(a.sortie) : path.join(here, 'resultats-declenchement.json'), JSON.stringify(out, null, 1))
console.log(JSON.stringify(summary, null, 1))
if (exclus.erreur || exclus.timeout) process.exitCode = 1
