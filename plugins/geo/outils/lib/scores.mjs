// Transparent potential scores. Pure and synchronous: no I/O except reading the bundled weights file.
// Method, groupings and weight rationale live in SCORING.md; weights live in donnees/poids.json.
// A score is the weighted share of the criteria that could be computed; a criterion that cannot be
// computed is `acquis: null` and is left out of the denominator (it lowers coverage, never the value).
import { readFileSync } from 'node:fs'
import { normaliser } from './scenarios.mjs'
import { normaliser as normaliserUrl, lireSitemap } from './collecter.mjs'
import { estPageArticle } from './controles.mjs'

const URL_POIDS = new URL('../../donnees/poids.json', import.meta.url)
export const SEUIL_COUVERTURE = 0.5
const RAISON_MESURE = 'nécessite une mesure (v0.2)'
const SCORES_MESURES = ['autorite-thematique', 'reputation-externe', 'positionnement-concurrentiel', 'visibilite-mesuree']
const SEVERITES_COMPTEES = new Set(['bloquant', 'important', 'mineur'])

export function chargerPoids() {
  return JSON.parse(readFileSync(URL_POIDS, 'utf8'))
}

// --- Criterion definitions. kinds:
//   constats: "absence of a root cause" ; base = pages (all collected pages), contenu (supported content pages) or entite (site-level).
//   Each listed id is one cause of the group; the group weighs once (union of touched pages).
const cst = (base, ids, extra = {}) => ({ type: 'constats', base, ids, ...extra })

