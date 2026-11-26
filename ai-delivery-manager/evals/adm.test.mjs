// Run: node --test evals/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyzeEntries, analyzeFile, loadSessions, windowMs, underAny } from '../outils/lib/sessions.mjs';
import { readCommits, linkCommits, groupByTopic, topicOf } from '../outils/lib/git.mjs';
import { quantiles, pert, calibration, parseSince } from '../outils/lib/stats.mjs';

const ADM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'outils', 'adm.mjs');
const T0 = Date.parse('2030-01-01T10:00:00Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'adm-'));

const human = (sec, text = 'do it') => ({ type: 'user', timestamp: at(sec), cwd: '/work/demo', sessionId: 's1', gitBranch: 'main', message: { content: text } });
const model = (sec, id, out = 10, content = []) => ({ type: 'assistant', timestamp: at(sec), message: { id, model: 'model-x', usage: { input_tokens: 5, output_tokens: out }, content } });
const toolUse = (id, command) => ({ type: 'tool_use', id, input: { command } });
const toolResult = (sec, id, text) => ({ type: 'user', timestamp: at(sec), message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });

test('gaps are classified by what ends them', () => {
  const s = analyzeEntries([
    human(0), model(30, 'm1', 10, [toolUse('t1', 'npm test')]), toolResult(90, 't1', 'ok'), model(100, 'm2'),
    human(220), // 2 min after the answer: reading and typing
    model(240, 'm3'),
    human(240 + 3600), // an hour later: away, not work
    model(240 + 3600 + 20, 'm4'),
  ]);
  assert.equal(s.ms.model, (30 + 10 + 20 + 20) * 1000);
  assert.equal(s.ms.tool, 60 * 1000);
  assert.equal(s.ms.humanActive, 120 * 1000);
  assert.equal(s.ms.humanAway, 3600 * 1000);
  assert.equal(s.prompts, 3);
});

test('an open session is not proof of work: long model or tool gaps are unknown', () => {
  const s = analyzeEntries([human(0), model(3 * 3600, 'm1', 10, [toolUse('t1', 'sleep')]), toolResult(3 * 3600 + 7200, 't1', 'ok')]);
  assert.equal(s.ms.model + s.ms.tool, 0);
  assert.equal(s.ms.unknown, (3 * 3600 + 7200) * 1000);
});

test('hook output, slash commands and notifications are not human prompts', () => {
  const s = analyzeEntries([
    human(0), model(10, 'm1'),
    { ...human(4000, '<task-notification>done</task-notification>') },
    { ...human(4001, 'meta'), isMeta: true },
    model(4010, 'm2'),
  ]);
  assert.equal(s.prompts, 1);
  assert.equal(s.ms.humanAway, 0);
});

test('tokens are counted once per message id; sub-agent entries are ignored in the main log', () => {
  const s = analyzeEntries([human(0), model(5, 'm1', 100), model(6, 'm1', 100), { ...model(7, 'side', 999), isSidechain: true }]);
  assert.equal(s.tokens.output, 100);
});

test('a log truncated by a crash is still read', async () => {
  const dir = tmp();
  const file = path.join(dir, 'a.jsonl');
  fs.writeFileSync(file, [human(0), model(60, 'm1')].map((e) => JSON.stringify(e)).join('\n') + '\n{"type":"assistant","timest');
  const s = await analyzeFile(file);
  assert.equal(s.ms.model, 60000);
});

test('windowMs clips segments to the window', () => {
  const s = analyzeEntries([human(0), model(100, 'm1')]);
  assert.equal(windowMs(s, T0 + 40000, T0 + 70000).model, 30000);
});

test('the index parses a file once, then again only when it changed', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'proj'));
  const file = path.join(dir, 'proj', 'a.jsonl');
  const cacheFile = path.join(dir, 'cache.json');
  fs.writeFileSync(file, [human(0), model(60, 'm1')].map((e) => JSON.stringify(e)).join('\n'));
  await loadSessions({ logs: dir, cacheFile });
  const stamp = fs.statSync(cacheFile).mtimeMs;
  const again = await loadSessions({ logs: dir, cacheFile });
  assert.equal(fs.statSync(cacheFile).mtimeMs, stamp); // nothing parsed, cache untouched
  assert.equal(again[0].ms.model, 60000);
  fs.appendFileSync(file, '\n' + JSON.stringify(model(120, 'm2')));
  assert.equal((await loadSessions({ logs: dir, cacheFile }))[0].ms.model, 120000);
});

