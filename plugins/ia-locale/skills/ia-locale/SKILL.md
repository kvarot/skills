---
name: ia-locale
description: Use when a development task could run on a LOCAL AI instead of a paid one — asking a local model about files, diffs or logs, delegating a code change to a local agent session (OpenCode) on a local engine (llama.cpp llama-server or Ollama), escalating to Claude or Codex only when local results fail checks, and reporting local usage and the tokens and money saved. Triggers - "fais-le faire par l'IA locale", "délègue en local", "demande au modèle local", "combien l'IA locale a économisé", "usage de l'IA locale", "/ia-usage".
---

# IA locale (local-first delegation)

Goal: spend paid tokens only where they add measurable value. Every task first asks « can a deterministic tool do it? », then « can the cheapest local model do it? », and only then « does it need a paid model? ». Reports to the owner in the owner's language, short, plain words.

## Cost rule for the paid session (read this first)

Delegation only saves money if **you** stay cheap. The local model reads the files; you do not.

- Call the scripts below from the shell. No MCP server, no tool definitions loaded in your context.
- Give paths, not contents. Never read a file just to paste it into a prompt for the local model.
- Read back the **short** result (`-Quiet` prints one line and a file path). Open the answer file only if you need it.
- Verify with deterministic checks (tests, linters, exit codes), not by rereading the whole diff, unless the task is sensitive.
- If briefing and checking a task would cost you more than doing it, do it yourself.

## Setup this skill expects (checked, never assumed)

- `$env:AI_ROOT`: the folder that holds the local AI (engine, models, caches, logs, workspaces), on a disk with room.
- `$env:AI_ROOT\config\moteur.json` (copy `outils\moteur.exemple.json`): engine type (`llama-server` or `ollama`), loopback `base_url`, optional key file, and the model names for `small`, `coding`, `strong`. Without the file, Ollama on `127.0.0.1:11434` is assumed.
- `$env:AI_ROOT\scripts\opencode-local.ps1`: launcher that keeps the agent's config, data, cache and state under `$env:AI_ROOT` and allows the local provider only (see `outils\opencode-local.exemple.ps1`, `outils\opencode.exemple.json`). Check that the agent lists **no cloud model**.
- Check before use: the engine answers on its loopback address. If not, say so and stop — never fall back to a cloud model silently.

## Routing ladder (in this order)

1. **No AI**: ripgrep, AST tools, formatters, linters, the project's own tests and scripts.
2. **Small local model**, one shot (`ia-ask.ps1`): classification, extraction, summaries of files, logs or diffs, commit messages, first-pass review notes.
3. **Local coding model as an agent session** (`ia-run.ps1`): a code change, tests or docs in one narrow area.
4. **Stronger local model** when step 3 fails its checks once (slow: batch use, not interactive).
5. **Paid model (Claude, Codex)** only for: architecture decisions, critical security, authentication, payments, data migrations, cross-cutting risky refactors, two failed local attempts, independent review of sensitive changes. Send it only the needed files and the diff.

Never more than 2 local attempts on the same failing check, then escalate or mark blocked with the facts. A technical error (engine stopped, timeout, busy worker) is fixed and retried; it is not a reason to escalate.

## Project map and context packs (no model involved)

A small model cannot explore a large repository: give it the few files that matter, not the repository.

```powershell
node "$env:CLAUDE_PLUGIN_ROOT\outils\contexte.mjs" --projet <name> --tache "<task>" [--budget 6000] [--fichiers 8]
node "$env:CLAUDE_PLUGIN_ROOT\outils\contexte.mjs" --projet <name> --plus <path>       # one file in depth
node "$env:CLAUDE_PLUGIN_ROOT\outils\contexte.mjs" --projet <name> --refs <symbol>     # definition and callers
node "$env:CLAUDE_PLUGIN_ROOT\outils\carte.mjs" --projet <name> [--full]              # (re)build the map
node "$env:CLAUDE_PLUGIN_ROOT\outils\contexte-eval.mjs" --projet <name>               # measure relevance on past commits
```
- `carte.mjs` builds the map under `$env:AI_ROOT\indexes\<name>` from git, universal-ctags and regular expressions: files and modules, symbols, file-to-file dependencies, database tables per file, routes, tests per module. Pinned to a git revision, rebuilt incrementally, refreshed automatically by `contexte.mjs` when stale. Config: `$env:AI_ROOT\config\projets\<name>\carte.json` (copy `outils\carte.exemple.json`), outside the repository.
- `contexte.mjs --tache` returns a pack within a token budget: the most relevant files with their matching symbols and line numbers, what they depend on, who uses them, their tests, their tables, their risk level, the modules concerned and their rules. Put the pack in the brief of a local session instead of letting the agent search.
- **Rules and security constraints are never cut**: if they do not fit the budget the command fails (exit 3). Anything else dropped is counted in an `omitted:` line.
- Start small (4 000 to 6 000 tokens) and let the agent ask for more with `--plus` and `--refs`. Every pack is logged in `$env:AI_ROOT\logs\contexte.jsonl` (task, revision, files given).
- Honest limits: ranking is lexical (words of the task against names, symbols and text); a task worded far from the code's vocabulary ranks badly — name a file, class, function or table in the task. Measure before trusting it: `contexte-eval.mjs` uses recent commits as ground truth (subject = task, changed files = expected) and appends each result to `$env:AI_ROOT\benchmarks\contexte`, so a ranking change is compared, not guessed.

