// Run: node --test chef-de-projet-ia/evals/
// Needs Windows PowerShell 5.1 (powershell) or PowerShell 7 (pwsh) on PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'outils', 'taches.ps1');
const SHELL = process.platform === 'win32' ? 'powershell' : 'pwsh';
const A = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const B = 'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';
const a7 = A.slice(0, 7);
const b7 = B.slice(0, 7);

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taches-'));
  const file = path.join(dir, 'taches.jsonl');
  const run = (...args) => {
    const r = spawnSync(SHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args, '-Fichier', file, '-Projet', 'PRJ'], { encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };
  const ok = (...args) => {
    const r = run(...args);
    assert.equal(r.code, 0, `expected success for [${args.join(' ')}]: ${r.err || r.out}`);
    return r;
  };
  const ko = (pattern, ...args) => {
    const r = run(...args);
    assert.notEqual(r.code, 0, `expected refusal for [${args.join(' ')}], got: ${r.out}`);
    assert.match(r.err, pattern);
    return r;
  };
  const task = (id) => JSON.parse(ok('show', '-Id', id).out);
  const read = () => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const write = (rows) => fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { dir, file, run, ok, ko, task, read, write };
}

// Takes a fresh task up to tests_green on commit A.
function green(s, id = 'PRJ-1', worker = 'w1', zone = 'src/a') {
  s.ok('add', '-Titre', `task ${id}`, '-Zone', zone);
  s.ok('claim', '-Id', id, '-Par', worker, '-Machine', 'pc1');
  s.ok('set', '-Id', id, '-Etat', 'implemented', '-Preuve', `commit ${A}`);
  s.ok('set', '-Id', id, '-Etat', 'tests_run', '-Preuve', `npm test exit 0 @ ${a7}`);
  s.ok('set', '-Id', id, '-Etat', 'tests_green', '-Preuve', `npm test exit 0 ; npm run lint exit 0 @ ${a7}`);
}

test('a task goes through every state with its proof', () => {
  const s = store();
  green(s);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `MERGEABLE @ ${a7}`, '-Par', 'reviewer-1');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'accepted', '-Preuve', 'gate: make ci exit 0', '-Par', 'orchestrator');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${B}`, '-Par', 'orchestrator');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'deployed', '-Preuve', 'https://example.org/health 200', '-Par', 'orchestrator');
  const t = s.task('PRJ-1');
  assert.equal(t.state, 'deployed');
  assert.equal(t.lease_until, '');
  assert.deepEqual(t.evidence.map((e) => e.state), ['doing', 'implemented', 'tests_run', 'tests_green', 'reviewed', 'accepted', 'merged', 'deployed']);
});

test('a state cannot be skipped, unless forced with a written reason', () => {
  const s = store();
  s.ok('add', '-Titre', 't');
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1');
  s.ko(/transition doing -> merged/, 'set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${A}`, '-Par', 'orchestrator');
  s.ko(/transition doing -> tests_green/, 'set', '-Id', 'PRJ-1', '-Etat', 'tests_green', '-Preuve', `x exit 0 @ ${a7}`);
  s.ko(/-Forcer needs -Note/, 'set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${A}`, '-Par', 'orchestrator', '-Forcer');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${A}`, '-Par', 'orchestrator', '-Forcer', '-Note', 'merged by hand before the register existed');
  const last = s.task('PRJ-1').evidence.at(-1);
  assert.equal(last.forced, true);
  assert.match(last.note, /by hand/);
});

test('todo and doing are reached by release and claim only', () => {
  const s = store();
  s.ok('add', '-Titre', 't');
  s.ko(/use claim/, 'set', '-Id', 'PRJ-1', '-Etat', 'doing', '-Preuve', 'x');
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1');
  s.ko(/use release/, 'set', '-Id', 'PRJ-1', '-Etat', 'todo', '-Preuve', 'x');
});

