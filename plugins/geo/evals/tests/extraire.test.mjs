import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extraire } from '../../outils/lib/extraire.mjs'

test('champs de base : title, entités, lang, canonical, robots, hreflang, og, hn, liens', () => {
  const f = extraire(`<!DOCTYPE html><html LANG="fr-FR"><head><title>Tom &amp; Jerry</title>
    <meta name="Description" content='Un "test" &amp; plus'>
    <link rel="canonical" href=https://ex.test/a>
    <meta name=robots content="noindex, follow">
    <link rel="alternate" hreflang="en" href="https://ex.test/en">
    <link rel="alternate" hreflang="x-default" href="/">
    <meta property="og:title" content="OG &amp; titre"><meta property="og:image" content="/i.png">
    </head><body><h1>Un <em>grand</em>   titre</h1><h2>Sous</h2><h1>Autre</h1>
    <a href="/x?a=1&amp;b=2">Lien <b>un</b></a><a href='/y'>Deux</a><a name="z">sans href</a></body></html>`, 'https://ex.test/a')
  assert.equal(f.url, 'https://ex.test/a')
  assert.equal(f.title, 'Tom & Jerry')
  assert.equal(f.description, 'Un "test" & plus')
  assert.equal(f.canonical, 'https://ex.test/a')
  assert.equal(f.robots, 'noindex, follow')
  assert.equal(f.lang, 'fr-FR')
  assert.deepEqual(f.hreflang, [{ lang: 'en', href: 'https://ex.test/en' }, { lang: 'x-default', href: '/' }])
  assert.deepEqual(f.og, { title: 'OG & titre', description: null, image: '/i.png' })
  assert.deepEqual(f.hn, [{ niveau: 1, texte: 'Un grand titre' }, { niveau: 2, texte: 'Sous' }, { niveau: 1, texte: 'Autre' }])
  assert.deepEqual(f.liens, [{ href: '/x?a=1&b=2', texte: 'Lien un' }, { href: '/y', texte: 'Deux' }])
})

test('champs absents : null, listes vides, nouveaux champs par défaut', () => {
  const f = extraire('<p>x</p>', 'u')
  assert.equal(f.title, null)
  assert.equal(f.description, null)
  assert.equal(f.viewport, null)
  assert.equal(f.auteur, null)
  assert.equal(f.ogSiteName, null)
  assert.deepEqual(f.dates, { publiee: null, modifiee: null })
  assert.equal(f.nosnippet, false)
  assert.deepEqual(f.rel, { prev: null, next: null })
  assert.deepEqual(f.hreflang, [])
  assert.deepEqual(f.jsonld, [])
})

test('images : alt absent distinct de alt vide', () => {
  const f = extraire('<img src="a.jpg"><img src="b.jpg" alt=""><img src="c.jpg" alt="Chat" width=10 height="20">', 'u')
  assert.equal(f.images[0].alt, null)
  assert.equal(f.images[0].width, null)
  assert.equal(f.images[1].alt, '')
  assert.deepEqual(f.images[2], { src: 'c.jpg', alt: 'Chat', width: '10', height: '20' })
})

test('JSON-LD : valide, invalide, paramètres de type', () => {
  const f = extraire('<script type="application/ld+json">{"@type": "Org"}</script><script type="application/ld+json">{"@type": "X",}</script><script>var a = 1</script>', 'u')
  assert.equal(f.jsonld.length, 2)
  assert.equal(f.jsonld[0].objet['@type'], 'Org')
  assert.equal(f.jsonld[0].erreur, null)
  assert.equal(f.jsonld[1].objet, null)
  assert.ok(f.jsonld[1].erreur.length > 0)
  assert.equal(extraire('<script type="Application/LD+JSON; charset=utf-8">{"a":1}</script>', 'u').jsonld[0].objet.a, 1)
})

