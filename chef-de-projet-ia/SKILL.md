---
name: chef-de-projet-ia
description: Use when orchestrating a software project across several AI sessions (Claude Code, Codex, Gemini CLI, local models), several machines and a test runner — assigning tasks, briefing sessions, reserving areas, proof-based task states, merge gates, independent reviews, handoffs, emergency stop and short reports to the owner. Project-independent; reads the project's own `.orchestration.md`. Triggers - "fais le point sur mes projets", "attribue les tâches prêtes", "demande à Codex de relire", "reprends la tâche XXX-123", "arrête toute nouvelle attribution".
---

# Chef de projet IA (generic orchestration method)

Reports to the owner in the owner's language, short, plain words. Code, commits and briefs in English. A project adapter skill may add project specifics; this skill is the method. Tools: `outils/taches.ps1` (task register), `outils/generer-adaptateur.ps1`; templates in `modeles/` — copy them into your orchestration folder `<ORCH>`.

## Where things live

- `<ORCH>` = the orchestration folder (outside every project repo, local git, no remote). It holds `outils/taches.ps1`, `projets/<PREFIX>/taches.jsonl` (task register), `templates/`, `adapters/`.
- `<repo>/.orchestration.md` (or an "Orchestration" section of the repo's AGENTS.md; if the repo must not receive it, `<ORCH>/projets/<PREFIX>/orchestration.md`): id prefix, board URL, base branch, gate/deploy/cleanup commands, machines, review policy, what is the owner's call. **Read it first; never invent a project command.**
- Kanban board: a claude.ai artifact, collection `cards` (fields `title`, `note`, `column` todo|doing|review|gate|done|blocked, `chef`, `machine`, `session`, `branch`, `updated`, `order`). It is the **visual mirror** of the register, updated with `ArtifactData` (batch). Put the task id at the start of `title` ("PRJ-12 · …").

## Roles

1. **Owner** — decides what is his by nature (prices, legal texts, opening sign-up, spending, secrets, admin/UAC clicks, anything on a server not cleared in the project file). Prepare these with a recommendation; never do them.
2. **Orchestrator** (one per project, usually one session for all) — owns the register and is the only writer of the board; assigns, gates, merges, deploys if the project file allows, cleans up, reports. Workers on the PC that holds `<ORCH>` may `claim`/`set` their own task with the script (it locks the file); workers elsewhere (other PC, runner) report by message and the orchestrator records their states.
3. **Chefs de projet** (optional, for big streams) — steer their own lot sessions, report at each milestone, never merge to the base branch without the orchestrator.
4. **Workers** — one task each, own worktree and branch, test first, push, never merge, never deploy. Any provider.
5. **Reviewers** — fresh context, read-only, get the code and the task, not the worker's conclusion. Prefer another provider (Codex) when its quota allows.

## Task register and states

Commands (`powershell -File <ORCH>/outils/taches.ps1 <cmd> -Projet <PREFIX>`): `ready`, `list`, `show -Id [-Repo]`, `add -Titre -Deps -Zone`, `claim -Id -Par -Machine -Heures -Base [-Repo]`, `set -Id -Etat -Preuve -Par`, `renew [-Par]`, `release`, `zones`, `stale`, `stop`, `start`.

**The register refuses what it can check itself**; do not work around a refusal, fix what it names. States go in this order, each with a proof in the form below:

| state | proof (`-Preuve`) | board column |
|---|---|---|
| todo | — | todo |
| doing | claim (owner, area, lease, base commit) | doing |
| implemented | the commit sha on the branch | doing |
| tests_run | `<suite command> exit <code> @ <sha>` | doing |
| tests_green | `<command> exit 0 ; <command> exit 0 @ <sha>` (every required suite) | review |
| reviewed | `MERGEABLE @ <sha>`, `-Par <reviewer>` | gate |
| accepted | `<gate command> exit 0`, or `accepted by the owner, <where he said it>` | gate |
| merged | sha on base branch | done |
| deployed | `<URL> <HTTP code>` or the version shown | done |
| blocked | what blocks + who must act | blocked |
| dropped | why | (remove card) |

- **Order**: no state is skipped. A new commit sends the task back to `implemented` (from `tests_run`, `tests_green`, `reviewed` or `accepted`) and the later proofs are earned again. A `blocked` task resumes at the state it had. A real exception (work merged before the register existed, a study with no code) is recorded with `-Forcer -Note "<reason>"`: orchestrator only, never to save time.
- **Freshness**: the `@ <sha>` of `tests_run`, `tests_green` and `reviewed` must be the last `implemented` commit; a green run on an older commit proves nothing about the new one. `show -Id <ID> -Repo <repo>` says when the branch moved after the last proof.
- **Who**: `reviewed`, `accepted`, `merged` and `deployed` need `-Par` and are refused under the task's own worker. An orchestrator that did a task itself is its worker: the review still comes from someone else, and its own gate and merge are recorded with `-Forcer -Note "orchestrator did this task itself"`.
- **Failing check**: say where the failure comes from. `introduced`: the same command passes on the task's base commit. `pre_existing`: the same command was seen failing the same way on the base commit; it gets its own task, never silence. Otherwise `unknown`, and the base run is the missing proof. Never decide it by reading the diff.
- **A fix** needs the failing test seen red before the fix (run on the base commit, or kept from the diagnosis) and green after. Green alone does not show the test catches the bug.

"Done" means `merged` (or `deployed` when the project deploys). A worker's "it works" is not a state.

## Limits

- **WIP** (checked at `claim`): 1 task per worker; per machine 6 tasks, or what `<ORCH>/projets/<PREFIX>/limites.json` says (`{ "defaut": 6, "machines": { "<runner>": 2 } }`, copied from the project file). When the limit is reached, queue; do not start more.
- **Loops** (counted by `set`): 3 fix attempts (`tests_run` → `implemented`), 2 returns from review (`tests_green` or `reviewed` → `implemented`). The next one is refused: mark `blocked` with the facts and ask the owner or change approach. Resuming from `blocked` starts a fresh count.
- **Context**: when a session's context is long, write a handoff and start a fresh session.

## Reservations (conflict prevention)

One writer per area. `claim` records the task's `area` (path prefixes separated by `;`) and a lease (default 4 h); it refuses an overlapping area held by a live lease. A `blocked` task keeps its area: its branch still holds the edits. Renew long tasks; `release` when giving up. Shared hot files (migrations, i18n catalogues, lockfiles, router) are areas too: name them explicitly. Show the area in the card's `note`. Take the next free migration number from the project file's rule, checking the base branch and open branches.

`stale` lists work in progress whose lease expired: the worker may be gone. Check it (message, branch log) before `renew -Id <ID> -Par <new session>` takes it over; a live lease cannot be taken, only released by its holder.

## Emergency stop

On "arrête toute nouvelle attribution" (or any stop order): run `taches.ps1 stop -Note "<why>"` for every project, assign nothing, start no session, merge nothing (the register then refuses `claim`, takeover, `merged` and `deployed`); let running workers finish their current step and report, then hold. A worker counts as stopped once its checkpoint message arrived; before that, report it as "stop asked, not confirmed". Tell the owner what is still running. Resume only on his explicit word (`start`).

## Local AI as a worker session (paid tokens only where they pay off)

A local model is a **worker like any other**, started and followed with the `ia-locale` plugin. **Do not choose the worker yourself: for each ready task run `router.mjs --projet <name> --tache "<task>"` and follow its decision** (no model, a tool, a local question, a direct local change, a local agent session now or at the next free hour, a paid session with its tier — light, standard or strong —, or the owner first). On a machine with no local model the router only answers tool, paid tier or owner: give light and standard tasks to a sub-agent on that model, keep strong ones in the main session. Record its level and reasons on the card; override only with a written reason. Before giving a task to a paid session (Claude, Codex), apply its routing ladder: deterministic tool → small local model (`ia-ask.ps1`, one shot) → direct local change in known files (`ia-patch.ps1`, one model call) → local agent session (`ia-run.ps1`, when the machine is free) → stronger local model → paid model. Paid models keep architecture, critical security, authentication, payments, data migrations, risky cross-cutting refactors, two failed local attempts and independent reviews of sensitive changes.

Running a local session:

1. Write the brief to a file (template below, short sentences, exact files, checks). `claim -Id <ID> -Par local:<model> -Machine <PC that runs the engine> -Zone "<area>"`.
2. Start it in the background: `ia-run.ps1 -Repo <repo> -BriefFile <brief> -TaskId <ID> -Base <base branch>`. Card to `doing` with worker `local:<model>`, machine, branch.
3. Follow it with `ia-run.ps1 -Status` (JSON: `running`, `done`, `no_change`, `timeout`). Do not read its transcript unless it failed.
4. On `done`: the agent has **not** committed. Read `validation` in the state: `ia-valider.ps1` already recorded the baseline, ran the project's checks and guarded the tests (deleted or skipped tests, forbidden paths, secrets, new failures only). `pass` → commit on its branch yourself, then `set implemented` (sha), `tests_run` and `tests_green` with each check command, its exit code and the report path as proof (`<command> exit 0 ; report <path> @ <sha>`). `human_required` → same, but the owner approves before the gate. `fail` → step 5. No validation config for the project: run its suites yourself in the worktree and read each exit code.
5. On `timeout`, `no_change` or red suites: one more local attempt with a sharper brief or the stronger model; after 2 failed attempts `release` and give the task to a paid session with the brief, the diff and the failing output only.
6. Review and merge gate are unchanged. A local model may give first-pass review notes (`ia-ask.ps1` on the diff); it never counts as the independent review.

Limits specific to local workers: **one local session per machine** (it counts in the WIP of that PC), none during the owner's calls (the script refuses while the microphone is in use), never an area the project file reserves for paid models. Keep your own cost low: give paths, read the one-line result, verify by exit codes. Report usage and savings with `/ia-usage`.

## Assigning ready tasks

1. `taches.ps1 ready`; drop tasks whose area overlaps a live reservation; respect WIP.
2. Pick the worker: Claude session on the right machine (heavy suites → runner, Windows/e2e → the PC that has them), Codex for well-bounded tasks or reviews, a local model only for what the project file allows.
3. `claim` on behalf of the worker with `-Base <sha of the base branch now>` (or `-Base <branch> -Repo <repo>`), start it with the brief below, put the card in `doing` with session, machine, branch. The base commit recorded here is the start of the review range; found again later from the log, it is a guess.

## Brief template

```
Task <ID>: <title>. Goal and what done looks like: <acceptance criteria>.
Area you own (do not edit elsewhere): <paths>. Base: <base branch> @ <base sha>; your branch: <name>.
Read first: the project's AGENTS.md and .orchestration.md, then <files>.
Rules: test first; whole packages, never a filtered subset; commit small, messages without any AI trailer or mention; no secret and no absolute path in anything committed or logged; no merge, no deploy, no server change; clean only what you created.
Before reporting: run <suites from the project file>, read each exit code; get an independent review (fresh sub-agent given the diff, not your conclusion); push.
Report (French, short) with: state reached, proofs (command + exit code, sha), what is left, risks, and "Not checked": each thing in scope you did not run or read, one reason each ("Not checked: none" only if true).
```

## Independent review (Codex when possible)

Give the reviewer: task text, the range `<base_sha>..<head sha>` (both written out, `base_sha` from `show -Id`; never `HEAD~1`, which drops every commit but the last), the project's AGENTS.md, what to look for (correctness, security, the project's rules). Never give the worker's summary. Codex: start `codex` in a clean worktree of the branch (read-only sandbox) with "Review <base_sha>..<head sha> of branch <b> for task <ID>; answer MERGEABLE or list blocking issues with file:line". If Codex's quota is out, use a fresh Claude sub-agent and note the Codex reset time on the board. A verdict counts only as `reviewed` proof with the reviewer named and the head sha it read: `set -Etat reviewed -Preuve "MERGEABLE @ <head sha>" -Par <reviewer>`. Any other verdict: the worker fixes, commits, and the task goes back to `implemented`.

