// SEO control catalogue and engine: turns extracted facts (see extraire.mjs) into findings.
// Pure functions, no I/O. Finding shape: { controle, severite, lot, pages: [url], preuve, priorite }.

const POIDS = { bloquant: 3, important: 2, mineur: 1 }

export const CATALOGUE = [
  ['T-TITLE-ABSENT', 'bloquant', 'meta', 'Pas de title ou title vide'],
  ['T-TITLE-DOUBLON', 'important', 'meta', 'Même title sur au moins deux pages'],
  ['T-TITLE-LONGUEUR', 'mineur', 'meta', 'Title hors de 30 à 60 caractères'],
  ['T-DESC-ABSENT', 'important', 'meta', 'Pas de meta description'],
  ['T-DESC-DOUBLON', 'important', 'meta', 'Même description sur au moins deux pages'],
  ['T-DESC-LONGUEUR', 'mineur', 'meta', 'Description hors de 70 à 160 caractères'],
  ['T-CANONICAL-ABSENT', 'mineur', 'meta', 'Pas de canonical'],
  ['T-CANONICAL-INVALIDE', 'important', 'meta', 'Canonical relatif ou vers un autre domaine'],
  ['T-ROBOTS-NOINDEX', 'bloquant', 'indexation', 'noindex sur une page publique'],
  ['T-ROBOTSTXT-ABSENT', 'mineur', 'indexation', 'robots.txt absent'],
  ['T-ROBOTSTXT-BLOQUE-TOUT', 'bloquant', 'indexation', 'Disallow: / pour User-agent: *'],
  ['T-SITEMAP-ABSENT', 'important', 'indexation', 'Sitemap absent'],
  ['T-SITEMAP-INCOHERENT', 'mineur', 'indexation', 'Page connue absente du sitemap, ou URL du sitemap inconnue'],
  ['T-HTTP-ERREUR', 'important', 'indexation', 'URL interne en erreur HTTP (4xx, 5xx), redirigée hors du site ou par une chaîne trop longue (mode URL)'],
  ['T-HREFLANG-INCOHERENT', 'important', 'international', 'hreflang sans réciproque ou sans x-default quand au moins deux langues'],
  ['T-LANG-ABSENT', 'important', 'international', "Pas d'attribut lang"],
  ['T-OG-ABSENT', 'mineur', 'partage', 'og:title ou og:description absent'],
  ['T-H1-ABSENT', 'important', 'structure', 'Aucun h1'],
  ['T-H1-MULTIPLE', 'mineur', 'structure', "Plus d'un h1"],
  ['T-HN-SAUT', 'mineur', 'structure', 'Saut de niveau de titre (h2 puis h4)'],
  ['T-ALT-ABSENT', 'important', 'images', "Image sans attribut alt"],
  ['T-IMG-DIMENSIONS', 'mineur', 'performance', 'Image sans width et height'],
  ['T-LIEN-CASSE', 'important', 'liens', 'Lien interne vers une URL inconnue'],
  ['T-PAGE-ORPHELINE', 'mineur', 'liens', 'Page connue sans lien entrant'],
  ['T-SPA-HTML-VIDE', 'bloquant', 'architecture', 'HTML servi sans contenu (coquille de SPA)'],
  ['T-JSONLD-INVALIDE', 'important', 'donnees-structurees', 'JSON-LD non parsable ou sans @type'],
  ['T-JSONLD-INTERDIT', 'bloquant', 'donnees-structurees', 'AggregateRating ou Review présent (à justifier par de vrais avis visibles)'],
  ['C-PAGE-PAUVRE', 'mineur', 'contenu', 'Moins de 300 mots visibles'],
  ['C-ANCRE-GENERIQUE', 'mineur', 'contenu', 'Ancre de lien générique (« cliquez ici », « en savoir plus »…)'],
].map(([id, severite, lot, description]) => ({ id, severite, lot, description }))

const DUMMY = 'http://local.invalid'
const vide = (s) => s == null || String(s).trim() === ''
const norm = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase()
const ANCRES = new Set(['cliquez ici', 'ici', 'en savoir plus', 'lire la suite', 'click here', 'here', 'read more'])

// Resolve a URL against a base; null if unparsable.
const resoudre = (href, base) => { try { return new URL(href, base) } catch { return null } }
const chemin = (u) => {
  let p = u.pathname
  try { p = decodeURI(p) } catch { /* keep raw */ }
  p = p.replace(/\/(index\.(html?|php))$/i, '/')
  return p.length > 1 ? p.replace(/\/+$/, '') : '/'
}
const hote = (u) => (u.host === 'local.invalid' ? null : u.host)

