import { useState } from "react";
import {
  AlertTriangle,
  FileText,
  FileClock,
  Frame,
  Link2,
  ListTodo,
  Minus,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Rocket,
  Scale,
  Sparkles,
} from "lucide-react";
import { CommandBar } from "../components/CommandBar";
import { GraphFocusPicker } from "../components/GraphFocusPicker";
import { OperatorFrame } from "../components/OperatorFrame";
import { ProjectContextMap } from "../components/ProjectContextMap";
import { useGraphInteractions } from "../hooks/useGraphInteractions";
import { GRAPH_LAYERS, GRAPH_STATUS_FILTERS } from "../domain/graph";

const CONTEXT_NODE_ICONS = {
  work: ListTodo,
  attention: AlertTriangle,
  decisions: Scale,
  history: FileClock,
  evidence: FileText,
};

const CONTEXT_NODE_TONES = {
  work: "border-primary/60 bg-surface-container text-on-surface hover:border-primary",
  attention:
    "border-status-blocked/70 bg-surface-container text-on-surface hover:border-status-blocked",
  decisions:
    "border-status-waiting/70 bg-surface-container text-on-surface hover:border-status-waiting",
  history: "border-track-ai/70 bg-surface-container text-on-surface hover:border-track-ai",
  evidence: "border-status-done/70 bg-surface-container text-on-surface hover:border-status-done",
};

const CONTEXT_EDGE_COLORS = {
  work: "rgb(93 135 255)",
  attention: "rgb(255 112 112)",
  decisions: "rgb(244 190 76)",
  history: "rgb(154 125 255)",
  evidence: "rgb(73 190 137)",
};

const CONTEXT_SIGNAL_TEXT = {
  work: "text-primary",
  attention: "text-status-blocked",
  decisions: "text-status-waiting",
  history: "text-track-ai",
  evidence: "text-status-done",
};

/** Below this zoom the secondary lines are unreadable anyway, so drop them. */
const DENSE_SCALE = 0.66;

function contextNodeTone(group) {
  return CONTEXT_NODE_TONES[group] || CONTEXT_NODE_TONES.work;
}

function contextEdgeColor(group) {
  return CONTEXT_EDGE_COLORS[group] || "rgb(125 183 255)";
}

function ContextNodeIcon({ group, size = 15 }) {
  const Icon = CONTEXT_NODE_ICONS[group] || FileText;
  return <Icon size={size} aria-hidden="true" />;
}

