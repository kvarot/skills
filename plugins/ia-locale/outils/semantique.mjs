#!/usr/bin/env node
// semantique.mjs — OPTIONAL semantic layer for contexte.mjs, off by default.
// Each first-party file becomes one short text (path, module, symbol names, first lines), embedded
// by a LOCAL engine (Ollama embeddings API on the loopback only: anything else is refused). Vectors
// are stored under $AI_ROOT/indexes/<project>/semantique/, never in the repository, and refreshed
// incrementally by git blob sha, like carte.mjs. contexte.mjs fuses this ranking with its lexical
// ranking (reciprocal rank fusion) when the project config says so:
//
//   "semantique": { "actif": true, "modele": "nomic-embed-text", "url": "http://127.0.0.1:11434",
//                   "poids": 1, "max_maj": 300 }
//
//   node semantique.mjs --projet <name>                 build or refresh the vectors (prints stats)
//   node semantique.mjs --projet <name> --tache "<t>"   show the semantic ranking alone
//
// Measure before enabling it: contexte-eval.mjs --semantique on|off compares both rankings.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = { modele: 'nomic-embed-text', url: 'http://127.0.0.1:11434', poids: 1, max_maj: 300, lignes: 40, car: 2400, lot: 16, fenetres: 1 };
const CHUNKER = 'file-head-v1'; // change it when chunkText changes: every vector is rebuilt

// Refuse any engine that is not on this machine: nothing leaves the computer.
export function assertLoopback(url) {
  let u; try { u = new URL(url); } catch { throw new Error(`Refused: invalid engine url (${url}).`); }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname) || !['http:', 'https:'].includes(u.protocol)) throw new Error(`Refused: the embedding engine must be local (${u.hostname}).`);
  return u.origin;
}

// One text per file: what a reader skims to know what the file is about.
export function chunkText(p, src, symNames = [], opt = {}) { return chunkTexts(p, src, symNames, { ...opt, fenetres: 1 })[0]; }

// Up to `fenetres` texts per file: the head, then the next windows of `lignes` meaningful lines.
export function chunkTexts(p, src, symNames = [], opt = {}) {
  const o = { ...DEFAULTS, ...opt }; const n = Math.max(1, Number(o.fenetres) || 1);
  const lines = String(src).split('\n').filter((l) => l.trim() && !/^\s*(import\b|package\b|"[^"]+"\s*$|\)$|\($)/.test(l));
  const syms = [...new Set(symNames)].slice(0, 60).join(' '); const out = [];
  for (let w = 0; w < n && (w === 0 || w * o.lignes < lines.length); w++) out.push(`search_document: ${p}\nsymbols: ${syms}\n${lines.slice(w * o.lignes, (w + 1) * o.lignes).join('\n')}`.slice(0, o.car));
  return out;
}

// Which files need a new vector: new, changed blob, or uncommitted content (key given by caller).
export function planRefresh(oldEntries, wanted) {
  const old = new Map(oldEntries.map((e) => [e.path, e.key]));
  return wanted.filter((w) => old.get(w.path) !== w.key).map((w) => w.path);
}

export function normalize(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, (x) => x / n); }

// Reciprocal rank fusion of several ranked lists of ids; weights default to 1. Returns [id, score][] sorted.
export function rrf(lists, weights = [], k = 60) {
  const s = new Map();
  lists.forEach((list, i) => { const w = weights[i] ?? 1; list.forEach((id, r) => s.set(id, (s.get(id) || 0) + w / (k + r + 1))); });
  return [...s.entries()].sort((a, b) => b[1] - a[1]);
}

