/**
 * Pure decision logic for the token-guard plugin. No opencode imports here so
 * the rules stay unit-testable and the plugin wiring stays thin.
 */
export const DEFAULTS = {
    maxConsecutiveBash: 8,
    minEditsPerVerify: 3,
    stepBudget: 200,
    contextBudgetTokens: 150_000,
};
const VERIFY_RE = /\b(test|tests|lint|typecheck|tsc|vitest|jest|eslint|ruff|pytest|mypy|prettier)\b|--check\b/;
const CHAIN_RE = /&&|\|\||;\s*\S+|\bfor\b|\bwhile\b|\bdo\b\s*$/;
/** Classify a bash command for rationing purposes. */
export function classifyBash(command) {
    if (VERIFY_RE.test(command))
        return 'verify';
    if (CHAIN_RE.test(command))
        return 'chained';
    return 'single';
}
/**
 * Tracks one session's tool-call pattern and decides when the agent is
 * burning steps: one-command-per-step bash loops and verify-after-every-edit
 * churn. Both multiply provider steps, and every step re-reads the whole
 * (cached) conversation — that is the real token cost driver.
 */
export class Guard {
    opts;
    consecutiveSingleBash = 0;
    editsSinceVerify = 0;
    steps = 0;
    stepNudged = false;
    contextNudged = false;
    constructor(opts = {}) {
        this.opts = { ...DEFAULTS, ...opts };
    }
    /** Call before a bash tool executes. Blocks un-batched call streaks. */
    onBashBefore(command) {
        const kind = classifyBash(command);
        if (kind !== 'single') {
            if (kind === 'verify')
                this.editsSinceVerify = 0;
            this.consecutiveSingleBash = 0;
            return { allow: true };
        }
        this.consecutiveSingleBash++;
        if (this.consecutiveSingleBash > this.opts.maxConsecutiveBash) {
            const streak = this.consecutiveSingleBash;
            this.consecutiveSingleBash = 0; // let the next streak start fresh after the block
            return {
                allow: false,
                reason: `token-guard: ${streak} consecutive single-purpose bash calls. ` +
                    'Every tool step re-reads the full (cached) conversation, so one-command-per-step is the ' +
                    'most expensive possible pattern. Chain dependent commands with &&, batch independent ' +
                    "ones in a parallel tool block, or fold this into the next call — then continue.",
            };
        }
        return { allow: true };
    }
    /** Call after a verify-style command ran; returns a nudge when premature. */
    onVerifyAfter(_command) {
        const edits = this.editsSinceVerify;
        this.editsSinceVerify = 0;
        if (edits === 0 || edits >= this.opts.minEditsPerVerify)
            return null;
        return (`token-guard: verification ran after only ${edits} edit(s). ` +
            'Batch more changes between test/lint runs — verify at milestones, not after every edit.');
    }
    /** Call on every edit/write tool call. */
    onEdit() {
        this.editsSinceVerify++;
    }
    /** Call once per assistant message; returns a nudge at the step budget. */
    onAssistantStep() {
        this.steps++;
        if (this.stepNudged || this.steps <= this.opts.stepBudget)
            return null;
        this.stepNudged = true;
        return (`token-guard: ${this.steps} provider steps in this session. ` +
            'Long sessions re-read a huge cached context on every step. ' +
            'Wrap up the current subtask, then /compact or start a fresh session.');
    }
    /** Call with the latest context size; returns a one-shot nudge at the budget. */
    onContextSize(inputTokens) {
        if (this.contextNudged || inputTokens < this.opts.contextBudgetTokens)
            return null;
        this.contextNudged = true;
        return (`token-guard: context is at ${(inputTokens / 1000).toFixed(0)}k tokens. ` +
            'Each further step pays for all of it again. Finish the current subtask and compact, ' +
            'or delegate remaining exploration to a subagent.');
    }
}
/* ---------------------------------------------------------------------------
 * Project-escape / offload guards
 *
 * Failure mode these attack: the agent hits friction (e.g. a permission prompt
 * for an in-project action), takes a wrong turn, and either mutates state
 * outside the project root or asks the user to run the work themselves /
 * outside the project. Both are detectable: the first in the bash command,
 * the second in the assistant's own text.
 * ------------------------------------------------------------------------- */
