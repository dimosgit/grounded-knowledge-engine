import { useMemo, useState } from "react";
import {
  AlertTriangle,
  FileClock,
  FileText,
  ListTodo,
  Minus,
  Move,
  Network,
  Plus,
  RotateCcw,
  Scale,
} from "lucide-react";
import type {
  ProjectContextFilter,
  ProjectContextGroupKey,
  ProjectContextItem,
  ProjectContextMap as ProjectContextMapModel,
} from "../domain/project-context-map";
import { useGraphInteractions } from "../hooks/useGraphInteractions";

/** World size in px. Node coordinates are percentages of this canvas. */
const CONTEXT_MAP_CANVAS = { width: 1280, height: 820 };

const GROUPS: Array<{
  key: ProjectContextGroupKey;
  label: string;
  angle: number;
  icon: typeof ListTodo;
  nodeTone: string;
  edgeColor: string;
}> = [
  {
    key: "work",
    label: "Work",
    angle: -144,
    icon: ListTodo,
    nodeTone: "border-primary/70 bg-surface-container text-primary",
    edgeColor: "rgb(93 135 255)",
  },
  {
    key: "decisions",
    label: "Decisions",
    angle: -55,
    icon: Scale,
    nodeTone: "border-status-waiting/70 bg-surface-container text-status-waiting",
    edgeColor: "rgb(244 190 76)",
  },
  {
    key: "history",
    label: "History",
    angle: 0,
    icon: FileClock,
    nodeTone: "border-track-ai/70 bg-surface-container text-track-ai",
    edgeColor: "rgb(154 125 255)",
  },
  {
    key: "evidence",
    label: "Evidence",
    angle: 58,
    icon: FileText,
    nodeTone: "border-status-done/70 bg-surface-container text-status-done",
    edgeColor: "rgb(73 190 137)",
  },
  {
    key: "attention",
    label: "Attention",
    angle: 137,
    icon: AlertTriangle,
    nodeTone: "border-status-blocked/70 bg-surface-container text-status-blocked",
    edgeColor: "rgb(255 112 112)",
  },
];

const GROUP_BY_KEY = new Map(GROUPS.map((group) => [group.key, group]));
const ALL_GROUP_ITEM_LIMIT = 2;
const FOCUSED_GROUP_ITEM_LIMIT = 12;

interface ProjectContextMapProps {
  activeProject?: {
    id?: string;
    title?: string;
    currentFocus?: string;
    statusBucket?: string;
    trackLabel?: string;
  } | null;
  contextMap: ProjectContextMapModel;
  onOpenDoc: (path: string) => void;
  onOpenDecision: (decisionId: string) => void;
  onOpenDeliveryChecklist: (projectId: string) => void;
  embedded?: boolean;
}

interface VisualNode {
  id: string;
  kind: "project" | "group" | "item" | "more";
  label: string;
  meta: string;
  detail?: string;
  group?: ProjectContextGroupKey;
  x: number;
  y: number;
  item?: ProjectContextItem;
}

interface VisualEdge {
  id: string;
  from: string;
  to: string;
  group: ProjectContextGroupKey;
  strong: boolean;
}

