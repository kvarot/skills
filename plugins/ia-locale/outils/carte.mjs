#!/usr/bin/env node
// carte.mjs — machine-readable map of a repository for small local models.
// Deterministic: git, universal-ctags and regular expressions. No model is called, nothing leaves
// the machine, the repository is only read. Everything is pinned to a git revision and rebuilt
// incrementally (only files whose blob changed are parsed again).
//
//   node carte.mjs --projet <name> [--full]
//
// Config : $AI_ROOT/config/projets/<name>/carte.json   (see carte.exemple.json)
// Output : $AI_ROOT/indexes/<name>/
//   manifest.json   revision, counts, tool versions, what was rebuilt
//   files.jsonl     {path, sha, module, lang, lines, dirty}
//   symbols.jsonl   {name, kind, path, line, scope, sig}
//   edges.jsonl     {from, to, kind}            file -> file (include, class use, import)
//   unresolved.jsonl{from, ref, kind}           references that could not be resolved (kept, not hidden)
//   tables.jsonl    {table, path, n}            which file touches which database table
//   routes.jsonl    {set, path, line, ...fields}
//   modules.json    per module: size, languages, depends_on, used_by, tables, tested_by, entry files
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || i + 1 >= process.argv.length ? true : process.argv[i + 1]); };
const AI_ROOT = process.env.AI_ROOT; if (!AI_ROOT) { console.error('AI_ROOT is not set.'); process.exit(1); }
const projet = arg('projet'); if (!projet || projet === true) { console.error('Usage: node carte.mjs --projet <name> [--full]'); process.exit(1); }
const cfgFile = path.join(AI_ROOT, 'config', 'projets', projet, 'carte.json');
if (!fs.existsSync(cfgFile)) { console.error(`No config: ${cfgFile} (copy carte.exemple.json and adapt it).`); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const repo = cfg.repo; const out = path.join(AI_ROOT, 'indexes', projet); fs.mkdirSync(out, { recursive: true });
const t0 = Date.now();

// ---------- helpers ----------
const globRe = (g) => new RegExp('^' + g.replace(/\\/g, '/').replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$');
const matcher = (globs) => { const res = (globs || []).map(globRe); return (p) => res.some((r) => r.test(p)); };
const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8', maxBuffer: 1 << 30 });
const readJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const LANG = { '.php': 'php', '.vue': 'vue', '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'ts', '.twig': 'twig', '.scss': 'scss', '.sql': 'sql' };
const read = (p) => { try { return fs.readFileSync(path.join(repo, p), 'utf8'); } catch { return null; } };

// ---------- 1. files ----------
const includeExt = new Set(cfg.include_ext || Object.keys(LANG));
const excluded = matcher(cfg.exclude);
const dirty = new Set(git('status', '--porcelain', '--untracked-files=no').split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '')));
// A module rule is {name, paths:[globs]} or {name:'front/$1', regex:'^src/front/([^/]+)/'} (first match wins).
const moduleRules = (cfg.modules || []).map((m) => m.regex ? { re: new RegExp(m.regex), name: m.name } : { name: m.name, is: matcher(m.paths) });
const autoDepth = cfg.auto_depth || 3;
const moduleOf = (p) => { for (const m of moduleRules) { if (m.re) { const x = p.match(m.re); if (x) return m.name.replace(/\$(\d)/g, (_, i) => x[+i] || ''); } else if (m.is(p)) return m.name; } return p.split('/').slice(0, autoDepth).slice(0, -1).join('/') || '(root)'; };
const files = new Map();
for (const rec of git('ls-files', '-s', '-z').split('\0')) {
  if (!rec) continue;
  const tab = rec.indexOf('\t'); const p = rec.slice(tab + 1); const sha = rec.slice(7, 47);
  const ext = path.extname(p).toLowerCase();
  if (!includeExt.has(ext) || excluded(p)) continue;
  files.set(p, { path: p, sha, module: moduleOf(p), lang: LANG[ext] || ext.slice(1), lines: 0, dirty: dirty.has(p) });
}
const prevFiles = new Map(arg('full') ? [] : readJsonl(path.join(out, 'files.jsonl')).map((f) => [f.path, f]));
const cfgHash = createHash('sha1').update(JSON.stringify(cfg)).digest('hex').slice(0, 12);
const prevManifest = fs.existsSync(path.join(out, 'manifest.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8')) : null;
const sameCfg = prevManifest && prevManifest.config_hash === cfgHash;
const changed = []; const unchanged = new Set();
for (const f of files.values()) {
  const old = prevFiles.get(f.path);
  if (sameCfg && old && old.sha === f.sha && !f.dirty && !old.dirty) { f.lines = old.lines; unchanged.add(f.path); } else changed.push(f.path);
}

// ---------- 2. symbols (ctags) ----------
let symbols = readJsonl(path.join(out, 'symbols.jsonl')).filter((s) => unchanged.has(s.path));
const ctags = cfg.ctags || 'ctags';
const forTags = changed.filter((p) => ['php', 'js', 'ts'].includes(files.get(p).lang));
let ctagsVersion = 'not run';
if (forTags.length) {
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'carte-'));
  const list = path.join(tmp, 'files.txt'); const tagFile = path.join(tmp, 'tags.json');
  fs.writeFileSync(list, forTags.join('\n'));
  const r = spawnSync(ctags, ['--output-format=json', '--fields=+nKSs', '--kinds-PHP=-v', '--kinds-JavaScript=-vp', '--kinds-TypeScript=-vp', '-L', list, '-f', tagFile], { cwd: repo, encoding: 'utf8' });
  if (r.error) { console.error(`ctags failed: ${r.error.message}`); process.exit(1); }
  for (const l of fs.readFileSync(tagFile, 'utf8').split('\n')) {
    if (!l) continue; let t; try { t = JSON.parse(l); } catch { continue; }
    if (t._type !== 'tag') continue;
    symbols.push({ name: t.name, kind: t.kind, path: t.path.replace(/\\/g, '/'), line: t.line, scope: t.scope || '', sig: t.signature || '' });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
try { ctagsVersion = execFileSync(ctags, ['--version'], { encoding: 'utf8' }).split('\n')[0]; } catch { /* keep */ }

// ---------- 3. per-file facts: lines, raw references, vue component facts ----------
const refs = new Map(readJsonl(path.join(out, 'refs.jsonl')).filter((r) => unchanged.has(r.path)).map((r) => [r.path, r]));
const PHP_CLASS = /\b(?:new\s+\\?([A-Z][\w\\]*)|\\?([A-Z][\w\\]*)::|(?:extends|implements|instanceof)\s+\\?([A-Z][\w\\]*)|use\s+\\?([A-Z][\w\\]*)\s*[;,{])/g;
const PHP_INC = /\b(?:require|include)(?:_once)?\s*\(?\s*([^;]{0,200}?['"][^'"]+['"])/g;
const JS_IMP = /(?:\bimport\s+(?:[\w*{}\s,$]+?\s+from\s+)?|\bimport\s*\(\s*|\brequire\s*\(\s*|\bexport\s+[\w*{}\s,$]+?\s+from\s+)['"]([^'"\n]+)['"]/g;
for (const p of changed) {
  const f = files.get(p); const src = read(p); if (src === null) continue;
  f.lines = src.length ? src.split('\n').length : 0;
  const r = { path: p, classes: [], includes: [], imports: [], uses: {} };
  if (f.lang === 'php') {
    const seen = new Set();
    for (const m of src.matchAll(PHP_CLASS)) { const n = (m[1] || m[2] || m[3] || m[4]).split('\\').pop(); if (n && !['self', 'static', 'parent'].includes(n)) seen.add(n); }
    r.classes = [...seen];
    for (const m of src.matchAll(PHP_INC)) { const s = m[1].match(/['"]([^'"]+)['"]\s*$/); if (s && /^[\w.\/-]+\.(?:php|inc|phtml|html|twig)$/.test(s[1])) r.includes.push(s[1]); }
    for (const m of src.matchAll(/^\s*use\s+\\?([A-Z][\w\\]*\\(\w+))\s*(?:as\s+(\w+)\s*)?;/gm)) r.uses[m[3] || m[2]] = m[1];
  } else if (['js', 'ts', 'vue'].includes(f.lang)) {
    const code = f.lang === 'vue' ? (src.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n') : src;
    r.imports = [...new Set([...code.matchAll(JS_IMP)].map((m) => m[1]))];
    if (f.lang === 'vue') {
      const name = path.basename(p, '.vue');
      symbols.push({ name, kind: 'component', path: p, line: 1, scope: '', sig: '' });
      const block = (key) => { const m = code.match(new RegExp(`\\b${key}\\s*:\\s*([\\[{])`)); if (!m) return []; const open = m[1], close = open === '{' ? '}' : ']'; let d = 0, i = m.index + m[0].length - 1, j = i; for (; j < code.length; j++) { if (code[j] === open) d++; else if (code[j] === close && --d === 0) break; } const body = code.slice(i + 1, j); return open === '[' ? [...body.matchAll(/['"]([\w:-]+)['"]/g)].map((x) => x[1]) : [...body.matchAll(/(?:^|[,{\n])\s*['"]?([\w-]+)['"]?\s*(?::|,|\n|$)/g)].map((x) => x[1]); };
      for (const [kind, key] of [['prop', 'props'], ['emit', 'emits']]) for (const n of new Set(block(key))) symbols.push({ name: n, kind, path: p, line: 1, scope: name, sig: '' });
    }
  }
  refs.set(p, r);
}

// ---------- 4. resolve references into edges ----------
const isTestPath = matcher(cfg.tests || ['**/tests/**', '**/*.test.*', '**/*.spec.*']);
const classDefs = new Map(); const nsOfFile = new Map();
for (const s of symbols) {
  if (s.kind === 'namespace') nsOfFile.set(s.path, s.name);
  if (['class', 'interface', 'trait', 'enum'].includes(s.kind)) { if (!classDefs.has(s.name)) classDefs.set(s.name, []); classDefs.get(s.name).push({ path: s.path, ns: s.scope || '' }); }
}
// Which file defines class `name` as seen from file `r.path`? null = ambiguous, undefined = unknown class.
const resolveClass = (name, r, mod) => {
  let c = classDefs.get(name); if (!c) return undefined;
  const uniq = (l) => [...new Set(l.map((x) => x.path))];
  if (r.uses && r.uses[name]) { const ns = r.uses[name].split('\\').slice(0, -1).join('\\'); const hit = uniq(c.filter((x) => x.ns === ns)); return hit.length === 1 ? hit[0] : (hit.length ? null : undefined); }
  if (!isTestPath(r.path)) { const prod = c.filter((x) => !isTestPath(x.path)); if (prod.length) c = prod; }
  if (uniq(c).length === 1) return c[0].path;
  const sameNs = uniq(c.filter((x) => x.ns === (nsOfFile.get(r.path) || ''))); if (sameNs.length === 1) return sameNs[0];
  const sameMod = uniq(c.filter((x) => files.get(x.path)?.module === mod)); if (sameMod.length === 1) return sameMod[0];
  return null;
};
const byBase = new Map(); for (const p of files.keys()) { const b = path.posix.basename(p); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(p); }
const aliases = Object.entries(cfg.aliases || {}).sort((a, b) => b[0].length - a[0].length);
const tryFile = (base) => { for (const c of [base, base + '.js', base + '.ts', base + '.vue', base + '.mjs', base + '/index.js', base + '/index.ts', base + '/index.vue']) if (files.has(c)) return c; return null; };
const edges = []; const unresolved = [];
for (const r of refs.values()) {
  if (!files.has(r.path)) continue;
  const dir = path.posix.dirname(r.path); const mod = files.get(r.path).module;
  for (const c of r.classes) {
    const target = resolveClass(c, r, mod);
    if (target === undefined) continue; // unknown class = external or built-in: not an error
    if (target === null) { unresolved.push({ from: r.path, ref: c, kind: 'class-ambiguous', candidates: new Set(classDefs.get(c).map((x) => x.path)).size }); continue; }
    if (target !== r.path) edges.push({ from: r.path, to: target, kind: 'class' });
  }
  for (const inc of r.includes) {
    const rel = inc.replace(/^\.?\/+/, ''); let target = tryFile(path.posix.normalize(path.posix.join(dir, inc)));
    if (!target) { const c = (byBase.get(path.posix.basename(rel)) || []).filter((x) => x.endsWith(rel)); if (c.length === 1) target = c[0]; }
    if (target) edges.push({ from: r.path, to: target, kind: 'include' }); else unresolved.push({ from: r.path, ref: inc, kind: 'include' });
  }
  for (const imp of r.imports) {
    if (/\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|json|woff2?)(?:\?.*)?$/.test(imp)) continue;
    let target = null;
    if (imp.startsWith('.')) target = tryFile(path.posix.normalize(path.posix.join(dir, imp)));
    else for (const [a, to] of aliases) if (imp === a || imp.startsWith(a + '/')) { target = tryFile(path.posix.normalize(to + imp.slice(a.length))); break; }
    if (target) edges.push({ from: r.path, to: target, kind: 'import' });
    else if (imp.startsWith('.') || aliases.some(([a]) => imp === a || imp.startsWith(a + '/'))) unresolved.push({ from: r.path, ref: imp, kind: 'import' });
  }
}
const edgeKey = new Set(); const uniqEdges = edges.filter((e) => { const k = `${e.from}\t${e.to}\t${e.kind}`; if (edgeKey.has(k)) return false; edgeKey.add(k); return true; });

// ---------- 5. database tables ----------
let tables = [];
if (cfg.tables?.schema_json) {
  const schema = JSON.parse(read(cfg.tables.schema_json) || '{}');
  const names = Object.keys(schema); const scan = matcher(cfg.tables.scan || ['**/*.php']);
  const bare = new Map(); for (const full of names) { const b = full.split('.').pop(); if (!bare.has(b)) bare.set(b, []); bare.get(b).push(full); }
  const SQL = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE|EXISTS)\s+(?:ONLY\s+)?["`]?(?:\{?\$?[\w>-]+\}?\.|"\s*\.\s*\$\w+\s*\.\s*"\.?)?["`]?(\w+)\b/gi;
  for (const f of files.values()) {
    if (f.lang !== 'php' || !scan(f.path)) continue; const src = read(f.path); if (!src) continue;
    const n = new Map();
    for (const m of src.matchAll(SQL)) { const t = m[1].toLowerCase(); if (bare.has(t)) for (const full of bare.get(t)) n.set(full, (n.get(full) || 0) + 1); }
    for (const full of names) { let i = -1, c = 0; while ((i = src.indexOf(full, i + 1)) >= 0) c++; if (c) n.set(full, Math.max(n.get(full) || 0, c)); }
    for (const [table, c] of n) tables.push({ table, path: f.path, n: c });
  }
}

// ---------- 6. routes ----------
const routes = [];
for (const set of cfg.routes || []) {
  const is = matcher(set.files); const re = new RegExp(set.regex, 'gm');
  for (const f of files.values()) {
    if (!is(f.path)) continue; const src = read(f.path); if (!src) continue;
    for (const m of src.matchAll(re)) { const row = { set: set.name, path: f.path, line: src.slice(0, m.index).split('\n').length }; (set.fields || []).forEach((k, i) => { row[k] = (m[i + 1] || '').trim(); }); routes.push(row); }
  }
}

// ---------- 7. modules ----------
const isTest = matcher(cfg.tests || ['**/tests/**', '**/*.test.*', '**/*.spec.*']);
const mods = new Map();
const M = (n) => { if (!mods.has(n)) mods.set(n, { name: n, files: 0, lines: 0, langs: {}, symbols: 0, depends_on: {}, used_by: {}, tables: {}, tested_by: new Set(), fan_in: new Map() }); return mods.get(n); };
for (const f of files.values()) { const m = M(f.module); m.files++; m.lines += f.lines; m.langs[f.lang] = (m.langs[f.lang] || 0) + 1; }
for (const s of symbols) if (files.has(s.path)) M(files.get(s.path).module).symbols++;
for (const e of uniqEdges) {
  const a = files.get(e.from), b = files.get(e.to); if (!a || !b) continue;
  if (isTest(e.from)) { if (!isTest(e.to)) M(b.module).tested_by.add(e.from); continue; }
  M(b.module).fan_in.set(e.to, (M(b.module).fan_in.get(e.to) || 0) + 1);
  if (a.module !== b.module) { M(a.module).depends_on[b.module] = (M(a.module).depends_on[b.module] || 0) + 1; M(b.module).used_by[a.module] = (M(b.module).used_by[a.module] || 0) + 1; }
}
for (const t of tables) { const m = M(files.get(t.path).module); m.tables[t.table] = (m.tables[t.table] || 0) + t.n; }
const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));
const declared = new Map((cfg.modules || []).map((m) => [m.name, m]));
const modules = [...mods.values()].sort((a, b) => b.lines - a.lines).map((m) => ({
  name: m.name, role: declared.get(m.name)?.role || '', docs: declared.get(m.name)?.docs || [], rules: declared.get(m.name)?.rules || [],
  files: m.files, lines: m.lines, langs: m.langs, symbols: m.symbols,
  depends_on: top(m.depends_on, 15), used_by: top(m.used_by, 15), tables: top(m.tables, 25),
  most_used_files: [...m.fan_in.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p, n]) => ({ path: p, used_by_files: n })),
  tested_by: [...m.tested_by].sort().slice(0, 40), tests_count: m.tested_by.size,
}));

// ---------- 8. write ----------
const head = git('rev-parse', 'HEAD').trim();
writeJsonl(path.join(out, 'files.jsonl'), [...files.values()]);
writeJsonl(path.join(out, 'symbols.jsonl'), symbols);
writeJsonl(path.join(out, 'refs.jsonl'), [...refs.values()].filter((r) => files.has(r.path)));
writeJsonl(path.join(out, 'edges.jsonl'), uniqEdges);
writeJsonl(path.join(out, 'unresolved.jsonl'), unresolved);
writeJsonl(path.join(out, 'tables.jsonl'), tables);
writeJsonl(path.join(out, 'routes.jsonl'), routes);
fs.writeFileSync(path.join(out, 'modules.json'), JSON.stringify(modules, null, 1));
const manifest = {
  project: projet, revision: head, branch: git('rev-parse', '--abbrev-ref', 'HEAD').trim(), built_at: new Date().toISOString(),
  dirty_files: [...dirty].filter((p) => files.has(p)).length, config_hash: cfgHash, mode: prevFiles.size && sameCfg ? 'incremental' : 'full',
  reparsed_files: changed.length, seconds: Math.round((Date.now() - t0) / 100) / 10,
  counts: { files: files.size, lines: [...files.values()].reduce((a, f) => a + f.lines, 0), symbols: symbols.length, edges: uniqEdges.length, unresolved: unresolved.length, tables_used: new Set(tables.map((t) => t.table)).size, routes: routes.length, modules: modules.length },
  tools: { node: process.version, ctags: ctagsVersion, git: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim() },
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${projet} @ ${head.slice(0, 10)} — ${manifest.mode}, ${changed.length} file(s) parsed in ${manifest.seconds}s`);
console.log(JSON.stringify(manifest.counts));
