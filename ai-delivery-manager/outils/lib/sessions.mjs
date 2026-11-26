// Reads agent session logs (Claude Code JSONL transcripts) and turns real
// timestamps into measured durations. Nothing here is guessed: a gap that
// cannot be classified is counted as "unknown".
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

export const DEFAULTS = {
  modelCapMs: 10 * 60e3, // a model gap longer than this is not counted as work (sleep, quota, crash)
  toolCapMs: 15 * 60e3, // same for a tool gap (permission prompt left open, background wait)
  humanActiveMs: 5 * 60e3, // a human gap up to this is "reading and answering"; longer is "away"
};

// Segment classes, stored as small integers in the cache.
export const CLASS = { model: 0, tool: 1, humanActive: 2, humanAway: 3, unknown: 4 };
export const CLASS_NAMES = Object.keys(CLASS);

const NOT_HUMAN = /^\s*<(command-|local-command|task-notification|system-reminder)/;

export function classifyUser(entry) {
  const content = entry.message?.content;
  if (Array.isArray(content)) {
    if (content.some((c) => c.type === 'tool_result')) return 'tool';
    return entry.isMeta ? 'meta' : 'human';
  }
  if (typeof content === 'string') {
    return entry.isMeta || NOT_HUMAN.test(content) ? 'meta' : 'human';
  }
  return 'meta';
}

function resultText(part) {
  if (typeof part.content === 'string') return part.content;
  if (Array.isArray(part.content)) return part.content.map((c) => c.text || '').join('\n');
  return '';
}

// Builds the measured summary of one session from its entries (already parsed).
export function analyzeEntries(entries, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const s = {
    sessionId: null, cwd: null, entrypoint: null, branches: [], models: [],
    start: null, end: null, prompts: 0,
    ms: { model: 0, tool: 0, humanActive: 0, humanAway: 0, unknown: 0 },
    tokens: { input: 0, output: 0 },
    segs: [], // flat triples: endTime, class, duration
    commits: [], // { t0, t, shas } : a `git commit` tool call (start, end) and the hashes its output shows
  };
  const usage = new Map();
  const pendingCommit = new Map();
  let prev = null;

  for (const e of entries) {
    if (!e || !e.timestamp || (e.isSidechain && !o.sidechain)) continue;
    if (e.type !== 'user' && e.type !== 'assistant') continue;
    const t = Date.parse(e.timestamp);
    if (Number.isNaN(t)) continue;

    s.sessionId ??= e.sessionId ?? null;
    s.cwd ??= e.cwd ?? null;
    s.entrypoint ??= e.entrypoint ?? null;
    if (e.gitBranch && !s.branches.includes(e.gitBranch)) s.branches.push(e.gitBranch);
    s.start ??= t;
    s.end = t;

    let kind;
    if (e.type === 'assistant') {
      kind = 'model';
      const m = e.message || {};
      if (m.model && !s.models.includes(m.model)) s.models.push(m.model);
      if (m.id && m.usage) usage.set(m.id, m.usage);
      for (const c of Array.isArray(m.content) ? m.content : []) {
        if (c.type === 'tool_use' && /git\s+(commit|cherry-pick)/.test(JSON.stringify(c.input || {}))) {
          pendingCommit.set(c.id, t);
        }
      }
    } else {
      kind = classifyUser(e);
      if (kind === 'human') s.prompts++;
      if (kind === 'tool') {
        for (const c of e.message.content) {
          if (c.type !== 'tool_result' || !pendingCommit.has(c.tool_use_id)) continue;
          const t0 = pendingCommit.get(c.tool_use_id);
          pendingCommit.delete(c.tool_use_id);
          if (c.is_error) continue;
          const shas = [...new Set(resultText(c).match(/\b[0-9a-f]{7,40}\b/g) || [])].slice(0, 20);
          s.commits.push({ t0, t, shas });
        }
      }
    }

    if (prev !== null && kind !== 'meta') {
      const d = t - prev;
      let cls;
      if (kind === 'model') cls = d > o.modelCapMs ? 'unknown' : 'model';
      else if (kind === 'tool') cls = d > o.toolCapMs ? 'unknown' : 'tool';
      else cls = d > o.humanActiveMs ? 'humanAway' : 'humanActive';
      if (d > 0) {
        s.ms[cls] += d;
        s.segs.push(t, CLASS[cls], d);
      }
    }
    if (kind !== 'meta') prev = t;
  }

  for (const u of usage.values()) {
    s.tokens.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    s.tokens.output += u.output_tokens || 0;
  }
  return s;
}

