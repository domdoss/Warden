import { registry } from '../tool-registry.js';

function writeCallback(tool: string, args: unknown): void {
    process.stdout.write('CALLBACK_START\n');
    process.stdout.write(JSON.stringify({ tool, args }) + '\n');
    process.stdout.write('CALLBACK_END\n');
}

registry.register({
    name: 'open_app',
    // One-line JSON ≤200 chars: stripTier clamps anything longer to the first
    // line, slicing mid-JSON — and the old prose (which named the retired
    // browser_navigate tool) was ~600 chars, so the seat only ever saw its
    // first sentence anyway.
    description: '{"what":"open a file/app on the host display, fire-and-forget","app":"binary name, or xdg-open with an absolute file path","rule":"no driving what it opened; web pages belong to the browser tools"}',
    schema: {
        type: 'object',
        properties: {
            app: { type: 'string', description: 'Application binary name or full path' },
            args: { type: 'array', items: { type: 'string' }, description: 'Optional arguments to pass to the application' },
        },
        required: ['app'],
    },
    handler: async (args, _context) => {
        if (process.env.ANTHESIS_GOVERNED_WRITES === 'true') {
            return 'Error: Anthesis governed mode rejects host callbacks.';
        }
        writeCallback('open_app', args);
        return `Launching ${args.app}...`;
    },
    toolset: 'terminal',
    tier: 'public',
});
