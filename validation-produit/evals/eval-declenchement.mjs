// Trigger evaluation of the skill description (idea from anthropics/skills skill-creator,
// Apache-2.0; rewritten in Node because its runner relies on select() on pipes, which
// Windows lacks). For each query: a headless `claude -p` from an empty folder, only the Skill
// tool offered; "triggered" = the first tool call is Skill with this skill's name. The process
// is stopped at the first tool call to keep the cost low.
//   node eval-declenchement.mjs [--runs 1] [--modele sonnet] [--skill validation-produit]
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const a = {}
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, '')] = process.argv[i + 1]
const skill = a.skill || 'validation-produit'
const runs = Number(a.runs || 1)
const cas = JSON.parse(readFileSync(path.join(here, 'declenchement.json'), 'utf8'))

function essai(query) {
  return new Promise((resolve) => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'vp-trig-'))
    const env = { ...process.env }
    delete env.CLAUDECODE
    const c = spawn('claude', ['-p', query, '--model', a.modele || 'sonnet', '--tools', 'Skill', '--strict-mcp-config',
      '--permission-prompts', 'none', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let buf = ''
    let verdict = null
    const fin = (v) => { if (verdict !== null) return; verdict = v; try { c.kill() } catch {} }
    c.stdout.on('data', (d) => {
      buf += d
      let k
      while ((k = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, k); buf = buf.slice(k + 1)
        let j
        try { j = JSON.parse(line) } catch { continue }
        if (j.type === 'assistant') for (const b of j.message?.content || []) {
          if (b.type === 'tool_use') fin(b.name === 'Skill' && JSON.stringify(b.input || {}).includes(skill))
        }
        if (j.type === 'result') fin(false)
      }
    })
    const t = setTimeout(() => fin(false), 90000)
    c.on('exit', () => { clearTimeout(t); fin(verdict ?? false); try { rmSync(cwd, { recursive: true, force: true }) } catch {}; resolve(verdict) })
  })
}

const res = []
for (const x of cas) {
  let n = 0
  for (let r = 0; r < runs; r++) if (await essai(x.query)) n++
  const taux = n / runs
  res.push({ query: x.query, should_trigger: x.should_trigger, trigger_rate: taux, pass: x.should_trigger ? taux >= 0.5 : taux < 0.5 })
  console.error(`${res.at(-1).pass ? 'ok ' : 'KO '} ${x.should_trigger ? '+' : '-'} ${taux.toFixed(2)} ${x.query.slice(0, 70)}`)
}
const pos = res.filter((r) => r.should_trigger)
const neg = res.filter((r) => !r.should_trigger)
const summary = {
  total: res.length, reussis: res.filter((r) => r.pass).length,
  rappel: pos.filter((r) => r.pass).length / pos.length,
  faux_declenchements: neg.filter((r) => !r.pass).length,
}
const out = { skill, modele: a.modele || 'sonnet', runs, date: new Date().toISOString(), summary, results: res }
writeFileSync(path.join(here, 'resultats-declenchement.json'), JSON.stringify(out, null, 1))
console.log(JSON.stringify(summary))
