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

// 3. Controls: catalogue and engine on hand-built facts.
let CATALOGUE = null, controler = null
try { ({ CATALOGUE, controler } = await import('../outils/controler.mjs')) } catch (e) { ok(false, 'contrôles : module chargeable — ' + e.message) }
if (controler) {
  const mots = (n) => Array.from({ length: n }, (_, i) => 'mot' + i).join(' ')
  // A fully compliant page; each test overrides one field.
  const bon = (url = '/', o = {}) => ({
    url, lang: 'fr', title: 'Cabinet de kinésithérapie à Lyon ' + url, // unique per url, 30-60 chars
    description: 'Cabinet de kinésithérapie à Lyon : rééducation, massages et suivi personnalisé de chaque patient. ' + url,
    canonical: new URL(url, 'https://ex.test').href, robots: null, hreflang: [],
    og: { title: 'Cabinet', description: 'Un cabinet', image: null },
    hn: [{ niveau: 1, texte: 'Cabinet' }, { niveau: 2, texte: 'Soins' }],
    images: [{ src: 'a.jpg', alt: 'Salle', width: '10', height: '10' }],
    liens: [], jsonld: [{ brut: '{}', objet: { '@type': 'Organization' }, erreur: null }],
    mots: 400, corpsVide: false, ...o,
  })
  const site = (o = {}) => ({ robotsTxt: 'User-agent: *\nDisallow:\n', sitemapXml: null, urlsConnues: [], origine: 'https://ex.test', ...o })
  const sitemapDe = (...u) => '<urlset>' + u.map((x) => `<url><loc>${x}</loc></url>`).join('') + '</urlset>'
  const ids = (cs) => cs.map((c) => c.controle)
  const a = (id, pages, s = site(), msg = id) => {
    const cs = controler(pages, s)
    ok(ids(cs).includes(id), 'contrôles : ' + msg + ' déclenché')
    return cs.find((c) => c.controle === id)
  }
  const vide = (pages, s = site(), msg = 'conforme') => {
    const cs = controler(pages, s)
    ok(cs.length === 0, 'contrôles : ' + msg + ' → aucun constat' + (cs.length ? ' — ' + ids(cs).join(', ') : ''))
  }
  const ABS = site({ sitemapXml: sitemapDe('https://ex.test/') })
  vide([bon('/')], ABS, 'page conforme')
  vide([bon('https://ex.test/')], ABS, 'page conforme (url absolue)')

  const t = a('T-TITLE-ABSENT', [bon('/', { title: '  ' }), bon('/b', { title: null }), bon('/c')])
  ok(t.severite === 'bloquant' && t.lot === 'meta' && t.pages.length === 2 && t.priorite === 6 && typeof t.preuve === 'string' && t.preuve.length > 0, 'contrôles : forme du constat (sévérité, lot, pages, priorité 3×2, preuve)')
  const d = controler([bon('/a', { title: 'Même titre de page  ici ok ok ok' }), bon('/b', { title: ' même TITRE de page  ici ok ok ok' }), bon('/c', { title: 'Autre titre assez long pour passer' }), bon('/d', { title: null }), bon('/e', { title: null })], site())
  const dt = d.filter((c) => c.controle === 'T-TITLE-DOUBLON')
  ok(dt.length === 1 && dt[0].pages.length === 2, 'contrôles : T-TITLE-DOUBLON un constat par valeur, casse/espaces ignorés, absents exclus')
  a('T-TITLE-LONGUEUR', [bon('/', { title: 'Court' })])
  a('T-TITLE-LONGUEUR', [bon('/', { title: 'x'.repeat(61) })], site(), 'T-TITLE-LONGUEUR (trop long)')
  a('T-DESC-ABSENT', [bon('/', { description: null })])
  a('T-DESC-DOUBLON', [bon('/a', { description: mots(15) }), bon('/b', { description: mots(15).toUpperCase() })])
  a('T-DESC-LONGUEUR', [bon('/', { description: 'courte' })])
  a('T-DESC-LONGUEUR', [bon('/', { description: 'x'.repeat(161) })], site(), 'T-DESC-LONGUEUR (trop long)')
  a('T-CANONICAL-ABSENT', [bon('/', { canonical: null })])
  a('T-CANONICAL-INVALIDE', [bon('/', { canonical: '/relatif' })])
  a('T-CANONICAL-INVALIDE', [bon('/', { canonical: 'https://autre.test/' })], site(), 'T-CANONICAL-INVALIDE (autre domaine, origine)')
  vide([bon('/', { canonical: 'https://autre.test/' })], site({ origine: undefined, sitemapXml: sitemapDe('/') }), 'canonical autre domaine sans origine')
  a('T-ROBOTS-NOINDEX', [bon('/', { robots: 'Noindex, follow' })])
  a('T-ROBOTSTXT-ABSENT', [bon('/')], site({ robotsTxt: null }))
  a('T-ROBOTSTXT-BLOQUE-TOUT', [bon('/')], site({ robotsTxt: 'User-agent: bot\nDisallow: /x\n\nUser-agent: *\n# c\nDisallow: /\n' }))
  vide([bon('/')], { ...ABS, robotsTxt: 'User-agent: Bot\nDisallow: /\nUser-agent: *\nDisallow:\n' }, 'Disallow / réservé à un autre agent, vide = autorisé')
  a('T-SITEMAP-ABSENT', [bon('/')], site({ sitemapXml: null }))
  a('T-SITEMAP-INCOHERENT', [bon('/'), bon('/soins.html')], site({ sitemapXml: sitemapDe('https://ex.test/') }), 'T-SITEMAP-INCOHERENT (page absente du sitemap)')
  a('T-SITEMAP-INCOHERENT', [bon('/')], site({ sitemapXml: sitemapDe('https://ex.test/', 'https://ex.test/fantome') }), 'T-SITEMAP-INCOHERENT (URL inconnue)')
  vide([bon('/', { liens: [{ href: '/soins.html', texte: 'Soins' }] }), bon('/soins.html')], site({ sitemapXml: sitemapDe('https://ex.test/', 'https://ex.test/soins.html'), urlsConnues: ['/', '/soins.html'] }), 'sitemap absolu vs pages en chemin')
  const hl = (l) => [{ lang: 'fr', href: 'https://ex.test/' }, { lang: 'en', href: 'https://ex.test/en' }, ...(l ? [{ lang: 'x-default', href: 'https://ex.test/' }] : [])]
  const SM2 = site({ sitemapXml: sitemapDe('https://ex.test/', 'https://ex.test/en') })
  a('T-HREFLANG-INCOHERENT', [bon('/', { hreflang: hl(true) }), bon('/en', { hreflang: [{ lang: 'en', href: 'https://ex.test/en' }] })], SM2, 'T-HREFLANG-INCOHERENT (sans réciproque)')
  a('T-HREFLANG-INCOHERENT', [bon('/', { hreflang: hl(false) }), bon('/en', { hreflang: hl(false) })], SM2, 'T-HREFLANG-INCOHERENT (sans x-default)')
  vide([bon('/', { hreflang: hl(true), liens: [{ href: '/en', texte: 'English' }] }), bon('/en', { hreflang: hl(true), liens: [{ href: '/', texte: 'Français' }] })], SM2, 'hreflang réciproque avec x-default')
  a('T-LANG-ABSENT', [bon('/', { lang: null })])
  a('T-OG-ABSENT', [bon('/', { og: { title: 'x', description: null, image: null } })])
  a('T-H1-ABSENT', [bon('/', { hn: [{ niveau: 2, texte: 'x' }] })])
  a('T-H1-MULTIPLE', [bon('/', { hn: [{ niveau: 1, texte: 'a' }, { niveau: 1, texte: 'b' }] })])
  a('T-HN-SAUT', [bon('/', { hn: [{ niveau: 1, texte: 'a' }, { niveau: 2, texte: 'b' }, { niveau: 4, texte: 'c' }] })])
  vide([bon('/', { hn: [{ niveau: 1, texte: 'a' }, { niveau: 2, texte: 'b' }, { niveau: 3, texte: 'c' }, { niveau: 2, texte: 'd' }] })], ABS, 'remontée de niveau h3 → h2')
  a('T-ALT-ABSENT', [bon('/', { images: [{ src: 'a.jpg', alt: null, width: '1', height: '1' }] })])
  vide([bon('/', { images: [{ src: 'a.jpg', alt: '', width: '1', height: '1' }] })], ABS, 'alt vide décoratif')
  a('T-IMG-DIMENSIONS', [bon('/', { images: [{ src: 'a.jpg', alt: 'x', width: '1', height: null }] })])
  a('T-LIEN-CASSE', [bon('/', { liens: [{ href: '/inconnue', texte: 'Page' }] })])
  vide([bon('/', { liens: [{ href: 'mailto:a@ex.test', texte: 'Mail' }, { href: 'tel:+33100000000', texte: 'Tel' }, { href: '#haut', texte: 'Haut' }, { href: 'javascript:void(0)', texte: 'x' }, { href: 'https://externe.test/x', texte: 'Ext' }, { href: '/#ancre', texte: 'Accueil' }] })], ABS, 'liens mailto/tel/ancre/js/externes ignorés')
  vide([bon('/', { liens: [{ href: 'https://externe.test/x', texte: 'Ext' }, { href: 'https://www.google.com/', texte: 'G' }] })], site({ origine: undefined, sitemapXml: sitemapDe('/') }), 'liens externes absolus sans origine (mode dossier)')
  vide([bon('/', { liens: [{ href: '/doc.pdf', texte: 'Plaquette' }, { href: '/img/x.png', texte: 'Image' }] })], ABS, 'liens vers fichiers non HTML ignorés')
  a('T-PAGE-ORPHELINE', [bon('/', { liens: [] }), bon('/seule')], site({ sitemapXml: sitemapDe('/', '/seule') }))
  vide([bon('/', { liens: [{ href: 'https://ex.test/seule', texte: 'Seule' }] }), bon('/seule', { liens: [{ href: '/', texte: 'Accueil' }] })], site({ sitemapXml: sitemapDe('/', '/seule') }), 'liens internes absolus/relatifs')
  a('T-SPA-HTML-VIDE', [bon('/', { corpsVide: true })])
  a('T-JSONLD-INVALIDE', [bon('/', { jsonld: [{ brut: '{', objet: null, erreur: 'Unexpected end' }] })])
  a('T-JSONLD-INVALIDE', [bon('/', { jsonld: [{ brut: '{}', objet: { name: 'x' }, erreur: null }] })], site(), 'T-JSONLD-INVALIDE (sans @type)')
  const ld = (o) => [bon('/', { jsonld: [{ brut: '', objet: o, erreur: null }] })]
  a('T-JSONLD-INTERDIT', ld({ '@type': 'AggregateRating', ratingValue: 5 }))
  a('T-JSONLD-INTERDIT', ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Organization' }, { '@type': 'Review' }] }), site(), 'T-JSONLD-INTERDIT (@graph)')
  a('T-JSONLD-INTERDIT', ld({ '@type': ['LocalBusiness'], aggregateRating: { '@type': 'AggregateRating' } }), site(), 'T-JSONLD-INTERDIT (imbriqué)')
  a('T-JSONLD-INTERDIT', ld({ '@type': ['Thing', 'Review'] }), site(), 'T-JSONLD-INTERDIT (@type tableau)')
  a('C-PAGE-PAUVRE', [bon('/', { mots: 120 })])
  for (const x of ['Cliquez ici !', 'ICI', 'En savoir plus…', 'Lire la suite', 'click here', 'Here.', 'read more']) {
    const c = controler([bon('/', { liens: [{ href: 'https://externe.test/', texte: x }] })], ABS)
    ok(ids(c).includes('C-ANCRE-GENERIQUE'), 'contrôles : ancre générique « ' + x + ' »')
  }
  vide([bon('/', { liens: [{ href: 'https://externe.test/', texte: 'Prendre rendez-vous' }] })], ABS, 'ancre explicite')

  // Ordering and catalogue shape.
  const mix = controler([bon('/', { title: null, lang: null, mots: 10 }), bon('/b', { title: null })], site())
  ok(mix.every((c, i) => i === 0 || mix[i - 1].priorite >= c.priorite), 'contrôles : constats triés par priorité décroissante')
  ok(Array.isArray(CATALOGUE) && CATALOGUE.length === 28 && new Set(CATALOGUE.map((c) => c.id)).size === 28, 'catalogue : 28 ids uniques')
  ok(CATALOGUE.every((c) => ['bloquant', 'important', 'mineur'].includes(c.severite) && c.lot && c.description), 'catalogue : sévérité, lot, description')
  const tout = controler([bon('/', { title: null, hn: [], lang: null })], site({ robotsTxt: null, sitemapXml: null }))
  ok(tout.every((c) => CATALOGUE.some((k) => k.id === c.controle && k.severite === c.severite && k.lot === c.lot)), 'contrôles : constats cohérents avec le catalogue')

  // controles.md must list exactly the catalogue ids.
  const md = path.join(plugin, 'references', 'controles.md')
  if (!existsSync(md)) ok(false, 'controles.md : présent')
  else {
    const lignes = readFileSync(md, 'utf8').split(/\r?\n/)
    const rows = lignes.filter((l) => /^\|\s*[TC]-[A-Z0-9-]+\s*\|/.test(l))
    const mdIds = rows.map((l) => l.split('|')[1].trim())
    const cat = CATALOGUE.map((c) => c.id)
    ok(mdIds.length === cat.length && cat.every((i) => mdIds.includes(i)) && mdIds.every((i) => cat.includes(i)), 'controles.md : mêmes ids que le catalogue')
    ok(rows.every((l) => /https:\/\/\S+/.test(l)), 'controles.md : une source par id')
    ok(rows.every((l) => { const c = l.split('|'); const k = CATALOGUE.find((x) => x.id === c[1].trim()); return k && c[2].trim() === k.severite && c[3].trim() === k.lot }), 'controles.md : sévérité et lot alignés sur le catalogue')
  }
}

// 4. Collection: local folder, URL crawl (in-process http server), robots.txt, CLI.
let collecterDossier = null, collecterUrl = null, lireRobots = null
try { ({ collecterDossier, collecterUrl, lireRobots } = await import('../outils/collecter.mjs')) } catch (e) { ok(false, 'collecte : module chargeable — ' + e.message) }
if (collecterUrl) {
  const { createServer } = await import('node:http')
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  const page = (titre, liens) => `<!DOCTYPE html><html lang="fr"><head><title>${titre}</title></head><body><h1>${titre}</h1>${liens.map((l) => `<a href="${l}">lien</a>`).join('')}</body></html>`
  const routes = {
    '/': page('Accueil', ['/a', '/b', '/prive/x', 'https://externe.invalid/z', '/doc.pdf', 'mailto:a@b.c', '#haut', '/a#frag']),
    '/a': page('A', ['/c', '/']),
    '/b': page('B', ['/']),
    '/c': page('C', ['/']),
    '/prive/x': page('Prive', []),
  }
  const vus = []
  const autre = []
  const srvAutre = createServer((req, res) => { autre.push(req.url); res.setHeader('content-type', 'text/html'); res.end(page('Autre', [])) })
  await new Promise((r) => srvAutre.listen(0, '127.0.0.1', r))
  const baseAutre = 'http://localhost:' + srvAutre.address().port
  const redir = (res, to) => { res.statusCode = 302; res.setHeader('location', to); res.end() }
  const srv = createServer((req, res) => {
    vus.push(req.url)
    if (req.url === '/r-ext') return redir(res, baseAutre + '/prod')
    if (req.url === '/r-a') return redir(res, '/a')
    if (req.url === '/r-prive') return redir(res, '/prive/x')
    if (req.url === '/boucle') return redir(res, '/boucle')
    if (req.url === '/pdf.php') { res.setHeader('content-type', 'application/pdf'); return res.end('%PDF') }
    if (req.url === '/gros') { res.setHeader('content-type', 'text/html'); return res.end('x'.repeat(6 * 1024 * 1024)) }
    if (req.url === '/lien-ext') { res.setHeader('content-type', 'text/html'); return res.end(page('L', ['/r-ext', '/gros', '/r-a'])) }
    if (req.url === '/sitemap.xml' && vus.includes('/r-sitemap-ok')) { res.setHeader('content-type', 'text/xml'); return res.end('<urlset/>') }
    if (req.url === '/robots.txt') { res.setHeader('content-type', 'text/plain'); return res.end('User-agent: *\nDisallow: /prive/\n') }
    if (routes[req.url]) { res.setHeader('content-type', 'text/html; charset=utf-8'); return res.end(routes[req.url]) }
    res.statusCode = 404; res.end('nope')
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + srv.address().port
  const urls = (r) => r.pages.map((p) => new URL(p.url).pathname).sort()

  // Robots parser.
  const rb = lireRobots('User-agent: bot\nDisallow: /\n\nUser-agent: *\nDisallow: /x/\nAllow: /x/ok\nDisallow: /fin$\n')
  ok(!rb.estAutorise('/x/y') && rb.estAutorise('/x/ok') && rb.estAutorise('/z') && !rb.estAutorise('/fin') && rb.estAutorise('/fin2'), 'robots : préfixe le plus long, groupe *')
  ok(lireRobots('User-agent: *\nDisallow:\n').estAutorise('/a'), 'robots : Disallow vide autorise tout')

  // Dev host: robots is read but not obeyed; BFS, external/pdf/mailto not followed.
  vus.length = 0
  let r = await collecterUrl(base + '/', { delaiMs: 0 })
  ok(JSON.stringify(urls(r)) === JSON.stringify(['/', '/a', '/b', '/c', '/prive/x']), 'collecte URL : largeur, liens externes/pdf/mailto ignorés — ' + urls(r))
  ok(r.pages.every((p) => p.url.startsWith(base)) && r.site.urlsConnues.length === 5 && r.site.origine === base, 'collecte URL : urls absolues, urlsConnues, origine')
  ok(r.site.robotsTxt?.includes('Disallow: /prive/') && r.site.sitemapXml === null, 'collecte URL : robots lu, sitemap absent → null')
  ok(vus.includes('/sitemap.xml') && !vus.some((u) => u.includes('#') || u.endsWith('.pdf')), 'collecte URL : sitemap demandé, pas de fragment ni pdf')
  r = await collecterUrl(base + '/', { delaiMs: 0, maxPages: 2 })
  ok(r.pages.length === 2, 'collecte URL : maxPages respecté')

  // Delay applies between every request.
  let t = Date.now()
  r = await collecterUrl(base + '/', { delaiMs: 200, maxPages: 3 })
  ok(r.pages.length === 3 && Date.now() - t >= 400, 'collecte URL : délai entre les requêtes (3 pages, 200 ms)')

  // Non-dev host (R3): rejection without --autoriser-prod, no request at all.
  vus.length = 0
  let msg = null
  try { await collecterUrl(base + '/', { delaiMs: 0, hotesDev: [], autoriserProd: false }) } catch (e) { msg = e.message }
  ok(msg && msg.includes('--autoriser-prod') && vus.length === 0, 'collecte URL : hôte hors dev refusé sans --autoriser-prod, aucune requête')

  // Non-dev host with consent: delay forced to 1000 ms, robots obeyed.
  t = Date.now()
  r = await collecterUrl(base + '/', { delaiMs: 0, hotesDev: [], autoriserProd: true, maxPages: 1 })
  const duree = Date.now() - t
  ok(duree >= 1900, 'collecte URL : délai forcé à 1000 ms hors dev (' + duree + ' ms pour 3 requêtes)')
  vus.length = 0
  r = await collecterUrl(base + '/', { delaiMs: 1000, hotesDev: [], autoriserProd: true })
  ok(!vus.some((u) => u.startsWith('/prive')) && !urls(r).includes('/prive/x') && urls(r).length === 4, 'collecte URL : chemin Disallow jamais demandé hors dev')

  // Redirects: bounded to the start host, never followed to another host.
  const rejet = async (u, o) => { try { await collecterUrl(u, { delaiMs: 0, ...o }); return null } catch (e) { return e.message } }
  autre.length = 0
  ok((await rejet(base + '/r-ext')) !== null && autre.length === 0, 'redirection : départ redirigé vers un autre hôte → rejet, 0 requête chez l’autre')
  autre.length = 0
  r = await collecterUrl(base + '/lien-ext', { delaiMs: 0 })
  ok(autre.length === 0 && r.erreurs.some((e) => /autre hôte/.test(e.erreur)), 'redirection : lien redirigé hors hôte → 0 requête, consigné dans erreurs')
  ok(r.erreurs.some((e) => /5 Mo/.test(e.erreur)) && !urls(r).includes('/gros'), 'garde-fou : corps > 5 Mo ignoré et consigné')
  ok(urls(r).filter((x) => x === '/a').length === 1, 'redirection même hôte : URL finale dédoublonnée (/r-a → /a)')
  ok(/boucle|redirections/.test((await rejet(base + '/boucle')) ?? ''), 'redirection : boucle bornée à 5 sauts')
  ok(/HTML/.test((await rejet(base + '/pdf.php')) ?? ''), 'départ en 200 non HTML → rejet explicite')
  vus.length = 0
  ok((await rejet(base + '/r-prive', { hotesDev: [], autoriserProd: true, delaiMs: 1000 })) !== null && !vus.includes('/prive/x'), 'redirection vers un chemin Disallow hors dev → non suivie')

  // robots.txt unreachable (5xx) off dev = disallow-all; 4xx = allow-all.
  let code = 500
  const srv5 = createServer((req, res) => {
    if (req.url === '/robots.txt') { res.statusCode = code; return res.end('x') }
    res.setHeader('content-type', 'text/html'); res.end(page('R', []))
  })
  await new Promise((r2) => srv5.listen(0, '127.0.0.1', r2))
  const base5 = 'http://127.0.0.1:' + srv5.address().port
  ok(/robots/.test((await rejet(base5 + '/', { hotesDev: [], autoriserProd: true })) ?? ''), 'robots 5xx hors dev → exploration interdite')
  r = await collecterUrl(base5 + '/', { delaiMs: 0 })
  ok(r.pages.length === 1, 'robots 5xx sur hôte dev → non obéi')
  code = 404
  r = await collecterUrl(base5 + '/', { delaiMs: 0, hotesDev: [], autoriserProd: true })
  ok(r.pages.length === 1 && r.site.robotsTxt === null, 'robots 404 hors dev → tout autorisé')
  await new Promise((r2) => srv5.close(r2))
  await new Promise((r2) => srvAutre.close(r2))

  // Errors.
  msg = null
  try { await collecterUrl(base + '/absent', { delaiMs: 0 }) } catch (e) { msg = e.message }
  ok(msg !== null, 'collecte URL : page de départ en erreur → rejet')
  await new Promise((r2) => srv.close(r2))
  msg = null
  try { await collecterUrl(base + '/', { delaiMs: 0 }) } catch (e) { msg = e.message }
  ok(msg !== null, 'collecte URL : serveur injoignable → rejet')

  // Local folder.
  const dir = mkdtempSync(path.join(tmpdir(), 'seo-collecte-'))
  try {
    mkdirSync(path.join(dir, 'sous'))
    writeFileSync(path.join(dir, 'index.html'), page('Accueil', ['/b.html']))
    writeFileSync(path.join(dir, 'b.html'), page('B', ['/']))
    writeFileSync(path.join(dir, 'sous', 'index.html'), page('Sous', []))
    writeFileSync(path.join(dir, 'robots.txt'), 'User-agent: *\nDisallow:\n')
    const d = collecterDossier(dir)
    ok(JSON.stringify(d.pages.map((p) => p.url).sort()) === JSON.stringify(['/', '/b.html', '/sous/']), 'dossier : urls = chemins relatifs, index.html → /')
    ok(d.site.robotsTxt?.includes('User-agent') && d.site.sitemapXml === null && d.site.urlsConnues.length === 3, 'dossier : robots lu, sitemap null, urlsConnues')
    const cli = (...args) => spawnSync(process.execPath, [path.join(plugin, 'outils', 'seo.mjs'), ...args], { encoding: 'utf8' })
    let c = cli('auditer', '--dossier', dir)
    let sortie = null
    try { sortie = JSON.parse(c.stdout) } catch { /* reported below */ }
    ok(c.status === 0 && sortie && sortie.stack === null && Array.isArray(sortie.constats), 'CLI auditer --dossier : JSON { stack, constats }, code 0')
    c = cli('auditer', '--dossier', path.join(dir, 'inexistant'))
    ok(c.status !== 0 && c.stderr.trim().length > 0, 'CLI auditer : dossier inexistant → code ≠ 0, message sur stderr')
    c = cli('auditer')
    ok(c.status !== 0 && c.stderr.length > 0, 'CLI auditer : sans cible → usage sur stderr')
    c = cli('inconnue')
    ok(c.status === 2 && c.stderr.length > 0, 'CLI : commande inconnue → usage, code 2')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

// 5. Stack detection: one temp folder per rule, via module and CLI.
{
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { spawnSync } = await import('node:child_process')
  let detecter = null
  try { ({ detecter } = await import('../outils/detecter.mjs')) } catch (e) { ok(false, 'détection : module chargeable — ' + e.message) }
  const racines = []
  const creer = (fichiers) => {
    const d = mkdtempSync(path.join(tmpdir(), 'seo-detect-')); racines.push(d)
    for (const [f, c] of Object.entries(fichiers)) { mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); writeFileSync(path.join(d, f), c) }
    return d
  }
  try {
    if (detecter) {
      let s = detecter(creer({
        'package.json': '{"dependencies":{"vue":"^3.4.0","vue-router":"^4.0.0"}}',
        'index.html': '<!DOCTYPE html><html lang="fr"><head><title>x</title></head><body><div id="app"></div></body></html>',
        'src/router/index.js': 'export default createRouter({ routes: [] })',
        'src/main.js': 'createApp(App).mount("#app")',
      }))
      ok(s.stack === 'vue-spa' && s.rendu === 'client', 'détection : vue + #app → vue-spa / client')
      ok(s.fichiersCles.includes('package.json') && s.fichiersCles.includes('index.html') && s.fichiersCles.includes('src/router/index.js'), 'détection : vue-spa fichiersCles (package.json, index.html, routeur)')
      ok(s.langues.includes('fr') && s.indices.some((i) => i.includes('vue')), 'détection : vue-spa langues et indices')
      s = detecter(creer({ 'package.json': '{"dependencies":{"vue":"^3"}}', 'index.html': '<div id="app"></div>', 'index.twig': '<html lang="fr"></html>' }))
      ok(s.stack === 'vue-spa', 'détection : règle 1 prioritaire sur twig')
      s = detecter(creer({ 'templates/base.html.twig': '<html lang="en"><head>{% block title %}{% endblock %}</head></html>', 'templates/page.html.twig': '{% extends "base.html.twig" %}', 'page.php': '<html></html>' }))
      ok(s.stack === 'twig' && s.rendu === 'serveur', 'détection : twig / serveur (prioritaire sur php)')
      ok(JSON.stringify(s.fichiersCles) === JSON.stringify([...s.fichiersCles].sort()) && s.fichiersCles.includes('templates/base.html.twig') && s.langues.includes('en'), 'détection : twig fichiersCles triés, langue en')
      s = detecter(creer({ 'index.php': '<?php include "inc/entete.php"; ?><body></body>', 'inc/entete.php': '<!DOCTYPE html><html lang="fr"><head><title>T</title></head>', 'lib.php': '<?php function f() {}' }))
      ok(s.stack === 'php' && s.rendu === 'serveur', 'détection : php / serveur')
      ok(s.fichiersCles.includes('inc/entete.php') && s.fichiersCles.includes('index.php') && !s.fichiersCles.includes('lib.php'), 'détection : php fichiersCles (en-tête inclus, pas la lib)')
      s = detecter(creer({ 'lib.php': '<?php function f() {}', 'index.html': '<html lang="fr"><head></head></html>' }))
      ok(s.stack === 'html-statique' && s.rendu === 'statique', 'détection : php sans HTML ignoré → html-statique / statique')
      s = detecter(creer({ 'index.html': '<html lang="fr"><head></head></html>', 'contact/index.html': '<html lang="fr"></html>' }))
      ok(s.stack === 'html-statique' && s.fichiersCles.includes('index.html'), 'détection : html-statique fichiersCles')
      s = detecter(creer({ 'main.go': 'package main' }))
      ok(s.stack === 'inconnue' && s.rendu === 'aucun' && s.fichiersCles.length === 0, 'détection : main.go seul → inconnue / aucun')
      s = detecter(creer({ 'node_modules/x/index.html': '<html></html>', 'vendor/a.twig': 'x', 'dist/index.html': '<html></html>' }))
      ok(s.stack === 'inconnue', 'détection : node_modules, vendor, dist ignorés → inconnue')
      s = detecter(creer({ 'package.json': '{"dependencies":{"vue":"^3"}}', 'index.html': '<body><div id="app"></div></body>', 'dist/index.html': '<html></html>' }))
      ok(!s.fichiersCles.some((f) => f.startsWith('dist/')), 'détection : dist non listé')
      ok(Object.keys(s).sort().join() === 'fichiersCles,indices,langues,rendu,stack', 'détection : forme du type Stack')
    }
    const cli = (...args) => spawnSync(process.execPath, [path.join(plugin, 'outils', 'seo.mjs'), ...args], { encoding: 'utf8' })
    const d = creer({ 'index.html': '<html lang="fr"></html>' })
    let c = cli('detecter', d), sortie = null
    try { sortie = JSON.parse(c.stdout) } catch { /* reported below */ }
    ok(c.status === 0 && sortie?.stack === 'html-statique', 'CLI detecter : JSON Stack, code 0')
    c = cli('detecter', path.join(d, 'inexistant'))
    ok(c.status !== 0 && c.stderr.trim().length > 0, 'CLI detecter : dossier inexistant → code ≠ 0, stderr')
    c = cli('detecter')
    ok(c.status !== 0 && c.stderr.length > 0, 'CLI detecter : sans dossier → usage')
    for (const s of ['html-statique', 'php', 'twig', 'vue-spa']) {
      const f = path.join(plugin, 'references', 'stacks', s + '.md')
      const t = existsSync(f) ? readFileSync(f, 'utf8') : ''
      const n = t.split('\n').length
      ok(n >= 40 && n <= 160, `référence ${s}.md : présente, taille raisonnable (${n} lignes)`)
    }
  } finally { for (const r of racines) rmSync(r, { recursive: true, force: true }) }
}

console.log(ko ? `\n${ko} KO` : '\ntout est ok')
process.exit(ko ? 1 : 0)
