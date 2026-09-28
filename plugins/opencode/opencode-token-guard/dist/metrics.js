import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
const EMPTY = {
    stepBudget: 0,
    contextBudget: 0,
    verifyChurn: 0,
    blockedBashStreaks: 0,
    total: 0,
    sessions: 0,
    firstFiring: null,
    lastFiring: null,
    lastSessionId: null,
};
export function metricsPath(env = process.env) {
    return (env.TOKEN_GUARD_METRICS_PATH ??
        join(homedir(), '.local', 'share', 'opencode', 'token-guard-metrics.json'));
}
const sessionId = randomUUID();
export async function bumpMetrics(kind, env = process.env) {
    try {
        const path = metricsPath(env);
        let metrics = { ...EMPTY };
        try {
            metrics = { ...EMPTY, ...JSON.parse(await readFile(path, 'utf8')) };
        }
        catch { }
        const now = new Date().toISOString();
        metrics[kind]++;
        metrics.total++;
        if (metrics.firstFiring === null)
            metrics.firstFiring = now;
        metrics.lastFiring = now;
        if (metrics.lastSessionId !== sessionId) {
            metrics.lastSessionId = sessionId;
            metrics.sessions++;
        }
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify(metrics, null, 2) + '\n');
        return metrics;
    }
    catch {
        return { ...EMPTY };
    }
}