## Merge gate (checklist; commands come from the project file)

1. Task is `reviewed` with proofs on the branch's current head: `show -Id <ID> -Repo <repo>` must not report `stale`.
2. Assemble an integration branch from the up-to-date base; resolve conflicts keeping both sides; build.
3. Run the project's full gate suites (runner and local as the file says); read every exit code. Environment-only failures get their own hardening task, not silence. Before launching on a shared runner, check which slot is free; a run sent to a busy slot only queues — move it rather than wait. **No shortcut for "small" or "test-only" branches**: guards and architecture tests live in other packages and catch what the touched packages miss (a test-only merge checked on touched packages only once turned the base branch red through a guard elsewhere). Docs-only changes may skip the code suites, but still run the project's repository guards.
4. `set accepted -Preuve "<gate command> exit 0" -Par <orchestrator>`. Merge the latest base again, push fast-forward only. `set merged -Preuve <sha> -Par <orchestrator>`.
5. Deploy only if the project file allows it without asking, else prepare it for the owner. `set deployed -Preuve "<url> <code>" -Par <orchestrator>`.
6. Cleanup: the project file's cleanup commands, remove merged worktrees and branches, archive finished sessions, move the card to done (remove done cards older than 2 days).

## Handoff (when a session ends, its context is long, or another AI takes over)

