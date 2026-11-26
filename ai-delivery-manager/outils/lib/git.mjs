// Git history as evidence: commits, their files, and the link between a commit
// and the session that produced it. Read-only: never rewrites history.
import { execFileSync } from 'node:child_process';
import { windowMs } from './sessions.mjs';

const git = (repo, args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });

// Files that say nothing about the work done.
const NOISE = /(^|\/)(node_modules|vendor|dist|build)\/|(^|\/)(package-lock\.json|composer\.lock|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$|\.min\.(js|css)$|\.map$/;
const TEST = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|Test\.php$/i;
const MIGRATION = /migration|\.sql$/i;

export function repoRoots(repo) {
  const out = git(repo, ['worktree', 'list', '--porcelain']);
  return out.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9).trim());
}

export function readCommits(repo, { all = false, since } = {}) {
  const args = ['log', '--no-merges', '--numstat', '--format=%x1e%H%x1f%aI%x1f%cI%x1f%s'];
  if (all) args.push('--all');
  if (since) args.push(`--since=${new Date(since).toISOString()}`);
  const seen = new Set();
  const commits = [];
  for (const block of git(repo, args).split('\x1e').slice(1)) {
    const [head, ...rest] = block.split('\n');
    const [sha, authored, committed, subject] = head.split('\x1f');
    // A rebase or cherry-pick keeps author date and subject: count the work once.
    const dup = `${authored}|${subject}`;
    if (seen.has(dup)) continue;
    seen.add(dup);
    const c = { sha, authored: Date.parse(authored), committed: Date.parse(committed), subject, files: 0, added: 0, deleted: 0, tests: 0, migrations: 0, noise: 0 };
    for (const line of rest) {
      const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      if (m[1] === '-' || NOISE.test(m[3])) { c.noise++; continue; }
      c.files++;
      c.added += +m[1];
      c.deleted += +m[2];
      if (TEST.test(m[3])) c.tests++;
      if (MIGRATION.test(m[3])) c.migrations++;
    }
    c.topic = topicOf(subject);
    c.kind = kindOf(c);
    commits.push(c);
  }
  return commits.sort((a, b) => a.authored - b.authored);
}

// "feat(scope): x" gives "scope"; "Subject : detail" gives "Subject".
export function topicOf(subject) {
  const conv = subject.match(/^[a-z]+\(([^)]+)\)!?:/i);
  if (conv) return conv[1].trim();
  const m = subject.match(/^(.{2,60}?)\s*:\s/);
  return (m ? m[1] : subject.split(/\s+/).slice(0, 3).join(' ')).trim();
}

// Heuristic label from the subject and the files. A hint, not a measure.
export function kindOf(c) {
  const s = c.subject.toLowerCase();
  if (/^(fix|bug|hotfix)|corrig|correctif|régression|regression/.test(s)) return 'fix';
  if (/^refactor|refacto|nettoyage|cleanup|renomm/.test(s)) return 'refactor';
  if (/^docs?\b|readme|documentation/.test(s)) return 'docs';
  if (c.files > 0 && c.tests === c.files) return 'tests';
  if (c.migrations > 0) return 'migration';
  return 'feature';
}

// Links each commit to the session whose `git commit` output first showed its hash.
// A commit seen in no session stays "unknown": no duration is invented for it.
export function linkCommits(commits, sessions) {
  const byPrefix = new Map();
  for (const c of commits) {
    const k = c.sha.slice(0, 7);
    if (!byPrefix.has(k)) byPrefix.set(k, []);
    byPrefix.get(k).push(c);
  }
  const linked = new Set();
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    let from = s.start;
    for (const ev of s.commits) {
      const found = [];
      for (const token of ev.shas) {
        for (const c of byPrefix.get(token.slice(0, 7)) || []) {
          if (c.sha.startsWith(token) && !linked.has(c.sha)) { linked.add(c.sha); c.link = 'hash'; found.push(c); }
        }
      }
      // A quiet commit prints no hash: fall back on the author date falling inside the tool call.
      if (!found.length && ev.t0) {
        for (const c of commits) {
          if (!linked.has(c.sha) && c.authored >= ev.t0 - 1000 && c.authored <= ev.t + 1000) { linked.add(c.sha); c.link = 'timestamp'; found.push(c); }
        }
      }
      if (!found.length) continue;
      const ms = windowMs(s, from, ev.t);
      for (const c of found) {
        c.session = s.file;
        c.models = s.models;
        c.ms = Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, v / found.length]));
        c.activeMs = c.ms.model + c.ms.tool;
      }
      from = ev.t;
    }
    s.tailFrom = from; // session time after its last linked commit is attributed to no commit
  }
  return commits;
}

export function groupByTopic(commits) {
  const topics = new Map();
  for (const c of commits) {
    if (!topics.has(c.topic)) topics.set(c.topic, { topic: c.topic, commits: 0, linked: 0, activeMs: 0, humanActiveMs: 0, files: 0, added: 0, first: c.authored, last: c.authored, kinds: {} });
    const t = topics.get(c.topic);
    t.commits++;
    t.files += c.files;
    t.added += c.added;
    t.first = Math.min(t.first, c.authored);
    t.last = Math.max(t.last, c.authored);
    t.kinds[c.kind] = (t.kinds[c.kind] || 0) + 1;
    if (c.ms) { t.linked++; t.activeMs += c.activeMs; t.humanActiveMs += c.ms.humanActive; }
  }
  return [...topics.values()].sort((a, b) => b.activeMs - a.activeMs);
}
