import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { genererScenarios, marquerMarque, mulberry32, normaliser, jaccard, figerJeu, eliderFr, PROFIL_NEUTRE } from '../../outils/lib/scenarios.mjs'
import { ouvrirBase } from '../../outils/lib/base.mjs'

const lireJson = (p) => JSON.parse(fs.readFileSync(new URL(`../../donnees/${p}`, import.meta.url), 'utf8'))

// Fictitious rich site profile (French).
const riche = () => ({
  categorie: ['logiciel de planification', 'application de suivi de chantier', 'outil de devis', "plateforme de gestion d'équipe", 'logiciel de facturation'],
  besoins: ['planifier les interventions', 'suivre les chantiers', 'envoyer des devis', 'gérer les plannings', 'relancer les clients', 'faire la facturation', 'organiser les équipes'],
  zones: ['Lyon', 'Nantes', 'Lille', 'Toulouse', 'Rennes'],
  concurrents: ['Planorama', 'Chantiflow', 'Devisio', 'Equipex'],
  contraintes: ['conformité RGPD', 'hébergement en France', 'facture électronique'],
  marque: { nom: 'Lumivia', alias: ['Lumivia Pro', 'lumivia.example'] },
  langue: 'fr',
})
const richeEn = () => ({
  categorie: ['scheduling software', 'job tracking app', 'quoting tool', 'team management platform', 'invoicing software'],
  besoins: ['scheduling jobs', 'tracking projects', 'sending quotes', 'managing timetables', 'chasing customers', 'invoicing', 'organising crews'],
  zones: ['Leeds', 'Bristol', 'Glasgow', 'Cardiff', 'Belfast'],
  concurrents: ['Planorama', 'Jobflow', 'Quotio', 'Crewex'],
  contraintes: ['GDPR compliance', 'UK data hosting', 'e-invoicing'],
  marque: { nom: 'Lumivia', alias: ['Lumivia Pro'] },
  langue: 'en',
})
const pauvre = () => ({
  categorie: ['logiciel de planification'], besoins: ['planifier les interventions'], zones: [], concurrents: [], contraintes: [],
  marque: { nom: 'Lumivia', alias: [] }, langue: 'fr',
})

test('meme entree + meme graine : meme empreinte et memes textes', () => {
  const a = genererScenarios(riche(), { niveau: 'standard', graine: 42 })
  const b = genererScenarios(riche(), { niveau: 'standard', graine: 42 })
  assert.equal(a.empreinte, b.empreinte)
  assert.deepEqual(a.scenarios, b.scenarios)
  assert.match(a.empreinte, /^[0-9a-f]{64}$/)
})

test('graine differente : empreinte differente', () => {
  const a = genererScenarios(riche(), { niveau: 'standard', graine: 1 })
  const b = genererScenarios(riche(), { niveau: 'standard', graine: 2 })
  assert.notEqual(a.empreinte, b.empreinte)
})

test('tailles 25 / 100 / 500 sur un profil riche (FR et EN)', () => {
  for (const [niveau, n] of [['rapide', 25], ['standard', 100], ['approfondi', 500]]) {
    assert.equal(genererScenarios(riche(), { niveau, graine: 7 }).scenarios.length, n, `fr ${niveau}`)
    assert.equal(genererScenarios(richeEn(), { niveau, graine: 7 }).scenarios.length, n, `en ${niveau}`)
  }
})

test('exhaustif : 1000 atteignable avec un profil riche, sinon manques le dit', () => {
  const r = genererScenarios(riche(), { niveau: 'exhaustif', graine: 3 })
  assert.equal(r.scenarios.length, 1000)
  assert.deepEqual(r.manques, [])
  assert.equal(genererScenarios(richeEn(), { niveau: 'exhaustif', graine: 3 }).scenarios.length, 1000)
})

test('la marque et ses alias n apparaissent jamais ; avec_marque faux', () => {
  for (const p of [riche(), richeEn()]) {
    const r = genererScenarios(p, { niveau: 'approfondi', graine: 5 })
    for (const s of r.scenarios) {
      const t = normaliser(s.texte)
      assert.ok(!/\blumivia\b/.test(t), s.texte)
      assert.equal(s.avec_marque, false)
    }
  }
})

