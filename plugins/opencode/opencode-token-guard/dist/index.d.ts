import type { Plugin } from '@opencode-ai/plugin';
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
declare const TokenGuard: Plugin;
export default TokenGuard;
export { TokenGuard };
