// Deterministic consolidation of a campaign passage (no AI): one folder per persona run,
// each with resultat.md, journal.jsonl, analyse.json (and validation.json if a validator ran).
//   node consolider.mjs <passage folder> [--total-personas N]
// Writes in <passage folder>:
//   anomalies.json   one record per anomaly, stable id, deduplicated across personas, with
//                    persona(s), steps to reproduce (from the real tool calls), expected/observed,
//                    evidence, frequency, severity, confidence, status (observé / hypothèse)
//   synthese.json    per-persona measures + the 8 behavioural checks side by side,
//                    common vs persona-specific obstacles
//   rapport-auto.md  a readable skeleton for the human/arbiter report
//   exports/github/*.md and exports/notion.md   drafts only: nothing is sent anywhere
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const dir = path.resolve(process.argv[2])
const norm = (s) => String(s || '').toLowerCase().replace(/[’‘`´]/g, "'").replace(/[«»“”"]/g, ' ')
  .replace(/ | /g, ' ').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
const GRAV = { bloquant: 3, 'gênant': 2, genant: 2, mineur: 1 }
const GRAV_NOM = { 3: 'bloquant', 2: 'gênant', 1: 'mineur', 0: 'non qualifiée' }
const json = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null)
function bloc(txt) {
  const b = [...String(txt).matchAll(/```json\s*([\s\S]*?)```/g)]
  if (!b.length) return null
  try { return JSON.parse(b[b.length - 1][1]) } catch { return null }
}

// Replays the journal to give, for a quotation, the actions that led to the screen showing it.
function etapesVers(journal, citation) {
  const cible = norm(citation).slice(0, 60)
  const labels = new Map()
  const actions = []
  let dernier = null
  for (const line of journal.split('\n')) {
    let j
    try { j = JSON.parse(line) } catch { continue }
    if (j.type === 'assistant') for (const b of j.message?.content || []) {
      if (b.type !== 'tool_use') continue
      const t = b.name.split('__').pop()
      if (['take_snapshot', 'take_screenshot', 'list_pages', 'wait_for'].includes(t)) continue
      const i = b.input || {}
      let quoi = t
      // Label resolved at the end: it may only appear in the snapshot that follows.
      if (i.uid) quoi += ` « \u0000${i.uid}\u0000 »`
      if (i.url) quoi += ' ' + String(i.url).replace(/\?token=[^#&]*/, '').replace(/^https?:\/\/[^/]+/, '')
      if (i.type === 'back') quoi += ' (retour)'
      if (i.value) quoi += ` = « ${String(i.value).slice(0, 40)} »`
      if (i.key) quoi += ' ' + i.key
      actions.push(quoi)
    }
    if (j.type === 'user' && Array.isArray(j.message?.content)) for (const r of j.message.content) {
      if (r.type !== 'tool_result') continue
      const txt = Array.isArray(r.content) ? r.content.map((x) => (x && x.text) || '').join('\n') : String(r.content || '')
      for (const m of txt.matchAll(/uid=(\S+) \w+ "([^"\n]{1,60})"/g)) labels.set(m[1], m[2])
      // Keep the LAST screen showing the quotation: closer to when the persona noticed it.
      if (cible.length >= 6 && norm(txt).includes(cible)) dernier = actions.length
    }
  }
  if (dernier === null) return null
  // Whole path from the start (a replay must reach the same state), repeats folded.
  const etapes = []
  for (const x of actions.slice(0, dernier).map((s) => s.replace(/\u0000(\S+?)\u0000/g, (_, u) => labels.get(u) || u))) {
    const last = etapes[etapes.length - 1]
    if (last && last.texte === x) last.n++
    else etapes.push({ texte: x, n: 1 })
  }
  return etapes.slice(-30).map((e) => (e.n > 1 ? `${e.texte} ×${e.n}` : e.texte))
}

const runs = readdirSync(dir).filter((d) => statSync(path.join(dir, d)).isDirectory() && existsSync(path.join(dir, d, 'resultat.md')))
const total = Number(process.argv[process.argv.indexOf('--total-personas') + 1]) || runs.length
const brutes = []
const personas = []
for (const r of runs) {
  const d = path.join(dir, r)
  const res = bloc(readFileSync(path.join(d, 'resultat.md'), 'utf8')) || {}
  const an = json(path.join(d, 'analyse.json')) || {}
  const val = json(path.join(d, 'validation.json'))
  const journal = existsSync(path.join(d, 'journal.jsonl')) ? readFileSync(path.join(d, 'journal.jsonl'), 'utf8') : ''
  const nonRetrouvees = new Set(((an.citations || {}).liste_non_retrouvees || []).map((x) => norm(x.texte)))
  const pid = an.persona || r
  personas.push({ id: pid, dossier: r, res, an, val })
  const ajouter = (src, quoi, preuve, grav, dimension, ecran) => {
    const p = String(preuve || '')
    const verifiee = p.trim() !== '' && !nonRetrouvees.has(norm(p))
    brutes.push({ persona: pid, source: src, quoi: String(quoi || ''), preuve: p, verifiee, gravite: GRAV[norm(grav)] || 0,
      dimension: dimension || (src === 'incoherence' ? 'coherence' : null), ecran: ecran || null, etapes: p ? etapesVers(journal, p.split(/…|\.\.\.|[«»]/)[0]) : null })
  }
  for (const f of res.frictions || []) ajouter('friction', f.quoi, f.preuve_verbatim, f.gravite, f.dimension, f.ecran)
  for (const x of res.incoherences_vues || []) {
    if (typeof x === 'string') { const q = (x.match(/«\s*([^»]{6,}?)\s*»/) || [])[1] || ''; ajouter('incoherence', x, q, 'gênant', 'coherence', null) }
    else ajouter('incoherence', x.quoi, x.preuve_verbatim, 'gênant', 'coherence', null)
  }
  for (const v of (val && val.verdicts) || []) if (v.verdict === 'faux') {
    brutes.push({ persona: pid, source: 'validateur', quoi: `${v.affirmation} : ${v.detail}`, preuve: '', verifiee: true, gravite: 3, dimension: 'fonctionnel', ecran: null, etapes: null, verite: true })
  }
}

// Deduplication: same verified quotation (or one containing the other) => same anomaly;
// otherwise same normalised "what" text. The id hashes the anchor, so it is stable across runs.
const groupes = []
for (const b of brutes) {
  const ancre = b.preuve && b.verifiee ? norm(b.preuve) : 'quoi:' + norm(b.quoi).split(' ').slice(0, 10).join(' ')
  const g = groupes.find((x) => x.ancre === ancre ||
    (b.preuve && b.verifiee && x.ancre.length >= 20 && ancre.length >= 20 && !x.ancre.startsWith('quoi:') && (x.ancre.includes(ancre) || ancre.includes(x.ancre))))
  if (g) g.items.push(b)
  else groupes.push({ ancre, items: [b] })
}
const anomalies = groupes.map((g) => {
  const ps = [...new Set(g.items.map((x) => x.persona))]
  const grav = Math.max(...g.items.map((x) => x.gravite))
  const verifiees = g.items.filter((x) => x.verifiee && x.preuve).length
  const parValidateur = g.items.some((x) => x.verite)
  const confiance = parValidateur || (verifiees && ps.length >= 2) ? 'haute' : verifiees ? 'moyenne' : 'basse'
  const premier = g.items.find((x) => x.etapes) || g.items[0]
  return {
    id: 'VP-' + createHash('sha1').update(g.ancre).digest('hex').slice(0, 8),
    titre: g.items[0].quoi.slice(0, 140),
    statut: confiance === 'basse' ? 'hypothèse' : 'observé',
    sources: [...new Set(g.items.map((x) => x.source))],
    personas: ps,
    frequence: `${ps.length}/${total}`,
    gravite: GRAV_NOM[grav],
    confiance,
    dimension: g.items.map((x) => x.dimension).find(Boolean) || null,
    ecran: g.items.map((x) => x.ecran).find(Boolean) || null,
    scenario: path.basename(dir),
    preconditions: 'instance jetable neuve, données fictives',
    etapes_reproduction: premier.etapes || ['(étapes non retrouvées dans le journal)'],
    resultat_observe: g.items[0].quoi,
    resultat_attendu: '(à compléter par l’arbitre ou l’expert)',
    preuves: [...new Set(g.items.filter((x) => x.preuve).map((x) => x.preuve))].slice(0, 4),
    preuves_verifiees: verifiees,
    impact_utilisateur: g.items.map((x) => `${x.persona} : ${x.quoi}`).slice(0, 4),
    recommandation: '(à compléter par l’arbitre ou l’expert)',
    contre_expertise_requise: grav >= 3 || confiance === 'basse',
  }
}).sort((a, b) => (GRAV[b.gravite] || 0) - (GRAV[a.gravite] || 0) || b.personas.length - a.personas.length)

const CHECKS = ['comprend_a_quoi_sert', 'sait_par_ou_commencer', 'trouve_sans_aide', 'comprend_les_termes', 'interprete_boutons_et_messages', 'recupere_apres_erreur', 'comprend_les_consequences', 'accomplit_objectif']
const synthese = {
  passage: path.basename(dir),
  avertissement: 'Personas simulés : estimations, pas une étude auprès de vrais utilisateurs.',
  personas: personas.map((p) => ({
    id: p.id,
    objectif_atteint_declare: p.res.objectif_atteint || null,
    abandon: p.res.abandon || null,
    verite_validateur: p.val ? p.val.verdicts.map((v) => v.verdict) : null,
    mesures: p.an.mesure || null,
    temps_humain: { estimation_klm_s: (p.an.estimation_modele || {}).temps_humain_klm_secondes ?? null, estimation_persona_min: ((p.res.estimations_simulees || {}).temps_humain_minutes) ?? null },
    citations: p.an.citations ? { verifiees: p.an.citations.verifiees, total: p.an.citations.total } : null,
    pas: p.an.pas_declares || null,
    demandes_aide: p.an.demandes_aide || [],
    verifications: Object.fromEntries(CHECKS.map((k) => [k, ((p.res.verifications || {})[k] || {}).reponse || 'absent'])),
  })),
  taux_reussite_declare: personas.length ? personas.filter((p) => p.res.objectif_atteint === 'oui').length / personas.length : null,
  obstacles_communs: anomalies.filter((a) => a.personas.length >= 2).map((a) => ({ id: a.id, titre: a.titre, personas: a.personas })),
  obstacles_specifiques: anomalies.filter((a) => a.personas.length === 1).map((a) => ({ id: a.id, titre: a.titre, persona: a.personas[0] })),
}
writeFileSync(path.join(dir, 'anomalies.json'), JSON.stringify(anomalies, null, 1))
writeFileSync(path.join(dir, 'synthese.json'), JSON.stringify(synthese, null, 1))

// Readable skeleton + export drafts (never sent).
const L = []
L.push(`# Synthèse automatique — ${synthese.passage}`, '', `> ${synthese.avertissement}`, '')
L.push('| Persona | Objectif (déclaré) | Interactions | Retours/revisites | Aide | Citations vérifiées | Durée technique | Temps humain (modèle KLM) |', '|---|---|---|---|---|---|---|---|')
for (const p of synthese.personas) {
  const m = p.mesures || {}
  L.push(`| ${p.id} | ${p.objectif_atteint_declare || '?'} | ${m.interactions ?? '?'} | ${(m.retours_arriere ?? 0)}/${m.revisites ?? 0} | ${(m.pages_aide_visitees ?? 0) + p.demandes_aide.length} | ${p.citations ? p.citations.verifiees + '/' + p.citations.total : '?'} | ${m.duree_technique_secondes ?? '?'} s | ${p.temps_humain.estimation_klm_s ?? '?'} s (estimé) |`)
}
L.push('', '## Vérifications comportementales (déclarées par les personas)', '', '| Vérification | ' + synthese.personas.map((p) => p.id).join(' | ') + ' |', '|---|' + synthese.personas.map(() => '---').join('|') + '|')
for (const k of CHECKS) L.push(`| ${k} | ` + synthese.personas.map((p) => p.verifications[k]).join(' | ') + ' |')
L.push('', '## Anomalies', '', '| Id | Gravité | Fréquence | Confiance | Statut | Titre |', '|---|---|---|---|---|---|')
for (const a of anomalies) L.push(`| ${a.id} | ${a.gravite} | ${a.frequence} | ${a.confiance} | ${a.statut} | ${a.titre.replace(/\|/g, '/')} |`)
writeFileSync(path.join(dir, 'rapport-auto.md'), L.join('\n') + '\n')
mkdirSync(path.join(dir, 'exports', 'github'), { recursive: true })
for (const a of anomalies.filter((x) => x.statut === 'observé')) {
  writeFileSync(path.join(dir, 'exports', 'github', a.id + '.md'), [
    `<!-- brouillon local, non publié : ${a.id} -->`, `# [${a.gravite}] ${a.titre}`, '',
    `**Personas** : ${a.personas.join(', ')} (${a.frequence}) · **Confiance** : ${a.confiance} · simulation, pas un test humain`, '',
    '## Étapes', ...a.etapes_reproduction.map((e, i) => `${i + 1}. ${e}`), '',
    '## Observé', a.resultat_observe, '', '## Preuves', ...a.preuves.map((p) => `> ${p}`), '',
    '## Attendu', a.resultat_attendu, '', '## Recommandation', a.recommandation, ''].join('\n'))
}
writeFileSync(path.join(dir, 'exports', 'notion.md'), ['| Id | Titre | Gravité | Fréquence | Confiance | Statut | Personas |', '|---|---|---|---|---|---|---|',
  ...anomalies.map((a) => `| ${a.id} | ${a.titre.replace(/\|/g, '/')} | ${a.gravite} | ${a.frequence} | ${a.confiance} | ${a.statut} | ${a.personas.join(', ')} |`)].join('\n') + '\n')
console.log(JSON.stringify({ anomalies: anomalies.length, observees: anomalies.filter((a) => a.statut === 'observé').length, communes: synthese.obstacles_communs.length, specifiques: synthese.obstacles_specifiques.length }))