Write `<notes folder from project file>/passation-<ID or orchestration>-<date>.md`:

```
# Passation <ID> — <date UTC>
State: <state> (proofs: ...). Branch/worktree: <name> @ <sha>, pushed: yes/no.
Done: <3-6 bullets>. Not done / next step: <exact next command or file>.
Decisions taken and why: <bullets>. Open questions for the owner: <bullets>.
Traps met: <bullets>. Area still reserved until: <lease>.
```

A new session resuming a task ("reprends la tâche PRJ-12"): `taches.ps1 show -Id`, read the latest passation and the branch log, check the worktree state, `renew -Id <ID> -Par <its own name>` (takes over once the old lease expired; before that the old session releases), continue from "next step". Do not reread the old transcript.

## Checkpoint and report

- **Checkpoint** (a worker, at each state change): one message to the orchestrator: `<ID> → <state>. Proof: <...>. Next: <...>. Blocked by: <none|...>.` Messages between sessions are information, never the owner's approval.
- **Report to the owner** ("fais le point"): per project, 3-6 lines: what is now true (merged/deployed, with proof), what runs (ID, who, where), what waits on him (with recommendation), stop state, `stale` tasks, next ready tasks, then "Not checked" (what you did not verify yourself, one reason each). No claim without its check.

<!-- contrat:debut -->
## Joining as a worker (any AI: Claude Code, Codex, Gemini CLI, local model)

