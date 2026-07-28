import { registry } from '../tool-registry.js';

function writeCallback(tool: string, args: unknown): void {
    process.stdout.write('CALLBACK_START\n');
    process.stdout.write(JSON.stringify({ tool, args }) + '\n');
    process.stdout.write('CALLBACK_END\n');
}

registry.register({
    name: 'open_app',
    description: 'Launch a desktop application on the host machine display. Use for GUI apps that need a real graphical environment. The app launches detached and immediately returns.',
    schema: {
        type: 'object',
        properties: {
            app: { type: 'string', description: 'Application binary name or full path' },
            args: { type: 'array', items: { type: 'string' }, description: 'Optional arguments to pass to the application' },
        },
        required: ['app'],
    },
    handler: async (args, _context) => {
        writeCallback('open_app', args);
        return `Launching ${args.app}...`;
    },
    toolset: 'terminal',
    tier: 'public',
});
