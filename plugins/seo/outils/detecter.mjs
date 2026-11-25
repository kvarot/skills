// Stack detection: first matching rule wins (vue-spa, twig, php, html-statique, inconnue).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const IGNORES = new Set(['node_modules', 'vendor', '.git', 'dist', '.claude'])
const MAX_FICHIERS = 5000
const MAX_CLES = 15

// List relative paths (forward slashes), capped, skipping ignored folders.
function lister(dir) {
  const out = []
  const pile = ['']
  while (pile.length && out.length < MAX_FICHIERS) {
    const rel = pile.shift()
    let entrees
    try { entrees = readdirSync(path.join(dir, rel), { withFileTypes: true }) } catch { continue }
    entrees.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of entrees) {
      const r = rel ? rel + '/' + e.name : e.name
      if (e.isDirectory()) { if (!IGNORES.has(e.name)) pile.push(r) } else if (e.isFile()) { out.push(r); if (out.length >= MAX_FICHIERS) break }
    }
  }
  return out
}

const lire = (dir, rel) => { try { return readFileSync(path.join(dir, rel), 'utf8') } catch { return '' } }
const trier = (xs) => [...new Set(xs)].sort()
const court = (xs) => trier(xs).slice(0, MAX_CLES)

function langues(dir, fichiers) {
  const trouvees = []
  for (const f of fichiers) {
    const m = /<html\b[^>]*?\blang\s*=\s*["']?([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)/i.exec(lire(dir, f))
    if (m) trouvees.push(m[1])
  }
  return trier(trouvees)
}

// Resolve a PHP include target to a known .php file (relative path) or null.
function resoudre(cible, depuis, php) {
  const c = cible.replace(/^\/+/, '')
  const candidats = [path.posix.normalize(path.posix.join(path.posix.dirname(depuis), c)), path.posix.normalize(c)]
  for (const x of candidats) if (php.includes(x)) return x
  return php.find((f) => f.endsWith('/' + c)) ?? null
}

function phpHtml(dir, php) {
  const directs = new Set()
  const incs = new Map()
  for (const f of php) {
    const t = lire(dir, f)
    if (/<html\b|<head\b/i.test(t)) directs.add(f)
    const cibles = []
    for (const m of t.matchAll(/\b(?:include|require)(?:_once)?\b[^;]*?['"]([^'"]+\.php)['"]/g)) {
      const r = resoudre(m[1], f, php)
      if (r && r !== f) cibles.push(r)
    }
    incs.set(f, cibles)
  }
  const html = new Set(directs)
  for (let changed = true; changed;) {
    changed = false
    for (const [f, cibles] of incs) if (!html.has(f) && cibles.some((c) => html.has(c))) { html.add(f); changed = true }
  }
  return { directs, html }
}

const MAX_HTML = 512 * 1024

// True when the html holds an element with id="app" whose content is empty (whitespace and comments only).
// Bounded work: at most MAX_CANDIDATS id matches, tag search windows of FENETRE chars, and a single forward
// pass over whitespace and comments that stops at the first other character.
const MAX_CANDIDATS = 20
const FENETRE = 2048
function conteneurVide(html) {
  const h = html.slice(0, MAX_HTML)
  let vus = 0
  for (const m of h.matchAll(/\bid\s*=\s*["']app["']/gi)) {
    if (++vus > MAX_CANDIDATS) break
    const avant = h.slice(Math.max(0, m.index - FENETRE), m.index)
    const debut = avant.lastIndexOf('<')
    if (debut < 0 || avant.indexOf('>', debut) >= 0) continue
    const nom = /^<(\w+)/.exec(avant.slice(debut, debut + 40))
    if (!nom) continue
    const fin = h.slice(m.index, m.index + FENETRE).indexOf('>')
    if (fin < 0) continue
    let pos = m.index + fin + 1
    for (;;) {
      while (pos < h.length && /\s/.test(h[pos])) pos++
      if (!h.startsWith('<!--', pos)) break
      const close = h.indexOf('-->', pos + 4)
      if (close < 0) { pos = -1; break }
      pos = close + 3
    }
    if (pos >= 0 && h.slice(pos, pos + nom[1].length + 3).toLowerCase() === '</' + nom[1].toLowerCase() + '>') return true
  }
  return false
}

export function detecter(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`dossier introuvable : ${dir}`)
  const fichiers = lister(dir)
  const de = (ext) => fichiers.filter((f) => f.toLowerCase().endsWith(ext))
  const stack = (s, rendu, cles, tpl, indices) => ({ stack: s, rendu, fichiersCles: court(cles), langues: langues(dir, tpl), indices })

  // Rule 1: Vue dependency + empty #app container in the root index.html (dist is not scanned).
  let pkg = null
  try { pkg = JSON.parse(lire(dir, 'package.json')) } catch { /* no usable package.json */ }
  const indexRacine = lire(dir, 'index.html')
  const aVue = !!pkg && !!(pkg.dependencies?.vue || pkg.devDependencies?.vue)
  if (aVue && conteneurVide(indexRacine)) {
    const routeur = fichiers.filter((f) => /\.(js|ts)$/.test(f) && (/(^|\/)router(\/|\.)/.test(f) || /(^|\/)main\.(js|ts)$/.test(f)))
    return stack('vue-spa', 'client', ['package.json', 'index.html', ...routeur], ['index.html'], ['dépendance vue dans package.json', 'index.html racine avec conteneur vide id="app" (rendu côté navigateur)'])
  }

  // Rule 2: Twig templates.
  const twig = de('.twig')
  if (twig.length) {
    const base = twig.filter((f) => /\{%-?\s*block\s+(title|meta)|<html\b|<head\b/i.test(lire(dir, f)) || /(^|\/)(base|layout)[^/]*$/i.test(f))
    return stack('twig', 'serveur', base.length ? base : twig, twig, [`${twig.length} gabarit(s) .twig`])
  }

  // Rule 3: PHP files producing HTML directly or through an included file.
  const php = de('.php')
  const { directs, html } = phpHtml(dir, php)
  if (html.size) {
    const cles = [...directs, ...[...html].filter((f) => !directs.has(f))]
    return stack('php', 'serveur', cles.slice(0, MAX_CLES), [...html], [`${html.size} fichier(s) .php produisant du HTML`, ...(directs.size < html.size ? ['inclusion d\'un fichier contenant <html ou <head'] : [])])
  }

  // Rule 4: plain HTML files.
  const pages = de('.html')
  if (pages.length) {
    const indexes = pages.filter((f) => path.posix.basename(f).toLowerCase() === 'index.html')
    const cles = [...indexes, ...pages.filter((f) => !indexes.includes(f))].slice(0, MAX_CLES)
    return stack('html-statique', 'statique', cles, pages, [`${pages.length} fichier(s) .html, ni gabarit ni PHP`])
  }

  return { stack: 'inconnue', rendu: 'aucun', fichiersCles: [], langues: [], indices: ['aucun fichier .twig, .php produisant du HTML ni .html'] }
}