test('mots et corpsVide : texte visible seulement, coquille SPA', () => {
  const f = extraire('<html><head><title>T</title><style>a b c d</style></head><body><p>un deux trois</p><script>x y z w</script><noscript>n1 n2</noscript><p>quatre</p></body></html>', 'u')
  assert.equal(f.mots, 4)
  assert.equal(f.corpsVide, true)
  const spa = extraire('<body><div id="app"></div><script src="x.js"></script></body>', 'u')
  assert.equal(spa.corpsVide, true)
  assert.equal(spa.montageSpa, true)
  assert.equal(extraire('<body><p>' + 'mot '.repeat(25) + '</p></body>', 'u').corpsVide, false)
})

test('HTML tronqué, title SVG, double décodage, entrées dégénérées', () => {
  assert.equal(extraire('<html><head><title>X', 'u').title, 'X')
  assert.equal(extraire('<html><head></head><body><svg><title>Icone</title></svg><p>x</p></body></html>', 'u').title, null)
  assert.equal(extraire('<title>A &amp;amp; B</title><p>x</p>', 'u').title, 'A &amp; B')
  for (const bad of ['', '<', '<a href="', '<!-- x', '<script>', '<h1>x', '<p data-nosnippet', '<div data-nosnippet><table><tr><td>', undefined, null, 42, {}]) {
    assert.doesNotThrow(() => extraire(bad, 'u'))
  }
  const v = extraire(undefined, undefined)
  assert.equal(v.url, null)
  assert.deepEqual(v.blocs, [])
})

test('viewport, og:site_name, rel prev/next', () => {
  const f = extraire(`<head><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta property="og:site_name" content="Atelier Fictif">
    <link rel="prev" href="/p1"><link rel="next" href="/p3"></head>`, 'u')
  assert.equal(f.viewport, 'width=device-width, initial-scale=1')
  assert.equal(f.ogSiteName, 'Atelier Fictif')
  assert.deepEqual(f.rel, { prev: '/p1', next: '/p3' })
})

