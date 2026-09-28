---
description: Show basic token-guard stats — firing counts from the plugin's metrics file (log-scraping fallback) and an honest estimate of the steps/tokens it saved
---
Report token-guard firing stats. Do this yourself with a few chained bash calls — no subagents.

## 1. Collect firings

**Primary source: the metrics file.** The plugin counts its own firings into
`~/.local/share/opencode/token-guard-metrics.json` (override: `TOKEN_GUARD_METRICS_PATH`).
One JSON object, bumped on every firing:

```bash
cat ~/.local/share/opencode/token-guard-metrics.json
```

Fields: `stepBudget` / `contextBudget` / `verifyChurn` / `blockedBashStreaks` (counts per
kind), `total`, `sessions` (distinct plugin instances that fired), `firstFiring` /
`lastFiring`. The file was seeded from the logs on 2026-09-28, so it reads all-time.

**Fallback: scrape the log** if the metrics file is missing or unreadable. The plugin also
logs one WARN line per firing via `client.app.log`, embedded in
`~/.local/share/opencode/log/opencode.log` (a single append-only file; use `rg -a` — the
file contains null bytes):

```bash
rg -a --no-filename 'level=WARN run=\S+ message="token-guard: ' ~/.local/share/opencode/log/opencode.log
```

Classify each line by its message prefix into four kinds:
- `provider steps` — step-budget nudge (capture the step count and the `run=<id>`)
- `context` — context-size nudge
- `verification ran after only` — verify-churn nudge (capture the edit count)
- `consecutive single-purpose` — a blocked bash streak (the block itself)

## 2. Report

Present exactly this, nothing fancier:

```
token-guard — all-time (since <first firing date>)
  step-budget nudges:      N  (across M sessions)
  context-budget nudges:   N
  verify-churn nudges:     N
  blocked bash streaks:    N
  total firings:           N

Thresholds: step budget <n>, context budget <n> tokens, min edits/verify <n>,
max consecutive bash <n>  (TOKEN_GUARD_* env overrides where set — check
`env | rg -i TOKEN_GUARD`, defaults: 200 / 150000 / 3 / 8)
```

If both sources are missing or contain no firings, say plainly: "token-guard has fired 0
times — nothing measurably saved yet" and stop after reporting the thresholds.

## 3. Savings estimate (label it as an estimate)

The metrics file counts firings; it does not meter savings. Estimate them from the firings:
- Each firing that was heeded represents provider steps the session did **not** continue to burn. A step costs roughly the session's context size (input + cacheRead + cacheWrite of the latest assistant message).
- Use the tokenscope tool on the current session for today's context size, then estimate: `firings-heeded × context-tokens` as a lower bound, and say "assuming the nudges were heeded".
- Blocked bash streaks save their full streak (max consecutive bash + 1 calls) — count each block as ~9 avoided steps.

If you cannot get a context size, skip the token figure and report only the firing counts with one sentence on what each kind protects. Never present the estimate as a measured number.
