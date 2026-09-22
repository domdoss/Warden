import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeFileWrite,
  buildFileWriteRequest,
  normalizeTrialPath,
  sha256Digest,
  type AuthorizationDecision,
} from "./anthesis-authorization.js";

const labBinary = process.env.ANTHESIS_LAB_BIN;
const labRepo = process.env.ANTHESIS_LAB_REPO;

describe("Anthesis trial authorization request binding", () => {
  beforeEach(() => vi.stubEnv("ANTHESIS_TRIAL_ATTEMPT_ID", "test-attempt"));
  afterEach(() => vi.unstubAllEnvs());

  it("normalizes a relative target and rejects workspace escapes", () => {
    expect(normalizeTrialPath("nested/../allowed.txt")).toBe("allowed.txt");
    expect(() => normalizeTrialPath("../outside.txt")).toThrow(
      "outside trial root",
    );
    expect(() => normalizeTrialPath("/tmp/outside.txt")).toThrow("absolute");
    expect(() => normalizeTrialPath("nested\\outside.txt")).toThrow(
      "separator",
    );
  });

  it("binds the exact target and payload to stable digests", () => {
    const context = {
      chatJid: "owner@local",
      groupFolder: "owner",
      isMain: true,
      userId: "owner",
    };
    const first = buildFileWriteRequest(
      "nested/../allowed.txt",
      "one",
      context,
      {
        trialRoot: "/tmp/anthesis-trial",
        runtimeId: "warden-trial",
      },
    );
    const same = buildFileWriteRequest("allowed.txt", "one", context, {
      trialRoot: "/tmp/anthesis-trial",
      runtimeId: "warden-trial",
    });
    const changedTarget = buildFileWriteRequest("other.txt", "one", context, {
      trialRoot: "/tmp/anthesis-trial",
      runtimeId: "warden-trial",
    });
    const changedPayload = buildFileWriteRequest(
      "allowed.txt",
      "two",
      context,
      {
        trialRoot: "/tmp/anthesis-trial",
        runtimeId: "warden-trial",
      },
    );

    expect(first).toEqual(same);
    expect(changedTarget.requestBinding.input_digest).not.toBe(
      first.requestBinding.input_digest,
    );
    expect(changedPayload.requestBinding.input_digest).not.toBe(
      first.requestBinding.input_digest,
    );
    expect(first.requestBinding.input_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sha256Digest({ b: 2, a: 1 })).toBe(sha256Digest({ a: 1, b: 2 }));
  });

  it("binds caller identity into the input digest", () => {
    const options = {
      trialRoot: "/tmp/anthesis-trial",
      runtimeId: "warden-trial",
    };
    const owner = buildFileWriteRequest(
      "allowed.txt",
      "one",
      {
        chatJid: "owner@local",
        groupFolder: "owner",
        isMain: true,
        userId: "owner",
      },
      options,
    );
    const otherUser = buildFileWriteRequest(
      "allowed.txt",
      "one",
      {
        chatJid: "other@local",
        groupFolder: "other",
        isMain: true,
        userId: "other",
      },
      options,
    );

    expect(otherUser.requestBinding.input_digest).not.toBe(
      owner.requestBinding.input_digest,
    );
  });

  it("binds attempt identity so an approval cannot be replayed", () => {
    const context = {
      chatJid: "owner@local",
      groupFolder: "owner",
      isMain: true,
      userId: "owner",
    };
    const approvedAttempt = buildFileWriteRequest(
      "allowed.txt",
      "one",
      context,
      {
        trialRoot: "/tmp/anthesis-trial",
        runtimeId: "warden-trial",
        attemptId: "attempt-a",
      },
    );
    const replayAttempt = buildFileWriteRequest("allowed.txt", "one", context, {
      trialRoot: "/tmp/anthesis-trial",
      runtimeId: "warden-trial",
      attemptId: "attempt-b",
    });

    expect(replayAttempt.requestBinding.input_digest).not.toBe(
      approvedAttempt.requestBinding.input_digest,
    );
    expect(replayAttempt.requestBinding.request_digest).not.toBe(
      approvedAttempt.requestBinding.request_digest,
    );
  });

  it("rejects a symlinked target outside the trial root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "warden-root-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "warden-outside-"));
    await fs.symlink(outside, path.join(root, "link"));
    vi.stubEnv("ANTHESIS_GOVERNED_WRITES", "true");

    const result = await authorizeFileWrite(
      "link/escaped.txt",
      "blocked",
      {
        chatJid: "owner@local",
        groupFolder: "owner",
        isMain: true,
        userId: "owner",
      },
      { trialRoot: root, runtimeId: "warden-trial" },
    );

    expect(result.allowed).toBe(false);
    expect(result.decision?.reason).toBe("invalid_input");
    await expect(
      fs.access(path.join(outside, "escaped.txt")),
    ).rejects.toThrow();
  });

  it.skipIf(
    !labBinary || !labRepo || !existsSync(labBinary) || !existsSync(labRepo),
  )("authorizes a generated scenario through Governance Lab", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "warden-lab-"));
    vi.stubEnv("ANTHESIS_GOVERNED_WRITES", "true");
    vi.stubEnv("ANTHESIS_TRIAL_EXPECTED_DECISION", "allow");
    vi.stubEnv("ANTHESIS_TRIAL_EXPECTED_SOURCE", "policy_rule");
    vi.stubEnv("ANTHESIS_TRIAL_EXPECTED_RULE", "scoped-docs-and-code-write");
    vi.stubEnv("ANTHESIS_TRIAL_EXPECTED_REASON", "scoped_write");

    const result = await authorizeFileWrite(
      "docs/onboarding.md",
      "Governed Warden content.",
      {
        chatJid: "owner@local",
        groupFolder: "owner",
        isMain: true,
        userId: "owner",
      },
      { trialRoot: root, runtimeId: "ollama-qwen3-14b" },
    );

    expect(result.allowed).toBe(true);
    expect(result.decision?.engine?.name).toBe("anthesis-lab");
  });

  it.skipIf(
    !labBinary || !labRepo || !existsSync(labBinary) || !existsSync(labRepo),
  )("preserves an engine-guard denial from Governance Lab", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "warden-lab-deny-"));
    vi.stubEnv("ANTHESIS_GOVERNED_WRITES", "true");
    vi.stubEnv("ANTHESIS_TRIAL_EXPECTED_DECISION", "deny");
    vi.stubEnv("ANTHESIS_TRIAL_EXPECTED_SOURCE", "engine_guard");
    vi.stubEnv("ANTHESIS_TRIAL_EXPECTED_RULE", "");
    vi.stubEnv("ANTHESIS_TRIAL_EXPECTED_REASON", "unknown_runtime");

    const result = await authorizeFileWrite(
      "docs/onboarding.md",
      "Must not execute.",
      {
        chatJid: "owner@local",
        groupFolder: "owner",
        isMain: true,
        userId: "owner",
      },
      { trialRoot: root, runtimeId: "unregistered-runtime" },
    );

    expect(result.allowed).toBe(false);
    expect(result.decision?.decision).toBe("deny");
    expect(result.decision?.source).toBe("engine_guard");
    expect(result.decision?.reason).toBe("unknown_runtime");
  });

  it("does not treat approval-required or denied as executable", () => {
    const decisions: AuthorizationDecision[] = [
      { decision: "deny", source: "policy_rule", reason: "blocked" },
      {
        decision: "approval_required",
        source: "policy_rule",
        reason: "needs approval",
      },
    ];

    for (const result of decisions) {
      expect(result.decision).not.toBe("allow");
    }
  });

  it("preserves the ungoverned baseline when the adapter is disabled", async () => {
    vi.stubEnv("ANTHESIS_GOVERNED_WRITES", "false");
    const result = await authorizeFileWrite(
      "allowed.txt",
      "one",
      {
        chatJid: "owner@local",
        groupFolder: "owner",
        isMain: true,
        userId: "owner",
      },
      { trialRoot: "/tmp/anthesis-trial", runtimeId: "warden-trial" },
    );

    expect(result.allowed).toBe(true);
    expect(result.mode).toBe("ungoverned");
  });

  it("fails closed when governed mode has no attempt identity", async () => {
    vi.stubEnv("ANTHESIS_GOVERNED_WRITES", "true");
    vi.stubEnv("ANTHESIS_TRIAL_ATTEMPT_ID", "");
    const result = await authorizeFileWrite(
      "allowed.txt",
      "one",
      {
        chatJid: "owner@local",
        groupFolder: "owner",
        isMain: true,
        userId: "owner",
      },
      { trialRoot: "/tmp/anthesis-trial", runtimeId: "warden-trial" },
    );

    expect(result.allowed).toBe(false);
    expect(result.decision?.reason).toBe("missing_attempt_id");
  });

  it("fails closed when enabled without a structured decision", async () => {
    vi.stubEnv("ANTHESIS_GOVERNED_WRITES", "true");
    vi.stubEnv("ANTHESIS_TRIAL_ROOT", "/tmp/anthesis-trial");
    const result = await authorizeFileWrite(
      "allowed.txt",
      "one",
      {
        chatJid: "owner@local",
        groupFolder: "owner",
        isMain: true,
        userId: "owner",
      },
      { trialRoot: "/tmp/anthesis-trial", runtimeId: "warden-trial" },
    );

    expect(result.allowed).toBe(false);
    expect(result.decision?.source).toBe("engine_guard");
  });

  it("allows only an exact structured decision and blocks a changed target", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "warden-anthesis-"));
    const decisionPath = path.join(root, "decision.json");
    const context = {
      chatJid: "owner@local",
      groupFolder: "owner",
      isMain: true,
      userId: "owner",
    };
    const request = buildFileWriteRequest("allowed.txt", "one", context, {
      trialRoot: root,
      runtimeId: "warden-trial",
    });
    const decision = {
      version: "anthesis.decision/v1",
      scenario_id: "file-write-allow",
      decision: "allow",
      decision_source: "policy_rule",
      policy: "trial-policy",
      policy_digest: sha256Digest("trial-policy"),
      canonicalization: "rfc8785-json",
      policy_rule_id: "allow-scoped-write",
      reason: "scoped_write",
      effect: {
        action: "file.write",
        resource: { path: request.target },
        command: null,
        actor: request.actor,
        runtime: request.runtime,
      },
      engine: { name: "anthesis-lab", version: "test" },
      request_binding: request.requestBinding,
    };
    await fs.writeFile(decisionPath, JSON.stringify(decision));
    vi.stubEnv("ANTHESIS_GOVERNED_WRITES", "true");
    vi.stubEnv("ANTHESIS_LAB_BIN", "");
    vi.stubEnv("ANTHESIS_TRIAL_DECISION_FILE", decisionPath);

    const allowed = await authorizeFileWrite("allowed.txt", "one", context, {
      trialRoot: root,
      runtimeId: "warden-trial",
    });
    expect(allowed.allowed).toBe(true);

    decision.policy_digest = "not-a-digest";
    await fs.writeFile(decisionPath, JSON.stringify(decision));
    const malformed = await authorizeFileWrite("allowed.txt", "one", context, {
      trialRoot: root,
      runtimeId: "warden-trial",
    });
    expect(malformed.allowed).toBe(false);
    expect(malformed.decision?.reason).toBe("malformed_decision");

    decision.policy_digest = sha256Digest("trial-policy");
    await fs.writeFile(decisionPath, JSON.stringify(decision));
    const changed = await authorizeFileWrite("other.txt", "one", context, {
      trialRoot: root,
      runtimeId: "warden-trial",
    });

    expect(changed.allowed).toBe(false);
    expect(changed.decision?.reason).toBe("request_binding_mismatch");
  });

  it("enforces the decision before the registered Write handler mutates state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "warden-write-"));
    const decisionPath = path.join(root, "decision.json");
    const context = {
      chatJid: "owner@local",
      groupFolder: "owner",
      isMain: true,
      userId: "owner",
    };
    const request = buildFileWriteRequest("allowed.txt", "after", context, {
      trialRoot: root,
      runtimeId: "warden-agent-runner",
    });
    await fs.writeFile(path.join(root, "allowed.txt"), "before");
    await fs.writeFile(
      decisionPath,
      JSON.stringify({
        version: "anthesis.decision/v1",
        scenario_id: "file-write-allow",
        decision: "allow",
        decision_source: "policy_rule",
        policy: "trial-policy",
        policy_digest: sha256Digest("trial-policy"),
        canonicalization: "rfc8785-json",
        policy_rule_id: "allow-scoped-write",
        reason: "scoped_write",
        effect: {
          action: "file.write",
          resource: { path: request.target },
          command: null,
          actor: request.actor,
          runtime: request.runtime,
        },
        engine: { name: "anthesis-lab", version: "test" },
        request_binding: request.requestBinding,
      }),
    );
    vi.stubEnv("ANTHESIS_GOVERNED_WRITES", "true");
    vi.stubEnv("ANTHESIS_LAB_BIN", "");
    vi.stubEnv("ANTHESIS_TRIAL_ROOT", root);
    vi.stubEnv("ANTHESIS_TRIAL_RUNTIME", "warden-agent-runner");
    vi.stubEnv("ANTHESIS_TRIAL_DECISION_FILE", decisionPath);
    vi.stubEnv("ANTHESIS_TRIAL_RESTRICT_TOOLS", "true");
    const evidencePath = path.join(root, "evidence.jsonl");
    vi.stubEnv("ANTHESIS_TRIAL_EVIDENCE_FILE", evidencePath);

    await import("./tools/file-write.js");
    const { registry } = await import("./tool-registry.js");
    const { resolveToolset } = await import("./toolsets.js");
    expect(resolveToolset("anthesis-trial")).toEqual(["Write"]);
    expect(registry.getDefinitions(["Write", "Edit"])).toHaveLength(1);
    expect(await registry.dispatch("Edit", {}, context)).toContain(
      "Anthesis trial tool denied",
    );
    const allowed = await registry.dispatch(
      "Write",
      { file_path: "allowed.txt", content: "after" },
      context,
    );
    expect(allowed).toContain("File written:");
    expect(await fs.readFile(path.join(root, "allowed.txt"), "utf8")).toBe(
      "after",
    );
    const successEvidence = JSON.parse(
      (await fs.readFile(evidencePath, "utf8")).trim(),
    );
    expect(successEvidence.outcome).toBe("success");
    expect(successEvidence.adapter_version).toBe("warden-anthesis-adapter/v1");
    expect(successEvidence.evaluator.name).toBe("anthesis-lab");
    expect(successEvidence.evaluator.version).toBe("test");
    expect(successEvidence.target).toBe("allowed.txt");
    expect(successEvidence.pre_state_digest).not.toBe(
      successEvidence.post_state_digest,
    );

    vi.stubEnv(
      "ANTHESIS_TRIAL_EVIDENCE_FILE",
      path.join(root, "missing", "evidence.jsonl"),
    );
    const indeterminate = await registry.dispatch(
      "Write",
      { file_path: "allowed.txt", content: "after" },
      context,
    );
    expect(indeterminate).toContain("write indeterminate");
    expect(await fs.readFile(path.join(root, "allowed.txt"), "utf8")).toBe(
      "after",
    );

    vi.stubEnv("ANTHESIS_TRIAL_EVIDENCE_FILE", evidencePath);
    await fs.writeFile(path.join(root, "allowed.txt"), "before");
    const blocked = await registry.dispatch(
      "Write",
      { file_path: "other.txt", content: "blocked" },
      context,
    );
    expect(blocked).toContain("request_binding_mismatch");
    expect(await fs.readFile(path.join(root, "allowed.txt"), "utf8")).toBe(
      "before",
    );
    const evidenceRecords = (await fs.readFile(evidencePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(evidenceRecords).toHaveLength(2);
    expect(evidenceRecords[1].outcome).toBe("denied-before-effect");
  });
});
