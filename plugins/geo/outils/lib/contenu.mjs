// Deterministic FR/EN passage analysis: how easy is each passage of a page to extract and quote.
// Six boolean criteria per passage; they describe ease of extraction, never a probability of being cited.
// analyserContenu(faits) never throws and uses no randomness: same input, same output.
import { readFileSync } from 'node:fs'
import { CATALOGUE } from './controles.mjs'
import { extrait } from './sortie.mjs'

const CRITERES = ['definition', 'chiffre', 'source', 'autonome', 'question_titre', 'structure']
const SEUIL_LANGUE = 0.05
const PAR_ID = new Map(CATALOGUE.map((e, i) => [e.id, { ...e, rang: i }]))

// Language data is loaded once; patterns are compiled with the unicode flag, case-insensitive.
const LANGUES = {}
for (const l of ['fr', 'en']) {
  const d = JSON.parse(readFileSync(new URL(`../../donnees/langues/${l}.json`, import.meta.url), 'utf8'))
  LANGUES[l] = {
    mots_vides: new Set(d.mots_vides),
    definition: d.definition.map((s) => new RegExp(s, 'iu')),
    source: d.source.map((s) => new RegExp(s, 'iu')),
    pronoms_initiaux: new Set(d.pronoms_initiaux),
    question: d.question.map((s) => new RegExp(s, 'iu')),
    // A number (French decimal comma, thin / no-break space thousands) followed by a unit, % or currency.
    chiffre: new RegExp(`(?<![\\p{L}\\p{N}])\\d+(?:\\s\\d{3})*(?:[.,]\\d+)?\\s*(?:${d.unites.join('|')})(?![\\p{L}\\p{N}'’])`, 'iu'),
  }
}
// Distinctive words of other common languages: they only serve to refuse fr/en for pages in those languages.
const AUTRES = Object.fromEntries(Object.entries(JSON.parse(readFileSync(new URL('../../donnees/langues/_autres.json', import.meta.url), 'utf8'))).map(([l, m]) => [l, new Set(m)]))
// A currency symbol placed before the number ($45, £30, €12).
const MONNAIE_AVANT = /[€$£]\s?\d/u

const mots = (s) => String(s ?? '').toLowerCase().match(/\p{L}+/gu) ?? []

// detecterLangue(texte, langPage?) -> 'fr' | 'en' | 'autre'.
// A declared page language wins: fr*/en* gives fr/en, any other non-empty value gives 'autre'.
export function detecterLangue(texte, langPage = null) {
  const declaree = typeof langPage === 'string' ? langPage.trim().toLowerCase() : ''
  if (declaree) {
    if (/^fr(?![a-z])/.test(declaree)) return 'fr'
    if (/^en(?![a-z])/.test(declaree)) return 'en'
    return 'autre'
  }
  const jetons = mots(texte)
  if (!jetons.length) return 'autre'
  const ratio = (ensemble) => jetons.filter((j) => ensemble.has(j)).length / jetons.length
  const ratios = {}
  for (const l of ['fr', 'en']) ratios[l] = ratio(LANGUES[l].mots_vides)
  for (const [l, ensemble] of Object.entries(AUTRES)) ratios[l] = ratio(ensemble)
  // fr/en only when the ratio reaches the threshold AND beats every other language by 1.5x.
  for (const l of ['fr', 'en']) {
    const autres = Math.max(...Object.entries(ratios).filter(([k]) => k !== l).map(([, r]) => r))
    if (ratios[l] >= SEUIL_LANGUE && ratios[l] >= 1.5 * autres) return l
  }
  return 'autre'
}

const ABREVIATION = /(?:^|\s)(?:\p{Lu}|Mme|Mlle|Mr|Dr|Pr|St|vs|cf|env|etc)\.$/u

// Splits prose into sentences; no split after a single capital or a common abbreviation.
function phrases(texte) {
  const morceaux = String(texte).split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}«"“(])/u)
  const sortie = []
  for (const m of morceaux) {
    if (sortie.length && ABREVIATION.test(sortie[sortie.length - 1])) sortie[sortie.length - 1] += ' ' + m
    else sortie.push(m)
  }
  return sortie.map((s) => s.trim()).filter(Boolean)
}

