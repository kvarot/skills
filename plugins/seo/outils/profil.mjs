// Project profile (.claude/seo/profil.md): read and validate the front matter.
import { readFileSync } from 'node:fs'
import { parseFrontMatter } from './frontmatter.mjs'

const STACKS = ['html-statique', 'php', 'twig', 'vue-spa', 'inconnue']
const RENDUS = ['statique', 'serveur', 'client', 'aucun']

export function lireProfil(fichier) {
  return parseFrontMatter(readFileSync(fichier, 'utf8'))
}

const texte = (v) => typeof v === 'string' && v.trim() !== ''
const objet = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const dateIso = (v) => {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : v
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
const urlHttp = (v) => {
  if (typeof v !== 'string') return false
  try { return ['http:', 'https:'].includes(new URL(v).protocol) } catch { return false }
}

export function validerProfil(meta) {
  if (!objet(meta)) return ['profil illisible : le front matter doit être un objet']
  const e = []
  if (meta.version !== 1) e.push('version doit valoir 1')
  if (!STACKS.includes(meta.stack)) e.push(`stack manquant ou inconnu (attendu : ${STACKS.join(', ')})`)
  if (!RENDUS.includes(meta.rendu)) e.push(`rendu manquant ou inconnu (attendu : ${RENDUS.join(', ')})`)
  if (!Array.isArray(meta.langues) || meta.langues.length === 0 || !meta.langues.every(texte)) e.push('langues doit être une liste non vide de textes (ex. fr)')
  for (const k of ['public', 'offre', 'ton', 'secteur']) if (!texte(meta[k])) e.push(`${k} manquant ou vide : texte non vide attendu`)
  if (typeof meta.pays !== 'string' || !/^[A-Z]{2}$/.test(meta.pays)) e.push('pays doit être un code ISO sur 2 lettres majuscules (ex. FR)')
  if (!objet(meta.outils)) e.push('outils manquant : { search_console, navigateur } attendu')
  else for (const k of ['search_console', 'navigateur']) if (typeof meta.outils[k] !== 'boolean') e.push(`outils.${k} doit être un booléen (oui/non)`)
  if (meta.confirme_le === undefined || meta.confirme_le === '') e.push('confirme_le manquant : le discours doit être confirmé par le développeur')
  else if (!dateIso(meta.confirme_le)) e.push('confirme_le doit être une date ISO AAAA-MM-JJ')

  if (meta.urls !== undefined) {
    if (!objet(meta.urls)) e.push('urls doit être un objet { dev, prod }')
    else for (const k of ['dev', 'prod']) if (meta.urls[k] !== undefined && !urlHttp(meta.urls[k])) e.push(`urls.${k} doit être une URL http(s) valide`)
  }
  if (meta.mots_cles !== undefined) {
    if (!objet(meta.mots_cles)) e.push('mots_cles doit être un objet type de page → liste')
    else for (const [t, l] of Object.entries(meta.mots_cles)) if (!Array.isArray(l) || !l.every(texte)) e.push(`mots_cles.${t} doit être une liste de textes`)
  }
  if (meta.note !== undefined && !texte(meta.note)) e.push('note doit être un texte non vide (ex. confirmé d’avance, non relu)')
  if (meta.termes_a_eviter !== undefined && (!Array.isArray(meta.termes_a_eviter) || !meta.termes_a_eviter.every(texte))) e.push('termes_a_eviter doit être une liste de textes')
  if (meta.pages !== undefined) {
    if (!Array.isArray(meta.pages)) e.push('pages doit être une liste d’objets { url, source }')
    else meta.pages.forEach((p, i) => { if (!objet(p) || !texte(p.url) || !texte(p.source)) e.push(`pages[${i}] doit avoir url et source`) })
  }
  if (meta.historique !== undefined) {
    if (!Array.isArray(meta.historique)) e.push('historique doit être une liste d’objets { date, lot, controles }')
    else meta.historique.forEach((h, i) => {
      if (!objet(h) || !dateIso(h.date) || !texte(h.lot) || !Array.isArray(h.controles) || !h.controles.every(texte)) e.push(`historique[${i}] doit avoir date (AAAA-MM-JJ), lot et controles (liste)`)
    })
  }
  return e
}