// Internal link target pathname of `href` seen from `page`, or null (external / ignored).
function cibleInterne(href, page, origine) {
  if (vide(href)) return null
  const h = href.trim()
  if (h.startsWith('#') || /^(mailto|tel|javascript|sms|data):/i.test(h)) return null
  const base = resoudre(page.url, DUMMY)
  const u = base && resoudre(h, base)
  if (!u || !/^https?:$/.test(u.protocol)) return null
  const interne = new Set([hote(base), origine ? resoudre(origine)?.host : null].filter(Boolean))
  const hu = hote(u)
  // Without a known origin, any absolute link to a real host is external.
  if (hu !== null && !interne.has(hu)) return null
  // Non-page assets (pdf, images...) are not part of the page graph.
  const ext = /\.([a-z0-9]+)$/i.exec(u.pathname.split("/").pop())
  if (ext && !/^(html?|php)$/i.test(ext[1])) return null
  return chemin(u)
}

function groupeRobotsBloqueTout(txt) {
  let agents = [], enAgents = false, bloque = false
  for (const brut of txt.split(/\r?\n/)) {
    const l = brut.replace(/#.*/, '').trim()
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(l)
    if (!m) continue
    const cle = m[1].toLowerCase()
    if (cle === 'user-agent') {
      if (!enAgents) agents = []
      agents.push(m[2].trim()); enAgents = true
    } else {
      enAgents = false
      if (cle === 'disallow' && m[2].trim() === '/' && agents.includes('*')) bloque = true
    }
  }
  return bloque
}

function pathsSitemap(xml) {
  const out = []
  for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const u = resoudre(m[1].replace(/&amp;/g, '&'), DUMMY)
    if (u) out.push({ loc: m[1], chemin: chemin(u) })
  }
  return out
}

// Walk a JSON-LD tree and collect every @type string.
function typesJsonld(noeud, acc = []) {
  if (Array.isArray(noeud)) noeud.forEach((n) => typesJsonld(n, acc))
  else if (noeud && typeof noeud === 'object') {
    const t = noeud['@type']
    for (const x of Array.isArray(t) ? t : t === undefined ? [] : [t]) if (typeof x === 'string') acc.push(x)
    for (const v of Object.values(noeud)) typesJsonld(v, acc)
  }
  return acc
}
function aType(noeud) {
  if (Array.isArray(noeud)) return noeud.length > 0 && noeud.every(aType)
  if (!noeud || typeof noeud !== 'object') return false
  if (noeud['@type'] !== undefined && noeud['@type'] !== '') return true
  return Array.isArray(noeud['@graph']) && noeud['@graph'].length > 0 && noeud['@graph'].every(aType)
}

