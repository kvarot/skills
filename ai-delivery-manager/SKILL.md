---
name: ai-delivery-manager
description: Use when about to state how long software work done by AI agents will take or took - an estimate, a delay, a deadline, a schedule, a planning, a progress percentage, "combien de temps", "ça prend combien", "tu en as pour combien", "pour quand", "délai", "planning", "calendrier", "estimation", "how long", "ETA" - or when closing a task whose duration should be recorded, or reviewing how past estimates compared with reality.
---

# AI Delivery Manager

A duration you state is either **measured** (read from session logs and git by the tool below), **derived** from measured figures, or **unknown**. There is no fourth kind. Agent work is counted in minutes and hours of active time; an agent has no working day, no morning, no week.

Tool: `node <this skill folder>/outils/adm.mjs <command>` (Node 18+, no dependency, nothing leaves the machine). `node .../adm.mjs help` lists every command. Report to the owner in the owner's language.

## What the tool measures

| Figure | Source | Reliability |
|---|---|---|
| AI active time (model + tools) | timestamps of the session logs | measured |
| Human active time | gaps of 5 min or less before a prompt | measured, lower bound: testing done outside the session is not seen |
| Away, unknown | longer gaps; gaps above the caps | reported, never counted as work |
| Time per commit, per topic | a commit is linked to the session whose `git commit` produced it | measured when linked, unknown otherwise |
| Calibration (real / estimate) | finished tasks in the task history | usable from 5 tasks |

Quantiles appear only when the sample carries them (P50 from 5, P80 from 10, P95 from 20). Below that the tool prints the cases themselves: quote them, do not turn them into a quantile.

## Estimating

Do these in order, before writing any figure.

1. **Look up comparable work.** From the project repo:
   `node .../adm.mjs history --since 90d` then `node .../adm.mjs history --topic "<regex>"` for the topics that resemble the request (same kind of work, same layers touched). Pick the comparables yourself; the tool supplies their measured durations.
2. **Split the request** into pieces that each match something in the history (a past topic, or a number of commits at the measured time per commit). A piece with no comparable is marked "no comparable".
3. **Give three points per piece**, in minutes of AI active time, anchored on the comparables: optimistic, likely, pessimistic. Sum them.
4. **Run** `node .../adm.mjs estimate --o <min> --m <min> --p <min> --project <P> --category <C>`. It returns the PERT value and, when 5 finished tasks exist, the calibrated value. Use the calibrated value when there is one.
5. **Answer with the block below**, filled in.
6. **When the owner goes ahead**, record it: `task estimate --id <ID> --title … --project <P> --category <C> --o --m --p`, then `task start --id <ID>` when work begins. Use the id the task already has in the project's task register or board; this skill stores only estimates and measured durations, never the task's state.

Categories: `feature`, `integration`, `migration`, `fix`, `refactor`, `ui`, `tests`, `docs`, `study`.

### The answer

```
AI active time : <likely> (range <optimistic> to <pessimistic>)
  based on     : <comparable 1: measured duration, n commits> ; <comparable 2: …>
  calibration  : x<ratio> on <n> finished tasks | none yet (<n> of 5)
Your time      : <minutes the owner must spend: decisions, commands only he runs, acceptance testing>
  based on     : <measured figure, or "your figure: I cannot measure testing done outside the session">
Waiting on others : <who, for what> | none
Delivery       : <AI active time + your time> of work once started; the date depends on when you are available for <your time>
Not known      : <each piece with no comparable, each open decision that changes the size>
```

Every line carries its source on the `based on` line. A figure with no source goes under `Not known` as a question, not into a total. Time that belongs to a third party (a partner's sandbox, a review by someone else) goes under `Waiting on others` with no duration unless that party gave one.

If the repo has no history the tool can read (`history` shows 0 linked commits), the answer is the block with `based on: no measured history in this repo` and a three-point range presented as uncalibrated, plus the offer to refine after a 15 to 30 min investigation of the code.

## Closing a task

`node .../adm.mjs task done --id <ID> --proof "<suite command + exit code | commit sha | URL + HTTP code>"`

The tool measures the real duration between start and now and prints estimate against reality. Report that line as is. `reliability: upper bound` means several sessions ran in the window: say so. If the scope changed on the way, record it when it happens with `task revise --id … --reason …`; the first estimate is kept and stays the one reviewed.

## Reviewing

`node .../adm.mjs review [--project P] [--category C]` gives the median real/estimate ratio, the overruns, the mean error and how often reality fell inside the announced range. Below 5 finished tasks, report the cases and change nothing. Never edit `tasks.jsonl` by hand.

## Progress

Progress is a count: tasks with a proof over tasks planned, and measured minutes done over estimated minutes total. State both numbers. No percentage that is not one of these two ratios.

## Common mistakes

| Mistake | Instead |
|---|---|
| Quoting agent hours from memory of "how long such things take" | Run `history`; quote the comparable topic and its measured time |
| Converting to days, half-days, "J1 morning", a week "with margin" | Minutes and hours of active time, plus the owner's own minutes; the calendar is his availability |
| Adding a safety margin on top | The pessimistic point is the margin; calibration corrects the bias |
| Treating commit dates or an open session as work time | Only `adm.mjs` figures count as measured |
| Guessing how long the owner will test | Ask, or label it his figure |
| Announcing a P80 from three tasks | Quote the three cases |

## Limits (say them when they matter)

- Reads Claude Code session logs (`~/.claude/projects`, or `--logs <dir>`). Work done by another agent, another machine, or by hand has no measured duration: its commits show as unknown.
- A commit is linked by its hash in the `git commit` output, else by its author date falling inside the tool call. Squashed or amended commits lose the link.
- The task history lives in `~/.ai-delivery-manager/` (or `ADM_HOME`), per machine.
