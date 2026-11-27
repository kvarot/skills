import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { estAdresseInterdite, hotesAutorises, creerClient } from '../../outils/lib/reseau.mjs'

const traces = []
const serveur = http.createServer((req, res) => {
  traces.push({ url: req.url, t: Date.now() })
  const u = req.url
  if (u.startsWith('/ok')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<html>bonjour</html>') }
  else if (u === '/ua') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(String(req.headers['user-agent'])) }
  else if (u.startsWith('/boucle/')) {
    const n = Number(u.slice(8))
    res.writeHead(302, { location: '/boucle/' + (n + 1) }); res.end()
  }
  else if (u === '/gros') { res.writeHead(200, { 'content-type': 'text/html', 'content-length': 6 * 1024 * 1024 }); res.end(Buffer.alloc(6 * 1024 * 1024, 97)) }
  else if (u === '/gros-chunked') {
    res.writeHead(200, { 'content-type': 'text/html' })
    const bloc = Buffer.alloc(1024 * 1024, 97)
    for (let i = 0; i < 6; i++) res.write(bloc)
    res.end()
  }
  else if (u === '/bin') { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(Buffer.from([1, 2, 3])) }
  else if (u === '/latin') { res.writeHead(200, { 'content-type': 'text/html; charset=windows-1252' }); res.end(Buffer.from('<p>caf\xe9</p>', 'latin1')) }
  else if (u === '/meta') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(Buffer.from('<meta charset="windows-1252"><p>caf\xe9</p>', 'latin1')) }
  else if (u === '/coupe') { req.socket.destroy() }
  else if (u === '/403') { res.writeHead(403, { 'content-type': 'text/html' }); res.end('<title>Just a moment...</title>') }
  else { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('absent') }
})
await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${serveur.address().port}`
const hotes = new Set(['127.0.0.1'])
const client = (extra = {}) => creerClient({ hotes, autoriserLocal: true, delaiMs: 0, ...extra })
// Minimal injectable transport answer.
const rep = (status, entetes = {}, corps = '') => ({ status, headers: new Headers(entetes), body: Readable.from(corps ? [Buffer.from(corps)] : []), cancel() {} })
const publique = async () => [{ address: '93.184.216.34', family: 4 }]
after(() => { serveur.closeAllConnections?.(); serveur.close() })

test('estAdresseInterdite : privées, bouclage, lien-local, mappées IPv4', () => {
  for (const ip of ['10.0.0.1', '172.16.5.4', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a00:1', '64:ff9b::7f00:1', '::', 'pas-une-ip'])
    assert.equal(estAdresseInterdite(ip), true, ip)
  for (const ip of ['93.184.216.34', '2606:4700::1', '172.32.0.1', '::ffff:93.184.216.34'])
    assert.equal(estAdresseInterdite(ip), false, ip)
})

test('hotesAutorises : lit session.json et ajoute les hôtes passés', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'geo-res-'))
  try {
    assert.deepEqual([...hotesAutorises(d, ['Extra.test'])], ['extra.test'])
    writeFileSync(path.join(d, 'session.json'), JSON.stringify({ hotes_autorises: ['Site.test'] }))
    assert.deepEqual([...hotesAutorises(d, ['extra.test'])].sort(), ['extra.test', 'site.test'])
    writeFileSync(path.join(d, 'session.json'), '{cassé')
    assert.deepEqual([...hotesAutorises(d, [])], [])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('réponse simple, agent utilisateur par défaut', async () => {
  const c = client()
  const r = await c.demander(base + '/ok')
  assert.equal(r.statut, 200); assert.equal(r.corps, '<html>bonjour</html>'); assert.equal(r.depuisCache, false)
  const ua = await c.demander(base + '/ua')
  assert.match(ua.corps, /^geo-audit\/0\.1 \(\+https:\/\/github\.com\/kvarot\/skills\)$/)
})

test('hôte non autorisé : ErreurGeo code 3 citant l hôte', async () => {
  const c = creerClient({ hotes: new Set(['autre.test']), autoriserLocal: true, delaiMs: 0 })
  await assert.rejects(c.demander(base + '/ok'), (e) => e.code === 3 && e.message.includes('127.0.0.1'))
})

test('redirection interne : refusée, second hôte jamais contacté', async () => {
  const appels = []
  const transport = async (url) => {
    appels.push(String(url))
    if (url.hostname === 'site.test') return rep(302, { location: 'http://interne.test/' })
    throw new Error('ne devrait pas être contacté')
  }
  const resolveur = async (h) => [{ address: h === 'site.test' ? '93.184.216.34' : '169.254.169.254', family: 4 }]
  const c = creerClient({ hotes: new Set(['site.test', 'interne.test']), delaiMs: 0, resolveur, transport })
  const r = await c.demander('http://site.test/')
  assert.equal(r.statut, 0); assert.match(r.raison, /adresse interdite/)
  assert.deepEqual(appels, ['http://site.test/'])
})

test('DNS à plusieurs adresses : refusé si une seule est interdite', async () => {
  const resolveur = async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]
  const c = creerClient({ hotes: new Set(['multi.test']), delaiMs: 0, resolveur, transport: async () => { throw new Error('contacté') } })
  const r = await c.demander('http://multi.test/')
  assert.equal(r.statut, 0); assert.match(r.raison, /adresse interdite/)
})

test('sans autoriserLocal, le bouclage est refusé sans requête', async () => {
  const avant = traces.length
  const r = await creerClient({ hotes, delaiMs: 0 }).demander(base + '/ok')
  assert.equal(r.statut, 0); assert.match(r.raison, /adresse interdite/)
  assert.equal(traces.length, avant)
})

test('protocole non http : refusé sans exception', async () => {
  const r = await client().demander('file:///etc/passwd')
  assert.equal(r.statut, 0); assert.match(r.raison, /protocole/)
})

test('redirections : 11 sauts refusés, limite configurable', async () => {
  const r = await client().demander(base + '/boucle/0')
  assert.equal(r.statut, 0); assert.match(r.raison, /redirections/)
  const court = await client({ maxRedirections: 3 }).demander(base + '/boucle/0')
  assert.equal(court.statut, 0); assert.match(court.raison, /redirections/)
  assert.equal(court.redirections.length, 3)
})

test('redirection suivie vers une page finale', async () => {
  const transport = async (url) => url.pathname === '/a' ? rep(301, { location: '/b' }) : rep(200, { 'content-type': 'text/html' }, 'fin')
  const c = creerClient({ hotes: new Set(['site.test']), delaiMs: 0, resolveur: publique, transport })
  const r = await c.demander('http://site.test/a')
  assert.equal(r.statut, 200); assert.equal(r.url, 'http://site.test/b'); assert.deepEqual(r.redirections, ['http://site.test/b'])
})

test('redirection vers un hôte non autorisé : refusée', async () => {
  const transport = async () => rep(302, { location: 'http://autre.test/' })
  const c = creerClient({ hotes: new Set(['site.test']), delaiMs: 0, resolveur: publique, transport })
  const r = await c.demander('http://site.test/')
  assert.equal(r.statut, 0); assert.match(r.raison, /autre\.test/)
})

test('corps de 6 Mo : refusé (Content-Length et flux)', async () => {
  for (const chemin of ['/gros', '/gros-chunked']) {
    const r = await client().demander(base + chemin)
    assert.equal(r.corps, null, chemin); assert.match(r.raison, /5 Mo/, chemin)
  }
})

test('type de contenu inattendu, 404 et page de défi lisibles', async () => {
  const r = await client().demander(base + '/bin')
  assert.equal(r.corps, null); assert.match(r.raison, /type de contenu/)
  const permissif = await client().demander(base + '/bin', { accept: '*/*' })
  assert.equal(permissif.statut, 200)
  const nf = await client().demander(base + '/nulle')
  assert.equal(nf.statut, 404); assert.equal(nf.corps, 'absent')
  const waf = await client().demander(base + '/403')
  assert.equal(waf.statut, 403); assert.match(waf.corps, /Just a moment/)
})

test('décodage windows-1252 (en-tête et meta)', async () => {
  assert.equal((await client().demander(base + '/latin')).corps, '<p>café</p>')
  assert.equal((await client().demander(base + '/meta')).corps, '<meta charset="windows-1252"><p>café</p>')
})

test('politesse : écart ≥ delaiMs entre deux requêtes au même hôte', async () => {
  const c = client({ delaiMs: 200 })
  const avant = traces.length
  await Promise.all([c.demander(base + '/ok?1'), c.demander(base + '/ok?2')])
  const [a, b] = traces.slice(avant)
  assert.ok(b.t - a.t >= 195, `écart ${b.t - a.t} ms`)
})

test('connexion coupée : statut 0, pas d exception', async () => {
  const r = await client().demander(base + '/coupe')
  assert.equal(r.statut, 0); assert.ok(r.raison)
})

test('délai dépassé : statut 0', async () => {
  const lent = http.createServer(() => {})
  await new Promise((r) => lent.listen(0, '127.0.0.1', r))
  try {
    const r = await client({ timeoutMs: 100 }).demander(`http://127.0.0.1:${lent.address().port}/`)
    assert.equal(r.statut, 0); assert.match(r.raison, /délai/)
  } finally { lent.closeAllConnections(); lent.close() }
})