const DEFINITIONS = {
  'seo-technique': {
    'indexable': cst('pages', ['GEO-NOINDEX']),
    // One cause: robots.txt forbids everything, by its rules or by being unreachable (RFC 9309).
    'robots-txt-ouvert': cst('pages', ['GEO-ROBOTSTXT-BLOQUE-TOUT', 'GEO-ROBOTSTXT-INACCESSIBLE']),
    'reponses-http': cst('pages', ['GEO-HTTP-ERREUR'], { urls: true }),
    'titre-present': cst('pages', ['GEO-TITLE-ABSENT']),
    'canonical-meme-hote': cst('pages', ['GEO-CANONICAL-AUTRE-HOTE']),
    'contenu-unique': cst('pages', ['GEO-CONTENU-DUPLIQUE']),
    'h1-present': cst('pages', ['GEO-H1-ABSENT']),
    'titres-uniques': cst('pages', ['GEO-TITLE-DOUBLON']),
    'langue-declaree': cst('pages', ['GEO-LANG-ABSENT']),
    // Not evaluated when the sitemaps could not be read (refused by robots.txt, robots.txt unreachable).
    'sitemap-present': cst('pages', ['GEO-SITEMAP-ABSENT'], { si_sitemaps_non_lus: true }),
    'donnees-structurees-valides': cst('pages', ['GEO-JSONLD-INVALIDE']),
    'hreflang-reciproque': cst('pages', ['GEO-HREFLANG-RECIPROQUE']),
    'canonical-present': cst('pages', ['GEO-CANONICAL-ABSENT']),
    'description-presente': cst('pages', ['GEO-DESC-ABSENT']),
    'alt-presents': cst('pages', ['GEO-ALT-ABSENT']),
    'viewport-present': cst('pages', ['GEO-VIEWPORT-ABSENT']),
    'redirections-courtes': cst('pages', ['GEO-REDIRECTION-CHAINE']),
    'profondeur-faible': cst('pages', ['GEO-PROFONDEUR']),
    'pages-non-orphelines': cst('pages', ['GEO-PAGE-ORPHELINE'], { urls: true }),
    'sitemap-coherent': cst('pages', ['GEO-SITEMAP-INCOHERENT'], { urls: true, si_sitemaps_non_lus: true }),
    'hn-sans-saut': cst('pages', ['GEO-HN-SAUT']),
    'hreflang-xdefault': cst('pages', ['GEO-HREFLANG-XDEFAULT']),
  },
  'acces-ia': {
    // One cause: search crawlers cannot read the site (blanket Disallow, unreachable robots.txt, or a documented search robot blocked).
    'recherche-non-bloquee': cst('pages', ['GEO-ROBOTSTXT-BLOQUE-TOUT', 'GEO-ROBOTSTXT-INACCESSIBLE', 'GEO-ROBOTS-RECHERCHE-BLOQUE']),
    'pas-de-defi-waf': cst('pages', ['GEO-WAF-DEFI'], { urls: true }),
    'html-lisible': cst('pages', ['GEO-HTML-VIDE']),
    'consultation-non-bloquee': cst('pages', ['GEO-ROBOTS-CONSULTATION-BLOQUE'], { sauf: ['GEO-ROBOTSTXT-BLOQUE-TOUT', 'GEO-ROBOTSTXT-INACCESSIBLE'], sauf_preuve: 'même cause que recherche-non-bloquee (robots.txt bloque tout ou est inaccessible)' }),
  },
  'qualite-semantique': {
    'definition-presente': cst('contenu', ['GEO-CONTENU-AUCUNE-DEFINITION']),
    'sources-citees': cst('contenu', ['GEO-CONTENU-SANS-SOURCE']),
    'passages-autonomes': cst('contenu', ['GEO-CONTENU-PASSAGES-DEPENDANTS']),
    'chiffres-presents': { type: 'page-a-passage', critere: 'chiffre' },
    'structure-presente': { type: 'page-a-passage', critere: 'structure' },
  },
  'potentiel-citation': {
    'extraits-autorises': cst('pages', ['GEO-NOSNIPPET']),
    'passages-citables': { type: 'passages-citables' },
    'auteur-declare': cst('contenu', ['GEO-CONTENU-AUTEUR-ABSENT'], { articles: true }),
    'date-presente': cst('pages', ['GEO-DATE-ABSENTE'], { articles: true }),
    'avis-visibles': cst('pages', ['GEO-JSONLD-AVIS-NON-VISIBLES']),
  },
  'identite-numerique': {
    // Entity criteria need collected pages: with none, nothing was observed and nothing is credited.
    'organisation-declaree': cst('entite', ['GEO-ENTITE-SANS-ORGANIZATION']),
    // Not evaluated without a declared name (og:site_name, JSON-LD or --marque): coherence of nothing is not credited.
    'nom-coherent': cst('entite', ['GEO-ENTITE-NOM-INCOHERENT'], { si_noms: true }),
    // Not evaluated without a declared organisation (where contact data would live).
    'coordonnees-coherentes': cst('entite', ['GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'], { sauf: 'GEO-ENTITE-SANS-ORGANIZATION' }),
    // Not evaluated without a declared organisation: the missing organisation is already counted once above.
    'sameas-present': cst('entite', ['GEO-ENTITE-SAMEAS-ABSENT'], { sauf: 'GEO-ENTITE-SANS-ORGANIZATION' }),
    'wikidata': { type: 'wikidata' },
    'produits-balises': cst('entite', ['GEO-ENTITE-PRODUIT-SANS-SCHEMA'], { portee: 'pages' }),
  },
  'couverture-intentions': {
    'intentions-couvertes': { type: 'intentions' },
  },
}

// Every constat id read by at least one criterion (exported for the catalogue-coverage test).
export const CONSTATS_UTILISES = new Set(Object.values(DEFINITIONS).flatMap((s) => Object.values(s)).flatMap((d) => d.ids ?? []))

const ARRONDI = (x, d = 4) => Math.round(x * 10 ** d) / 10 ** d