test('une marque presente dans une donnee du profil est ecartee (accents, casse)', () => {
  const p = riche()
  p.marque = { nom: 'Planorama', alias: [] } // also listed as a competitor
  p.besoins.push('utiliser PLANORAMA au quotidien')
  const r = genererScenarios(p, { niveau: 'approfondi', graine: 5 })
  assert.ok(r.scenarios.length > 0)
  for (const s of r.scenarios) assert.ok(!/planorama/i.test(s.texte), s.texte)
  assert.ok(r.manques.some((m) => /concurrent/.test(m) && /Planorama/.test(m)))
})

test('aucune paire au Jaccard >= 0,8 et aucun doublon normalise', () => {
  const r = genererScenarios(riche(), { niveau: 'approfondi', graine: 11 })
  const mots = r.scenarios.map((s) => new Set(normaliser(s.texte).split(' ')))
  const vus = new Set()
  for (const s of r.scenarios) { const n = normaliser(s.texte); assert.ok(!vus.has(n)); vus.add(n) }
  for (let i = 0; i < mots.length; i++) for (let j = i + 1; j < mots.length; j++) {
    assert.ok(jaccard(mots[i], mots[j]) < 0.8, `${r.scenarios[i].texte} / ${r.scenarios[j].texte}`)
  }
})

test('entree pauvre : moins de 100, manques non vide, jamais de repetition', () => {
  const r = genererScenarios(pauvre(), { niveau: 'standard', graine: 1 })
  assert.ok(r.scenarios.length < 100)
  assert.ok(r.scenarios.length > 0)
  assert.ok(r.manques.length > 0)
  assert.equal(new Set(r.scenarios.map((s) => normaliser(s.texte))).size, r.scenarios.length)
})

test('local absent sans zones, dit dans manques ; present avec zones', () => {
  const sans = genererScenarios(pauvre(), { niveau: 'standard', graine: 1 })
  assert.ok(!sans.scenarios.some((s) => s.intention === 'local'))
  assert.ok(sans.manques.some((m) => /local/.test(m) && /zone/.test(m)))
  const avec = genererScenarios(riche(), { niveau: 'standard', graine: 1 })
  assert.ok(avec.scenarios.some((s) => s.intention === 'local'))
})

test('sans concurrents : aucun gabarit {concurrent}, comparaison et alternative continuent sans', () => {
  const p = riche(); p.concurrents = []
  const r = genererScenarios(p, { niveau: 'standard', graine: 1 })
  assert.ok(r.manques.some((m) => /concurrent/.test(m)))
  assert.ok(r.scenarios.some((s) => s.intention === 'comparaison'))
  for (const s of r.scenarios) assert.ok(!/planorama|chantiflow|devisio|equipex/i.test(s.texte))
})

test('concurrent seulement dans alternative et comparaison', () => {
  const r = genererScenarios(riche(), { niveau: 'approfondi', graine: 9 })
  const noms = /planorama|chantiflow|devisio|equipex/i
  for (const s of r.scenarios) {
    if (noms.test(s.texte)) assert.ok(['alternative', 'comparaison'].includes(s.intention), `${s.intention}: ${s.texte}`)
  }
  assert.ok(r.scenarios.some((s) => noms.test(s.texte)))
})

test('aucun emplacement {..} restant, pas de texte vide ni espaces doubles', () => {
  for (const p of [riche(), richeEn(), pauvre()]) {
    const r = genererScenarios(p, { niveau: 'approfondi', graine: 13 })
    for (const s of r.scenarios) {
      assert.ok(!/[{}]/.test(s.texte), s.texte)
      assert.equal(s.texte, s.texte.replace(/\s+/g, ' ').trim())
      assert.ok(s.texte.length > 8)
    }
  }
})

test('quotas proportionnels aux poids, plus fort reste', () => {
  const r = genererScenarios(riche(), { niveau: 'standard', graine: 4 })
  const poids = lireJson('intentions.json')
  const total = Object.values(poids).reduce((a, i) => a + i.poids, 0)
  const compte = {}
  for (const s of r.scenarios) compte[s.intention] = (compte[s.intention] ?? 0) + 1
  for (const [nom, i] of Object.entries(poids)) {
    const attendu = (100 * i.poids) / total
    assert.ok(Math.abs((compte[nom] ?? 0) - attendu) <= 1, `${nom}: ${compte[nom]} vs ${attendu}`)
  }
})

