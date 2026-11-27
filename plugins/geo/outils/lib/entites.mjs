// Entity identity analysis over a Collecte: names, schema.org organisation types, contact data,
// sameAs links, and an optional Wikidata lookup. Never invents a value: everything reported comes
// from the pages. Page-derived text only leaves through extrait().
import { CATALOGUE, types } from './controles.mjs'
import { commandeCurl, extrait } from './sortie.mjs'

const PAR_ID = new Map(CATALOGUE.map((e, i) => [e.id, { ...e, rang: i }]))

const TYPES_ORGANISATION = new Set([
  'Organization', 'LocalBusiness', 'Corporation', 'NGO', 'OnlineBusiness', 'OnlineStore', 'Store', 'ProfessionalService',
  'MedicalBusiness', 'MedicalOrganization', 'Physician', 'Dentist', 'Hospital', 'Pharmacy', 'LegalService', 'Attorney', 'Notary',
  'AccountingService', 'FinancialService', 'RealEstateAgent', 'HomeAndConstructionBusiness', 'Electrician', 'Plumber', 'GeneralContractor',
  'Locksmith', 'RoofingContractor', 'HVACBusiness', 'Restaurant', 'FoodEstablishment', 'Bakery', 'CafeOrCoffeeShop', 'Hotel', 'LodgingBusiness',
  'HealthAndBeautyBusiness', 'BeautySalon', 'HairSalon', 'DaySpa', 'HealthClub', 'SportsActivityLocation', 'AutomotiveBusiness', 'AutoRepair',
  'EducationalOrganization', 'School', 'CollegeOrUniversity', 'GovernmentOrganization', 'Library', 'TravelAgency', 'EmploymentAgency',
  'SportsOrganization', 'PerformingGroup', 'NewsMediaOrganization', 'Airline', 'FundingScheme',
])
const TYPES_PRODUIT = new Set(['Product', 'SoftwareApplication', 'Service', 'MobileApplication', 'WebApplication'])
const SUFFIXES_LEGAUX = new Set(['sarl', 'sas', 'sa', 'sasu', 'eurl', 'inc', 'ltd', 'llc', 'gmbh'])

// --- helpers ------------------------------------------------------------------

const triTexte = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const unique = (l) => [...new Set(l)]

// Lowercase, no accents, punctuation to spaces, collapsed.
const plat = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
// Same, minus legal-form tokens (SARL, SAS...).
const normaliserNom = (s) => plat(s).split(' ').filter((t) => t && !SUFFIXES_LEGAUX.has(t)).join(' ')

// A string, or the first string of an array, or an { @value } node; '' otherwise.
function chaine(v) {
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) { for (const e of v) { const s = chaine(e); if (s) return s } return '' }
  if (v && typeof v === 'object' && typeof v['@value'] === 'string') return v['@value'].trim()
  return ''
}
const chaines = (v) => (Array.isArray(v) ? v : [v]).map(chaine).filter(Boolean)

// Digits only; FR numbers written +33 / 0033 / (0) fold onto the national 0 form.
function cleTelephone(t) {
  let d = String(t).replace(/\(0\)/g, '').replace(/\D+/g, '')
  if (d.startsWith('0033')) d = d.slice(2)
  if (/^33\d{9}$/.test(d)) d = '0' + d.slice(2)
  return d
}

function cleAdresse(a) {
  if (typeof a === 'string') return plat(a)
  if (a && typeof a === 'object') return plat(chaine(a.streetAddress) + ' ' + chaine(a.postalCode))
  return ''
}
function adressesDe(v) {
  const l = Array.isArray(v) ? v : [v]
  return l.filter((a) => a !== undefined && a !== null).map((a) => ({ forme: typeof a === 'string' ? 'chaine' : 'objet', cle: cleAdresse(a), valeur: typeof a === 'string' ? a.trim() : [chaine(a?.streetAddress), chaine(a?.postalCode), chaine(a?.addressLocality)].filter(Boolean).join(', ') })).filter((a) => a.cle)
}

// Part after the LAST |, – , — or " - " separator; null when the title has none.
function suffixeTitle(title) {
  if (typeof title !== 'string') return null
  const parts = title.split(/\s*(?:[|–—]|\s-\s)\s*/).map((p) => p.trim())
  if (parts.length < 2) return null
  return parts[parts.length - 1] || null
}

