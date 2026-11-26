// Minimal stdio MCP server used by eval-fixtures.mjs as --permission-prompt-tool.
// Headless sessions cannot answer the prompt Claude Code shows before writing under `.claude/`
// (a protected folder). A developer would approve the plugin's own files there; this tool does
// the same and nothing more: it allows Write / Edit of files under <root>/.claude/seo/ and denies
// every other request that reaches a prompt (anything not already allowed by --allowedTools).
//   node permission-seo.mjs <root>
import path from 'node:path'
import { createInterface } from 'node:readline'

const racine = path.resolve(process.argv[2] || process.cwd())
const zone = path.join(racine, '.claude', 'seo') + path.sep
const dansZone = (f) => typeof f === 'string' && path.resolve(racine, f).toLowerCase().startsWith(zone.toLowerCase())

function decider(nom, input) {
  if (['Write', 'Edit', 'MultiEdit'].includes(nom) && dansZone(input?.file_path)) return { behavior: 'allow', updatedInput: input }
  return { behavior: 'deny', message: 'Refusé par l\'évaluation : seules les écritures sous .claude/seo/ sont approuvées ici.' }
}

const envoyer = (o) => process.stdout.write(JSON.stringify(o) + '\n')
createInterface({ input: process.stdin }).on('line', (l) => {
  let m
  try { m = JSON.parse(l) } catch { return }
  if (m.id === undefined) return
  if (m.method === 'initialize') {
    envoyer({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'permission-seo', version: '1.0.0' } } })
  } else if (m.method === 'tools/list') {
    envoyer({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'approuver', description: 'Permission prompt answerer of the seo evaluation harness.', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } }] } })
  } else if (m.method === 'tools/call') {
    const { tool_name, input } = m.params?.arguments ?? {}
    envoyer({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(decider(tool_name, input)) }] } })
  } else {
    envoyer({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'méthode inconnue' } })
  }
})
