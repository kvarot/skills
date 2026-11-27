// Deterministic technical and AI-access controls over a Collecte.
// CATALOGUE is the single registry of every constat id of the plugin: later tasks (entity, content)
// append one `def(...)` line here and one section in references/constats.md; the parity test checks both.
import { extrait } from './sortie.mjs'
import { analyserRobots, evaluerRobotsIa } from './robots.mjs'
import { lireSitemap } from './collecter.mjs'

const def = (id, severite, categorie, description, classe = 'deterministe') => ({ id, severite, categorie, classe, description })

export const CATALOGUE = [
  // indexation
  def('GEO-NOINDEX', 'bloquant', 'indexation', 'Page exclue de l’index par une directive noindex (balise meta robots ou en-tête X-Robots-Tag).'),
  def('GEO-ROBOTSTXT-BLOQUE-TOUT', 'bloquant', 'indexation', 'Le robots.txt interdit tout le site à tous les robots (User-agent: * et Disallow: /).'),
  def('GEO-SITEMAP-ABSENT', 'important', 'indexation', 'Aucun sitemap trouvé (ni déclaré dans robots.txt, ni à /sitemap.xml).'),
  def('GEO-SITEMAP-INCOHERENT', 'mineur', 'indexation', 'Le sitemap liste des URL inutilisables : en erreur, en noindex, canoniques ailleurs, d’un autre hôte, ou sitemap illisible.'),
  def('GEO-CANONICAL-ABSENT', 'mineur', 'indexation', 'Page sans balise link rel=canonical.'),
  def('GEO-CANONICAL-AUTRE-HOTE', 'important', 'indexation', 'La balise canonical pointe vers un autre hôte que celui de la page.'),
  def('GEO-HTTP-ERREUR', 'important', 'indexation', 'URL du site répondant par une erreur HTTP 4xx ou 5xx.'),
  def('GEO-REDIRECTION-CHAINE', 'mineur', 'indexation', 'Chaîne de plus de 2 redirections avant la page finale.'),
  def('GEO-PROFONDEUR', 'mineur', 'indexation', 'Page à plus de 3 clics de la page de départ.'),
  def('GEO-PAGE-ORPHELINE', 'mineur', 'indexation', 'Page listée dans le sitemap mais sans aucun lien entrant depuis les pages explorées.'),
  def('GEO-CONTENU-DUPLIQUE', 'important', 'indexation', 'Plusieurs URL avec le même texte visible et sans canonical commun.'),
  // robots-ia
  def('GEO-ROBOTS-RECHERCHE-BLOQUE', 'bloquant', 'robots-ia', 'Un robot d’indexation documenté (recherche) est bloqué par robots.txt sur des pages publiques.'),
  def('GEO-ROBOTS-CONSULTATION-BLOQUE', 'important', 'robots-ia', 'Un robot de consultation à la demande de l’utilisateur, documenté, est bloqué par robots.txt.'),
  def('GEO-ROBOTS-ENTRAINEMENT-POLITIQUE', 'information', 'robots-ia', 'Politique observée dans robots.txt pour les robots d’entraînement documentés, sans recommandation.'),
  def('GEO-WAF-DEFI', 'bloquant', 'robots-ia', 'Un défi CDN / WAF bloque l’accès automatisé : les pages défiées ne sont pas analysées.'),
  def('GEO-NOSNIPPET', 'important', 'robots-ia', 'nosnippet ou max-snippet:0 empêche l’affichage d’extraits, donc la citation.'),
  def('GEO-LLMSTXT', 'information', 'robots-ia', 'Présence ou absence de /llms.txt (information seulement, poids nul dans tout score).'),
  def('GEO-CONTENT-SIGNAL', 'information', 'robots-ia', 'Directive Content-Signal relevée dans robots.txt (valeur brute, non évaluée).'),
  // rendu
  def('GEO-HTML-VIDE', 'bloquant', 'rendu', 'Le HTML reçu n’a quasiment pas de texte (page rendue côté client ou coquille vide), hors défi WAF.'),
  def('GEO-VIEWPORT-ABSENT', 'mineur', 'rendu', 'Pas de balise meta viewport.'),
  // structure
  def('GEO-TITLE-ABSENT', 'bloquant', 'structure', 'Page sans balise title.'),
  def('GEO-TITLE-DOUBLON', 'important', 'structure', 'Plusieurs pages partagent le même title.'),
  def('GEO-DESC-ABSENT', 'mineur', 'structure', 'Page sans meta description.'),
  def('GEO-H1-ABSENT', 'important', 'structure', 'Page sans titre de niveau 1.'),
  def('GEO-HN-SAUT', 'mineur', 'structure', 'Saut de niveau dans la hiérarchie des titres (par exemple h2 puis h4).'),
  def('GEO-ALT-ABSENT', 'mineur', 'structure', 'Images sans attribut alt (alt="" est valide pour une image décorative).'),
  def('GEO-LANG-ABSENT', 'important', 'structure', 'Pas d’attribut lang sur l’élément html.'),
  // international
  def('GEO-HREFLANG-RECIPROQUE', 'important', 'international', 'Un hreflang désigne une page explorée qui ne renvoie pas vers la première.'),
  def('GEO-HREFLANG-XDEFAULT', 'mineur', 'international', 'Des hreflang sont déclarés sans entrée x-default.'),
  // données structurées
  def('GEO-JSONLD-INVALIDE', 'important', 'donnees-structurees', 'Bloc JSON-LD illisible (JSON invalide).'),
  def('GEO-JSONLD-AVIS-NON-VISIBLES', 'important', 'donnees-structurees', 'AggregateRating ou Review dont la note n’apparaît pas dans le texte visible de la page.'),
  // fraîcheur
  def('GEO-DATE-ABSENTE', 'mineur', 'contenu', 'Aucune date de publication ni de modification sur une page d’article ou de documentation.', 'heuristique'),
]

