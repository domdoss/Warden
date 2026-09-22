import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ToolContext } from "./tool-registry.js";

const execFileAsync = promisify(execFile);

export type AuthorizationOutcome = "allow" | "deny" | "approval_required";

export interface AuthorizationDecision {
  decision: AuthorizationOutcome;
  source: "policy_rule" | "policy_default" | "engine_guard";
  reason: string;
  version?: "anthesis.decision/v1";
  scenarioId?: string;
  policy?: string;
  canonicalization?: "rfc8785-json";
  engine?: { name: "anthesis-lab"; version: string };
  policyRuleId?: string;
  policyDigest?: string;
}

export interface FileWriteRequest {
  action: "file.write";
  target: string;
  absoluteTarget: string;
  contentDigest: string;
  attemptId: string;
  actor: { role: string };
  runtime: { id: string };
  requestBinding: {
    version: "anthesis.request-binding/v1";
    canonicalization: "rfc8785-json";
    algorithm: "sha256";
    request_digest: string;
    input_digest: string;
    plan_digest: string;
    source_digest: string;
    dependency_state_digest: string;
  };
}

export interface FileWriteRequestOptions {
  trialRoot: string;
  runtimeId: string;
  attemptId?: string;
  role?: string;
  plan?: unknown;
  source?: unknown;
  dependencyState?: unknown;
}

export interface FileWriteAuthorization {
  allowed: boolean;
  mode: "ungoverned" | "governed";
  request?: FileWriteRequest;
  decision?: AuthorizationDecision;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)]),
    );
  }
  return value;
}

export function sha256Digest(value: unknown): string {
  const canonical = JSON.stringify(canonicalValue(value));
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function normalizeTrialPath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error("target path must not be empty");
  }
  if (input.includes("\0")) throw new Error("target path contains NUL");
  if (input.includes("\\"))
    throw new Error("target path must use / separators");
  if (path.posix.isAbsolute(input))
    throw new Error("absolute target path is not allowed");

  const normalized = path.posix.normalize(input);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error("target path escapes outside trial root");
  }
  return normalized === "." ? "" : normalized;
}

export function buildFileWriteRequest(
  filePath: string,
  content: string,
  context: ToolContext,
  options: FileWriteRequestOptions,
): FileWriteRequest {
  const target = normalizeTrialPath(filePath);
  if (!target) throw new Error("target path must identify a file");

  const trialRoot = path.resolve(options.trialRoot);
  const absoluteTarget = path.resolve(trialRoot, target);
  if (
    absoluteTarget !== trialRoot &&
    !absoluteTarget.startsWith(`${trialRoot}${path.sep}`)
  ) {
    throw new Error("target path escapes outside trial root");
  }

  const actor = { role: options.role || "implementation" };
  const runtime = { id: options.runtimeId };
  const attemptId =
    options.attemptId ||
    process.env.ANTHESIS_TRIAL_ATTEMPT_ID ||
    "default-attempt";
  const contentDigest = sha256Digest(content);
  const caller = {
    userId: context.userId,
    chatJid: context.chatJid,
    groupFolder: context.groupFolder,
  };
  const effect = {
    action: "file.write",
    path: target,
    content_digest: contentDigest,
    actor,
    runtime,
  };

  const requestBinding = {
    version: "anthesis.request-binding/v1" as const,
    canonicalization: "rfc8785-json" as const,
    algorithm: "sha256" as const,
    input_digest: sha256Digest({ effect, caller, attemptId }),
    plan_digest: sha256Digest(options.plan ?? { action: "file.write", target }),
    source_digest: sha256Digest(options.source ?? { warden: "trial" }),
    dependency_state_digest: sha256Digest(
      options.dependencyState ?? { state: "unknown" },
    ),
  };
  const requestDigest = sha256Digest({
    action: "file.write",
    target,
    contentDigest,
    attemptId,
    actor,
    runtime,
    requestBinding,
  });

  return {
    action: "file.write",
    target,
    absoluteTarget,
    contentDigest,
    attemptId,
    actor,
    runtime,
    requestBinding: { ...requestBinding, request_digest: requestDigest },
  };
}

