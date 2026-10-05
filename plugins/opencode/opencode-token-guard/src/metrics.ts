import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export type FiringKind =
  | 'stepBudget'
  | 'contextBudget'
  | 'verifyChurn'
  | 'blockedBashStreaks'
  | 'blockedOutsideMutation'
  | 'offloadAsk'

export interface GuardMetrics {
  stepBudget: number
  contextBudget: number
  verifyChurn: number
  blockedBashStreaks: number
  blockedOutsideMutation: number
  offloadAsk: number
  total: number
  sessions: number
  firstFiring: string | null
  lastFiring: string | null
  lastSessionId: string | null
}

const EMPTY: GuardMetrics = {
  stepBudget: 0,
  contextBudget: 0,
  verifyChurn: 0,
  blockedBashStreaks: 0,
  blockedOutsideMutation: 0,
  offloadAsk: 0,
  total: 0,
  sessions: 0,
  firstFiring: null,
  lastFiring: null,
  lastSessionId: null,
}

export function metricsPath(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.TOKEN_GUARD_METRICS_PATH ??
    join(homedir(), '.local', 'share', 'opencode', 'token-guard-metrics.json')
  )
}

const sessionId = randomUUID()

export async function bumpMetrics(
  kind: FiringKind,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GuardMetrics> {
  try {
    const path = metricsPath(env)
    let metrics: GuardMetrics = { ...EMPTY }
    try {
      metrics = { ...EMPTY, ...JSON.parse(await readFile(path, 'utf8')) }
    } catch {}
    const now = new Date().toISOString()
    metrics[kind]++
    metrics.total++
    if (metrics.firstFiring === null) metrics.firstFiring = now
    metrics.lastFiring = now
    if (metrics.lastSessionId !== sessionId) {
      metrics.lastSessionId = sessionId
      metrics.sessions++
    }
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(metrics, null, 2) + '\n')
    return metrics
  } catch {
    return { ...EMPTY }
  }
}