// JSON-LD nodes that describe the page itself: top-level objects, array members and @graph members.
// Property values (publisher, manufacturer, seller...) are never visited, so nested third-party
// organisations are not mistaken for the site's own.
function noeudsHaut(jsonld) {
  const out = []
  const visiter = (x, prof) => {
    if (prof > 4 || x === null || typeof x !== 'object') return
    if (Array.isArray(x)) { for (const e of x) visiter(e, prof + 1); return }
    out.push(x)
    if (Array.isArray(x['@graph'])) visiter(x['@graph'], prof + 1)
  }
  for (const j of Array.isArray(jsonld) ? jsonld : []) if (j?.objet) visiter(j.objet, 0)
  return out
}

// Two normalised names agree when equal or when one is a contiguous whole-word sequence of the other.
function nomsCompatibles(a, b) {
  if (a === b) return true
  const [court, long] = a.length <= b.length ? [a, b] : [b, a]
  return ` ${long} `.includes(` ${court} `)
}

// --- site's own entity vs listed third-party entities (directories, marketplaces) ---

// Folder-mode page URLs are paths: resolved against a placeholder origin.
const DOSSIER = 'http://dossier.invalid'
const absolue = (u) => /^https?:\/\//i.test(u)
const baseDe = (u) => (absolue(u) ? u : DOSSIER + (String(u).startsWith('/') ? u : '/' + u))
const sansWww = (h) => String(h).toLowerCase().replace(/^www\./, '')
const estAccueil = (p) => p.profondeur === 0 || (() => { try { return new URL(baseDe(p.url)).pathname === '/' } catch { return false } })()

// Where the node's own url / @id points: 'racine' (the site root: same host, www. ignored, path / and no query),
// 'autre' (any other page or host), or null (none usable). Fragment-only and blank values ("#org", "_:b0") name the
// node inside the page and are ignored. In folder mode the host is unknown: any absolute URL with path / is the root.
function cibleNoeud(n, pageUrl) {
  const valeurs = [...chaines(n.url), ...chaines(n['@id'])].filter((v) => !v.startsWith('#') && !v.startsWith('_:'))
  let page
  try { page = new URL(baseDe(pageUrl)) } catch { return null }
  let res = null
  for (const v of valeurs) {
    let u
    try { u = new URL(v, page) } catch { continue }
    if (!/^https?:$/.test(u.protocol)) continue
    const memeHote = !absolue(pageUrl) || sansWww(u.host) === sansWww(page.host)
    if (memeHote && u.pathname === '/' && !u.search) return 'racine'
    res = 'autre'
  }
  return res
}

const estOrganisation = (n) => types(n).some((t) => TYPES_ORGANISATION.has(t))
const estProduit = (n) => types(n).some((t) => TYPES_PRODUIT.has(t))

// Adds { valeur, urls } entries grouped by key, in first-seen order; urls sorted.
function regrouper(entrees) {
  const m = new Map()
  for (const e of entrees) {
    const g = m.get(e.cle) ?? { valeur: e.valeur, urls: [] }
    if (!g.urls.includes(e.url)) g.urls.push(e.url)
    m.set(e.cle, g)
  }
  return [...m.values()].map((g) => ({ valeur: g.valeur, urls: g.urls.sort(triTexte) })).sort((a, b) => triTexte(a.valeur, b.valeur))
}

function constat(id, pages, preuve, detail, extra = {}) {
  const def = PAR_ID.get(id)
  return { id, severite: def.severite, categorie: def.categorie, classe: def.classe, pages: unique(pages).sort(triTexte), preuve, detail, ...extra, rang: def.rang }
}

// --- Wikidata -----------------------------------------------------------------

export const API_WIKIDATA = 'https://www.wikidata.org/w/api.php'
// Statuses: non_verifie (not asked or failed), absent (no entry with this label), libelle_identique (same label,
// official website not matching the audited host: identity not verified), ambigu (several candidates), trouve
// (one entry whose P856 official website is on the audited host).
export const STATUTS_WIKIDATA = ['non_verifie', 'absent', 'libelle_identique', 'ambigu', 'trouve']
const ACCEPT_JSON = { accept: 'application/json' }

