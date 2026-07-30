export type McpProfile = "core" | "full";

export interface CatalogOptions {
  profile: McpProfile;
  writesEnabled: boolean;
  defaultLimit: number;
  maxLimit: number;
  maxContext: number;
  defaultSloMs: number;
}

type JsonSchema = Record<string, unknown>;
type ToolDefinition = Record<string, unknown> & {
  name: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations: Record<string, unknown>;
};

const citationSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    path: { type: "string" },
    line: { type: "integer" },
    score: { type: "number" },
  },
  required: ["path", "line"],
};

const searchHitSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    path: { type: "string" },
    lineNumber: { type: "integer" },
    endLine: { type: "integer" },
    score: { type: "number" },
    title: { type: "string" },
    snippet: { type: "string" },
  },
  required: ["path", "lineNumber", "score"],
};

const documentSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    path: { type: "string" },
    title: { type: "string" },
    bodyPreview: { type: "string" },
    truncated: { type: "boolean" },
    frontmatter: { type: "object" },
  },
  required: ["path", "bodyPreview"],
};

const searchOutputSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    query: { type: "string" },
    mode: { type: "string" },
    hitCount: { type: "integer" },
    hits: { type: "array", items: searchHitSchema },
  },
  required: ["query", "hitCount", "hits"],
};

const recordOutputSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    query: { type: "string" },
    kind: { type: "string" },
    match: documentSchema,
  },
  required: ["query", "match"],
};

const groundedOutputSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    question: { type: "string" },
    answer: { type: "string" },
    abstained: { type: "boolean" },
    citations: { type: "array", items: citationSchema },
    confidence: { type: "object" },
    tokenUsage: { type: "object" },
    timings: { type: "object" },
    slo: { type: "object" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["question", "answer", "abstained", "citations"],
};

const answerCaptureOutputSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    question: { type: "string" },
    strategy: { type: "string" },
    answer: groundedOutputSchema,
    capture: { type: "object" },
    dryRun: { type: "boolean" },
    timings: { type: "object" },
    slo: { type: "object" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["question", "strategy", "answer", "capture", "dryRun"],
};

const mutationOutputSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    action: { type: "string" },
    path: { type: "string" },
    dryRun: { type: "boolean" },
  },
  required: ["action", "path", "dryRun"],
};

const decisionEvidenceInputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: { type: "string", minLength: 1 },
    line: { type: "integer", minimum: 1 },
  },
  required: ["path", "line"],
};

const decisionRecordSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
  properties: {
    decisionId: { type: "string" },
    workspaceId: { type: "string" },
    projectId: { type: "string" },
    title: { type: "string" },
    status: { type: "string", enum: ["proposed", "active", "superseded", "rejected"] },
    owner: { type: "string" },
    decidedAt: { type: "string" },
    evidenceCheckedAt: { type: "string" },
    reviewAfter: { type: "string" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reviewState: { type: "string", enum: ["current", "due", "overdue"] },
    path: { type: "string" },
    staleWarning: { type: "string" },
  },
  required: [
    "decisionId",
    "workspaceId",
    "title",
    "status",
    "owner",
    "decidedAt",
    "evidenceCheckedAt",
    "reviewAfter",
    "confidence",
    "reviewState",
    "path",
  ],
};

function getDecisionTool(): ToolDefinition {
  return {
    name: "kb.get_decision",
    title: "Get Decision",
    description:
      "Read one canonical decision by ID, path, or title, with an explicit warning when review is due or overdue.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1 },
        asOf: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        responseFormat: { type: "string", enum: ["compact", "full"] },
      },
      required: ["query"],
    },
    outputSchema: decisionRecordSchema,
  };
}

function listDecisionsTool(): ToolDefinition {
  return {
    name: "kb.list_decisions",
    title: "List Decisions",
    description:
      "List the canonical decision ledger with project, status, review-state, owner, and tag filters.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectId: { type: "string" },
        status: { type: "string", enum: ["proposed", "active", "superseded", "rejected"] },
        reviewState: { type: "string", enum: ["current", "due", "overdue"] },
        owner: { type: "string" },
        tag: { type: "string" },
        asOf: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        responseFormat: { type: "string", enum: ["compact", "full"] },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        decisionCount: { type: "integer" },
        decisions: { type: "array", items: decisionRecordSchema },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: ["decisionCount", "decisions", "warnings"],
    },
  };
}