async function readEntries(file) {
  const entries = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    // Cheap pre-filter: only user and assistant entries carry what we measure.
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    try { entries.push(slim(JSON.parse(line))); } catch { /* a truncated last line after a crash */ }
  }
  return entries;
}

// Sub-agent transcripts live in <session>/subagents/. Their wall time is already inside
// the parent session's tool gaps; they add their commits and their output tokens.
export const subagentFiles = (file) => {
  const dir = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)) : [];
};

export async function analyzeFile(file, opts) {
  const s = analyzeEntries(await readEntries(file), opts);
  s.file = file;
  s.tokens.subagentOutput = 0;
  for (const sub of subagentFiles(file)) {
    const a = analyzeEntries(await readEntries(sub), { ...opts, sidechain: true });
    s.commits.push(...a.commits);
    s.tokens.subagentOutput += a.tokens.output;
  }
  s.commits.sort((a, b) => a.t - b.t);
  return s;
}

// Drops the heavy payloads before the entry is kept in memory.
function slim(e) {
  const m = e.message;
  if (m && Array.isArray(m.content)) {
    m.content = m.content.map((c) => {
      if (c.type === 'tool_use') return { type: c.type, id: c.id, input: commitOnly(c.input) };
      if (c.type === 'tool_result') return { type: c.type, tool_use_id: c.tool_use_id, is_error: c.is_error, content: resultText(c).slice(0, 4000) };
      return { type: c.type };
    });
  } else if (m && typeof m.content === 'string') {
    m.content = m.content.slice(0, 80);
  }
  return e;
}

function commitOnly(input) {
  const cmd = input && typeof input.command === 'string' ? input.command : '';
  return /git\s+(commit|cherry-pick)/.test(cmd) ? { command: 'git commit' } : {};
}

export function defaultLogsDir() {
  return process.env.ADM_LOGS || path.join(os.homedir(), '.claude', 'projects');
}

export function listLogFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (d.isFile() && d.name.endsWith('.jsonl')) out.push(path.join(root, d.name));
    if (!d.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(root, d.name))) {
      if (f.endsWith('.jsonl')) out.push(path.join(root, d.name, f));
    }
  }
  return out;
}

// Incremental index: a log file is parsed again only when its size or mtime changed.
export async function loadSessions({ logs = defaultLogsDir(), cacheFile, opts } = {}) {
  let cache = {};
  if (cacheFile && fs.existsSync(cacheFile)) {
    try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { cache = {}; }
  }
  const next = {};
  let parsed = 0;
  for (const file of listLogFiles(logs)) {
    const st = fs.statSync(file);
    const key = `2:${st.size}:${Math.floor(st.mtimeMs)}:${subagentFiles(file).length}`;
    const hit = cache[file];
    if (hit && hit.key === key) { next[file] = hit; continue; }
    next[file] = { key, s: await analyzeFile(file, opts) };
    parsed++;
  }
  if (cacheFile && parsed) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next));
    fs.renameSync(tmp, cacheFile);
  }
  return Object.values(next).map((v) => v.s).filter((s) => s.start !== null);
}

// Measured time of one session inside [from, to], by class.
export function windowMs(session, from, to) {
  const ms = { model: 0, tool: 0, humanActive: 0, humanAway: 0, unknown: 0 };
  const g = session.segs;
  for (let i = 0; i < g.length; i += 3) {
    const end = g[i], start = end - g[i + 2];
    const a = Math.max(start, from), b = Math.min(end, to);
    if (b > a) ms[CLASS_NAMES[g[i + 1]]] += b - a;
  }
  return ms;
}

export const normPath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export function underAny(cwd, roots) {
  const c = normPath(cwd);
  return roots.some((r) => { const n = normPath(r); return c === n || c.startsWith(n + '/'); });
}
