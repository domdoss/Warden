// ESM loader hook: stub dist/agent-runner/index.js so we can import the tool
// modules (which import writeCallbackAsync from ../index.js) WITHOUT running
// the agent main loop. Registration is a top-level side effect; handlers are
// never called, so no-op stubs are enough.
export async function load(url, ctx, next) {
  let u;
  try { u = new URL(url); } catch { return next(url, ctx); }
  if (u.pathname.endsWith('/dist/agent-runner/index.js')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: [
        'export const writeCallbackAsync = async () => ({ ok: true, data: {} });',
        'export const writeCallback = async () => ({ ok: true, data: {} });',
      ].join('\n'),
    };
  }
  return next(url, ctx);
}