## One-shot question (no agent loop)

```powershell
& "$env:CLAUDE_PLUGIN_ROOT\outils\ia-ask.ps1" -Task "<question>" -Files <a>,<b> [-Model <name>] [-Quiet]
git diff | & "$env:CLAUDE_PLUGIN_ROOT\outils\ia-ask.ps1" -Task "<question about this diff>" -Stdin -Quiet
```
Files are read by the script and sent to the local engine only. It refuses secret-looking files (`.env`, keys, credentials), a non-loopback engine, and material over the size limit — it never cuts silently. The answer goes to a file under `$env:AI_ROOT\logs\ask`.

## One local worker session

```powershell
& "$env:CLAUDE_PLUGIN_ROOT\outils\ia-run.ps1" -Repo <repo> -BriefFile <brief.md> [-TaskId <ID>] [-Model <provider/name>] [-Base <branch>] [-Minutes 30]
& "$env:CLAUDE_PLUGIN_ROOT\outils\ia-run.ps1" -Status
```
- Own git worktree and branch under `$env:AI_ROOT\workspaces`, a time limit, state in `logs\run-<id>.json`. Start it in the background and poll `-Status`; do not wait on it idle.
- It **never commits, pushes or merges**, and cannot run shell commands unless `-AllowShell`. A local agent's « it works » is not a state.
- When the project has a validation config (next section), the session records the baseline before the agent starts and validates when it stops: read `validation` in the state (`pass`, `fail`, `human_required`) and open the report only on `fail`. Without a config, run the project's suites yourself in that worktree and read each exit code.
- **One local session at a time** per machine: a second start is refused while one is alive.
- **The machine stays usable**: a start is refused while a call is in progress (microphone in use) unless `-EvenInCall`. Run the engine at low priority with threads left for the IDE.
- Write the brief like any brief, but for a small model: one goal, the exact files **and file names to create**, the acceptance checks, what not to touch, short sentences. Small context: point to files (a context pack), do not paste them.

## Objective validation (no model involved)

```powershell
& "$env:CLAUDE_PLUGIN_ROOT\outils\ia-valider.ps1" -Repo <worktree> [-Base <ref>] [-TaskId <ID>]     # exit 0 pass, 1 fail, 2 human approval needed
& "$env:CLAUDE_PLUGIN_ROOT\outils\ia-valider.ps1" -Repo <clean worktree> -Baseline               # what already fails before the change
```
Config: `$env:AI_ROOT\config\projets\<repo folder name>\validation.json` (copy `outils\validation.exemple.json`). It lives **outside the repository**, so an agent cannot edit its own acceptance criteria. From the changed files it:

- rates the **risk** from path rules (`low`, `moderate`, `high`, `critical`) and picks the checks to run (lint per file, secret scan, test suites from `moderate` up);
- fails on a **forbidden path** (vendored code, generated files, secrets);
- **guards the tests**: a deleted test file or an added skip marker fails; removed or rewritten assertions and changed test or CI configuration need a human;
- compares suites **before and after**: failures already present on the base are reported as pre-existing, only new ones fail;
- requires a **human approval** from `high` up (authentication, payments, data, migrations, security, tenant isolation), even when every check passes.

Use it for any change, whoever made it (local agent, paid session, human). Its verdict replaces rereading the diff for low and moderate risk; it never replaces the independent review of the merge gate. Do not weaken the config to get a pass: a change of criteria is a decision for the owner.

## Usage and savings

`/ia-usage` (or `ia-usage.ps1 -Days 7`, `-All`): agent sessions and tokens per model, one-shot questions, delegated runs, models loaded now, and the money not spent — computed only from `$env:AI_ROOT\config\prix.json` (copy `outils\prix.exemple.json`, fill it from the provider's official pricing page, with the URL and date). Without prices it shows tokens and says the amount is unknown: never a guessed price. The amount is a ceiling, not a net gain: what the paid session spent to delegate and check is not deducted. Compare with the paid tool's own usage report over the same period.

## Rules that never bend

- Local does not mean trusted: minimum area, own worktree, a time limit; no secrets in a prompt; no production access; no push to the main branch.
- Nothing leaves the machine: loopback endpoints only; a cloud escalation is an explicit, logged decision.
- Keep each project's data in its own worktree and index; never mix projects in one prompt.
- This skill is generic: it names no project; each project brings its own rules file.
