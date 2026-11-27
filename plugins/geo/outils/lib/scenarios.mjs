// Reproducible weighted search-scenario generator (FR/EN).
// Pure and deterministic: same site profile + same level + same seed => same scenarios and same fingerprint.
// Discovery queries never name the brand (see references/scenarios.md); a competitor may appear only in
// intentions flagged `avec_marque_autorise` (alternative, comparaison).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ErreurGeo } from './sortie.mjs'

export const VERSION_GENERATEUR = 'scenarios-1'
const TAILLES = { rapide: 25, standard: 100, approfondi: 500, exhaustif: 1000 }
const SEUIL_JACCARD = 0.8
const ECHECS_MAX = 400 // consecutive rejected draws before an intention is declared exhausted
const LANGUES = ['fr', 'en']
export const PROFIL_NEUTRE = 'neutre' // scenario without persona phrasing: no profile claim

const donnee = (chemin) => JSON.parse(readFileSync(new URL(`../../donnees/${chemin}`, import.meta.url), 'utf8'))

// Standard mulberry32 PRNG: 32-bit state, identical output on every platform.
export function mulberry32(graine) {
  let a = graine >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Lowercase, strip accents, punctuation to spaces, collapse spaces, trim.
export function normaliser(texte) {
  return String(texte).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// French contractions and elision on filled text: "de le" -> "du", "à les" -> "aux", "de envoyer" -> "d'envoyer".
// Words with an aspirated h are left alone ("le haut", "de hors").
const H_ASPIRE = /^h(aut|aus|ors|[ée]ros|all|angar|asard|onte|uit|andicap|ibou|omard|ousse)/i
const ELISIONS = { de: "d'", que: "qu'", je: "j'", ne: "n'", le: "l'", la: "l'", me: "m'", te: "t'", se: "s'" }
const CONTRACTIONS = { 'à le': 'au', 'à les': 'aux', 'de le': 'du', 'de les': 'des' }
export function eliderFr(texte, langue = 'fr') {
  if (langue !== 'fr') return texte
  const casse = (modele, mot) => (modele[0] !== modele[0].toLowerCase() ? mot[0].toUpperCase() + mot.slice(1) : mot)
  return texte
    .replace(/(^|[^\p{L}])(à|de) (les?)(?![\p{L}])/giu, (m, av, p, d) => av + casse(p, CONTRACTIONS[`${p.toLowerCase()} ${d.toLowerCase()}`]))
    .replace(/(^|[^\p{L}])(de|que|je|ne|le|la|me|te|se) (?=[aeiouéèêëàâîïôûùœh])(\p{L}+)/giu, (m, av, mot, suivant) => {
      if (/^h/i.test(suivant) && H_ASPIRE.test(suivant)) return m
      return av + casse(mot, ELISIONS[mot.toLowerCase()]) + suivant
    })
}

export function jaccard(a, b) {
  const [petit, grand] = a.size <= b.size ? [a, b] : [b, a]
  let commun = 0
  for (const m of petit) if (grand.has(m)) commun++
  const union = a.size + b.size - commun
  return union === 0 ? 1 : commun / union
}

// Sizes alone make Jaccard >= threshold impossible when the size ratio is too low: cheap early exit.
function tropProche(a, b) {
  const [p, g] = a.size <= b.size ? [a.size, b.size] : [b.size, a.size]
  return p / g >= SEUIL_JACCARD && jaccard(a, b) >= SEUIL_JACCARD
}

function termesMarque(marque) {
  return [marque?.nom, ...(marque?.alias ?? [])].map((t) => normaliser(t ?? '')).filter(Boolean)
}

function contientMarque(texte, termes) {
  const n = ` ${normaliser(texte)} `
  return termes.some((t) => n.includes(` ${t} `))
}

// Flags scenarios naming the brand or an alias (whole word, case and accent insensitive). Returns copies.
export function marquerMarque(scenarios, marque) {
  const termes = termesMarque(marque)
  return scenarios.map((s) => ({ ...s, avec_marque: contientMarque(s.texte, termes) }))
}

// Largest-remainder apportionment of `total` units over `poids` (ties: lowest index first).
function plusFortReste(poids, total) {
  const somme = poids.reduce((a, b) => a + b, 0)
  if (somme <= 0 || total <= 0) return poids.map(() => 0)
  const parts = poids.map((p) => (total * p) / somme)
  const quotas = parts.map(Math.floor)
  let reste = total - quotas.reduce((a, b) => a + b, 0)
  const ordre = parts.map((p, i) => [p - Math.floor(p), i]).sort((x, y) => y[0] - x[0] || x[1] - y[1])
  for (let k = 0; reste > 0; k = (k + 1) % ordre.length, reste--) quotas[ordre[k][1]]++
  return quotas
}

const liste = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim()).filter(Boolean))]
const SLOTS_POOL = { categorie: 'categorie', besoin: 'besoins', zone: 'zones', concurrent: 'concurrents', contrainte: 'contraintes' }
const NOM_SLOT = { categorie: 'catégorie', besoin: 'besoin', zone: 'zone', concurrent: 'concurrent', contrainte: 'contrainte' }

