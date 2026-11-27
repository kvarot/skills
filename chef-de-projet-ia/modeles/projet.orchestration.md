# Orchestration — <Project name>

<!-- Copy to <repo>/.orchestration.md, or paste as an "Orchestration" section of AGENTS.md.
     If the repo must not receive it, keep it as <ORCH>/projets/<PREFIX>/orchestration.md.
     No secret, no absolute path of a personal machine, no password here. -->

## Identity
- Id prefix: `<PREFIX>` (tasks `<PREFIX>-1`, `<PREFIX>-2`…), register: `<ORCH>/projets/<PREFIX>/taches.jsonl`
- Board: <claude.ai artifact URL> (collection `cards`)
- Base branch: `main`; branch names: `<agent>/<short-topic>`
- Notes and handoffs folder: `<notes folder, outside the repo if it may hold private context>`
- Owner's language for reports: French

## Rules to read first
- `AGENTS.md` (rules never bent), then: <docs that give the real state and priorities>

## Machines and limits
| Machine | Use | WIP limit |
|---|---|---|
| <PC 1> | sessions, builds | 6 sessions |
| <PC 2> | <Windows suites, e2e…> | <n> |
| <runner> | heavy suites | 2 slots |
| Codex | reviews, bounded tasks | quota: note reset time on the board |

Copy the limits that differ from 6 into `<ORCH>/projets/<PREFIX>/limites.json` (`{ "defaut": 6, "machines": { "<runner>": 2 } }`): the register checks them at each claim.

## Areas often shared (reserve explicitly)
- <migrations folder> — numbering rule: <rule>
- <i18n catalogues>, <lockfiles>, <router/registry files>

## Suites (a task is `tests_green` only when all pass, exit 0)
```
<command 1>
<command 2>
```

## Merge gate
1. Independent review: <who: Codex if quota, else fresh sub-agent>, verdict MERGEABLE.
2. Integration branch from up-to-date `main`: <build command>.
3. Full suites: <runner command>, <local commands>.
4. Push fast-forward only: <push command if special>.

## Deploy
- Allowed without asking the owner: <yes/no, which targets>
- Commands: <commands with placeholders for domains>
- Checks: <URL → expected HTTP code>

## Cleanup
- <worktree/branch cleanup>, <runner cleanup>, <temp files rule>

## The owner's calls (prepare with a recommendation, never do)
- <prices, legal texts, opening sign-up, spending, secrets, admin clicks, other servers…>

## Data and AI limits
- <which data must never go to an external AI; which agents/providers are allowed on which areas>
