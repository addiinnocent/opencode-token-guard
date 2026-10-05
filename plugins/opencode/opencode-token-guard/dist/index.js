import { Guard, classifyBash, isOffloadAsk, mutatesOutsideProject, OFFLOAD_MESSAGE, optionsFromEnv, outsideMutationReason, } from './guard.js';
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
 * - nudges at a step budget and a context-size budget per session,
 * - blocks bash mutations outside the project root and warns when the
 *   assistant tries to offload in-project work onto the user.
 *
 * Thresholds are configurable via TOKEN_GUARD_* environment variables.
 */
const TokenGuard = async ({ client, directory }) => {
    const guard = new Guard(optionsFromEnv());
    const seenMessages = new Set();
    // messageID -> partID -> latest text of streamed assistant text parts.
    const textParts = new Map();
    const notify = async (kind, message) => {
        await bumpMetrics(kind);
        await client.app.log({ body: { service: 'token-guard', level: 'warn', message } }).catch(() => { });
    };
    return {
        'tool.execute.before': async (input, output) => {
            if (input.tool === 'bash' && typeof output.args.command === 'string') {
                if (mutatesOutsideProject(output.args.command, directory)) {
                    await bumpMetrics('blockedOutsideMutation');
                    throw new Error(outsideMutationReason(directory));
                }
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
            if (event.type === 'message.part.updated') {
                const props = event.properties ?? {};
                const part = props.info;
                if (part?.type === 'text' &&
                    typeof part.text === 'string' &&
                    part.messageID &&
                    props.partID) {
                    let parts = textParts.get(part.messageID);
                    if (!parts) {
                        parts = new Map();
                        textParts.set(part.messageID, parts);
                    }
                    parts.set(props.partID, part.text);
                }
                return;
            }
            if (event.type !== 'message.updated')
                return;
            const info = event.properties?.info;
            if (!info || !info.id || seenMessages.has(info.id))
                return;
            // The message is complete: scan its accumulated text before anything else.
            const parts = textParts.get(info.id);
            if (parts) {
                textParts.delete(info.id);
                if (info.role === 'assistant' && isOffloadAsk([...parts.values()].join('\n'))) {
                    await notify('offloadAsk', OFFLOAD_MESSAGE);
                }
            }
            if (info.role !== 'assistant')
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
