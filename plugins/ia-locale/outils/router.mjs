#!/usr/bin/env node
// router.mjs — who does this task? Decided by rules, not by a model.
// Input: the task text. It asks contexte.mjs which files are concerned, reads their risk level,
// their size and their tests, looks at the machine (free memory, a call in progress, the hours
// declared free) and at the measured success rates when there are any, then prints ONE decision:
// level, tool, model, when, the reasons, and the command to run. The orchestrator follows it, or
// overrides it with a stated reason. Every decision is logged: $AI_ROOT/logs/routage.jsonl.
//
//   node router.mjs --projet <name> --tache "<task>" [--json] [--urgent]
//
// Levels: 0 no model | 1 local one-shot question | 2 local direct change | 3 local agent session
//         | 4 paid model (Claude, Codex) | H human decision first
// Policy file (optional, versioned by you): $AI_ROOT/config/routage.json — see routage.exemple.json.
// "local_models": false in the policy = a machine with no local model: only levels 0, 4 and H are used.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); if (i < 0) return d; const v = process.argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v; };
const AI_ROOT = process.env.AI_ROOT; if (!AI_ROOT) { console.error('AI_ROOT is not set.'); process.exit(1); }
const projet = arg('projet'), tache = arg('tache'); if (!projet || !tache || tache === true) { console.error('Usage: node router.mjs --projet <name> --tache "<task>" [--json] [--urgent]'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const policy = { version: 0, direct_max_files: 2, direct_max_chars: 50000, min_relevance: 60, min_samples: 5, min_success: 0.5,
  free_hours: [], day_model: 'small', agent_model: 'coding',
  keywords: {
    human: ['prix', 'tarif', 'cgv', 'cgu', 'mentions légales', 'rgpd', 'contrat', 'secret', 'mot de passe', 'production', 'prod '],
    paid: ['architecture', 'refonte', 'réécri', 'migration', 'sécurité', 'security', 'faille', 'vulnérab', 'authentification', 'multi-tenant', 'isolation', 'transvers', 'audit'],
    ask: ['résume', 'résumé', 'explique', 'expliquer', 'que fait', 'documente', 'documentation', 'commentaire', 'message de commit', 'classe ces', 'trie ', 'liste les', 'summar', 'explain'],
    none: ['où est', 'ou est', 'trouve', 'cherche', 'qui appelle', 'qui utilise', 'combien de', 'lance les tests', 'formate', 'where is', 'find '],
  }, ...readJson(path.join(AI_ROOT, 'config', 'routage.json'), {}) };
const engine = readJson(path.join(AI_ROOT, 'config', 'moteur.json'), {});
const cfg = readJson(path.join(AI_ROOT, 'config', 'projets', projet, 'carte.json'), null); if (!cfg) { console.error(`No map config for project ${projet}.`); process.exit(1); }
const lower = String(tache).toLowerCase(); const has = (list) => (list || []).find((k) => lower.includes(k));
const reasons = []; const out = { project: projet, task: tache, policy_version: policy.version };

// ---------- facts about the task ----------
const pack = JSON.parse(execFileSync(process.execPath, [path.join(here, 'contexte.mjs'), '--projet', projet, '--tache', tache, '--fichiers', '8', '--budget', '100000', '--json'], { encoding: 'utf8', env: process.env, maxBuffer: 1 << 26 }));
const files = pack.files || []; const LEVELS = ['low', 'moderate', 'high', 'critical'];
const size = (p) => { try { return fs.statSync(path.join(cfg.repo, p)).size; } catch { return 0; } };
const likely = files.slice(0, policy.direct_max_files + 1); // contexte.mjs ranks; the first ones are the candidates
const worst = files.slice(0, 4).reduce((a, f) => (f.risk === 'FORBIDDEN' ? 'FORBIDDEN' : (a !== 'FORBIDDEN' && LEVELS.indexOf(f.risk) > LEVELS.indexOf(a) ? f.risk : a)), 'low');
const withTests = files.slice(0, 3).filter((f) => (f.tests || []).length).length;
out.facts = { files_found: files.length, top_files: files.slice(0, 4).map((f) => `${f.path} (${f.risk})`), worst_risk: worst, top_files_with_tests: withTests };

// ---------- facts about the machine ----------
const freeGb = os.freemem() / 2 ** 30; const now = new Date(); const hhmm = now.getHours() * 60 + now.getMinutes();
const inWindow = (w) => { const [a, b] = w.split('-').map((x) => { const [h, m] = x.split(':').map(Number); return h * 60 + (m || 0); }); return a <= b ? (hhmm >= a && hhmm < b) : (hhmm >= a || hhmm < b); };
const freeNow = (policy.free_hours || []).some(inWindow);
const nextFree = () => { const starts = (policy.free_hours || []).map((w) => w.split('-')[0]); if (!starts.length) return null; const mins = starts.map((s) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); }).sort((a, b) => a - b); const n = mins.find((m) => m > hhmm) ?? mins[0]; return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
const modelName = (role) => engine.models?.[role] || role; const ram = (name) => engine.ram_gb?.[name] ?? null; const keep = engine.keep_free_gb ?? 8;
let loaded = []; let engineUp = false;
try {
  const h = {}; if (engine.api_key_file && fs.existsSync(engine.api_key_file)) h.Authorization = 'Bearer ' + fs.readFileSync(engine.api_key_file, 'utf8').trim();
  const url = engine.type === 'ollama' ? `${engine.base_url}/api/ps` : `${engine.base_url || 'http://127.0.0.1:8080'}/v1/models`;
  const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(1500) }); const j = await r.json(); engineUp = true;
  loaded = engine.type === 'ollama' ? (j.models || []).map((m) => m.name) : (j.data || []).filter((m) => m.status?.value === 'loaded').map((m) => m.id);
} catch { /* engine stopped: nothing is loaded */ }
// A model already in memory fits by definition. Another model in memory means the engine is busy: one model at a time.
const busyWith = (name) => loaded.length && !loaded.includes(name) ? loaded[0] : null;
const fits = (name) => loaded.includes(name) || (!busyWith(name) && (ram(name) === null || freeGb - ram(name) >= keep));
const whyNot = (name) => busyWith(name) ? `the local engine is busy with another model (${busyWith(name)})` : `only ${Math.round(freeGb)} GB are free: ${name} does not fit now`;
out.machine = { free_gb: Math.round(freeGb), free_hours_now: freeNow, next_free_hour: nextFree(), engine_running: engineUp, models_loaded: loaded };