// GET + JSON parse; { json } or { raison }.
async function lireJson(client, url) {
  let rep
  try { rep = await client.demander(url, ACCEPT_JSON) } catch (e) { return { raison: extrait(String(e?.message ?? e), 200).extrait } }
  if (!rep || rep.statut !== 200 || typeof rep.corps !== 'string') return { raison: `réponse inexploitable (statut ${rep?.statut ?? 'inconnu'})${rep?.raison ? ' : ' + extrait(rep.raison, 200).extrait : ''}` }
  try { return { json: JSON.parse(rep.corps) } } catch { return { raison: 'réponse Wikidata illisible (JSON invalide)' } }
}

// Hosts of the P856 (official website) claims of one entity.
function hotesSiteOfficiel(entite) {
  const claims = Array.isArray(entite?.claims?.P856) ? entite.claims.P856 : []
  return claims.map((c) => c?.mainsnak?.datavalue?.value).filter((v) => typeof v === 'string').map((v) => { try { return new URL(v).host.toLowerCase() } catch { return null } }).filter(Boolean)
}

async function chercherWikidata(nom, lang, client, { hote, api = API_WIKIDATA }) {
  const url = `${api}?action=wbsearchentities&search=${encodeURIComponent(nom)}&language=${lang}&format=json&limit=5`
  const r = await lireJson(client, url)
  if (r.raison) return { statut: 'non_verifie', ids: [], raison: r.raison, url }
  const cible = normaliserNom(nom)
  const ids = unique((Array.isArray(r.json?.search) ? r.json.search : []).filter((x) => typeof x?.id === 'string' && /^Q[0-9]+$/.test(x.id) && normaliserNom(x.label) === cible).map((x) => x.id))
  if (ids.length === 0) return { statut: 'absent', ids, url }
  const libelle = (raison) => (ids.length === 1 ? { statut: 'libelle_identique', ids, raison, url } : { statut: 'ambigu', ids, raison, url })
  if (!hote) return libelle('libellé identique trouvé, identité non vérifiée (mode dossier : aucun hôte audité à comparer au site officiel P856)')
  // Identity check: the entity's official website (P856) must be on the audited host. One request, same allowed host.
  const urlClaims = `${api}?action=wbgetentities&ids=${ids.join('%7C')}&props=claims&format=json`
  const c = await lireJson(client, urlClaims)
  if (c.raison) return libelle(`libellé identique trouvé, identité non vérifiée (site officiel P856 non lu : ${c.raison})`)
  const correspondants = ids.filter((id) => hotesSiteOfficiel(c.json?.entities?.[id]).includes(hote))
  if (correspondants.length === 1) return { statut: 'trouve', ids: correspondants, url: urlClaims }
  if (correspondants.length > 1) return { statut: 'ambigu', ids: correspondants, raison: `${correspondants.length} entrées déclarent ${hote} comme site officiel (P856)`, url }
  return libelle(`libellé identique trouvé, identité non vérifiée (aucune entrée ne déclare ${hote} comme site officiel P856)`)
}

// --- entry point ----------------------------------------------------------------

