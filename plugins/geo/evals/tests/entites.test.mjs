import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyserEntite } from '../../outils/lib/entites.mjs'
import { ErreurGeo } from '../../outils/lib/sortie.mjs'

const O = 'https://www.atelier.example'

// Minimal Page shaped like collecter.mjs output; only the fields the entity analysis reads matter.
function page(chemin, sur = {}) {
  return {
    url: O + chemin, lang: 'fr', title: null, ogSiteName: null, hn: [{ niveau: 1, texte: 'H1 ' + chemin }], jsonld: [], liens: [], blocs: [],
    statut: 200, profondeur: 1, ...sur,
  }
}
const ld = (objet) => ({ brut: JSON.stringify(objet), objet, erreur: null })
const collecte = (pages) => ({ origine: O, pages, site: { racine: O }, erreurs: [] })
const org = (extra = {}) => ({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Atelier Nord', ...extra })
const trouver = (r, id) => r.constats.find((c) => c.id === id)
const jamais = { demander: async () => { throw new Error('aucune requête attendue') } }
const reponse = (obj, statut = 200) => ({ statut, entetes: {}, corps: JSON.stringify(obj), redirections: [], depuisCache: false })

test('noms incohérents : og:site_name et JSON-LD, avec les deux sources', async () => {
  const r = await analyserEntite(collecte([
    page('/', { ogSiteName: 'Atelier Nord' }),
    page('/contact', { jsonld: [ld(org({ name: 'Atelier du Nord SARL' }))] }),
  ]))
  const c = trouver(r, 'GEO-ENTITE-NOM-INCOHERENT')
  assert.ok(c)
  assert.equal(c.severite, 'important')
  assert.equal(c.categorie, 'entite')
  assert.equal(c.preuve.type, 'html')
  assert.equal(r.noms.length, 2)
  const champs = r.noms.flatMap((n) => n.sources.map((s) => s.champ)).sort()
  assert.deepEqual(champs, ['jsonld:Organization.name', 'og:site_name'])
  assert.ok(c.extrait.non_fiable)
  assert.ok(c.pages.includes(O + '/') && c.pages.includes(O + '/contact'))
})

test('noms identiques après normalisation : pas de constat', async () => {
  const r = await analyserEntite(collecte([
    page('/', { ogSiteName: 'Atelier Nord' }),
    page('/a', { jsonld: [ld(org({ name: 'ATELIER NORD SARL' }))], title: 'Contact | Atelier Nord' }),
  ]))
  assert.equal(trouver(r, 'GEO-ENTITE-NOM-INCOHERENT'), undefined)
  assert.equal(r.noms.length, 1)
  assert.equal(r.noms[0].sources.length, 3)
})

test('suffixe de title : seulement après le dernier séparateur et seulement s’il y en a un', async () => {
  const r = await analyserEntite(collecte([
    page('/', { ogSiteName: 'Atelier Nord', title: 'Menuiserie sur mesure' }),
    page('/b', { title: 'Tarifs - Services – Atelier Nord' }),
  ]))
  assert.equal(r.noms.length, 1)
  assert.deepEqual(r.noms[0].sources.map((s) => s.champ).sort(), ['og:site_name', 'title'])
})

test('WebSite.name compte comme source de nom', async () => {
  const r = await analyserEntite(collecte([page('/', { jsonld: [ld({ '@type': 'WebSite', name: 'Autre Nom' }), ld(org())] })]))
  assert.ok(trouver(r, 'GEO-ENTITE-NOM-INCOHERENT'))
})

test('sans organisation : constat et pas de sameAs absent', async () => {
  const r = await analyserEntite(collecte([page('/', { ogSiteName: 'Atelier Nord' })]))
  const c = trouver(r, 'GEO-ENTITE-SANS-ORGANIZATION')
  assert.ok(c)
  assert.equal(c.severite, 'important')
  assert.equal(trouver(r, 'GEO-ENTITE-SAMEAS-ABSENT'), undefined)
})

test('sameAs absent / présent, types relevés', async () => {
  const sans = await analyserEntite(collecte([page('/', { jsonld: [ld(org({ '@type': 'LocalBusiness' }))] })]))
  assert.equal(trouver(sans, 'GEO-ENTITE-SAMEAS-ABSENT').severite, 'mineur')
  assert.deepEqual(sans.types, ['LocalBusiness'])
  const avec = await analyserEntite(collecte([page('/', { jsonld: [ld(org({ sameAs: ['https://profil.example/atelier', 'javascript:x', 'https://autre.example/a'] }))] })]))
  assert.equal(trouver(avec, 'GEO-ENTITE-SAMEAS-ABSENT'), undefined)
  assert.deepEqual(avec.sameAs, ['https://autre.example/a', 'https://profil.example/atelier'])
})

test('deux téléphones différents : contradiction ; formats équivalents : non', async () => {
  const r = await analyserEntite(collecte([
    page('/', { jsonld: [ld(org({ telephone: '01 23 45 67 89' }))] }),
    page('/contact', { jsonld: [ld(org({ telephone: '04 11 22 33 44' }))] }),
  ]))
  const c = trouver(r, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES')
  assert.ok(c)
  assert.equal(c.preuve.type, 'jsonld')
  assert.equal(r.coordonnees.telephones.length, 2)
  assert.equal(r.coordonnees.telephones[0].urls.length, 1)
  const ok = await analyserEntite(collecte([
    page('/', { jsonld: [ld(org({ telephone: '01 23 45 67 89' }))] }),
    page('/c', { jsonld: [ld(org({ telephone: '+33 (0)1.23.45.67.89' }))] }),
  ]))
  assert.equal(trouver(ok, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
  assert.equal(ok.coordonnees.telephones.length, 1)
})

test('adresses différentes : contradiction ; adresse en chaîne et tableaux acceptés', async () => {
  const r = await analyserEntite(collecte([
    page('/', { jsonld: [ld(org({ address: { streetAddress: '1 rue des Tilleuls', postalCode: '75001' } }))] }),
    page('/c', { jsonld: [ld(org({ address: { streetAddress: '9 avenue du Lac', postalCode: '69001' } }))] }),
  ]))
  assert.ok(trouver(r, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'))
  assert.equal(r.coordonnees.adresses.length, 2)
  const odd = await analyserEntite(collecte([page('/', { jsonld: [ld([org({ name: ['Atelier Nord', 'Atelier Nord'], address: '1 rue des Tilleuls 75001', telephone: ['0123456789'], email: 'mailto:Info@Atelier.example' })])] })]))
  assert.equal(odd.coordonnees.emails[0].valeur, 'info@atelier.example')
  assert.equal(trouver(odd, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
})

test('coordonnées hors organisation (Person) ignorées', async () => {
  const r = await analyserEntite(collecte([page('/', { jsonld: [ld(org({ telephone: '0123456789' })), ld({ '@type': 'Person', name: 'Anne Test', telephone: '0499999999' })] })]))
  assert.equal(trouver(r, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
})

test('@graph, JSON-LD invalide et formes bizarres : aucune exception', async () => {
  const r = await analyserEntite(collecte([
    page('/', { jsonld: [ld({ '@graph': [org(), { '@type': ['Product', 'Thing'], name: 42 }] }), { brut: '{', objet: null, erreur: 'x' }, ld('texte'), ld(null)] }),
    page('/b', { hn: undefined, title: 42, jsonld: undefined }),
  ]))
  assert.equal(trouver(r, 'GEO-ENTITE-SANS-ORGANIZATION'), undefined)
  await assert.doesNotReject(analyserEntite({}))
  await assert.doesNotReject(analyserEntite(null))
})

test('produit sans schéma : h1 égal au produit balisé ailleurs', async () => {
  const r = await analyserEntite(collecte([
    page('/', { jsonld: [ld(org()), ld({ '@type': 'Product', name: 'Établi Pliant' })] }),
    page('/etabli', { hn: [{ niveau: 1, texte: 'établi  pliant' }] }),
    page('/autre', { hn: [{ niveau: 1, texte: 'Établi pliant XL' }] }),
  ]))
  const c = trouver(r, 'GEO-ENTITE-PRODUIT-SANS-SCHEMA')
  assert.ok(c)
  assert.equal(c.classe, 'heuristique')
  assert.equal(c.severite, 'mineur')
  assert.deepEqual(c.pages, [O + '/etabli'])
  const ok = await analyserEntite(collecte([
    page('/', { jsonld: [ld(org()), ld({ '@type': 'Product', name: 'Établi Pliant' })] }),
    page('/etabli', { hn: [{ niveau: 1, texte: 'Établi Pliant' }], jsonld: [ld({ '@type': 'Product', name: 'Établi Pliant' })] }),
  ]))
  assert.equal(trouver(ok, 'GEO-ENTITE-PRODUIT-SANS-SCHEMA'), undefined)
})

test('wikidata: false → non_verifie, aucune requête', async () => {
  const r = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { client: jamais })
  assert.equal(r.wikidata.statut, 'non_verifie')
  assert.deepEqual(r.wikidata.ids, [])
})

test('wikidata sans client → non_verifie', async () => {
  const r = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { wikidata: true })
  assert.equal(r.wikidata.statut, 'non_verifie')
})

// Fake Wikidata API: search results, then P856 (official website) claims per id.
const apiWikidata = (resultats, sitesOfficiels = {}, appels = []) => ({
  demander: async (url, opts) => {
    appels.push({ url, opts })
    if (url.includes('action=wbgetentities')) {
      const ids = new URL(url).searchParams.get('ids').split('|')
      return reponse({ entities: Object.fromEntries(ids.map((id) => [id, { id, claims: sitesOfficiels[id] ? { P856: [{ mainsnak: { datavalue: { value: sitesOfficiels[id] } } }] } : {} }])) })
    }
    return reponse({ search: resultats })
  },
})

test('wikidata: deux homonymes sans site officiel sur l’hôte audité → ambigu + constat information', async () => {
  const appels = []
  const client = apiWikidata([{ id: 'Q1', label: 'Atelier Nord' }, { id: 'Q2', label: 'Atelier Nord' }, { id: 'Q3', label: 'Autre' }], { Q1: 'https://autre.example/' }, appels)
  const r = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { wikidata: true, client })
  assert.equal(r.wikidata.statut, 'ambigu')
  assert.deepEqual(r.wikidata.ids, ['Q1', 'Q2'])
  const c = trouver(r, 'GEO-ENTITE-WIKIDATA-AMBIGU')
  assert.equal(c.severite, 'information')
  assert.equal(c.preuve.type, 'http')
  assert.equal(appels.length, 2)
  assert.equal(appels[0].url, 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Atelier%20Nord&language=fr&format=json&limit=5')
  assert.equal(appels[1].url, 'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q1%7CQ2&props=claims&format=json')
  // Every Wikidata request asks for JSON (the default HTML Accept would be refused by the network layer).
  for (const a of appels) assert.equal(a.opts?.accept, 'application/json')
})

test('wikidata: identité vérifiée par le site officiel (P856) ; libellé seul → libelle_identique ; aucun → absent', async () => {
  const un = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { wikidata: true, client: apiWikidata([{ id: 'Q7', label: 'Atelier Nord' }], { Q7: 'https://www.atelier.example/accueil' }) })
  assert.equal(un.wikidata.statut, 'trouve')
  assert.deepEqual(un.wikidata.ids, ['Q7'])
  // Same label, official website elsewhere (or none): identity not verified, never "trouve".
  for (const site of ['https://atelier-nord.example/', undefined]) {
    const homonyme = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { wikidata: true, client: apiWikidata([{ id: 'Q7', label: 'Atelier Nord' }], site ? { Q7: site } : {}) })
    assert.equal(homonyme.wikidata.statut, 'libelle_identique')
    assert.match(homonyme.wikidata.raison, /libellé identique trouvé, identité non vérifiée/)
  }
  // Two homonyms, one of them on the audited host: that one is the entity.
  const deux = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { wikidata: true, client: apiWikidata([{ id: 'Q1', label: 'Atelier Nord' }, { id: 'Q2', label: 'Atelier Nord' }], { Q2: 'https://www.atelier.example/' }) })
  assert.equal(deux.wikidata.statut, 'trouve')
  assert.deepEqual(deux.wikidata.ids, ['Q2'])
  assert.equal(trouver(deux, 'GEO-ENTITE-WIKIDATA-AMBIGU'), undefined)
  // Folder mode: no audited host to compare with.
  const dossier = await analyserEntite({ pages: [page('/', { jsonld: [ld(org())] })], site: { racine: null } }, { wikidata: true, client: apiWikidata([{ id: 'Q7', label: 'Atelier Nord' }], { Q7: 'https://www.atelier.example/' }) })
  assert.equal(dossier.wikidata.statut, 'libelle_identique')
  const zero = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { wikidata: true, client: apiWikidata([]) })
  assert.equal(zero.wikidata.statut, 'absent')
})

test('wikidata : commande curl de la preuve rejouable et intacte après assainissement et dans le Markdown', async () => {
  const { assainirConstat, rapportMarkdown } = await import('../../outils/lib/rapports.mjs')
  const r = await analyserEntite(collecte([page('/', { jsonld: [ld(org({ name: "Atelier Nord & Fils l'ancien" }))] })]), { wikidata: true, client: apiWikidata([{ id: 'Q1', label: "Atelier Nord & Fils l'ancien" }, { id: 'Q2', label: "Atelier Nord & Fils l'ancien" }]) })
  const c = assainirConstat(trouver(r, 'GEO-ENTITE-WIKIDATA-AMBIGU'))
  const attendu = "curl -s 'https://www.wikidata.org/w/api.php?action=wbsearchentities&search=Atelier%20Nord%20%26%20Fils%20l%27ancien&language=fr&format=json&limit=5'"
  assert.equal(c.preuve.commande, attendu)
  assert.ok(!c.preuve.commande.includes('&amp;'))
  const md = rapportMarkdown({ origine: O, constats: [{ ...c, severite: 'important' }] })
  assert.ok(md.includes('`' + attendu + '`'), 'commande rendue telle quelle dans un bloc de code')
})

test('wikidata: hôte non autorisé (code 3) ou réponse illisible → non_verifie avec raison', async () => {
  const refuse = { demander: async () => { throw new ErreurGeo('Hôte non autorisé : www.wikidata.org', 3) } }
  const r = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { wikidata: true, client: refuse })
  assert.equal(r.wikidata.statut, 'non_verifie')
  assert.match(r.wikidata.raison, /non autorisé/)
  const casse = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { wikidata: true, client: { demander: async () => ({ statut: 200, corps: 'pas du json' }) } })
  assert.equal(casse.wikidata.statut, 'non_verifie')
})

test('sortie déterministe', async () => {
  const c = collecte([page('/b', { ogSiteName: 'B' }), page('/a', { ogSiteName: 'A', jsonld: [ld(org({ telephone: '0123456789' }))] })])
  assert.deepEqual(await analyserEntite(c), await analyserEntite(c))
})

test('organisations imbriquées (publisher, manufacturer) ignorées', async () => {
  const r = await analyserEntite(collecte([
    page('/', { jsonld: [ld(org({ telephone: '01 23 45 67 89' }))] }),
    page('/p', { jsonld: [ld({ '@type': 'Product', name: 'Établi', manufacturer: { '@type': 'Organization', name: 'Fabricant Tiers', telephone: '01 00 00 00 99' } })] }),
    page('/a', { jsonld: [ld({ '@type': 'Article', headline: 'X', publisher: { '@type': 'Organization', name: 'Éditeur Tiers', telephone: '04 00 00 00 11' } })] }),
  ]))
  assert.equal(trouver(r, 'GEO-ENTITE-NOM-INCOHERENT'), undefined)
  assert.equal(trouver(r, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
  const seul = await analyserEntite(collecte([page('/a', { jsonld: [ld({ '@type': 'Article', publisher: { '@type': 'Organization', name: 'Éditeur Tiers' } })] })]))
  assert.ok(trouver(seul, 'GEO-ENTITE-SANS-ORGANIZATION'))
  const graphe = await analyserEntite(collecte([page('/', { jsonld: [ld({ '@graph': [org(), { '@type': 'WebSite', name: 'Atelier Nord' }] })] })]))
  assert.equal(trouver(graphe, 'GEO-ENTITE-SANS-ORGANIZATION'), undefined)
})

test('le suffixe du title seul ne crée jamais d’incohérence', async () => {
  const r = await analyserEntite(collecte([
    page('/', { ogSiteName: 'Atelier Nord', title: 'Contact – Services', jsonld: [ld(org())] }),
    page('/b', { title: 'Nos prestations | Menuiserie' }),
  ]))
  assert.equal(trouver(r, 'GEO-ENTITE-NOM-INCOHERENT'), undefined)
  assert.ok(r.noms.some((n) => n.sources.some((s) => s.champ === 'title')))
})

test('noms compatibles si l’un contient l’autre en mots entiers', async () => {
  const ok = await analyserEntite(collecte([page('/', { ogSiteName: 'Acme', jsonld: [ld(org({ name: 'Acme Corporation' }))] })]))
  assert.equal(trouver(ok, 'GEO-ENTITE-NOM-INCOHERENT'), undefined)
  const ko = await analyserEntite(collecte([page('/', { ogSiteName: 'Acme', jsonld: [ld(org({ name: 'Acmeline' }))] })]))
  assert.ok(trouver(ko, 'GEO-ENTITE-NOM-INCOHERENT'))
})

test('plusieurs téléphones dans un même nœud : pas de contradiction ; formes d’adresse non comparées', async () => {
  const a = await analyserEntite(collecte([page('/', { jsonld: [ld(org({ telephone: ['01 23 45 67 89', '06 12 34 56 78'] }))] })]))
  assert.equal(trouver(a, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
  const b = await analyserEntite(collecte([
    page('/', { jsonld: [ld(org({ address: '1 rue des Tilleuls, 75001 Paris' }))] }),
    page('/c', { jsonld: [ld(org({ address: { streetAddress: '1 rue des Tilleuls', postalCode: '75001' } }))] }),
  ]))
  assert.equal(trouver(b, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
  const c = await analyserEntite(collecte([
    page('/', { jsonld: [ld(org({ telephone: '01 23 45 67 89' }))] }),
    page('/c', { jsonld: [ld(org({ telephone: '04 11 22 33 44' }))] }),
  ]))
  assert.ok(trouver(c, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'))
})

test('wikidata, intégration : vrai client réseau et serveur local répondant en application/json', async () => {
  const http = await import('node:http')
  const { creerClient } = await import('../../outils/lib/reseau.mjs')
  const accepts = []
  const srv = http.createServer((req, res) => {
    accepts.push(req.headers.accept)
    const u = new URL(req.url, 'http://x')
    const corps = u.searchParams.get('action') === 'wbgetentities'
      ? { entities: { Q42: { id: 'Q42', claims: { P856: [{ mainsnak: { datavalue: { value: 'https://www.atelier.example/' } } }] } } } }
      : { search: [{ id: 'Q42', label: 'Atelier Nord' }] }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(corps))
  })
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
  try {
    const client = creerClient({ hotes: new Set(['127.0.0.1']), autoriserLocal: true, delaiMs: 0 })
    const r = await analyserEntite(collecte([page('/', { jsonld: [ld(org())] })]), { wikidata: true, client, apiWikidata: `http://127.0.0.1:${srv.address().port}/w/api.php` })
    assert.equal(r.wikidata.statut, 'trouve', JSON.stringify(r.wikidata))
    assert.deepEqual(r.wikidata.ids, ['Q42'])
    assert.deepEqual(accepts, ['application/json', 'application/json'])
  } finally { srv.closeAllConnections?.(); srv.close() }
})

test('C1 : zéro page (robots.txt interdit tout ou inaccessible) : aucun constat d’entité, rien à créditer', async () => {
  const r = await analyserEntite({ origine: O, pages: [], site: { racine: O }, erreurs: [] })
  assert.deepEqual(r.constats, [])
  assert.deepEqual(r.noms, [])
})

test('wikidata : nom de recherche = nom d’organisation, puis og:site_name, jamais le title', async () => {
  const appels = []
  const client = { demander: async (u) => { appels.push(u); return reponse({ search: [] }) } }
  await analyserEntite(collecte([page('/', { ogSiteName: 'Og Nom', title: 'X | Titre Nom', jsonld: [ld(org({ name: 'Org Nom' }))] })]), { wikidata: true, client })
  await analyserEntite(collecte([page('/', { ogSiteName: 'Og Nom', title: 'X | Titre Nom' })]), { wikidata: true, client })
  await analyserEntite(collecte([page('/', { title: 'X | Titre Nom' })]), { wikidata: true, client })
  assert.equal(appels.length, 2)
  assert.match(appels[0], /search=Org%20Nom/)
  assert.match(appels[1], /search=Og%20Nom/)
})

// --- 0.1.1 : annuaires et places de marché : entités tierces listées par le site ---------------

const fiche = (chemin, type, nom, telephone, rue) => page(chemin, {
  title: `${nom} | Annuaire Santé`, hn: [{ niveau: 1, texte: nom }],
  jsonld: [ld({ '@context': 'https://schema.org', '@type': type, name: nom, url: O + chemin, telephone, address: { '@type': 'PostalAddress', streetAddress: rue, postalCode: '75001' } })],
})
const annuaire = (extra = []) => collecte([
  page('/', { ogSiteName: 'Annuaire Santé', jsonld: [ld(org({ name: 'Annuaire Santé', url: O + '/', telephone: '01 00 00 00 01', sameAs: ['https://profil.example/annuaire'] })), ld({ '@type': 'WebSite', name: 'Annuaire Santé' })] }),
  fiche('/praticiens/jeanne-exemple', 'Physician', 'Jeanne Exemple', '01 11 11 11 11', '1 rue Une'),
  fiche('/praticiens/paul-test', 'LocalBusiness', 'Cabinet Paul Test', '01 22 22 22 22', '2 rue Deux'),
  fiche('/praticiens/lea-fictive', 'MedicalBusiness', 'Léa Fictive', '01 33 33 33 33', '3 rue Trois'),
  ...extra,
])

test('annuaire : fiches Physician / LocalBusiness à url propre = entités tierces, aucune incohérence', async () => {
  const r = await analyserEntite(annuaire())
  assert.equal(trouver(r, 'GEO-ENTITE-NOM-INCOHERENT'), undefined)
  assert.equal(trouver(r, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
  assert.equal(trouver(r, 'GEO-ENTITE-SAMEAS-ABSENT'), undefined)
  assert.equal(trouver(r, 'GEO-ENTITE-SANS-ORGANIZATION'), undefined)
  assert.equal(r.entites_tierces, 3)
  const c = trouver(r, 'GEO-ENTITE-ENTITES-TIERCES')
  assert.equal(c.severite, 'information')
  assert.equal(c.pages.length, 3)
  assert.match(c.extrait.extrait, /Cabinet Paul Test/)
  assert.deepEqual(r.noms.map((n) => n.valeur), ['Annuaire Santé'])
  assert.deepEqual(r.types, ['Organization'])
  assert.equal(r.coordonnees.telephones.length, 1)
  // identite-numerique: the listed entities cost nothing (same value as the home page alone).
  const { calculerScores } = await import('../../outils/lib/scores.mjs')
  const identite = async (c) => calculerScores({ constats: [], contenu: [], entite: await analyserEntite(c), pages: c.pages, collecte: c }).find((x) => x.id === 'identite-numerique')
  const avec = await identite(annuaire())
  const seul = await identite(collecte(annuaire().pages.slice(0, 1)))
  assert.equal(avec.valeur, seul.valeur)
  for (const id of ['organisation-declaree', 'nom-coherent', 'coordonnees-coherentes', 'sameas-present']) assert.equal(avec.criteres.find((x) => x.id === id).acquis, 1, id)
})

test('annuaire : sans url, un nom repris par le h1 de la fiche suffit ; une fiche au nom du site reste comparée', async () => {
  const sansUrl = (chemin, nom, tel) => page(chemin, { hn: [{ niveau: 1, texte: `Dr ${nom}, ostéopathe` }], jsonld: [ld({ '@type': 'Physician', name: nom, telephone: tel })] })
  const r = await analyserEntite(annuaire([sansUrl('/p/a', 'Anne Exemple', '01 44 44 44 44')]))
  assert.equal(r.entites_tierces, 4)
  assert.equal(trouver(r, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
  // A profile node named like the site (variant included) is about the site: its phone is compared.
  const meme = await analyserEntite(annuaire([page('/contact', { jsonld: [ld(org({ name: 'Annuaire Santé SAS', url: O + '/contact', telephone: '01 99 99 99 99' }))] })]))
  assert.ok(trouver(meme, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'))
  assert.equal(meme.entites_tierces, 3)
})

test('site réellement incohérent : deux organisations du site (accueil, racine) aux noms ou téléphones différents restent signalées', async () => {
  const r = await analyserEntite(collecte([
    page('/', { ogSiteName: 'Atelier Nord', jsonld: [ld(org({ telephone: '01 23 45 67 89' }))] }),
    page('/a-propos', { hn: [{ niveau: 1, texte: 'Atelier du Sud' }], jsonld: [ld(org({ name: 'Atelier du Sud', '@id': O + '/#organisation', telephone: '04 11 22 33 44' }))] }),
  ]))
  assert.ok(trouver(r, 'GEO-ENTITE-NOM-INCOHERENT'))
  assert.ok(trouver(r, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'))
  assert.equal(r.entites_tierces, 0)
  assert.equal(trouver(r, 'GEO-ENTITE-ENTITES-TIERCES'), undefined)
  // A node with no url, no h1 match and another name stays the site's (existing rule): still flagged.
  const sansIndice = await analyserEntite(collecte([page('/', { ogSiteName: 'Atelier Nord' }), page('/contact', { jsonld: [ld(org({ name: 'Atelier du Nord SARL', url: '#x' }))] })]))
  assert.ok(trouver(sansIndice, 'GEO-ENTITE-NOM-INCOHERENT'))
})

test('entités tierces : jamais sans nom du site connu ; seules tierces = pas d’organisation du site', async () => {
  // No site name at all (no og:site_name, WebSite, --marque, home or root organisation): nothing is set aside.
  const r = await analyserEntite(collecte([fiche('/p/a', 'Physician', 'Anne Exemple', '01 11 11 11 11', '1 rue Une'), fiche('/p/b', 'Physician', 'Bruno Test', '01 22 22 22 22', '2 rue Deux')]))
  assert.equal(r.entites_tierces, 0)
  assert.ok(trouver(r, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'))
  // The site names itself, but only listed entities carry an organisation node.
  const seules = await analyserEntite(collecte([page('/', { ogSiteName: 'Annuaire Santé' }), fiche('/p/a', 'Physician', 'Anne Exemple', '01 11 11 11 11', '1 rue Une')]))
  assert.equal(seules.entites_tierces, 1)
  assert.match(trouver(seules, 'GEO-ENTITE-SANS-ORGANIZATION').preuve.detail, /hors 1 entité\(s\) tierce\(s\)/)
  assert.equal(trouver(seules, 'GEO-ENTITE-SAMEAS-ABSENT'), undefined)
  // Mode dossier: page URLs are paths, the root is still recognised.
  const dossier = await analyserEntite({ pages: [
    { url: '/', lang: 'fr', ogSiteName: 'Annuaire Santé', hn: [], jsonld: [ld(org({ name: 'Annuaire Santé', telephone: '0100000001' }))], profondeur: 0 },
    { url: '/p/a', lang: 'fr', hn: [{ niveau: 1, texte: 'Anne Exemple' }], jsonld: [ld({ '@type': 'Physician', name: 'Anne Exemple', url: '/p/a', telephone: '0111111111' })], profondeur: 2 },
  ], site: { racine: null } })
  assert.equal(dossier.entites_tierces, 1)
  assert.equal(trouver(dossier, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
})

// --- 0.1.1, revue : ancrage sur l'accueil ou la page de départ, signal d'annuaire pour la règle du h1 ---------

test('cas A : page « À propos » dont le h1 et l’organisation portent une raison sociale distincte, sans url → signalée', async () => {
  const r = await analyserEntite(collecte([
    page('/', { ogSiteName: 'Atelier Nord', jsonld: [ld(org({ telephone: '01 23 45 67 89' }))] }),
    page('/a-propos', { hn: [{ niveau: 1, texte: 'Atelier du Sud' }], jsonld: [ld(org({ name: 'Atelier du Sud', telephone: '04 11 22 33 44' }))] }),
  ]))
  assert.ok(trouver(r, 'GEO-ENTITE-NOM-INCOHERENT'))
  assert.ok(trouver(r, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'))
  assert.equal(r.entites_tierces, 0)
})

test('cas B : seule organisation sur la page de départ /fr/ avec url = cette page → entité du site', async () => {
  const r = await analyserEntite(collecte([
    page('/fr/', { profondeur: 0, ogSiteName: 'Atelier Nord', jsonld: [ld(org({ name: 'Menuiserie Verte', url: O + '/fr/' }))] }),
    page('/fr/contact', { ogSiteName: 'Atelier Nord' }),
  ]))
  assert.equal(trouver(r, 'GEO-ENTITE-SANS-ORGANIZATION'), undefined)
  assert.ok(trouver(r, 'GEO-ENTITE-NOM-INCOHERENT'))
  assert.equal(r.entites_tierces, 0)
})

test('cas C : url de l’accueil en /index.html ou avec ?utm= → racine ; une fiche mise en avant sur l’accueil reste tierce', async () => {
  for (const url of [O + '/index.html', O + '/?utm_source=lettre', '/index.php']) {
    const r = await analyserEntite(collecte([
      page('/', { ogSiteName: 'Atelier Nord', jsonld: [ld(org({ name: 'Menuiserie Verte', url }))] }),
      page('/b', { jsonld: [ld(org({ name: 'Menuiserie Verte', url, telephone: '0123456789' }))] }),
    ]))
    assert.equal(trouver(r, 'GEO-ENTITE-SANS-ORGANIZATION'), undefined, url)
    assert.ok(trouver(r, 'GEO-ENTITE-NOM-INCOHERENT'), url)
    assert.equal(r.entites_tierces, 0, url)
  }
  const index = await analyserEntite(collecte([page('/index.html', { profondeur: 0, ogSiteName: 'Atelier Nord', jsonld: [ld(org({ name: 'Menuiserie Verte', url: O + '/index.html' }))] })]))
  assert.equal(trouver(index, 'GEO-ENTITE-SANS-ORGANIZATION'), undefined)
  assert.ok(trouver(index, 'GEO-ENTITE-NOM-INCOHERENT'))
  const enAvant = await analyserEntite(collecte([page('/', { ogSiteName: 'Annuaire Santé', jsonld: [ld(org({ name: 'Annuaire Santé' })), ld({ '@type': 'Physician', name: 'Jeanne Exemple', url: O + '/praticiens/jeanne-exemple', telephone: '0111111111' })] })]))
  assert.equal(enAvant.entites_tierces, 1)
  assert.equal(trouver(enAvant, 'GEO-ENTITE-NOM-INCOHERENT'), undefined)
})

test('signal d’annuaire : deux fiches sans url de noms différents repris par le h1 → tierces ; une seule → du site', async () => {
  const sansUrl = (chemin, nom, tel) => page(chemin, { hn: [{ niveau: 1, texte: nom }], jsonld: [ld({ '@type': 'Physician', name: nom, telephone: tel })] })
  const accueil = page('/', { ogSiteName: 'Annuaire Santé', jsonld: [ld(org({ name: 'Annuaire Santé', telephone: '0100000001', sameAs: ['https://profil.example/a'] }))] })
  const deux = await analyserEntite(collecte([accueil, sansUrl('/p/a', 'Anne Exemple', '0111111111'), sansUrl('/p/b', 'Bruno Test', '0122222222')]))
  assert.equal(deux.entites_tierces, 2)
  assert.equal(trouver(deux, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'), undefined)
  const une = await analyserEntite(collecte([accueil, sansUrl('/p/a', 'Anne Exemple', '0111111111')]))
  assert.equal(une.entites_tierces, 0)
  assert.ok(trouver(une, 'GEO-ENTITE-COORDONNEES-CONTRADICTOIRES'))
})