function recordDecisionTool(): ToolDefinition {
  return {
    name: "kb.record_decision",
    title: "Record Decision",
    description:
      "Create a cited canonical decision under kb/decisions; validates local evidence and supports dry-run.",
    annotations: annotations.idempotentWrite,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        decisionId: { type: "string" },
        workspaceId: { type: "string" },
        projectId: { type: "string" },
        title: { type: "string", minLength: 2 },
        status: { type: "string", enum: ["proposed", "active"] },
        owner: { type: "string", minLength: 1 },
        decidedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        evidenceCheckedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        reviewAfter: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
        tags: { type: "array", items: { type: "string" } },
        question: { type: "string", minLength: 1 },
        recommendation: { type: "string", minLength: 1 },
        alternatives: { type: "array", items: { type: "string" } },
        rationale: { type: "string", minLength: 1 },
        assumptions: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        evidence: { type: "array", items: decisionEvidenceInputSchema },
        dryRun: { type: "boolean" },
        responseFormat: { type: "string", enum: ["compact", "full"] },
      },
      required: [
        "title",
        "owner",
        "decidedAt",
        "evidenceCheckedAt",
        "reviewAfter",
        "confidence",
        "question",
        "recommendation",
        "rationale",
      ],
    },
    outputSchema: {
      ...decisionRecordSchema,
      required: [...(decisionRecordSchema.required as string[]), "dryRun"],
    },
  };
}

function reviewDecisionTool(): ToolDefinition {
  return {
    name: "kb.review_decision",
    title: "Review Decision",
    description:
      "Append a classified evidence review without replacing the original evidence snapshot.",
    annotations: annotations.additiveWrite,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        decisionId: { type: "string", minLength: 1 },
        reviewedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        reviewAfter: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        reviewer: { type: "string", minLength: 1 },
        recommendationSupported: { type: "string", enum: ["yes", "no", "uncertain"] },
        assumptionsNeedingValidation: { type: "array", items: { type: "string" } },
        evidence: {
          type: "array",
          items: {
            ...decisionEvidenceInputSchema,
            properties: {
              ...(decisionEvidenceInputSchema.properties as Record<string, unknown>),
              classification: {
                type: "string",
                enum: ["unchanged", "strengthened", "weakened", "contradicted", "new"],
              },
              note: { type: "string" },
            },
          },
        },
        notes: { type: "string" },
        dryRun: { type: "boolean" },
        responseFormat: { type: "string", enum: ["compact", "full"] },
      },
      required: [
        "decisionId",
        "reviewedAt",
        "reviewAfter",
        "reviewer",
        "recommendationSupported",
        "evidence",
      ],
    },
    outputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        decisionId: { type: "string" },
        path: { type: "string" },
        reviewedAt: { type: "string" },
        reviewAfter: { type: "string" },
        recommendationSupported: {
          oneOf: [{ type: "boolean" }, { type: "string", enum: ["uncertain"] }],
        },
        assumptionsNeedingValidation: { type: "array", items: { type: "string" } },
        changes: { type: "array", items: { type: "object" } },
        dryRun: { type: "boolean" },
      },
      required: [
        "decisionId",
        "path",
        "reviewedAt",
        "reviewAfter",
        "recommendationSupported",
        "changes",
        "dryRun",
      ],
    },
  };
}

function supersedeDecisionTool(): ToolDefinition {
  return {
    name: "kb.supersede_decision",
    title: "Supersede Decision",
    description:
      "Preserve and link two canonical decisions while activating the replacement; supports dry-run.",
    annotations: annotations.idempotentWrite,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        decisionId: { type: "string", minLength: 1 },
        replacementId: { type: "string", minLength: 1 },
        supersededAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        reason: { type: "string", minLength: 1 },
        dryRun: { type: "boolean" },
        responseFormat: { type: "string", enum: ["compact", "full"] },
      },
      required: ["decisionId", "replacementId", "supersededAt", "reason"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        decisionId: { type: "string" },
        replacementId: { type: "string" },
        decisionPath: { type: "string" },
        replacementPath: { type: "string" },
        dryRun: { type: "boolean" },
      },
      required: ["decisionId", "replacementId", "decisionPath", "replacementPath", "dryRun"],
    },
  };
}

const annotations = {
  read: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  additiveWrite: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  idempotentWrite: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

function searchTool(options: CatalogOptions): ToolDefinition {
  return {
    name: "kb.search",
    title: "Search Grounded Knowledge",
    description:
      "Search the active local knowledge base and return ranked evidence with citations.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 2, description: "Search query" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: options.maxLimit,
          description: `Maximum hits; default ${options.defaultLimit}`,
        },
        context: { type: "integer", minimum: 0, maximum: options.maxContext },
        mode: { type: "string", enum: ["auto", "domain", "project", "generic"] },
        track: { type: "string" },
        module: { type: "string" },
        includeArchive: { type: "boolean" },
        backend: { type: "string", enum: ["bm25", "sqlite"] },
        responseFormat: { type: "string", enum: ["compact", "full"] },
        debug: { type: "boolean" },
        debugTopN: { type: "integer", minimum: 1, maximum: 25 },
      },
      required: ["query"],
    },
    outputSchema: searchOutputSchema,
  };
}