test('path matching ignores case and slash style', () => {
  assert.ok(underAny('D:\\Work\\Demo\\app', ['d:/work/demo']));
  assert.ok(!underAny('D:\\Work\\Demo2', ['d:/work/demo']));
});

function repoWith(commits) {
  const repo = tmp();
  const g = (args, env = {}) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  g(['init', '-q']);
  g(['config', 'user.email', 'dev@example.test']);
  g(['config', 'user.name', 'Dev']);
  g(['config', 'commit.gpgsign', 'false']);
  return commits.map(([sec, subject, file]) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), `${subject}\n`);
    g(['add', '-A']);
    g(['commit', '-q', '-m', subject], { GIT_AUTHOR_DATE: at(sec), GIT_COMMITTER_DATE: at(sec) });
    return g(['rev-parse', 'HEAD']).trim();
  }).concat(repo);
}

test('commits are linked by hash, then by timestamp; a commit seen in no session has no duration', () => {
  const [a, , , repo] = repoWith([[600, 'Billing : invoice total', 'src/a.js'], [1200, 'Billing : rounding', 'src/b.js'], [9000, 'Typed by hand', 'c.txt']]);
  const session = analyzeEntries([
    human(0),
    model(590, 'm1', 10, [toolUse('c1', 'git commit -m x')]), toolResult(601, 'c1', `[main ${a.slice(0, 7)}] Billing : invoice total`),
    model(1199, 'm2', 10, [toolUse('c2', 'git commit -q -m y')]), toolResult(1201, 'c2', ''),
  ]);
  session.file = 's1';
  const commits = linkCommits(readCommits(repo), [session]);
  const [c1, c2, c3] = commits;
  assert.equal(c1.link, 'hash');
  assert.equal(c1.activeMs, 601000 - 0); // everything in the session before its first commit
  assert.equal(c2.link, 'timestamp');
  assert.equal(c2.activeMs, 600000);
  assert.equal(c3.ms, undefined);
  const billing = groupByTopic(commits).find((t) => t.topic === 'Billing');
  assert.equal(billing.linked, 2);
  assert.equal(Math.round(billing.activeMs / 1000), 1201);
});

test('lockfiles and vendored code are not counted as work; topics come from the subject', () => {
  const [, repo] = repoWith([[10, 'feat(cart): add coupon', 'package-lock.json']]);
  const [c] = readCommits(repo);
  assert.equal(c.files, 0);
  assert.equal(c.noise, 1);
  assert.equal(c.topic, 'cart');
  assert.equal(topicOf('Agenda : drag and drop'), 'Agenda');
});

