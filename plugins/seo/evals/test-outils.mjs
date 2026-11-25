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

// 2. Extraction: SEO facts from an HTML string (inline fixtures).
let extraire = null
try { ({ extraire } = await import('../outils/extraire.mjs')) } catch (e) { ok(false, 'extraction : module chargeable — ' + e.message) }
if (extraire) {
  const f1 = extraire(`<!DOCTYPE html><html LANG="fr-FR"><head><title>Tom &amp; Jerry</title>
    <meta name="Description" content='Un "test" &amp; plus'>
    <link rel="canonical" href=https://ex.com/a>
    <meta name=robots content="noindex, follow">
    <link rel="alternate" hreflang="en" href="https://ex.com/en">
    <link rel="alternate" hreflang="x-default" href="/">
    <meta property="og:title" content="OG &amp; titre"><meta property="og:image" content="/i.png">
    </head><body><h1>Un <em>grand</em>   titre</h1><h2>Sous</h2><h1>Autre</h1>
    <a href="/x?a=1&amp;b=2">Lien <b>un</b></a><a href='/y'>Deux</a><a name="z">sans href</a></body></html>`, 'https://ex.com/a')
  ok(f1.url === 'https://ex.com/a', 'extraction : url')
  ok(f1.title === 'Tom & Jerry', 'extraction : title + entité décodée')
  ok(f1.description === 'Un "test" & plus', 'extraction : description (attribut en minuscules/majuscules, quotes simples)')
  ok(f1.canonical === 'https://ex.com/a', 'extraction : canonical sans guillemets')
  ok(f1.robots === 'noindex, follow', 'extraction : robots')
  ok(f1.lang === 'fr-FR', 'extraction : lang')
  ok(JSON.stringify(f1.hreflang) === '[{"lang":"en","href":"https://ex.com/en"},{"lang":"x-default","href":"/"}]', 'extraction : hreflang')
  ok(f1.og.title === 'OG & titre' && f1.og.image === '/i.png' && f1.og.description === null, 'extraction : og (absent = null)')
  ok(JSON.stringify(f1.hn) === '[{"niveau":1,"texte":"Un grand titre"},{"niveau":2,"texte":"Sous"},{"niveau":1,"texte":"Autre"}]', 'extraction : hn dans l\'ordre, texte nettoyé')
  ok(JSON.stringify(f1.liens) === '[{"href":"/x?a=1&b=2","texte":"Lien un"},{"href":"/y","texte":"Deux"}]', 'extraction : liens (a href seulement)')
  const f2 = extraire('<p>x</p>', 'u')
  ok(f2.title === null && f2.description === null && f2.canonical === null && f2.robots === null && f2.lang === null, 'extraction : absents = null')
  ok(f2.og.title === null && f2.hreflang.length === 0 && f2.jsonld.length === 0, 'extraction : og/hreflang/jsonld vides')
  const f3 = extraire('<img src="a.jpg"><img src="b.jpg" alt=""><img src="c.jpg" alt="Chat" width=10 height="20">', 'u')
  ok(f3.images[0].alt === null && f3.images[0].width === null && f3.images[0].height === null, 'extraction : img sans alt = null')
  ok(f3.images[1].alt === '', 'extraction : alt vide distinct de absent')
  ok(f3.images[2].alt === 'Chat' && f3.images[2].width === '10' && f3.images[2].height === '20' && f3.images[2].src === 'c.jpg', 'extraction : img complète')
  const f4 = extraire('<script type="application/ld+json">{"@type": "Org"}</script><script type="application/ld+json">{"@type": "X",}</script><script>var a = 1</script>', 'u')
  ok(f4.jsonld.length === 2, 'extraction : deux blocs JSON-LD')
  ok(f4.jsonld[0].objet?.['@type'] === 'Org' && f4.jsonld[0].erreur === null && f4.jsonld[0].brut.includes('Org'), 'extraction : JSON-LD valide')
  ok(f4.jsonld[1].objet === null && typeof f4.jsonld[1].erreur === 'string' && f4.jsonld[1].erreur.length > 0, 'extraction : JSON-LD invalide')
  const f5 = extraire('<html><head><title>T</title><style>a b c d</style></head><body><p>un deux trois</p><script>x y z w</script><noscript>n1 n2</noscript><p>quatre</p></body></html>', 'u')
  ok(f5.mots === 4, 'extraction : mots = texte visible seulement (' + f5.mots + ')')
  ok(f5.corpsVide === true, 'extraction : moins de 20 mots = corpsVide')
  ok(extraire('<body><div id="app"></div><script src="x.js"></script></body>', 'u').corpsVide === true, 'extraction : coquille SPA = corpsVide')
  ok(extraire('<body><p>' + 'mot '.repeat(25) + '</p></body>', 'u').corpsVide === false, 'extraction : page fournie = corpsVide false')
  let f6 = null, err = null
  try { f6 = extraire('<html><head><title>X', 'u') } catch (e) { err = e }
  ok(err === null && f6?.title === 'X', 'extraction : HTML tronqué sans exception, title X')
  ok(extraire('<html><head></head><body><svg><title>Icone</title></svg><p>x</p></body></html>', 'u').title === null, 'extraction : title SVG ignoré')
  ok(extraire('<title>Vrai</title><body><svg><title>Icone</title></svg></body>', 'u').title === 'Vrai', 'extraction : title head prioritaire sur SVG')
  ok(extraire('<script type="Application/LD+JSON; charset=utf-8">{"a":1}</script>', 'u').jsonld[0]?.objet?.a === 1, 'extraction : ld+json avec paramètres')
  ok(extraire('<html><head><title>T</title><meta charset="utf-8"><h1>Titre</h1><p>un deux trois</p>', 'u').mots === 4, 'extraction : head non fermé terminé par un élément de body')
  ok(extraire('<title>A &amp;amp; B</title><p>x</p>', 'u').title === 'A &amp; B', 'extraction : pas de double décodage')
  let sains = true
  for (const bad of ['', '<', '<a href="', '<!-- x', '<script>', '<h1>x', undefined, null, 42]) {
    try { extraire(bad, 'u') } catch { sains = false }
  }
  ok(sains, 'extraction : entrées dégénérées sans exception')
}

console.log(ko ? `\n${ko} KO` : '\ntout est ok')
process.exit(ko ? 1 : 0)
