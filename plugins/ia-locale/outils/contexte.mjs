#!/usr/bin/env node
// contexte.mjs — the smallest sufficient context for a task, from the map built by carte.mjs.
// Deterministic: term scoring over first-party files, symbol table, dependency edges. No model,
// no embedding, nothing leaves the machine. The goal is NOT the largest context a model accepts,
// but the smallest one that lets it work; the agent asks for more when it needs more.
//
//   node contexte.mjs --projet <name> --tache "<task text>" [--budget 6000] [--fichiers 8] [--json]
//   node contexte.mjs --projet <name> --plus <path>        one file in depth: symbols, deps, dependents, tests
//   node contexte.mjs --projet <name> --refs <symbol>      where a symbol is defined and referenced
//
// Budget = approximate tokens (characters / 3.5). Module rules and security constraints are never
// cut: if they do not fit, the command fails with exit code 3 instead of truncating them. Everything
// else that is dropped is counted in an "omitted" line. Every pack is logged (who got which files):
// $AI_ROOT/logs/contexte.jsonl. Packs are cached per revision; the map is refreshed when stale.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); if (i < 0) return d; const v = process.argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v; };
const AI_ROOT = process.env.AI_ROOT; if (!AI_ROOT) { console.error('AI_ROOT is not set.'); process.exit(1); }
const projet = arg('projet'); if (!projet || projet === true) { console.error('Usage: node contexte.mjs --projet <name> (--tache "<text>" | --plus <path> | --refs <symbol>) [--budget N]'); process.exit(1); }
const cfgDir = path.join(AI_ROOT, 'config', 'projets', projet); const idx = path.join(AI_ROOT, 'indexes', projet);
const cfg = JSON.parse(fs.readFileSync(path.join(cfgDir, 'carte.json'), 'utf8')); const repo = cfg.repo;
const here = path.dirname(fileURLToPath(import.meta.url));
const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