export function ProjectContextMap({
  activeProject,
  contextMap,
  onOpenDoc,
  onOpenDecision,
  onOpenDeliveryChecklist,
  embedded = false,
}: ProjectContextMapProps) {
  const [filter, setFilter] = useState<ProjectContextFilter>("all");
  const visualGraph = useMemo(
    () => buildVisualGraph(contextMap, activeProject?.title || contextMap.projectId, filter),
    [activeProject?.title, contextMap, filter],
  );
  const {
    graphScale,
    graphPan,
    graphNodePositions,
    graphDragState,
    zoomGraph,
    resetGraphLayout,
    attachGraphViewport,
    startGraphPan,
    startGraphNodeDrag,
    moveGraphPointer,
    endGraphPointer,
    runNodeClick,
  } = useGraphInteractions(`${contextMap.projectId}:${filter}`);
  const nodes = visualGraph.nodes.map((node) => ({
    ...node,
    ...(graphNodePositions[node.id] || {}),
  }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  function openItem(item?: ProjectContextItem) {
    if (!item) return;
    if (item.destination === "delivery-checklist") {
      onOpenDeliveryChecklist(contextMap.projectId);
      return;
    }
    if (item.decisionId) {
      onOpenDecision(item.decisionId);
      return;
    }
    if (item.path) onOpenDoc(item.path);
  }

  function activateNode(node: VisualNode) {
    if (node.kind === "project") {
      if (contextMap.sourcePath) onOpenDoc(contextMap.sourcePath);
      return;
    }
    if (node.kind === "group" || node.kind === "more") {
      setFilter((current) => (current === node.group ? "all" : node.group || "all"));
      return;
    }
    openItem(node.item);
  }

  return (
    <section
      aria-labelledby="project-context-map-heading"
      className={
        embedded
          ? "bg-surface-main"
          : "overflow-hidden rounded-xl border border-border-subtle bg-surface-container-low"
      }
    >
      <header className="flex flex-col gap-4 border-b border-border-subtle px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/50 bg-primary/10 text-primary">
            <Network size={19} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="text-label-caps font-semibold uppercase text-primary">
              Visual context
            </div>
            <h2
              id="project-context-map-heading"
              className="truncate font-display text-headline-sm text-on-surface"
            >
              {activeProject?.title || contextMap.projectId}
            </h2>
          </div>
          <span className="shrink-0 rounded-full border border-border-subtle bg-surface-container px-2.5 py-1 font-mono text-code-sm text-on-surface-variant">
            {contextMap.totalItems} nodes
          </span>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Filter visual context graph">
          <button
            type="button"
            className={`rounded-full border px-3 py-1.5 text-metadata font-semibold transition ${
              filter === "all"
                ? "border-on-surface bg-on-surface text-surface-main"
                : "border-border-subtle bg-surface-container text-on-surface-variant hover:border-on-surface"
            }`}
            aria-pressed={filter === "all"}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          {GROUPS.map((definition) => {
            const count =
              contextMap.groups.find((group) => group.key === definition.key)?.items.length || 0;
            return (
              <button
                key={definition.key}
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-metadata font-semibold transition ${
                  filter === definition.key
                    ? definition.nodeTone
                    : "border-border-subtle bg-surface-container text-on-surface-variant hover:border-on-surface"
                }`}
                aria-pressed={filter === definition.key}
                onClick={() => setFilter(definition.key)}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: definition.edgeColor }}
                  aria-hidden="true"
                />
                {definition.label} {count}
              </button>
            );
          })}
        </div>
      </header>

      <div
        ref={attachGraphViewport}
        className={`relative h-[calc(100vh-19rem)] min-h-[520px] touch-none overflow-hidden ${graphDragState?.type === "pan" ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={startGraphPan}
        onPointerMove={moveGraphPointer}
        onPointerUp={endGraphPointer}
        onPointerCancel={endGraphPointer}
        onPointerLeave={endGraphPointer}
        data-project-context-viewport
      >
        <div
          className="absolute left-4 top-4 z-30 flex items-center gap-2 rounded border border-border-subtle bg-surface-container/90 p-2 shadow-sm shadow-black/20 backdrop-blur"
          data-graph-controls
        >
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded border border-outline-variant text-on-surface hover:border-primary hover:text-primary"
            onClick={() => zoomGraph(0.15)}
            aria-label="Zoom in project context"
          >
            <Plus size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded border border-outline-variant text-on-surface hover:border-primary hover:text-primary"
            onClick={() => zoomGraph(-0.15)}
            aria-label="Zoom out project context"
          >
            <Minus size={15} aria-hidden="true" />
          </button>
          <span className="flex h-8 items-center gap-1.5 rounded bg-surface-container-low px-2.5 font-mono text-code-sm text-on-surface-variant">
            <Move size={14} aria-hidden="true" />
            {Math.round(graphScale * 100)}%
          </span>
          <button
            type="button"
            className="flex h-8 items-center gap-1.5 rounded border border-outline-variant px-2.5 text-label-caps font-semibold uppercase text-on-surface hover:border-primary hover:text-primary"
            onClick={resetGraphLayout}
            aria-label="Reset project context layout"
          >
            <RotateCcw size={14} aria-hidden="true" />
            Reset
          </button>
        </div>

        <div className="pointer-events-none absolute bottom-4 left-4 z-30 font-mono text-code-sm text-on-surface-variant">
          ⌘ / ctrl + scroll to zoom · scroll or drag to pan
        </div>

        <div
          className="absolute left-0 top-0"
          style={{
            width: `${CONTEXT_MAP_CANVAS.width}px`,
            height: `${CONTEXT_MAP_CANVAS.height}px`,
            transform: `translate(${graphPan.x}px, ${graphPan.y}px) scale(${graphScale})`,
            transformOrigin: "0 0",
            transition: graphDragState ? "none" : "transform 160ms ease",
          }}
          data-project-context-world
          data-graph-world
        >
          <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
            {visualGraph.edges.map((edge) => {
              const from = nodeById.get(edge.from);
              const to = nodeById.get(edge.to);
              const definition = GROUP_BY_KEY.get(edge.group);
              if (!from || !to || !definition) return null;
              return (
                <line
                  key={edge.id}
                  x1={`${from.x}%`}
                  y1={`${from.y}%`}
                  x2={`${to.x}%`}
                  y2={`${to.y}%`}
                  stroke={definition.edgeColor}
                  strokeOpacity={edge.strong ? 0.78 : 0.42}
                  strokeWidth={edge.strong ? 3 : 1.5}
                />
              );
            })}
          </svg>

          {nodes.map((node) => (
            <VisualContextNode
              key={node.id}
              node={node}
              activeProject={activeProject}
              isDragging={graphDragState?.type === "node" && graphDragState.nodeId === node.id}
              onPointerDown={startGraphNodeDrag}
              onActivate={() => runNodeClick(() => activateNode(node))}
            />
          ))}
        </div>

        <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border-subtle bg-surface-container/85 px-4 py-2 text-metadata text-on-surface-variant backdrop-blur">
          Drag nodes or canvas · select a colored cluster to isolate it
        </div>
      </div>
    </section>
  );
}

function VisualContextNode({ node, activeProject, isDragging, onPointerDown, onActivate }) {
  const definition = node.group ? GROUP_BY_KEY.get(node.group) : null;
  const Icon = definition?.icon || Network;
  const tone =
    definition?.nodeTone || "border-primary bg-primary-container text-on-primary-container";
  const fullTitle = node.kind === "project" ? activeProject?.title || node.label : node.label;
  const tooltipPosition = node.y < 22 ? "top-full mt-2" : "bottom-full mb-2";

  return (
    <button
      type="button"
      className={`group absolute -translate-x-1/2 -translate-y-1/2 border text-left shadow-md shadow-black/20 transition hover:z-20 hover:scale-105 focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
        node.kind === "project"
          ? "w-[230px] rounded-2xl border-primary bg-primary-container px-5 py-4 text-on-primary-container"
          : node.kind === "group"
            ? `w-[132px] rounded-full px-4 py-3 ${tone}`
            : node.kind === "more"
              ? `w-[92px] rounded-full border-dashed px-3 py-3 text-center ${tone}`
              : `w-[178px] rounded-lg bg-surface-container px-3.5 py-3 text-on-surface ${tone}`
      } ${isDragging ? "cursor-grabbing" : "cursor-move"}`}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
      onPointerDown={(event) => onPointerDown(event, node)}
      onClick={onActivate}
      aria-label={
        node.kind === "item"
          ? `Open ${node.label}`
          : node.kind === "project"
            ? `Open ${node.label} record`
            : `Show ${node.label} cluster`
      }
      title={fullTitle}
      data-graph-node
      data-node-id={node.id}
    >
      {node.kind === "project" ? (
        <>
          <div className="flex items-center gap-2 font-mono text-code-sm uppercase opacity-80">
            <Network size={15} aria-hidden="true" />
            Project
          </div>
          <div className="mt-1 line-clamp-2 font-display text-body-lg font-semibold">
            {activeProject?.title || node.label}
          </div>
          <div className="mt-2 line-clamp-2 text-metadata opacity-80">
            {activeProject?.currentFocus || node.meta}
          </div>
        </>
      ) : (
        <>
          <div
            className={`flex items-center gap-2 ${node.kind === "more" ? "justify-center" : ""}`}
          >
            <Icon size={15} className="shrink-0" aria-hidden="true" />
            <span className="line-clamp-2 text-body-md font-semibold">{node.label}</span>
          </div>
          {node.meta ? (
            <div
              className={`mt-1.5 line-clamp-1 font-mono text-code-sm opacity-70 ${node.kind === "more" ? "text-center" : ""}`}
            >
              {node.meta}
            </div>
          ) : null}
        </>
      )}
      {node.kind !== "more" ? (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-[360px] -translate-x-1/2 rounded-lg border border-outline-variant bg-surface-container-high px-3 py-2 text-center text-body-md font-medium leading-snug text-on-surface opacity-0 shadow-xl shadow-black/35 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 ${tooltipPosition}`}
          data-node-tooltip
        >
          {fullTitle}
        </span>
      ) : null}
    </button>
  );
}

function buildVisualGraph(
  contextMap: ProjectContextMapModel,
  projectTitle: string,
  filter: ProjectContextFilter,
): { nodes: VisualNode[]; edges: VisualEdge[] } {
  const nodes: VisualNode[] = [
    {
      id: "project-root",
      kind: "project",
      label: projectTitle,
      meta: "Selected project",
      x: 50,
      y: 50,
    },
  ];
  const edges: VisualEdge[] = [];
  const visibleDefinitions =
    filter === "all" ? GROUPS : GROUPS.filter((group) => group.key === filter);

  for (const definition of visibleDefinitions) {
    const group = contextMap.groups.find((candidate) => candidate.key === definition.key);
    const items = group?.items || [];
    const angle = degreesToRadians(definition.angle);
    const groupX = 50 + Math.cos(angle) * 22;
    const groupY = 50 + Math.sin(angle) * 25;
    const groupNodeId = `group:${definition.key}`;
    nodes.push({
      id: groupNodeId,
      kind: "group",
      label: definition.label,
      meta: `${items.length} nodes`,
      group: definition.key,
      x: groupX,
      y: groupY,
    });
    edges.push({
      id: `project-root:${groupNodeId}`,
      from: "project-root",
      to: groupNodeId,
      group: definition.key,
      strong: true,
    });

    const itemLimit = filter === "all" ? ALL_GROUP_ITEM_LIMIT : FOCUSED_GROUP_ITEM_LIMIT;
    const visibleItems = items.slice(0, itemLimit);
    const remaining = items.length - visibleItems.length;
    const outerNodes = [
      ...visibleItems.map((item) => ({ kind: "item" as const, item })),
      ...(remaining > 0 ? [{ kind: "more" as const, remaining }] : []),
    ];
    const spread = 20 * Math.max(outerNodes.length - 1, 1);

    outerNodes.forEach((outerNode, index) => {
      const offset =
        outerNodes.length === 1
          ? 0
          : filter === "all"
            ? -spread / 2 + (spread * index) / (outerNodes.length - 1)
            : -150 + (300 * index) / (outerNodes.length - 1);
      const itemAngle = degreesToRadians(definition.angle + offset);
      const x = 50 + Math.cos(itemAngle) * 43;
      const y = 50 + Math.sin(itemAngle) * 40;
      const nodeId =
        outerNode.kind === "item"
          ? `item:${definition.key}:${outerNode.item.id}`
          : `more:${definition.key}`;
      nodes.push({
        id: nodeId,
        kind: outerNode.kind,
        label: outerNode.kind === "item" ? outerNode.item.label : `+${outerNode.remaining}`,
        meta:
          outerNode.kind === "item"
            ? outerNode.item.meta
            : `more ${definition.label.toLowerCase()}`,
        detail: outerNode.kind === "item" ? outerNode.item.detail : undefined,
        group: definition.key,
        x,
        y,
        item: outerNode.kind === "item" ? outerNode.item : undefined,
      });
      edges.push({
        id: `${groupNodeId}:${nodeId}`,
        from: groupNodeId,
        to: nodeId,
        group: definition.key,
        strong: false,
      });
    });
  }

  return { nodes, edges };
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}
