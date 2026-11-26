// Task history: an append-only event log. An estimate is never rewritten;
// a revision is a new event that keeps the first one visible.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const home = () => process.env.ADM_HOME || path.join(os.homedir(), '.ai-delivery-manager');
export const eventsFile = () => path.join(home(), 'tasks.jsonl');
export const cacheFile = () => path.join(home(), 'cache', 'sessions.json');

export function append(event) {
  fs.mkdirSync(home(), { recursive: true });
  const e = { v: 1, at: new Date().toISOString(), machine: os.hostname(), ...event };
  fs.appendFileSync(eventsFile(), JSON.stringify(e) + '\n'); // one short line per append: safe across sessions
  return e;
}

export function readEvents() {
  if (!fs.existsSync(eventsFile())) return [];
  return fs.readFileSync(eventsFile(), 'utf8').split('\n').filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

// Folds the events into the current state of each task.
export function tasks(events = readEvents()) {
  const map = new Map();
  for (const e of events) {
    if (e.ev === 'estimate') {
      if (map.has(e.id)) continue; // the first estimate stands
      map.set(e.id, { id: e.id, title: e.title, project: e.project, category: e.category, state: 'estimated', initial: pick(e), estimate: pick(e), revisions: [], createdAt: e.at });
      continue;
    }
    const t = map.get(e.id);
    if (!t) continue;
    if (e.ev === 'revise') { t.revisions.push({ at: e.at, reason: e.reason, ...pick(e) }); t.estimate = pick(e); }
    if (e.ev === 'start') { t.state = 'doing'; t.startedAt ??= e.at; t.cwd = e.cwd; t.branch = e.branch; }
    if (e.ev === 'done') { t.state = 'done'; t.doneAt = e.at; t.proof = e.proof; t.actual = e.actual; }
    if (e.ev === 'abandon') { t.state = 'abandoned'; t.doneAt = e.at; t.reason = e.reason; }
  }
  return [...map.values()];
}

const pick = (e) => ({ o: e.o, m: e.m, p: e.p, pert: e.pert, humanMin: e.humanMin ?? null });