test('sortie : profil connu, poids positifs de somme 1, ordre deterministe', () => {
  const r = genererScenarios(riche(), { niveau: 'standard', graine: 4 })
  const profils = Object.keys(lireJson('profils.json'))
  for (const s of r.scenarios) {
    assert.ok(profils.includes(s.profil) || s.profil === PROFIL_NEUTRE)
    assert.ok(s.poids > 0)
  }
  const somme = r.scenarios.reduce((a, s) => a + s.poids, 0)
  assert.ok(Math.abs(somme - 1) < 1e-3, String(somme))
  assert.equal(r.niveau, 'standard')
  assert.equal(r.graine, 4)
  const ordre = Object.keys(lireJson('intentions.json'))
  const idx = r.scenarios.map((s) => ordre.indexOf(s.intention))
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b))
})

test('profil neutre sans trace de persona ; fragment de persona seulement sur les gabarits clause', () => {
  const profils = lireJson('profils.json')
  for (const langue of ['fr', 'en']) {
    const r = genererScenarios(langue === 'fr' ? riche() : richeEn(), { niveau: 'approfondi', graine: 17 })
    const gabarits = lireJson(`gabarits/${langue}.json`)
    const clauses = Object.values(gabarits).flat().filter((t) => typeof t !== 'string')
    assert.ok(clauses.every((t) => t.clause.startsWith('{profil_formulation} ')))
    let neutres = 0, persona = 0
    for (const s of r.scenarios) {
      const frag = Object.entries(profils).find(([, p]) => p.formulations[langue].some((f) => s.texte.startsWith(f + ' ')))
      if (s.profil === PROFIL_NEUTRE) { neutres++; assert.ok(!frag, s.texte) } else { persona++; assert.equal(frag?.[0], s.profil, s.texte) }
    }
    assert.ok(neutres > 0 && persona > 0)
  }
})