// Distinct constats from the explicit list, the content results and the entity result.
function rassembler(entrees) {
  const vus = new Set()
  const sortie = []
  const sources = [
    ...(Array.isArray(entrees.constats) ? entrees.constats : []),
    ...(Array.isArray(entrees.contenu) ? entrees.contenu.flatMap((c) => c?.constats ?? []) : []),
    ...(entrees.entite && Array.isArray(entrees.entite.constats) ? entrees.entite.constats : []),
  ]
  for (const c of sources) {
    if (!c || typeof c.id !== 'string' || !SEVERITES_COMPTEES.has(c.severite)) continue // information never counts
    const cle = c.id + '|' + [...(c.pages ?? [])].sort().join(',')
    if (vus.has(cle)) continue
    vus.add(cle)
    sortie.push(c)
  }
  return sortie
}

const nul = (preuve) => ({ acquis: null, preuve })
const sur = (n, total) => `${n} page(s) sur ${total}`
const estContenu = (def) => def.base === 'contenu' || def.type === 'page-a-passage' || def.type === 'passages-citables'

// Normalised key of a URL (same normalisation as the collector), falling back to the raw string.
const cle = (u, base) => (typeof u === 'string' ? (normaliserUrl(u, base) ?? u) : '')

function evaluerConstats(def, ctx) {
  const noms = def.ids.join(' + ')
  const trouves = ctx.constats.filter((c) => def.ids.includes(c.id))
  const sauf = [].concat(def.sauf ?? [])
  const present = sauf.find((id) => ctx.constats.some((c) => c.id === id))
  if (present) return nul(`${noms} : non calculé, ${def.sauf_preuve ?? `${present} déjà compté`}`)
  if (def.si_sitemaps_non_lus && ctx.sitemapsNonLus) return nul(`${noms} : non calculé, sitemaps non lus (interdits par robots.txt ou robots.txt inaccessible)`)
  if (def.base === 'entite') {
    if (!ctx.entite) return nul(`${noms} : non calculé, analyse d’entité absente`)
    if (ctx.pages.length === 0) return nul(`${noms} : non calculé, aucune page collectée (rien d’observé sur l’entité)`)
    if (def.si_noms && !ctx.nomsDeclares) return nul(`${noms} : non calculé, aucun nom déclaré (og:site_name, JSON-LD ou --marque)`)
    if (def.portee !== 'pages') return { acquis: trouves.length ? 0 : 1, preuve: `${noms} : ${trouves.length ? 'présent' : 'absent'}` }
  }
  // A site-level constat (no page list) touches every page, whatever the number of collected pages (even none).
  if (trouves.some((c) => !c.pages || c.pages.length === 0)) return { acquis: 0, preuve: `${noms} : constat de site, touche toutes les pages` }
  const cles = (c) => c.pages.map((u) => cle(u, ctx.base))
  // Nothing collected because robots.txt bans everything: no page is readable by a robot.
  if (def.ids.includes('GEO-HTML-VIDE') && ctx.pages.length === 0 && ctx.constats.some((c) => c.id === 'GEO-ROBOTSTXT-BLOQUE-TOUT' || c.id === 'GEO-ROBOTSTXT-INACCESSIBLE')) {
    return { acquis: 0, preuve: `${noms} : aucune page lisible par un robot (robots.txt bloque tout ou est inaccessible, aucune page collectée)` }
  }

  if (def.urls) {
    // URL-based cause: the denominator is every URL known to the audit (collected pages, errors, sitemap), not only pages.
    const touchees = new Set(trouves.flatMap(cles))
    const connues = new Set([...ctx.pagesCles, ...ctx.urlsConnues, ...touchees])
    if (connues.size === 0) return nul(`${noms} : non calculé, aucune URL connue`)
    const acquis = ARRONDI(1 - touchees.size / connues.size)
    if (def.ids.includes('GEO-WAF-DEFI') && touchees.size > 0 && ctx.pages.length === 0) {
      return { acquis, preuve: `${noms} : défi WAF : aucune page analysable (${touchees.size} URL défiée(s))` }
    }
    return { acquis, preuve: `${noms} : ${touchees.size} URL sur ${connues.size} URL connues (pages collectées, URL en erreur, URL du sitemap)` }
  }

  let total, touchees
  if (def.articles) {
    // Content criteria (author) only see article pages analysed in a supported language with a passage;
    // other article pages are neither acquired nor touched. Date criteria see every article page.
    const arts = ctx.pages.filter((p) => estPageArticle(p) && (def.base !== 'contenu' || ctx.cleContenuAnalysable.has(cle(p.url, ctx.base))))
    if (arts.length === 0) return nul(`${noms} : non calculé, aucune page d’article ou de documentation${def.base === 'contenu' ? ' analysée en langue prise en charge' : ''}`)
    const dansArts = new Set(arts.map((p) => cle(p.url, ctx.base)))
    total = arts.length
    touchees = new Set(trouves.flatMap(cles).filter((k) => dansArts.has(k)))
  } else if (def.base === 'contenu') {
    total = ctx.cleContenuAnalysable.size
    touchees = new Set(trouves.flatMap(cles).filter((k) => ctx.cleContenuAnalysable.has(k)))
  } else {
    total = ctx.pages.length
    touchees = new Set(trouves.flatMap(cles).filter((k) => ctx.pagesCles.has(k)))
  }
  if (total === 0) {
    return nul(def.base === 'contenu'
      ? `${noms} : non calculé, aucune page de langue prise en charge (langue non prise en charge ou sans passage)`
      : `${noms} : non calculé, aucune page collectée`)
  }
  let n = Math.min(touchees.size, total)
  let note = ''
  // A present cause must never read as fully acquired: URLs outside the collected pages count for one page.
  // Only when some touched URL is genuinely not a collected page: URLs excluded by a filter (article, language) just do not count.
  const horsCollecte = trouves.flatMap(cles).some((k) => !ctx.pagesCles.has(k))
  if (trouves.length && n === 0 && horsCollecte) { n = 1; note = ' (constat sur des URL hors pages collectées, compté pour une page)' }
  return { acquis: ARRONDI(1 - n / total), preuve: `${noms} : ${sur(n, total)}${note}` }
}

