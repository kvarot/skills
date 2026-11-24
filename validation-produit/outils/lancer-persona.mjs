// Runs ONE simulated user in its own `claude -p` process, isolated from any source code:
// no built-in tool (--tools ""), one browser MCP server whose network is limited to the
// product's origin, a PreToolUse hook (garde-url.py) that refuses anything else and refuses
// on any error, an empty working folder, no user/project settings, no CLAUDE.md.
//
//   node lancer-persona.mjs --persona p.md --parcours j.md --url <start url> --dossier <empty run folder>
//        [--modele sonnet] [--budget-usd 3] [--minutes 15] [--masquer <text to redact>]...
//
// Writes into --dossier: journal.jsonl (redacted stream-json), resultat.md (final answer),
// mesures.json (tool calls, refusals, turns, tokens, duration, cost equivalent).
// The browser profile is temporary (--isolated) and deleted when the server stops.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { lirePersona } from './persona.mjs'
import { analyser } from './analyser-journal.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const args = {}
const masks = []
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i].replace(/^--/, '')
  if (k === 'masquer') masks.push(process.argv[i + 1])
  else args[k] = process.argv[i + 1]
}
for (const k of ['persona', 'parcours', 'url', 'dossier']) {
  if (!args[k]) { console.error('missing --' + k); process.exit(2) }
}
const origin = new URL(args.url).origin
const dir = path.resolve(args.dossier)
mkdirSync(dir, { recursive: true })
if (readdirSync(dir).length) { console.error('--dossier must be empty'); process.exit(2) }
const conf = dir + '.conf'
mkdirSync(conf, { recursive: true })

// The persona card decides viewport, tools (keyboard-only removes pointer tools) and the
// patience budget; all three are enforced (MCP flags, allow-list, hook), not requested.
const persona = lirePersona(args.persona)
const reglages = persona.reglages
const S = 'mcp__navigateur__'
const tools = reglages.outils.map((t) => S + t)

// Contamination check: the journey must state a user goal, not the way through the product.
// Only the goal part is checked; a "## Réponse" section (answer format) may name fields.
const parcoursBrut = readFileSync(args.parcours, 'utf8')
const objectif = parcoursBrut.split(/^## Réponse/m)[0]
const fuites = []
if (/#\/|\/api\/|`/.test(objectif.replaceAll('{URL}', ''))) fuites.push('chemin interne, route ou code dans le parcours')
if (args.interdits) {
  const termes = readFileSync(args.interdits, 'utf8').split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))
  const bas = (objectif + '\n' + persona.corps + '\n' + JSON.stringify(persona.meta)).toLowerCase()
  for (const t of termes) if (bas.includes(t.toLowerCase())) fuites.push('terme interne : ' + t)
}
if (fuites.length) {
  console.error('REFUS : le parcours ou la fiche donnent des indices internes au persona :\n- ' + fuites.join('\n- '))
  process.exit(2)
}

const mcp = {
  mcpServers: {
    navigateur: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@1.14.0', '--isolated', '--headless',
        '--fileNavigations=false', '--javascriptEvaluation=false',
        '--categoryMemory=false', '--categoryNetwork=false', '--categoryPerformance=false',
        '--categoryEmulation=false', '--usageStatistics=false', '--performanceCrux=false',
        `--allowedUrlPattern=${origin}/*`, '--filesystemRoot', dir, '--viewport', reglages.viewport],
      env: { CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1', CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1', CHROME_DEVTOOLS_MCP_NO_CONFIG_DISCOVERY: '1' },
    },
  },
}
const py = process.env.PYTHON || 'python'
const settings = {
  hooks: {
    PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: `"${py}" -I -X utf8 "${path.join(here, 'garde-url.py')}"` }] }],
  },
}
writeFileSync(path.join(conf, 'mcp.json'), JSON.stringify(mcp, null, 1))
writeFileSync(path.join(conf, 'settings.json'), JSON.stringify(settings, null, 1))

