---
name: ia-locale
description: Use when a development task could run on a LOCAL AI instead of a paid one — delegating code changes, tests, reviews, docs, log or diff analysis to a local agent (OpenCode) on local models (Ollama), escalating to Claude or Codex only when local results fail checks, and reporting local usage and the tokens and money saved. Triggers - "fais-le faire par l'IA locale", "délègue en local", "combien l'IA locale a économisé", "usage de l'IA locale", "/ia-usage".
---

# IA locale (local-first delegation)

Goal: spend paid tokens only where they add measurable value. Every task first asks « can a deterministic tool do it? », then « can the cheapest local model do it? », and only then « does it need a paid model? ». Reports to the owner in the owner's language, short, plain words.

## Setup this skill expects (checked, never assumed)

- `$env:AI_ROOT`: the folder that holds the local AI (engine, models, caches, logs, workspaces), on a disk with room — never the nearly full system disk.
- Ollama listening on `127.0.0.1` only (`OLLAMA_HOST`), models under `$env:AI_ROOT`, cloud models off (`OLLAMA_NO_CLOUD=1`).
- `$env:AI_ROOT\scripts\opencode-local.ps1`: launcher that points OpenCode's config, data, cache and state under `$env:AI_ROOT` and its provider at the local Ollama only.
- Check before use: `Invoke-RestMethod http://127.0.0.1:11434/api/version` answers; `ollama list` shows the models. If not, say so and stop — never fall back to a cloud model silently.

## Routing ladder (in this order)

1. **No AI**: grep/ripgrep, AST tools, formatters, linters, the project's own tests and scripts.
2. **Small local model** (classification, extraction, summaries, commit messages).
3. **Local coding model** through the agent (code changes, tests, docs, refactors in one area).
4. **Stronger local model** when step 3 fails its checks once.
5. **Paid model (Claude, Codex)** only for: architecture decisions, critical security, cross-cutting risky refactors, repeated local failures (2 attempts), independent review of sensitive changes. Send it only the needed files and the diff, never the whole repository.

Never more than 2 local attempts on the same failing check, then escalate or mark blocked with the facts.

## Delegating one task

```powershell
& "$env:CLAUDE_PLUGIN_ROOT\outils\ia-run.ps1" -Repo <repo path> -Task "<precise task, area, acceptance checks>" [-Model ollama/<model>] [-Minutes 30]
```
It creates an isolated git worktree and branch under `$env:AI_ROOT\workspaces`, runs the local agent with a time limit, logs the run to `$env:AI_ROOT\logs\runs.jsonl`, and **never commits, pushes or merges**. Then YOU: read the diff, run the project's real test suites, read each exit code. A local agent's « it works » is not a state (same rule as `chef-de-projet-ia`). Write the brief like any brief: area, acceptance criteria, what not to touch, the project's rules file to read first.

## Usage and savings

`/ia-usage` (or `ia-usage.ps1 -Days 7`, `-All`): local sessions, tokens processed locally (input, output, cache), tool calls, runs and models used, models loaded now, and the money not spent — computed only from `$env:AI_ROOT\config\prix.json` (copy `outils\prix.exemple.json`, fill it from the provider's official pricing page, with the URL and date). Without prices it shows tokens and says the amount is unknown: never a guessed price.

## Rules that never bend

- Local does not mean trusted: the agent gets the minimum area, its own worktree, a time limit; no secrets in its prompt; no production access; no push to the main branch.
- Nothing leaves the machine: local endpoints only; a cloud escalation is an explicit, logged decision.
- Keep each project's data in its own worktree and index; never mix projects in one prompt.
- This skill is generic: it names no project; each project brings its own rules file.
