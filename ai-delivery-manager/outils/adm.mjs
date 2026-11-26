#!/usr/bin/env node
// ai-delivery-manager: measured durations and evidence-based estimates.
// Usage: node adm.mjs <command> [--option value]   (see `node adm.mjs help`)
import { execFileSync } from 'node:child_process';
import { loadSessions, windowMs, underAny, defaultLogsDir } from './lib/sessions.mjs';
import { readCommits, linkCommits, groupByTopic, repoRoots } from './lib/git.mjs';
import { quantiles, pert, calibration, min, fmtMin, parseSince, MIN_SAMPLES } from './lib/stats.mjs';
import * as store from './lib/store.mjs';

const HELP = `Commands
  sessions  [--project <text>] [--since 7d]            measured time per session log
  history   [--repo .] [--since 90d] [--topic <regex>] [--all]
                                                      active AI time per commit topic, from git + sessions
  estimate  --o <min> --m <min> --p <min> [--project P] [--category C] [--similar <regex>] [--repo .]
                                                      three-point estimate, calibrated on past tasks
  task estimate --id ID --title T --project P --category C --o --m --p [--human-min N]
  task start    --id ID [--branch B]
  task revise   --id ID --o --m --p --reason R
  task done     --id ID --proof "<command + exit code | sha | url>"
  task abandon  --id ID --reason R
  task list     [--project P]
  review    [--project P] [--category C]              estimates against measured results
Options everywhere: --json, --logs <dir> (default ${defaultLogsDir()})
All durations are minutes of measured time. Store: ${store.home()}`;

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opt[k] = true; else { opt[k] = next; i++; }
  }
  return { pos, opt };
}

const need = (opt, ...keys) => { for (const k of keys) if (opt[k] === undefined || opt[k] === true) throw new Error(`missing --${k}`); };
const num = (opt, k) => { const n = Number(opt[k]); if (!Number.isFinite(n) || n < 0) throw new Error(`--${k} must be a number of minutes`); return n; };
const out = (opt, data, text) => console.log(opt.json ? JSON.stringify(data, null, 2) : text);
const sessionsOf = (opt) => loadSessions({ logs: opt.logs || defaultLogsDir(), cacheFile: store.cacheFile() });
const date = (t) => new Date(t).toISOString().slice(0, 10);
const pad = (s, n) => String(s).slice(0, n).padEnd(n);

function threePoints(opt) {
  need(opt, 'o', 'm', 'p');
  const o = num(opt, 'o'), m = num(opt, 'm'), p = num(opt, 'p');
  if (!(o <= m && m <= p)) throw new Error('need optimistic <= likely <= pessimistic');
  return { o, m, p, pert: Math.round(pert(o, m, p)) };
}

function donePairs(filter = {}) {
  return store.tasks().filter((t) => t.state === 'done' && t.actual
    && (!filter.project || t.project === filter.project)
    && (!filter.category || t.category === filter.category))
    .map((t) => ({ id: t.id, title: t.title, category: t.category, estimate: t.initial.pert, low: t.initial.o, high: t.initial.p, actual: t.actual.activeMin, revisions: t.revisions.length }));
}

async function cmdSessions(opt) {
  const since = parseSince(opt.since);
  const list = (await sessionsOf(opt)).filter((s) => (!since || s.end >= since)
    && (!opt.project || String(s.cwd).toLowerCase().includes(String(opt.project).toLowerCase())));
  const total = { model: 0, tool: 0, humanActive: 0, humanAway: 0, unknown: 0 };
  for (const s of list) for (const k in total) total[k] += s.ms[k];
  const data = {
    sessions: list.length,
    activeMin: min(total.model + total.tool), modelMin: min(total.model), toolMin: min(total.tool),
    humanActiveMin: min(total.humanActive), humanAwayMin: min(total.humanAway), unknownMin: min(total.unknown),
    outputTokens: list.reduce((a, s) => a + s.tokens.output, 0),
    subagentOutputTokens: list.reduce((a, s) => a + (s.tokens.subagentOutput || 0), 0),
  };
  out(opt, data, [
    `${data.sessions} sessions`,
    `AI active      ${fmtMin(data.activeMin)}  (model ${fmtMin(data.modelMin)}, tools ${fmtMin(data.toolMin)})`,
    `Human active   ${fmtMin(data.humanActiveMin)}  (gaps up to 5 min before a prompt)`,
    `Human away     ${fmtMin(data.humanAwayMin)}  (longer gaps: not work)`,
    `Unknown        ${fmtMin(data.unknownMin)}  (gaps above the caps: sleep, quota, open permission prompt)`,
    `Output tokens  ${data.outputTokens} main, ${data.subagentOutputTokens} sub-agents`,
  ].join('\n'));
}

