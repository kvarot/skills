import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detecterLangue, analyserContenu } from '../../outils/lib/contenu.mjs'
import { CATALOGUE } from '../../outils/lib/controles.mjs'

const URL_P = 'https://ex.test/guide'
const h = (texte, niveau = 2, extra = {}) => ({ type: 'titre', niveau, texte, ...extra })
const p = (texte, extra = {}) => ({ type: 'paragraphe', texte, ...extra })
const page = (blocs, extra = {}) => ({ url: URL_P, lang: 'fr', auteur: 'A. Martin', blocs, liens: [], ...extra })
const ids = (r) => r.constats.map((c) => c.id)

const FR_DEF = 'Le kayak de mer est une embarcation conçue pour la navigation côtière. Il mesure en moyenne 4,5 m de long, selon la fédération.'

test('langues : listes de mots vides fr et en (>= 50 mots, forme attendue)', () => {
  for (const l of ['fr', 'en']) {
    const d = JSON.parse(readFileSync(new URL(`../../donnees/langues/${l}.json`, import.meta.url), 'utf8'))
    assert.ok(d.mots_vides.length >= 50, l)
    for (const k of ['definition', 'source', 'question', 'unites']) assert.ok(Array.isArray(d[k]) && d[k].length, `${l}.${k}`)
    assert.ok(Array.isArray(d.pronoms_initiaux) && d.pronoms_initiaux.length, l)
  }
})

test('détection de langue : ratio de mots vides, lang de la page prioritaire', () => {
  assert.equal(detecterLangue('Le chat dort sur le canapé et la maison est calme pour les enfants.'), 'fr')
  assert.equal(detecterLangue('The cat sleeps on the sofa and the house is quiet for all of the children.'), 'en')
  assert.equal(detecterLangue('Die Katze schläft auf dem Sofa und das Haus ist ruhig für die Kinder.'), 'autre')
  assert.equal(detecterLangue(''), 'autre')
  assert.equal(detecterLangue('Le chat dort sur le canapé et la maison est calme.', 'en-GB'), 'en')
  assert.equal(detecterLangue('The cat sleeps on the sofa and the house is quiet.', 'fr-CA'), 'fr')
  // A declared language other than fr/en wins even when stopwords match.
  assert.equal(detecterLangue('The cat sleeps on the sofa and the house is quiet for the children.', 'de'), 'autre')
})

test('passage FR : définition, chiffre à virgule décimale et source vrais', () => {
  const r = analyserContenu(page([h('Le kayak de mer'), p(FR_DEF)]))
  assert.equal(r.langue, 'fr')
  assert.equal(r.prise_en_charge, true)
  assert.equal(r.passages.length, 1)
  const ps = r.passages[0]
  assert.equal(ps.id, URL_P + '#1')
  assert.equal(ps.criteres.definition, true)
  assert.equal(ps.criteres.chiffre, true)
  assert.equal(ps.criteres.source, true)
  assert.equal(ps.criteres.autonome, true)
  assert.equal(ps.criteres.question_titre, false)
  assert.equal(ps.criteres.structure, false)
  assert.equal(ps.note, 4)
  assert.ok(Number.isInteger(ps.note) && ps.note <= 6)
  assert.ok(ps.mots > 10)
})

test('passage EN : « It is also… » n’est pas autonome ; X is a / X are définissent', () => {
  const r = analyserContenu(page([h('Sea kayaks'), p('It is also used for the long trips along the coast with all of the family.'), h('What is a kayak?'), p('A kayak is a small boat that is driven by a paddle.'), h('Boats'), p('Kayaks are light boats used by the people of the north.')], { lang: 'en' }))
  assert.equal(r.langue, 'en')
  assert.equal(r.passages[0].criteres.autonome, false)
  assert.equal(r.passages[0].criteres.definition, false)
  assert.equal(r.passages[1].criteres.definition, true)
  assert.equal(r.passages[1].criteres.question_titre, true)
  assert.equal(r.passages[2].criteres.definition, true)
})

test('élisions françaises : « C’est un… » sans sujet nommé n’est pas une définition ; « L’outil est une… » oui', () => {
  const r = analyserContenu(page([
    h('Un'), p('C’est un outil très pratique pour les cabinets de la ville.'),
    h('Deux'), p('L’outil est une application web utilisée par les praticiens de la région.'),
    h('Trois'), p('Il est un peu long de le dire dans le détail pour les débutants.'),
  ]))
  assert.deepEqual(r.passages.map((x) => x.criteres.definition), [false, true, false])
  assert.deepEqual(r.passages.map((x) => x.criteres.autonome), [false, true, false])
})

