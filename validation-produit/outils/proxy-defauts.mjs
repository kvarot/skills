// Local reverse proxy that seeds known defects into a product under test,
// without touching the product's code. Node only, no dependency.
//
//   node proxy-defauts.mjs <listen-port> <target-origin> [defects.json]
//
// defects.json (all optional):
// {
//   "masquer":   [{ "chemin": "^/api/", "contient": "ID-123" }],      // drop array items whose JSON contains this text
//   "remplacer": [{ "chemin": "\\.js$", "de": "Old label", "vers": "New label" }],
//   "fauxSucces":[{ "methode": "POST", "chemin": "^/api/v1/x/[^/]+/decision", "corps": "relire-puis-modifier" }]
// }
// fauxSucces answers 200 without forwarding. "corps": "relire-puis-modifier" GETs the same
// path minus its last segment and returns it with status "decided" and a fake decision.
// Without a defects file the proxy forwards everything unchanged (clean passage).
import http from 'node:http'
import { readFileSync } from 'node:fs'

const [port, target, file] = process.argv.slice(2)
if (!port || !target) {
  console.error('usage: node proxy-defauts.mjs <port> <target-origin> [defects.json]')
  process.exit(2)
}
const d = file ? JSON.parse(readFileSync(file, 'utf8')) : {}
const masquer = (d.masquer || []).map((r) => ({ re: new RegExp(r.chemin), txt: r.contient }))
const remplacer = (d.remplacer || []).map((r) => ({ re: new RegExp(r.chemin), de: r.de, vers: r.vers }))
const faux = (d.fauxSucces || []).map((r) => ({ m: r.methode, re: new RegExp(r.chemin), corps: r.corps }))
const hits = { masquer: 0, remplacer: 0, fauxSucces: 0 }

function prune(v, txt) {
  if (Array.isArray(v)) {
    const out = []
    for (const x of v) {
      if (x && typeof x === 'object' && JSON.stringify(x).includes(txt)) { hits.masquer++; continue }
      out.push(prune(x, txt))
    }
    return out
  }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) v[k] = prune(v[k], txt)
  }
  return v
}

function forward(req, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(req.url, target)
    const headers = { ...req.headers, host: u.host, 'accept-encoding': 'identity' }
    // The product sees itself, not the proxy (same-origin checks stay meaningful).
    if (headers.origin) headers.origin = u.origin
    if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, u.origin)
    const r = http.request(u, { method: req.method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    r.on('error', reject)
    if (body.length) r.write(body)
    r.end()
  })
}

http.createServer(async (req, res) => {
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = Buffer.concat(chunks)
    const path = new URL(req.url, target).pathname

    const f = faux.find((x) => x.m === req.method && x.re.test(path))
    if (f) {
      hits.fauxSucces++
      let out = { ok: true }
      if (f.corps === 'relire-puis-modifier') {
        const parent = req.url.replace(/\/[^/?]+(\?|$)/, '$1')
        const h = { ...req.headers }
        delete h['content-length']
        delete h['content-type']
        const got = await forward({ method: 'GET', url: parent, headers: h }, Buffer.alloc(0))
        out = JSON.parse(got.body.toString('utf8'))
        let asked = {}
        try { asked = JSON.parse(body.toString('utf8')) } catch {}
        out.status = 'decided'
        out.decision = { id: 'faux', action: asked.action || 'defer', justification: asked.justification || '', author: 'web', created_at: new Date().toISOString() }
      }
      const b = Buffer.from(JSON.stringify(out))
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': b.length })
      return res.end(b)
    }

    const up = await forward(req, body)
    let out = up.body
    const type = String(up.headers['content-type'] || '')
    const ms = masquer.filter((x) => x.re.test(path))
    const rs = remplacer.filter((x) => x.re.test(path))
    if (ms.length && type.includes('json')) {
      let j = JSON.parse(out.toString('utf8'))
      for (const m of ms) j = prune(j, m.txt)
      out = Buffer.from(JSON.stringify(j))
    }
    if (rs.length) {
      let s = out.toString('utf8')
      for (const r of rs) {
        const n = s.split(r.de).length - 1
        if (n) { hits.remplacer += n; s = s.split(r.de).join(r.vers) }
      }
      out = Buffer.from(s)
    }
    const headers = { ...up.headers }
    delete headers['content-length']
    delete headers['content-encoding']
    delete headers.etag
    headers['cache-control'] = 'no-store'
    headers['content-length'] = out.length
    res.writeHead(up.status, headers)
    res.end(out)
  } catch (e) {
    res.writeHead(502, { 'content-type': 'text/plain' })
    res.end('proxy error')
  }
}).listen(Number(port), '127.0.0.1', () => console.log(`proxy 127.0.0.1:${port} -> ${target}`))

process.on('SIGTERM', () => { console.log('hits ' + JSON.stringify(hits)); process.exit(0) })
process.on('SIGINT', () => { console.log('hits ' + JSON.stringify(hits)); process.exit(0) })
setInterval(() => console.log('hits ' + JSON.stringify(hits)), 15000).unref()