async function history(opt) {
  const repo = opt.repo || '.';
  const since = parseSince(opt.since);
  const roots = repoRoots(repo);
  const sessions = (await sessionsOf(opt)).filter((s) => underAny(s.cwd, roots));
  let commits = linkCommits(readCommits(repo, { all: !!opt.all, since }), sessions);
  if (opt.topic) { const re = new RegExp(opt.topic, 'i'); commits = commits.filter((c) => re.test(c.topic) || re.test(c.subject)); }
  return { commits, sessions, since };
}

async function cmdHistory(opt) {
  const { commits, sessions, since } = await history(opt);
  const topics = groupByTopic(commits);
  const linked = commits.filter((c) => c.ms);
  const perCommit = quantiles(linked.map((c) => c.activeMs / 60000));
  let tail = 0;
  for (const s of sessions) if (!since || s.end >= since) { const w = windowMs(s, s.tailFrom ?? s.start, s.end); tail += w.model + w.tool; }
  const data = {
    commits: commits.length, linked: linked.length,
    activeMinPerCommit: perCommit,
    notAttributedMin: min(tail),
    topics: topics.map((t) => ({ topic: t.topic, commits: t.commits, linked: t.linked, activeMin: min(t.activeMs), humanActiveMin: min(t.humanActiveMs), files: t.files, added: t.added, first: date(t.first), last: date(t.last), kinds: t.kinds })),
  };
  const lines = [
    `${data.commits} commits, ${data.linked} linked to a session (the others: duration unknown)`,
    `Active AI minutes per linked commit: n=${perCommit.n}  P50 ${fmtMin(perCommit.p50)}  P80 ${fmtMin(perCommit.p80)}  P95 ${fmtMin(perCommit.p95)}`,
    `Session time attributed to no commit: ${fmtMin(data.notAttributedMin)}`,
    '',
    `${pad('topic', 44)} ${pad('commits', 8)} ${pad('linked', 7)} ${pad('AI active', 10)} ${pad('human', 9)} ${pad('files', 6)} first..last`,
    ...data.topics.slice(0, opt.top ? +opt.top : 40).map((t) => `${pad(t.topic, 44)} ${pad(t.commits, 8)} ${pad(t.linked, 7)} ${pad(t.linked ? fmtMin(t.activeMin) : 'unknown', 10)} ${pad(t.linked ? fmtMin(t.humanActiveMin) : '-', 9)} ${pad(t.files, 6)} ${t.first}..${t.last}`),
  ];
  out(opt, data, lines.join('\n'));
}