test('définition : seulement dans les deux premières phrases', () => {
  const r = analyserContenu(page([h('T'), p('Phrase une du texte pour la page. Phrase deux du texte pour la page. Le kayak est une embarcation de mer pour les gens.')]))
  assert.equal(r.passages[0].criteres.definition, false)
})

test('chiffre : virgule décimale, espaces fines, pourcentage et monnaies ; pas de faux positif', () => {
  const crit = (texte) => analyserContenu(page([h('T'), p(texte)])).passages[0].criteres.chiffre
  assert.equal(crit('La coque pèse 12,5 kg pour la plupart des modèles de la gamme.'), true)
  assert.equal(crit('Le prix est de 1 250 € pour les modèles de la gamme de base.'), true)
  assert.equal(crit('Le prix est de 1 250 € pour les modèles de la gamme de base.'), true)
  assert.equal(crit('Environ 35 % des pratiquants sont des femmes dans la région.'), true)
  assert.equal(crit('Le tarif est de $45 ou £30 pour les adultes de la région.'), true)
  assert.equal(crit('Il y en a 3 dans le hangar et les gens de la ville le savent.'), false)
  assert.equal(crit('En 2024 l’outil est prêt pour les gens de la ville et les enfants.'), false)
})

test('source : motif ou lien externe dont le texte figure dans le passage', () => {
  const blocs = [h('T'), p('Le rapport annuel de la fédération nationale décrit la saison pour les clubs de la région.')]
  const crit = (liens) => analyserContenu(page(blocs, { liens })).passages[0].criteres.source
  assert.equal(crit([]), false)
  assert.equal(crit([{ href: 'https://fede.example/rapport', texte: 'rapport annuel' }]), true)
  assert.equal(crit([{ href: '/rapport', texte: 'rapport annuel' }, { href: 'https://ex.test/x', texte: 'fédération' }]), false)
  assert.equal(crit([{ href: 'https://fede.example/', texte: 'de' }]), false)
  assert.equal(crit([{ href: 'https://fede.example/', texte: 'autre chose' }]), false)
  assert.equal(crit([{ href: 'mailto:a@fede.example', texte: 'rapport annuel' }]), false)
  const motif = analyserContenu(page([h('T'), p('Source : fédération nationale, rapport annuel pour les clubs de la région.')])).passages[0].criteres.source
  assert.equal(motif, true)
})

test('question_titre et structure', () => {
  const r = analyserContenu(page([
    h('Comment choisir son kayak ?'), p('Il faut regarder la longueur et le poids de la coque pour les sorties en mer.'),
    { type: 'liste', texte: 'Longueur\nPoids\nPrix' },
    h('Où ranger la coque'), p('La coque se range à plat dans le hangar de la maison.'),
    h('Tarifs'), p('Voici les prix.'), { type: 'tableau', texte: 'Modèle | Prix\nA | 10' },
    h('Description'), p('La coque est légère.'),
  ]))
  assert.deepEqual(r.passages.map((x) => x.criteres.question_titre), [true, true, false, false])
  assert.deepEqual(r.passages.map((x) => x.criteres.structure), [true, false, true, false])
})

test('note = nombre de critères vrais, sans critère de longueur', () => {
  const court = analyserContenu(page([h('Un kayak ?'), p('Un kayak est un bateau.')])).passages[0]
  const long = analyserContenu(page([h('Un kayak ?'), p('Un kayak est un bateau. ' + 'Phrase de remplissage pour la page. '.repeat(200))])).passages[0]
  assert.deepEqual(court.criteres, long.criteres)
  assert.equal(court.note, long.note)
  assert.equal(court.note, Object.values(court.criteres).filter(Boolean).length)
})

test('découpage : blocs avant le premier titre (titre null), titres consécutifs vides ignorés, ids séquentiels', () => {
  const r = analyserContenu(page([p('Introduction de la page pour les gens de la ville.'), h('A'), h('B'), p('Texte de la section B pour les gens de la ville.')]))
  assert.deepEqual(r.passages.map((x) => x.titre), [null, 'B'])
  assert.deepEqual(r.passages.map((x) => x.id), [URL_P + '#1', URL_P + '#2'])
  const sans = analyserContenu(page([p('Un texte sans aucun titre pour les gens de la ville et la maison.')]))
  assert.equal(sans.passages.length, 1)
  assert.equal(sans.passages[0].titre, null)
})