test('performance : exhaustif en moins de 2 s', () => {
  const t0 = Date.now()
  genererScenarios(riche(), { niveau: 'exhaustif', graine: 8 })
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`)
})

test('entrees invalides : niveau inconnu, langue inconnue, profil absent', () => {
  assert.throws(() => genererScenarios(riche(), { niveau: 'geant', graine: 1 }), /niveau/i)
  const p = riche(); p.langue = 'de'
  assert.throws(() => genererScenarios(p, { niveau: 'rapide', graine: 1 }), /langue/i)
  assert.throws(() => genererScenarios(null, { niveau: 'rapide', graine: 1 }), /profil/i)
})

test('mulberry32 : deterministe, dans [0,1), valeur de reference', () => {
  const a = mulberry32(12345), b = mulberry32(12345)
  const suite = Array.from({ length: 5 }, () => a())
  assert.deepEqual(suite, Array.from({ length: 5 }, () => b()))
  for (const v of suite) assert.ok(v >= 0 && v < 1)
  const c = mulberry32(54321)
  assert.notDeepEqual(suite, Array.from({ length: 5 }, () => c()))
  assert.equal(mulberry32(1)(), 0.6270739405881613)
})

test('marquerMarque : mot entier, insensible casse et accents, alias', () => {
  const sc = [
    { texte: 'avis sur LUMIVIA pour planifier', avec_marque: false },
    { texte: 'lumivia pro ou autre', avec_marque: false },
    { texte: 'lumiviaire est un autre mot', avec_marque: false },
    { texte: 'Éloïse conseille Eloise Soft', avec_marque: false },
    { texte: 'rien de special', avec_marque: false },
  ]
  const r = marquerMarque(sc, { nom: 'Lumivia', alias: ['Éloïse Soft'] })
  assert.deepEqual(r.map((s) => s.avec_marque), [true, true, false, true, false])
  assert.equal(sc[0].avec_marque, false) // input not mutated
})

test('donnees : slot persona seulement dans les gabarits clause', () => {
  for (const l of ['fr', 'en']) {
    for (const [nom, liste] of Object.entries(lireJson(`gabarits/${l}.json`))) {
      for (const t of liste) if (typeof t === 'string') assert.ok(!t.includes('{profil_formulation}'), `${l}/${nom}: ${t}`)
    }
  }
})

test('donnees : 11 profils, 11 intentions, >= 6 gabarits, {concurrent} reserve', () => {
  const profils = lireJson('profils.json'), intentions = lireJson('intentions.json')
  assert.equal(Object.keys(profils).length, 11)
  assert.equal(Object.keys(intentions).length, 11)
  for (const l of ['fr', 'en']) {
    const g = lireJson(`gabarits/${l}.json`)
    for (const [nom, i] of Object.entries(intentions)) {
      assert.ok(g[nom].length >= 6, `${l}/${nom}`)
      const tt = g[nom].map((t) => (typeof t === 'string' ? t : t.clause))
      assert.ok(i.poids > 0)
      if (!i.avec_marque_autorise) for (const t of tt) assert.ok(!t.includes('{concurrent}'), `${l}/${nom}: ${t}`)
    }
    for (const p of Object.values(profils)) assert.ok(p.formulations[l].length >= 2 && p.poids > 0)
  }
  const permis = Object.entries(intentions).filter(([, i]) => i.avec_marque_autorise).map(([n]) => n).sort()
  assert.deepEqual(permis, ['alternative', 'comparaison'])
})

test('francais : pas d elision manquante ni de contraction manquante', () => {
  for (const graine of [1, 2, 3]) {
    const p = riche()
    p.besoins.push('harmoniser les tarifs', 'hausser les prix')
    const r = genererScenarios(p, { niveau: 'exhaustif', graine })
    const noms = new RegExp([...p.concurrents, ...p.zones].join('|'), 'g') // proper nouns are never altered
    for (const s of r.scenarios) {
      const t = s.texte.replace(noms, '#').replace(/\bil y a\b/gi, '').replace(/\b(de|le|la) h(aut|aus|ors|all)/gi, '')
      assert.ok(!/\b(de|que|je|ne|le|la) [aeiouyéèêàâîôûh]/i.test(t), s.texte)
      assert.ok(!/\b(à|de) les? /i.test(t), s.texte)
    }
    const tous = r.scenarios.map((s) => s.texte).join('\n')
    assert.match(tous, /d'harmoniser/)
    assert.match(tous, /de hausser/)
  }
})

test('eliderFr protege concurrents et zones dans les textes generes', () => {
  const base = { ...riche(), zones: ['Les Herbiers'], concurrents: ['Le Devis', 'Hubspotte'] }
  const tous = genererScenarios(base, { niveau: 'exhaustif', graine: 2 }).scenarios.map((s) => s.texte).join('\n')
  assert.match(tous, /alternative à Le Devis/)
  assert.match(tous, /que Hubspotte/)
  assert.doesNotMatch(tous, /alternative au Devis|qu'Hubspotte|l'Devis|aux Herbiers|l'Herbiers/)
  assert.match(tous, /Les Herbiers/)
  assert.match(tous, /d'organiser/)
})

test('eliderFr : elisions, contractions, h aspire, casse', () => {
  assert.equal(eliderFr('comment faire de organiser les équipes'), "comment faire d'organiser les équipes")
  assert.equal(eliderFr('que il faut, je aime, ne ose pas'), "qu'il faut, j'aime, n'ose pas")
  assert.equal(eliderFr('le outil et la application'), "l'outil et l'application")
  assert.equal(eliderFr('Le hébergement'), "L'hébergement")
  assert.equal(eliderFr('le haut de la hausse'), 'le haut de la hausse')
  assert.equal(eliderFr('à le bureau, à les clients, de le site, de les prix'), 'au bureau, aux clients, du site, des prix')
  assert.equal(eliderFr('de le outil', 'en'), 'de le outil')
  assert.equal(eliderFr('de Marc, le chat, la table'), 'de Marc, le chat, la table')
})

test('le module n utilise pas Math.random', () => {
  const src = fs.readFileSync(new URL('../../outils/lib/scenarios.mjs', import.meta.url), 'utf8')
  assert.ok(!/Math\.random/.test(src))
})

test('figerJeu : enregistre le jeu dans la base et le relit a l identique', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geo-scen-'))
  const base = await ouvrirBase(path.join(dir, 'geo.sqlite'))
  try {
    const r = genererScenarios(riche(), { niveau: 'rapide', graine: 21 })
    const id = figerJeu(base, 'https://exemple.example', r, { langue: 'fr', pays: 'FR' })
    assert.ok(id > 0)
    const jeu = base.jeu(r.empreinte)
    assert.equal(jeu.scenarios.length, 25)
    assert.equal(jeu.langue, 'fr')
    assert.equal(jeu.graine, 21)
    assert.equal(jeu.scenarios[0].texte, r.scenarios[0].texte)
    assert.throws(() => figerJeu(base, 'https://exemple.example', r, { langue: 'fr', pays: 'FR' }), /existe déjà/)
  } finally {
    base.fermer()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
