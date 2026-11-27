import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { creerClient } from '../../outils/lib/reseau.mjs'
import { collecterUrl, collecterDossier } from '../../outils/lib/collecter.mjs'

const serveurs = []
const compteur = new Map()
// Starts a fictitious site; `routes` maps a path to (req, res, base) => void.
async function site(routes) {
  const srv = http.createServer((req, res) => {
    const chemin = req.url.split('?')[0]
    compteur.set(srv.base + chemin, (compteur.get(srv.base + chemin) ?? 0) + 1)
    const h = routes[chemin]
    if (h) return h(req, res, srv.base)
    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('absent')
  })
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  srv.base = `http://127.0.0.1:${srv.address().port}`
  serveurs.push(srv)
  return srv
}
after(() => { for (const s of serveurs) { s.closeAllConnections?.(); s.close() } })

const client = () => creerClient({ hotes: new Set(['127.0.0.1']), autoriserLocal: true, delaiMs: 0 })
const lorem = 'Le cabinet Exemple Atelier propose des conseils clairs et détaillés pour les artisans de la région, avec un accompagnement personnalisé à chaque étape du projet.'
const html = (titre, liens = [], extra = '') => (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<html><head><title>${titre}</title></head><body><h1>${titre}</h1><p>${lorem}</p>${liens.map((l) => `<a href="${l}">lien</a>`).join('')}${extra}</body></html>`)
}
const xmlAvec = (fabrique, ctype = 'application/xml') => (_q, res, b) => { res.writeHead(200, { 'content-type': ctype }); res.end(fabrique(b)) }
const texte = (corps, statut = 200) => (_req, res) => { res.writeHead(statut, { 'content-type': 'text/plain' }); res.end(corps) }
const chemins = (c) => c.pages.map((p) => new URL(p.url).pathname)

test('site de 3 pages, index de sitemaps, profondeurs 0,1,2', async () => {
  const s = await site({
    '/': html('Accueil', ['/a?utm_source=1#haut', '/a']),
    '/a': html('Page A', ['/b', 'https://autre.example/x', 'mailto:x@y.example']),
    '/b': html('Page B', ['/']),
    '/robots.txt': (_q, res, b) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`User-agent: *\nDisallow:\nSitemap: ${b}/index.xml\n`) },
    '/index.xml': xmlAvec((b) => `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${b}/s1.xml</loc></sitemap><sitemap><loc><![CDATA[${b}/s2.xml]]></loc></sitemap></sitemapindex>`),
    '/s1.xml': xmlAvec((b) => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${b}/</loc></url><url><loc>${b}/a</loc></url></urlset>`),
    '/s2.xml': xmlAvec((b) => `<ns:urlset xmlns:ns="http://www.sitemaps.org/schemas/sitemap/0.9"><ns:url><ns:loc> ${b}/b </ns:loc></ns:url></ns:urlset>`, 'text/xml'),
  })
  const c = await collecterUrl(s.base + '/', { client: client() })
  assert.deepEqual(c.pages.map((p) => [new URL(p.url).pathname, p.profondeur]), [['/', 0], ['/a', 1], ['/b', 2]])
  assert.equal(compteur.get(s.base + '/a'), 1, 'normalised duplicates fetched once')
  const urls = c.site.sitemaps.flatMap((m) => m.urls).sort()
  assert.deepEqual(urls, [s.base + '/', s.base + '/a', s.base + '/b'])
  assert.equal(c.site.sitemaps.length, 3) // index + 2 children
  assert.equal(c.site.waf, null)
  assert.equal(c.pages[0].statut, 200)
  assert.match(c.pages[0].empreinte_texte, /^[0-9a-f]{64}$/)
  assert.equal(c.pages[0].entetes.content_type, 'text/html; charset=utf-8')
  assert.equal(c.exploration.limite_atteinte, false)
})

test('sitemap par défaut /sitemap.xml et index imbriqué limité à 2 niveaux', async () => {
  const idx = (p) => (b) => `<sitemapindex><sitemap><loc>${b}${p}</loc></sitemap></sitemapindex>`
  const s = await site({
    '/': html('Accueil'),
    '/sitemap.xml': xmlAvec(idx('/n1.xml')),
    '/n1.xml': xmlAvec(idx('/n2.xml')),
    '/n2.xml': xmlAvec(idx('/n3.xml')),
    '/n3.xml': xmlAvec((b) => `<urlset><url><loc>${b}/x</loc></url></urlset>`),
  })
  await collecterUrl(s.base + '/', { client: client() })
  assert.equal(compteur.get(s.base + '/sitemap.xml'), 1)
  assert.equal(compteur.get(s.base + '/n1.xml'), 1)
  assert.equal(compteur.get(s.base + '/n3.xml'), undefined, 'third nesting level not fetched')
})