test('nosnippet : blocs exclus des passages ; page entièrement nosnippet sans passage ni constat', () => {
  const r = analyserContenu(page([h('A'), p(FR_DEF, { nosnippet: true }), p('Un autre texte pour les gens de la ville et la maison.')]))
  assert.equal(r.passages.length, 1)
  assert.equal(r.passages[0].criteres.definition, false)
  const tout = analyserContenu(page([h('A', 2, { nosnippet: true }), p(FR_DEF, { nosnippet: true })]))
  assert.deepEqual(tout.passages, [])
  assert.deepEqual(tout.constats, [])
})

test('page vide ou sans blocs : aucune exception, aucun passage, aucun constat', () => {
  for (const x of [{}, { url: URL_P }, page([]), { url: URL_P, blocs: null }, undefined]) {
    const r = analyserContenu(x)
    assert.deepEqual(r.passages, [])
    assert.deepEqual(r.constats, [])
  }
})

test('page allemande : langue autre, non prise en charge, aucun constat de contenu', () => {
  const texte = 'Das Kajak ist ein Boot für die Fahrt auf dem Meer und die Kinder lieben das Wasser.'
  const r = analyserContenu(page([h('Das Kajak'), p(texte)], { lang: 'de', auteur: null }))
  assert.equal(r.langue, 'autre')
  assert.equal(r.prise_en_charge, false)
  assert.deepEqual(r.constats, [])
  assert.deepEqual(r.passages, [])
  // Without a declared language, German text is detected as autre too.
  const sans = analyserContenu(page([h('Das Kajak'), p(texte)], { lang: null, auteur: null }))
  assert.equal(sans.langue, 'autre')
  assert.deepEqual(sans.constats, [])
})

test('constats : définition, source, auteur et passages dépendants', () => {
  const r = analyserContenu(page([
    h('A'), p('Il y a des choses à savoir pour les gens de la ville.'),
    h('B'), p('Elle est belle pour les gens de la ville et la maison.'),
    h('C'), p('Ce texte est court pour les gens de la ville et la maison.'),
  ], { auteur: null }))
  assert.deepEqual(ids(r).sort(), ['GEO-CONTENU-AUCUNE-DEFINITION', 'GEO-CONTENU-AUTEUR-ABSENT', 'GEO-CONTENU-PASSAGES-DEPENDANTS', 'GEO-CONTENU-SANS-SOURCE'])
  for (const c of r.constats) {
    assert.equal(c.severite, 'mineur')
    assert.equal(c.classe, 'heuristique')
    assert.equal(c.categorie, 'contenu')
    assert.deepEqual(c.pages, [URL_P])
    assert.equal(c.preuve.type, 'html')
    assert.equal(c.preuve.url, URL_P)
  }
  const bon = analyserContenu(page([h('Le kayak'), p(FR_DEF)]))
  assert.deepEqual(bon.constats, [])
  // Exactly 50 % dependent does not trigger the finding (strictly more than 50 %).
  const moitie = analyserContenu(page([h('A'), p('Il y a des choses à savoir pour les gens de la ville.'), h('B'), p('Le kayak est une embarcation de mer selon la fédération de 4 m.')]))
  assert.ok(!ids(moitie).includes('GEO-CONTENU-PASSAGES-DEPENDANTS'))
})

test('catalogue : les quatre ids de contenu sont enregistrés (mineur, heuristique)', () => {
  for (const id of ['GEO-CONTENU-AUCUNE-DEFINITION', 'GEO-CONTENU-SANS-SOURCE', 'GEO-CONTENU-AUTEUR-ABSENT', 'GEO-CONTENU-PASSAGES-DEPENDANTS']) {
    const e = CATALOGUE.find((x) => x.id === id)
    assert.ok(e, id)
    assert.deepEqual([e.severite, e.categorie, e.classe], ['mineur', 'contenu', 'heuristique'])
  }
})

test('sortie : titre échappé et borné, déterminisme', () => {
  const titre = '<script>x</script>' + 'a'.repeat(400)
  const entree = page([h(titre), p(FR_DEF)])
  const r = analyserContenu(entree)
  assert.ok(!r.passages[0].titre.includes('<'))
  assert.ok(r.passages[0].titre.length <= 280)
  assert.equal(r.passages[0].non_fiable, true)
  assert.equal(JSON.stringify(analyserContenu(entree)), JSON.stringify(analyserContenu(entree)))
})