async function assertRealTargetIsInRoot(
  target: string,
  root: string,
): Promise<void> {
  const resolvedRoot = await fs.realpath(root);
  let cursor = target;
  const suffix: string[] = [];

  while (true) {
    try {
      const resolvedCursor = await fs.realpath(cursor);
      const resolvedTarget = path.resolve(resolvedCursor, ...suffix.reverse());
      if (
        resolvedTarget !== resolvedRoot &&
        !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
      ) {
        throw new Error("target path escapes outside trial root");
      }
      return;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new Error("target path cannot be resolved");
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

export function isExecutableDecision(decision: AuthorizationDecision): boolean {
  return decision.decision === "allow";
}

function engineDeny(reason: string): AuthorizationDecision {
  return { decision: "deny", source: "engine_guard", reason };
}

async function readDecision(
  request: FileWriteRequest,
): Promise<{ raw: Record<string, any>; requestDigestIsLocal: boolean }> {
  const labBinary = process.env.ANTHESIS_LAB_BIN;
  if (labBinary) {
    const repo = process.env.ANTHESIS_LAB_REPO;
    if (!repo) throw new Error("missing_lab_configuration");
    const scenario = await createTrialScenario(request, repo);
    try {
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(
          labBinary,
          [
            "evaluate",
            "--repo",
            repo,
            "--scenario",
            path.relative(repo, scenario.path),
            "--format",
            "json",
          ],
          { cwd: repo, maxBuffer: 1024 * 1024 },
        ));
      } catch (error: any) {
        if (typeof error?.stdout === "string" && error.stdout.trim()) {
          try {
            const parsed = JSON.parse(error.stdout.trim()) as Record<
              string,
              any
            >;
            return {
              raw:
                parsed.decision && typeof parsed.decision === "object"
                  ? parsed.decision
                  : parsed,
              requestDigestIsLocal: false,
            };
          } catch {
            // Fall through to the fail-closed evaluator error.
          }
        }
        throw new Error(
          `lab_evaluate_failed:${String(error?.stderr || error?.message || "unknown")}`,
        );
      }
      const parsed = JSON.parse(stdout.trim()) as Record<string, any>;
      return {
        raw:
          parsed.decision && typeof parsed.decision === "object"
            ? parsed.decision
            : parsed,
        requestDigestIsLocal: false,
      };
    } finally {
      await fs.rm(scenario.directory, { recursive: true, force: true });
    }
  }

  const decisionPath = process.env.ANTHESIS_TRIAL_DECISION_FILE;
  if (!decisionPath) throw new Error("missing_decision");
  return {
    raw: JSON.parse(await fs.readFile(decisionPath, "utf8")) as Record<
      string,
      any
    >,
    requestDigestIsLocal: true,
  };
}

async function createTrialScenario(
  request: FileWriteRequest,
  repo: string,
): Promise<{ path: string; directory: string }> {
  const scenarioDir = await fs.mkdtemp(
    path.join(path.resolve(repo), ".anthesis", ".warden-trial-"),
  );
  const scenarioPath = path.join(scenarioDir, "scenario.json");
  const { request_digest: _requestDigest, ...scenarioBinding } =
    request.requestBinding;
  const expectedDecision = process.env.ANTHESIS_TRIAL_EXPECTED_DECISION;
  const expectedSource = process.env.ANTHESIS_TRIAL_EXPECTED_SOURCE;
  const expectedRule = process.env.ANTHESIS_TRIAL_EXPECTED_RULE;
  const expectedReason = process.env.ANTHESIS_TRIAL_EXPECTED_REASON;
  if (
    !expectedDecision ||
    !expectedSource ||
    !expectedRule ||
    !expectedReason
  ) {
    throw new Error("missing_trial_expectation");
  }
  const scenario = {
    version: "anthesis.scenario/v1",
    id: process.env.ANTHESIS_TRIAL_SCENARIO_ID || "warden-file-write",
    title: "Warden governed file write",
    goal: "Authorize one exact Warden file.write effect.",
    policy: process.env.ANTHESIS_TRIAL_POLICY || "local-sdlc",
    source: { type: "local_scenario" },
    actor: request.actor,
    runtime: request.runtime,
    request_binding: scenarioBinding,
    attempts: [{ action: "file.write", path: request.target }],
    expected: {
      decision: expectedDecision,
      source: expectedSource,
      rule_id: expectedRule,
      reason: expectedReason,
      evidence: ["scenario_id", "decision", "decision_source"],
    },
  };
  await fs.writeFile(scenarioPath, JSON.stringify(scenario));
  return { path: scenarioPath, directory: scenarioDir };
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isValidDecision(raw: Record<string, any>): boolean {
  const binding = raw.request_binding;
  const effect = raw.effect;
  const source = raw.decision_source;
  const validSourceRules =
    (source === "policy_rule" && typeof raw.policy_rule_id === "string") ||
    (source === "policy_default" && raw.policy_rule_id === "default") ||
    (source === "engine_guard" &&
      raw.decision === "deny" &&
      raw.policy_rule_id === undefined);

  return Boolean(
    raw.version === "anthesis.decision/v1" &&
    typeof raw.scenario_id === "string" &&
    ["allow", "deny", "approval_required"].includes(raw.decision) &&
    ["policy_rule", "policy_default", "engine_guard"].includes(source) &&
    typeof raw.policy === "string" &&
    isDigest(raw.policy_digest) &&
    raw.canonicalization === "rfc8785-json" &&
    typeof raw.reason === "string" &&
    validSourceRules &&
    effect &&
    typeof effect.action === "string" &&
    effect.resource &&
    typeof effect.resource.path === "string" &&
    (effect.command === null || typeof effect.command === "string") &&
    typeof effect.actor?.role === "string" &&
    typeof effect.runtime?.id === "string" &&
    binding?.version === "anthesis.request-binding/v1" &&
    binding.canonicalization === "rfc8785-json" &&
    binding.algorithm === "sha256" &&
    isDigest(binding.request_digest) &&
    isDigest(binding.input_digest) &&
    isDigest(binding.plan_digest) &&
    isDigest(binding.source_digest) &&
    isDigest(binding.dependency_state_digest) &&
    raw.engine?.name === "anthesis-lab" &&
    typeof raw.engine.version === "string" &&
    raw.engine.version.length > 0,
  );
}

function matchesExactRequest(
  raw: Record<string, any>,
  request: FileWriteRequest,
  requestDigestIsLocal: boolean,
): boolean {
  const binding = raw.request_binding;
  const effect = raw.effect;
  return Boolean(
    binding &&
    Object.entries(request.requestBinding)
      .filter(([key]) => requestDigestIsLocal || key !== "request_digest")
      .every(([key, value]) => binding[key] === value) &&
    effect?.action === request.action &&
    effect?.resource?.path === request.target &&
    effect?.actor?.role === request.actor.role &&
    effect?.runtime?.id === request.runtime.id,
  );
}

export async function authorizeFileWrite(
  filePath: string,
  content: string,
  context: ToolContext,
  options: FileWriteRequestOptions,
): Promise<FileWriteAuthorization> {
  if (process.env.ANTHESIS_GOVERNED_WRITES !== "true") {
    return { allowed: true, mode: "ungoverned" };
  }
  if (!options.attemptId && !process.env.ANTHESIS_TRIAL_ATTEMPT_ID) {
    return {
      allowed: false,
      mode: "governed",
      decision: engineDeny("missing_attempt_id"),
    };
  }

  let request: FileWriteRequest;
  try {
    request = buildFileWriteRequest(filePath, content, context, options);
    await assertRealTargetIsInRoot(request.absoluteTarget, options.trialRoot);
  } catch {
    return {
      allowed: false,
      mode: "governed",
      decision: engineDeny("invalid_input"),
    };
  }

  try {
    const evaluation = await readDecision(request);
    const raw = evaluation.raw;
    if (!isValidDecision(raw)) {
      return {
        allowed: false,
        mode: "governed",
        request,
        decision: engineDeny("malformed_decision"),
      };
    }
    if (!matchesExactRequest(raw, request, evaluation.requestDigestIsLocal)) {
      return {
        allowed: false,
        mode: "governed",
        request,
        decision: engineDeny("request_binding_mismatch"),
      };
    }
    const decision: AuthorizationDecision = {
      decision: raw.decision,
      source: raw.decision_source,
      reason: raw.reason,
      version: raw.version,
      scenarioId: raw.scenario_id,
      policy: raw.policy,
      canonicalization: raw.canonicalization,
      engine: raw.engine,
      policyRuleId: raw.policy_rule_id,
      policyDigest: raw.policy_digest,
    };
    if (
      !["allow", "deny", "approval_required"].includes(decision.decision) ||
      !["policy_rule", "policy_default", "engine_guard"].includes(
        decision.source,
      ) ||
      typeof decision.reason !== "string" ||
      decision.version !== "anthesis.decision/v1" ||
      typeof decision.scenarioId !== "string" ||
      typeof decision.policy !== "string" ||
      decision.canonicalization !== "rfc8785-json" ||
      decision.engine?.name !== "anthesis-lab" ||
      typeof decision.engine.version !== "string"
    ) {
      return {
        allowed: false,
        mode: "governed",
        request,
        decision: engineDeny("malformed_decision"),
      };
    }
    return {
      allowed: isExecutableDecision(decision),
      mode: "governed",
      request,
      decision,
    };
  } catch {
    return {
      allowed: false,
      mode: "governed",
      request,
      decision: engineDeny("decision_unavailable"),
    };
  }
}