// analyserEntite(collecte, { marque?, client?, wikidata = false, apiWikidata? }) -> Promise<{ noms, types, sameAs, coordonnees, entites_tierces, wikidata, constats }>
// Only the site's own organisation nodes feed names, contacts, sameAs and SANS-ORGANIZATION; listed third-party
// entities are counted in entites_tierces (distinct names).
// apiWikidata only exists for tests (a local server standing for the Wikidata API). Never throws on a partial Collecte or odd JSON-LD.
export async function analyserEntite(collecte, { marque, client, wikidata = false, apiWikidata = API_WIKIDATA } = {}) {
  const pages = (Array.isArray(collecte?.pages) ? collecte.pages : []).filter((p) => p && typeof p.url === 'string')
    .sort((a, b) => triTexte(a.url, b.url))

  // --- names ---
  const noms = new Map() // normalised -> { valeur, sources }
  const ajouterNom = (valeur, url, champ) => {
    const cle = normaliserNom(valeur)
    if (!cle) return
    const g = noms.get(cle) ?? { valeur: String(valeur).trim(), sources: [] }
    g.sources.push({ url, champ })
    noms.set(cle, g)
  }
  const candidats = [] // every top-level organisation node: { n, url, accueil, cible, h1 }
  let premierOg = null
  const produits = [] // { cle, url }
  const parPage = new Map() // url -> has a product-like node
  const nomsSite = new Set() // normalised names that designate the site itself (see references/entites.md)
  for (const p of pages) {
    if (typeof p.ogSiteName === 'string') { ajouterNom(p.ogSiteName, p.url, 'og:site_name'); if (p.ogSiteName.trim()) premierOg ??= p.ogSiteName.trim(); nomsSite.add(normaliserNom(p.ogSiteName)) }
    const suf = suffixeTitle(p.title)
    if (suf) ajouterNom(suf, p.url, 'title')
    const accueil = estAccueil(p)
    const h1 = (Array.isArray(p.hn) ? p.hn : []).find((h) => h?.niveau === 1 && typeof h.texte === 'string')
    let aProduit = false
    for (const n of noeudsHaut(p.jsonld)) {
      if (estOrganisation(n)) {
        candidats.push({ n, url: p.url, accueil, cible: cibleNoeud(n, p.url), h1: h1 ? normaliserNom(h1.texte) : '' })
      } else if (types(n).includes('WebSite')) {
        for (const nom of chaines(n.name)) { ajouterNom(nom, p.url, 'jsonld:WebSite.name'); nomsSite.add(normaliserNom(nom)) }
      }
      if (estProduit(n)) {
        aProduit = true
        const cle = plat(chaine(n.name))
        if (cle) produits.push({ cle, url: p.url })
      }
    }
    parPage.set(p.url, aProduit)
  }
  if (typeof marque === 'string' && normaliserNom(marque)) { ajouterNom(marque, null, 'option:marque'); nomsSite.add(normaliserNom(marque)) }

  // Anchors: organisation nodes that are about the site by position or address (home page without a url elsewhere,
  // or url / @id on the site root). Their names designate the site too.
  const ancre = (o) => o.cible === 'racine' || (o.accueil && o.cible !== 'autre')
  for (const o of candidats) if (ancre(o)) for (const nom of chaines(o.n.name)) nomsSite.add(normaliserNom(nom))
  nomsSite.delete('')
  // Listed third-party entity: not an anchor, every name distinct from the site's names, and either an own url
  // elsewhere (profile path, other host) or a name carried by the page's h1 outside the home page. Never decided
  // without a known site name, and a node without name is never set aside.
  const tierce = (o) => {
    if (!nomsSite.size || ancre(o)) return false
    const ses = chaines(o.n.name).map(normaliserNom).filter(Boolean)
    if (!ses.length || ses.some((k) => [...nomsSite].some((s) => nomsCompatibles(k, s)))) return false
    return o.cible === 'autre' || (!o.accueil && !!o.h1 && ses.some((k) => ` ${o.h1} `.includes(` ${k} `)))
  }
  const orgs = [], tierces = []
  for (const o of candidats) (tierce(o) ? tierces : orgs).push(o)
  const nomsTiers = unique(tierces.flatMap(({ n }) => chaines(n.name).map(normaliserNom)).filter(Boolean))
  let premierNomOrg = null
  for (const { n, url } of orgs) {
    const t = types(n).find((x) => TYPES_ORGANISATION.has(x))
    for (const nom of chaines(n.name)) { ajouterNom(nom, url, `jsonld:${t}.name`); premierNomOrg ??= nom }
  }
  const listeNoms = [...noms.values()]
    .map((g) => ({ valeur: g.valeur, sources: g.sources.sort((a, b) => triTexte(String(a.url) + a.champ, String(b.url) + b.champ)) }))
    .sort((a, b) => triTexte(a.valeur, b.valeur))

  // --- organisation data ---
  const tels = [], adrs = [], mails = [], sameAs = []
  const jeuxTel = [], jeuxAdr = { chaine: [], objet: [] } // one value set per organisation node
  for (const { n, url } of orgs) {
    for (const t of chaines(n.telephone)) { const cle = cleTelephone(t); if (cle) tels.push({ cle, valeur: t, url }) }
    for (const a of adressesDe(n.address)) adrs.push({ ...a, cle: a.forme + ':' + a.cle, url })
    const cT = new Set(chaines(n.telephone).map(cleTelephone).filter(Boolean))
    if (cT.size) jeuxTel.push({ cles: cT, url })
    for (const forme of ['chaine', 'objet']) {
      const cA = new Set(adressesDe(n.address).filter((a) => a.forme === forme).map((a) => a.cle))
      if (cA.size) jeuxAdr[forme].push({ cles: cA, url })
    }
    for (const m of chaines(n.email)) { const v = m.replace(/^mailto:/i, '').trim().toLowerCase(); if (v) mails.push({ cle: v, valeur: v, url }) }
    for (const s of chaines(n.sameAs)) if (/^https?:\/\//i.test(s)) sameAs.push(s)
  }
  const coordonnees = { telephones: regrouper(tels), adresses: regrouper(adrs), emails: regrouper(mails) }
  const typesOrg = unique(orgs.flatMap(({ n }) => types(n).filter((t) => TYPES_ORGANISATION.has(t)))).sort(triTexte)

  const constats = []
  const urlsOrg = orgs.map((o) => o.url)

  if (pages.length && orgs.length === 0) {
    constats.push(constat('GEO-ENTITE-SANS-ORGANIZATION', [], { type: 'jsonld', url: pages[0].url, detail: `aucun nœud JSON-LD de type organisation sur ${pages.length} page(s) explorée(s)${tierces.length ? ` (hors ${nomsTiers.length} entité(s) tierce(s) listée(s) par le site)` : ''}` }, 'Aucune organisation n’est déclarée en JSON-LD sur les pages explorées.'))
  }

  // The title suffix only corroborates: incoherence is judged on og:site_name, JSON-LD names and the brand option.
  const fortes = listeNoms.map((g) => ({ valeur: g.valeur, cle: normaliserNom(g.valeur), sources: g.sources.filter((s) => s.champ !== 'title') })).filter((g) => g.sources.length)
  const incoherent = fortes.some((a, i) => fortes.slice(i + 1).some((b) => !nomsCompatibles(a.cle, b.cle)))
  if (incoherent) {
    const sources = fortes.flatMap((g) => g.sources)
    const premiere = sources.find((s) => s.url)
    constats.push(constat('GEO-ENTITE-NOM-INCOHERENT', sources.map((s) => s.url).filter(Boolean),
      { type: 'html', url: premiere?.url ?? (pages[0]?.url ?? ''), detail: `${fortes.length} noms distincts après normalisation : ${sources.map((s) => `${s.champ} (${s.url ?? 'option'})`).join(' ; ')}` },
      `${fortes.length} noms différents désignent l’entité sur le site.`, { extrait: extrait(fortes.map((g) => g.valeur).join(' ≠ ')) }))
  }

  // Contradiction = two distinct organisation nodes whose value sets are disjoint (same form for addresses).
  const disjoints = (jeux) => jeux.some((a, i) => jeux.slice(i + 1).some((b) => ![...a.cles].some((c) => b.cles.has(c))))
  const telDiff = disjoints(jeuxTel), adrDiff = disjoints(jeuxAdr.chaine) || disjoints(jeuxAdr.objet)
  if (telDiff || adrDiff) {
    const quoi = [telDiff ? `${coordonnees.telephones.length} téléphones` : null, adrDiff ? `${coordonnees.adresses.length} adresses` : null].filter(Boolean).join(' et ')
    const groupes = [...(telDiff ? coordonnees.telephones : []), ...(adrDiff ? coordonnees.adresses : [])]
    const urls = groupes.flatMap((g) => g.urls)
    constats.push(constat('GEO-ENTITE-COORDONNEES-CONTRADICTOIRES', urls,
      { type: 'jsonld', url: [...urls].sort(triTexte)[0], detail: `${quoi} différents dans des JSON-LD d’organisation (voir l’extrait)` },
      `Les JSON-LD d’organisation déclarent ${quoi} différents.`, { extrait: extrait(groupes.map((g) => g.valeur).join(' / ')) }))
  }

  if (orgs.length && sameAs.length === 0) {
    constats.push(constat('GEO-ENTITE-SAMEAS-ABSENT', urlsOrg, { type: 'jsonld', url: urlsOrg[0], detail: 'propriété sameAs absente de tous les nœuds d’organisation' }, 'L’organisation n’a aucun sameAs vers ses profils officiels.'))
  }

  // Information only: the listed entities were recognised and set aside (never compared with the site's identity).
  if (tierces.length) {
    const urlsTiers = unique(tierces.map((o) => o.url)).sort(triTexte)
    const exemples = unique(tierces.map(({ n }) => chaines(n.name)[0])).sort(triTexte).slice(0, 3)
    constats.push(constat('GEO-ENTITE-ENTITES-TIERCES', urlsTiers,
      { type: 'jsonld', url: urlsTiers[0], detail: `${nomsTiers.length} entité(s) tierce(s) sur ${urlsTiers.length} page(s) : nœuds d’organisation hors accueil et hors racine du site, avec une url propre ou un nom repris par le h1, et un nom distinct de celui du site` },
      `${nomsTiers.length} entité(s) listée(s) par le site (fiches, établissements) reconnue(s) comme tierce(s) : elles ne sont pas comparées à l’identité du site.`, { extrait: extrait(exemples.join(' ; ')) }))
  }

  // Narrow heuristic: exact (normalised) h1 == a product name declared on ANOTHER page, page itself without such a node.
  const sansSchema = []
  for (const p of pages) {
    if (parPage.get(p.url)) continue
    const h1 = (Array.isArray(p.hn) ? p.hn : []).find((h) => h?.niveau === 1 && typeof h.texte === 'string')
    const cle = h1 ? plat(h1.texte) : ''
    if (cle && produits.some((x) => x.cle === cle && x.url !== p.url)) sansSchema.push({ url: p.url, texte: h1.texte })
  }
  if (sansSchema.length) {
    constats.push(constat('GEO-ENTITE-PRODUIT-SANS-SCHEMA', sansSchema.map((s) => s.url),
      { type: 'html', url: sansSchema[0].url, detail: `h1 identique (normalisé) à un produit ou service balisé sur une autre page, sans Product, SoftwareApplication ni Service sur cette page (${sansSchema.length} page(s))` },
      `${sansSchema.length} page(s) présentent un produit ou service balisé ailleurs mais pas sur elles-mêmes.`, { extrait: extrait(sansSchema[0].texte) }))
  }

  // --- Wikidata (opt-in, allowlisted host only) ---
  let wd = { statut: 'non_verifie', ids: [], raison: 'vérification Wikidata non demandée' }
  if (wikidata) {
    const nom = (typeof marque === 'string' && marque.trim()) || premierNomOrg || premierOg
    if (!client || typeof client.demander !== 'function') wd = { statut: 'non_verifie', ids: [], raison: 'aucun client réseau fourni' }
    else if (!nom) wd = { statut: 'non_verifie', ids: [], raison: 'aucun nom d’entité à rechercher' }
    else {
      const lang = String(pages[0]?.lang ?? '').toLowerCase().startsWith('en') ? 'en' : 'fr'
      const racine = typeof collecte?.origine === 'string' ? collecte.origine : collecte?.site?.racine
      let hote = null
      try { hote = /^https?:\/\//i.test(racine ?? '') ? new URL(racine).host.toLowerCase() : null } catch { /* folder mode */ }
      const { url, ...res } = await chercherWikidata(nom, lang, client, { hote, api: apiWikidata })
      wd = res
      if (res.statut === 'ambigu') {
        const cmd = commandeCurl('-s', url)
        constats.push(constat('GEO-ENTITE-WIKIDATA-AMBIGU', [], { type: 'http', url, detail: `${res.ids.length} entrées Wikidata candidates : ${res.ids.join(', ')}`, ...(cmd ? { commande: cmd } : {}) }, `Wikidata contient ${res.ids.length} entrées candidates : ${res.ids.join(', ')}.`))
      }
    }
  }

  return {
    noms: listeNoms,
    types: typesOrg,
    sameAs: unique(sameAs).sort(triTexte),
    coordonnees,
    entites_tierces: nomsTiers.length,
    wikidata: wd,
    constats: constats.sort((a, b) => a.rang - b.rang).map(({ rang, ...reste }) => reste),
  }
}