test('no quantile is produced from too few points', () => {
  assert.deepEqual(quantiles([1, 2, 3, 4]), { n: 4, p50: null, p80: null, p95: null });
  const q = quantiles([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(q.p50, 55);
  assert.notEqual(q.p80, null);
  assert.equal(q.p95, null);
  assert.equal(pert(30, 60, 150), 70);
});

test('calibration reports bias and range coverage, and is unusable below five tasks', () => {
  const pairs = [30, 60, 90, 120, 150].map((actual) => ({ estimate: 60, actual, low: 50, high: 100 }));
  const c = calibration(pairs);
  assert.equal(c.medianRatio, 1.5);
  assert.equal(c.rangeCoverage, 0.4);
  assert.equal(c.usable, true);
  assert.equal(calibration(pairs.slice(0, 4)).usable, false);
  assert.equal(calibration([]).n, 0);
});

test('--since accepts relative and ISO forms and rejects the rest', () => {
  assert.equal(parseSince('7d', 1e12), 1e12 - 7 * 86400e3);
  assert.equal(parseSince('2030-01-01T00:00:00Z'), Date.parse('2030-01-01T00:00:00Z'));
  assert.throws(() => parseSince('last week'));
});

function adm(home, logs, args, cwd) {
  const r = spawnSync(process.execPath, [ADM, ...args, '--logs', logs], { encoding: 'utf8', cwd, env: { ...process.env, ADM_HOME: home } });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('task lifecycle: the first estimate is kept, the real duration is measured, review compares both', () => {
  const home = tmp(), logs = tmp(), work = tmp();
  const est = ['task', 'estimate', '--id', 'T-1', '--title', 'Coupon', '--project', 'demo', '--category', 'feature', '--o', '20', '--m', '40', '--p', '90'];
  assert.equal(adm(home, logs, est, work).code, 0);
  assert.match(adm(home, logs, est, work).out, /already estimated/);
  assert.match(adm(home, logs, ['task', 'done', '--id', 'T-1', '--proof', 'x'], work).out, /never started/);
  assert.match(adm(home, logs, ['task', 'done', '--id', 'T-9', '--proof', 'x'], work).out, /no estimate recorded/);
  assert.equal(adm(home, logs, ['task', 'start', '--id', 'T-1'], work).code, 0);
  assert.equal(adm(home, logs, ['task', 'revise', '--id', 'T-1', '--o', '60', '--m', '90', '--p', '180', '--reason', 'scope grew'], work).code, 0);

  // A session in the task folder with 25 minutes of model time. "done" measures up to now,
  // so the task start and the session are placed 30 minutes in the past.
  const begin = Date.now() - 30 * 60000;
  const iso = (ms) => new Date(begin + ms).toISOString();
  fs.mkdirSync(path.join(logs, 'p'));
  fs.writeFileSync(path.join(logs, 'p', 's.jsonl'), [
    { type: 'user', timestamp: iso(100), cwd: work, message: { content: 'go' } },
    ...[1, 2, 3, 4, 5].map((i) => ({ type: 'assistant', timestamp: iso(100 + i * 300000), message: { id: `m${i}`, content: [] } })),
  ].map((e) => JSON.stringify(e)).join('\n'));
  const file = path.join(home, 'tasks.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
    const e = JSON.parse(l);
    if (e.ev === 'start') e.at = iso(0);
    return JSON.stringify(e);
  }).join('\n') + '\n');
  const done = spawnSync(process.execPath, [ADM, 'task', 'done', '--id', 'T-1', '--proof', 'npm test, exit 0', '--logs', logs, '--json'], { encoding: 'utf8', cwd: work, env: { ...process.env, ADM_HOME: home } });
  assert.equal(done.status, 0, done.stderr);
  const actual = JSON.parse(done.stdout).actual;
  assert.equal(actual.activeMin, 25);
  assert.equal(actual.reliability, 'measured');

  const review = JSON.parse(adm(home, logs, ['review', '--json'], work).out);
  assert.equal(review.pairs[0].estimate, 45); // the initial PERT, not the revised one
  assert.equal(review.pairs[0].actual, 25);
  assert.equal(review.calibration.usable, false);
});

test('estimate without history says it is uncalibrated, and refuses unordered points', () => {
  const home = tmp(), logs = tmp();
  const r = adm(home, logs, ['estimate', '--o', '30', '--m', '60', '--p', '150'], home);
  assert.match(r.out, /PERT 1 h 10/);
  assert.match(r.out, /uncalibrated/);
  assert.equal(adm(home, logs, ['estimate', '--o', '90', '--m', '60', '--p', '150'], home).code, 1);
});
