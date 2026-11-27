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
const contenuFr = (passages = [passage()], constats = [], url = null) => ({ url, sans_texte: false, langue: 'fr', prise_en_charge: true, passages, constats })
const contenuAutre = { url: null, sans_texte: false, langue: 'autre', prise_en_charge: false, passages: [], constats: [] }
const sansTexte = (url) => ({ url, sans_texte: true, langue: 'autre', prise_en_charge: false, passages: [], constats: [] })
const sansPassage = (url) => ({ url, sans_texte: false, langue: 'fr', prise_en_charge: true, passages: [], constats: [] })
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
  assert.equal(critere(deux, 'recherche-non-bloquee').acquis, critere(un, 'recherche-non-bloquee').acquis)
  assert.equal(critere(deux, 'recherche-non-bloquee').poids, 30)
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
  const avecSource = contenuFr([passage()], [constat('GEO-CONTENU-SANS-SOURCE', [`${O}/p1`])], `${O}/p1`)
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

test('Wikidata : trouvé = acquis, ambigu et absent = non calculés (absence normale, non pénalisée)', () => {
  const wd = (statut) => critere(score(calcul({ entite: { ...entiteOk, wikidata: { statut } } }), 'identite-numerique'), 'wikidata').acquis
  assert.equal(wd('trouve'), 1)
  assert.equal(wd('ambigu'), null)
  assert.equal(wd('absent'), null)
  const c = critere(score(calcul({ entite: { ...entiteOk, wikidata: { statut: 'absent' } } }), 'identite-numerique'), 'wikidata')
  assert.match(c.preuve, /absence normale pour une petite structure, non pénalisée/)
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

// --- fix round 1 ---
test('zéro page + robots.txt bloque tout : critère à 0, acces-ia calculé', () => {
  const liste = calcul({ pages: [], constats: [constat('GEO-ROBOTSTXT-BLOQUE-TOUT'), constat('GEO-ROBOTS-RECHERCHE-BLOQUE'), constat('GEO-ROBOTS-CONSULTATION-BLOQUE')] })
  assert.equal(critere(score(liste, 'seo-technique'), 'robots-txt-ouvert').acquis, 0)
  const a = score(liste, 'acces-ia')
  assert.equal(critere(a, 'recherche-non-bloquee').acquis, 0)
  assert.notEqual(a.valeur, null)
})

test('zéro page + défi WAF : pas-de-defi-waf à 0, preuve explicite', () => {
  const c = critere(score(calcul({ pages: [], constats: [constat('GEO-WAF-DEFI', [`${O}/`])] }), 'acces-ia'), 'pas-de-defi-waf')
  assert.equal(c.acquis, 0)
  assert.match(c.preuve, /défi WAF : aucune page analysable/)
})

test('même cause : robots.txt bloque tout rend la consultation non calculée', () => {
  const avec = score(calcul({ constats: [constat('GEO-ROBOTSTXT-BLOQUE-TOUT'), constat('GEO-ROBOTS-CONSULTATION-BLOQUE')] }), 'acces-ia')
  const c = critere(avec, 'consultation-non-bloquee')
  assert.equal(c.acquis, null)
  assert.match(c.preuve, /même cause que recherche-non-bloquee \(robots\.txt bloque tout\)/)
  const seul = score(calcul({ constats: [constat('GEO-ROBOTS-CONSULTATION-BLOQUE')] }), 'acces-ia')
  assert.equal(critere(seul, 'consultation-non-bloquee').acquis, 0)
})

test('URL en erreur : dénominateur = URL connues (pages, erreurs, sitemap), preuve fidèle', () => {
  const erreurs = [1, 2, 3, 4].map((i) => `${O}/casse${i}`)
  const s = score(calcul({ constats: [constat('GEO-HTTP-ERREUR', erreurs)] }), 'seo-technique')
  const c = critere(s, 'reponses-http')
  assert.equal(c.acquis, 0.5)
  assert.match(c.preuve, /4 URL sur 8 URL connues/)
})

test('URL du sitemap comptées dans les URL connues via la collecte', () => {
  const collecte = { erreurs: [], site: { sitemaps: [{ urls: [`${O}/a`, `${O}/b`, `${O}/c`, `${O}/d`] }] } }
  const c = critere(score(calcul({ collecte, constats: [constat('GEO-SITEMAP-INCOHERENT', [`${O}/a`])] }), 'seo-technique'), 'sitemap-coherent')
  assert.equal(c.acquis, 0.875)
})

test('critère par page : les URL non collectées ne comptent pas', () => {
  const c = critere(score(calcul({ constats: [constat('GEO-NOINDEX', [`${O}/p1`, `${O}/ailleurs`])] }), 'seo-technique'), 'indexable')
  assert.equal(c.acquis, 0.75)
})

test('site multilingue : 1 page FR + 49 DE, couverture de la qualité sémantique basse, valeur null', () => {
  const contenu = [contenuFr(), ...Array.from({ length: 49 }, () => contenuAutre)]
  const q = score(calcul({ pages: pages(50), contenu }), 'qualite-semantique')
  assert.ok(q.couverture <= 0.5)
  assert.equal(q.valeur, null)
  assert.match(critere(q, 'sources-citees').preuve, /49 page\(s\)/)
})

test('auteur : seules les pages d’article comptent, non calculé sans page d’article', () => {
  const sansArticle = [`${O}/`, `${O}/contact`, `${O}/mentions-legales`].map((url) => ({ url, title: 't', hn: [] }))
  const s = score(calcul({ pages: sansArticle, contenu: sansArticle.map((p) => contenuFr([passage()], [], p.url)), constats: [constat('GEO-CONTENU-AUTEUR-ABSENT', sansArticle.map((p) => p.url))] }), 'potentiel-citation')
  assert.equal(critere(s, 'auteur-declare').acquis, null)
  assert.match(critere(s, 'auteur-declare').preuve, /aucune page d’article/)
  const avec = [...sansArticle, { url: `${O}/blog/un-article`, title: 't', hn: [] }]
  const s2 = score(calcul({ pages: avec, contenu: avec.map((p) => contenuFr([passage()], [], p.url)), constats: [constat('GEO-CONTENU-AUTEUR-ABSENT', avec.map((p) => p.url))] }), 'potentiel-citation')
  assert.equal(critere(s2, 'auteur-declare').acquis, 0)
})

// --- fix round 2 ---
const art = `${O}/blog/un-article`
const pagesArt = [{ url: `${O}/`, title: 't', hn: [] }, { url: `${O}/contact`, title: 't', hn: [] }, { url: art, title: 't', hn: [] }]
const contenuPages = (liste) => liste.map((p) => contenuFr([passage()], [], p.url))

test('auteur : un constat sur /contact (non article) ne touche aucun article, critère à 1', () => {
  const s = score(calcul({ pages: pagesArt, contenu: contenuPages(pagesArt), constats: [constat('GEO-CONTENU-AUTEUR-ABSENT', [`${O}/contact`])] }), 'potentiel-citation')
  assert.equal(critere(s, 'auteur-declare').acquis, 1)
  assert.doesNotMatch(critere(s, 'auteur-declare').preuve, /hors pages collectées/)
})

test('constat sur une URL réellement non collectée : compte pour une page', () => {
  const s = score(calcul({ constats: [constat('GEO-NOINDEX', [`${O}/jamais-collectee`])] }), 'seo-technique')
  assert.equal(critere(s, 'indexable').acquis, 0.75)
})

test('articles en langue non prise en charge : ni acquis ni touchés', () => {
  const de = { ...contenuAutre, url: art }
  const s = score(calcul({ pages: pagesArt, contenu: [contenuFr([passage()], [], `${O}/`), contenuFr([passage()], [], `${O}/contact`), de], constats: [constat('GEO-CONTENU-AUTEUR-ABSENT', [art])] }), 'potentiel-citation')
  assert.equal(critere(s, 'auteur-declare').acquis, null)
  assert.match(critere(s, 'auteur-declare').preuve, /aucune page d’article/)
})

test('contenu : constats rapportés à l’URL de la page, pas à un compte brut', () => {
  const ps = pages(4)
  const contenu = ps.map((p, i) => contenuFr([passage()], i === 0 ? [constat('GEO-CONTENU-SANS-SOURCE', [p.url])] : [], p.url))
  const c = critere(score(calcul({ pages: ps, contenu }), 'qualite-semantique'), 'sources-citees')
  assert.equal(c.acquis, 0.75)
  // A constat on a URL that is not a collected page cannot dilute the denominator.
  const c2 = critere(score(calcul({ pages: ps, contenu, constats: [constat('GEO-CONTENU-SANS-SOURCE', [`${O}/p1`, `${O}/x1`, `${O}/x2`, `${O}/x3`, `${O}/x4`])] }), 'qualite-semantique'), 'sources-citees')
  assert.equal(c2.acquis, 0.75)
})

test('site monolingue : contact et mentions sans passage ne baissent ni la part ni les scores', () => {
  const ps = pages(2)
  const base = [contenuFr([passage()], [], ps[0].url), contenuFr([passage()], [], ps[1].url)]
  const avecVides = [...ps, { url: `${O}/contact`, title: 'c', hn: [] }, { url: `${O}/mentions`, title: 'm', hn: [] }]
  const contenuAvec = [...base, sansPassage(`${O}/contact`), sansTexte(`${O}/mentions`)]
  const a = calcul({ pages: ps, contenu: base })
  const b = calcul({ pages: avecVides, contenu: contenuAvec })
  for (const id of ['qualite-semantique', 'potentiel-citation']) {
    assert.equal(score(b, id).valeur, score(a, id).valeur)
    assert.equal(score(b, id).couverture, score(a, id).couverture)
  }
  assert.equal(critere(score(b, 'qualite-semantique'), 'sources-citees').part, 1)
  assert.doesNotMatch(critere(score(b, 'qualite-semantique'), 'sources-citees').preuve, /non prise en charge sur/)
})

test('preuve : mention des pages non calculées seulement s’il y en a', () => {
  const ps = pages(2)
  const sans = critere(score(calcul({ pages: ps, contenu: ps.map((p) => contenuFr([passage()], [], p.url)) }), 'qualite-semantique'), 'sources-citees')
  assert.doesNotMatch(sans.preuve, /non prise en charge sur/)
  const avec = critere(score(calcul({ pages: ps, contenu: [contenuFr([passage()], [], ps[0].url), { ...contenuAutre, url: ps[1].url }] }), 'qualite-semantique'), 'sources-citees')
  assert.match(avec.preuve, /1 page\(s\) en langue non prise en charge sur 2/)
})

test('collecterDossier réel : les URL du sitemap entrent dans les URL connues', async () => {
  const { collecterDossier } = await import('../../outils/lib/collecter.mjs')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const d = mkdtempSync(join(tmpdir(), 'geo-scores-'))
  try {
    const lorem = 'Un texte visible assez long pour être analysé par le collecteur de pages statiques. '.repeat(3)
    writeFileSync(join(d, 'index.html'), `<title>Accueil</title><p>${lorem}</p>`)
    writeFileSync(join(d, 'a.html'), `<title>A</title><p>${lorem}</p>`)
    writeFileSync(join(d, 'sitemap.xml'), '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://dossier.example/x</loc></url><url><loc>https://dossier.example/y</loc></url></urlset>')
    const collecte = collecterDossier(d)
    const s = score(calculerScores({ constats: [constat('GEO-SITEMAP-INCOHERENT', ['https://dossier.example/x'])], contenu: [], entite: null, pages: collecte.pages, collecte }), 'seo-technique')
    const c = critere(s, 'sitemap-coherent')
    assert.match(c.preuve, /1 URL sur 4 URL connues/)
    assert.equal(c.acquis, 0.75)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
