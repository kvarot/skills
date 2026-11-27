import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculerScores, chargerPoids, CONSTATS_UTILISES } from '../../outils/lib/scores.mjs'
import { CATALOGUE } from '../../outils/lib/controles.mjs'

const O = 'https://www.atelier.example'
const pages = (n) => Array.from({ length: n }, (_, i) => ({ url: `${O}/p${i + 1}`, title: `Page ${i + 1}`, hn: [{ niveau: 1, texte: `Titre ${i + 1}` }] }))
const constat = (id, pagesTouchees = []) => {
  const def = CATALOGUE.find((c) => c.id === id)
  return { id, severite: def.severite, categorie: def.categorie, classe: def.classe, pages: pagesTouchees }
}
const passage = (extra = {}) => ({ id: 'x#1', titre: null, mots: 40, criteres: { definition: false, chiffre: false, source: false, autonome: true, question_titre: false, structure: false }, note: 1, ...extra })
const contenuFr = (passages = [passage()], constats = []) => ({ langue: 'fr', prise_en_charge: true, passages, constats })
const contenuAutre = { langue: 'autre', prise_en_charge: false, passages: [], constats: [] }
const entiteOk = { noms: [], types: ['Organization'], sameAs: ['https://x.example/a'], coordonnees: {}, wikidata: { statut: 'non_verifie' }, constats: [] }
const calcul = (entrees, poids) => calculerScores({ constats: [], contenu: [], entite: null, pages: pages(4), ...entrees }, poids)
const score = (liste, id) => liste.find((s) => s.id === id)
const critere = (s, id) => s.criteres.find((c) => c.id === id)

test('aucun constat : seo-technique 100, couverture 1', () => {
  const s = score(calcul({}), 'seo-technique')
  assert.equal(s.valeur, 100)
  assert.equal(s.couverture, 1)
  assert.equal(s.version_poids, '0.1.0')
})

test('constat sur une page de quatre : critère à 0,75, preuve nommant le constat et les pages', () => {
  const s = score(calcul({ constats: [constat('GEO-NOINDEX', [`${O}/p1`])] }), 'seo-technique')
  const c = critere(s, 'indexable')
  assert.equal(c.acquis, 0.75)
  assert.match(c.preuve, /GEO-NOINDEX/)
  assert.match(c.preuve, /1 page\(s\) sur 4/)
  assert.ok(s.valeur < 100 && s.valeur > 90)
})

test('constat de site (sans pages) : touche toutes les pages, critère à 0', () => {
  const s = score(calcul({ constats: [constat('GEO-SITEMAP-ABSENT')] }), 'seo-technique')
  assert.equal(critere(s, 'sitemap-present').acquis, 0)
})

test('une même cause pèse une fois : robots.txt bloque tout + robot de recherche bloqué', () => {
  const un = score(calcul({ constats: [constat('GEO-ROBOTS-RECHERCHE-BLOQUE')] }), 'acces-ia')
  const deux = score(calcul({ constats: [constat('GEO-ROBOTS-RECHERCHE-BLOQUE'), constat('GEO-ROBOTSTXT-BLOQUE-TOUT')] }), 'acces-ia')
  assert.equal(critere(deux, 'recherche-non-bloquee').acquis, 0)
  assert.equal(deux.valeur, un.valeur)
  assert.match(critere(deux, 'recherche-non-bloquee').preuve, /GEO-ROBOTSTXT-BLOQUE-TOUT/)
  assert.match(critere(deux, 'recherche-non-bloquee').preuve, /GEO-ROBOTS-RECHERCHE-BLOQUE/)
})

test('langue non prise en charge : qualité sémantique non calculée, couverture qui baisse (Review Focus 5)', () => {
  const s = calcul({ contenu: [contenuAutre, contenuAutre] })
  const q = score(s, 'qualite-semantique')
  assert.equal(q.valeur, null)
  assert.equal(q.couverture, 0)
  assert.ok(q.criteres.every((c) => c.acquis === null))
  assert.match(q.criteres[0].preuve, /langue non prise en charge/)
  const p = score(s, 'potentiel-citation')
  assert.ok(p.couverture < 1)
  assert.ok(p.criteres.filter((c) => c.acquis === null).length > 0)
})

