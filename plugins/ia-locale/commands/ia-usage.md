---
description: Show local AI usage (local agent sessions, tokens processed locally, runs, models) and the tokens and money saved versus a paid model.
argument-hint: "[days, default 7 | all]"
allowed-tools: PowerShell, Bash
---

Run the local AI usage report and show it to the user as is, in their language, without inventing any figure:

- If `$ARGUMENTS` is `all`: `& "${CLAUDE_PLUGIN_ROOT}/outils/ia-usage.ps1" -All`
- Else, with a number N: `& "${CLAUDE_PLUGIN_ROOT}/outils/ia-usage.ps1" -Days N` (default 7).

If the report says the amount is unknown, say which file to fill (`$AI_ROOT/config/prix.json`, from the provider's official pricing page) and do not estimate a price yourself.
