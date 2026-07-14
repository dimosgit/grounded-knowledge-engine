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
    title: options.writesEnabled ? "Answer and Capture Learning" : "Answer From Grounded Knowledge",
    description: options.writesEnabled
      ? "Answer from local evidence and capture useful learning or an open question."
      : "Answer from local evidence. Automatic capture is skipped because writes are disabled.",
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
        captureStrategy: { type: "string", enum: ["auto", "note", "open_question", "none"] },
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
    description: "Return a compact cited capsule for one explicitly identified project.",
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
        startHereBrief: { type: "string" },
        currentFocus: { type: "string" },
        recentChanges: { type: "string" },
        activeDecisions: { type: "array", items: { type: "string" } },
        blockersAndQuestions: { type: "array", items: { type: "string" } },
        nextThreeActions: { type: "array", items: { type: "string" } },
        keyDocuments: { type: "array", items: { type: "string" } },
        citations: { type: "array", items: citationSchema },
      },
      required: [
        "projectId",
        "title",
        "startHereBrief",
        "currentFocus",
        "recentChanges",
        "activeDecisions",
        "blockersAndQuestions",
        "nextThreeActions",
        "keyDocuments",
        "citations",
      ],
    },
  };
}

function fullTools(options: CatalogOptions): ToolDefinition[] {
  const tools: ToolDefinition[] = [
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
  full: { maxTools: 11, maxCharacters: 13500 },
} as const;