test('cache : deuxième appel depuisCache, serveur non rappelé ; expiration ; erreurs non cachées', async () => {
  const d = mkdtempSync(path.join(tmpdir(), 'geo-cache-'))
  try {
    const c = client({ cache: d })
    const avant = traces.length
    const r1 = await c.demander(base + '/ok?cache')
    const r2 = await c.demander(base + '/ok?cache')
    assert.equal(r1.depuisCache, false); assert.equal(r2.depuisCache, true)
    assert.equal(r2.corps, r1.corps)
    assert.equal(traces.length - avant, 1)
    const perime = await client({ cache: d, maxAgeMs: -1 }).demander(base + '/ok?cache')
    assert.equal(perime.depuisCache, false)
    await c.demander(base + '/nulle?cache')
    assert.equal((await c.demander(base + '/nulle?cache')).depuisCache, false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('cache : type de contenu et mode local re-vérifiés (clé par accept et autoriserLocal)', async () => {
  const d = mkdtempSync(path.join(tmpdir(), 'geo-cache-'))
  try {
    const large = await client({ cache: d }).demander(base + '/bin', { accept: '*/*' })
    assert.equal(large.statut, 200)
    const html = await client({ cache: d }).demander(base + '/bin')
    assert.equal(html.corps, null); assert.match(html.raison, /type de contenu/); assert.equal(html.depuisCache, false)
    await client({ cache: d }).demander(base + '/ok?local')
    const avant = traces.length
    const sans = await creerClient({ hotes, delaiMs: 0, cache: d }).demander(base + '/ok?local')
    assert.equal(sans.statut, 0); assert.match(sans.raison, /adresse interdite/)
    assert.equal(traces.length, avant)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('anti-rebinding : la connexion va à l adresse vérifiée, sans seconde résolution', async () => {
  let appels = 0
  const resolveur = async () => [{ address: ++appels === 1 ? '127.0.0.1' : '203.0.113.9', family: 4 }]
  const r = await creerClient({ hotes: new Set(['rebind.test']), autoriserLocal: true, delaiMs: 0, resolveur })
    .demander(`http://rebind.test:${serveur.address().port}/ok`)
  assert.equal(r.statut, 200); assert.equal(r.corps, '<html>bonjour</html>'); assert.equal(appels, 1)
})

test('anti-rebinding : le lookup passé au transport rend l adresse vérifiée', async () => {
  let lookup
  const transport = async (_url, opts) => { lookup = opts.adresse; return rep(200, { 'content-type': 'text/html' }, 'x') }
  let n = 0
  const resolveur = async () => [{ address: ++n === 1 ? '93.184.216.34' : '10.0.0.1', family: 4 }]
  await creerClient({ hotes: new Set(['site.test']), delaiMs: 0, resolveur, transport }).demander('http://site.test/')
  assert.deepEqual(lookup, { address: '93.184.216.34', family: 4 })
})

test('réponse gzip décodée', async () => {
  const { gzipSync } = await import('node:zlib')
  const s2 = http.createServer((q, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); res.end(gzipSync('compressé')) })
  await new Promise((r) => s2.listen(0, '127.0.0.1', r))
  try { assert.equal((await client().demander(`http://127.0.0.1:${s2.address().port}/`)).corps, 'compressé') } finally { s2.closeAllConnections(); s2.close() }
})

const v6 = await new Promise((resolve) => {
  const t = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('v6') })
  t.once('error', () => resolve(null))
  t.listen(0, '::1', () => resolve(t))
})
after(() => { v6?.closeAllConnections?.(); v6?.close() })

test('littéral IPv6 : autorisé en local, refusé sinon', { skip: v6 ? false : 'pas de bouclage IPv6 (::1) sur cette machine' }, async () => {
  const url = `http://[::1]:${v6.address().port}/`
  const ok = await creerClient({ hotes: new Set(['::1']), autoriserLocal: true, delaiMs: 0 }).demander(url)
  assert.equal(ok.statut, 200); assert.equal(ok.corps, 'v6')
  const non = await creerClient({ hotes: new Set(['::1']), delaiMs: 0 }).demander(url)
  assert.equal(non.statut, 0); assert.match(non.raison, /adresse interdite/)
})

test('hotesAutorises : un littéral IPv6 entre crochets est normalisé', () => {
  const d = mkdtempSync(path.join(tmpdir(), 'geo-res-'))
  try {
    writeFileSync(path.join(d, 'session.json'), JSON.stringify({ hotes_autorises: ['[::1]'] }))
    assert.deepEqual([...hotesAutorises(d, ['[::2]'])].sort(), ['::1', '::2'])
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('suivre: false renvoie la 3xx sans la suivre', async () => {
  const vus = []
  const s = http.createServer((req, res) => {
    vus.push(req.url)
    if (req.url === '/a') { res.writeHead(302, { location: '/b' }); res.end() } else { res.writeHead(200, { 'content-type': 'text/html' }); res.end('b') }
  })
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  try {
    const u = `http://127.0.0.1:${s.address().port}`
    const r = await client().demander(u + '/a', { suivre: false })
    assert.equal(r.statut, 302)
    assert.equal(r.entetes.location, '/b')
    assert.deepEqual(vus, ['/a'])
    await assert.rejects(creerClient({ hotes: new Set(['autre.example']), delaiMs: 0 }).demander(u + '/a', { suivre: false }), { code: 3 })
  } finally { s.closeAllConnections?.(); s.close() }
})