test('sitemap : plafond de 50 000 URL', async () => {
  const s = await site({
    '/': html('Accueil'),
    '/sitemap.xml': xmlAvec((b) => {
      let o = '<urlset>'
      for (let i = 0; i < 50500; i++) o += `<url><loc>${b}/p${i}</loc></url>`
      return o + '</urlset>'
    }),
  })
  const c = await collecterUrl(s.base + '/', { client: client() })
  assert.equal(c.site.sitemaps.reduce((n, m) => n + m.urls.length, 0), 50000)
})

test('défi WAF : page de départ 503 cf-mitigated', async () => {
  const s = await site({
    '/': (_q, res) => { res.writeHead(503, { 'content-type': 'text/html', 'cf-mitigated': 'challenge', server: 'cloudflare' }); res.end('<html><head><title>Just a moment...</title></head><body><script src="/cdn-cgi/challenge-platform/x.js"></script></body></html>') },
  })
  const c = await collecterUrl(s.base + '/', { client: client() })
  assert.equal(c.site.waf.detecte, true)
  assert.equal(c.site.waf.preuve.statut, 503)
  assert.equal(c.site.waf.preuve.url, s.base + '/')
  assert.ok(c.site.waf.preuve.detail)
  assert.equal(c.pages.length, 0)
})

test('défi WAF : 403 cloudflare + titre, marqueur captcha, et 403 simple non WAF', async () => {
  const a = await site({ '/': (_q, res) => { res.writeHead(403, { 'content-type': 'text/html', server: 'cloudflare' }); res.end('<title>Just a moment...</title>') } })
  assert.equal((await collecterUrl(a.base + '/', { client: client() })).site.waf.detecte, true)
  const b = await site({ '/': (_q, res) => { res.writeHead(429, { 'content-type': 'text/html' }); res.end('<div class="g-recaptcha captcha"></div>') } })
  assert.equal((await collecterUrl(b.base + '/', { client: client() })).site.waf.detecte, true)
  const c = await site({ '/': (_q, res) => { res.writeHead(403, { 'content-type': 'text/html' }); res.end('<title>Interdit</title>') } })
  const r = await collecterUrl(c.base + '/', { client: client() })
  assert.equal(r.site.waf, null)
  assert.equal(r.pages.length, 0)
  assert.ok(r.erreurs.length >= 1)
})

test('robots.txt : Disallow /admin jamais demandé, listé dans erreurs', async () => {
  const s = await site({
    '/': html('Accueil', ['/admin', '/admin/x', '/ok']),
    '/ok': html('Ok'),
    '/admin': html('Admin'),
    '/admin/x': html('Admin x'),
    '/robots.txt': texte('User-agent: *\nDisallow: /admin\n'),
  })
  const c = await collecterUrl(s.base + '/', { client: client() })
  assert.equal(compteur.get(s.base + '/admin'), undefined)
  assert.equal(compteur.get(s.base + '/admin/x'), undefined)
  assert.ok(c.erreurs.some((e) => e.url === s.base + '/admin' && /robots/i.test(e.raison)))
  assert.equal(c.pages.length, 2)
})

test('robots.txt : le groupe geo-audit l\'emporte sur *', async () => {
  const s = await site({
    '/': html('Accueil', ['/prive', '/pub']),
    '/pub': html('Pub'), '/prive': html('Prive'),
    '/robots.txt': texte('User-agent: *\nDisallow: /pub\n\nUser-agent: geo-audit\nDisallow: /prive\n'),
  })
  const c = await collecterUrl(s.base + '/', { client: client() })
  assert.deepEqual(chemins(c).sort(), ['/', '/pub'])
})

test('robots.txt : 404 autorise tout, 5xx interdit tout (erreur listée)', async () => {
  const a = await site({ '/': html('Accueil', ['/a']), '/a': html('A') })
  assert.equal((await collecterUrl(a.base + '/', { client: client() })).pages.length, 2)
  const b = await site({ '/': html('Accueil', ['/a']), '/a': html('A'), '/robots.txt': texte('boom', 503) })
  const r = await collecterUrl(b.base + '/', { client: client() })
  assert.equal(r.pages.length, 0)
  assert.ok(r.erreurs.some((e) => /robots/i.test(e.raison)))
  assert.equal(compteur.get(b.base + '/'), undefined, 'start page not fetched when robots says disallow-all')
})