// ---------- keep the map fresh ----------
const head = git('rev-parse', 'HEAD'); const dirtyNow = git('status', '--porcelain', '--untracked-files=no');
const manifestFile = path.join(idx, 'manifest.json');
let manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null;
const stateKey = createHash('sha1').update(head + '\n' + dirtyNow).digest('hex').slice(0, 16);
if (!manifest || manifest.revision !== head || manifest.state_key !== stateKey) {
  execFileSync(process.execPath, [path.join(here, 'carte.mjs'), '--projet', projet], { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
  manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); manifest.state_key = stateKey; fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
}
const rd = (f) => fs.readFileSync(path.join(idx, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const files = new Map(rd('files.jsonl').map((f) => [f.path, f]));
const symbols = rd('symbols.jsonl'); const edges = rd('edges.jsonl'); const tables = rd('tables.jsonl'); const routes = rd('routes.jsonl');
const modules = new Map(JSON.parse(fs.readFileSync(path.join(idx, 'modules.json'), 'utf8')).map((m) => [m.name, m]));
const globRe = (g) => new RegExp('^' + g.replace(/\\/g, '/').replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$');
const matcher = (globs) => { const res = (globs || []).map(globRe); return (p) => res.some((r) => r.test(p)); };
const isTest = matcher(cfg.tests || ['**/tests/**', '**/*.test.*', '**/*.spec.*']);
const valFile = path.join(cfgDir, 'validation.json'); const val = fs.existsSync(valFile) ? JSON.parse(fs.readFileSync(valFile, 'utf8')) : null;
const LEVELS = ['low', 'moderate', 'high', 'critical'];
const riskRules = (val?.risk || []).map((r) => ({ level: r.level, is: matcher(r.paths) })); const forbidden = matcher(val?.forbidden);
const riskOf = (p) => { if (forbidden(p)) return 'FORBIDDEN'; let l = 'moderate'; for (const r of riskRules) if (r.is(p) && LEVELS.indexOf(r.level) > LEVELS.indexOf(l)) l = r.level; return l; };
const symsOf = new Map(); for (const s of symbols) { if (!symsOf.has(s.path)) symsOf.set(s.path, []); symsOf.get(s.path).push(s); }
const outOf = new Map(), inOf = new Map(); for (const e of edges) { (outOf.get(e.from) || outOf.set(e.from, []).get(e.from)).push(e.to); (inOf.get(e.to) || inOf.set(e.to, []).get(e.to)).push(e.from); }
const tok = (s) => Math.ceil(s.length / 3.5);
const read = (p) => { try { return fs.readFileSync(path.join(repo, p), 'utf8'); } catch { return ''; } };
const log = (row) => { fs.mkdirSync(path.join(AI_ROOT, 'logs'), { recursive: true }); fs.appendFileSync(path.join(AI_ROOT, 'logs', 'contexte.jsonl'), JSON.stringify({ at: new Date().toISOString(), project: projet, revision: head.slice(0, 12), ...row }) + '\n'); };
const sigSyms = (p, n) => (symsOf.get(p) || []).filter((s) => ['class', 'interface', 'trait', 'function', 'method', 'component'].includes(s.kind)).slice(0, n);
const fmtSym = (s) => `${s.kind} ${s.scope && s.kind !== 'component' ? s.scope + '::' : ''}${s.name}${s.sig || ''} :${s.line}`;
const testsOf = (p) => [...new Set((inOf.get(p) || []).filter(isTest))];

// ---------- --plus : one file in depth ----------
if (arg('plus')) {
  const p = String(arg('plus')).replace(/\\/g, '/'); const f = files.get(p); if (!f) { console.error(`Not in the map: ${p}`); process.exit(1); }
  const o = [`# ${p}`, `module ${f.module} | ${f.lang} | ${f.lines} lines | risk ${riskOf(p)} | revision ${head.slice(0, 10)}`];
  o.push('## symbols', ...(symsOf.get(p) || []).filter((s) => !['alias', 'namespace'].includes(s.kind)).slice(0, 120).map(fmtSym));
  o.push('## depends on', ...[...new Set(outOf.get(p) || [])].slice(0, 40), '## used by', ...[...new Set(inOf.get(p) || [])].filter((x) => !isTest(x)).slice(0, 40), '## tests', ...testsOf(p).slice(0, 20));
  const t = tables.filter((x) => x.path === p).map((x) => x.table); if (t.length) o.push('## tables', t.join(', '));
  const r = routes.filter((x) => x.handler && p.includes(String(x.handler).split(/[:\\]/).filter(Boolean).slice(-2, -1)[0] || '\u0000')).slice(0, 15); if (r.length) o.push('## routes', ...r.map((x) => `${x.method} ${x.path}`));
  const text = o.join('\n'); console.log(text); log({ mode: 'plus', query: p, files: [p], tokens_est: tok(text) }); process.exit(0);
}

// ---------- --refs : definition and references of a symbol ----------
if (arg('refs')) {
  const name = String(arg('refs')); const defs = symbols.filter((s) => s.name === name && !['alias', 'prop', 'emit'].includes(s.kind));
  const re = new RegExp(`(?<![\\w$])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w$])`); const hits = [];
  for (const f of files.values()) { const src = read(f.path); if (!src.includes(name)) continue; const lines = src.split('\n'); for (let i = 0; i < lines.length && hits.length < 400; i++) if (re.test(lines[i])) hits.push({ path: f.path, line: i + 1, text: lines[i].trim().slice(0, 140) }); }
  const o = [`# ${name} — revision ${head.slice(0, 10)}`, '## defined in', ...defs.map((s) => `${s.path}:${s.line} ${fmtSym(s)}`), `## referenced in (${hits.length}${hits.length >= 400 ? '+, capped' : ''} lines, ${new Set(hits.map((h) => h.path)).size} files)`];
  const max = Number(arg('max', 60)); o.push(...hits.slice(0, max).map((h) => `${h.path}:${h.line} ${h.text}`)); if (hits.length > max) o.push(`omitted: ${hits.length - max} more reference line(s) (use --max N)`);
  const text = o.join('\n'); console.log(text); log({ mode: 'refs', query: name, files: [...new Set(hits.map((h) => h.path))].slice(0, 50), tokens_est: tok(text) }); process.exit(0);
}

// ---------- --tache : context pack ----------
const tache = arg('tache'); if (!tache || tache === true) { console.error('Give --tache, --plus or --refs.'); process.exit(1); }
const budget = Number(arg('budget', 6000)); const maxFiles = Number(arg('fichiers', 8));
const cacheDir = path.join(idx, 'cache'); fs.mkdirSync(cacheDir, { recursive: true });
// semantic layer: off unless the project config enables it; --semantique on|off overrides (for measures)
const semArg = arg('semantique'); const semOn = semArg === 'on' || semArg === true ? true : semArg === 'off' ? false : cfg.semantique?.actif === true;
const cacheFile = path.join(cacheDir, createHash('sha1').update([stateKey, tache, budget, maxFiles, arg('json') ? 'j' : 't', semOn ? 's' + JSON.stringify(cfg.semantique || {}) : ''].join('\u0000')).digest('hex') + '.txt');
if (fs.existsSync(cacheFile) && !arg('no-cache')) { const c = fs.readFileSync(cacheFile, 'utf8'); console.log(c); log({ mode: 'tache', query: tache, budget, cache: true, tokens_est: tok(c) }); process.exit(0); }

const STOP = new Set('les des une que qui dans pour par sur avec sans est son ses aux pas plus tout tous cette cet ces mais donc car lors quand elle ils nous vous leur leurs être avoir faire fait doit doivent peut afin entre the and for with from that this when then into not all are was has have its does should must can add fix bug make use new get set ajouter ajoute corriger corrige créer crée modifier modifie mettre fonction fichier file function code'.split(' '));
const explicitPaths = [...String(tache).matchAll(/[\w./-]+\.(?:php|vue|js|ts|twig|scss|sql)\b/g)].map((m) => m[0].replace(/\\/g, '/'));
const rawTerms = [...new Set(String(tache).split(/[^\p{L}\p{N}_$]+/u).filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase())))];
const sing = (w) => (w.length > 4 && /[^s]s$/i.test(w) ? w.slice(0, -1) : w);
const parts = (w) => [sing(w), ...w.split(/_|(?<=[a-z0-9])(?=[A-Z])/).filter((x) => x.length >= 4).map(sing)];
const singles = [...new Set(rawTerms.flatMap(parts).map((t) => t.toLowerCase()))].slice(0, 20);
const lower = rawTerms.map((t) => sing(t.toLowerCase())); const compounds = new Set();
for (let i = 0; i + 1 < lower.length; i++) for (const sep of ['_', '', '-']) { compounds.add(lower[i] + sep + lower[i + 1]); compounds.add(lower[i + 1] + sep + lower[i]); }
const terms = [...singles, ...compounds].slice(0, 110);
const symByLower = new Map(); for (const s of symbols) { const k = s.name.toLowerCase(); (symByLower.get(k) || symByLower.set(k, []).get(k)).push(s); }

const tf = new Map(); const df = new Map(terms.map((t) => [t, 0]));
for (const f of files.values()) {
  const src = read(f.path).toLowerCase(); if (!src) continue; const row = {};
  for (const t of terms) { let i = -1, c = 0; while (c < 40 && (i = src.indexOf(t, i + 1)) >= 0) c++; if (c) { row[t] = c; df.set(t, df.get(t) + 1); } }
  if (Object.keys(row).length) tf.set(f.path, row);
}
const N = files.size; const W = (t) => (compounds.has(t) ? 2.5 : 1); const idf = (t) => W(t) * Math.log(1 + N / (1 + df.get(t)));
const symRarity = (t) => 1 / Math.sqrt((symByLower.get(t) || []).length || 1); // a name defined 50 times says little
const covered = new Map(); const cover = (p, t) => { (covered.get(p) || covered.set(p, new Set()).get(p)).add(compounds.has(t) ? t.split(/[_-]/)[0] : t); };
const score = new Map(); const why = new Map();
const add = (p, v, w) => { if (!files.has(p)) return; score.set(p, (score.get(p) || 0) + v); if (w) (why.get(p) || why.set(p, new Set()).get(p)).add(w); };
for (const [p, row] of tf) for (const [t, c] of Object.entries(row)) { add(p, idf(t) * Math.sqrt(Math.min(c, 16)), null); cover(p, t); if (compounds.has(t)) { const m = lower.find((x) => t.endsWith(x) && !t.startsWith(x)); if (m) covered.get(p).add(m); } }
for (const t of terms) {
  for (const s of symByLower.get(t) || []) if (!['alias', 'prop', 'emit', 'constant', 'define', 'field'].includes(s.kind)) add(s.path, 9 * idf(t) * symRarity(t), `defines ${s.kind} ${s.name}`);
  for (const p of files.keys()) { const base = path.posix.basename(p).toLowerCase(); if (base.includes(t)) add(p, 5 * idf(t), `name contains "${t}"`); else if (p.toLowerCase().includes('/' + t)) add(p, 2 * idf(t), `path contains "${t}"`); }
}
for (const e of explicitPaths) for (const p of files.keys()) if (p.endsWith(e)) add(p, 1000, 'named in the task');
const rar = (t) => Math.log(1 + N / (1 + (df.get(t) || 0))); const totalRar = singles.reduce((a, t) => a + rar(t), 0);
for (const [p, v] of score) { const f = files.get(p); const got = [...(covered.get(p) || [])].filter((t) => df.has(t)).reduce((a, t) => a + rar(t), 0);
  let k = Math.sqrt((got + 0.1) / (totalRar + 0.1));
  const inName = singles.filter((t) => path.posix.basename(p).toLowerCase().includes(t)).length; if (inName > 1) k *= 1 + 0.6 * (inName - 1);
  if (isTest(p)) k *= 0.35; else if (['scss', 'sql', 'twig'].includes(f.lang)) k *= 0.6; if (f.lines > 4000) k *= 0.8; score.set(p, v * k); }
let ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
if (semOn) { // optional semantic layer: reciprocal rank fusion of the lexical and the semantic rankings
  try {
    const so = cfg.semantique || {}; const sdir = path.join(idx, 'semantique'); const { refresh, rank, rrf, DEFAULTS } = await import('./semantique.mjs');
    const r = await refresh({ dir: sdir, files: [...files.values()].filter((f) => !isTest(f.path)), read, syms: (p) => (symsOf.get(p) || []).map((s) => s.name), opt: so, limit: so.max_maj ?? DEFAULTS.max_maj });
    if (r.skipped) console.error(`semantic layer skipped: ${r.todo} file(s) to embed; run semantique.mjs --projet ${projet} first.`);
    else {
      const sem = await rank({ dir: sdir, query: String(tache), opt: so, n: 60 }); const lex = ranked.slice(0, 60).map(([p]) => p);
      const fused = rrf([lex, sem.map(([p]) => p)], [1, so.poids ?? DEFAULTS.poids]).filter(([p]) => files.has(p)); const inFused = new Set(fused.map(([p]) => p));
      sem.slice(0, 10).forEach(([p], i) => { if (files.has(p)) (why.get(p) || why.set(p, new Set()).get(p)).add(`semantic rank ${i + 1}`); });
      ranked = [...fused, ...ranked.filter(([p]) => !inFused.has(p)).map(([p, v]) => [p, v * 1e-9])];
    }
  } catch (e) { console.error(`semantic layer unavailable (${e.message}); lexical ranking only.`); }
}
const top = ranked.filter(([p]) => !isTest(p)).slice(0, maxFiles); const topSet = new Set(top.map(([p]) => p));
const best = top.length ? top[0][1] : 0;

// sections, most important first; "must" sections are never cut
const sections = [];
const mods = [...new Set(top.map(([p]) => files.get(p).module))];
const ruleLines = []; const seenRule = new Set(); const pushRule = (tag, r) => { if (!seenRule.has(r)) { seenRule.add(r); ruleLines.push(`- [${tag}] ${r}`); } };
const fileFiches = (cfg.fiches || []).filter((f) => f.files?.length).map((f) => ({ ...f, is: matcher(f.files) }));
for (const f of fileFiches) if (top.some(([p]) => f.is(p))) for (const r of f.rules || []) pushRule(f.topic || 'topic', r);
for (const m of mods) for (const r of modules.get(m)?.rules || []) pushRule(m, r);
for (const [p] of top) { const r = riskOf(p); if (r === 'FORBIDDEN') ruleLines.push(`- ${p}: FORBIDDEN path — never edit it`); else if (LEVELS.indexOf(r) >= 2) ruleLines.push(`- ${p}: risk ${r} — a human must approve any change`); }
sections.push({ must: true, text: `# Context pack — ${projet} @ ${head.slice(0, 10)}${dirtyNow ? ' (+ uncommitted changes)' : ''}\nTask: ${tache}\nTerms used: ${singles.join(', ') || '(none)'}` });
if (ruleLines.length) sections.push({ must: true, text: '## Rules and constraints (complete, never truncated)\n' + ruleLines.join('\n') });
if (!top.length) sections.push({ must: true, text: 'No file matched. Rephrase the task with a file, class, function or table name, or use --refs <symbol>.' });
for (const [p, sc] of top) {
  const f = files.get(p); const matched = (symsOf.get(p) || []).filter((s) => singles.some((t) => s.name.toLowerCase().includes(t)) && !['alias', 'namespace'].includes(s.kind)).slice(0, 10);
  const lines = [`## ${p}`, `module ${f.module} | ${f.lang} | ${f.lines} lines | risk ${riskOf(p)} | relevance ${Math.round(100 * sc / best)}% | ${[...(why.get(p) || [])].slice(0, 3).join('; ') || 'text match'}`];
  if (matched.length) lines.push('matching symbols: ' + matched.map(fmtSym).join(' | '));
  const other = sigSyms(p, 10).filter((s) => !matched.includes(s)); if (other.length) lines.push('other symbols: ' + other.map((s) => `${s.name}:${s.line}`).join(', ') + ((symsOf.get(p) || []).length > 10 + matched.length ? ' …' : ''));
  const dep = [...new Set(outOf.get(p) || [])].filter((x) => !isTest(x)); if (dep.length) lines.push(`depends on (${dep.length}): ` + dep.slice(0, 6).join(', ') + (dep.length > 6 ? ' …' : ''));
  const use = [...new Set(inOf.get(p) || [])].filter((x) => !isTest(x)); if (use.length) lines.push(`used by (${use.length}): ` + use.slice(0, 6).join(', ') + (use.length > 6 ? ' …' : ''));
  const ts = testsOf(p); lines.push(ts.length ? `tests (${ts.length}): ` + ts.slice(0, 4).join(', ') + (ts.length > 4 ? ' …' : '') : 'tests: none found by the map');
  const tb = tables.filter((x) => x.path === p).sort((a, b) => b.n - a.n).map((x) => x.table); if (tb.length) lines.push(`tables: ` + tb.slice(0, 10).join(', ') + (tb.length > 10 ? ' …' : ''));
  sections.push({ must: false, file: p, text: lines.join('\n') });
}
const modLines = mods.map((m) => { const mm = modules.get(m); if (!mm) return null; return `- ${m}: ${mm.role ? mm.role + ' ' : ''}${mm.files} files, ${mm.lines} lines; depends on ${Object.keys(mm.depends_on).slice(0, 5).join(', ') || '—'}; used by ${Object.keys(mm.used_by).slice(0, 5).join(', ') || '—'}${mm.docs?.length ? '; docs: ' + mm.docs.join(', ') : ''}`; }).filter(Boolean);
if (modLines.length) sections.push({ must: false, text: '## Modules concerned\n' + modLines.join('\n') });
const relTests = ranked.filter(([p]) => isTest(p)).slice(0, 5).map(([p]) => p); if (relTests.length) sections.push({ must: false, text: '## Tests mentioning the terms\n' + relTests.join('\n') });
const more = ranked.filter(([p]) => !isTest(p) && !topSet.has(p)).slice(0, 8).map(([p]) => p); if (more.length) sections.push({ must: false, text: '## Next candidates (not detailed)\n' + more.join('\n') });
sections.push({ must: true, text: 'More: `contexte.mjs --plus <path>` (one file in depth), `--refs <symbol>` (callers). Read only the files you will change.' });

const mustTok = sections.filter((s) => s.must).reduce((a, s) => a + tok(s.text) + 1, 0);
if (mustTok > budget) { console.error(`Budget ${budget} is too small: rules and constraints alone need ${mustTok} tokens. Nothing was truncated; raise --budget.`); process.exit(3); }
let used = mustTok; const kept = []; let omitted = 0;
for (const s of sections) { if (s.must) { kept.push(s); continue; } const t = tok(s.text) + 1; if (used + t <= budget) { kept.push(s); used += t; } else omitted++; }
if (omitted) kept.splice(kept.length - 1, 0, { text: `omitted: ${omitted} section(s) did not fit the budget of ${budget} tokens (raise --budget or narrow the task)` });
const packFiles = kept.filter((s) => s.file).map((s) => s.file);
const text = arg('json') ? JSON.stringify({ project: projet, revision: head, task: tache, terms, budget, tokens_est: used, omitted, files: packFiles.map((p) => ({ path: p, module: files.get(p).module, risk: riskOf(p), tests: testsOf(p) })), rules: ruleLines }, null, 1) : kept.map((s) => s.text).join('\n\n');
fs.writeFileSync(cacheFile, text); console.log(text);
log({ mode: 'tache', query: tache, budget, cache: false, tokens_est: tok(text), omitted, files: packFiles });
