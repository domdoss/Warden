import { registry } from '../tool-registry.js';

function writeCallback(tool: string, args: unknown): void {
    process.stdout.write('CALLBACK_START\n');
    process.stdout.write(JSON.stringify({ tool, args }) + '\n');
    process.stdout.write('CALLBACK_END\n');
}

registry.register({
    name: 'open_app',
    description: 'SHOW something on the host display and return immediately — a PDF, a folder, an image, or an app the user just wants open. Use app \'xdg-open\' with an absolute path for a file in its default viewer, or the app binary to launch it. This is fire-and-forget: it does NOT let you drive what it opened. To DRIVE a desktop app (click its controls, type into it) launch it with Bash instead, then desktop_screenshot to see it and desktop_click / desktop_type to work it. For a web page, browser_navigate — never xdg-open a URL you intend to keep working in.',
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