function evaluerPageAPassage(def, ctx) {
  const total = ctx.passagesParPage.length
  if (total === 0) return nul(`part des pages avec un passage « ${def.critere} » : non calculé, aucune page de langue prise en charge`)
  const n = ctx.passagesParPage.filter((ps) => ps.some((p) => p.criteres?.[def.critere])).length
  return { acquis: ARRONDI(n / total), preuve: `passages « ${def.critere} » : ${sur(n, total)}` }
}

function evaluerPassagesCitables(ctx) {
  const tous = ctx.passagesParPage.flat()
  if (tous.length === 0) return nul('passages citables : non calculé, aucun passage analysé (langue non prise en charge ou aucun contenu)')
  const n = tous.filter((p) => (p.note ?? 0) >= 3).length
  return { acquis: ARRONDI(n / tous.length), preuve: `passages citables (au moins 3 critères sur 6) : ${n} passage(s) sur ${tous.length}` }
}

function evaluerWikidata(ctx) {
  const statut = ctx.entite?.wikidata?.statut
  if (statut === 'trouve') return { acquis: 1, preuve: 'wikidata.statut : trouve (une entrée dont le site officiel P856 est sur l’hôte audité)' }
  if (statut === 'libelle_identique') return nul('wikidata.statut : libelle_identique, non calculé (libellé identique trouvé, identité non vérifiée)')
  if (statut === 'absent') return nul('wikidata.statut : absent, non calculé (absence normale pour une petite structure, non pénalisée)')
  if (statut === 'ambigu') return nul('wikidata.statut : ambigu, non calculé (désambiguïsation à faire par le propriétaire)')
  return nul(`wikidata.statut : ${statut ?? 'inconnu'}, non calculé (vérification non faite)`)
}