async function cmdEstimate(opt) {
  const pts = threePoints(opt);
  const cal = calibration(donePairs({ project: opt.project, category: opt.category }));
  const data = { ...pts, unit: 'minutes of active AI time', calibration: cal, calibrated: null, similar: null };
  const lines = [`Three-point: optimistic ${fmtMin(pts.o)}, likely ${fmtMin(pts.m)}, pessimistic ${fmtMin(pts.p)}  ->  PERT ${fmtMin(pts.pert)} of active AI time`];
  if (cal.usable) {
    data.calibrated = { p50: Math.round(pts.pert * cal.medianRatio), p80: cal.p80Ratio ? Math.round(pts.pert * cal.p80Ratio) : null };
    lines.push(`Calibration on ${cal.n} finished tasks: real/estimate median x${cal.medianRatio.toFixed(2)}${cal.p80Ratio ? `, P80 x${cal.p80Ratio.toFixed(2)}` : ''}`,
      `Calibrated: P50 ${fmtMin(data.calibrated.p50)}${data.calibrated.p80 ? `, P80 ${fmtMin(data.calibrated.p80)}` : ' (P80 needs 10 tasks)'}`);
  } else {
    lines.push(`Calibration: ${cal.n} finished task(s) for this filter, ${MIN_SAMPLES.p50} needed. The PERT value is uncalibrated: say so.`);
  }
  if (opt.similar) {
    const { commits } = await history({ ...opt, topic: opt.similar });
    const topics = groupByTopic(commits).filter((t) => t.linked);
    const q = quantiles(topics.map((t) => t.activeMs / 60000));
    data.similar = { topics: topics.map((t) => ({ topic: t.topic, commits: t.commits, linked: t.linked, activeMin: min(t.activeMs), humanActiveMin: min(t.humanActiveMs) })), quantiles: q };
    lines.push('', `Comparable topics in git matching /${opt.similar}/ (measured):`,
      ...(topics.length ? topics.slice(0, 15).map((t) => `  ${pad(t.topic, 44)} ${fmtMin(min(t.activeMs))} AI active, ${t.linked}/${t.commits} commits linked`) : ['  none with a measured duration']),
      q.p50 != null ? `  per topic: P50 ${fmtMin(q.p50)}${q.p80 != null ? `, P80 ${fmtMin(q.p80)}` : ''} (n=${q.n})` : `  n=${q.n}: too few for a quantile, quote the cases above instead`);
  }
  out(opt, data, lines.join('\n'));
}

