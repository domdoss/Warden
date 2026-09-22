import { registry } from '../tool-registry.js';
import { writeCallbackAsync } from '../index.js';

// Artemis's one write: flag a confirmed fine-tunable failure for the training
// loop. The HOST appends it to training/loop/flags (src/training-flags.ts);
// the loop's modify step turns pending flags into corrective SFT rows. Artemis
// stays read-only everywhere else — this tool writes only that store.
registry.register({
    name: 'flag_training_error',
    description: '{"what":"mark one confirmed fine-tunable failure as a training error","when":"once per failure, after quoting its real log lines","result":"the flag id"}',
    schema: {
        type: 'object',
        properties: {
            failure_class: {
                type: 'string',
                enum: ['wrong_tool', 'bad_arguments', 'narrated_no_call', 'call_as_text', 'wrong_shape', 'dead_end_no_tools', 'refusal', 'hallucinated_answer'],
                description: '{"type":"enum","wrong_tool":"picked a tool that does not own the job while the right one was listed","bad_arguments":"right tool, wrong or invented argument values","narrated_no_call":"described an action and made no call","call_as_text":"wrote the tool call into the reply text","wrong_shape":"answer shape differs from what was asked","dead_end_no_tools":"answered without acting when acting was required","refusal":"claimed inability or asked for clarification instead of acting","hallucinated_answer":"stated something the log contradicts"}',
            },
            log_excerpt: {
                type: 'string',
                description: '{"type":"string","source":"verbatim lines from warden.log or journalctl","content":"the user ask, the Executing tool: call and its result line"}',
            },
            log_timestamp: {
                type: 'string',
                description: '{"type":"string","source":"the timestamp on the failed call\'s log line"}',
            },
            what_went_wrong: {
                type: 'string',
                description: '{"type":"string","content":"one to three sentences on the model\'s choice"}',
            },
            correct_behavior: {
                type: 'string',
                description: '{"type":"string","content":"the call and reply the turn should have made"}',
            },
            role: {
                type: 'string',
                enum: ['seat', 'orch'],
                description: '{"type":"enum","default":"seat","orch":"the failure was in delegation or routing"}',
            },
            tools_relevant: {
                type: 'array',
                items: { type: 'string' },
                description: '{"type":"array of tool names","source":"tools named in the excerpt"}',
            },
        },
        required: ['failure_class', 'log_excerpt', 'what_went_wrong', 'correct_behavior'],
    },
    handler: async (args) => {
        let resp: any;
        try {
            resp = await writeCallbackAsync('flag_training_error', args || {}, 15000);
        } catch (err: any) {
            return `flag_training_error failed: ${err?.message ?? err}`;
        }
        if (!resp?.ok) return `flag_training_error failed: ${resp?.error || 'unknown error'}`;
        return resp.duplicate ? `Already flagged as ${resp.id}.` : `Flagged as ${resp.id}; the training loop picks it up on its next modify step.`;
    },
    toolset: 'artemis-flag',
    tier: 'public',
});