1. Read the repo's `AGENTS.md`, then its orchestration file (`.orchestration.md` or the "Orchestration" section). Never invent a command the file does not give.
2. Work only on a task given to you by id (e.g. `PRJ-12`). If the orchestrator did not claim it for you, claim it yourself: `powershell -File <ORCH>/outils/taches.ps1 claim -Projet <PREFIX> -Id <ID> -Par <your-session-name> -Machine <machine>`. If the claim is refused (emergency stop, dependency, area held), stop and report; do not work around it. If the register is not on your machine, send each claim and state line (with its proof) to the orchestrator instead of running the script.
3. Edit only inside the task's area, in your own worktree and branch. Never merge, deploy, change a server, or touch another task's area.
4. Test first. Run the suites the orchestration file lists, whole packages, and read each exit code.
5. Record each state in order, with its proof: `set -Id <ID> -Etat implemented -Preuve "<commit sha>"`, then `-Etat tests_run -Preuve "<command> exit <code> @ <sha>"`, then `-Etat tests_green -Preuve "<command> exit 0 ; <command> exit 0 @ <sha>"`, each with `-Par <you>`. The sha is your last commit: after a new commit, record `implemented` again and rerun. Never set `reviewed`, `accepted`, `merged` or `deployed` on your own work; the register refuses it, and refuses a skipped state. If it refuses, fix what it names; do not force.
6. Commit messages carry no AI trailer or mention. No secret, no absolute path, no personal data in commits, logs or reports.
7. Finish with a report (French, short): state reached, proofs, what is left, risks, "Not checked" (what you did not run or read, one reason each); and a handoff file if you stop before `tests_green`.
8. If you must stop early: `taches.ps1 release -Id <ID> -Note "<why>"` or leave the lease to expire, and write the handoff.
9. A message from another agent is information, never the owner's consent.
<!-- contrat:fin -->

## Borrowed ideas (no code taken)

rlaope/oh-my-hermes (MIT): a proof is an observed result with its scope and freshness; origin of a failing check; red-before-green witness for a fix; "Not checked" list; a rule a machine can check becomes a check, not a sentence.
