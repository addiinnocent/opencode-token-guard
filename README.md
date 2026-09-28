# opencode-token-guard

An [opencode](https://opencode.ai) plugin that guards long agent sessions against
**token burn**:

> cost ≈ provider steps × context size

Every provider step re-reads the full conversation (mostly from cache, but the
cache is still billed and counted against quotas). The plugin attacks the two
behaviours that explode that product — one-command-per-step bash loops and
verify-after-every-edit churn — plus soft budgets on session length and context
size. It is a **tripwire, not an autopilot**: it blocks and warns, it never
rewrites your session.

| Guard | Behaviour | Default |
| --- | --- | --- |
| Bash rationing | Blocks a streak of consecutive *single-purpose* bash commands; the error tells the model to chain/batch. Chained (`&&`, `||`, `;`, loops) and verification commands never count. | block after **8** |
| Verify throttle | Warns when a test/lint/typecheck run happens after fewer than N edit/write operations since the last run. | N = **3** |
| Step budget | One-time warning when the session exceeds N assistant messages. | N = **200** |
| Context budget | One-time warning when the conversation exceeds N input tokens (incl. cache read). | N = **150,000** |

## Install the plugin

Clone and build:

```bash
git clone https://github.com/addiinnocent/opencode-token-guard
cd opencode-token-guard/plugins/opencode/opencode-token-guard
pnpm install && pnpm build   # dist/ is also committed — the build is optional
```

Drop a shim into your opencode plugin directory:

```js
// ~/.config/opencode/plugins/token-guard.js
export { TokenGuard, TokenGuard as default } from '<abs-path>/opencode-token-guard/plugins/opencode/opencode-token-guard/dist/index.js'
```

Restart opencode (or start a new session) — the guards run automatically from
then on. Nothing to invoke by hand.

## Install the `/token-guard` skill

The plugin ships a matching opencode command at
[`plugins/opencode/opencode-token-guard/command/token-guard.md`](plugins/opencode/opencode-token-guard/command/token-guard.md).
Install it into your command directory:

```bash
mkdir -p ~/.config/opencode/command
cp plugins/opencode/opencode-token-guard/command/token-guard.md ~/.config/opencode/command/
```

## Use

- **Plugin** — passive. Blocked bash streaks surface as tool errors the model
  sees and can react to (chain with `&&`, batch in parallel); nudges appear as
  WARN lines in `~/.local/share/opencode/log/opencode.log`.
- **`/token-guard`** — run it in any opencode session for all-time firing
  stats (per kind, per session) and a labelled estimate of the steps/tokens saved.

## Metrics

Every firing is counted into `~/.local/share/opencode/token-guard-metrics.json`
(override with `TOKEN_GUARD_METRICS_PATH`):

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

## Configuration

All thresholds via environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TOKEN_GUARD_MAX_CONSECUTIVE_BASH` | `8` | consecutive single bash calls before blocking |
| `TOKEN_GUARD_MIN_EDITS_PER_VERIFY` | `3` | edits expected between verification runs |
| `TOKEN_GUARD_STEP_BUDGET` | `200` | assistant steps before the session-length nudge |
| `TOKEN_GUARD_CONTEXT_BUDGET` | `150000` | input tokens (incl. cache read) before the context nudge |
| `TOKEN_GUARD_METRICS_PATH` | `~/.local/share/opencode/token-guard-metrics.json` | where the firing counters are persisted |

## License

MIT
