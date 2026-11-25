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

  let derniere = 0, premiere = true
  const demander = async (cible) => {
    if (!premiere) { const attente = derniere + delaiMs - Date.now(); if (attente > 0) await pause(attente) }
    premiere = false
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(cible, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: ctl.signal, redirect: 'follow' })
      const ctype = res.headers.get('content-type') ?? ''
      const corps = res.status === 200 ? await res.text() : (await res.arrayBuffer(), null)
      return { status: res.status, ctype, corps, url: res.url || cible }
    } finally { clearTimeout(timer); derniere = Date.now() }
  }
  const fichier = async (chemin) => {
    try { const r = await demander(new URL(chemin, depart.origin).href); return r.status === 200 ? r.corps : null } catch { return null }
  }

  const robotsTxt = await fichier('/robots.txt')
  const robots = !dev && robotsTxt !== null ? lireRobots(robotsTxt) : null
  const permis = (u) => { if (!robots) return true; const p = new URL(u); return robots.estAutorise(p.pathname + p.search) }

  const premiereUrl = normaliser(depart.href, depart.href) ?? depart.href
  if (!permis(premiereUrl)) throw new Error('Page de départ interdite par robots.txt : ' + url)
  const file = [premiereUrl], vues = new Set(file), pages = [], erreurs = []
  while (file.length && pages.length < maxPages) {
    const cible = file.shift()
    let r
    try { r = await demander(cible) } catch (e) {
      if (cible === premiereUrl) throw new Error('Page de départ injoignable : ' + url + ' (' + (e.cause?.code ?? e.message) + ')')
      erreurs.push({ url: cible, erreur: e.message }); continue
    }
    if (cible === premiereUrl && r.status !== 200) throw new Error(`Page de départ en erreur (HTTP ${r.status}) : ${url}`)
    if (r.status !== 200 || !/text\/html/i.test(r.ctype)) continue
    const faits = extraire(r.corps, r.url)
    pages.push(faits)
    for (const l of faits.liens) {
      const n = normaliser(l.href, r.url)
      if (!n || vues.has(n) || new URL(n).host !== depart.host || !permis(n)) continue
      vues.add(n); file.push(n)
    }
  }
  const sitemapXml = await fichier('/sitemap.xml')
  return { pages, site: { robotsTxt, sitemapXml, urlsConnues: pages.map((p) => p.url), origine: depart.origin }, erreurs }
}