function choisir(rng, tableau) {
  return tableau[Math.floor(rng() * tableau.length)]
}

function choisirPondere(rng, entrees) {
  const total = entrees.reduce((a, e) => a + e.poids, 0)
  let r = rng() * total
  for (const e of entrees) { r -= e.poids; if (r < 0) return e }
  return entrees[entrees.length - 1]
}

export function genererScenarios(profilSite, { niveau, graine } = {}) {
  if (!profilSite || typeof profilSite !== 'object') throw new ErreurGeo('Profil de site manquant ou invalide.')
  const taille = TAILLES[niveau]
  if (!taille) throw new ErreurGeo(`Niveau inconnu « ${niveau} » (attendu : ${Object.keys(TAILLES).join(', ')}).`)
  if (!Number.isFinite(graine)) throw new ErreurGeo('Graine invalide : un nombre est attendu.')
  const langue = profilSite.langue ?? 'fr'
  if (!LANGUES.includes(langue)) throw new ErreurGeo(`Langue non prise en charge « ${langue} » (attendu : ${LANGUES.join(', ')}).`)

  const intentions = donnee('intentions.json')
  const profils = donnee('profils.json')
  const gabarits = donnee(`gabarits/${langue}.json`)
  const termes = termesMarque(profilSite.marque)
  const manques = []

  // Input pools; values that name the brand are dropped and reported.
  const pools = {}
  for (const [slot, cle] of Object.entries(SLOTS_POOL)) {
    const brut = liste(profilSite[cle])
    pools[slot] = brut.filter((v) => {
      if (!contientMarque(v, termes)) return true
      manques.push(`Valeur « ${v} » (${NOM_SLOT[slot]}) écartée : elle nomme la marque ou un alias.`)
      return false
    })
  }

  // Keep only templates whose slots can all be filled; report what disappears.
  const ecartes = {}
  const actives = []
  for (const [nom, def] of Object.entries(intentions)) {
    // A template is a string (plain query) or { clause: string } (full clause that may take a persona prefix).
    const tous = (gabarits[nom] ?? [])
      .map((t) => (typeof t === 'string' ? { texte: t, clause: false } : { texte: t.clause, clause: true }))
      .filter((t) => (def.avec_marque_autorise || !t.texte.includes('{concurrent}')) && (t.clause || !t.texte.includes('{profil_formulation}')))
    const ok = []
    const manquants = new Set()
    for (const t of tous) {
      const absents = [...t.texte.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((s) => s in SLOTS_POOL && pools[s].length === 0)
      if (absents.length === 0) ok.push(t)
      else for (const s of absents) { manquants.add(s); (ecartes[s] ??= { n: 0, intentions: new Set() }).n++; ecartes[s].intentions.add(nom) }
    }
    if (ok.length === 0) {
      const causes = [...manquants].map((s) => NOM_SLOT[s]).join(', ')
      manques.push(`Intention « ${nom} » retirée : donnée manquante (${causes || 'aucun gabarit'}).`)
    } else actives.push({ nom, poids: def.poids, gabarits: ok })
  }
  for (const [slot, e] of Object.entries(ecartes)) {
    manques.push(`Aucun ${NOM_SLOT[slot]} renseigné : ${e.n} gabarit(s) écarté(s) (${[...e.intentions].join(', ')}).`)
  }
  if (actives.length === 0) return { scenarios: [], empreinte: empreinte([]), niveau, graine, manques }

  const rng = mulberry32(graine)
  const formulations = Object.entries(profils).map(([nom, p]) => ({ nom, poids: p.poids, fragments: p.formulations[langue] }))
  const vus = new Set()
  const accepts = [] // { mots, plein }: word sets (without / with persona phrasing) of every accepted scenario
  const etats = actives.map((a) => ({ ...a, retenus: [], epuise: false }))
  let rejetsMarque = 0

  function tirer(etat, n) {
    const cible = etat.retenus.length + n
    let echecs = 0
    while (etat.retenus.length < cible && echecs < ECHECS_MAX) {
      const modele = choisir(rng, etat.gabarits)
      const profil = modele.clause ? choisirPondere(rng, formulations) : null
      const fragment = profil ? choisir(rng, profil.fragments) : ''
      // Persona phrasing alone never makes a scenario distinct: dedup works on the text without it.
      const valeurs = {}
      const coeur = modele.texte.replace(/\{(\w+)\}/g, (_, s) => (s === 'profil_formulation' ? '' : (valeurs[s] ??= choisir(rng, pools[s]))))
        .replace(/\s+/g, ' ').trim()
      const texte = eliderFr(modele.texte.replace(/\{(\w+)\}/g, (_, s) => (s === 'profil_formulation' ? fragment : valeurs[s]))
        .replace(/\s+/g, ' ').trim(), langue)
      const norme = normaliser(coeur)
      let rejet = vus.has(norme)
      if (!rejet && contientMarque(texte, termes)) { rejet = true; rejetsMarque++ }
      let mots, plein
      if (!rejet) {
        mots = new Set(norme.split(' '))
        plein = new Set(normaliser(texte).split(' '))
        for (const a of accepts) {
          if (tropProche(a.mots, mots) || tropProche(a.plein, plein)) { rejet = true; break }
        }
      }
      if (rejet) { echecs++; continue }
      echecs = 0
      vus.add(norme)
      accepts.push({ mots, plein })
      etat.retenus.push({ texte, profil: profil ? profil.nom : PROFIL_NEUTRE })
    }
    if (etat.retenus.length < cible) etat.epuise = true
  }

  // Round 1: quotas by weight; then redistribute any shortfall over intentions that still have room.
  const quotas = plusFortReste(etats.map((e) => e.poids), taille)
  etats.forEach((e, i) => tirer(e, quotas[i]))
  for (;;) {
    const manque = taille - etats.reduce((a, e) => a + e.retenus.length, 0)
    const libres = etats.filter((e) => !e.epuise)
    if (manque <= 0 || libres.length === 0) break
    const parts = plusFortReste(libres.map((e) => e.poids), manque)
    libres.forEach((e, i) => tirer(e, parts[i]))
  }

  const total = etats.reduce((a, e) => a + e.retenus.length, 0)
  const poidsTotal = etats.filter((e) => e.retenus.length).reduce((a, e) => a + e.poids, 0)
  const scenarios = []
  for (const e of etats) {
    for (const r of e.retenus) {
      scenarios.push({
        texte: r.texte, profil: r.profil, intention: e.nom,
        poids: Number((e.poids / poidsTotal / e.retenus.length).toFixed(8)), avec_marque: false,
      })
    }
  }
  if (rejetsMarque > 0) manques.push(`${rejetsMarque} tirage(s) écarté(s) car ils nommaient la marque ou un alias.`)
  if (total < taille) {
    const vides = etats.filter((e) => e.epuise).map((e) => e.nom).join(', ')
    manques.push(`Jeu réduit à ${total} scénario(s) sur ${taille} demandés : combinaisons distinctes épuisées (${vides}). Enrichir catégories, besoins, zones ou concurrents.`)
  }
  return { scenarios, empreinte: empreinte(scenarios), niveau, graine, manques }
}

// SHA-256 of the sorted normalised texts: the set's identity, independent of order.
function empreinte(scenarios) {
  const textes = scenarios.map((s) => normaliser(s.texte)).sort()
  return createHash('sha256').update(textes.join('\n')).digest('hex')
}

// Freezes a generated set in the local store (call before any measurement). Returns the set id.
export function figerJeu(base, origine, resultat, { langue, pays } = {}) {
  return base.enregistrerJeu({
    origine, empreinte: resultat.empreinte, version: VERSION_GENERATEUR, langue, pays,
    niveau: resultat.niveau, graine: resultat.graine, scenarios: resultat.scenarios,
  })
}
