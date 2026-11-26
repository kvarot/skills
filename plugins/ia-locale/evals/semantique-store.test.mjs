// refresh() and rank() of semantique.mjs against a stub embedding engine on the loopback (node --test).
// No model and no real engine: the stub turns each text into a small vector from its words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { refresh, rank } from '../outils/semantique.mjs';

const WORDS = ['invoice', 'login', 'route', 'cache'];
const vec = (t) => WORDS.map((w) => (t.toLowerCase().includes(w) ? 1 : 0) + 0.01);

async function withEngine(fn) {
  let calls = 0;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { const { input } = JSON.parse(b); calls += input.length; res.end(JSON.stringify({ embeddings: input.map(vec) })); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try { return await fn(`http://127.0.0.1:${srv.address().port}`, () => calls); } finally { srv.close(); }
}

test('refresh embeds only new or changed files, rank finds the closest file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-'));
  const src = { 'a/billing.go': 'func Invoice() {}', 'b/auth.go': 'func Login() {}', 'c/http.go': 'func Route() {}' };
  const read = (p) => src[p] || ''; const syms = () => [];
  try {
    await withEngine(async (url, calls) => {
      const opt = { url, fenetres: 1 };
      let files = Object.keys(src).map((p) => ({ path: p, sha: 'v1', dirty: false }));
      const r1 = await refresh({ dir, files, read, syms, opt });
      assert.equal(r1.embedded, 3); assert.equal(calls(), 3);
      const r2 = await refresh({ dir, files, read, syms, opt });
      assert.equal(r2.embedded, 0); assert.equal(calls(), 3); // nothing changed: no engine call
      src['c/http.go'] = 'func Cache() {}'; files = files.map((f) => (f.path === 'c/http.go' ? { ...f, sha: 'v2' } : f)).filter((f) => f.path !== 'b/auth.go');
      const r3 = await refresh({ dir, files, read, syms, opt });
      assert.equal(r3.embedded, 1); assert.equal(r3.total, 2); // one changed, one removed
      const top = await rank({ dir, query: 'cache of the http layer', opt, n: 2 });
      assert.equal(top[0][0], 'c/http.go');
      assert.ok(!top.some(([p]) => p === 'b/auth.go'));
      const limited = await refresh({ dir, files: [...files, { path: 'd/new.go', sha: 'v1', dirty: false }, { path: 'e/new.go', sha: 'v1', dirty: false }], read, syms, opt, limit: 1 });
      assert.equal(limited.skipped, true); assert.equal(limited.todo, 2);
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('refresh refuses an engine that is not local', async () => {
  await assert.rejects(refresh({ dir: os.tmpdir(), files: [], read: () => '', syms: () => [], opt: { url: 'http://192.0.2.1:11434' } }), /must be local/);
});
