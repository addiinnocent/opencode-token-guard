import { Guard, classifyBash, optionsFromEnv } from './guard.js';
import { bumpMetrics } from './metrics.js';
export * from './guard.js';
export * from './metrics.js';
/**
 * Guards long agent sessions against token burn. Every provider step re-reads
 * the full (cached) conversation, so the plugin attacks step count and context
 * size directly:
 *
 * - blocks streaks of single-purpose bash calls (chain/batch instead),
 * - nudges when verification runs happen after too few edits,
 * - nudges at a step budget and a context-size budget per session.
 *
 * Thresholds are configurable via TOKEN_GUARD_* environment variables.
 */
const TokenGuard = async ({ client }) => {
    const guard = new Guard(optionsFromEnv());
    const seenMessages = new Set();
    const notify = async (kind, message) => {
        await bumpMetrics(kind);
        await client.app.log({ body: { service: 'token-guard', level: 'warn', message } }).catch(() => { });
    };
    return {
        'tool.execute.before': async (input, output) => {
            if (input.tool === 'bash' && typeof output.args.command === 'string') {
                const decision = guard.onBashBefore(output.args.command);
                if (!decision.allow) {
                    await bumpMetrics('blockedBashStreaks');
                    throw new Error(decision.reason);
                }
            }
            if (input.tool === 'edit' || input.tool === 'write')
                guard.onEdit();
        },
        'tool.execute.after': async (input) => {
            if (input.tool === 'bash' && typeof input.args?.command === 'string') {
                if (classifyBash(input.args.command) === 'verify') {
                    const nudge = guard.onVerifyAfter(input.args.command);
                    if (nudge)
                        await notify('verifyChurn', nudge);
                }
            }
        },
        event: async ({ event }) => {
            if (event.type !== 'message.updated')
                return;
            const info = event.properties?.info;
            if (!info || info.role !== 'assistant' || !info.id)
                return;
            if (seenMessages.has(info.id))
                return;
            seenMessages.add(info.id);
            const stepNudge = guard.onAssistantStep();
            if (stepNudge)
                await notify('stepBudget', stepNudge);
            const ctx = (info.tokens?.input ?? 0) +
                (info.tokens?.cacheRead ?? 0) +
                (info.tokens?.cacheWrite ?? 0);
            const ctxNudge = guard.onContextSize(ctx);
            if (ctxNudge)
                await notify('contextBudget', ctxNudge);
        },
    };
};
export default TokenGuard;
export { TokenGuard };
