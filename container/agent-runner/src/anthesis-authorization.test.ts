import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeFileWrite,
  buildFileWriteRequest,
  normalizeTrialPath,
  sha256Digest,
  type AuthorizationDecision,
} from "./anthesis-authorization.js";

describe("Anthesis trial authorization request binding", () => {
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
    vi.stubEnv("ANTHESIS_TRIAL_DECISION_FILE", decisionPath);

    const allowed = await authorizeFileWrite("allowed.txt", "one", context, {
      trialRoot: root,
      runtimeId: "warden-trial",
    });
    const changed = await authorizeFileWrite("other.txt", "one", context, {
      trialRoot: root,
      runtimeId: "warden-trial",
    });

    expect(allowed.allowed).toBe(true);
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
    vi.stubEnv("ANTHESIS_TRIAL_ROOT", root);
    vi.stubEnv("ANTHESIS_TRIAL_RUNTIME", "warden-agent-runner");
    vi.stubEnv("ANTHESIS_TRIAL_DECISION_FILE", decisionPath);

    await import("./tools/file-write.js");
    const { registry } = await import("./tool-registry.js");
    const allowed = await registry.dispatch(
      "Write",
      { file_path: "allowed.txt", content: "after" },
      context,
    );
    expect(allowed).toContain("File written:");
    expect(await fs.readFile(path.join(root, "allowed.txt"), "utf8")).toBe(
      "after",
    );

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
  });
});