function premierJeton(phrase, pronoms) {
  const m = /^\p{L}+/u.exec(phrase)
  if (!m) return false
  const mot = m[0].toLowerCase()
  const elision = /^['’]/.test(phrase.slice(m[0].length))
  return pronoms.has(mot) || (elision && pronoms.has(mot + "'"))
}

function hoteDe(url) {
  try { return new URL(url).host } catch { return null }
}

// Faits do not tie links to blocks: an external link counts when its text (>= 3 chars) occurs
// verbatim in one of the passage's block texts.
function lienExterne(liens, hotePage, pageUrl, textes) {
  if (!hotePage || !Array.isArray(liens)) return false
  for (const l of liens) {
    const t = typeof l?.texte === 'string' ? l.texte.trim() : ''
    if (t.length < 3) continue
    let u
    try { u = new URL(l.href, pageUrl) } catch { continue }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    if (u.host === hotePage) continue
    if (textes.some((x) => x.includes(t))) return true
  }
  return false
}

function evaluer(passage, langue, ctx) {
  const L = LANGUES[langue]
  const corps = passage.corps
  const textes = corps.map((b) => b.texte)
  const prose = corps.filter((b) => b.type === 'paragraphe' || b.type === 'definition').map((b) => b.texte)
  const phr = phrases(prose.join(' '))
  const toutTexte = textes.join('\n')

  const definition = corps.some((b) => b.type === 'definition') || phr.slice(0, 2).some((s) => L.definition.some((re) => re.test(s)))
  const chiffre = L.chiffre.test(toutTexte) || MONNAIE_AVANT.test(toutTexte)
  const source = L.source.some((re) => re.test(toutTexte)) || lienExterne(ctx.liens, ctx.hote, ctx.url, textes)
  const premier = phrases(textes[0] ?? '')[0] ?? ''
  const autonome = !premierJeton(premier, L.pronoms_initiaux)
  const question_titre = passage.titre !== null && L.question.some((re) => re.test(passage.titre))
  const structure = corps.some((b) => b.type === 'liste' || b.type === 'tableau')

  const criteres = { definition, chiffre, source, autonome, question_titre, structure }
  return { criteres, note: CRITERES.filter((c) => criteres[c]).length }
}

function constat(id, url, detail) {
  const def = PAR_ID.get(id)
  return { id, severite: def.severite, categorie: def.categorie, classe: def.classe, pages: [url], preuve: { type: 'html', url, detail }, detail, rang: def.rang }
}

// analyserContenu(page) -> { url, sans_texte, langue, prise_en_charge, passages, constats }.
// A passage is a heading and the blocks that follow it up to the next heading; blocks before the first
// heading form a passage with titre null. Passages without body (consecutive headings) are dropped, and so are
// blocks flagged nosnippet (they cannot be quoted). Unsupported language: no passage, no content finding.
export function analyserContenu(page) {
  const p = page && typeof page === 'object' ? page : {}
  const blocs = Array.isArray(p.blocs) ? p.blocs.filter((b) => b && typeof b.texte === 'string') : []
  const url = typeof p.url === 'string' ? p.url : ''
  const langue = detecterLangue(blocs.map((b) => b.texte).join('\n'), p.lang)
  // sans_texte: the page has no visible words at all (not a language problem); url lets callers map results to pages.
  const sans_texte = !/[\p{L}\p{N}]/u.test(blocs.map((b) => b.texte).join(' '))
  if (langue === 'autre') return { url, sans_texte, langue, prise_en_charge: false, passages: [], constats: [] }

  const bruts = []
  let courant = { titre: null, corps: [] }
  const clore = () => { if (courant.corps.length) bruts.push(courant) }
  for (const b of blocs) {
    if (b.type === 'titre') {
      clore()
      courant = { titre: b.nosnippet ? null : b.texte, corps: [] }
    } else if (!b.nosnippet) {
      courant.corps.push(b)
    }
  }
  clore()

  const ctx = { liens: p.liens, url, hote: hoteDe(url) }
  const passages = bruts.map((x, i) => {
    const { criteres, note } = evaluer(x, langue, ctx)
    return {
      id: `${url}#${i + 1}`,
      titre: x.titre === null ? null : extrait(x.titre).extrait,
      non_fiable: true,
      mots: x.corps.reduce((n, b) => n + (b.texte.match(/[\p{L}\p{N}]+/gu) ?? []).length, 0),
      criteres,
      note,
    }
  })

  const constats = []
  if (passages.length) {
    const n = passages.length
    if (!passages.some((x) => x.criteres.definition)) constats.push(constat('GEO-CONTENU-AUCUNE-DEFINITION', url, `Aucun des ${n} passage(s) ne s’ouvre sur une définition (motif « X est un… » dans les deux premières phrases).`))
    if (!passages.some((x) => x.criteres.source)) constats.push(constat('GEO-CONTENU-SANS-SOURCE', url, `Aucun des ${n} passage(s) ne cite de source (lien externe ou formule « selon… »).`))
    if (!(typeof p.auteur === 'string' && p.auteur.trim())) constats.push(constat('GEO-CONTENU-AUTEUR-ABSENT', url, 'Aucun auteur déclaré (meta author, rel="author" ou JSON-LD).'))
    const dependants = passages.filter((x) => !x.criteres.autonome).length
    if (dependants / n > 0.5) constats.push(constat('GEO-CONTENU-PASSAGES-DEPENDANTS', url, `${dependants} passage(s) sur ${n} commencent par un pronom ou un connecteur qui renvoie au texte précédent.`))
  }
  constats.sort((a, b) => a.rang - b.rang)
  return { url, sans_texte, langue, prise_en_charge: true, passages, constats }
}