const regles = readFileSync(path.join(here, '..', 'modeles', 'regles-persona.md'), 'utf8')
const fiche = Object.entries(persona.meta).filter(([k]) => !['id', 'role'].includes(k))
  .map(([k, v]) => `- ${k} : ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n')
// role "temoin" = control group for skill evaluation: same isolation, no persona, no rules.
const system = persona.meta.role === 'temoin'
  ? 'Tu es un assistant qui dispose d’un navigateur. ' + persona.corps
  : `${regles}\n\n# Ta fiche\n\n${fiche}\n\n${persona.corps}\n\n` +
    `Conditions imposées par le banc (tu ne peux pas les changer) : écran ${reglages.viewport}, ` +
    `${reglages.budget_actions} interactions au plus. ${reglages.notes.join('. ')}`
const task = parcoursBrut.replaceAll('{URL}', args.url)

const cli = ['-p', '--model', args.modele || 'sonnet', '--tools', '', '--strict-mcp-config',
  '--mcp-config', path.join(conf, 'mcp.json'), '--setting-sources', '', '--settings', path.join(conf, 'settings.json'),
  '--allowedTools', tools.join(','), '--permission-prompts', 'none', '--no-session-persistence',
  '--max-budget-usd', args['budget-usd'] || '3', '--system-prompt', system,
  '--output-format', 'stream-json', '--verbose', task]

const env = { ...process.env, GARDE_ORIGINE: origin, GARDE_OUTILS: tools.join(','), CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
  GARDE_COMPTEUR: path.join(conf, 'compteur'), GARDE_MAX_ACTIONS: String(reglages.budget_actions) }
const t0 = Date.now()
const child = spawn('claude', cli, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
let out = ''
let err = ''
child.stdout.on('data', (c) => { out += c })
child.stderr.on('data', (c) => { err += c })
const limit = setTimeout(() => { child.kill(); err += '\nARRÊT : limite de temps' }, Number(args.minutes || 15) * 60000)
child.on('exit', (code) => {
  clearTimeout(limit)
  let log = out
  for (const m of masks) if (m) log = log.split(m).join('<masqué>')
  log = log.split(dir).join('<dossier>').split(dir.replaceAll('\\', '/')).join('<dossier>').split(dir.replaceAll('\\', '\\\\')).join('<dossier>')
  // No absolute home path ever leaves the run (Windows and POSIX forms, JSON-escaped or not).
  log = log.replace(/[A-Za-z]:(\\\\|\\|\/)(Users|users)(\\\\|\\|\/)[^\\/"'\s<>]+/g, '<home>').replace(/\/(home|Users)\/[^/"'\s<>]+/g, '<home>')
    .replace(/[A-Za-z]--Users-[^\\/"'\s<>]+/g, '<projet>')
  const user = os.userInfo().username
  if (user && user.length > 2) log = log.replace(new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '<utilisateur>')
  writeFileSync(path.join(dir, 'journal.jsonl'), log)
  const m = { code, secondes: Math.round((Date.now() - t0) / 1000), appels: {}, refus: 0, erreurs_outil: 0, tours: null, cout_equivalent_usd: null, tokens: null, fin: null }
  let result = ''
  for (const line of log.split('\n')) {
    let j
    try { j = JSON.parse(line) } catch { continue }
    if (j.type === 'assistant') for (const c of j.message.content || []) if (c.type === 'tool_use') m.appels[c.name] = (m.appels[c.name] || 0) + 1
    if (j.type === 'user' && Array.isArray(j.message?.content)) for (const c of j.message.content) {
      if (c.type !== 'tool_result') continue
      const t = JSON.stringify(c.content || '')
      if (t.includes('REFUSÉ par garde-url')) m.refus++
      else if (c.is_error) m.erreurs_outil++
    }
    if (j.type === 'result') {
      result = j.result || ''
      m.tours = j.num_turns; m.cout_equivalent_usd = j.total_cost_usd; m.fin = j.subtype
      const u = j.usage || {}
      m.tokens = { entree: u.input_tokens, sortie: u.output_tokens, cache_lu: u.cache_read_input_tokens, cache_ecrit: u.cache_creation_input_tokens }
    }
  }
  m.actions = Object.values(m.appels).reduce((a, b) => a + b, 0)
  writeFileSync(path.join(dir, 'resultat.md'), result || '(pas de réponse finale)\n' + err.slice(-2000))
  m.persona = persona.meta.id
  m.reglages_imposes = reglages
  writeFileSync(path.join(dir, 'mesures.json'), JSON.stringify(m, null, 1))
  // Deterministic analysis: behaviour metrics, citation check, step lines (analyse.json).
  try { analyser(dir) } catch (e) { writeFileSync(path.join(dir, 'analyse-erreur.txt'), String(e.message)) }
  console.log(JSON.stringify(m))
})
