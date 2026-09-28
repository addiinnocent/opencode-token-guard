# opencode-token-guard

OpenCode plugin that guards long agent sessions against **token burn**.

The cost model of an interactive agent session is simple:

> cost ≈ provider steps × context size

Every provider step re-reads the full conversation (mostly from cache, but the
cache is still billed and counted against quotas). The two behaviours that
explode that product are:

1. **One-command-per-step bash loops** — 381 single bash calls in a real
   session meant ~380 full-context re-reads that chaining (`&&`) or parallel
   batching would have collapsed into a fraction.
2. **Verify-after-every-edit churn** — running the test suite after each of
   dozens of edits multiplies steps without adding information.

This plugin attacks both mechanically, plus soft budgets on session length
and context size.

## What it does

| Guard | Behaviour | Default |
| --- | --- | --- |
| Bash rationing | Blocks a streak of consecutive *single-purpose* bash commands; the error tells the model to chain/batch. Chained (`&&`, `||`, `;`, loops) and verification commands never count. | block after **8** |
| Verify throttle | Warns when a test/lint/typecheck run happens after fewer than N edit/write operations since the last run. | N = **3** |
| Step budget | One-time warning when the session exceeds N assistant messages. | N = **200** |
| Context budget | One-time warning when the conversation exceeds N input tokens (incl. cache read). | N = **150,000** |

Warnings are written to the opencode log (`client.app.log`, service
`token-guard`). Blocks surface as tool errors the model sees and can react to.

## Metrics

Every firing is also counted into a small JSON file,
`~/.local/share/opencode/token-guard-metrics.json` (override with
`TOKEN_GUARD_METRICS_PATH`):

```json
{
  "stepBudget": 48,
  "contextBudget": 0,
  "verifyChurn": 8,
  "blockedBashStreaks": 0,
  "total": 56,
  "sessions": 48,
  "firstFiring": "2026-08-28T10:54:30.526Z",
  "lastFiring": "2026-09-28T12:51:47.028Z"
}
```

The file counts firings per kind plus distinct firing sessions; it does not
meter savings. A matching `/token-guard` opencode command that reports these
numbers lives in [`command/token-guard.md`](command/token-guard.md).

## Install

From npm (once published), add to `opencode.json`:

```json
{ "plugin": ["opencode-token-guard"] }
```

Or from a local build, drop a shim into your plugin directory:

```js
// ~/.opencode/plugins/token-guard.js  (or ~/.config/opencode/plugins/)
export { TokenGuard, TokenGuard as default } from '<abs-path>/opencode-token-guard/dist/index.js'
```

## The `/token-guard` command

The plugin ships a matching opencode command at
[`command/token-guard.md`](command/token-guard.md). Run as `/token-guard` in a
session, it reports the all-time firing counts (metrics JSON first, log scrape
as fallback) plus an explicitly labelled savings estimate.

Install it alongside the plugin:

```bash
mkdir -p ~/.config/opencode/command
cp command/token-guard.md ~/.config/opencode/command/
```

## Configuration

All thresholds via environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOKEN_GUARD_MAX_CONSECUTIVE_BASH` | `8` | consecutive single bash calls before blocking |
| `TOKEN_GUARD_MIN_EDITS_PER_VERIFY` | `3` | edits expected between verification runs |
| `TOKEN_GUARD_STEP_BUDGET` | `200` | assistant steps before the session-length nudge |
| `TOKEN_GUARD_CONTEXT_BUDGET` | `150000` | input tokens (incl. cache read) before the context nudge |
| `TOKEN_GUARD_METRICS_PATH` | `~/.local/share/opencode/token-guard-metrics.json` | where the firing counters are persisted |

## What it deliberately does not do

It does not rewrite the model's habits mid-flight or auto-compact your
session — the biggest wins still come from batching discipline and splitting
work into fresh sessions. Think of it as a **tripwire, not an autopilot**.

## License

MIT