test('auteur : meta, JSON-LD (objet, tableau, @graph), rel=author, priorité', () => {
  assert.equal(extraire('<meta name="author" content="Ada Exemple">', 'u').auteur, 'Ada Exemple')
  const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`
  assert.equal(extraire(ld({ '@type': 'Article', author: { '@type': 'Person', name: 'Bob Fictif' } }), 'u').auteur, 'Bob Fictif')
  assert.equal(extraire(ld({ '@type': 'Article', author: [{ name: 'Premier' }, { name: 'Second' }] }), 'u').auteur, 'Premier')
  assert.equal(extraire(ld({ '@type': 'Article', author: 'Chaîne Seule' }), 'u').auteur, 'Chaîne Seule')
  assert.equal(extraire(ld({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite' }, { '@type': 'Article', author: { name: 'Dans Graph' } }] }), 'u').auteur, 'Dans Graph')
  assert.equal(extraire('<p>Par <a rel="author" href="/a">Claire Test</a></p>', 'u').auteur, 'Claire Test')
  assert.equal(extraire('<meta name="author" content="Meta">' + ld({ author: { name: 'LD' } }), 'u').auteur, 'Meta')
  assert.equal(extraire(ld({ author: 42 }), 'u').auteur, null)
})

test('dates : meta, JSON-LD (dont @graph), premier time', () => {
  const m = extraire('<meta property="article:published_time" content="2025-01-02T10:00:00Z"><meta property="article:modified_time" content="2025-03-04">', 'u')
  assert.deepEqual(m.dates, { publiee: '2025-01-02T10:00:00Z', modifiee: '2025-03-04' })
  const j = extraire('<script type="application/ld+json">{"@type":"Article","datePublished":"2024-05-06","dateModified":"2024-07-08"}</script>', 'u')
  assert.deepEqual(j.dates, { publiee: '2024-05-06', modifiee: '2024-07-08' })
  const g = extraire('<script type="application/ld+json">{"@graph":[{"@type":"WebPage","dateModified":"2023-01-01"}]}</script>', 'u')
  assert.equal(g.dates.modifiee, '2023-01-01')
  assert.equal(g.dates.publiee, null)
  const t = extraire('<p>Publié le <time datetime="2022-02-02">2 février</time> <time datetime="2023-03-03">x</time></p>', 'u')
  assert.deepEqual(t.dates, { publiee: '2022-02-02', modifiee: null })
  const prio = extraire('<meta property="article:published_time" content="2025-01-01"><time datetime="2020-01-01">x</time>', 'u')
  assert.equal(prio.dates.publiee, '2025-01-01')
})

test('nosnippet : meta robots nosnippet ou max-snippet:0 seulement', () => {
  assert.equal(extraire('<meta name="robots" content="max-snippet:0">', 'u').nosnippet, true)
  assert.equal(extraire('<meta name="robots" content="index, NoSnippet">', 'u').nosnippet, true)
  assert.equal(extraire('<meta name="robots" content="max-snippet: 0">', 'u').nosnippet, true)
  assert.equal(extraire('<meta name="robots" content="max-snippet:160">', 'u').nosnippet, false)
  assert.equal(extraire('<meta name="robots" content="max-snippet:-1">', 'u').nosnippet, false)
  assert.equal(extraire('<meta name="robots" content="index,follow">', 'u').nosnippet, false)
})

test('blocs : h2 / p / ul(2 li) / table(2 tr) dans l\'ordre', () => {
  const f = extraire(`<body><h2>Les soins</h2><p>Un   paragraphe
    <b>clair</b>.</p><ul><li>Premier</li><li>Second <i>point</i></li></ul>
    <table><tr><th>Nom</th><th>Prix</th></tr><tr><td>Séance</td><td>50 €</td></tr></table></body>`, 'u')
  assert.deepEqual(f.blocs.map((b) => b.type), ['titre', 'paragraphe', 'liste', 'tableau'])
  assert.deepEqual(f.blocs[0], { type: 'titre', niveau: 2, texte: 'Les soins' })
  assert.equal(f.blocs[1].texte, 'Un paragraphe clair.')
  assert.equal(f.blocs[2].texte, 'Premier\nSecond point')
  assert.equal(f.blocs[3].texte, 'Nom | Prix\nSéance | 50 €')
  assert.ok(f.blocs.every((b) => b.nosnippet === undefined))
})

test('blocs : script, style, noscript, head exclus ; éléments ouverts sans fermeture', () => {
  const f = extraire('<head><title>T</title></head><body><script>var x</script><style>p{}</style><noscript>nope</noscript><p>un<p>deux<ul><li>a<li>b</ul></body>', 'u')
  assert.deepEqual(f.blocs.map((b) => [b.type, b.texte]), [['paragraphe', 'un'], ['paragraphe', 'deux'], ['liste', 'a\nb']])
})

test('blocs : définitions dl/dt/dd', () => {
  const f = extraire('<dl><dt>GEO</dt><dd>Optimisation pour moteurs génératifs</dd><dt>SEO</dt><dd>Référencement</dd></dl>', 'u')
  assert.equal(f.blocs.length, 1)
  assert.equal(f.blocs[0].type, 'definition')
  assert.equal(f.blocs[0].texte, 'GEO\nOptimisation pour moteurs génératifs\nSEO\nRéférencement')
})

test('blocs : table dans un li, liste dans un li', () => {
  const f = extraire('<ul><li>Avant<table><tr><td>A</td><td>B</td></tr></table>Après</li><li>Suite<ul><li>Sous</li></ul></li></ul><p>Fin</p>', 'u')
  assert.ok(f.blocs.some((b) => b.type === 'tableau' && b.texte === 'A | B'))
  assert.ok(f.blocs.some((b) => b.type === 'liste' && b.texte === 'Sous'))
  const liste = f.blocs.find((b) => b.type === 'liste' && b.texte.includes('Avant'))
  assert.ok(liste.texte.includes('Après'))
  assert.ok(liste.texte.includes('Suite'))
  assert.ok(liste.texte.includes('Avant Après'))
  assert.ok(!liste.texte.includes('A | B'))
  assert.equal(f.blocs.at(-1).texte, 'Fin')
})

test('blocs : data-nosnippet marque les blocs, y compris imbriqué', () => {
  const f = extraire('<p>Public</p><div data-nosnippet>Texte direct</div><div data-nosnippet><div><p>Imbriqué</p></div><p>Encore</p></div><p>Après</p>', 'u')
  assert.deepEqual(f.blocs.map((b) => [b.texte, b.nosnippet === true]), [
    ['Public', false], ['Texte direct', true], ['Imbriqué', true], ['Encore', true], ['Après', false],
  ])
  const g = extraire('<div data-nosnippet><div data-nosnippet>a</div>b</div>c', 'u')
  assert.deepEqual(g.blocs.map((b) => [b.texte, b.nosnippet === true]), [['a', true], ['b', true], ['c', false]])
  const h = extraire('<span data-nosnippet>caché</span><p>visible</p>', 'u')
  assert.equal(h.blocs.find((b) => b.texte === 'visible').nosnippet, undefined)
})

test('blocs : titre avec niveau, attributs malformés tolérés', () => {
  const f = extraire('<h3 class="a>b" id=x>Titre <span>long</span></h3><p>Suite</p>', 'u')
  assert.equal(f.blocs[0].niveau, 3)
  assert.equal(f.blocs[0].texte, 'Titre long')
  assert.doesNotThrow(() => extraire('<p a="1" a="2" =x "y" data-nosnippet=>t</p><h2 <b>x', 'u'))
})

test('data-nosnippet sur un élément à balise de fin optionnelle : la région se ferme', () => {
  const p = extraire('<p data-nosnippet>x<p>y<p>z', 'u')
  assert.deepEqual(p.blocs.map((b) => [b.texte, b.nosnippet === true]), [['x', true], ['y', false], ['z', false]])
  const li = extraire('<ul><li data-nosnippet>x<li>y<li>z</ul><p>after</p>', 'u')
  assert.deepEqual(li.blocs.map((b) => [b.type, b.texte, b.nosnippet === true]), [
    ['liste', 'y\nz', false], ['paragraphe', 'x', true], ['paragraphe', 'after', false],
  ])
  const td = extraire('<table><tr><td data-nosnippet>a<td>b</table><p>c</p>', 'u')
  assert.deepEqual(td.blocs.map((b) => [b.texte, b.nosnippet === true]), [['b', false], ['a', true], ['c', false]])
  const dd = extraire('<dl><dt data-nosnippet>t<dd>d</dl><p>e</p>', 'u')
  assert.equal(dd.blocs.at(-1).nosnippet, undefined)
  // A nested list inside a flagged item keeps the region open.
  const nested = extraire('<ul><li data-nosnippet>x<ul><li>inner</li></ul></li><li>y</li></ul>', 'u')
  assert.equal(nested.blocs.find((b) => b.texte === 'inner').nosnippet, true)
  assert.equal(nested.blocs.find((b) => b.texte === 'y').nosnippet, undefined)
})

test('blocs : <p> dans un li ou une cellule garde la structure liste / tableau', () => {
  const l = extraire('<ul><li><p>Un</p></li><li><p>Deux</p></li></ul>', 'u')
  assert.deepEqual(l.blocs, [{ type: 'liste', texte: 'Un\nDeux' }])
  const t = extraire('<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>', 'u')
  assert.deepEqual(t.blocs, [{ type: 'tableau', texte: 'A | B' }])
  const m = extraire('<ul><li><p>Un</p><p>bis</p></li></ul>', 'u')
  assert.deepEqual(m.blocs, [{ type: 'liste', texte: 'Un bis' }])
})
