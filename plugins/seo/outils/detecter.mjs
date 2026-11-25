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
  if (aVue && /<(\w+)\b[^>]*\bid\s*=\s*["']app["'][^>]*>(?:\s|<!--[\s\S]*?-->)*<\/\1>/i.test(indexRacine)) {
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
