// Polite same-host site collection: robots.txt, breadth-first crawl, sitemaps, llms.txt presence, WAF detection.
// Adapted from plugins/seo/outils/collecter.mjs (same author, MIT): the local-folder collector and the crawl shape.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { extraire } from './extraire.mjs'
import { analyserRobots } from './robots.mjs'

const JETON_ROBOTS = 'geo-audit'
const MAX_URLS_SITEMAP = 50000
const MAX_NIVEAU_SITEMAP = 2 // index -> child index -> child urlset
const MAX_SITEMAPS = 50
const MAX_SAUTS = 10
const PARAMS_SUIVI = /^(utm_[a-z_]+|fbclid|gclid|msclkid|mc_[a-z]+|_ga|_gl|yclid|igshid)$/i
// Extensions that are never pages; any other dotted slug (article-2.5, contact.us) is crawled.
const EXT_NON_PAGE = /^(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|pdf|docx?|xlsx?|pptx?|odt|ods|zip|gz|tgz|tar|rar|7z|css|js|mjs|map|woff2?|ttf|otf|eot|mp3|mp4|m4a|wav|ogg|webm|mov|avi|mkv|xml|json|txt|rss|atom|csv|exe|dmg|apk)$/i

// --- helpers ----------------------------------------------------------------

// SHA-256 of the visible text: block texts joined, whitespace collapsed, lowercased.
function empreinte(blocs) {
  const t = (blocs ?? []).map((b) => b.texte ?? '').join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
  return createHash('sha256').update(t).digest('hex')
}

