#!/usr/bin/env node
// contexte-eval.mjs — how relevant are the context packs? Measured, not guessed.
// Ground truth comes from the repository's own history: for each recent commit, the subject line
// is the task and the code files it changed are the files a good pack must contain. No model, no
// hand-written expectations. The files are looked up in the CURRENT map, so recent commits give
// the fairest picture; files that no longer exist are ignored.
//
//   node contexte-eval.mjs --projet <name> [--commits 40] [--fichiers 8] [--since "3 months ago"] [--semantique on|off]
//
// Output: recall@k (share of changed files found), hit rate (commits with at least one file found),
// worst cases, and one JSON line appended to $AI_ROOT/benchmarks/contexte/<projet>.jsonl so that a
// change of the ranking can be compared with the previous runs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); if (i < 0) return d; const v = process.argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v; };
const AI_ROOT = process.env.AI_ROOT; if (!AI_ROOT) { console.error('AI_ROOT is not set.'); process.exit(1); }
const projet = arg('projet'); const nCommits = Number(arg('commits', 40)); const k = Number(arg('fichiers', 8)); const since = arg('since', '6 months ago');
const cfg = JSON.parse(fs.readFileSync(path.join(AI_ROOT, 'config', 'projets', projet, 'carte.json'), 'utf8'));
const here = path.dirname(fileURLToPath(import.meta.url));
const git = (...a) => execFileSync('git', ['-C', cfg.repo, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });
const known = new Set(fs.readFileSync(path.join(AI_ROOT, 'indexes', projet, 'files.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((f) => !/(^|\/)tests?\//.test(f.path) && !/\.(spec|test)\./.test(f.path)).map((f) => f.path));

const log = git('log', '--no-merges', `--since=${since}`, '--name-only', '--format=%x01%h%x02%s').split('\x01').filter(Boolean);
const cases = [];
for (const c of log) {
  const [headLine, ...rest] = c.split('\n'); const [sha, subject] = headLine.split('\x02');
  const gold = rest.map((x) => x.trim()).filter((x) => known.has(x));
  if (gold.length < 1 || gold.length > 6 || subject.split(/\s+/).length < 4) continue; // too vague or too wide to be a fair task
  cases.push({ sha, subject, gold }); if (cases.length >= nCommits) break;
}
if (!cases.length) { console.error('No usable commit found.'); process.exit(1); }

let found = 0, total = 0, hits = 0, tokens = 0; const rows = [];
for (const c of cases) {
  const out = execFileSync(process.execPath, [path.join(here, 'contexte.mjs'), '--projet', projet, '--tache', c.subject, '--fichiers', String(k), '--budget', '100000', '--json', '--no-cache', ...(arg('semantique') ? ['--semantique', String(arg('semantique'))] : [])], { encoding: 'utf8', env: process.env, maxBuffer: 1 << 26 });
  const pack = JSON.parse(out); const got = new Set(pack.files.map((f) => f.path));
  const ok = c.gold.filter((g) => got.has(g)).length;
  found += ok; total += c.gold.length; if (ok) hits++; tokens += pack.tokens_est;
  rows.push({ ...c, ok, recall: ok / c.gold.length });
}
const res = { at: new Date().toISOString(), project: projet, revision: git('rev-parse', '--short', 'HEAD').trim(), commits: cases.length, k, recall: +(found / total).toFixed(3), hit_rate: +(hits / cases.length).toFixed(3), avg_pack_tokens: Math.round(tokens / cases.length) };
console.log(`recall@${k} = ${(100 * res.recall).toFixed(1)} %  (${found}/${total} changed files found)`);
console.log(`hit rate  = ${(100 * res.hit_rate).toFixed(1)} %  (${hits}/${cases.length} commits with at least one file found)`);
console.log(`average pack size = ${res.avg_pack_tokens} tokens`);
console.log('worst cases:'); for (const r of rows.filter((x) => x.recall === 0).slice(0, 8)) console.log(`  ${r.sha} "${r.subject.slice(0, 90)}" -> ${r.gold[0]}`);
const dir = path.join(AI_ROOT, 'benchmarks', 'contexte'); fs.mkdirSync(dir, { recursive: true });
fs.appendFileSync(path.join(dir, `${projet}.jsonl`), JSON.stringify({ ...res, semantique: arg('semantique') || 'config', label: arg('label', '') }) + '\n');
