import { registry } from '../tool-registry.js';
import { getFabricIndex, getFabricPatternContent, rankFabricPatterns } from '../dynamic-selection.js';

registry.register({
    name: 'fabric_pattern',
    description: '{"what":"load an expert prompt pattern from the Fabric library","returns":"the full system prompt — follow it","when":"a listed RELEVANT PATTERN fits the task"}',
    schema: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: '{"what":"the pattern to load","format":"snake_case directory name","source":"the RELEVANT PATTERNS list for this turn"}',
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
