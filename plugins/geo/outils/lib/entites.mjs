// Entity identity analysis over a Collecte: names, schema.org organisation types, contact data,
// sameAs links, and an optional Wikidata lookup. Never invents a value: everything reported comes
// from the pages. Page-derived text only leaves through extrait().
import { CATALOGUE, noeuds, types } from './controles.mjs'
import { extrait } from './sortie.mjs'

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
  return l.filter((a) => a !== undefined && a !== null).map((a) => ({ cle: cleAdresse(a), valeur: typeof a === 'string' ? a.trim() : [chaine(a?.streetAddress), chaine(a?.postalCode), chaine(a?.addressLocality)].filter(Boolean).join(', ') })).filter((a) => a.cle)
}

// Part after the LAST |, – , — or " - " separator; null when the title has none.
function suffixeTitle(title) {
  if (typeof title !== 'string') return null
  const parts = title.split(/\s*(?:[|–—]|\s-\s)\s*/).map((p) => p.trim())
  if (parts.length < 2) return null
  return parts[parts.length - 1] || null
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

async function chercherWikidata(nom, lang, client) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(nom)}&language=${lang}&format=json&limit=5`
  let rep
  try { rep = await client.demander(url) } catch (e) { return { statut: 'non_verifie', ids: [], raison: String(e?.message ?? e), url } }
  if (!rep || rep.statut !== 200 || typeof rep.corps !== 'string') return { statut: 'non_verifie', ids: [], raison: `réponse inexploitable (statut ${rep?.statut ?? 'inconnu'})${rep?.raison ? ' : ' + rep.raison : ''}`, url }
  let json
  try { json = JSON.parse(rep.corps) } catch { return { statut: 'non_verifie', ids: [], raison: 'réponse Wikidata illisible (JSON invalide)', url } }
  const cible = normaliserNom(nom)
  const exacts = (Array.isArray(json?.search) ? json.search : []).filter((r) => typeof r?.id === 'string' && normaliserNom(r.label) === cible).map((r) => r.id)
  const ids = unique(exacts)
  return { statut: ids.length === 0 ? 'absent' : ids.length === 1 ? 'trouve' : 'ambigu', ids, url }
}

// --- entry point ----------------------------------------------------------------

// analyserEntite(collecte, { marque?, client?, wikidata = false }) -> Promise<{ noms, types, sameAs, coordonnees, wikidata, constats }>
// Never throws on a partial Collecte or odd JSON-LD.
export async function analyserEntite(collecte, { marque, client, wikidata = false } = {}) {
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
  const orgs = [] // { n, url }
  const produits = [] // { cle, url }
  const parPage = new Map() // url -> has a product-like node
  for (const p of pages) {
    if (typeof p.ogSiteName === 'string') ajouterNom(p.ogSiteName, p.url, 'og:site_name')
    const suf = suffixeTitle(p.title)
    if (suf) ajouterNom(suf, p.url, 'title')
    let aProduit = false
    for (const n of noeuds(Array.isArray(p.jsonld) ? p.jsonld : [])) {
      if (estOrganisation(n)) {
        orgs.push({ n, url: p.url })
        const t = types(n).find((x) => TYPES_ORGANISATION.has(x))
        for (const nom of chaines(n.name)) ajouterNom(nom, p.url, `jsonld:${t}.name`)
      } else if (types(n).includes('WebSite')) {
        for (const nom of chaines(n.name)) ajouterNom(nom, p.url, 'jsonld:WebSite.name')
      }
      if (estProduit(n)) {
        aProduit = true
        const cle = plat(chaine(n.name))
        if (cle) produits.push({ cle, url: p.url })
      }
    }
    parPage.set(p.url, aProduit)
  }
  if (typeof marque === 'string' && normaliserNom(marque)) ajouterNom(marque, null, 'option:marque')
  const listeNoms = [...noms.values()]
    .map((g) => ({ valeur: g.valeur, sources: g.sources.sort((a, b) => triTexte(String(a.url) + a.champ, String(b.url) + b.champ)) }))
    .sort((a, b) => triTexte(a.valeur, b.valeur))

  // --- organisation data ---
  const tels = [], adrs = [], mails = [], sameAs = []
  for (const { n, url } of orgs) {
    for (const t of chaines(n.telephone)) { const cle = cleTelephone(t); if (cle) tels.push({ cle, valeur: t, url }) }
    for (const a of adressesDe(n.address)) adrs.push({ ...a, url })
    for (const m of chaines(n.email)) { const v = m.replace(/^mailto:/i, '').trim().toLowerCase(); if (v) mails.push({ cle: v, valeur: v, url }) }
    for (const s of chaines(n.sameAs)) if (/^https?:\/\//i.test(s)) sameAs.push(s)
  }
  const coordonnees = { telephones: regrouper(tels), adresses: regrouper(adrs), emails: regrouper(mails) }
  const typesOrg = unique(orgs.flatMap(({ n }) => types(n).filter((t) => TYPES_ORGANISATION.has(t)))).sort(triTexte)

  const constats = []
  const urlsOrg = orgs.map((o) => o.url)

  if (pages.length && orgs.length === 0) {
    constats.push(constat('GEO-ENTITE-SANS-ORGANIZATION', [], { type: 'jsonld', url: pages[0].url, detail: `aucun nœud JSON-LD de type organisation sur ${pages.length} page(s) explorée(s)` }, 'Aucune organisation n’est déclarée en JSON-LD sur les pages explorées.'))
  }

  if (listeNoms.length >= 2) {
    const sources = listeNoms.flatMap((g) => g.sources)
    const premiere = sources.find((s) => s.url)
    constats.push(constat('GEO-ENTITE-NOM-INCOHERENT', sources.map((s) => s.url).filter(Boolean),
      { type: 'html', url: premiere?.url ?? (pages[0]?.url ?? ''), detail: `${listeNoms.length} noms distincts après normalisation : ${sources.map((s) => `${s.champ} (${s.url ?? 'option'})`).join(' ; ')}` },
      `${listeNoms.length} noms différents désignent l’entité sur le site.`, { extrait: extrait(listeNoms.map((g) => g.valeur).join(' ≠ ')) }))
  }

  const telDiff = coordonnees.telephones.length >= 2, adrDiff = coordonnees.adresses.length >= 2
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
    const nom = (typeof marque === 'string' && marque.trim()) || listeNoms[0]?.valeur
    if (!client || typeof client.demander !== 'function') wd = { statut: 'non_verifie', ids: [], raison: 'aucun client réseau fourni' }
    else if (!nom) wd = { statut: 'non_verifie', ids: [], raison: 'aucun nom d’entité à rechercher' }
    else {
      const lang = String(pages[0]?.lang ?? '').toLowerCase().startsWith('en') ? 'en' : 'fr'
      const { url, ...res } = await chercherWikidata(nom, lang, client)
      wd = res
      if (res.statut === 'ambigu') {
        constats.push(constat('GEO-ENTITE-WIKIDATA-AMBIGU', [], { type: 'http', url, detail: `${res.ids.length} entrées Wikidata de même libellé : ${res.ids.join(', ')} (curl -s '${url}')` }, `Wikidata contient ${res.ids.length} entrées homonymes : ${res.ids.join(', ')}.`))
      }
    }
  }

  return {
    noms: listeNoms,
    types: typesOrg,
    sameAs: unique(sameAs).sort(triTexte),
    coordonnees,
    wikidata: wd,
    constats: constats.sort((a, b) => a.rang - b.rang).map(({ rang, ...reste }) => reste),
  }
}