/** Absolute locations that are never treated as "outside the project". */
const OUTSIDE_ALLOW = [/^\/(private\/)?tmp\//, /^\/dev\//, /^\/var\/folders\//];
/** Operators/verbs that mutate filesystem state. */
const WRITE_HINT_RE = />>?|\btee\b|\bsed\b[^&|;]*\s-i|\bperl\b[^&|;]*\s-i|\b(?:mv|cp|ln|mkdir|touch|rm|rmdir|truncate|install|rsync)\b/;
/** Heredoc body that writes a file (python/node/ruby style). */
const HEREDOC_WRITE_RE = /<<-?\s*['"]?[A-Za-z_]+['"]?[\s\S]*?(?:open\s*\([^)]*['"][wa]['"]|json\.dump|yaml\.dump|\.write\s*\(|writeFileSync)/;
/** Extract absolute-ish path candidates from a shell segment. */
const PATH_TOKEN_RE = /(?:~|\$HOME)(?:\/[^\s'"&|;]*)?|\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]*/g;
function isOutside(target, projectRoot, home) {
    const p = target.replace(/^~(?=\/)/, home).replace(/^\$HOME(?=\/)/, home);
    if (!p.startsWith('/'))
        return false;
    if (OUTSIDE_ALLOW.some((re) => re.test(p)))
        return false;
    const root = projectRoot.replace(/\/+$/, '');
    return p !== root && !p.startsWith(root + '/');
}
/**
 * True when a bash command clearly mutates filesystem state OUTSIDE the
 * project root: an outside redirect target, an outside path as operand of a
 * mutating command, or a `cd` outside combined with any write hint. Reads
 * from outside are not flagged; deliberately conservative both ways — this
 * is a tripwire the model sees and can react to, not a sandbox.
 */
export function mutatesOutsideProject(command, projectRoot, home = process.env.HOME ?? '') {
    if (!projectRoot)
        return false;
    const outside = (t) => isOutside(t, projectRoot, home);
    for (const m of command.matchAll(/>>?\s*("[^"]+"|'[^']+'|\S+)/g)) {
        const target = m[1].replace(/^["']|["']$/g, '');
        if (target && !target.startsWith('&') && outside(target))
            return true;
    }
    for (const segRe of [/\b(?:mkdir|touch|rm|tee|ln|truncate)\b[^&|;]*/g, /\bsed\b[^&|;]*\s-i[^&|;]*/g]) {
        for (const m of command.matchAll(segRe)) {
            for (const p of m[0].matchAll(PATH_TOKEN_RE))
                if (outside(p[0]))
                    return true;
        }
    }
    for (const m of command.matchAll(/\bcd\s+("[^"]+"|'[^']+'|\S+)/g)) {
        const target = m[1].replace(/^["']|["']$/g, '');
        if (!outside(target))
            continue;
        if (WRITE_HINT_RE.test(command) || HEREDOC_WRITE_RE.test(command))
            return true;
    }
    return false;
}
export function outsideMutationReason(projectRoot) {
    return (`token-guard: this command mutates state outside the project root (${projectRoot}). ` +
        'Work for this session belongs inside the project — redo the change in-project with the ' +
        'edit/write tools or a project-relative command. Never relocate the work outside the ' +
        'project and never ask the user to run it there; if a permission prompt blocked an ' +
        'in-project action, narrow the command instead.');
}
/**
 * True when assistant text offloads in-project work onto the user or directs
 * them to act outside the project ("run this yourself", "in your terminal",
 * "führe das selbst aus", "außerhalb des Projekts", …).
 */
const OFFLOAD_PATTERNS = [
    /\b(?:run|execute|paste|type|copy|move|carry out|perform)\b[^.!?]{0,120}\b(?:yourself|your own|your terminal|your machine|manually|by hand|outside (?:the|this) (?:project|repo|repository|folder|directory|workspace))\b/i,
    /\b(?:outside (?:the|this) (?:project|repo|repository|folder|directory|workspace))\b[^.!?]{0,120}\b(?:run|execute|paste|type|copy|move|create|edit|perform)\b/i,
    /\bgo (?:outside|up) (?:of )?(?:the|this) (?:project|repo|folder|workspace)\b/i,
    /\b(?:führe|führen|ausführen|einfügen|kopiere|kopieren|verschiebe|erstell)\b[^.!?]{0,120}\b(?:selbst|manuell|in deine[mn] Terminal|außerhalb)\b/i,
    /\baußerhalb (?:des|der) (?:Projekts?|Projektordners|Repositorys?|Workspaces?)\b[^.!?]{0,120}\b(?:ausführen|einfügen|kopieren|verschieben|erstellen|bearbeiten)\b/i,
    /\bgehe?\b[^.!?]{0,80}\b(?:außerhalb|hinaus)\b/i,
];
export function isOffloadAsk(text) {
    return OFFLOAD_PATTERNS.some((re) => re.test(text));
}
export const OFFLOAD_MESSAGE = 'token-guard: the assistant asked the user to run/do work outside the project (or to take ' +
    'over in-project work). In-project work stays in-project: do it with edit/write/bash inside ' +
    'the project root. If a permission prompt blocked an in-project action, retry with a narrower ' +
    'in-project command — never offload it to the user.';
export function optionsFromEnv(env = process.env) {
    const int = (v) => v === undefined || v === '' ? undefined : Number.parseInt(v, 10);
    const opts = {
        maxConsecutiveBash: int(env.TOKEN_GUARD_MAX_CONSECUTIVE_BASH),
        minEditsPerVerify: int(env.TOKEN_GUARD_MIN_EDITS_PER_VERIFY),
        stepBudget: int(env.TOKEN_GUARD_STEP_BUDGET),
        contextBudgetTokens: int(env.TOKEN_GUARD_CONTEXT_BUDGET),
    };
    const clean = {};
    if (opts.maxConsecutiveBash !== undefined)
        clean.maxConsecutiveBash = opts.maxConsecutiveBash;
    if (opts.minEditsPerVerify !== undefined)
        clean.minEditsPerVerify = opts.minEditsPerVerify;
    if (opts.stepBudget !== undefined)
        clean.stepBudget = opts.stepBudget;
    if (opts.contextBudgetTokens !== undefined)
        clean.contextBudgetTokens = opts.contextBudgetTokens;
    return clean;
}