test('contenu supporté : les pages en langue autre ne comptent pas', () => {
  const avecSource = contenuFr([passage()], [constat('GEO-CONTENU-SANS-SOURCE', [`${O}/p1`])])
  const s = score(calcul({ contenu: [avecSource, contenuAutre] }), 'qualite-semantique')
  assert.equal(critere(s, 'sources-citees').acquis, 0)
  assert.match(critere(s, 'sources-citees').preuve, /1 page\(s\) sur 1/)
})

test('GEO-LLMSTXT et GEO-CONTENT-SIGNAL ne changent aucun score', () => {
  const base = calcul({})
  const avec = calcul({ constats: [constat('GEO-LLMSTXT'), constat('GEO-CONTENT-SIGNAL'), constat('GEO-ROBOTS-ENTRAINEMENT-POLITIQUE')] })
  assert.deepEqual(avec, base)
  assert.ok(!CONSTATS_UTILISES.has('GEO-LLMSTXT'))
  assert.ok(!CONSTATS_UTILISES.has('GEO-CONTENT-SIGNAL'))
})

test('un constat de sévérité information n’affecte jamais un score', () => {
  const faux = { ...constat('GEO-NOINDEX', [`${O}/p1`]), severite: 'information' }
  assert.deepEqual(calcul({ constats: [faux] }), calcul({}))
})

test('version_poids suit poids.json', () => {
  const poids = JSON.parse(JSON.stringify(chargerPoids()))
  poids.version = '9.9.9'
  const liste = calcul({}, poids)
  assert.ok(liste.every((s) => s.version_poids === '9.9.9'))
})

test('dix scores dans un ordre fixe ; les quatre scores mesurés valent null', () => {
  const liste = calcul({})
  assert.deepEqual(liste.map((s) => s.id), ['seo-technique', 'acces-ia', 'qualite-semantique', 'potentiel-citation', 'identite-numerique', 'couverture-intentions',
    'autorite-thematique', 'reputation-externe', 'positionnement-concurrentiel', 'visibilite-mesuree'])
  for (const id of ['autorite-thematique', 'reputation-externe', 'positionnement-concurrentiel', 'visibilite-mesuree']) {
    const s = score(liste, id)
    assert.equal(s.valeur, null)
    assert.equal(s.couverture, 0)
    assert.equal(s.raison, 'nécessite une mesure (v0.2)')
    assert.deepEqual(s.criteres, [])
  }
})

test('zéro page : aucune exception, valeurs null, aucune division par zéro', () => {
  const liste = calcul({ pages: [] })
  for (const s of liste) {
    assert.ok(s.valeur === null)
    assert.ok(Number.isFinite(s.couverture))
  }
  assert.equal(score(liste, 'seo-technique').couverture, 0)
})

test('couverture < 0,5 : valeur null avec raison', () => {
  const s = score(calcul({ entite: null }), 'identite-numerique')
  assert.equal(s.valeur, null)
  assert.equal(s.couverture, 0)
  assert.match(s.raison, /couverture/)
})

test('identité numérique : organisation et sameAs valides, Wikidata non vérifié exclu du dénominateur', () => {
  const s = score(calcul({ entite: entiteOk }), 'identite-numerique')
  assert.equal(s.valeur, 100)
  assert.ok(s.couverture < 1 && s.couverture >= 0.5)
  assert.equal(critere(s, 'wikidata').acquis, null)
})

test('Wikidata : trouvé = acquis, ambigu = non calculé, absent = 0', () => {
  const wd = (statut) => critere(score(calcul({ entite: { ...entiteOk, wikidata: { statut } } }), 'identite-numerique'), 'wikidata').acquis
  assert.equal(wd('trouve'), 1)
  assert.equal(wd('ambigu'), null)
  assert.equal(wd('absent'), 0)
})