function getRecordTool(): ToolDefinition {
  return {
    name: "kb.get_record",
    title: "Get Knowledge Record",
    description: "Read one indexed Markdown record by path, title, slug, or filename.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 1 },
        kind: {
          type: "string",
          enum: ["any", "topic", "term", "module", "project", "decision", "source"],
        },
        maxChars: { type: "integer", minimum: 300, maximum: 50000 },
      },
      required: ["query"],
    },
    outputSchema: recordOutputSchema,
  };
}

function answerAndCaptureTool(options: CatalogOptions): ToolDefinition {
  return {
    name: "kb.answer_and_capture",
    title: "Answer From Grounded Knowledge",
    description: options.writesEnabled
      ? "Primary grounded Q&A tool. Call directly without pre-search; automatic retention is read-only, while explicit note/open-question strategies can retain user-requested knowledge."
      : "Primary grounded Q&A tool. Call directly without pre-search; automatic retention is read-only, and explicit retention is unavailable because writes are disabled.",
    annotations: options.writesEnabled ? annotations.additiveWrite : annotations.read,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        question: { type: "string", minLength: 3 },
        limit: { type: "integer", minimum: 3, maximum: options.maxLimit },
        mode: { type: "string", enum: ["auto", "domain", "project", "generic"] },
        track: { type: "string" },
        module: { type: "string" },
        projectId: { type: "string" },
        includeArchive: { type: "boolean" },
        strict: { type: "boolean" },
        sloMs: {
          type: "integer",
          minimum: 50,
          maximum: 120000,
          description: `Default ${options.defaultSloMs}`,
        },
        responseMode: { type: "string", enum: ["auto", "fast", "curate"] },
        backend: { type: "string", enum: ["bm25", "sqlite"] },
        responseFormat: { type: "string", enum: ["compact", "full"] },
        captureStrategy: {
          type: "string",
          enum: ["auto", "note", "open_question", "none"],
          description:
            "auto is read-only; use note or open_question only for explicit user-requested retention",
        },
        noteKind: { type: "string", enum: ["topic", "term"] },
        notePath: { type: "string" },
        noteTitle: { type: "string" },
        noteBody: { type: "string" },
        noteType: { type: "string", enum: ["concept", "howto", "project", "redirect"] },
        noteStatus: { type: "string", enum: ["draft", "canonical", "merged", "deprecated"] },
        noteTags: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
        noteOwner: { type: "string" },
        append: { type: "boolean" },
        conflictPolicy: { type: "string", enum: ["error", "append", "replace"] },
        dryRun: { type: "boolean" },
      },
      required: ["question"],
    },
    outputSchema: answerCaptureOutputSchema,
  };
}

function compatibilityGetter(name: "kb.get_topic" | "kb.get_term"): ToolDefinition {
  const isTopic = name === "kb.get_topic";
  const argument = isTopic ? "topic" : "term";
  return {
    name,
    title: isTopic ? "Get Topic (Compatibility)" : "Get Term (Compatibility)",
    description: `Compatibility alias for kb.get_record constrained to ${isTopic ? "topics" : "terms"}.`,
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        [argument]: { type: "string", minLength: 1 },
        maxChars: {
          type: "integer",
          minimum: isTopic ? 500 : 300,
          maximum: isTopic ? 50000 : 30000,
        },
      },
      required: [argument],
    },
    outputSchema: recordOutputSchema,
  };
}

function resumeProjectTool(): ToolDefinition {
  return {
    name: "kb.resume_project",
    title: "Resume Project Context",
    description:
      "Return an action-first cited resume for one project: what changed, blockers, decisions, and what to do next.",
    annotations: annotations.read,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        projectId: { type: "string", minLength: 1 },
      },
      required: ["projectId"],
    },
    outputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        status: { type: "string" },
        startHereBrief: { type: "string" },
        currentFocus: { type: "string" },
        recentChanges: { type: "string" },
        recommendedNextAction: { type: "string" },
        activeDecisions: { type: "array", items: { type: "string" } },
        blockers: { type: "array", items: { type: "string" } },
        openQuestions: { type: "array", items: { type: "string" } },
        blockersAndQuestions: { type: "array", items: { type: "string" } },
        completedSinceCheckpoint: { type: "array", items: { type: "string" } },
        latestCheckpointAt: { type: "string" },
        nextThreeActions: { type: "array", items: { type: "string" } },
        keyDocuments: { type: "array", items: { type: "string" } },
        citations: { type: "array", items: citationSchema },
      },
      required: [
        "projectId",
        "title",
        "status",
        "startHereBrief",
        "currentFocus",
        "recentChanges",
        "recommendedNextAction",
        "activeDecisions",
        "blockers",
        "openQuestions",
        "blockersAndQuestions",
        "completedSinceCheckpoint",
        "latestCheckpointAt",
        "nextThreeActions",
        "keyDocuments",
        "citations",
      ],
    },
  };
}