function ToolbarChip({ isActive, onClick, children, title, label }) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      aria-label={label}
      title={title}
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-label-caps font-semibold uppercase transition ${
        isActive
          ? "border-primary bg-primary-container text-on-primary-container"
          : "border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

export function ContextGraphView({
  palette,
  onCommand,
  onHub,
  onLibrary,
  onProjects,
  onGraph,
  contextGraph,
  graphFocusOption,
  graphFocusOptions,
  graphQuery,
  onGraphQueryChange,
  onFocusGraphPath,
  onOpenGraphNode,
  graphLayers,
  onToggleGraphLayer,
  graphStatusFilter,
  onGraphStatusFilterChange,
  graphProject,
  projectContextMap,
  onOpenDoc,
  onOpenDecision,
  onOpenDeliveryChecklist,
}) {
  const [isGraphLinksCollapsed, setIsGraphLinksCollapsed] = useState(true);
  const canvasWidth = contextGraph.canvasWidth || 1400;
  const canvasHeight = contextGraph.canvasHeight || 900;
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
  } = useGraphInteractions(
    contextGraph.focusId,
    `${contextGraph.nodes.length}:${contextGraph.edges.length}:${canvasWidth}x${canvasHeight}`,
  );
  const displayedGraphNodes = contextGraph.nodes.map((node) => ({
    ...node,
    ...(graphNodePositions[node.id] || {}),
  }));
  const graphNodeById = new Map<string, any>(displayedGraphNodes.map((node) => [node.id, node]));
  const graphSelectOptions =
    graphFocusOption && !graphFocusOptions.some((option) => option.id === graphFocusOption.id)
      ? [graphFocusOption, ...graphFocusOptions]
      : graphFocusOptions;
  const activeLayers = graphLayers || [];
  // With the Signals layer off the counts still matter, so fold them into the card.
  const showInlineSignals = !activeLayers.includes("context");
  const isDense = graphScale < DENSE_SCALE;

  return (
    <OperatorFrame
      activeView="graph"
      title="Knowledge Base"
      commandBar={<CommandBar {...palette} />}
      onCommand={onCommand}
      onHub={onHub}
      onLibrary={onLibrary}
      onProjects={onProjects}
      onGraph={onGraph}
    >
      <div className="flex h-[calc(100vh-4rem)] flex-col overflow-hidden bg-surface-main">
        {/* Deliberately compact: every pixel spent here is a pixel the canvas
            cannot use, and the graph is the content of this view. */}
        <section className="shrink-0 border-b border-border-subtle px-4 py-3 md:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0 max-w-2xl">
              <h1 className="font-display text-headline-md text-on-surface">Context Graph</h1>
              <p className="truncate text-body-md text-on-surface-variant">
                Explicit links between tracks, modules, clients, projects, and their signals.
              </p>
            </div>
            <div className="grid w-full gap-3 md:grid-cols-[minmax(0,1fr)_auto] xl:max-w-2xl">
              <GraphFocusPicker
                options={graphSelectOptions}
                activeOption={graphFocusOption}
                query={graphQuery}
                onQueryChange={onGraphQueryChange}
                onSelect={onFocusGraphPath}
              />
              <button
                type="button"
                className="flex h-11 items-center justify-center gap-2 self-end rounded border border-outline-variant px-4 text-label-caps font-semibold uppercase text-on-surface hover:border-primary hover:text-primary disabled:opacity-40"
                onClick={() => onOpenGraphNode(contextGraph.focusNode)}
                disabled={!contextGraph.focusNode}
              >
                <FileText size={16} />
                Open
              </button>
            </div>
          </div>

          {!graphProject && (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-label-caps uppercase text-on-surface-variant">Layers</span>
                {GRAPH_LAYERS.map((layer) => {
                  const count = contextGraph.layerCounts?.[layer.id] ?? 0;
                  const isActive = activeLayers.includes(layer.id);
                  return (
                    <ToolbarChip
                      key={layer.id}
                      isActive={isActive}
                      onClick={() => onToggleGraphLayer(layer.id)}
                      label={`${isActive ? "Hide" : "Show"} ${layer.label.toLowerCase()}`}
                      title={`${count} ${layer.label.toLowerCase()} available in this view`}
                    >
                      {layer.label}
                      <span className="font-mono text-code-sm opacity-70">{count}</span>
                    </ToolbarChip>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-label-caps uppercase text-on-surface-variant">Projects</span>
                {GRAPH_STATUS_FILTERS.map((filter) => (
                  <ToolbarChip
                    key={filter.id}
                    isActive={(graphStatusFilter || "all") === filter.id}
                    onClick={() => onGraphStatusFilterChange(filter.id)}
                    label={`Show ${filter.label.toLowerCase()} projects`}
                    title={`Show ${filter.label.toLowerCase()} projects`}
                  >
                    {filter.label}
                  </ToolbarChip>
                ))}
                <span className="font-mono text-code-sm text-on-surface-variant">
                  {contextGraph.filteredProjectCount}/{contextGraph.projectCount}
                </span>
              </div>
            </div>
          )}
        </section>

        {graphProject && projectContextMap ? (
          <main className="min-h-0 flex-1 overflow-y-auto bg-surface-main">
            <ProjectContextMap
              key={projectContextMap.projectId}
              activeProject={graphProject}
              contextMap={projectContextMap}
              onOpenDoc={onOpenDoc}
              onOpenDecision={onOpenDecision}
              onOpenDeliveryChecklist={onOpenDeliveryChecklist}
              embedded
            />
          </main>
        ) : (
          <div
            className={`grid min-h-0 flex-1 grid-cols-1 ${isGraphLinksCollapsed ? "lg:grid-cols-[minmax(0,1fr)_76px]" : "lg:grid-cols-[minmax(0,1fr)_360px]"}`}
          >
            <section
              ref={attachGraphViewport}
              className={`relative h-full min-h-[420px] touch-none overflow-hidden border-b border-border-subtle lg:border-b-0 lg:border-r ${graphDragState?.type === "pan" ? "cursor-grabbing" : "cursor-grab"}`}
              onPointerDown={startGraphPan}
              onPointerMove={moveGraphPointer}
              onPointerUp={endGraphPointer}
              onPointerCancel={endGraphPointer}
              onPointerLeave={endGraphPointer}
              data-graph-viewport
            >
              <div
                className="absolute left-5 top-5 z-20 flex items-center gap-2 rounded border border-border-subtle bg-surface-container/90 p-2 shadow-sm shadow-black/20 backdrop-blur"
                data-graph-controls
              >
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded border border-outline-variant text-on-surface hover:border-primary hover:text-primary"
                  onClick={() => zoomGraph(0.15)}
                  aria-label="Zoom in graph"
                  title="Zoom in (⌘ + scroll)"
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded border border-outline-variant text-on-surface hover:border-primary hover:text-primary"
                  onClick={() => zoomGraph(-0.15)}
                  aria-label="Zoom out graph"
                  title="Zoom out (⌘ + scroll)"
                >
                  <Minus size={16} />
                </button>
                <div className="flex h-9 items-center gap-2 rounded border border-border-subtle bg-surface-container-low px-3 font-mono text-code-sm text-on-surface-variant">
                  <Move size={15} />
                  {Math.round(graphScale * 100)}%
                </div>
                <button
                  type="button"
                  className="flex h-9 items-center gap-2 rounded border border-outline-variant px-3 text-label-caps font-semibold uppercase text-on-surface hover:border-primary hover:text-primary"
                  onClick={resetGraphLayout}
                  aria-label="Re-adjust graph layout"
                  title="Fit the whole graph back into view"
                >
                  <Frame size={15} />
                  Fit
                </button>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded border border-outline-variant text-on-surface hover:border-primary hover:text-primary disabled:opacity-30"
                  onClick={() => onFocusGraphPath("overview")}
                  aria-label="Reset focus to the overview"
                  title="Back to the full overview"
                  disabled={contextGraph.focusId === "overview"}
                >
                  <RotateCcw size={15} />
                </button>
              </div>

              <div className="pointer-events-none absolute bottom-4 left-5 z-20 font-mono text-code-sm text-on-surface-variant">
                ⌘ / ctrl + scroll to zoom · scroll or drag to pan · click a node to focus
              </div>

              <div
                className="absolute left-0 top-0"
                style={{
                  width: `${canvasWidth}px`,
                  height: `${canvasHeight}px`,
                  transform: `translate(${graphPan.x}px, ${graphPan.y}px) scale(${graphScale})`,
                  transformOrigin: "0 0",
                  transition: graphDragState ? "none" : "transform 160ms ease",
                }}
                data-graph-world
              >
                <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
                  {contextGraph.edges.map((edge) => {
                    const from = graphNodeById.get(edge.from);
                    const to = graphNodeById.get(edge.to);
                    if (!from || !to) return null;
                    const contextNode =
                      from.kind === "context" ? from : to.kind === "context" ? to : null;
                    const strokeWidth = Math.max(1.5, Math.min(5, edge.score / 2));
                    const opacity = Math.max(0.32, Math.min(0.82, edge.score / 10));
                    return (
                      <line
                        key={edge.id}
                        x1={`${from.x}%`}
                        y1={`${from.y}%`}
                        x2={`${to.x}%`}
                        y2={`${to.y}%`}
                        stroke={contextEdgeColor(contextNode?.contextGroup)}
                        strokeOpacity={opacity}
                        strokeWidth={strokeWidth}
                      />
                    );
                  })}
                </svg>

                {displayedGraphNodes.map((node) => (
                  <button
                    key={node.id}
                    type="button"
                    className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border text-left shadow-sm shadow-black/20 transition hover:z-10 hover:scale-105 ${
                      node.id === contextGraph.focusId
                        ? "border-primary bg-primary-container text-on-primary-container"
                        : node.kind === "context"
                          ? contextNodeTone(node.contextGroup)
                          : node.kind === "module" || node.kind === "client"
                            ? "border-track-demo/60 bg-surface-container"
                            : node.kind === "track"
                              ? "border-track-ai/60 bg-surface-container"
                              : "border-border-subtle bg-surface-container"
                    } ${
                      node.kind === "context"
                        ? "w-[148px] px-3 py-2"
                        : node.kind === "project"
                          ? "w-[240px] px-4 py-3"
                          : // Rail cards are fixed-width so wrapped rail columns never collide.
                            "w-[190px] px-4 py-3"
                    } ${graphDragState?.type === "node" && graphDragState.nodeId === node.id ? "cursor-grabbing" : "cursor-move"}`}
                    style={{ left: `${node.x}%`, top: `${node.y}%` }}
                    onPointerDown={(event) => startGraphNodeDrag(event, node)}
                    onClick={() =>
                      runNodeClick(() =>
                        onFocusGraphPath(
                          node.kind === "context" && node.projectNodeId
                            ? node.projectNodeId
                            : node.id,
                        ),
                      )
                    }
                    title={
                      node.kind === "context"
                        ? `Open ${node.contextGroup} cluster for this project`
                        : "Drag to move. Click to focus context here."
                    }
                    data-graph-node
                    data-node-id={node.id}
                  >
                    <div className="mb-1 flex items-center gap-2 font-mono text-code-sm uppercase opacity-80">
                      {node.kind === "context" ? (
                        <ContextNodeIcon group={node.contextGroup} />
                      ) : node.id === contextGraph.focusId ? (
                        <Rocket size={15} />
                      ) : node.kind === "track" ? (
                        <Sparkles size={15} className="text-track-ai" />
                      ) : (
                        <FileText size={15} />
                      )}
                      {node.kind === "context" ? node.contextGroup : node.kind}
                    </div>
                    <div className="line-clamp-2 text-body-md font-semibold">{node.label}</div>
                    {node.summary && !isDense && (
                      <div
                        className={`${node.kind === "context" ? "mt-1 line-clamp-1" : "mt-2"} font-mono text-code-sm opacity-70`}
                      >
                        {node.summary}
                      </div>
                    )}
                    {showInlineSignals && node.signals?.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2" data-node-signals>
                        {node.signals.map((signal) => (
                          <span
                            key={signal.key}
                            className={`flex items-center gap-1 font-mono text-code-sm ${
                              CONTEXT_SIGNAL_TEXT[signal.key] || "text-on-surface-variant"
                            }`}
                            title={`${signal.count} ${signal.key}`}
                          >
                            <ContextNodeIcon group={signal.key} size={13} />
                            {signal.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                ))}

                {!contextGraph.relationships.length && (
                  <div className="absolute left-1/2 top-1/2 max-w-md -translate-x-1/2 translate-y-20 rounded-lg border border-border-subtle bg-surface-container p-5 text-center text-body-md text-on-surface-variant">
                    No portfolio links found for this focus yet. Add explicit module ownership or
                    project metadata to connect it.
                  </div>
                )}
              </div>
            </section>

            <aside
              className={`overflow-y-auto bg-surface-sidebar ${isGraphLinksCollapsed ? "p-3" : "p-5"}`}
            >
              <div
                className={`mb-5 flex gap-3 ${isGraphLinksCollapsed ? "items-center justify-between lg:flex-col" : "items-start justify-between"}`}
              >
                {!isGraphLinksCollapsed && (
                  <div className="min-w-0">
                    <h2 className="font-display text-headline-sm text-on-surface">
                      Portfolio Links
                    </h2>
                    <p className="mt-1 text-metadata text-on-surface-variant">
                      {contextGraph.nodes.length} nodes and {contextGraph.edges.length} links in
                      this view.
                    </p>
                  </div>
                )}
                {isGraphLinksCollapsed && (
                  <div className="flex min-w-0 items-center gap-3 lg:flex-col">
                    <div className="flex h-10 w-10 items-center justify-center rounded border border-border-subtle bg-surface-container text-primary">
                      <Link2 size={18} />
                    </div>
                    <div className="min-w-0 lg:text-center">
                      <div className="truncate text-label-caps font-semibold uppercase text-on-surface lg:hidden">
                        Portfolio Links
                      </div>
                      <div className="font-mono text-code-sm text-on-surface-variant">
                        {contextGraph.edges.length}
                      </div>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-outline-variant text-on-surface hover:border-primary hover:text-primary"
                  onClick={() => setIsGraphLinksCollapsed((current) => !current)}
                  aria-label={
                    isGraphLinksCollapsed ? "Expand portfolio links" : "Collapse portfolio links"
                  }
                  title={
                    isGraphLinksCollapsed ? "Expand portfolio links" : "Collapse portfolio links"
                  }
                >
                  {isGraphLinksCollapsed ? (
                    <PanelLeftOpen size={16} />
                  ) : (
                    <PanelLeftClose size={16} />
                  )}
                </button>
              </div>
              {!isGraphLinksCollapsed && (
                <div className="space-y-3">
                  {contextGraph.relationships.map((relationship) => (
                    <article
                      key={relationship.id}
                      className="rounded-lg border border-border-subtle bg-surface-container-low p-4"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <button
                          type="button"
                          className="min-w-0 text-left text-body-md font-semibold text-on-surface hover:text-primary"
                          onClick={() => onFocusGraphPath(relationship.to)}
                        >
                          <span className="line-clamp-2">{relationship.label}</span>
                        </button>
                        <span className="shrink-0 rounded bg-surface-container-high px-2 py-1 font-mono text-code-sm text-primary">
                          {relationship.score}
                        </span>
                      </div>
                      <div className="mb-3 flex items-center gap-2 text-code-sm uppercase text-on-surface-variant">
                        <FileText size={13} />
                        {relationship.fromNode?.kind} to {relationship.toNode?.kind}
                      </div>
                      <ul className="space-y-1 text-metadata text-on-surface-variant">
                        {relationship.reasons.slice(0, 3).map((reason) => (
                          <li key={reason} className="flex gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                            {reason}
                          </li>
                        ))}
                      </ul>
                      <button
                        type="button"
                        className="mt-3 text-label-caps font-semibold uppercase text-primary"
                        onClick={() => {
                          if (
                            relationship.toNode?.kind === "context" &&
                            relationship.toNode.projectNodeId
                          ) {
                            onFocusGraphPath(relationship.toNode.projectNodeId);
                            return;
                          }
                          onOpenGraphNode(relationship.toNode);
                        }}
                      >
                        Open context
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </OperatorFrame>
  );
}
