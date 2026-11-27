// Safe network layer: host allowlist, SSRF guard re-checked on every redirect, polite pacing, size and time caps, disk cache.
// Adapted from plugins/seo/outils/collecter.mjs (same author, MIT).
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIPv4, isIPv6 } from 'node:net'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ErreurGeo } from './sortie.mjs'

export const AGENT = 'geo-audit/0.1 (+https://github.com/kvarot/skills)'
const ACCEPT_DEFAUT = 'text/html,application/xhtml+xml'
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// --- address policy ---------------------------------------------------------

function interditV4(o) {
  const [a, b, c] = o
  return a === 0 || a === 10 || a === 127 || a >= 224 // this-network, private, loopback, multicast and reserved
    || (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64.0.0/10
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0) // IETF protocol assignments
    || (a === 198 && (b === 18 || b === 19)) // benchmarking
}

// Expands any textual IPv6 (including a dotted IPv4 tail) to eight 16-bit groups.
function groupesV6(ip) {
  let s = ip.split('%')[0].toLowerCase()
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (m) {
    const o = m[2].split('.').map(Number)
    s = m[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16)
  }
  const [tete, queue] = s.split('::')
  const h = tete ? tete.split(':') : []
  const t = queue === undefined ? [] : queue ? queue.split(':') : []
  const trou = queue === undefined ? 0 : 8 - h.length - t.length
  return [...h, ...Array(trou).fill('0'), ...t].map((x) => parseInt(x, 16))
}

// True when the address must never be fetched. Anything unparsable is refused.
export function estAdresseInterdite(ip) {
  const s = String(ip ?? '').trim().replace(/^\[|\]$/g, '')
  if (isIPv4(s)) return interditV4(s.split('.').map(Number))
  if (!isIPv6(s)) return true
  const g = groupesV6(s)
  if (g.length !== 8 || g.some((x) => !Number.isInteger(x))) return true
  const v4 = [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255]
  const zeros5 = g.slice(0, 5).every((x) => x === 0)
  if (zeros5 && g[5] === 0xffff) return interditV4(v4) // IPv4-mapped ::ffff:a.b.c.d
  if (zeros5 && g[5] === 0) return true // unspecified, loopback, deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return interditV4(v4) // NAT64
  if (g[0] === 0x2002) return interditV4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255]) // 6to4
  return (g[0] & 0xfe00) === 0xfc00 // fc00::/7 unique-local (fd00::/8 included)
    || (g[0] & 0xffc0) === 0xfe80 // fe80::/10 link-local
    || (g[0] & 0xff00) === 0xff00 // multicast
}

// --- host allowlist ---------------------------------------------------------

// Hosts from <dossier>/session.json (`hotes_autorises`) plus the ones passed on the command line.
export function hotesAutorises(dossierDonnees, extra = []) {
  const hotes = new Set()
  try {
    const session = JSON.parse(readFileSync(path.join(dossierDonnees, 'session.json'), 'utf8'))
    for (const h of Array.isArray(session?.hotes_autorises) ? session.hotes_autorises : []) if (typeof h === 'string' && h.trim()) hotes.add(h.trim().toLowerCase())
  } catch { /* missing or invalid session file: no hosts from it */ }
  for (const h of extra) if (typeof h === 'string' && h.trim()) hotes.add(h.trim().toLowerCase())
  return hotes
}

// --- decoding ---------------------------------------------------------------

