// Minimal YAML front matter parser (scalars, lists, nested objects on 2 spaces).
// Adapted from validation-produit/outils/persona.mjs (same author).
export function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) throw new Error('front matter --- missing')
  const lines = m[1].split(/\r?\n/)
  const root = {}
  let key = null
  let sub = null
  const scalar = (v) => {
    v = v.trim()
    if (v === '') return ''
    if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== '')
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
    if (v === 'true' || v === 'oui') return true
    if (v === 'false' || v === 'non') return false
    return v.replace(/^["']|["']$/g, '')
  }
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.match(/^ */)[0].length
    const line = raw.trim()
    if (line.startsWith('- ')) {
      const target = sub && indent >= 4 ? root[key][sub] : root[key]
      if (Array.isArray(target)) target.push(scalar(line.slice(2)))
      else if (sub && indent >= 4) root[key][sub] = [scalar(line.slice(2))]
      else root[key] = [scalar(line.slice(2))]
      continue
    }
    const kv = line.match(/^([\w.-]+):\s*(.*)$/)
    if (!kv) throw new Error('unreadable line: ' + line)
    if (indent === 0) {
      key = kv[1]; sub = null
      root[key] = kv[2] === '' ? {} : scalar(kv[2])
    } else {
      if (typeof root[key] !== 'object' || Array.isArray(root[key])) root[key] = {}
      sub = kv[1]
      root[key][sub] = kv[2] === '' ? [] : scalar(kv[2])
    }
  }
  // Empty maps that received list items were converted above; empty {} with no content stay {}.
  return { meta: root, corps: m[2].trim() }
}