function fullTools(options: CatalogOptions): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    getDecisionTool(),
    listDecisionsTool(),
    compatibilityGetter("kb.get_topic"),
    compatibilityGetter("kb.get_term"),
    {
      name: "kb.list_modules",
      title: "List Knowledge Modules",
      description: "List indexed knowledge modules and topic counts.",
      annotations: annotations.read,
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      outputSchema: {
        type: "object",
        additionalProperties: true,
        properties: {
          moduleCount: { type: "integer" },
          modules: { type: "array", items: { type: "object" } },
        },
        required: ["moduleCount", "modules"],
      },
    },
    {
      name: "kb.answer_grounded",
      title: "Answer Grounded (Advanced)",
      description: "Advanced read-only grounded answer tool; normally use kb.answer_and_capture.",
      annotations: annotations.read,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string", minLength: 3 },
          limit: { type: "integer", minimum: 3, maximum: options.maxLimit },
          mode: { type: "string", enum: ["auto", "domain", "project", "generic"] },
          track: { type: "string" },
          module: { type: "string" },
          includeArchive: { type: "boolean" },
          strict: { type: "boolean" },
          sloMs: { type: "integer", minimum: 50, maximum: 120000 },
          responseMode: { type: "string", enum: ["auto", "fast", "curate"] },
          backend: { type: "string", enum: ["bm25", "sqlite"] },
          responseFormat: { type: "string", enum: ["compact", "full"] },
          debug: { type: "boolean" },
          debugTopN: { type: "integer", minimum: 1, maximum: 25 },
          allowDirect: { type: "boolean" },
        },
        required: ["question"],
      },
      outputSchema: groundedOutputSchema,
    },
    {
      name: "kb.refresh",
      title: "Refresh Knowledge Index",
      description: "Rebuild in-memory retrieval state from canonical files.",
      annotations: annotations.idempotentWrite,
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      outputSchema: {
        type: "object",
        additionalProperties: true,
        properties: { refreshed: { type: "boolean" }, stats: { type: "object" } },
        required: ["refreshed", "stats"],
      },
    },
  ];

  if (options.writesEnabled) {
    tools.push(
      recordDecisionTool(),
      reviewDecisionTool(),
      supersedeDecisionTool(),
      {
        name: "kb.upsert_note",
        title: "Upsert Knowledge Note",
        description: "Advanced write tool for creating or updating topic and term notes.",
        annotations: annotations.idempotentWrite,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: { type: "string", enum: ["topic", "term"] },
            title: { type: "string", minLength: 2 },
            body: { type: "string", minLength: 1 },
            path: { type: "string" },
            module: { type: "string" },
            track: { type: "string" },
            projectId: { type: "string" },
            type: { type: "string", enum: ["concept", "howto", "project", "redirect"] },
            status: { type: "string", enum: ["draft", "canonical", "merged", "deprecated"] },
            tags: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
            owner: { type: "string" },
            updated: { type: "string" },
            append: { type: "boolean" },
            conflictPolicy: { type: "string", enum: ["error", "append", "replace"] },
            baseContentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
            sourceOperation: { type: "string", enum: ["answer", "ingest", "upsert"] },
            dryRun: { type: "boolean" },
          },
          required: ["kind", "title", "body"],
        },
        outputSchema: mutationOutputSchema,
      },
      {
        name: "kb.add_open_question",
        title: "Add Open Question",
        description: "Advanced write tool for appending an unresolved or resolved question.",
        annotations: annotations.additiveWrite,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string", minLength: 3 },
            whyOpen: { type: "string", minLength: 3 },
            whatWouldResolve: { type: "string", minLength: 3 },
            status: { type: "string", enum: ["open", "resolved"] },
            resolvedBy: { type: "string" },
            relatedPath: { type: "string" },
            owner: { type: "string" },
            source: { type: "string" },
            dryRun: { type: "boolean" },
          },
          required: ["question", "whyOpen", "whatWouldResolve"],
        },
        outputSchema: mutationOutputSchema,
      },
    );
  }

  return tools;
}

export function normalizeMcpProfile(value: unknown): McpProfile {
  return `${value || ""}`.trim().toLowerCase() === "full" ? "full" : "core";
}

export function buildToolCatalog(options: CatalogOptions): ToolDefinition[] {
  const core = [
    searchTool(options),
    getRecordTool(),
    answerAndCaptureTool(options),
    resumeProjectTool(),
  ];
  return options.profile === "full" ? [...core, ...fullTools(options)] : core;
}

export const CATALOG_BUDGETS = {
  core: { maxTools: 4, maxCharacters: 7000 },
  full: { maxTools: 16, maxCharacters: 22000 },
} as const;