const MOTS_VIDES = new Set(['les', 'des', 'une', 'dans', 'pour', 'avec', 'sur', 'par', 'que', 'qui', 'est', 'sont', 'aux', 'ces', 'cette', 'vous', 'nous', 'votre', 'vos', 'comment',
  'quel', 'quelle', 'quels', 'quelles', 'quoi', 'the', 'and', 'for', 'with', 'are', 'you', 'your', 'what', 'how', 'which', 'from', 'that', 'this'])
const mots = (texte) => new Set(normaliser(texte).split(' ').filter((m) => m.length >= 3 && !MOTS_VIDES.has(m)))

function evaluerIntentions(ctx) {
  const scenarios = Array.isArray(ctx.scenarios) ? ctx.scenarios.filter((s) => s && typeof s.texte === 'string' && typeof s.intention === 'string') : []
  if (scenarios.length === 0) return nul('couverture des intentions : non calculé, aucun jeu de scénarios figé pour ce site')
  const jeuxPages = ctx.pages.map((p) => {
    const textes = [p.title, ...(Array.isArray(p.hn) ? p.hn.filter((h) => h?.niveau === 1).map((h) => h.texte) : [])].filter((t) => typeof t === 'string')
    return mots(textes.join(' '))
  }).filter((s) => s.size > 0)
  if (jeuxPages.length === 0) return nul('couverture des intentions : non calculé, aucune page avec un title ou un h1')
  const intentions = [...new Set(scenarios.map((s) => s.intention))].sort()
  const couvertes = intentions.filter((i) => scenarios.filter((s) => s.intention === i).some((s) => {
    const m = mots(s.texte)
    return jeuxPages.some((pg) => [...m].filter((x) => pg.has(x)).length >= 2)
  }))
  return {
    acquis: ARRONDI(couvertes.length / intentions.length),
    preuve: `${ctx.jeuId ? `jeu n° ${ctx.jeuId} : ` : ''}${couvertes.length} intention(s) sur ${intentions.length} ont au moins une page dont le h1 ou le title partage au moins 2 mots non vides avec un scénario (heuristique)`,
  }
}

function evaluer(def, ctx) {
  switch (def.type) {
    case 'constats': return evaluerConstats(def, ctx)
    case 'page-a-passage': return evaluerPageAPassage(def, ctx)
    case 'passages-citables': return evaluerPassagesCitables(ctx)
    case 'wikidata': return evaluerWikidata(ctx)
    case 'intentions': return evaluerIntentions(ctx)
    default: throw new Error(`type de critère inconnu : ${def.type}`)
  }
}

