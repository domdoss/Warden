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
  const contentDigest = sha256Digest(content);
  const effect = {
    action: "file.write",
    path: target,
    content_digest: contentDigest,
    actor,
    runtime,
  };

  // Context identity is deliberately not treated as authorization. It is
  // retained only as stable input to the trial binding until Warden exposes a
  // stronger trusted specialist identity.
  void context;

  const requestBinding = {
    version: "anthesis.request-binding/v1" as const,
    canonicalization: "rfc8785-json" as const,
    algorithm: "sha256" as const,
    input_digest: sha256Digest(effect),
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
    actor,
    runtime,
    requestBinding,
  });

  return {
    action: "file.write",
    target,
    absoluteTarget,
    contentDigest,
    actor,
    runtime,
    requestBinding: { ...requestBinding, request_digest: requestDigest },
  };
}

export function isExecutableDecision(decision: AuthorizationDecision): boolean {
  return decision.decision === "allow";
}

function engineDeny(reason: string): AuthorizationDecision {
  return { decision: "deny", source: "engine_guard", reason };
}

async function readDecision(): Promise<Record<string, any>> {
  const labBinary = process.env.ANTHESIS_LAB_BIN;
  if (labBinary) {
    const scenario = process.env.ANTHESIS_TRIAL_SCENARIO_FILE;
    const repo = process.env.ANTHESIS_LAB_REPO;
    if (!scenario || !repo) throw new Error("missing_lab_configuration");
    const { stdout } = await execFileAsync(
      labBinary,
      ["evaluate", "--repo", repo, "--scenario", scenario, "--format", "json"],
      { cwd: repo, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim()) as Record<string, any>;
    return parsed.decision && typeof parsed.decision === "object"
      ? parsed.decision
      : parsed;
  }

  const decisionPath = process.env.ANTHESIS_TRIAL_DECISION_FILE;
  if (!decisionPath) throw new Error("missing_decision");
  return JSON.parse(await fs.readFile(decisionPath, "utf8")) as Record<
    string,
    any
  >;
}

function matchesExactRequest(
  raw: Record<string, any>,
  request: FileWriteRequest,
): boolean {
  const binding = raw.request_binding;
  const effect = raw.effect;
  return Boolean(
    binding &&
    Object.entries(request.requestBinding).every(
      ([key, value]) => binding[key] === value,
    ) &&
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

  let request: FileWriteRequest;
  try {
    request = buildFileWriteRequest(filePath, content, context, options);
  } catch {
    return {
      allowed: false,
      mode: "governed",
      decision: engineDeny("invalid_input"),
    };
  }

  try {
    const raw = await readDecision();
    if (!matchesExactRequest(raw, request)) {
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
