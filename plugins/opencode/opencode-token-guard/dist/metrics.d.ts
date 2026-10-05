export type FiringKind = 'stepBudget' | 'contextBudget' | 'verifyChurn' | 'blockedBashStreaks' | 'blockedOutsideMutation' | 'offloadAsk';
export interface GuardMetrics {
    stepBudget: number;
    contextBudget: number;
    verifyChurn: number;
    blockedBashStreaks: number;
    blockedOutsideMutation: number;
    offloadAsk: number;
    total: number;
    sessions: number;
    firstFiring: string | null;
    lastFiring: string | null;
    lastSessionId: string | null;
}
export declare function metricsPath(env?: NodeJS.ProcessEnv): string;
export declare function bumpMetrics(kind: FiringKind, env?: NodeJS.ProcessEnv): Promise<GuardMetrics>;
