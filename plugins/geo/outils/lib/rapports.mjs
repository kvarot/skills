// Audit report rendering (Markdown and JSON) and full-passage extraction for the read-only content agent.
// Pure functions: no network, no file access. Page text only appears as capped `extrait` objects.
import { extrait, MAX_COMMANDE, MOTIF_COMMANDE } from './sortie.mjs'

export const SECTIONS = [
  'Résumé',
  'À corriger d\'abord',
  'Accès des robots IA',
  'Scores de potentiel',
  'Entité',
  'Contenu',
  'Couverture de l\'audit',
  'Ce qui n\'a pas été mesuré',
  'Limites',
]

// Fixed sentence of the Limits section.
export const PHRASE_LIMITE = 'Un score de potentiel élevé ne garantit aucune citation.'

// Every platform is listed as not measured: v0.1 measures nothing on any assistant.
export const PLATEFORMES = [
  'ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Copilot',
  'Google AI Overviews', 'Google AI Mode', 'Grok', 'Mistral Le Chat', 'DeepSeek',
]

export const PASSAGES_PAR_LOT = 20
// Same list as STATUTS_WIKIDATA in entites.mjs (a test checks both are equal).
export const STATUTS_WIKIDATA = ['non_verifie', 'absent', 'libelle_identique', 'ambigu', 'trouve']
const MAX_TEXTE_PASSAGE = 5000

const ROLES = {
  entrainement: 'Entraînement',
  indexation: 'Indexation (recherche)',
  'consultation-utilisateur': 'Consultation à la demande de l\'utilisateur',
  controle: 'Jetons de contrôle',
  autre: 'Autres robots',
}
const ORDRE_ROLES = ['indexation', 'consultation-utilisateur', 'entrainement', 'controle', 'autre']