// Per-page checks: return an evidence string when the page is affected, else null.
const PAR_PAGE = {
  'T-TITLE-ABSENT': (p) => (vide(p.title) ? 'title absent ou vide' : null),
  'T-TITLE-LONGUEUR': (p) => { const n = vide(p.title) ? 0 : p.title.trim().length; return n && (n < 30 || n > 60) ? `title de ${n} caractères` : null },
  'T-DESC-ABSENT': (p) => (vide(p.description) ? 'meta description absente ou vide' : null),
  'T-DESC-LONGUEUR': (p) => { const n = vide(p.description) ? 0 : p.description.trim().length; return n && (n < 70 || n > 160) ? `description de ${n} caractères` : null },
  'T-CANONICAL-ABSENT': (p) => (vide(p.canonical) ? 'aucun link rel=canonical' : null),
  'T-CANONICAL-INVALIDE': (p, s) => {
    if (vide(p.canonical)) return null
    const c = p.canonical.trim()
    if (!/^https?:\/\//i.test(c)) return `canonical relatif : ${c}`
    const o = s.origine && resoudre(s.origine)
    return o && resoudre(c)?.host !== o.host ? `canonical vers un autre domaine : ${c}` : null
  },
  'T-ROBOTS-NOINDEX': (p) => (/\b(noindex|none)\b/i.test(p.robots ?? '') ? `meta robots : ${p.robots}` : null),
  'T-LANG-ABSENT': (p) => (vide(p.lang) ? 'attribut lang absent sur <html>' : null),
  'T-OG-ABSENT': (p) => {
    const m = [vide(p.og?.title) && 'og:title', vide(p.og?.description) && 'og:description'].filter(Boolean)
    return m.length ? `manquant : ${m.join(', ')}` : null
  },
  'T-H1-ABSENT': (p) => (p.hn.some((h) => h.niveau === 1) ? null : 'aucun h1'),
  'T-H1-MULTIPLE': (p) => { const n = p.hn.filter((h) => h.niveau === 1).length; return n > 1 ? `${n} h1` : null },
  'T-HN-SAUT': (p) => {
    for (let i = 1; i < p.hn.length; i++) if (p.hn[i].niveau > p.hn[i - 1].niveau + 1) return `h${p.hn[i - 1].niveau} suivi de h${p.hn[i].niveau} (« ${p.hn[i].texte} »)`
    return null
  },
  'T-ALT-ABSENT': (p) => { const n = p.images.filter((i) => i.alt === null).length; return n ? `${n} image(s) sans alt, ex. ${p.images.find((i) => i.alt === null).src}` : null },
  'T-IMG-DIMENSIONS': (p) => { const l = p.images.filter((i) => vide(i.width) || vide(i.height)); return l.length ? `${l.length} image(s) sans width/height, ex. ${l[0].src}` : null },
  // A short page alone is not a SPA shell: an empty mount container (#app, #root...) is required.
  'T-SPA-HTML-VIDE': (p) => (p.corpsVide && p.montageSpa ? `corps quasi vide (${p.mots} mots visibles) autour d'un conteneur de montage d'application` : null),
  'T-JSONLD-INVALIDE': (p) => {
    for (const j of p.jsonld) {
      if (j.erreur) return `JSON-LD non parsable : ${j.erreur}`
      if (j.objet != null && !aType(j.objet)) return 'JSON-LD sans @type'
    }
    return null
  },
  'T-JSONLD-INTERDIT': (p) => {
    const t = p.jsonld.flatMap((j) => typesJsonld(j.objet)).filter((x) => x === 'AggregateRating' || x === 'Review')
    return t.length ? `type interdit sans avis visibles : ${[...new Set(t)].join(', ')}` : null
  },
  'C-PAGE-PAUVRE': (p) => (p.mots < 300 ? `${p.mots} mots visibles` : null),
  'C-ANCRE-GENERIQUE': (p) => {
    const l = p.liens.filter((x) => ANCRES.has(norm((x.texte ?? '').replace(/[^\p{L}\p{N}]+/gu, ' '))))
    return l.length ? `${l.length} ancre(s) générique(s), ex. « ${l[0].texte.trim()} » → ${l[0].href}` : null
  },
}

export function controler(pages, site = {}) {
  const constats = []
  const meta = new Map(CATALOGUE.map((c) => [c.id, c]))
  const ajouter = (id, urls, preuve) => {
    const c = meta.get(id)
    const pagesU = [...new Set(urls)]
    constats.push({ controle: id, severite: c.severite, lot: c.lot, pages: pagesU, preuve, priorite: POIDS[c.severite] * pagesU.length })
  }
  const resume = (hits) => (hits.length === 1 ? hits[0].preuve : `${hits[0].preuve} (+ ${hits.length - 1} autre(s) page(s))`)

  // Per-page controls: one finding per control listing every affected page.
  for (const [id, test] of Object.entries(PAR_PAGE)) {
    const hits = []
    for (const p of pages) { const preuve = test(p, site); if (preuve) hits.push({ url: p.url, preuve }) }
    if (hits.length) ajouter(id, hits.map((h) => h.url), resume(hits))
  }

  // Duplicates: one finding per duplicated value.
  for (const [id, champ] of [['T-TITLE-DOUBLON', 'title'], ['T-DESC-DOUBLON', 'description']]) {
    const groupes = new Map()
    for (const p of pages) if (!vide(p[champ])) { const k = norm(p[champ]); groupes.set(k, [...(groupes.get(k) ?? []), p.url]) }
    for (const [valeur, urls] of groupes) if (urls.length >= 2) ajouter(id, urls, `${champ} identique sur ${urls.length} pages : « ${valeur.slice(0, 80)} »`)
  }

  // Site-level files.
  if (site.robotsTxt == null) ajouter('T-ROBOTSTXT-ABSENT', ['/robots.txt'], 'robots.txt introuvable')
  else if (groupeRobotsBloqueTout(site.robotsTxt)) ajouter('T-ROBOTSTXT-BLOQUE-TOUT', ['/robots.txt'], 'Disallow: / pour User-agent: *')
  if (site.sitemapXml == null && !site.sitemapNonLu) ajouter('T-SITEMAP-ABSENT', ['/sitemap.xml'], 'sitemap introuvable')

  // Known pages by pathname (collected pages + discovered URLs).
  const connus = new Map() // pathname -> url as given
  for (const u of [...pages.map((p) => p.url), ...(site.urlsConnues ?? [])]) {
    const r = resoudre(u, DUMMY)
    if (r && !connus.has(chemin(r))) connus.set(chemin(r), u)
  }
  // URLs that exist without a collected page (redirect sources, beyond the crawl cap, robots-blocked):
  // valid link targets, but kept out of the sitemap and orphan computations.
  const existantes = new Set()
  for (const u of site.urlsExistantes ?? []) { const r = resoudre(u, DUMMY); if (r) existantes.add(chemin(r)) }

  if (site.sitemapXml != null && !/<sitemapindex/i.test(site.sitemapXml)) {
    const entrees = pathsSitemap(site.sitemapXml)
    const dansSitemap = new Set(entrees.map((e) => e.chemin))
    const absentes = [...connus].filter(([c]) => !dansSitemap.has(c)).map(([, u]) => u)
    // With an incomplete crawl, a sitemap URL not reached proves nothing.
    const inconnues = site.limiteAtteinte ? [] : entrees.filter((e) => !connus.has(e.chemin) && !existantes.has(e.chemin)).map((e) => e.loc)
    if (absentes.length || inconnues.length) {
      const morceaux = []
      if (absentes.length) morceaux.push(`${absentes.length} page(s) absente(s) du sitemap, ex. ${absentes[0]}`)
      if (inconnues.length) morceaux.push(`${inconnues.length} URL du sitemap inconnue(s), ex. ${inconnues[0]}`)
      ajouter('T-SITEMAP-INCOHERENT', [...absentes, ...inconnues], morceaux.join(' ; '))
    }
  }

  // Hreflang: reciprocity among collected pages, x-default when 2+ languages.
  const parChemin = new Map()
  for (const p of pages) { const r = resoudre(p.url, DUMMY); if (r) parChemin.set(chemin(r), p) }
  const hl = []
  for (const p of pages) {
    if (!p.hreflang?.length) continue
    const self = resoudre(p.url, DUMMY)
    const probleme = []
    const langues = new Set(p.hreflang.map((h) => h.lang.toLowerCase()).filter((l) => l !== 'x-default'))
    if (langues.size >= 2 && !p.hreflang.some((h) => h.lang.toLowerCase() === 'x-default')) probleme.push('x-default manquant')
    for (const alt of p.hreflang) {
      const r = resoudre(alt.href, self)
      const autre = r && parChemin.get(chemin(r))
      if (!autre || autre === p) continue
      const retour = (autre.hreflang ?? []).some((h) => { const t = resoudre(h.href, resoudre(autre.url, DUMMY)); return t && chemin(t) === chemin(self) })
      if (!retour) probleme.push(`${alt.href} ne référence pas cette page`)
    }
    if (probleme.length) hl.push({ url: p.url, preuve: probleme.join(', ') })
  }
  if (hl.length) ajouter('T-HREFLANG-INCOHERENT', hl.map((h) => h.url), resume(hl))

  // Links: broken internal links and orphan pages.
  const casses = []
  const entrants = new Set()
  for (const p of pages) {
    const self = resoudre(p.url, DUMMY)
    for (const l of p.liens) {
      const c = cibleInterne(l.href, p, site.origine)
      if (c === null) continue
      if (!connus.has(c) && !existantes.has(c)) casses.push({ url: p.url, preuve: `lien vers ${l.href} (URL inconnue)` })
      else if (!self || c !== chemin(self)) entrants.add(c)
    }
  }
  if (casses.length) ajouter('T-LIEN-CASSE', [...new Set(casses.map((c) => c.url))], resume(casses))
  // HTTP anomalies seen while crawling (URL mode only).
  const anomalies = site.anomaliesHttp ?? []
  if (anomalies.length) ajouter('T-HTTP-ERREUR', anomalies.map((a) => a.url), resume(anomalies))

  if (connus.size >= 2) {
    const orphelines = [...connus].filter(([c]) => c !== '/' && !entrants.has(c)).map(([, u]) => u)
    if (orphelines.length) ajouter('T-PAGE-ORPHELINE', orphelines, `${orphelines.length} page(s) sans lien entrant, ex. ${orphelines[0]}`)
  }

  const rang = new Map(CATALOGUE.map((c, i) => [c.id, i]))
  return constats.sort((a, b) => b.priorite - a.priorite || rang.get(a.controle) - rang.get(b.controle))
}
