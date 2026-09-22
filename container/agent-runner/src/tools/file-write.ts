import fs from "fs";
import path from "path";
import { registry } from "../tool-registry.js";
import { cleanFilePath, resolveUserPath } from "../ipc-helpers.js";
import { authorizeFileWrite, sha256Digest } from "../anthesis-authorization.js";

function stateDigest(filePath: string): string {
  try {
    return sha256Digest({
      exists: true,
      content: fs.readFileSync(filePath, "utf8"),
    });
  } catch (error: any) {
    if (error?.code === "ENOENT") return sha256Digest({ exists: false });
    return sha256Digest({ exists: false, error: "unreadable" });
  }
}

function assertNoSymlinkComponents(filePath: string, root: string): void {
  let current = path.resolve(root);
  const relativeParent = path.relative(current, path.dirname(filePath));
  for (const component of relativeParent.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error("target path contains a symlink component");
    }
  }
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error("target path is a symlink");
  }
}

function appendEvidence(
  filePath: string | undefined,
  authorization: Awaited<ReturnType<typeof authorizeFileWrite>>,
  outcome: "success" | "failure" | "denied-before-effect",
  beforeDigest?: string,
  afterDigest?: string,
): void {
  if (!filePath || !authorization.request || !authorization.decision) return;
  const evidence = {
    version: "warden.anthesis-write-evidence/v1",
    recorded_at: new Date().toISOString(),
    outcome,
    target: authorization.request.target,
    attempt_id: authorization.request.attemptId,
    request_binding: authorization.request.requestBinding,
    decision: authorization.decision,
    pre_state_digest: beforeDigest,
    post_state_digest: afterDigest,
  };
  fs.appendFileSync(filePath, `${JSON.stringify(evidence)}\n`, "utf8");
}

registry.register({
  name: "Write",
  description: "Write content to a file.",
  schema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description:
          'Relative path to file (e.g. "notes.md" or "docs/plan.md")',
      },
      content: { type: "string", description: "Content to write" },
    },
    required: ["file_path", "content"],
  },
  handler: async (args, _context) => {
    const cleaned = cleanFilePath(args.file_path);
    if (cleaned.startsWith("attachments/") || cleaned === "attachments") {
      return `Error: attachments/ is read-only input. Copy the file first: Bash("cp attachments/${path.basename(cleaned)} myproject/")`;
    }
    const authorization = await authorizeFileWrite(
      cleaned,
      args.content,
      _context,
      {
        trialRoot: process.env.ANTHESIS_TRIAL_ROOT || process.cwd(),
        runtimeId: process.env.ANTHESIS_TRIAL_RUNTIME || "warden-agent-runner",
        attemptId: process.env.ANTHESIS_TRIAL_ATTEMPT_ID,
      },
    );
    if (!authorization.allowed) {
      appendEvidence(
        process.env.ANTHESIS_TRIAL_EVIDENCE_FILE,
        authorization,
        "denied-before-effect",
        authorization.request
          ? stateDigest(authorization.request.absoluteTarget)
          : undefined,
      );
      const reason = authorization.decision?.reason || "authorization_denied";
      return `Error: Anthesis authorization denied: ${reason}`;
    }
    const filePath =
      authorization.mode === "governed" && authorization.request
        ? authorization.request.absoluteTarget
        : resolveUserPath(args.file_path);
    const beforeDigest =
      authorization.mode === "governed" ? stateDigest(filePath) : undefined;
    if (
      args.file_path.endsWith(".md") &&
      (!args.content || args.content.trim() === "")
    ) {
      return `Error: Cannot delete or clear .md files. Protected file: ${args.file_path}`;
    }
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      if (authorization.mode === "governed") {
        assertNoSymlinkComponents(
          filePath,
          process.env.ANTHESIS_TRIAL_ROOT || process.cwd(),
        );
        const descriptor = fs.openSync(
          filePath,
          fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_TRUNC |
            fs.constants.O_NOFOLLOW,
          0o644,
        );
        try {
          fs.writeFileSync(descriptor, args.content);
        } finally {
          fs.closeSync(descriptor);
        }
      } else {
        fs.writeFileSync(filePath, args.content);
      }
      appendEvidence(
        process.env.ANTHESIS_TRIAL_EVIDENCE_FILE,
        authorization,
        "success",
        beforeDigest,
        authorization.mode === "governed" ? stateDigest(filePath) : undefined,
      );
      // Report the RESOLVED absolute path — the orchestrator's digest
      // confirm step checks claimed paths against the ask, which only
      // works if the claim is real ('~/Desktop/x' resolved, not literal).
      return `File written: ${filePath}`;
    } catch (err: any) {
      appendEvidence(
        process.env.ANTHESIS_TRIAL_EVIDENCE_FILE,
        authorization,
        "failure",
        beforeDigest,
        authorization.mode === "governed" ? stateDigest(filePath) : undefined,
      );
      return `Error writing file: ${err.message}`;
    }
  },
  toolset: "file",
  tier: "both",
});