// calculerScores({ constats, contenu, entite, scenarios?, jeu_id?, pages, collecte? }, poids = chargerPoids()) -> Score[]
// Score = { id, valeur: number|null, couverture: 0..1, criteres: [{ id, classe, poids, part, acquis, preuve }], version_poids, raison? }
export function calculerScores(entrees, poids = chargerPoids()) {
  const e = entrees && typeof entrees === 'object' ? entrees : {}
  const pages = Array.isArray(e.pages) ? e.pages.filter((p) => p && typeof p === 'object') : []
  const contenu = Array.isArray(e.contenu) ? e.contenu.filter((c) => c && typeof c === 'object') : []
  const absolue = pages.map((p) => p.url).find((u) => typeof u === 'string' && u.startsWith('http'))
  const base = absolue ?? e.collecte?.site?.racine ?? 'https://invalid.example/'
  const collecte = e.collecte && typeof e.collecte === 'object' ? e.collecte : {}
  // URLs known to the audit besides the collected pages: errors and sitemap entries (optional `collecte` input).
  const urlsConnues = new Set()
  for (const x of Array.isArray(collecte.erreurs) ? collecte.erreurs : []) if (typeof x?.url === 'string') urlsConnues.add(cle(x.url, base))
  for (const sm of Array.isArray(collecte.site?.sitemaps) ? collecte.site.sitemaps : []) for (const u of sm?.urls ?? []) urlsConnues.add(cle(u, base))
  if (typeof collecte.site?.sitemapXml === 'string') for (const u of lireSitemap(collecte.site.sitemapXml).locs) urlsConnues.add(cle(u, base))
  const ctx = {
    base,
    pagesCles: new Set(pages.map((p) => cle(p.url, base))),
    urlsConnues,
    pages,
    constats: rassembler(e),
    entite: e.entite && typeof e.entite === 'object' ? e.entite : null,
    scenarios: e.scenarios,
    jeuId: Number.isInteger(e.jeu_id) ? e.jeu_id : null,
    sitemapsNonLus: Number(collecte.site?.sitemapsNonVerifies) > 0,
    // A declared name: any name source other than the title suffix (og:site_name, JSON-LD, --marque).
    nomsDeclares: (Array.isArray(e.entite?.noms) ? e.entite.noms : []).some((n) => (Array.isArray(n?.sources) ? n.sources : []).some((s) => s?.champ !== 'title')),
    // Content criteria only count pages analysed in a supported language and with at least one passage.
    passagesParPage: contenu.filter((c) => c.prise_en_charge === true && Array.isArray(c.passages) && c.passages.length > 0).map((c) => c.passages),
    // Normalised URLs of collected pages whose content was analysed with at least one passage.
    cleContenuAnalysable: new Set(),
  }
  for (const c of contenu) {
    if (c.prise_en_charge === true && Array.isArray(c.passages) && c.passages.length > 0 && typeof c.url === 'string' && ctx.pagesCles.has(cle(c.url, base))) ctx.cleContenuAnalysable.add(cle(c.url, base))
  }
  // part = pages whose language is supported / pages analysed; pages with no visible text are in neither count.
  const analysees = contenu.filter((c) => !c.sans_texte)
  const nbPages = analysees.length
  const nbSupportees = analysees.filter((c) => c.prise_en_charge === true).length

  const sortie = []
  for (const [id, { criteres: liste }] of Object.entries(poids.scores)) {
    const defs = DEFINITIONS[id]
    if (!defs) throw new Error(`score inconnu dans poids.json : ${id}`)
    const criteres = liste.map((c) => {
      const def = defs[c.id]
      if (!def) throw new Error(`critère inconnu dans poids.json : ${id}/${c.id}`)
      const r = evaluer(def, ctx)
      let part = r.acquis === null ? 0 : 1
      let preuve = r.preuve
      if (estContenu(def)) {
        if (r.acquis !== null) part = nbPages === 0 ? 0 : ARRONDI(nbSupportees / nbPages)
        if (nbPages > nbSupportees) preuve += ` ; ${nbPages - nbSupportees} page(s) en langue non prise en charge sur ${nbPages} page(s) analysée(s)`
      }
      return { id: c.id, classe: c.classe, poids: c.poids, part, acquis: r.acquis, preuve }
    })
    const total = criteres.reduce((s, c) => s + c.poids, 0)
    const calcules = criteres.filter((c) => c.acquis !== null)
    const poidsCalcules = calcules.reduce((s, c) => s + c.poids * c.part, 0)
    const couverture = total > 0 ? ARRONDI(poidsCalcules / total) : 0
    const acquis = calcules.reduce((s, c) => s + c.poids * c.part * c.acquis, 0)
    const score = { id, valeur: null, couverture, criteres, version_poids: poids.version }
    if (poidsCalcules > 0 && couverture >= SEUIL_COUVERTURE) {
      // Round the quotient first so float noise cannot flip a .5 boundary.
      score.valeur = Math.round(ARRONDI((100 * acquis) / poidsCalcules, 6))
    } else {
      score.raison = `couverture ${couverture} inférieure à ${SEUIL_COUVERTURE} : valeur non affichée`
    }
    sortie.push(score)
  }
  for (const id of SCORES_MESURES) sortie.push({ id, valeur: null, couverture: 0, criteres: [], version_poids: poids.version, raison: RAISON_MESURE })
  return sortie
}