// ---------- measured success rates, when there are enough samples ----------
const matrix = readJson(path.join(AI_ROOT, 'benchmarks', 'matrice.json'), {}); // { "<tool>|<model>": {n, success} }
const trusted = (tool, model) => { const m = matrix[`${tool}|${model}`]; if (!m || m.n < policy.min_samples) return { known: false, ok: true }; return { known: true, ok: m.success / m.n >= policy.min_success, rate: m.success / m.n, n: m.n }; };

// ---------- decision ----------
const decide = (level, tool, model, when, command) => Object.assign(out, { level, tool, model, when, command });
const q = JSON.stringify(tache); let k;
if (worst === 'FORBIDDEN') { reasons.push('a file that must never be edited is among the targets'); decide('H', 'human', null, 'now', null); }
else if ((k = has(policy.keywords.human))) { reasons.push(`the task mentions "${k.trim()}": a decision that belongs to the owner`); decide('H', 'human', null, 'now', null); }
else if ((k = has(policy.keywords.none))) { reasons.push(`"${k.trim()}": a lookup, no model needed`); decide(0, 'contexte.mjs', null, 'now', `node contexte.mjs --projet ${projet} --tache ${q}`); }
else if (policy.local_models === false) {
  // No local model on this machine: the deterministic tools serve the paid session directly.
  reasons.push('local models are disabled on this machine (routage.json: local_models = false)');
  if (worst === 'critical' || worst === 'high') reasons.push(`a target file is rated ${worst}: a human must approve the change`);
  reasons.push('give the paid session the context pack instead of letting it explore, then check its change with ia-valider.ps1');
  decide(4, 'paid', null, 'now', `node contexte.mjs --projet ${projet} --tache ${q} --budget 6000`);
}
else if ((k = has(policy.keywords.ask))) {
  const m = modelName('small'); reasons.push(`"${k.trim()}": reading and summarising, the small local model is enough`);
  if (fits(m)) decide(1, 'ia-ask.ps1', m, 'now', `ia-ask.ps1 -Task ${q} -Files <files> -Model ${m} -Quiet`); else { reasons.push('but ' + whyNot(m)); decide(arg('urgent') ? 4 : 1, arg('urgent') ? 'paid' : 'ia-ask.ps1', arg('urgent') ? null : m, arg('urgent') ? 'now' : 'when the local engine is free', null); }
}
else if (worst === 'critical' || (k = has(policy.keywords.paid))) { reasons.push(worst === 'critical' ? 'a target file is rated critical (authentication, tenant isolation, configuration)' : `the task mentions "${k.trim()}": architecture or security work`); decide(4, 'paid', null, 'now', null); reasons.push('send it the context pack and the files only, and ask the owner to approve the result'); }
else if (!files.length) { reasons.push('no file matched the task: it cannot be given to a local model blindly'); decide(4, 'paid', null, 'now', null); reasons.push('or reword the task with a file, class, function or table name'); }
else {
  if (worst === 'high') reasons.push('a target file is rated high: the change needs a human approval whoever writes it');
  const chars = likely.slice(0, policy.direct_max_files).reduce((a, f) => a + size(f.path), 0);
  const narrow = chars > 0 && chars <= policy.direct_max_chars; const dayModel = modelName(policy.day_model), bigModel = modelName(policy.agent_model);
  const direct = trusted('ia-patch', freeNow ? bigModel : dayModel), agent = trusted('ia-run', bigModel);
  const flist = likely.slice(0, policy.direct_max_files).map((f) => f.path).join(',');
  if (narrow && direct.ok) {
    const m = freeNow && fits(bigModel) ? bigModel : dayModel;
    reasons.push(`the ${policy.direct_max_files} most relevant files fit in one prompt (${Math.round(chars / 1000)} k characters)`, withTests ? 'tests exist for them: the change can be checked' : 'no test found by the map: write the acceptance test first', direct.known ? `measured success of direct changes: ${Math.round(100 * direct.rate)} % over ${direct.n} tasks` : 'no measured success rate yet for direct changes');
    if (fits(m)) decide(2, 'ia-patch.ps1', m, 'now', `ia-patch.ps1 -Repo <worktree> -Task ${q} -Files ${flist} -ReadOnly <test> -Check "<test command>" -Reasoning medium -Model ${m}`);
    else { reasons.push('but ' + whyNot(m)); decide(arg('urgent') ? 4 : 2, arg('urgent') ? 'paid' : 'ia-patch.ps1', arg('urgent') ? null : m, arg('urgent') ? 'now' : 'when the local engine is free', null); }
  } else {
    reasons.push(narrow ? `direct changes succeed too rarely here (${Math.round(100 * direct.rate)} % over ${direct.n})` : `the likely files are too large or too many for one prompt (${Math.round(chars / 1000)} k characters): an agent must explore`);
    if (!agent.ok) { reasons.push(`local agent sessions succeed too rarely (${Math.round(100 * agent.rate)} % over ${agent.n})`); decide(4, 'paid', null, 'now', null); }
    else if (freeNow && fits(bigModel)) { reasons.push('the machine is in a free time slot: the large local model can run'); decide(3, 'ia-run.ps1', bigModel, 'now', `ia-run.ps1 -Repo <repo> -BriefFile <brief with the context pack> -Model <provider>/${bigModel}`); }
    else if (arg('urgent')) { reasons.push('the large local model cannot run now and the task is urgent'); decide(4, 'paid', null, 'now', null); }
    else { reasons.push('the large local model cannot run while the machine is in use: queue it for the next free slot'); decide(3, 'ia-run.ps1', bigModel, nextFree() || 'when the machine is free', null); }
  }
}
out.reasons = reasons;
fs.mkdirSync(path.join(AI_ROOT, 'logs'), { recursive: true });
fs.appendFileSync(path.join(AI_ROOT, 'logs', 'routage.jsonl'), JSON.stringify({ at: now.toISOString(), ...out }) + '\n');
if (arg('json')) console.log(JSON.stringify(out, null, 1));
else {
  const label = { 0: 'no model', 1: 'local question', 2: 'local direct change', 3: 'local agent session', 4: 'paid model', H: 'owner decides first' }[out.level];
  console.log(`LEVEL ${out.level} — ${label}${out.model ? ' — model ' + out.model : ''} — ${out.when}`);
  for (const r of reasons) console.log(`  because: ${r}`);
  console.log(`  targets: ${out.facts.top_files.slice(0, 3).join(' ; ') || '(none)'}`);
  if (out.command) console.log(`  run: ${out.command}`);
}
