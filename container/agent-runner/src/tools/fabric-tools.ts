import { registry } from '../tool-registry.js';
import { getFabricIndex, getFabricPatternContent, rankFabricPatterns } from '../dynamic-selection.js';

registry.register({
    name: 'fabric_pattern',
    description:
        'Load an expert prompt pattern from the Fabric prompt library by name (e.g. "summarize", "analyze_claims", "extract_wisdom"). Returns the full system prompt for that pattern — follow its instructions to perform the task at expert level. Use when a listed RELEVANT PATTERN fits the current task.',
    schema: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'Pattern name, e.g. "summarize" or "analyze_claims" (snake_case directory name)',
            },
        },
        required: ['name'],
    },
    handler: async (args, _context) => {
        const name = String(args.name || '').trim();
        if (!name) return 'Error: name is required';
        const content = getFabricPatternContent(name);
        if (content) {
            return `[Fabric pattern: ${name}]\n\n${content}`;
        }
        // Not found — suggest close matches so the model can self-correct
        try {
            const index = getFabricIndex();
            const suggestions = rankFabricPatterns(
                name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
                5
            ).map((p) => p.name);
            if (suggestions.length > 0) {
                return `Error: pattern "${name}" not found. Did you mean: ${suggestions.join(', ')}?`;
            }
            return `Error: pattern "${name}" not found (${index.size} patterns available).`;
        } catch {
            return `Error: pattern "${name}" not found.`;
        }
    },
    toolset: 'fabric',
    tier: 'both',
});
