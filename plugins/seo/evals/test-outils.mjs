// Offline self-test of the seo plugin tools (no browser, no model, no network).
//   node plugins/seo/evals/test-outils.mjs   -> exit 0 if every check passes
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseFrontMatter } from '../outils/frontmatter.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const plugin = path.join(here, '..')
const racine = path.join(plugin, '..', '..')
let ko = 0
const ok = (cond, msg) => { console.log((cond ? 'ok  ' : 'KO  ') + msg); if (!cond) ko++ }
const json = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

// 1. Socle: marketplace, plugin manifest, license, front matter parser, forbidden names.
const mk = json(path.join(racine, '.claude-plugin', 'marketplace.json'))
ok(mk !== null, 'marketplace.json lisible')
ok(mk?.name === 'kvarot-skills', 'marketplace : name kvarot-skills')
ok(Array.isArray(mk?.plugins) && mk.plugins.some((p) => p.name === 'seo' && p.source === './plugins/seo'), 'marketplace : plugin seo déclaré')
const pj = json(path.join(plugin, '.claude-plugin', 'plugin.json'))
ok(pj !== null, 'plugin.json lisible')
ok(pj?.name === 'seo', 'plugin.json : name seo')
ok(pj?.license === 'MIT', 'plugin.json : licence MIT')
ok(/^\d+\.\d+\.\d+$/.test(pj?.version ?? ''), 'plugin.json : version semver')
const lic = path.join(plugin, 'LICENSE')
ok(existsSync(lic) && readFileSync(lic, 'utf8').includes('MIT License'), 'LICENSE : MIT')
try {
  const fm = parseFrontMatter('---\na: 1\nl:\n  - x\n  - y\no:\n  k: v\n---\ncorps')
  ok(JSON.stringify(fm.meta.l) === '["x","y"]', 'frontmatter : liste')
  ok(fm.meta.o.k === 'v', 'frontmatter : objet imbriqué')
  ok(fm.corps === 'corps', 'frontmatter : corps')
} catch (e) { ok(false, 'frontmatter : ' + e.message) }
const interdits = path.join(here, '.noms-interdits.local')
if (!existsSync(interdits)) {
  ok(true, 'noms interdits : fichier local absent, ignoré')
} else {
  const mots = readFileSync(interdits, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#'))
  const fichiers = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'plugins/seo'], { cwd: racine, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean).filter((f) => path.basename(f) !== '.noms-interdits.local')
  const fautifs = []
  for (const f of fichiers) {
    const p = path.join(racine, f)
    if (!existsSync(p)) continue
    const t = readFileSync(p, 'utf8').toLowerCase()
    if (mots.some((m) => t.includes(m))) fautifs.push(f)
  }
  ok(mots.length > 0, 'noms interdits : liste locale non vide')
  ok(fautifs.length === 0, 'noms interdits : aucun fichier concerné' + (fautifs.length ? ' — ' + fautifs.join(', ') : ''))
}

console.log(ko ? `\n${ko} KO` : '\ntout est ok')
process.exit(ko ? 1 : 0)