// Absolute http(s) URL without fragment and tracking parameters (remaining ones sorted), or null.
// Links to files that are not pages (images, PDF...) are not crawled.
function normaliser(href, base) {
  if (typeof href !== 'string' || !href.trim() || /^\s*(#|mailto:|tel:|javascript:|sms:|data:)/i.test(href)) return null
  let u
  try { u = new URL(href.trim(), base) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  u.hash = ''
  const ext = /\.([a-z0-9]+)$/i.exec(u.pathname.split('/').pop())
  if (ext && EXT_NON_PAGE.test(ext[1])) return null
  const garde = [...u.searchParams].filter(([k]) => !PARAMS_SUIVI.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  u.search = ''
  for (const [k, v] of garde) u.searchParams.append(k, v)
  return u.href
}

const chemin = (u) => { const p = new URL(u); return p.pathname + p.search }
const entete = (e, nom) => (e && typeof e[nom] === 'string' ? e[nom] : null)

function decoderXml(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" })[n]).trim()
}

// Reads a sitemap or sitemap index with tolerance for namespaces, prefixes and CDATA. Never throws.
// `loc` is read only as a direct child of <url> / <sitemap> (same prefix), so image:loc and video:loc are ignored.
export function lireSitemap(xml) {
  const txt = String(xml ?? '')
  const index = /<(?:[\w.-]+:)?sitemapindex[\s>]/i.test(txt)
  const locs = []
  const blocs = /<((?:[\w.-]+:)?)(url|sitemap)(?:\s[^>]*)?>([\s\S]*?)<\/\1\2\s*>/gi
  let b
  while ((b = blocs.exec(txt)) !== null) {
    const prefixe = b[1].replace(/\./g, '\\.')
    const m = new RegExp('<' + prefixe + 'loc(?:\\s[^>]*)?>([\\s\\S]*?)</' + prefixe + 'loc\\s*>', 'i').exec(b[3])
    const v = m ? decoderXml(m[1]) : ''
    if (v) locs.push(v)
  }
  return { type: index ? 'index' : 'urlset', locs }
}

// WAF / CDN challenge: returns { url, statut, detail } or null.
function detecterWaf(rep) {
  if (![403, 429, 503].includes(rep.statut)) return null
  const e = rep.entetes ?? {}
  const corps = typeof rep.corps === 'string' ? rep.corps : ''
  const titre = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(corps)?.[1] ?? ''
  let detail = null
  if (e['cf-mitigated']) detail = `en-tête cf-mitigated: ${e['cf-mitigated']}`
  else if (/cloudflare/i.test(e.server ?? '') && /just a moment/i.test(titre)) detail = 'server: cloudflare et titre « Just a moment »'
  else if (/challenge-platform/i.test(corps)) detail = 'marqueur challenge-platform dans la page'
  else if (/captcha/i.test(corps)) detail = 'marqueur captcha dans la page'
  return detail ? { url: rep.url, statut: rep.statut, detail } : null
}

// --- live site ----------------------------------------------------------------

// Collecte = { pages, site, erreurs, exploration }. Never throws except ErreurGeo (code 3) from the client
// when the start host is not allowlisted.
export async function collecterUrl(url, { client, maxPages = 50 } = {}) {
  const depart = new URL(url)
  const erreurs = []
  const erreur = (u, raison) => erreurs.push({ url: u, raison })
  let origine = depart.origin
  let hote = depart.host

  // robots.txt (RFC 9309): 4xx = allow all; 5xx or network failure = disallow all for us.
  let robots = null, robotsTxt = null, toutInterdit = false, statutRobots = null
  async function chargerRobots() {
    const rr = await client.demander(origine + '/robots.txt', { accept: 'text/plain,*/*;q=0.1' }) // may throw ErreurGeo 3 before any state change
    robots = null; robotsTxt = null; toutInterdit = false
    statutRobots = rr.statut
    if (rr.statut >= 200 && rr.statut < 300 && typeof rr.corps === 'string') { robotsTxt = rr.corps; robots = analyserRobots(rr.corps) }
    else if (rr.statut === 0 || rr.statut >= 500) { toutInterdit = true; erreur(origine + '/robots.txt', `robots.txt inaccessible (${rr.statut === 0 ? rr.raison : 'statut ' + rr.statut}) : exploration interdite par précaution (RFC 9309)`) }
  }
  await chargerRobots()
  const permis = (u) => !toutInterdit && (!robots || robots.autorise(JETON_ROBOTS, chemin(u)))
  const refus = (u) => erreur(u, toutInterdit ? 'robots.txt inaccessible : exploration interdite par précaution' : `interdit par robots.txt pour ${JETON_ROBOTS}`)

  const pages = []
  const collectees = new Set() // final URLs already collected, reached directly or through a redirect
  let waf = null // first challenge seen on ANY page (not only the start page); later ones are only listed in erreurs
  const vus = new Set()
  const file = []
  const plafondVus = maxPages * 50 + 1000 // bounds memory on very link-heavy sites
  const departNorm = normaliser(depart.href, depart.href) ?? depart.href
  vus.add(departNorm)
  file.push({ url: departNorm, profondeur: 0 })
  let tete = 0

  // Fetches one URL following redirects by hand, so that each hop is checked (same host, robots.txt)
  // BEFORE it is requested. Only the start URL may change host (once); its final host becomes the crawl host.
  // Returns { rep, redirections } or { vide: true } when nothing is left to collect (errors already listed).
  async function recuperer(cible, premier) {
    const avant = { hote, origine, robots, robotsTxt, toutInterdit, statutRobots }
    const r = await recupererSauts(cible, premier)
    // A failed start hop must not leave the crawl bound to the host it was redirected to.
    if (r.vide && hote !== avant.hote) ({ hote, origine, robots, robotsTxt, toutInterdit, statutRobots } = avant)
    return r
  }
  async function recupererSauts(cible, premier) {
    const redirections = []
    const chaine = new Set([cible])
    let courante = cible
    let hoteChange = false
    for (;;) {
      let rep
      try { rep = await client.demander(courante, { suivre: false }) } catch (e) {
        if (e?.code === 3) { erreur(courante, e.message); return { vide: true } }
        throw e
      }
      const lieu = rep.statut >= 300 && rep.statut < 400 ? rep.entetes?.location : null
      if (!lieu) return { rep, redirections }
      if (redirections.length >= MAX_SAUTS) { erreur(cible, `trop de redirections (plus de ${MAX_SAUTS})`); return { vide: true } }
      let suite
      try { suite = new URL(lieu, courante) } catch { erreur(cible, 'redirection invalide'); return { vide: true } }
      suite.hash = ''
      if (!/^https?:$/.test(suite.protocol)) { erreur(cible, `redirection vers un protocole non pris en charge (${suite.protocol})`); return { vide: true } }
      const cle = normaliser(suite.href, suite.href) ?? suite.href
      if (suite.host !== hote) {
        if (!(premier && !hoteChange)) { erreur(cible, `redirection vers un autre hôte (${suite.host}) : non collecté`); return { vide: true } }
        hoteChange = true
        hote = suite.host; origine = suite.origin
        try { await chargerRobots() } catch (e) { // robots.txt and sitemaps follow the new host
          if (e?.code === 3) { erreur(cible, e.message); return { vide: true } }
          throw e
        }
      }
      if (chaine.has(cle)) { erreur(cible, 'boucle de redirections'); return { vide: true } }
      if (!permis(cle)) { refus(cle); return { vide: true } }
      redirections.push(cle)
      chaine.add(cle)
      if (collectees.has(cle)) return { vide: true } // target already collected: no second fetch
      courante = cle
    }
  }

  while (tete < file.length && pages.length < maxPages) {
    const { url: cible, profondeur } = file[tete++]
    if (collectees.has(cible)) continue
    if (!permis(cible)) { refus(cible); continue }
    const r = await recuperer(cible, profondeur === 0 && pages.length === 0)
    if (r.vide) continue
    const { rep, redirections } = r
    const defi = detecterWaf(rep)
    if (defi) {
      waf ??= { detecte: true, preuve: defi }
      erreur(cible, `défi CDN/WAF (${defi.detail}) : page non analysée`)
      if (profondeur === 0) break
      continue
    }
    if (rep.statut === 0) { erreur(cible, rep.raison ?? 'réponse inutilisable'); continue }
    if (rep.statut < 200 || rep.statut >= 300) { erreur(cible, `statut ${rep.statut}`); continue }
    if (rep.corps === null || rep.corps === undefined) { erreur(cible, rep.raison ?? 'corps illisible'); continue }
    const finale = normaliser(rep.url, rep.url) ?? rep.url
    if (collectees.has(finale)) continue
    collectees.add(finale)
    vus.add(finale)
    const faits = extraire(rep.corps, finale)
    pages.push({
      ...faits,
      statut: rep.statut,
      entetes: { x_robots_tag: entete(rep.entetes, 'x-robots-tag'), content_type: entete(rep.entetes, 'content-type'), last_modified: entete(rep.entetes, 'last-modified') },
      profondeur,
      redirections,
      empreinte_texte: empreinte(faits.blocs),
    })
    for (const l of faits.liens ?? []) {
      const n = normaliser(l.href, finale)
      if (!n || vus.has(n) || vus.size >= plafondVus) continue
      if (new URL(n).host !== hote) continue
      vus.add(n)
      file.push({ url: n, profondeur: profondeur + 1 })
    }
  }
  const limiteAtteinte = pages.length >= maxPages && tete < file.length

  // A challenged start page: nothing else is worth asking the site.
  if (waf && pages.length === 0) {
    return {
      pages: [],
      site: { racine: origine, robotsTxt, robotsStatut: statutRobots, sitemaps: [], llmsTxt: null, llmsFullTxt: null, waf, urlsConnues: [] },
      erreurs,
      exploration: { pages: 0, limite_atteinte: false },
    }
  }

  const sitemaps = await collecterSitemaps({ client, origine, hote, robots, permis, refus, erreur })
  const llmsTxt = await presence(client, origine + '/llms.txt', permis, erreur)
  const llmsFullTxt = await presence(client, origine + '/llms-full.txt', permis, erreur)

  return {
    pages,
    site: { racine: origine, robotsTxt, robotsStatut: statutRobots, sitemaps, llmsTxt, llmsFullTxt, waf, urlsConnues: pages.map((p) => p.url) },
    erreurs,
    exploration: { pages: pages.length, limite_atteinte: limiteAtteinte },
  }
}

// Presence and status only: the body is never kept. HTML answers are soft-404s, not an llms file.
async function presence(client, cible, permis, erreur) {
  if (!permis(cible)) { erreur(cible, 'interdit par robots.txt : présence non vérifiée'); return { present: null, statut: null } }
  const r = await client.demander(cible, { accept: 'text/plain,text/markdown,*/*;q=0.1' })
  const ctype = entete(r.entetes, 'content-type') ?? ''
  const ok = r.statut >= 200 && r.statut < 300 && !/html/i.test(ctype)
  return { present: ok, statut: r.statut, content_type: ctype || null }
}

// robots.txt `Sitemap:` lines (same host only), else /sitemap.xml; indexes followed to MAX_NIVEAU_SITEMAP levels.
async function collecterSitemaps({ client, origine, hote, robots, permis, refus, erreur }) {
  const declares = []
  for (const s of robots?.sitemaps ?? []) {
    let u
    try { u = new URL(s, origine) } catch { erreur(s, 'URL de sitemap invalide'); continue }
    if (u.host !== hote) { erreur(u.href, 'sitemap sur un autre hôte : non lu'); continue }
    declares.push(u.href)
  }
  const aLire = [...new Set(declares.length ? declares : [origine + '/sitemap.xml'])].map((u) => ({ url: u, niveau: 0 }))
  const sortie = []
  const vus = new Set(aLire.map((s) => s.url))
  let total = 0, tete = 0
  while (tete < aLire.length) {
    const { url: u, niveau } = aLire[tete++]
    if (sortie.length >= MAX_SITEMAPS) { erreur(u, `plus de ${MAX_SITEMAPS} sitemaps : lecture arrêtée`); break }
    if (/\.gz$/i.test(new URL(u).pathname)) { erreur(u, 'sitemap compressé (.gz) : non pris en charge'); continue }
    if (!permis(u)) { refus(u); continue }
    const r = await client.demander(u, { accept: 'application/xml,text/xml,text/plain,*/*;q=0.1' })
    if (r.statut === 0) { erreur(u, r.raison ?? 'réponse inutilisable'); continue }
    if (r.statut < 200 || r.statut >= 300) {
      if (!(r.statut === 404 && declares.length === 0)) erreur(u, `statut ${r.statut}`) // an absent default sitemap is normal
      continue
    }
    if (typeof r.corps !== 'string') { erreur(u, r.raison ?? 'corps illisible'); continue }
    const { type, locs } = lireSitemap(r.corps)
    const entree = { url: u, statut: r.statut, type, niveau, urls: [], enfants: [] }
    if (type === 'index') {
      for (const l of locs) {
        let enfant
        try { enfant = new URL(l, u) } catch { continue }
        entree.enfants.push(enfant.href)
        if (niveau + 1 > MAX_NIVEAU_SITEMAP) continue
        if (enfant.host !== hote) { erreur(enfant.href, 'sitemap sur un autre hôte : non lu'); continue }
        if (!vus.has(enfant.href)) { vus.add(enfant.href); aLire.push({ url: enfant.href, niveau: niveau + 1 }) }
      }
    } else {
      const reste = MAX_URLS_SITEMAP - total
      entree.urls = locs.slice(0, Math.max(0, reste))
      total += entree.urls.length
      if (locs.length > entree.urls.length) { entree.tronque = true; erreur(u, `plus de ${MAX_URLS_SITEMAP} URL : lecture tronquée`) }
    }
    sortie.push(entree)
  }
  return sortie
}

// --- local folder -------------------------------------------------------------

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

// Static site folder (.html files); `profondeur` is the path depth since there is no crawl.
export function collecterDossier(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('Dossier introuvable : ' + dir)
  const pages = listerHtml(dir).map((f) => {
    const rel = path.relative(dir, f).split(path.sep).join('/')
    const url = '/' + rel.replace(/(^|\/)index\.html$/i, '$1')
    const faits = extraire(readFileSync(f, 'utf8'), url)
    return {
      ...faits,
      statut: 200,
      entetes: { x_robots_tag: null, content_type: null, last_modified: null },
      profondeur: url.split('/').filter(Boolean).length,
      redirections: [],
      empreinte_texte: empreinte(faits.blocs),
    }
  }).sort((a, b) => (a.profondeur - b.profondeur) || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
  const presenceFichier = (n) => ({ present: existsSync(path.join(dir, n)), statut: null })
  return {
    pages,
    site: {
      racine: null,
      robotsTxt: lireOuNull(path.join(dir, 'robots.txt')),
      sitemapXml: lireOuNull(path.join(dir, 'sitemap.xml')),
      sitemaps: [],
      llmsTxt: presenceFichier('llms.txt'),
      llmsFullTxt: presenceFichier('llms-full.txt'),
      waf: null,
      urlsConnues: pages.map((p) => p.url),
    },
    erreurs: [],
    exploration: { pages: pages.length, limite_atteinte: false },
  }
}
