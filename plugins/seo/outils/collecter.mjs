// Page collection: local folder or live URL (polite same-host breadth-first crawl).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { extraire } from './extraire.mjs'

const UA = 'seo-plugin-audit/0.1'
const TIMEOUT_MS = 15000
const DELAI_PROD_MIN = 1000
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

// --- robots.txt -------------------------------------------------------------

// Parse the `User-agent: *` group; longest matching rule wins, Allow wins ties.
export function lireRobots(txt) {
  const regles = []
  let agents = [], enAgents = false
  for (const brut of String(txt ?? '').split(/\r?\n/)) {
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(brut.replace(/#.*/, '').trim())
    if (!m) continue
    const cle = m[1].toLowerCase(), val = m[2].trim()
    if (cle === 'user-agent') {
      if (!enAgents) agents = []
      agents.push(val.toLowerCase()); enAgents = true
    } else {
      enAgents = false
      if ((cle === 'disallow' || cle === 'allow') && agents.includes('*') && val) regles.push({ allow: cle === 'allow', motif: val })
    }
  }
  const versRegex = (motif) => new RegExp('^' + motif.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$'))
  const compilees = regles.map((r) => ({ ...r, re: versRegex(r.motif) }))
  return {
    estAutorise(chemin) {
      let meilleure = null
      for (const r of compilees) {
        if (!r.re.test(chemin)) continue
        if (!meilleure || r.motif.length > meilleure.motif.length || (r.motif.length === meilleure.motif.length && r.allow)) meilleure = r
      }
      return !meilleure || meilleure.allow
    },
  }
}

// --- local folder -----------------------------------------------------------

function listerHtml(racine, dir = racine, sortie = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listerHtml(racine, p, sortie)
    else if (/\.html$/i.test(e.name)) sortie.push(p)
  }
  return sortie
}

const lireOuNull = (f) => (existsSync(f) && statSync(f).isFile() ? readFileSync(f, 'utf8') : null)

export function collecterDossier(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('Dossier introuvable : ' + dir)
  const pages = listerHtml(dir).sort().map((f) => {
    const rel = path.relative(dir, f).split(path.sep).join('/')
    const url = '/' + rel.replace(/(^|\/)index\.html$/i, '$1')
    return extraire(readFileSync(f, 'utf8'), url)
  })
  return {
    pages,
    site: { robotsTxt: lireOuNull(path.join(dir, 'robots.txt')), sitemapXml: lireOuNull(path.join(dir, 'sitemap.xml')), urlsConnues: pages.map((p) => p.url) },
  }
}

// --- live URL ---------------------------------------------------------------

// Absolute http(s) URL without fragment, or null.
function normaliser(href, base) {
  if (!href || /^\s*(#|mailto:|tel:|javascript:|sms:|data:)/i.test(href)) return null
  let u
  try { u = new URL(href.trim(), base) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  u.hash = ''
  const ext = /\.([a-z0-9]+)$/i.exec(u.pathname.split('/').pop())
  if (ext && !/^(html?|php)$/i.test(ext[1])) return null
  return u.href
}

export async function collecterUrl(url, { maxPages = 50, delaiMs = 1000, autoriserProd = false, hotesDev = ['localhost', '127.0.0.1'] } = {}) {
  let depart
  try { depart = new URL(url) } catch { throw new Error('URL invalide : ' + url) }
  if (!/^https?:$/.test(depart.protocol)) throw new Error('URL invalide (http ou https attendu) : ' + url)
  const dev = hotesDev.includes(depart.hostname)
  if (!dev && !autoriserProd) throw new Error(`Hôte hors développement (${depart.hostname}) : lecture refusée sans --autoriser-prod`)
  if (!dev) delaiMs = Math.max(delaiMs, DELAI_PROD_MIN)

  const MAX_CORPS = 5 * 1024 * 1024, MAX_SAUTS = 5
  let derniere = 0, premiere = true
  let robots = null
  const permis = (u) => { if (!robots) return true; const p = new URL(u); return robots.estAutorise(p.pathname + p.search) }
  const erreurs = []

  // One polite request (delay applied), no automatic redirect.
  const requete = async (cible) => {
    if (!premiere) { const attente = derniere + delaiMs - Date.now(); if (attente > 0) await pause(attente) }
    premiere = false
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      return await fetch(cible, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: ctl.signal, redirect: 'manual' })
    } finally { clearTimeout(timer); derniere = Date.now() }
  }
  // Read the body with a size cap; null if larger.
  const lireCorps = async (res) => {
    if (Number(res.headers.get('content-length') ?? 0) > MAX_CORPS) { await res.body?.cancel(); return null }
    const morceaux = []; let total = 0
    for await (const m of res.body ?? []) {
      total += m.length
      if (total > MAX_CORPS) { await res.body.cancel(); return null }
      morceaux.push(m)
    }
    return Buffer.concat(morceaux).toString('utf8')
  }
  // Fetch following same-host redirects only (<= 5 hops). Returns { statut, ctype, corps, url, raison? }.
  // `statut` is the HTTP status, or 0 when the response is not usable (see `raison`).
  const demander = async (depuis, { html }) => {
    let cible = depuis
    for (let saut = 0; saut <= MAX_SAUTS; saut++) {
      const res = await requete(cible)
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        await res.body?.cancel()
        let suite
        try { suite = new URL(res.headers.get('location'), cible) } catch { return { statut: 0, url: cible, raison: 'redirection invalide' } }
        if (suite.host !== depart.host) return { statut: 0, url: cible, raison: 'redirection vers un autre hôte (' + suite.host + ')' }
        suite.hash = ''
        if (!permis(suite.href)) return { statut: 0, url: cible, raison: 'redirection vers un chemin interdit par robots.txt' }
        cible = suite.href
        continue
      }
      const ctype = res.headers.get('content-type') ?? ''
      if (res.status !== 200) { await res.body?.cancel(); return { statut: res.status, ctype, corps: null, url: cible } }
      if (html && !/text\/html/i.test(ctype)) { await res.body?.cancel(); return { statut: 200, ctype, corps: null, url: cible, raison: 'type de contenu non HTML' } }
      const corps = await lireCorps(res)
      if (corps === null) return { statut: 0, url: cible, raison: 'corps de plus de 5 Mo' }
      return { statut: 200, ctype, corps, url: cible }
    }
    return { statut: 0, url: cible, raison: 'trop de redirections' }
  }

  // robots.txt: off dev hosts, 5xx or network error means disallow-all (RFC 9309); 4xx means allow-all.
  let robotsTxt = null
  try {
    const r = await demander(new URL('/robots.txt', depart.origin).href, { html: false })
    if (r.statut === 200) robotsTxt = r.corps
    else if (!dev && (r.statut >= 500 || (r.statut === 0 && r.raison))) {
      robots = { estAutorise: () => false }
      erreurs.push({ url: r.url, erreur: 'robots.txt inaccessible (' + (r.statut || r.raison) + ') : exploration interdite' })
    }
  } catch (e) {
    if (!dev) { robots = { estAutorise: () => false }; erreurs.push({ url: '/robots.txt', erreur: 'robots.txt inaccessible (' + e.message + ') : exploration interdite' }) }
  }
  if (!dev && robotsTxt !== null) robots = lireRobots(robotsTxt)

  const premiereUrl = normaliser(depart.href, depart.href) ?? depart.href
  if (!permis(premiereUrl)) throw new Error('Page de départ interdite par robots.txt (ou robots.txt inaccessible) : ' + url)
  const file = [premiereUrl], vues = new Set(file), pages = []
  while (file.length && pages.length < maxPages) {
    const cible = file.shift()
    const depart1 = cible === premiereUrl
    let r
    try { r = await demander(cible, { html: true }) } catch (e) {
      if (depart1) throw new Error('Page de départ injoignable : ' + url + ' (' + (e.cause?.code ?? e.message) + ')')
      erreurs.push({ url: cible, erreur: e.message }); continue
    }
    if (depart1 && r.statut !== 200) throw new Error(r.statut === 0 ? `Page de départ inutilisable (${r.raison}) : ${url}` : `Page de départ en erreur (HTTP ${r.statut}) : ${url}`)
    if (r.statut === 0 || (r.statut === 200 && r.corps === null)) {
      if (depart1) throw new Error(`Page de départ inutilisable (${r.raison}) : ${url}`)
      erreurs.push({ url: cible, erreur: r.raison }); continue
    }
    if (r.statut !== 200) continue
    if (r.url !== cible) { if (vues.has(r.url)) continue; vues.add(r.url) }
    const faits = extraire(r.corps, r.url)
    pages.push(faits)
    for (const l of faits.liens) {
      const n = normaliser(l.href, r.url)
      if (!n || vues.has(n) || new URL(n).host !== depart.host || !permis(n)) continue
      vues.add(n); file.push(n)
    }
  }
  let sitemapXml = null
  try { const s = await demander(new URL('/sitemap.xml', depart.origin).href, { html: false }); if (s.statut === 200) sitemapXml = s.corps } catch { /* absent */ }
  return { pages, site: { robotsTxt, sitemapXml, urlsConnues: pages.map((p) => p.url), origine: depart.origin }, erreurs }
}
