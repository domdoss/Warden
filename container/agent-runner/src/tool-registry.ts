export interface ToolDef {
    name: string;
    description: string;
    schema: Record<string, any>;
    handler: (args: Record<string, any>, context: ToolContext) => Promise<string> | string;
    toolset: string;
    tier?: 'public' | 'private' | 'both';
    checkFn?: () => boolean;
}

export interface ToolContext {
    chatJid: string;
    groupFolder: string;
    isMain: boolean;
    userId: string;
}

export interface ToolsetDef {
    name: string;
    tools?: string[];
    includes?: string[];
    tier?: 'public' | 'private' | 'both';
}

class ToolRegistry {
    private tools: Map<string, ToolDef> = new Map();
    private toolsets: Map<string, ToolsetDef> = new Map();

    register(def: ToolDef): void {
        this.tools.set(def.name, def);
    }

    getDefinitions(names: string[]): any[] {
        return names
            .map((n) => this.tools.get(n))
            .filter((t): t is ToolDef => !!t)
            .map((t) => ({
                type: 'function',
                tier: t.tier,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.schema,
                },
            }));
    }

    async dispatch(
        name: string,
        args: Record<string, any>,
        context: ToolContext
    ): Promise<string> {
        const tool = this.tools.get(name);
        if (!tool) return `Error: Unknown tool ${name}`;
        try {
            return await tool.handler(args, context);
        } catch (err: any) {
            return `Error: ${err.message}`;
        }
    }

    getToolNamesForToolset(name: string): string[] {
        const resolved = this.resolveToolset(name);
        return resolved;
    }

    resolveToolset(name: string): string[] {
        const seen = new Set<string>();
        const result: string[] = [];
        const visit = (n: string) => {
            if (seen.has(n)) return;
            seen.add(n);
            const ts = this.toolsets.get(n);
            if (!ts) return;
            if (ts.includes) {
                for (const inc of ts.includes) visit(inc);
            }
            if (ts.tools) {
                for (const t of ts.tools) {
                    if (!seen.has(t)) {
                        seen.add(t);
                        result.push(t);
                    }
                }
            }
        };
        visit(name);
        return result;
    }

    resolveMultipleToolsets(names: string[]): string[] {
        const seen = new Set<string>();
        for (const name of names) {
            for (const t of this.resolveToolset(name)) {
                if (!seen.has(t)) {
                    seen.add(t);
                }
            }
        }
        return [...seen];
    }

    registerToolset(def: ToolsetDef): void {
        this.toolsets.set(def.name, def);
    }

    getToolset(name: string): ToolsetDef | undefined {
        return this.toolsets.get(name);
    }

    getAllToolNames(): string[] {
        return [...this.tools.keys()];
    }

    /** Return tool defs filtered by tier */
    getByTier(tier: 'public' | 'private' | 'both'): ToolDef[] {
        return [...this.tools.values()].filter(
            (t) => t.tier === tier || t.tier === 'both'
        );
    }

    /** Return only the 'both' tier tools */
    getBothTools(): ToolDef[] {
        return [...this.tools.values()].filter((t) => t.tier === 'both');
    }
}

export const registry = new ToolRegistry();
