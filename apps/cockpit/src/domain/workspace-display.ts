/**
 * Pure display rules for the active workspace identity and its write policy.
 *
 * This module is browser-safe and free of React, fetch, and Node APIs: it only
 * validates the safe four-field projection returned by the local development
 * endpoint and turns it into the exact text the Cockpit shell renders.
 */

export type WorkspaceSensitivity = "personal" | "internal" | "sensitive" | "restricted";

/** The only workspace fields that ever cross the local endpoint boundary. */
export interface SafeWorkspaceIdentity {
  readonly id: string;
  readonly label: string;
  readonly readOnly: boolean;
  readonly sensitivity: WorkspaceSensitivity;
}

export type WorkspaceContextState =
  | { status: "loading" }
  | { status: "ready"; workspace: SafeWorkspaceIdentity }
  | { status: "error" }
  | { status: "demo" };

export type WorkspaceTone =
  | "neutral"
  | "writable"
  | "read-only"
  | "sensitive"
  | "restricted"
  | "demo"
  | "error";

export interface WorkspaceDisplay {
  readonly status: WorkspaceContextState["status"];
  readonly tone: WorkspaceTone;
  /** Prominent human label, or a safe stand-in while loading or after failure. */
  readonly label: string;
  /** Exactly one policy sentence fragment, never color-only meaning. */
  readonly policyText: string;
  /** Empty for the default `personal` sensitivity. */
  readonly sensitivityText: string;
  /** `policyText` plus sensitivity, already joined for a single-line render. */
  readonly detailText: string;
  /** Stable workspace ID; empty when unknown or not applicable. */
  readonly workspaceId: string;
  /** True only after a local workspace explicitly reports that writes are enabled. */
  readonly canWrite: boolean;
  /** `label · detailText`, used as the tooltip and compact summary. */
  readonly summary: string;
  /** Full sentence form for `aria-label` and collapsed navigation. */
  readonly accessibleLabel: string;
}

export const WORKSPACE_SENSITIVITIES: readonly WorkspaceSensitivity[] = [
  "personal",
  "internal",
  "sensitive",
  "restricted",
];

/** The sensitivity that is implied and therefore not worth extra shell text. */
export const DEFAULT_WORKSPACE_SENSITIVITY: WorkspaceSensitivity = "personal";

export const MAX_WORKSPACE_FIELD_LENGTH = 120;

const FORBIDDEN_WORKSPACE_FIELD_MARKER =
  /\b(?:repoRoot|realRepoRoot|scanRoots|realScanRoots|writeRoots|realWriteRoots)\b/;
const ABSOLUTE_PATH_FRAGMENT = /(?:^|[\s([{"'=,:;])(?:~(?:[\\/]|$)|[\\/]|[A-Za-z]:[\\/])/;

const SENSITIVITY_TEXT: Record<WorkspaceSensitivity, string> = {
  personal: "",
  internal: "Internal",
  sensitive: "Sensitive",
  restricted: "Restricted",
};

const LOADING_LABEL = "Local workspace";
const LOADING_POLICY = "Checking workspace policy";
const ERROR_LABEL = "Workspace unavailable";
const ERROR_POLICY = "Verify local configuration";
const DEMO_LABEL = "Demo workspace";
const DEMO_POLICY = "Read-only preview";
const READ_ONLY_POLICY = "Read-only";
const WRITABLE_POLICY = "Local writes enabled";

/**
 * Validates an untrusted `workspace` payload field. Returns null rather than
 * throwing so the caller can fall back to the safe unavailable state, and
 * rejects anything path-shaped so a misconfigured workspace can never render a
 * host path in the shell.
 */
export function parseSafeWorkspace(value: unknown): SafeWorkspaceIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;

  const id = boundedText(candidate.id);
  const label = boundedText(candidate.label);
  if (!id || !label) return null;
  if (typeof candidate.readOnly !== "boolean") return null;
  if (!isWorkspaceSensitivity(candidate.sensitivity)) return null;

  return { id, label, readOnly: candidate.readOnly, sensitivity: candidate.sensitivity };
}

export function isWorkspaceSensitivity(value: unknown): value is WorkspaceSensitivity {
  return (
    typeof value === "string" &&
    (WORKSPACE_SENSITIVITIES as readonly string[]).includes(value as WorkspaceSensitivity)
  );
}

export function describeWorkspaceDisplay(state: WorkspaceContextState): WorkspaceDisplay {
  if (state.status === "ready") {
    const { workspace } = state;
    return compose({
      status: "ready",
      tone: toneFor(workspace),
      label: workspace.label,
      policyText: workspace.readOnly ? READ_ONLY_POLICY : WRITABLE_POLICY,
      sensitivityText: SENSITIVITY_TEXT[workspace.sensitivity],
      workspaceId: workspace.id,
      canWrite: !workspace.readOnly,
    });
  }
  if (state.status === "demo") {
    return compose({ status: "demo", tone: "demo", label: DEMO_LABEL, policyText: DEMO_POLICY });
  }
  if (state.status === "error") {
    return compose({
      status: "error",
      tone: "error",
      label: ERROR_LABEL,
      policyText: ERROR_POLICY,
    });
  }
  return compose({
    status: "loading",
    tone: "neutral",
    label: LOADING_LABEL,
    policyText: LOADING_POLICY,
  });
}

function toneFor(workspace: SafeWorkspaceIdentity): WorkspaceTone {
  if (workspace.sensitivity === "restricted") return "restricted";
  if (workspace.sensitivity === "sensitive") return "sensitive";
  return workspace.readOnly ? "read-only" : "writable";
}

function compose(parts: {
  status: WorkspaceContextState["status"];
  tone: WorkspaceTone;
  label: string;
  policyText: string;
  sensitivityText?: string;
  workspaceId?: string;
  canWrite?: boolean;
}): WorkspaceDisplay {
  const sensitivityText = parts.sensitivityText || "";
  const workspaceId = parts.workspaceId || "";
  const detailText = [parts.policyText, sensitivityText].filter(Boolean).join(" · ");
  const sentences = [`Workspace: ${parts.label}`, parts.policyText];
  if (sensitivityText) sentences.push(`Sensitivity: ${sensitivityText}`);
  if (workspaceId) sentences.push(`Workspace ID: ${workspaceId}`);

  return {
    status: parts.status,
    tone: parts.tone,
    label: parts.label,
    policyText: parts.policyText,
    sensitivityText,
    detailText,
    workspaceId,
    canWrite: Boolean(parts.canWrite),
    summary: `${parts.label} · ${detailText}`,
    accessibleLabel: `${sentences.join(". ")}.`,
  };
}

function boundedText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!isSafeWorkspaceText(trimmed)) return "";
  return trimmed;
}

/**
 * Workspace identity is configuration text, never host metadata. Reject
 * absolute-path fragments and internal context field names wherever they occur,
 * not just at the beginning of a value: labels such as `Client — /Users/...`
 * must never cross the development endpoint or reach the shell.
 */
export function isSafeWorkspaceText(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > MAX_WORKSPACE_FIELD_LENGTH) {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return !FORBIDDEN_WORKSPACE_FIELD_MARKER.test(value) && !ABSOLUTE_PATH_FRAGMENT.test(value);
}