test('robots.txt : un sitemap interdit n\'est pas demandé', async () => {
  const s = await site({
    '/': html('Accueil'),
    '/robots.txt': texte('User-agent: *\nDisallow: /sitemap.xml\n'),
    '/sitemap.xml': xmlAvec(() => '<urlset><url><loc>http://127.0.0.1/z</loc></url></urlset>'),
  })
  const c = await collecterUrl(s.base + '/', { client: client() })
  assert.equal(compteur.get(s.base + '/sitemap.xml'), undefined)
  assert.ok(c.erreurs.some((e) => e.url === s.base + '/sitemap.xml'))
})

test('llms.txt : présence et statut seulement', async () => {
  const a = await site({ '/': html('Accueil'), '/llms.txt': texte('# Exemple\n'), '/llms-full.txt': texte('', 404) })
  const c = await collecterUrl(a.base + '/', { client: client() })
  assert.equal(c.site.llmsTxt.present, true)
  assert.equal(c.site.llmsTxt.statut, 200)
  assert.equal(c.site.llmsFullTxt.present, false)
  assert.equal(c.site.llmsFullTxt.statut, 404)
  assert.equal(JSON.stringify(c).includes('# Exemple'), false, 'content not stored')
  const b = await site({ '/': html('Accueil') })
  assert.equal((await collecterUrl(b.base + '/', { client: client() })).site.llmsTxt.present, false)
})

test('text/plain, connexion coupée, redirection hors hôte : erreurs listées, collecte continue', async () => {
  const s = await site({
    '/': html('Accueil', ['/txt', '/coupe', '/ailleurs', '/fin']),
    '/txt': texte('juste du texte'),
    '/coupe': (req) => req.socket.destroy(),
    '/ailleurs': (_q, res) => { res.writeHead(302, { location: 'http://autre.example/' }); res.end() },
    '/fin': html('Fin'),
  })
  const c = await collecterUrl(s.base + '/', { client: client() })
  assert.deepEqual(chemins(c).sort(), ['/', '/fin'])
  for (const p of ['/txt', '/coupe', '/ailleurs']) assert.ok(c.erreurs.some((e) => e.url === s.base + p), p)
})

test('maxPages: 2 → limite_atteinte', async () => {
  const s = await site({ '/': html('Accueil', ['/a', '/b']), '/a': html('A'), '/b': html('B') })
  const c = await collecterUrl(s.base + '/', { client: client(), maxPages: 2 })
  assert.equal(c.pages.length, 2)
  assert.equal(c.exploration.limite_atteinte, true)
  assert.equal(c.exploration.pages, 2)
})

test('redirection interne : la page porte l\'URL finale et la chaîne', async () => {
  const s = await site({
    '/': html('Accueil', ['/ancien']),
    '/ancien': (_q, res) => { res.writeHead(301, { location: '/nouveau' }); res.end() },
    '/nouveau': html('Nouveau'),
  })
  const c = await collecterUrl(s.base + '/', { client: client() })
  const p = c.pages.find((x) => x.url.endsWith('/nouveau'))
  assert.ok(p)
  assert.equal(p.redirections.length, 1)
})

test('page 404 : erreur listée, pas de page', async () => {
  const s = await site({ '/': html('Accueil', ['/absente']) })
  const c = await collecterUrl(s.base + '/', { client: client() })
  assert.equal(c.pages.length, 1)
  assert.ok(c.erreurs.some((e) => e.url === s.base + '/absente' && /404/.test(e.raison)))
})

test('collecterDossier : pages .html d\'un dossier statique', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'geo-dossier-'))
  try {
    mkdirSync(path.join(d, 'blog'))
    writeFileSync(path.join(d, 'index.html'), `<title>Accueil</title><p>${lorem}</p>`)
    writeFileSync(path.join(d, 'blog', 'index.html'), `<title>Blog</title><p>${lorem}</p>`)
    writeFileSync(path.join(d, 'robots.txt'), 'User-agent: *\n')
    const c = collecterDossier(d)
    assert.deepEqual(c.pages.map((p) => p.url), ['/', '/blog/'])
    assert.equal(c.pages[0].profondeur, 0)
    assert.match(c.pages[0].empreinte_texte, /^[0-9a-f]{64}$/)
    assert.equal(c.site.robotsTxt, 'User-agent: *\n')
    assert.equal(c.site.waf, null)
    assert.equal(c.exploration.limite_atteinte, false)
    assert.throws(() => collecterDossier(path.join(d, 'nope')))
  } finally { rmSync(d, { recursive: true, force: true }) }
})