async function embed(origin, model, inputs) {
  const r = await fetch(origin + '/api/embed', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, input: inputs, truncate: true, keep_alive: '5m' }) });
  if (!r.ok) throw new Error(`embedding engine answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).embeddings;
}

// Load the stored vectors: entries.json [{path, key}] + vectors.f32 (rows of dims floats, normalized).
export function loadStore(dir) {
  const ef = path.join(dir, 'entries.json'); const vf = path.join(dir, 'vectors.f32');
  if (!fs.existsSync(ef) || !fs.existsSync(vf)) return { meta: null, entries: [], vectors: new Float32Array(0) };
  const meta = JSON.parse(fs.readFileSync(ef, 'utf8')); const b = fs.readFileSync(vf);
  return { meta, entries: meta.entries, vectors: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) };
}

function saveStore(dir, meta, files) {
  const rows = files.flatMap((f) => f.vecs.map((vec) => ({ path: f.path, key: f.key, vec }))); const dims = meta.dims;
  fs.mkdirSync(dir, { recursive: true }); const out = new Float32Array(rows.length * dims); rows.forEach((r, i) => out.set(r.vec, i * dims));
  fs.writeFileSync(path.join(dir, "vectors.f32.tmp"), Buffer.from(out.buffer)); fs.renameSync(path.join(dir, "vectors.f32.tmp"), path.join(dir, "vectors.f32"));
  fs.writeFileSync(path.join(dir, "entries.json"), JSON.stringify({ ...meta, entries: rows.map((r) => ({ path: r.path, key: r.key })) }));
}

// Bring the store up to date. files: [{path, sha, dirty}] from files.jsonl; read(p) -> source; syms(p) -> names.
// A file may have several chunks (rows); all of its rows share the file key.
export async function refresh({ dir, files, read, syms, opt = {}, limit = Infinity, onProgress = () => {} }) {
  const o = { ...DEFAULTS, ...opt }; const origin = assertLoopback(o.url);
  const { meta, entries, vectors } = loadStore(dir);
  const same = meta && meta.model === o.modele && meta.chunker === CHUNKER && meta.lignes === o.lignes && meta.car === o.car && (meta.fenetres || 1) === o.fenetres;
  const wanted = files.map((f) => ({ path: f.path, key: f.dirty ? "dirty:" + createHash("sha1").update(read(f.path)).digest("hex") : f.sha }));
  const byFile = new Map(); if (same) entries.forEach((e, i) => { const r = byFile.get(e.path) || byFile.set(e.path, { path: e.path, key: e.key, vecs: [] }).get(e.path); r.vecs.push(vectors.subarray(i * meta.dims, (i + 1) * meta.dims)); });
  const todo = planRefresh([...byFile.values()], wanted);
  if (todo.length > limit) return { skipped: true, todo: todo.length };
  const keyOf = new Map(wanted.map((w) => [w.path, w.key])); let dims = same ? meta.dims : 0; const t0 = Date.now(); let chunks = 0;
  for (let i = 0; i < todo.length; i += o.lot) {
    const batch = todo.slice(i, i + o.lot).map((p) => ({ p, texts: chunkTexts(p, read(p), syms(p), o) }));
    const vecs = await embed(origin, o.modele, batch.flatMap((x) => x.texts)); let j = 0;
    for (const x of batch) { const v = x.texts.map(() => normalize(vecs[j++])); dims = v[0].length; chunks += v.length; byFile.set(x.p, { path: x.p, key: keyOf.get(x.p), vecs: v }); }
    onProgress(Math.min(i + o.lot, todo.length), todo.length);
  }
  const keep = [...byFile.values()].filter((r) => keyOf.has(r.path));
  if (todo.length || keep.length !== byFile.size || !same) saveStore(dir, { model: o.modele, chunker: CHUNKER, lignes: o.lignes, car: o.car, fenetres: o.fenetres, dims, built_at: new Date().toISOString() }, keep);
  return { skipped: false, embedded: todo.length, chunks, total: keep.length, seconds: (Date.now() - t0) / 1000 };
}

// Rank the stored files for a task: best cosine similarity between the query and the chunks of each file.
export async function rank({ dir, query, opt = {}, n = 50 }) {
  const o = { ...DEFAULTS, ...opt }; const origin = assertLoopback(o.url);
  const { meta, entries, vectors } = loadStore(dir); if (!meta || !entries.length) return [];
  const q = normalize((await embed(origin, o.modele, ["search_query: " + query]))[0]); const d = meta.dims; const best = new Map();
  for (let i = 0; i < entries.length; i++) { let s = 0; for (let j = 0; j < d; j++) s += q[j] * vectors[i * d + j]; const p = entries[i].path; if (!(best.get(p) >= s)) best.set(p, s); }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (nm, dflt = null) => { const i = process.argv.indexOf(`--${nm}`); if (i < 0) return dflt; const v = process.argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v; };
  const AI_ROOT = process.env.AI_ROOT; if (!AI_ROOT) { console.error('AI_ROOT is not set.'); process.exit(1); }
  const projet = arg('projet'); if (!projet || projet === true) { console.error('Usage: node semantique.mjs --projet <name> [--tache "<text>"]'); process.exit(1); }
  const idx = path.join(AI_ROOT, 'indexes', projet); const cfg = JSON.parse(fs.readFileSync(path.join(AI_ROOT, 'config', 'projets', projet, 'carte.json'), 'utf8'));
  const opt = cfg.semantique || {}; const dir = path.join(idx, 'semantique');
  const rd = (f) => fs.readFileSync(path.join(idx, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  if (arg('tache')) { for (const [p, s] of await rank({ dir, query: String(arg('tache')), opt, n: Number(arg('n', 15)) })) console.log(s.toFixed(3), p); process.exit(0); }
  const symsOf = new Map(); for (const s of rd('symbols.jsonl')) (symsOf.get(s.path) || symsOf.set(s.path, []).get(s.path)).push(s.name);
  const testRes = (cfg.tests || []).map((g) => new RegExp('^' + g.replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$'));
  const files = rd('files.jsonl').filter((f) => !testRes.some((r) => r.test(f.path)));
  const read = (p) => { try { return fs.readFileSync(path.join(cfg.repo, p), 'utf8'); } catch { return ''; } };
  const r = await refresh({ dir, files, read, syms: (p) => symsOf.get(p) || [], opt, onProgress: (a, b) => { if (a % 320 < (opt.lot || DEFAULTS.lot) || a === b) process.stderr.write(`  ${a}/${b}\n`); } });
  const size = fs.existsSync(path.join(dir, 'vectors.f32')) ? fs.statSync(path.join(dir, 'vectors.f32')).size + fs.statSync(path.join(dir, 'entries.json')).size : 0;
  console.log(JSON.stringify({ ...r, index_bytes: size }));
}
