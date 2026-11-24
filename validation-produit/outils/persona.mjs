// Persona cards: Markdown with a small YAML front matter (no dependency).
// Parses, validates against the schema in references/persona-schema.md, and turns the
// card into ENFORCED launch settings (viewport, allowed tools, action budget).
//   import { lirePersona, reglagesLancement } from './persona.mjs'
//   node persona.mjs <card.md>            -> prints the parsed card and its settings (self-check)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Minimal YAML subset: "key: value", "key: [a, b]", block lists "- x", one nested map level.
export function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) throw new Error('front matter --- missing')
  const lines = m[1].split(/\r?\n/)
  const root = {}
  let key = null
  let sub = null
  const scalar = (v) => {
    v = v.trim()
    if (v === '') return ''
    if (/^\[.*\]$/.test(v)) return v.slice(1, -1).split(',').map((x) => scalar(x)).filter((x) => x !== '')
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
    if (v === 'true' || v === 'oui') return true
    if (v === 'false' || v === 'non') return false
    return v.replace(/^["']|["']$/g, '')
  }
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    const indent = raw.match(/^ */)[0].length
    const line = raw.trim()
    if (line.startsWith('- ')) {
      const target = sub && indent >= 4 ? root[key][sub] : root[key]
      if (Array.isArray(target)) target.push(scalar(line.slice(2)))
      else if (sub && indent >= 4) root[key][sub] = [scalar(line.slice(2))]
      else root[key] = [scalar(line.slice(2))]
      continue
    }
    const kv = line.match(/^([\w.-]+):\s*(.*)$/)
    if (!kv) throw new Error('unreadable line: ' + line)
    if (indent === 0) {
      key = kv[1]; sub = null
      root[key] = kv[2] === '' ? {} : scalar(kv[2])
    } else {
      if (typeof root[key] !== 'object' || Array.isArray(root[key])) root[key] = {}
      sub = kv[1]
      root[key][sub] = kv[2] === '' ? [] : scalar(kv[2])
    }
  }
  // Empty maps that received list items were converted above; empty {} with no content stay {}.
  return { meta: root, corps: m[2].trim() }
}

const REQUIS = ['id', 'role', 'metier', 'experience', 'niveau_informatique', 'connaissance_logiciel',
  'connaissance_metier', 'objectifs', 'attentes', 'contraintes_temps', 'environnement', 'accessibilite',
  'patience', 'tolerance_erreurs', 'strategie_recherche', 'seuil_abandon', 'criteres_satisfaction']
const ENUMS = {
  niveau_informatique: ['bas', 'moyen', 'eleve'],
  connaissance_logiciel: ['aucune', 'notions', 'habituelle'],
  patience: ['basse', 'moyenne', 'haute'],
  tolerance_erreurs: ['basse', 'moyenne', 'haute'],
}

export function validerPersona(meta) {
  const err = []
  for (const k of REQUIS) if (meta[k] === undefined || meta[k] === '' || (Array.isArray(meta[k]) && !meta[k].length)) err.push('champ manquant : ' + k)
  for (const [k, vals] of Object.entries(ENUMS)) if (meta[k] !== undefined && !vals.includes(meta[k])) err.push(`${k} doit valoir ${vals.join(' | ')}`)
  const env = meta.environnement || {}
  if (env.saisie && !['souris', 'clavier-seul', 'tactile'].includes(env.saisie)) err.push('environnement.saisie doit valoir souris | clavier-seul | tactile')
  if (env.ecran && !/^\d{3,4}x\d{3,4}$/.test(String(env.ecran))) err.push('environnement.ecran doit être LARGEURxHAUTEUR')
  const z = (meta.accessibilite || {}).zoom
  if (z !== undefined && ![100, 150, 200, 300, 400].includes(z)) err.push('accessibilite.zoom doit valoir 100, 150, 200, 300 ou 400')
  return err
}

// What the launcher ENFORCES from the card (never left to the model's goodwill).
export function reglagesLancement(meta) {
  const env = meta.environnement || {}
  const a11y = meta.accessibilite || {}
  let [w, h] = String(env.ecran || '1280x900').split('x').map(Number)
  const zoom = Number(a11y.zoom || 100)
  // Browser zoom Z% on a WxH screen gives a CSS viewport of (W/Z*100)x(H/Z*100): same reflow.
  w = Math.round((w * 100) / zoom); h = Math.round((h * 100) / zoom)
  const clavier = env.saisie === 'clavier-seul' || a11y.clavier_seul === true
  const base = ['navigate_page', 'take_snapshot', 'wait_for', 'take_screenshot', 'list_pages', 'select_page', 'handle_dialog', 'press_key', 'type_text']
  const pointeur = ['click', 'fill', 'fill_form', 'hover']
  const outils = clavier ? base : [...base, ...pointeur]
  // Keyboard users need many more key presses (Tab steps) for the same patience.
  const budgetActions = ({ basse: 20, moyenne: 30, haute: 45 }[meta.patience] || 30) * (clavier ? 3 : 1)
  return {
    viewport: `${w}x${h}`,
    outils,
    budget_actions: budgetActions,
    notes: [
      zoom !== 100 ? `zoom ${zoom} % simulé par une fenêtre CSS de ${w}x${h} (même mise en page, pas de lissage des polices)` : null,
      clavier ? 'clavier seul imposé : aucun outil de clic ni de remplissage direct' : null,
      env.saisie === 'tactile' ? 'tactile : taille d’écran seulement, le toucher n’est pas émulé' : null,
      a11y.lecteur_ecran ? "lecteur d'écran : approché par l'arbre d'accessibilité, pas un vrai lecteur" : null,
    ].filter(Boolean),
  }
}

// Writes a card back (same YAML subset). Used to give the replayer the environment of the
// persona that found the anomaly (keyboard-only, zoom, screen), so a replay is comparable.
export function ecrireFiche(meta, corps) {
  const v = (x) => (Array.isArray(x) ? `[${x.join(', ')}]` : String(x))
  const lignes = ['---']
  for (const [k, x] of Object.entries(meta)) {
    if (x && typeof x === 'object' && !Array.isArray(x)) { lignes.push(`${k}:`); for (const [kk, xx] of Object.entries(x)) lignes.push(`  ${kk}: ${v(xx)}`) }
    else if (Array.isArray(x)) { lignes.push(`${k}:`); for (const e of x) lignes.push(`  - ${e}`) }
    else lignes.push(`${k}: ${v(x)}`)
  }
  return lignes.concat(['---', '', corps, '']).join('\n')
}

export function lirePersona(file) {
  const { meta, corps } = parseFrontMatter(readFileSync(file, 'utf8'))
  const erreurs = validerPersona(meta)
  if (erreurs.length) throw new Error(`persona ${file} invalide :\n- ` + erreurs.join('\n- '))
  return { meta, corps, reglages: reglagesLancement(meta) }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(JSON.stringify(lirePersona(process.argv[2]), null, 1))
  } catch (e) { console.error(e.message); process.exit(1) }
}
