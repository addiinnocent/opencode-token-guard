/**
 * Pure decision logic for the token-guard plugin. No opencode imports here so
 * the rules stay unit-testable and the plugin wiring stays thin.
 */
export interface TokenGuardOptions {
    /** Max consecutive single (un-chained) bash calls before blocking. */
    maxConsecutiveBash?: number;
    /** Min edit/write operations expected between verification runs. */
    minEditsPerVerify?: number;
    /** Soft step budget per session before nudging to compact/split. */
    stepBudget?: number;
    /** Soft context budget (input tokens incl. cache read) before nudging. */
    contextBudgetTokens?: number;
}
export declare const DEFAULTS: Required<TokenGuardOptions>;
export type BashKind = 'verify' | 'chained' | 'single';
/** Classify a bash command for rationing purposes. */
export declare function classifyBash(command: string): BashKind;
export type Decision = {
    allow: true;
} | {
    allow: false;
    reason: string;
};
/**
 * Tracks one session's tool-call pattern and decides when the agent is
 * burning steps: one-command-per-step bash loops and verify-after-every-edit
 * churn. Both multiply provider steps, and every step re-reads the whole
 * (cached) conversation — that is the real token cost driver.
 */
export declare class Guard {
    readonly opts: Required<TokenGuardOptions>;
    private consecutiveSingleBash;
    private editsSinceVerify;
    private steps;
    private stepNudged;
    private contextNudged;
    constructor(opts?: TokenGuardOptions);
    /** Call before a bash tool executes. Blocks un-batched call streaks. */
    onBashBefore(command: string): Decision;
    /** Call after a verify-style command ran; returns a nudge when premature. */
    onVerifyAfter(_command: string): string | null;
    /** Call on every edit/write tool call. */
    onEdit(): void;
    /** Call once per assistant message; returns a nudge at the step budget. */
    onAssistantStep(): string | null;
    /** Call with the latest context size; returns a one-shot nudge at the budget. */
    onContextSize(inputTokens: number): string | null;
}
/**
 * True when a bash command clearly mutates filesystem state OUTSIDE the
 * project root: an outside redirect target, an outside path as operand of a
 * mutating command, or a `cd` outside combined with any write hint. Reads
 * from outside are not flagged; deliberately conservative both ways — this
 * is a tripwire the model sees and can react to, not a sandbox.
 */
export declare function mutatesOutsideProject(command: string, projectRoot: string, home?: string): boolean;
export declare function outsideMutationReason(projectRoot: string): string;
export declare function isOffloadAsk(text: string): boolean;
export declare const OFFLOAD_MESSAGE: string;
export declare function optionsFromEnv(env?: NodeJS.ProcessEnv): TokenGuardOptions;
