export interface HookContext {
    toolName?: string;
    toolArgs?: Record<string, any>;
    toolResult?: string;
    sessionId?: string;
    model?: string;
    toolCallId?: string;
    durationMs?: number;
}

export interface HookResult {
    block?: string;
    context?: string;
}

type HookCallback = (ctx: HookContext) => void | HookResult | Promise<void | HookResult>;

class HookSystem {
    private hooks = new Map<string, HookCallback[]>();

    register(event: string, callback: HookCallback): void {
        const list = this.hooks.get(event) || [];
        list.push(callback);
        this.hooks.set(event, list);
    }

    async invoke(event: string, ctx: HookContext): Promise<HookResult[]> {
        const list = this.hooks.get(event);
        if (!list || list.length === 0) return [];
        const results: HookResult[] = [];
        for (const cb of list) {
            try {
                const r = await cb(ctx);
                if (r && typeof r === 'object') results.push(r);
            } catch {
                // Hook errors should never break tool execution
            }
        }
        return results;
    }
}

export const hooks = new HookSystem();