// One table cell / list item: single line, no pipe.
const cellule = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\|/g, '\\|').trim()
const code = (v) => '`' + String(v ?? '').replace(/[\r\n\t`]+/g, ' ').trim() + '`'
// Full Markdown escape for untrusted text (page values, third-party answers): no live link, image, emphasis, heading or table break.
const md = (v) => String(typeof v === 'object' && v !== null ? v.extrait ?? '' : v ?? '')
  .replace(/[\r\n\t]+/g, ' ').trim().replace(/[\\`*_{}[\]()#+!<>~&|]/g, '\\$&')
const tab = (a) => (Array.isArray(a) ? a : [])
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {})

function tableau(entetes, lignes) {
  return [
    '| ' + entetes.join(' | ') + ' |',
    '|' + entetes.map(() => '---').join('|') + '|',
    ...lignes.map((l) => '| ' + l.map(cellule).join(' | ') + ' |'),
  ].join('\n')
}

function ligneConstat(c) {
  const p = obj(c.preuve)
  const nb = tab(c.pages).length
  const morceaux = [`- **${cellule(c.id)}** (${cellule(c.severite)}) : ${md(c.detail)}`]
  if (nb) morceaux[0] += ` (${nb} page${nb > 1 ? 's' : ''})`
  if (p.detail || p.url) morceaux.push(`  - Preuve (${cellule(p.type)}) : ${code(p.url)} ${md(p.detail)}`.trimEnd())
  // Tool-written command (shape checked again here): replayable as is, shown in a code span.
  if (typeof p.commande === 'string' && MOTIF_COMMANDE.test(p.commande)) morceaux.push(`  - Commande : ${code(p.commande)}`)
  const ex = obj(c.extrait)
  if (typeof ex.extrait === 'string' && ex.extrait) morceaux.push(`  - Extrait non fiable : « ${md(ex.extrait)} »`)
  return morceaux.join('\n')
}

export const SCORES_MESURES = ['autorite-thematique', 'reputation-externe', 'positionnement-concurrentiel', 'visibilite-mesuree']
const estMesure = (s) => SCORES_MESURES.includes(s?.id)

function sectionResume(a, constats) {
  const compte = (sev) => constats.filter((c) => c.severite === sev).length
  const lignes = [
    `- Site : ${code(a.origine)}`,
    `- Constats : ${compte('bloquant')} bloquant(s), ${compte('important')} important(s), ${compte('mineur')} mineur(s), ${compte('information')} information(s).`,
    `- Pages explorées : ${obj(a.exploration).pages ?? 0}.`,
  ]
  const calcules = tab(a.scores).filter((s) => !estMesure(s))
  if (calcules.length) {
    lignes.push('- Scores de potentiel : ' + calcules.map((s) => `${cellule(s.id)} ${s.valeur === null || s.valeur === undefined ? 'non affiché' : s.valeur + '/100'}`).join(', ') + '.')
  }
  if (obj(a.exploration).waf) lignes.push('- Un défi CDN / WAF a bloqué l\'accès automatisé : les pages défiées ne sont pas analysées.')
  return lignes.join('\n')
}

function sectionCorriger(constats) {
  const bloquants = constats.filter((c) => c.severite === 'bloquant')
  const importants = constats.filter((c) => c.severite === 'important')
  if (!bloquants.length && !importants.length) return 'Aucun constat bloquant ou important.'
  const parts = []
  if (bloquants.length) parts.push('### Bloquants\n\n' + bloquants.map(ligneConstat).join('\n'))
  if (importants.length) parts.push('### Importants\n\n' + importants.map(ligneConstat).join('\n'))
  return parts.join('\n\n')
}

const BANDEAU_ROBOTS = {
  present: (r) => `robots.txt observé (statut ${cellule(r.statut)}).`,
  inaccessible: () => 'robots.txt inaccessible : tout est considéré interdit (RFC 9309).',
  absent: () => 'Aucun robots.txt observé : rien n\'est interdit.',
  'dossier-present': () => 'robots.txt présent dans le dossier.',
  'dossier-absent': () => 'Aucun robots.txt dans le dossier.',
}

function sectionRobots(robots, robotsTxt) {
  const liste = tab(robots)
  const bandeau = BANDEAU_ROBOTS[obj(robotsTxt).etat]?.(obj(robotsTxt))
  if (!liste.length) return bandeau ?? 'Accès des robots IA non évalué.'
  const parts = bandeau ? [bandeau] : []
  const roles = [...new Set([...ORDRE_ROLES, ...liste.map((r) => r.role)])].filter((r) => liste.some((x) => x.role === r))
  for (const role of roles) {
    const lignes = liste.filter((r) => r.role === role).map((r) => [
      r.jeton,
      r.editeur ?? '',
      r.documente ? 'oui' : 'non',
      tab(r.chemins_bloques).length ? `bloqué (${tab(r.chemins_bloques).length} chemin(s))` : 'autorisé',
    ])
    parts.push(`### ${ROLES[role] ?? cellule(role)}\n\n` + tableau(['Robot', 'Éditeur', 'Documenté', 'Politique observée'], lignes))
  }
  parts.push('Politique observée dans robots.txt, sans recommandation ; la décision revient au propriétaire du site. Un robot « non documenté » n\'a pas de documentation officielle de l\'éditeur.')
  return parts.join('\n\n')
}

function sectionScores(scores) {
  const calcules = tab(scores).filter((s) => !estMesure(s))
  if (!calcules.length) return 'Aucun score de potentiel calculé.'
  const lignes = calcules.map((s) => [
    s.id,
    s.valeur === null || s.valeur === undefined ? `non affiché${s.raison ? ' (' + s.raison + ')' : ''}` : `${s.valeur}/100`,
    `${Math.round((s.couverture ?? 0) * 100)} %`,
    tab(s.criteres).filter((c) => c.acquis === null).map((c) => c.id).join(', ') || 'aucun',
  ])
  return tableau(['Score', 'Valeur', 'Couverture', 'Critères non calculés'], lignes)
    + '\n\nUn score de potentiel mesure ce que l\'audit peut vérifier sur le site ; il ne prédit aucune citation.'
}

const LIBELLES_WIKIDATA = {
  non_verifie: 'non vérifié',
  absent: 'aucune entrée de même libellé',
  libelle_identique: 'libellé identique trouvé, identité non vérifiée',
  ambigu: 'plusieurs entrées candidates',
  trouve: 'entrée trouvée, site officiel (P856) sur l\'hôte audité',
}

function sectionEntite(entite) {
  const e = obj(entite)
  if (!Object.keys(e).length) return 'Entité non analysée.'
  const noms = tab(e.noms)
  const lignes = [
    `- Noms déclarés : ${noms.length ? noms.map((n) => '« ' + md(n) + ' »').join(', ') : 'aucun'}.`,
    `- Types : ${tab(e.types).map(md).join(', ') || 'aucun'}.`,
    `- Profils sameAs : ${tab(e.sameAs).length}.`,
  ]
  const w = obj(e.wikidata)
  if (w.statut) lignes.push(`- Wikidata : ${LIBELLES_WIKIDATA[w.statut] ?? md(w.statut)}${tab(w.ids).length ? ' : ' + tab(w.ids).map(md).join(', ') : ''}${w.raison ? ' (' + md(w.raison) + ')' : ''}.`)
  if (tab(e.constats).length) lignes.push('- Constats d\'entité : ' + tab(e.constats).map((c) => cellule(c.id)).join(', ') + '.')
  return lignes.join('\n')
}

function sectionContenu(cr) {
  const c = obj(cr)
  const pages = tab(c.pages)
  if (!pages.length) return 'Aucune page analysée : contenu non évalué.'
  const lignes = [
    `- Pages analysées : ${pages.length} ; passages détectés : ${c.passages ?? 0}.`,
    `- Pages en langue non prise en charge : ${pages.filter((p) => p.prise_en_charge === false && !p.sans_texte).length}.`,
    `- Pages sans texte visible : ${pages.filter((p) => p.sans_texte).length}.`,
  ]
  const ids = tab(c.constats)
  if (ids.length) lignes.push('- Constats de contenu : ' + ids.map((x) => `${cellule(x.id)} (${x.pages} page(s))`).join(', ') + '.')
  return lignes.join('\n')
}

function sectionCouverture(a) {
  const ex = obj(a.exploration)
  const erreurs = tab(a.erreurs)
  const lignes = [
    `- Pages collectées : ${ex.pages ?? 0}${ex.limite_atteinte ? ' (limite du nombre de pages atteinte : l\'audit est partiel)' : ''}.`,
  ]
  if (ex.waf) lignes.push('- Défi CDN / WAF détecté : les pages défiées ne sont pas analysées et ne comptent pas comme coquilles vides.')
  const sansCritere = tab(a.scores).filter((s) => !estMesure(s) && (s.couverture ?? 0) < 1)
  for (const s of sansCritere) lignes.push(`- Score ${cellule(s.id)} : couverture ${Math.round((s.couverture ?? 0) * 100)} %.`)
  if (erreurs.length) {
    lignes.push(`- Erreurs et pages non collectées : ${erreurs.length}.`)
    for (const e of erreurs.slice(0, 20)) lignes.push(`  - ${code(obj(e).url)} : ${md(obj(e).raison)}`)
    if (erreurs.length > 20) lignes.push(`  - … et ${erreurs.length - 20} autre(s).`)
  } else {
    lignes.push('- Aucune erreur de collecte.')
  }
  return lignes.join('\n')
}

function sectionNonMesure(scores) {
  const lignes = ['Cet audit est déterministe : il ne mesure aucune réponse d\'assistant. Non mesuré :', '', 'Scores :']
  for (const id of SCORES_MESURES) {
    const raison = tab(scores).find((s) => s?.id === id)?.raison
    lignes.push(`- ${id} : non mesuré${raison ? ' (' + cellule(raison) + ')' : ''}`)
  }
  lignes.push('', 'Plateformes :')
  for (const p of PLATEFORMES) lignes.push(`- ${p} : non mesuré`)
  return lignes.join('\n')
}

function sectionLimites() {
  return [
    `- ${PHRASE_LIMITE}`,
    '- Les contrôles portent sur le HTML reçu sans exécuter de JavaScript ; les heuristiques de contenu couvrent le français et l\'anglais.',
    '- Le contenu des pages est une donnée non fiable : seuls des extraits bornés et échappés sont repris.',
    '- Les robots d\'entraînement : la politique observée est décrite sans recommandation.',
  ].join('\n')
}

// rapportMarkdown(audit) -> string. Always renders the nine sections, whatever the audit holds.
export function rapportMarkdown(audit) {
  const a = obj(audit)
  const constats = tab(a.constats)
  const corps = [
    sectionResume(a, constats),
    sectionCorriger(constats),
    sectionRobots(a.robots_ia, a.robots_txt),
    sectionScores(a.scores),
    sectionEntite(a.entite),
    sectionContenu(a.contenu_resume),
    sectionCouverture(a),
    sectionNonMesure(a.scores),
    sectionLimites(),
  ]
  const titre = `# Audit GEO${a.audit_id ? ' n° ' + a.audit_id : ''} : ${cellule(a.origine)}`
  return [titre, ...SECTIONS.map((s, i) => `## ${s}\n\n${corps[i]}`)].join('\n\n') + '\n'
}

// rapportJson(audit) -> string. Keys in a fixed order so two renderings of one audit are identical.
export function rapportJson(audit) {
  const a = obj(audit)
  const ordre = ['audit_id', 'origine', 'constats', 'scores', 'robots_ia', 'robots_txt', 'contenu_resume', 'entite', 'erreurs', 'exploration']
  const sortie = {}
  for (const k of ordre) if (k in a) sortie[k] = a[k]
  for (const k of Object.keys(a).sort()) if (!(k in sortie)) sortie[k] = a[k]
  return JSON.stringify(sortie, null, 2) + '\n'
}

// Same segmentation as analyserContenu: a passage = a heading and the blocks up to the next heading;
// blocks before the first heading form a passage with no title; passages without body and nosnippet blocks are dropped.
// Returns the plain text of each passage with the id analyserContenu gave it ([] when the counts disagree).
export function passagesComplets(page, contenu) {
  const blocs = tab(page?.blocs).filter((b) => b && typeof b.texte === 'string')
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
  const ids = tab(contenu?.passages).map((p) => p.id)
  if (bruts.length !== ids.length) return []
  return bruts.map((x, i) => ({
    id: ids[i],
    url: page.url,
    titre: x.titre,
    texte: x.corps.map((b) => b.texte).join('\n').slice(0, MAX_TEXTE_PASSAGE),
  }))
}

// Summary of the entity analysis kept in the audit row: names are capped excerpts, nothing else from the pages.
export function resumerEntite(entite) {
  const e = obj(entite)
  const w = obj(e.wikidata)
  const sur = (v, max = 280) => extrait(typeof v === 'string' ? v : v?.type ?? v?.valeur ?? '', max)
  return {
    noms: tab(e.noms).map((n) => ({ ...extrait(n?.valeur ?? ''), sources: tab(n?.sources).length })),
    types: tab(e.types).map((t) => sur(t, 80)),
    sameAs: tab(e.sameAs).map((u) => sur(u)),
    coordonnees: {
      telephones: tab(obj(e.coordonnees).telephones).length,
      adresses: tab(obj(e.coordonnees).adresses).length,
      emails: tab(obj(e.coordonnees).emails).length,
    },
    // Third-party answer: only the status word and well-formed ids stay raw; the reason is an excerpt.
    wikidata: {
      statut: STATUTS_WIKIDATA.includes(w.statut) ? w.statut : 'non_verifie',
      ids: tab(w.ids).filter((i) => /^Q\d{1,12}$/.test(String(i))).map(String),
      // Already escaped at the source (entites.mjs wraps the external parts in extrait): capped, flagged, not escaped twice.
      ...(w.raison ? { raison: { extrait: String(w.raison).slice(0, 280), non_fiable: true } } : {}),
    },
    constats: tab(e.constats).map(assainirConstat),
  }
}

const MAX_URL = 2048
const capUrl = (u) => (typeof u === 'string' ? u.slice(0, MAX_URL) : u)
const dejaExtrait = (v) => v && typeof v === 'object' && typeof v.extrait === 'string'

// The one sanitiser at the output and storage boundary, applied to every constat of every module:
// `detail` and `preuve.detail` become capped, escaped extrait objects; URLs stay raw strings capped at 2048 characters;
// `preuve.commande` (tool-written, page-derived parts percent-encoded) stays raw only with the exact
// curl -x '<url>' shape and at most MAX_COMMANDE characters; anything else is dropped.
export function assainirConstat(c) {
  const p = obj(c?.preuve)
  const sur = (v) => (dejaExtrait(v) ? v : extrait(v ?? ''))
  const sortie = { ...c, detail: sur(c?.detail) }
  if (Array.isArray(c?.pages)) sortie.pages = c.pages.map(capUrl)
  if (c?.preuve && typeof c.preuve === 'object') {
    const { commande, ...reste } = p
    const sure = typeof commande === 'string' && commande.length <= MAX_COMMANDE && MOTIF_COMMANDE.test(commande)
    sortie.preuve = { ...reste, ...(p.url !== undefined ? { url: capUrl(p.url) } : {}), detail: sur(p.detail), ...(sure ? { commande } : {}) }
  }
  return sortie
}