function decoder(tampon, ctype) {
  let label = /charset\s*=\s*["']?([\w.:-]+)/i.exec(ctype ?? '')?.[1]
  if (!label) label = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(tampon.subarray(0, 2048).toString('latin1'))?.[1]
  try { return new TextDecoder(label || 'utf-8').decode(tampon) } catch { return new TextDecoder('utf-8').decode(tampon) }
}

// Is the response media type one the caller asked for? A missing Content-Type is accepted.
function typeAccepte(ctype, accept) {
  if (!ctype) return true
  const type = ctype.split(';')[0].trim().toLowerCase()
  return accept.split(',').some((a) => {
    const t = a.split(';')[0].trim().toLowerCase()
    return t === '*/*' || t === type || (t.endsWith('/*') && type.startsWith(t.slice(0, -1)))
  })
}

// --- client -----------------------------------------------------------------

export function creerClient({
  hotes, autoriserLocal = false, delaiMs = 1000, timeoutMs = 15000, maxOctets = 5242880, maxRedirections = 10,
  maxAgeMs = 24 * 3600 * 1000, cache, resolveur, fetchImpl,
} = {}) {
  const resoudre = resolveur ?? ((h) => lookup(h, { all: true }))
  const requeter = fetchImpl ?? globalThis.fetch
  const prochainCreneau = new Map() // host -> earliest start of its next request
  const echec = (url, raison, redirections = []) => ({ url, statut: 0, entetes: {}, corps: null, redirections, raison, depuisCache: false })

  // Reserves a slot for the host so concurrent callers are spaced by delaiMs too.
  async function attendre(hote) {
    const debut = Math.max(Date.now(), prochainCreneau.get(hote) ?? 0)
    prochainCreneau.set(hote, debut + delaiMs)
    if (debut > Date.now()) await pause(debut - Date.now())
  }

  // Null when the URL may be fetched, otherwise the French reason.
  async function verifier(u) {
    if (autoriserLocal) return null
    const hote = u.hostname.replace(/^\[|\]$/g, '')
    let adresses
    if (isIPv4(hote) || isIPv6(hote)) adresses = [{ address: hote }]
    else {
      try { adresses = await resoudre(hote) } catch (e) { return `résolution DNS impossible (${e.code ?? e.message})` }
    }
    if (!adresses?.length) return 'résolution DNS sans résultat'
    const mauvaise = adresses.find((a) => estAdresseInterdite(a.address))
    return mauvaise ? `adresse interdite (${mauvaise.address}) pour ${hote}` : null
  }

  async function lireCorps(res, signal) {
    const annonce = Number(res.headers.get('content-length') ?? 0)
    if (annonce > maxOctets) { await res.body?.cancel().catch(() => {}); return null }
    const morceaux = []
    let total = 0
    if (res.body) {
      for await (const m of res.body) {
        total += m.length
        if (total > maxOctets) { await res.body.cancel().catch(() => {}); return null }
        morceaux.push(m)
      }
    }
    signal.throwIfAborted()
    return Buffer.concat(morceaux)
  }

  function chemin(url) {
    return cache ? path.join(cache, createHash('sha256').update(url).digest('hex') + '.json') : null
  }
  function lireCache(url) {
    const f = chemin(url)
    try {
      if (!f || !existsSync(f)) return null
      const e = JSON.parse(readFileSync(f, 'utf8'))
      if (!(Date.now() - e.ts < maxAgeMs)) return null
      return { ...e.reponse, depuisCache: true }
    } catch { return null }
  }
  function ecrireCache(url, reponse) {
    const f = chemin(url)
    if (!f) return
    try {
      mkdirSync(cache, { recursive: true })
      writeFileSync(f, JSON.stringify({ ts: Date.now(), reponse }))
    } catch { /* cache is best-effort */ }
  }

  // One hop: no automatic redirect; the timer covers headers and body and is always cleared.
  async function saut(url, accept, agent) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await requeter(url, { headers: { 'user-agent': agent, accept }, signal: ctl.signal, redirect: 'manual' })
      const entetes = Object.fromEntries(res.headers)
      const lieu = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && lieu) {
        await res.body?.cancel().catch(() => {})
        return { redirection: lieu, statut: res.status, entetes }
      }
      const ctype = res.headers.get('content-type') ?? ''
      if (res.status >= 200 && res.status < 300 && !typeAccepte(ctype, accept)) {
        await res.body?.cancel().catch(() => {})
        return { statut: res.status, entetes, corps: null, raison: `type de contenu inattendu (${ctype.split(';')[0].trim()})` }
      }
      const tampon = await lireCorps(res, ctl.signal)
      if (tampon === null) return { statut: res.status, entetes, corps: null, raison: `corps de plus de ${Math.round(maxOctets / 1048576)} Mo` }
      return { statut: res.status, entetes, corps: decoder(tampon, ctype) }
    } finally { clearTimeout(timer) }
  }

  async function demander(url, { accept = ACCEPT_DEFAUT, agent = AGENT } = {}) {
    let courante
    try { courante = new URL(url) } catch { return echec(String(url), 'URL invalide') }
    if (!/^https?:$/.test(courante.protocol)) return echec(courante.href, 'protocole non pris en charge (http ou https attendu)')
    if (!hotes?.has(courante.hostname.toLowerCase())) throw new ErreurGeo(`Hôte non autorisé : ${courante.hostname}. Ajoutez-le à hotes_autorises ou passez --hotes-autorises.`, 3)

    const demande = courante.href
    const mis = lireCache(demande)
    if (mis) return mis

    const redirections = []
    for (;;) {
      const interdit = await verifier(courante)
      if (interdit) return echec(courante.href, interdit, redirections)
      await attendre(courante.hostname.toLowerCase())
      let r
      try { r = await saut(courante.href, accept, agent) } catch (e) {
        const cause = e?.name === 'AbortError' || e?.name === 'TimeoutError' ? `délai de ${timeoutMs} ms dépassé` : `erreur réseau (${e?.cause?.code ?? e?.code ?? e?.message ?? 'inconnue'})`
        return echec(courante.href, cause, redirections)
      }
      if (r.redirection === undefined) {
        const reponse = { url: courante.href, statut: r.statut, entetes: r.entetes, corps: r.corps, redirections, depuisCache: false }
        if (r.raison) reponse.raison = r.raison
        else if (r.statut === 200 && r.corps !== null) ecrireCache(demande, reponse)
        return reponse
      }
      if (redirections.length >= maxRedirections) return echec(courante.href, `trop de redirections (plus de ${maxRedirections})`, redirections)
      let suite
      try { suite = new URL(r.redirection, courante) } catch { return echec(courante.href, 'redirection invalide', redirections) }
      suite.hash = ''
      if (!/^https?:$/.test(suite.protocol)) return echec(courante.href, `redirection vers un protocole non pris en charge (${suite.protocol})`, redirections)
      if (!hotes.has(suite.hostname.toLowerCase())) return echec(courante.href, `redirection vers un hôte non autorisé (${suite.hostname})`, redirections)
      redirections.push(suite.href)
      courante = suite
    }
  }

  return { demander }
}
