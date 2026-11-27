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