function gitBranch() {
  try { return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

async function measureTask(t, opt, until) {
  let roots = [t.cwd];
  try { roots = repoRoots(t.cwd); } catch { /* not a git repository: the folder itself */ }
  const from = Date.parse(t.startedAt);
  const list = (await sessionsOf(opt)).filter((s) => underAny(s.cwd, roots) && s.end >= from && s.start <= until
    && (!t.branch || s.branches.includes(t.branch)));
  const ms = { model: 0, tool: 0, humanActive: 0, humanAway: 0, unknown: 0 };
  let counted = 0;
  for (const s of list) {
    const w = windowMs(s, from, until);
    if (w.model + w.tool === 0) continue;
    counted++;
    for (const k in ms) ms[k] += w[k];
  }
  return {
    activeMin: min(ms.model + ms.tool), modelMin: min(ms.model), toolMin: min(ms.tool),
    humanActiveMin: min(ms.humanActive), humanAwayMin: min(ms.humanAway), unknownMin: min(ms.unknown),
    elapsedMin: min(until - from), sessions: counted,
    attribution: t.branch ? 'time window + branch' : 'time window + folder',
    // Several sessions in the window may have worked on something else: the figure is then an upper bound.
    reliability: counted === 0 ? 'unknown' : counted === 1 ? 'measured' : 'upper bound (several sessions in the window)',
  };
}

async function cmdTask(sub, opt) {
  if (sub === 'list') {
    const list = store.tasks().filter((t) => !opt.project || t.project === opt.project);
    return out(opt, list, list.map((t) => `${pad(t.id, 14)} ${pad(t.state, 10)} ${pad(t.category || '-', 14)} est ${pad(fmtMin(t.initial.pert), 9)} real ${pad(t.actual ? fmtMin(t.actual.activeMin) : '-', 9)} ${t.title || ''}`).join('\n') || 'no task');
  }
  need(opt, 'id');
  const t = store.tasks().find((x) => x.id === opt.id);
  if (sub === 'estimate') {
    need(opt, 'title', 'project', 'category');
    if (t) throw new Error(`task ${opt.id}: already estimated (use "task revise")`);
    const e = store.append({ ev: 'estimate', id: opt.id, title: opt.title, project: opt.project, category: opt.category, ...threePoints(opt), humanMin: opt['human-min'] !== undefined ? num(opt, 'human-min') : null });
    return out(opt, e, `${opt.id}: estimate recorded, PERT ${fmtMin(e.pert)} of active AI time`);
  }
  if (!t) throw new Error(`task ${opt.id}: no estimate recorded (run "task estimate" first)`);
  if (sub === 'start') {
    const e = store.append({ ev: 'start', id: opt.id, cwd: process.cwd(), branch: opt.branch === undefined ? gitBranch() : opt.branch });
    return out(opt, e, `${opt.id}: started ${e.at} on ${e.branch || e.cwd}`);
  }
  if (sub === 'revise') {
    need(opt, 'reason');
    const e = store.append({ ev: 'revise', id: opt.id, reason: opt.reason, ...threePoints(opt) });
    return out(opt, e, `${opt.id}: revised to PERT ${fmtMin(e.pert)} (initial ${fmtMin(t.initial.pert)} kept)`);
  }
  if (sub === 'abandon') {
    need(opt, 'reason');
    return out(opt, store.append({ ev: 'abandon', id: opt.id, reason: opt.reason }), `${opt.id}: abandoned`);
  }
  if (sub === 'done') {
    need(opt, 'proof');
    if (!t.startedAt) throw new Error(`task ${opt.id}: never started, no duration can be measured (run "task start" when work begins)`);
    const actual = await measureTask(t, opt, Date.now());
    const e = store.append({ ev: 'done', id: opt.id, proof: opt.proof, actual });
    return out(opt, e, [
      `${opt.id}: done. Proof: ${opt.proof}`,
      `Estimated ${fmtMin(t.initial.pert)} (range ${fmtMin(t.initial.o)}..${fmtMin(t.initial.p)}), measured ${fmtMin(actual.activeMin)} of active AI time [${actual.reliability}]`,
      `Human active ${fmtMin(actual.humanActiveMin)}, away ${fmtMin(actual.humanAwayMin)}, unknown ${fmtMin(actual.unknownMin)}, elapsed ${fmtMin(actual.elapsedMin)}, ${actual.sessions} session(s), by ${actual.attribution}`,
    ].join('\n'));
  }
  throw new Error(`unknown task command "${sub}"`);
}

function cmdReview(opt) {
  const pairs = donePairs({ project: opt.project, category: opt.category });
  const cal = calibration(pairs);
  const lines = pairs.map((x) => `${pad(x.id, 14)} ${pad(x.category || '-', 14)} est ${pad(fmtMin(x.estimate), 9)} real ${pad(fmtMin(x.actual), 9)} x${(x.actual / x.estimate).toFixed(2)}${x.revisions ? `  (${x.revisions} revision(s))` : ''}`);
  if (!cal.n) lines.push('no finished task with a measured duration yet');
  else lines.push('', `n=${cal.n}  median real/estimate x${cal.medianRatio.toFixed(2)}  overruns ${cal.overruns}/${cal.n}  mean abs error ${fmtMin(cal.meanAbsErrorMin)}`,
    cal.rangeN ? `real inside the announced range: ${Math.round(cal.rangeCoverage * 100)} % (${cal.rangeN} tasks)` : '',
    cal.usable ? '' : `fewer than ${MIN_SAMPLES.p50} tasks: do not correct estimates from this yet`);
  out(opt, { pairs, calibration: cal }, lines.filter((l) => l !== '').join('\n'));
}

const { pos, opt } = parseArgs(process.argv.slice(2));
try {
  const [cmd, sub] = pos;
  if (cmd === 'sessions') await cmdSessions(opt);
  else if (cmd === 'history') await cmdHistory(opt);
  else if (cmd === 'estimate') await cmdEstimate(opt);
  else if (cmd === 'task') await cmdTask(sub, opt);
  else if (cmd === 'review') cmdReview(opt);
  else console.log(HELP);
} catch (e) {
  console.error(`adm: ${e.message}`);
  process.exit(1);
}
