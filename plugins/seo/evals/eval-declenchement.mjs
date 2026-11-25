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
    let buf = ''
    let fini = false
    let observe = null
    let brut = null
    const fin = (v, b) => { if (fini) return; fini = true; observe = v; brut = b; try { c.kill() } catch {} }
    c.stdout.on('data', (d) => {
      buf += d
      let k
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k); buf = buf.slice(k + 1)
        let j
        try { j = JSON.parse(line) } catch { continue }
        if (j.type === 'assistant') for (const b of j.message?.content || []) {
          // Only the tool and skill names are kept: other inputs may hold local paths.
          if (b.type === 'tool_use') fin(b.name === 'Skill' ? skillSeo(b.input) : null, b.name === 'Skill' ? 'Skill ' + String(b.input?.skill ?? '') : b.name)
        }
        if (j.type === 'result') fin(null, null)
      }
    })
    c.stderr.on('data', () => {})
    const t = setTimeout(() => fin(null, 'timeout'), 120000)
    c.on('exit', () => {
      clearTimeout(t); fin(null, null)
      try { rmSync(cwd, { recursive: true, force: true }) } catch {}
      resolve({ observe, brut })
    })
  })
}

async function evaluer(x) {
  const essais = []
  for (let r = 0; r < runs; r++) essais.push(await essai(x.query))
  const bons = essais.filter((e) => e.observe === x.skill_attendu).length
  // Majority observation, used for the precision count.
  const compte = {}
  for (const e of essais) compte[e.observe] = (compte[e.observe] || 0) + 1
  const majoritaire = Object.entries(compte).sort((p, q) => q[1] - p[1])[0][0]
  const r = {
    query: x.query, skill_attendu: x.skill_attendu, observe: majoritaire === 'null' ? null : majoritaire,
    taux: bons / runs, pass: bons / runs >= 0.5, appels: essais.map((e) => e.brut),
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
for (const s of [...new Set(res.map((r) => r.skill_attendu).concat(res.map((r) => r.observe)).filter(Boolean))].sort()) {
  const attendus = res.filter((r) => r.skill_attendu === s)
  const predits = res.filter((r) => r.observe === s)
  parSkill[s] = {
    cas: attendus.length,
    rappel: ratio(attendus.filter((r) => r.observe === s).length, attendus.length),
    precision: ratio(predits.filter((r) => r.skill_attendu === s).length, predits.length),
  }
}
const summary = { ...mesures(res), par_skill: parSkill }
const out = { filtre, modele, runs, date: new Date().toISOString(), summary, results: res }
writeFileSync(a.sortie ? path.resolve(a.sortie) : path.join(here, 'resultats-declenchement.json'), JSON.stringify(out, null, 1))
console.log(JSON.stringify(summary, null, 1))
