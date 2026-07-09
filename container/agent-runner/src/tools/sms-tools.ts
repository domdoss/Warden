import { registry } from '../tool-registry.js';
import { writeIpcFile, waitForResult, TASKS_DIR } from '../ipc-helpers.js';

registry.register({
    name: 'send_sms',
    description: "Send an SMS text message via the user's connected Twilio account.",
    schema: {
        type: 'object',
        properties: {
            to: { type: 'string', description: 'Phone number in E.164 format (e.g. "+15551234567")' },
            body: { type: 'string', description: 'Message text' },
        },
        required: ['to', 'body'],
    },
    handler: async (args, context) => {
        writeIpcFile(TASKS_DIR, { type: 'send_sms', userId: context.userId, to: args.to, body: args.body, timestamp: new Date().toISOString() });
        const smsResult = await waitForResult('sms-send-');
        if (smsResult) {
            if (smsResult.success) return `SMS sent to ${args.to}`;
            return `Error sending SMS: ${smsResult.error || 'Unknown error'}`;
        }
        return 'SMS send requested. Timeout waiting for results.';
    },
    toolset: 'sms',
    tier: 'private',
});

registry.register({
    name: 'read_sms',
    description: "Read recent SMS messages from the user's connected Twilio account.",
    schema: {
        type: 'object',
        properties: {
            limit: { type: 'number', description: 'Max messages to return (default 20)' },
            from: { type: 'string', description: 'Filter by sender phone number' },
        },
    },
    handler: async (args, context) => {
        writeIpcFile(TASKS_DIR, { type: 'read_sms', userId: context.userId, limit: Math.min(parseInt(args.limit) || 50, 100), from: args.from || undefined, timestamp: new Date().toISOString() });
        const smsData = await waitForResult('sms-read-');
        if (smsData) {
            if (smsData.error) return `Error: ${smsData.error}`;
            return `SMS messages:\n${JSON.stringify(smsData.messages, null, 2).slice(0, 4000)}`;
        }
        return 'SMS read requested. Timeout waiting for results.';
    },
    toolset: 'sms',
    tier: 'private',
});
