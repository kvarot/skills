// Deterministic analysis of one persona run (no AI). Reads journal.jsonl + resultat.md
// (+ mesures.json), writes analyse.json:
//  - behaviour measured from the tool calls actually made (clicks, typing, keys, navigations,
//    back-tracks and revisits, alerts seen, help pages visited, refusals, patience limit);
//  - every quotation the persona gives as evidence checked against the text the browser
//    really returned (verified / not found) -> hallucination guard;
//  - step lines "PAS n | ..." extracted (hesitations, words not understood, AIDE: lines);
//  - measured technical duration vs a KLM-style human-time ESTIMATE (labelled as a model).
//   node analyser-journal.mjs <run folder> [--aide "aide|help|lexique|faq|guide|docs"] [--chemin-reference 8]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const norm = (s) => String(s || '').toLowerCase()
  .replace(/[’‘`´]/g, "'").replace(/[«»“”"]/g, ' ').replace(/ | /g, ' ')
  .replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()

function blocJson(txt) {
  const b = [...String(txt).matchAll(/```json\s*([\s\S]*?)```/g)]
  if (!b.length) return null
  try { return JSON.parse(b[b.length - 1][1]) } catch { return null }
}

// Every evidence string of the final JSON: fields named like a proof, and «quoted» text anywhere.
function citations(obj) {
  const out = []
  const walk = (v, k) => {
    if (typeof v === 'string') {
      if (/^(preuve|preuve_verbatim|confirmation_vue)$/.test(k) && v.trim()) out.push({ champ: k, texte: v })
      for (const m of v.matchAll(/«\s*([^»]{4,}?)\s*»/g)) out.push({ champ: k + ':citation', texte: m[1] })
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, k))
    else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) walk(vv, kk)
  }
  walk(obj, '')
  // de-duplicate
  const seen = new Set()
  return out.filter((c) => { const n = norm(c.texte); if (seen.has(n)) return false; seen.add(n); return true })
}

function verifier(texte, corpus) {
  // A quotation may glue several passages (… ; « »): each passage must be found.
  const frags = String(texte).split(/…|\.\.\.|\s\/\s|\s;\s|[«»“”"]/).map(norm).filter((f) => f.length >= 6)
  if (!frags.length) return 'trop_court'
  return frags.every((f) => corpus.includes(f)) ? 'verifiee' : 'non_retrouvee'
}

export function analyser(dir, opts = {}) {
  const aide = new RegExp(opts.aide || 'aide|help|lexique|glossaire|faq|guide|docs|support', 'i')
  const lines = readFileSync(path.join(dir, 'journal.jsonl'), 'utf8').split('\n')
  const resultat = existsSync(path.join(dir, 'resultat.md')) ? readFileSync(path.join(dir, 'resultat.md'), 'utf8') : ''
  const mesures = existsSync(path.join(dir, 'mesures.json')) ? JSON.parse(readFileSync(path.join(dir, 'mesures.json'), 'utf8')) : {}
  const c = { clics: 0, saisies: 0, caracteres_saisis: 0, touches: 0, navigations: 0, retours_arriere: 0, revisites: 0, survols: 0,
    instantanes: 0, captures: 0, refus_garde: 0, erreurs_outil: 0, limite_patience_atteinte: false, pages_distinctes: 0, pages_aide_visitees: 0 }
  const corpus = []
  const textes = []
  const urls = []
  const alertes = new Set()
  const pending = new Map()
  for (const line of lines) {
    let j
    try { j = JSON.parse(line) } catch { continue }
    if (j.type === 'assistant') for (const b of j.message?.content || []) {
      if (b.type === 'text') textes.push(b.text)
      if (b.type !== 'tool_use') continue
      const t = b.name.split('__').pop()
      const i = b.input || {}
      pending.set(b.id, t)
      if (t === 'click') c.clics++
      if (t === 'hover') c.survols++
      if (t === 'fill' || t === 'fill_form' || t === 'type_text') { c.saisies++; c.caracteres_saisis += String(i.value || i.text || JSON.stringify(i.elements || '')).length }
      if (t === 'press_key') c.touches++
      if (t === 'take_snapshot') c.instantanes++
      if (t === 'take_screenshot') c.captures++
      if (t === 'navigate_page') { if (i.type === 'back') c.retours_arriere++; else c.navigations++ }
    }
    if (j.type === 'user' && Array.isArray(j.message?.content)) for (const r of j.message.content) {
      if (r.type !== 'tool_result') continue
      const txt = Array.isArray(r.content) ? r.content.map((x) => (x && x.text) || '').join('\n') : String(r.content || '')
      if (txt.includes('REFUSÉ par garde-url')) { c.refus_garde++; if (txt.includes('LIMITE DE PATIENCE')) c.limite_patience_atteinte = true; continue }
      if (r.is_error) c.erreurs_outil++
      corpus.push(txt)
      for (const m of txt.matchAll(/(?:RootWebArea[^\n]*?url="|\n\d+: [^\n(]*\()(https?:\/\/[^"\s)]+)/g)) urls.push(m[1].replace(/\?token=[^#&]*/, ''))
      for (const m of txt.matchAll(/\balert\b[^\n]*\n\s*uid=\S+ "([^"\n]{4,200})"/g)) alertes.add(m[1])
      for (const m of txt.matchAll(/\balert\b[^\n]*?"([^"\n]{4,200})"/g)) alertes.add(m[1])
    }
  }
  // Page sequence: consecutive duplicates collapsed; a return to an earlier page is a revisit.
  const seq = urls.filter((u, k) => k === 0 || u !== urls[k - 1])
  const vus = new Set()
  for (const u of seq) { if (vus.has(u)) c.revisites++; vus.add(u) }
  c.pages_distinctes = vus.size
  c.pages_aide_visitees = [...vus].filter((u) => aide.test(u)).length
  c.alertes_vues = [...alertes].slice(0, 20)

  const corpusN = norm(corpus.join('\n'))
  const json = blocJson(resultat)
  const cits = json ? citations(json).map((x) => ({ ...x, statut: verifier(x.texte, corpusN) })) : []
  const ver = cits.filter((x) => x.statut === 'verifiee').length
  const nonr = cits.filter((x) => x.statut === 'non_retrouvee')

  const tout = textes.join('\n')
  const pas = [...tout.matchAll(/PAS\s*(\d+)\s*\|([^\n]*)/g)].map((m) => {
    const champs = Object.fromEntries(m[2].split('|').map((s) => s.split(':')).filter((p) => p.length > 1).map(([k, ...v]) => [k.trim(), v.join(':').trim()]))
    return { n: Number(m[1]), ...champs }
  })
  const hes = pas.filter((p) => p.hesitation && !/^aucune/i.test(p.hesitation))
  const incompris = pas.filter((p) => /^(non|partiel)/i.test(p.comprends || ''))
  const aidesTexte = [...(tout + '\n' + resultat).matchAll(/^\s*AIDE:\s*([^\n]+)/gm)].map((m) => m[1].trim().replace(/["\],]+$/, ''))
  const aidesJson = (json && Array.isArray(json.demandes_aide) ? json.demandes_aide : []).filter(Boolean)

  const interactions = c.clics + c.saisies + c.touches + c.navigations + c.retours_arriere + c.survols
  // The reference path is a pointer path: not comparable for a keyboard-only persona.
  const clavierSeul = Array.isArray(mesures.reglages_imposes?.outils) && !mesures.reglages_imposes.outils.includes('click')
  const ref = opts.cheminReference && !clavierSeul ? Number(opts.cheminReference) : null
  // KLM-style estimate (Card, Moran & Newell operators): M=1.35 s per decision, P+B=1.3 s per
  // pointing click, K=0.28 s per key; plus 3 s to scan each new page. A model, not a measure.
  const klm = interactions * 1.35 + (c.clics + c.survols) * 1.3 + (c.touches + c.caracteres_saisis) * 0.28 + c.pages_distinctes * 3
  const a = {
    persona: mesures.persona || null,
    mesure: {
      ...c,
      interactions,
      etapes_superflues: ref ? Math.max(0, interactions - ref) : null,
      chemin_reference: ref,
      duree_technique_secondes: mesures.secondes ?? null,
      tokens: mesures.tokens || null,
      cout_equivalent_usd: mesures.cout_equivalent_usd ?? null,
    },
    estimation_modele: { temps_humain_klm_secondes: Math.round(klm), avertissement: 'estimation par modèle KLM, pas une mesure sur un humain' },
    estimation_persona: json ? json.estimations_simulees || null : null,
    pas_declares: { nombre: pas.length, hesitations: hes.length, elements_non_compris: incompris.map((p) => p.comprends).slice(0, 20), couverture: interactions ? Math.min(1, pas.length / interactions) : 0 },
    demandes_aide: [...new Set([...aidesTexte, ...aidesJson])],
    citations: { total: cits.length, verifiees: ver, non_retrouvees: nonr.length, taux_verifiees: cits.length ? Math.round((ver / cits.length) * 100) / 100 : null, liste_non_retrouvees: nonr.map((x) => ({ champ: x.champ, texte: String(x.texte).slice(0, 160) })) },
    reponse_finale_lisible: !!json,
    objectif_atteint_declare: json ? json.objectif_atteint || null : null,
    abandon_declare: json && json.abandon ? json.abandon : null,
  }
  writeFileSync(path.join(dir, 'analyse.json'), JSON.stringify(a, null, 1))
  return a
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2]
  const o = {}
  for (let i = 3; i < process.argv.length; i += 2) o[process.argv[i].replace(/^--/, '').replace(/-(\w)/g, (_, x) => x.toUpperCase())] = process.argv[i + 1]
  const a = analyser(dir, o)
  console.log(JSON.stringify({ persona: a.persona, mesure: a.mesure, citations: { total: a.citations.total, verifiees: a.citations.verifiees, taux: a.citations.taux_verifiees }, pas: a.pas_declares.nombre }, null, 1))
}