test('sameAs non évalué quand aucune organisation n’est déclarée (pas de double pénalité)', () => {
  const entite = { ...entiteOk, constats: [constat('GEO-ENTITE-SANS-ORGANIZATION')] }
  const s = score(calcul({ entite }), 'identite-numerique')
  assert.equal(critere(s, 'organisation-declaree').acquis, 0)
  assert.equal(critere(s, 'sameas-present').acquis, null)
})

const scenario = (texte, intention) => ({ texte, profil: 'neutre', intention, poids: 1, avec_marque: false })

test('couverture-intentions : part des intentions avec une page qui partage au moins deux mots', () => {
  const p = [{ url: `${O}/`, title: 'Logiciel de facturation pour artisans', hn: [{ niveau: 1, texte: 'Facturation artisans' }] }]
  const scenarios = [
    scenario('Quel logiciel de facturation pour artisans choisir ?', 'recommandation'),
    scenario('Combien coûte un abonnement de gestion de stock ?', 'tarif'),
  ]
  const s = score(calcul({ pages: p, scenarios }), 'couverture-intentions')
  assert.equal(s.criteres[0].classe, 'heuristique')
  assert.equal(s.criteres[0].acquis, 0.5)
  assert.equal(s.valeur, 50)
  assert.match(s.criteres[0].preuve, /1 intention\(s\) sur 2/)
})

test('couverture-intentions : sans jeu de scénarios, non calculé', () => {
  const s = score(calcul({}), 'couverture-intentions')
  assert.equal(s.valeur, null)
  assert.equal(s.couverture, 0)
})

test('déterminisme et absence de mutation des entrées', () => {
  const entrees = { constats: [constat('GEO-NOINDEX', [`${O}/p2`]), constat('GEO-ALT-ABSENT', [`${O}/p1`])], contenu: [contenuFr()], entite: entiteOk, pages: pages(4) }
  const copie = JSON.stringify(entrees)
  const a = calculerScores(entrees, chargerPoids())
  const b = calculerScores(entrees, chargerPoids())
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(entrees), copie)
})

test('arrondi : valeur entière, jamais de bruit flottant', () => {
  for (const s of calcul({ constats: [constat('GEO-VIEWPORT-ABSENT', [`${O}/p1`])], contenu: [contenuFr()], entite: entiteOk })) {
    if (s.valeur !== null) assert.ok(Number.isInteger(s.valeur))
  }
})

test('poids.json : poids positifs, aucune classe jugement', () => {
  const poids = JSON.parse(readFileSync(new URL('../../donnees/poids.json', import.meta.url), 'utf8'))
  assert.equal(poids.version, '0.1.0')
  for (const [id, def] of Object.entries(poids.scores)) {
    assert.ok(def.criteres.length > 0, id)
    for (const c of def.criteres) {
      assert.ok(c.poids > 0, `${id}/${c.id}`)
      assert.ok(['deterministe', 'heuristique'].includes(c.classe), `${id}/${c.id}`)
    }
  }
  assert.equal(calcul({}).length, 10)
})

test('tout constat bloquant ou important du catalogue est utilisé par un critère', () => {
  const manquants = CATALOGUE.filter((c) => (c.severite === 'bloquant' || c.severite === 'important') && !CONSTATS_UTILISES.has(c.id)).map((c) => c.id)
  assert.deepEqual(manquants, [])
  for (const c of CATALOGUE.filter((x) => x.severite === 'information')) assert.ok(!CONSTATS_UTILISES.has(c.id), c.id)
})

test('SCORING.md documente chaque critère et la phrase fixe', () => {
  const doc = readFileSync(new URL('../../SCORING.md', import.meta.url), 'utf8')
  const poids = chargerPoids()
  for (const def of Object.values(poids.scores)) for (const c of def.criteres) assert.ok(doc.includes(`\`${c.id}\``), c.id)
  assert.ok(doc.includes('un score de potentiel élevé ne garantit aucune citation'))
})