test('nobody validates their own work', () => {
  const s = store();
  green(s);
  s.ko(/needs -Par/, 'set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `MERGEABLE @ ${a7}`);
  s.ko(/own work/, 'set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `MERGEABLE @ ${a7}`, '-Par', 'W1');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `MERGEABLE @ ${a7}`, '-Par', 'reviewer-1');
  s.ko(/own work/, 'set', '-Id', 'PRJ-1', '-Etat', 'accepted', '-Preuve', 'gate exit 0', '-Par', 'w1');
  // -Forcer skips the order of states, never the identity rule.
  s.ko(/own work/, 'set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${A}`, '-Par', 'w1', '-Forcer', '-Note', 'hurry');
});

test('a proof has the form its state needs', () => {
  const s = store();
  s.ok('add', '-Titre', 't');
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1');
  s.ko(/needs -Preuve/, 'set', '-Id', 'PRJ-1', '-Etat', 'implemented');
  s.ko(/commit sha/, 'set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', 'pushed the change');
  s.ko(/not a proof/, 'set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', 'done');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `commit ${A}`);
  s.ko(/exit code/, 'set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test passed @ ${a7}`);
  s.ko(/@ <sha>/, 'set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', 'npm test exit 1');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 1 @ ${a7}`);
  s.ko(/every suite at exit 0/, 'set', '-Id', 'PRJ-1', '-Etat', 'tests_green', '-Preuve', `npm test exit 0 ; lint exit 2 @ ${a7}`);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_green', '-Preuve', `npm test exit 0 ; lint exit 0 @ ${a7}`);
  s.ko(/MERGEABLE/, 'set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `looks good @ ${a7}`, '-Par', 'r1');
  s.ko(/MERGEABLE/, 'set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `NOT MERGEABLE @ ${a7}`, '-Par', 'r1');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `MERGEABLE @ ${a7}`, '-Par', 'r1');
  s.ko(/gate command at exit 0/, 'set', '-Id', 'PRJ-1', '-Etat', 'accepted', '-Preuve', 'gate went fine', '-Par', 'orch');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'accepted', '-Preuve', 'accepted by the owner, message of 2030-01-02', '-Par', 'orch');
  s.ko(/commit sha/, 'set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', 'merged to main', '-Par', 'orch');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${b7}`, '-Par', 'orch');
  s.ko(/URL \+ HTTP code/, 'set', '-Id', 'PRJ-1', '-Etat', 'deployed', '-Preuve', 'it is live', '-Par', 'orch');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'deployed', '-Preuve', 'version 2.4.1 shown on the about page', '-Par', 'orch');
});

test('test and review proofs must be on the last implemented commit', () => {
  const s = store();
  s.ok('add', '-Titre', 't');
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `commit ${A}`);
  s.ko(/last implemented commit/, 'set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 0 @ ${b7}`);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 0 @ ${A}`);
  // A new commit sends the task back: the green run on A proves nothing about B.
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `commit ${B}`);
  s.ko(/transition implemented -> tests_green/, 'set', '-Id', 'PRJ-1', '-Etat', 'tests_green', '-Preuve', `npm test exit 0 @ ${b7}`);
  s.ko(/last implemented commit/, 'set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 0 @ ${a7}`);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 0 @ ${b7}`);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_green', '-Preuve', `npm test exit 0 @ ${b7}`);
  s.ko(/last implemented commit/, 'set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `MERGEABLE @ ${a7}`, '-Par', 'r1');
  assert.equal(s.task('PRJ-1').evidence.at(-1).sha, b7);
});

test('the emergency stop also holds merges and deploys', () => {
  const s = store();
  green(s);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `MERGEABLE @ ${a7}`, '-Par', 'r1');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'accepted', '-Preuve', 'gate exit 0', '-Par', 'orch');
  s.ok('stop', '-Note', 'owner said stop');
  s.ko(/emergency stop/, 'set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${B}`, '-Par', 'orch');
  s.ko(/emergency stop/, 'set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${B}`, '-Par', 'orch', '-Forcer', '-Note', 'x');
  s.ok('start');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${B}`, '-Par', 'orch');
});

test('a blocked task keeps its area and resumes where it was', () => {
  const s = store();
  s.ok('add', '-Titre', 'one', '-Zone', 'src/a');
  s.ok('add', '-Titre', 'two', '-Zone', 'src/a/sub');
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `commit ${A}`);
  s.ko(/needs -Preuve/, 'set', '-Id', 'PRJ-1', '-Etat', 'blocked');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'blocked', '-Preuve', 'needs the owner to choose the price rule');
  s.ko(/overlaps PRJ-1/, 'claim', '-Id', 'PRJ-2', '-Par', 'w2');
  assert.match(s.ok('zones').out, /PRJ-1/);
  s.ko(/transition blocked -> tests_green/, 'set', '-Id', 'PRJ-1', '-Etat', 'tests_green', '-Preuve', `x exit 0 @ ${a7}`);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `owner chose rule B, still at ${a7}`);
  assert.equal(s.task('PRJ-1').state, 'implemented');
});

test('an expired reservation is listed and can be taken over, a live one cannot', () => {
  const s = store();
  s.ok('add', '-Titre', 'one', '-Zone', 'src/a');
  s.ok('add', '-Titre', 'two', '-Zone', 'src/b');
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1', '-Heures', '-1');
  s.ok('claim', '-Id', 'PRJ-2', '-Par', 'w2');
  const stale = s.ok('stale').out;
  assert.match(stale, /PRJ-1/);
  assert.doesNotMatch(stale, /PRJ-2/);
  s.ko(/held by w2/, 'renew', '-Id', 'PRJ-2', '-Par', 'w3');
  s.ok('renew', '-Id', 'PRJ-1', '-Par', 'w3');
  const t = s.task('PRJ-1');
  assert.equal(t.owner, 'w3');
  assert.match(t.evidence.at(-1).proof, /taken over from w1/);
  assert.doesNotMatch(s.ok('stale').out, /PRJ-1/);
});

test('work in progress is limited per worker and per machine', () => {
  const s = store();
  for (const z of ['a', 'b', 'c', 'd']) s.ok('add', '-Titre', z, '-Zone', `src/${z}`);
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1', '-Machine', 'runner');
  s.ko(/w1 already holds PRJ-1/, 'claim', '-Id', 'PRJ-2', '-Par', 'w1', '-Machine', 'pc1');
  fs.writeFileSync(path.join(s.dir, 'limites.json'), JSON.stringify({ defaut: 6, machines: { runner: 2 } }));
  s.ok('claim', '-Id', 'PRJ-2', '-Par', 'w2', '-Machine', 'RUNNER');
  s.ko(/runner already runs 2 task/i, 'claim', '-Id', 'PRJ-3', '-Par', 'w3', '-Machine', 'runner');
  s.ok('claim', '-Id', 'PRJ-3', '-Par', 'w3', '-Machine', 'pc1');
});

test('fix attempts and review rounds are counted, then the task must be blocked', () => {
  const s = store();
  s.ok('add', '-Titre', 't');
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `commit ${A}`);
  for (let i = 0; i < 3; i++) {
    s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 1 @ ${a7}`);
    s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `commit ${A}`);
  }
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 1 @ ${a7}`);
  s.ko(/3 fix attempts/, 'set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `commit ${A}`);
  // Blocking then resuming (the owner decided, or the approach changed) gives a fresh count.
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'blocked', '-Preuve', 'same test red after 3 attempts: needs another approach');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `owner: change approach; npm test exit 1 @ ${a7}`);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `commit ${A}`);
  for (let i = 0; i < 2; i++) {
    s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 0 @ ${a7}`);
    s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_green', '-Preuve', `npm test exit 0 @ ${a7}`);
    s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `review fixes, commit ${A}`);
  }
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 0 @ ${a7}`);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_green', '-Preuve', `npm test exit 0 @ ${a7}`);
  s.ko(/2 review rounds/, 'set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `review fixes, commit ${A}`);
});

test('release gives back work in progress only', () => {
  const s = store();
  green(s);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'reviewed', '-Preuve', `MERGEABLE @ ${a7}`, '-Par', 'r1');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'accepted', '-Preuve', 'gate exit 0', '-Par', 'orch');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'merged', '-Preuve', `main at ${B}`, '-Par', 'orch');
  s.ko(/nothing to release/, 'release', '-Id', 'PRJ-1', '-Note', 'oops');
  s.ok('add', '-Titre', 'two');
  s.ko(/nothing to release/, 'release', '-Id', 'PRJ-2');
  s.ok('claim', '-Id', 'PRJ-2', '-Par', 'w2');
  s.ok('release', '-Id', 'PRJ-2', '-Note', 'machine needed elsewhere');
  assert.equal(s.task('PRJ-2').state, 'todo');
});

test('dropping needs a reason and a finished task cannot be dropped', () => {
  const s = store();
  s.ok('add', '-Titre', 't');
  s.ko(/needs a reason/, 'set', '-Id', 'PRJ-1', '-Etat', 'dropped');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'dropped', '-Note', 'feature cancelled by the owner');
  s.ko(/transition dropped -> dropped/, 'set', '-Id', 'PRJ-1', '-Etat', 'dropped', '-Note', 'again');
});

test('claim records the base commit of the task', () => {
  const s = store();
  s.ok('add', '-Titre', 't');
  s.ko(/-Base/, 'claim', '-Id', 'PRJ-1', '-Par', 'w1', '-Base', 'main');
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1', '-Base', B);
  assert.equal(s.task('PRJ-1').base_sha, B);
});

test('a register written by the previous version still works', () => {
  const s = store();
  const old = (id, state, evidence, extra = {}) => ({
    id, title: `old ${id}`, state, deps: [], area: `src/${id}`, owner: 'w1', machine: 'pc1', branch: '', lease_until: '2999-01-01T00:00:00Z',
    note: null, evidence, created: '2030-01-01T00:00:00Z', updated: '2030-01-01T00:00:00Z', ...extra,
  });
  const ev = (state, proof) => ({ state, proof, by: 'w1', at: '2030-01-01T00:00:00Z' });
  s.write([
    old('PRJ-1', 'implemented', [ev('doing', 'claimed'), ev('implemented', `commit ${A}`)]),
    old('PRJ-2', 'blocked', [ev('doing', 'claimed'), ev('implemented', `commit ${A}`), ev('tests_run', 'npm test exit 1'), ev('blocked', 'waiting')], { owner: 'w2' }),
    old('PRJ-3', 'tests_green', [ev('doing', 'claimed'), ev('implemented', 'pushed'), ev('tests_green', 'all green')], { owner: 'w3' }),
  ]);
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'tests_run', '-Preuve', `npm test exit 0 @ ${a7}`);
  // No blocked_from on an old task: it resumes at the last state before blocked.
  s.ok('set', '-Id', 'PRJ-2', '-Etat', 'tests_run', '-Preuve', `unblocked; npm test exit 0 @ ${a7}`);
  // No sha in the old implemented proof: nothing to compare with, the new proof is taken.
  s.ok('set', '-Id', 'PRJ-3', '-Etat', 'reviewed', '-Preuve', `MERGEABLE @ ${b7}`, '-Par', 'r1');
  assert.match(s.ok('list').out, /PRJ-3/);
});

test('with -Repo, a ref is resolved at claim and a moved branch is reported at show', () => {
  const s = store();
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'taches-repo-'));
  const git = (...args) => {
    const r = spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.org', '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-q', '-m', 'one');
  const base = git('rev-parse', 'HEAD');
  s.ok('add', '-Titre', 't');
  s.ko(/not a commit/, 'claim', '-Id', 'PRJ-1', '-Par', 'w1', '-Base', 'no-such-branch', '-Repo', repo);
  s.ok('claim', '-Id', 'PRJ-1', '-Par', 'w1', '-Base', 'main', '-Repo', repo);
  assert.equal(s.task('PRJ-1').base_sha, base);

  git('checkout', '-q', '-b', 'w1/topic');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'two\n');
  git('commit', '-q', '-am', 'two');
  const head = git('rev-parse', 'HEAD');
  s.ok('set', '-Id', 'PRJ-1', '-Etat', 'implemented', '-Preuve', `commit ${head}`, '-Branche', 'w1/topic');
  let check = JSON.parse(s.ok('show', '-Id', 'PRJ-1', '-Repo', repo).out).check;
  assert.equal(check.head, head);
  assert.equal(check.stale, false);

  fs.writeFileSync(path.join(repo, 'a.txt'), 'three\n');
  git('commit', '-q', '-am', 'three');
  check = JSON.parse(s.ok('show', '-Id', 'PRJ-1', '-Repo', repo).out).check;
  assert.equal(check.stale, true);
  assert.match(check.warning, /moved since the last implemented proof/);
});