const PAR_ID = new Map(CATALOGUE.map((e, i) => [e.id, { ...e, rang: i }]))

// --- helpers ----------------------------------------------------------------

const tri = (liste) => [...new Set(liste)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
const texte = (v) => (typeof v === 'string' ? v : '')
const BASE = 'http://base.invalid'

// Path + query of a same-host (or relative) URL; null when the URL is on another host.
function cleChemin(u, hote) {
  try {
    const x = new URL(u, BASE)
    if (x.origin !== BASE && hote && x.host !== hote) return null
    return x.pathname + x.search
  } catch { return null }
}

const raisonErreur = (e) => texte(e?.raison ?? e?.erreur)

// JSON-LD nodes (object, array members, @graph members), bounded depth.
function noeuds(jsonld) {
  const out = []
  const visiter = (x, prof) => {
    if (prof > 6 || x === null || typeof x !== 'object') return
    if (Array.isArray(x)) { for (const e of x) visiter(e, prof + 1); return }
    out.push(x)
    for (const v of Object.values(x)) if (v && typeof v === 'object') visiter(v, prof + 1)
  }
  for (const j of jsonld ?? []) if (j?.objet) visiter(j.objet, 0)
  return out
}
const types = (n) => [].concat(n?.['@type'] ?? []).map(String)

const MOTIF_NOINDEX = /(^|[\s,:])(noindex|none)(?=$|[\s,])/i
const MOTIF_NOSNIPPET = /(^|[\s,:])nosnippet(?=$|[\s,])|max-snippet\s*:\s*0(?![\d.])/i

// --- checks: each returns raw constats { id, pages, preuve, detail, extrait? } --------------

function controlesIndexation(c, ctx) {
  const { pages, site } = c
  const sortie = []

  // noindex
  const meta = pages.filter((p) => MOTIF_NOINDEX.test(texte(p.robots)))
  const entete = pages.filter((p) => MOTIF_NOINDEX.test(texte(p.entetes?.x_robots_tag)))
  if (meta.length || entete.length) {
    const tous = tri([...meta, ...entete].map((p) => p.url))
    const parts = []
    if (meta.length) parts.push(`balise meta robots : ${meta.length} page(s)`)
    if (entete.length) parts.push(`en-tête x-robots-tag : ${entete.length} page(s)`)
    sortie.push({ id: 'GEO-NOINDEX', pages: tous,
      preuve: { type: meta.length ? 'html' : 'http', url: tous[0], detail: `directive noindex (${parts.join(' ; ')}). Vérifier : curl -sI <url> et la balise <meta name="robots">.` },
      detail: `Directive noindex sur ${tous.length} page(s) (${parts.join(' ; ')}).` })
  }

  // robots.txt blocking everything
  if (typeof site.robotsTxt === 'string' && !analyserRobots(site.robotsTxt).autorise('*', '/')) {
    sortie.push({ id: 'GEO-ROBOTSTXT-BLOQUE-TOUT', pages: [],
      preuve: { type: 'robots', url: ctx.racine + '/robots.txt', detail: 'Le groupe User-agent: * interdit « / » (évaluation RFC 9309).' },
      detail: 'Le robots.txt interdit tout le site aux robots sans règle propre.' })
  }

  // sitemaps
  const sitemaps = site.sitemaps ?? []
  const urlsSitemap = [...sitemaps.flatMap((s) => s.urls ?? [])]
  if (typeof site.sitemapXml === 'string') urlsSitemap.push(...lireSitemap(site.sitemapXml).locs)
  const aSitemap = sitemaps.length > 0 || typeof site.sitemapXml === 'string'
  if (!aSitemap && !site.waf?.detecte) {
    sortie.push({ id: 'GEO-SITEMAP-ABSENT', pages: [],
      preuve: { type: 'sitemap', url: ctx.racine + '/sitemap.xml', detail: 'Aucun sitemap déclaré dans robots.txt ni présent à /sitemap.xml.' },
      detail: 'Aucun sitemap n’a été trouvé.' })
  }

  // HTTP errors (4xx / 5xx), excluding robots.txt, llms files and sitemaps themselves
  const urlsSitemapsLus = new Set(sitemaps.map((s) => s.url))
  const enErreur = new Map()
  for (const e of c.erreurs ?? []) {
    const m = /^statut ([45]\d\d)/.exec(raisonErreur(e))
    if (!m || !e.url) continue
    if (/\/(robots\.txt|llms(-full)?\.txt)$/i.test(e.url) || urlsSitemapsLus.has(e.url) || /sitemap[^/]*\.xml$/i.test(e.url)) continue
    enErreur.set(e.url, m[1])
  }
  for (const p of pages) if (p.statut >= 400) enErreur.set(p.url, String(p.statut))
  if (enErreur.size) {
    const liste = tri([...enErreur.keys()])
    sortie.push({ id: 'GEO-HTTP-ERREUR', pages: liste,
      preuve: { type: 'http', url: liste[0], detail: `statut ${enErreur.get(liste[0])} (curl -sI ${liste[0]})` },
      detail: `${liste.length} URL en erreur HTTP.` })
  }

  // sitemap coherence: listed URLs that are in error, noindex, canonical elsewhere, on another host; unreadable sitemap
  const parCle = new Map(pages.map((p) => [cleChemin(p.url, ctx.hote), p]))
  const cleErreurs = new Set([...enErreur.keys()].map((u) => cleChemin(u, ctx.hote)))
  const incoherentes = []
  for (const u of urlsSitemap) {
    const k = cleChemin(u, ctx.hote)
    if (k === null) { incoherentes.push(u); continue }
    if (cleErreurs.has(k)) { incoherentes.push(u); continue }
    const p = parCle.get(k)
    if (!p) continue
    const canon = p.canonical ? cleChemin(p.canonical, ctx.hote) : k
    if (MOTIF_NOINDEX.test(texte(p.robots)) || MOTIF_NOINDEX.test(texte(p.entetes?.x_robots_tag)) || canon !== k) incoherentes.push(u)
  }
  const illisibles = sitemaps.filter((s) => s.erreur)
  if (incoherentes.length || illisibles.length) {
    const liste = tri(incoherentes)
    const urlPreuve = liste[0] ?? illisibles[0].url
    sortie.push({ id: 'GEO-SITEMAP-INCOHERENT', pages: liste,
      preuve: { type: 'sitemap', url: urlPreuve, detail: `${liste.length} URL incohérente(s) listée(s) dans le sitemap, ${illisibles.length} sitemap(s) illisible(s).` },
      detail: `${liste.length} URL du sitemap en erreur, en noindex, canoniques ailleurs ou d’un autre hôte ; ${illisibles.length} sitemap(s) illisible(s).` })
  }

  // canonical
  const sansCanonical = pages.filter((p) => !p.canonical)
  if (sansCanonical.length) {
    const l = tri(sansCanonical.map((p) => p.url))
    sortie.push({ id: 'GEO-CANONICAL-ABSENT', pages: l, preuve: { type: 'html', url: l[0], detail: `Aucun <link rel="canonical"> sur ${l.length} page(s).` }, detail: `${l.length} page(s) sans canonical.` })
  }
  const autreHote = pages.filter((p) => {
    if (!p.canonical) return false
    try { return new URL(p.canonical).host !== new URL(p.url).host } catch { return false }
  })
  if (autreHote.length) {
    const l = tri(autreHote.map((p) => p.url))
    sortie.push({ id: 'GEO-CANONICAL-AUTRE-HOTE', pages: l, preuve: { type: 'html', url: l[0], detail: `canonical vers un autre hôte (${autreHote.length} page(s)) : relire la balise <link rel="canonical"> de la page.` }, detail: `${l.length} page(s) dont le canonical pointe vers un autre hôte.` })
  }

  // redirect chains and depth
  const chaines = pages.filter((p) => (p.redirections ?? []).length > 2)
  if (chaines.length) {
    const l = tri(chaines.map((p) => p.url))
    const n = Math.max(...chaines.map((p) => p.redirections.length))
    sortie.push({ id: 'GEO-REDIRECTION-CHAINE', pages: l, preuve: { type: 'http', url: l[0], detail: `jusqu’à ${n} redirections (curl -sIL ${l[0]})` }, detail: `${l.length} page(s) atteintes après plus de 2 redirections.` })
  }
  const profondes = pages.filter((p) => p.profondeur > 3)
  if (profondes.length) {
    const l = tri(profondes.map((p) => p.url))
    const n = Math.max(...profondes.map((p) => p.profondeur))
    sortie.push({ id: 'GEO-PROFONDEUR', pages: l, preuve: { type: 'calcul', url: l[0], detail: `profondeur maximale ${n} clics (plus court chemin depuis la page de départ)` }, detail: `${l.length} page(s) à plus de 3 clics.` })
  }

  // orphans: in the sitemap, no inbound link from another explored page
  const entrants = new Set()
  for (const p of pages) {
    const soi = cleChemin(p.url, ctx.hote)
    for (const l of p.liens ?? []) {
      const k = cleChemin(new URL(texte(l.href) || '.', new URL(p.url, BASE)).href, ctx.hote)
      if (k !== null && k !== soi) entrants.add(k)
    }
  }
  const erreursUrls = new Set((c.erreurs ?? []).map((e) => cleChemin(texte(e.url), ctx.hote)))
  const reperees = new Set(pages.flatMap((p) => [cleChemin(p.url, ctx.hote), ...(p.redirections ?? []).map((r) => cleChemin(r, ctx.hote))]))
  const orphelines = []
  for (const u of new Set(urlsSitemap)) {
    const k = cleChemin(u, ctx.hote)
    if (k === null || entrants.has(k) || erreursUrls.has(k) || site.waf?.detecte) continue
    const p = parCle.get(k)
    if (p) { if (p.profondeur > 0) orphelines.push(p.url) }
    else if (!reperees.has(k) && !c.exploration?.limite_atteinte && pages.length) orphelines.push(u)
  }
  if (orphelines.length) {
    const l = tri(orphelines)
    sortie.push({ id: 'GEO-PAGE-ORPHELINE', pages: l, preuve: { type: 'sitemap', url: l[0], detail: `${l.length} URL du sitemap sans lien entrant dans les pages explorées.` }, detail: `${l.length} page(s) du sitemap sans lien entrant.` })
  }

  // duplicated content: same text fingerprint, no common canonical
  const groupes = new Map()
  for (const p of pages) {
    if (!p.empreinte_texte || p.corpsVide) continue
    if (!groupes.has(p.empreinte_texte)) groupes.set(p.empreinte_texte, [])
    groupes.get(p.empreinte_texte).push(p)
  }
  const dupliquees = []
  for (const g of groupes.values()) {
    if (g.length < 2) continue
    const cles = g.map((p) => (p.canonical ? cleChemin(p.canonical, ctx.hote) : null))
    if (cles[0] !== null && cles.every((k) => k === cles[0])) continue
    dupliquees.push(...g.map((p) => p.url))
  }
  if (dupliquees.length) {
    const l = tri(dupliquees)
    sortie.push({ id: 'GEO-CONTENU-DUPLIQUE', pages: l, preuve: { type: 'calcul', url: l[0], detail: `même empreinte SHA-256 du texte visible sur ${l.length} URL, sans canonical commun` }, detail: `${l.length} URL partagent le même texte visible sans canonical commun.` })
  }
  return sortie
}

function controlesRobotsIa(c, ctx, registre) {
  const { pages, site } = c
  const sortie = []
  const racine = ctx.racine

  if (typeof site.robotsTxt === 'string') {
    const parChemin = new Map([['/', racine + '/']])
    for (const p of pages) { const k = cleChemin(p.url, ctx.hote); if (k !== null) parChemin.set(k, p.url) }
    const verdicts = evaluerRobotsIa(site.robotsTxt, [...parChemin.keys()], registre).filter((v) => v.documente)
    const bloques = (role) => verdicts.filter((v) => v.role === role && v.chemins_bloques.length)
    const pagesDe = (liste) => tri(liste.flatMap((v) => v.chemins_bloques.map((k) => parChemin.get(k))))
    const preuveRobots = (liste, ce) => ({ type: 'robots', url: racine + '/robots.txt', detail: `${liste.map((v) => v.jeton).join(', ')} : ${ce} (groupe appliqué : ${liste[0].groupe}) ; évaluation RFC 9309 de robots.txt` })

    const recherche = bloques('indexation')
    if (recherche.length) {
      sortie.push({ id: 'GEO-ROBOTS-RECHERCHE-BLOQUE', pages: pagesDe(recherche), preuve: preuveRobots(recherche, 'robot d’indexation bloqué'),
        detail: `Robot(s) d’indexation documenté(s) bloqué(s) par robots.txt : ${recherche.map((v) => v.jeton).join(', ')}.` })
    }
    const consultation = bloques('consultation-utilisateur')
    if (consultation.length) {
      sortie.push({ id: 'GEO-ROBOTS-CONSULTATION-BLOQUE', pages: pagesDe(consultation), preuve: preuveRobots(consultation, 'robot de consultation bloqué'),
        detail: `Robot(s) de consultation à la demande bloqué(s) par robots.txt : ${consultation.map((v) => v.jeton).join(', ')}. Plusieurs éditeurs indiquent que robots.txt peut ne pas s’appliquer à ces robots.` })
    }
    const entrainement = verdicts.filter((v) => v.role === 'entrainement')
    if (entrainement.length) {
      const bl = entrainement.filter((v) => v.chemins_bloques.length).map((v) => v.jeton)
      const ok = entrainement.filter((v) => !v.chemins_bloques.length).map((v) => v.jeton)
      sortie.push({ id: 'GEO-ROBOTS-ENTRAINEMENT-POLITIQUE', pages: [],
        preuve: { type: 'robots', url: racine + '/robots.txt', detail: `bloqués : ${bl.join(', ') || 'aucun'} ; non bloqués : ${ok.join(', ') || 'aucun'} (évaluation RFC 9309 de robots.txt)` },
        detail: `Politique observée pour les robots d’entraînement documentés. Bloqués : ${bl.join(', ') || 'aucun'}. Non bloqués : ${ok.join(', ') || 'aucun'}. Ce choix revient au propriétaire du site ; ce constat décrit l’état observé et ne contient aucune recommandation.` })
    }
    const signal = analyserRobots(site.robotsTxt).contentSignal
    if (signal) {
      sortie.push({ id: 'GEO-CONTENT-SIGNAL', pages: [], preuve: { type: 'robots', url: racine + '/robots.txt', detail: 'ligne Content-Signal du robots.txt (valeur brute dans l’extrait)' },
        detail: 'Directive Content-Signal relevée ; elle n’est pas évaluée ici.', extrait: extrait(signal) })
    }
  }

  if (site.waf?.detecte) {
    const pr = site.waf.preuve ?? {}
    const url = pr.url ?? racine + '/'
    sortie.push({ id: 'GEO-WAF-DEFI', pages: [url],
      preuve: { type: 'http', url, detail: `statut ${pr.statut ?? '?'} : ${pr.detail ?? 'défi détecté'} (curl -sI ${url})` },
      detail: `Un défi CDN / WAF a été détecté (${pr.detail ?? 'marqueur de défi'}) : la page n’est pas analysée comme contenu.` })
  }

  const meta = pages.filter((p) => p.nosnippet === true || MOTIF_NOSNIPPET.test(texte(p.robots)))
  const entete = pages.filter((p) => MOTIF_NOSNIPPET.test(texte(p.entetes?.x_robots_tag)))
  if (meta.length || entete.length) {
    const l = tri([...meta, ...entete].map((p) => p.url))
    sortie.push({ id: 'GEO-NOSNIPPET', pages: l,
      preuve: { type: meta.length ? 'html' : 'http', url: l[0], detail: `nosnippet ou max-snippet:0 (meta robots : ${meta.length} page(s) ; x-robots-tag : ${entete.length} page(s))` },
      detail: `${l.length} page(s) interdisent les extraits (nosnippet / max-snippet:0).` })
  }

  const llms = site.llmsTxt
  if (llms && typeof llms.present === 'boolean') {
    sortie.push({ id: 'GEO-LLMSTXT', pages: [],
      preuve: { type: 'http', url: racine + '/llms.txt', detail: `statut ${llms.statut ?? 'inconnu'} (curl -sI ${racine}/llms.txt)` },
      detail: `/llms.txt ${llms.present ? 'présent' : 'absent'} : information seulement, sans effet démontré sur la visibilité ; Google déclare ne pas l'utiliser.` })
  }
  return sortie
}

function controlesRendu(c, ctx) {
  const sortie = []
  const defiee = c.site.waf?.detecte ? c.site.waf.preuve?.url : null
  const vides = c.pages.filter((p) => p.corpsVide && p.url !== defiee)
  if (vides.length) {
    const l = tri(vides.map((p) => p.url))
    sortie.push({ id: 'GEO-HTML-VIDE', pages: l, preuve: { type: 'html', url: l[0], detail: `moins de 20 mots de texte visible dans le HTML reçu (${vides.length} page(s))` }, detail: `${l.length} page(s) au HTML quasiment vide (rendu côté client ou coquille vide).` })
  }
  const sansViewport = c.pages.filter((p) => !p.viewport)
  if (sansViewport.length) {
    const l = tri(sansViewport.map((p) => p.url))
    sortie.push({ id: 'GEO-VIEWPORT-ABSENT', pages: l, preuve: { type: 'html', url: l[0], detail: 'Aucune balise <meta name="viewport">' }, detail: `${l.length} page(s) sans meta viewport.` })
  }
  return sortie
}

function controlesStructure(c) {
  const { pages } = c
  const sortie = []
  const simple = (id, filtre, preuveDetail, detail) => {
    const fautives = pages.filter(filtre)
    if (!fautives.length) return
    const l = tri(fautives.map((p) => p.url))
    sortie.push({ id, pages: l, preuve: { type: 'html', url: l[0], detail: preuveDetail(fautives) }, detail: detail(l.length) })
  }
  simple('GEO-TITLE-ABSENT', (p) => !texte(p.title).trim(), () => 'Aucune balise <title> non vide', (n) => `${n} page(s) sans title.`)

  const titres = new Map()
  for (const p of pages) {
    const t = texte(p.title).replace(/\s+/g, ' ').trim().toLowerCase()
    if (!t) continue
    if (!titres.has(t)) titres.set(t, [])
    titres.get(t).push(p)
  }
  const doublons = [...titres.values()].filter((g) => g.length > 1)
  if (doublons.length) {
    const l = tri(doublons.flat().map((p) => p.url))
    sortie.push({ id: 'GEO-TITLE-DOUBLON', pages: l, preuve: { type: 'html', url: l[0], detail: `${doublons.length} titre(s) partagé(s) par ${l.length} pages` }, detail: `${doublons.length} title(s) en doublon sur ${l.length} pages.`, extrait: extrait(doublons[0][0].title) })
  }

  simple('GEO-DESC-ABSENT', (p) => !texte(p.description).trim(), () => 'Aucune <meta name="description"> non vide', (n) => `${n} page(s) sans meta description.`)
  simple('GEO-H1-ABSENT', (p) => !(p.hn ?? []).some((h) => h.niveau === 1), () => 'Aucun titre de niveau 1 dans le HTML', (n) => `${n} page(s) sans h1.`)
  simple('GEO-HN-SAUT', (p) => (p.hn ?? []).some((h, i, a) => i > 0 && h.niveau - a[i - 1].niveau > 1), () => 'Un titre dépasse le niveau précédent de plus d’un rang (ordre du document)', (n) => `${n} page(s) avec un saut de niveau de titres.`)

  const sansAlt = pages.map((p) => [p, (p.images ?? []).filter((i) => i.alt === null).length]).filter(([, n]) => n > 0)
  if (sansAlt.length) {
    const l = tri(sansAlt.map(([p]) => p.url))
    const total = sansAlt.reduce((s, [, n]) => s + n, 0)
    sortie.push({ id: 'GEO-ALT-ABSENT', pages: l, preuve: { type: 'html', url: l[0], detail: `${total} balise(s) <img> sans attribut alt` }, detail: `${total} image(s) sans attribut alt sur ${l.length} page(s).` })
  }
  simple('GEO-LANG-ABSENT', (p) => !texte(p.lang).trim(), () => 'Pas d’attribut lang sur <html>', (n) => `${n} page(s) sans attribut lang.`)
  return sortie
}

function controlesInternational(c, ctx) {
  const { pages } = c
  const sortie = []
  const parCle = new Map(pages.map((p) => [cleChemin(p.url, ctx.hote), p]))
  const cible = (p, h) => cleChemin(new URL(texte(h.href) || '.', new URL(p.url, BASE)).href, ctx.hote)
  const sansRetour = []
  for (const p of pages) {
    const soi = cleChemin(p.url, ctx.hote)
    for (const h of p.hreflang ?? []) {
      const k = cible(p, h)
      const autre = k !== null && k !== soi ? parCle.get(k) : null
      if (autre && !(autre.hreflang ?? []).some((r) => cible(autre, r) === soi)) { sansRetour.push(p.url); break }
    }
  }
  if (sansRetour.length) {
    const l = tri(sansRetour)
    sortie.push({ id: 'GEO-HREFLANG-RECIPROQUE', pages: l, preuve: { type: 'html', url: l[0], detail: `${l.length} page(s) désignent une page de langue alternative qui ne renvoie pas vers elles` }, detail: `${l.length} page(s) avec un hreflang non réciproque.` })
  }
  const sansDefaut = pages.filter((p) => (p.hreflang ?? []).length > 0 && !p.hreflang.some((h) => texte(h.lang).trim().toLowerCase() === 'x-default'))
  if (sansDefaut.length) {
    const l = tri(sansDefaut.map((p) => p.url))
    sortie.push({ id: 'GEO-HREFLANG-XDEFAULT', pages: l, preuve: { type: 'html', url: l[0], detail: 'hreflang déclarés sans <link rel="alternate" hreflang="x-default">' }, detail: `${l.length} page(s) avec hreflang mais sans x-default.` })
  }
  return sortie
}

// A rating value is "visible" when the number appears as its own token in the page text ("4.8" or "4,8").
function noteVisible(valeur, visible) {
  const v = String(valeur).trim()
  if (!/^\d+([.,]\d+)?$/.test(v)) return false
  const motif = v.replace(/[.,]/g, '[.,]')
  return new RegExp(`(?<!\\d)(?<!\\d[.,])${motif}(?!\\d)(?![.,]\\d)`).test(visible)
}

function controlesDonnees(c) {
  const sortie = []
  const invalides = c.pages.filter((p) => (p.jsonld ?? []).some((j) => j.erreur))
  if (invalides.length) {
    const l = tri(invalides.map((p) => p.url))
    const premier = invalides[0].jsonld.find((j) => j.erreur)
    sortie.push({ id: 'GEO-JSONLD-INVALIDE', pages: l, preuve: { type: 'jsonld', url: l[0], detail: `bloc <script type="application/ld+json"> illisible sur ${l.length} page(s) (erreur d’analyse JSON dans l’extrait)` }, detail: `${l.length} page(s) avec un bloc JSON-LD invalide.`, extrait: extrait(premier.erreur) })
  }
  const sansAvis = c.pages.filter((p) => {
    const valeurs = []
    for (const n of noeuds(p.jsonld)) {
      const t = types(n)
      if (t.includes('AggregateRating') && n.ratingValue !== undefined) valeurs.push(n.ratingValue)
      if (t.includes('Review') && n.reviewRating && n.reviewRating.ratingValue !== undefined) valeurs.push(n.reviewRating.ratingValue)
    }
    if (!valeurs.length) return false
    const visible = [...(p.blocs ?? []).map((b) => b.texte), ...(p.hn ?? []).map((h) => h.texte)].join('\n')
    return valeurs.some((v) => !noteVisible(v, visible))
  })
  if (sansAvis.length) {
    const l = tri(sansAvis.map((p) => p.url))
    sortie.push({ id: 'GEO-JSONLD-AVIS-NON-VISIBLES', pages: l, preuve: { type: 'jsonld', url: l[0], detail: `ratingValue d’un AggregateRating / Review absent du texte visible (${l.length} page(s))` }, detail: `${l.length} page(s) déclarent une note en JSON-LD qui n’apparaît pas dans le texte visible.` })
  }
  return sortie
}

const CHEMIN_ARTICLE = /\/(blog|articles?|actualites?|news|docs?|documentation|guides?|aide|support|ressources?)\/[^/?#]+/i

function controlesFraicheur(c) {
  const sansDate = c.pages.filter((p) => {
    if (p.dates?.publiee || p.dates?.modifiee) return false
    const typeArticle = noeuds(p.jsonld).some((n) => types(n).some((t) => /Article|BlogPosting/.test(t)))
    let chemin = ''
    try { chemin = new URL(p.url, BASE).pathname } catch { /* keep empty */ }
    return typeArticle || CHEMIN_ARTICLE.test(chemin)
  })
  if (!sansDate.length) return []
  const l = tri(sansDate.map((p) => p.url))
  return [{ id: 'GEO-DATE-ABSENTE', pages: l, preuve: { type: 'html', url: l[0], detail: `ni datePublished / dateModified, ni meta de date, ni <time datetime> (${l.length} page(s) d’article ou de documentation)` }, detail: `${l.length} page(s) d’article ou de documentation sans date.` }]
}

// --- entry point ----------------------------------------------------------------

// controler(collecte, registre) -> Constat[]: one constat per id (pages aggregated), ordered by CATALOGUE then id.
// Never throws on a partial Collecte.
export function controler(collecte, registre) {
  const c = {
    pages: Array.isArray(collecte?.pages) ? collecte.pages : [],
    site: collecte?.site ?? {},
    erreurs: Array.isArray(collecte?.erreurs) ? collecte.erreurs : [],
    exploration: collecte?.exploration ?? {},
  }
  const racine = texte(collecte?.origine) || texte(c.site.racine) || ''
  let hote = null
  try { hote = racine ? new URL(racine).host : null } catch { /* relative folder collection */ }
  const ctx = { racine, hote }

  const bruts = [
    ...controlesIndexation(c, ctx),
    ...controlesRobotsIa(c, ctx, registre),
    ...controlesRendu(c, ctx),
    ...controlesStructure(c, ctx),
    ...controlesInternational(c, ctx),
    ...controlesDonnees(c, ctx),
    ...controlesFraicheur(c, ctx),
  ]
  return bruts
    .map((b) => {
      const def = PAR_ID.get(b.id)
      if (!def) throw new Error('Constat hors catalogue : ' + b.id)
      const { rang, description, ...base } = def
      return { id: b.id, severite: base.severite, categorie: base.categorie, classe: base.classe, pages: b.pages, preuve: b.preuve, detail: b.detail, ...(b.extrait ? { extrait: b.extrait } : {}), rang }
    })
    .sort((a, b) => a.rang - b.rang)
    .map(({ rang, ...reste }) => reste)
}
