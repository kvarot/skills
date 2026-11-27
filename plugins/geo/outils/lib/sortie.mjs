// Safe output helpers: JSON on stdout, bounded escaped excerpts, data directory, SQLite warning filter.
import path from 'node:path'

// Exit codes: 1 error, 2 finding threshold exceeded, 3 consent or budget missing.
export class ErreurGeo extends Error {
  constructor(message, code = 1) {
    super(message)
    this.name = 'ErreurGeo'
    this.code = code
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
// Control characters, zero-width, bidi, BOM, variation selectors, annotation and Unicode tag characters (u flag: astral ranges).
const CONTROLE = /[\u0000-\u001f\u007f-\u009f]/gu
const INVISIBLE = /[\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu

// Untrusted page text never leaves as raw text: stripped, escaped, truncated, flagged.
export function extrait(texte, max = 280) {
  const propre = String(texte ?? '')
    .replace(/[\t\n\r]+/g, ' ')
    .replace(CONTROLE, '')
    .replace(INVISIBLE, '')
    .replace(/[&<>"']/g, (c) => ESCAPES[c])
  return { extrait: propre.slice(0, max), non_fiable: true }
}

// Reproducible command written by the tool (never page text): `curl <options> '<url>'`.
// Every character of the URL outside the unreserved/reserved URL set (quotes, spaces, backticks, non-ASCII...)
// is percent-encoded, so the single-quoted argument is inert in a shell and the command replays as is.
// Returns null when the command would exceed MAX_COMMANDE or the URL is not http(s).
export const MAX_COMMANDE = 512
const HORS_URL = /[^A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]/gu
export const MOTIF_COMMANDE = /^curl(?: -[A-Za-z]+)+ '[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]+'$/
export function commandeCurl(options, url) {
  const u = String(url ?? '')
  if (!/^https?:\/\//i.test(u) || !/^-[A-Za-z]+(?: -[A-Za-z]+)*$/.test(options)) return null
  const sure = u.replace(HORS_URL, (c) => [...Buffer.from(c, 'utf8')].map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join(''))
  const cmd = `curl ${options} '${sure}'`
  return cmd.length <= MAX_COMMANDE ? cmd : null
}

// node:sqlite loads without a flag from Node 22.13 on.
export const NODE_MINIMUM = '22.13.0'
export function versionNodeSuffisante(version = process.versions.node, minimum = NODE_MINIMUM) {
  const a = String(version).replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0)
  const b = minimum.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== b[i]) return (a[i] ?? 0) > b[i]
  return true
}

export function ecrireJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
}

export function cheminDonnees(cwd = process.cwd()) {
  return process.env.GEO_HOME || path.join(cwd, '.claude', 'geo')
}

// Drops only the SQLite ExperimentalWarning; call before any import('node:sqlite').
export function silencerAvertissementSqlite() {
  const origine = process.emitWarning
  process.emitWarning = function (avertissement, ...args) {
    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type
    const message = typeof avertissement === 'string' ? avertissement : avertissement?.message ?? ''
    const nom = type ?? avertissement?.name
    if (nom === 'ExperimentalWarning' && /SQLite/i.test(message)) return
    return origine.call(process, avertissement, ...args)
  }
}
