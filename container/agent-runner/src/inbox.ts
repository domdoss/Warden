/**
 * Orchestrator inbox for async sub-agent results.
 *
 * Background jobs push their full results here instead of messaging the user
 * directly. The orchestrator drains unread items at turn end (or immediately
 * for urgent ones, injected mid-turn), digests them in its own voice, and can
 * chain follow-up tasks. Raw outputs stay retrievable via read_job_result.
 *
 * In-memory by design: background jobs live and die with the runner process,
 * so the inbox shares that lifetime.
 */

export interface InboxItem {
    jobId: string;
    agent: string;
    task: string;
    fullResult: string;
    status: 'done' | 'errored' | 'aborted';
    urgent: boolean;
    read: boolean;
    finishedAt: number;
}

const items = new Map<string, InboxItem>();
let waiters: Array<() => void> = [];

export function push(item: Omit<InboxItem, 'read' | 'finishedAt'>): void {
    items.set(item.jobId, { ...item, read: false, finishedAt: Date.now() });
    const toWake = waiters;
    waiters = [];
    for (const wake of toWake) wake();
}

export function unread(): InboxItem[] {
    return [...items.values()].filter((i) => !i.read).sort((a, b) => a.finishedAt - b.finishedAt);
}

export function unreadUrgent(): InboxItem[] {
    return unread().filter((i) => i.urgent);
}

export function markRead(jobId: string): void {
    const item = items.get(jobId);
    if (item) item.read = true;
}

export function get(jobId: string): InboxItem | undefined {
    return items.get(jobId);
}

export function all(): InboxItem[] {
    return [...items.values()].sort((a, b) => a.finishedAt - b.finishedAt);
}

/** Resolves when the next item is pushed. Race against IPC input while idle. */
export function waitForItem(): Promise<void> {
    return new Promise((resolve) => waiters.push(resolve));
}

/** One-line summary used in drain prompts and read_job_result listings. */
export function summaryLine(i: InboxItem): string {
    const age = Math.round((Date.now() - i.finishedAt) / 1000);
    const statusNote = i.status === 'done' ? '' : ` [${i.status.toUpperCase()}]`;
    return `- ${i.jobId} (${i.agent}, finished ${age}s ago)${statusNote} task: "${i.task.slice(0, 120)}" → result preview: ${i.fullResult.slice(0, 200).replace(/\n/g, ' ')}`;
}
