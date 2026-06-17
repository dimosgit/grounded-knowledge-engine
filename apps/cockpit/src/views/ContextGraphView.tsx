import { useState } from "react";
import {
  FileText,
  Link2,
  Minus,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Rocket,
  Sparkles,
} from "lucide-react";
import { CommandBar } from "../components/CommandBar";
import { OperatorFrame } from "../components/OperatorFrame";
import { useGraphInteractions } from "../hooks/useGraphInteractions";

export function ContextGraphView({
  docs,
  commandBarOpen,
  onCommandBarOpenChange,
  onCommand,
  onCommandSelect,
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
}) {
  const [isGraphLinksCollapsed, setIsGraphLinksCollapsed] = useState(false);
  const {
    graphScale,
    graphPan,
    graphNodePositions,
    graphDragState,
    zoomGraph,
    resetGraphLayout,
    startGraphPan,
    startGraphNodeDrag,
    moveGraphPointer,
    endGraphPointer,
    runNodeClick,
  } = useGraphInteractions(contextGraph.focusId);
  const displayedGraphNodes = contextGraph.nodes.map((node) => ({
    ...node,
    ...(graphNodePositions[node.id] || {}),
  }));
  const graphNodeById = new Map<string, any>(displayedGraphNodes.map((node) => [node.id, node]));
  const graphSelectOptions = graphFocusOption && !graphFocusOptions.some((option) => option.id === graphFocusOption.id)
    ? [graphFocusOption, ...graphFocusOptions]
    : graphFocusOptions;

  return (
    <OperatorFrame
      activeView="graph"
      title="Knowledge Base"
      commandBar={<CommandBar items={docs} isOpen={commandBarOpen} onOpenChange={onCommandBarOpenChange} onSelect={onCommandSelect} />}
      onCommand={onCommand}
      onHub={onHub}
      onLibrary={onLibrary}
      onProjects={onProjects}
      onGraph={onGraph}
    >
      <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-surface-main">
        <section className="border-b border-border-subtle px-4 py-6 md:px-8">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <h1 className="font-display text-display-lg text-on-surface">Context Graph</h1>
              <p className="mt-2 text-body-md text-on-surface-variant">
                Explore the major workspace map: tracks, modules, clients, and projects. Choose a focus to show only its connected major contexts.
              </p>
            </div>
            <div className="grid w-full gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] xl:max-w-3xl">
              <label className="min-w-0">
                <span className="mb-1 block text-label-caps uppercase text-on-surface-variant">Filter focus</span>
                <input
                  className="h-11 w-full rounded border border-border-subtle bg-surface-container px-3 text-body-md text-on-surface outline-none focus:border-primary"
                  value={graphQuery}
                  onChange={(event) => onGraphQueryChange(event.target.value)}
                  placeholder="Search tracks, modules, clients, projects..."
                />
              </label>
              <label className="min-w-0">
                <span className="mb-1 block text-label-caps uppercase text-on-surface-variant">Show context</span>
                <select
                  className="h-11 w-full rounded border border-border-subtle bg-surface-container px-3 text-body-md text-on-surface outline-none focus:border-primary"
                  value={contextGraph.focusId}
                  onChange={(event) => onFocusGraphPath(event.target.value)}
                >
                  {graphSelectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.kind} - {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="flex h-11 items-center justify-center gap-2 self-end rounded border border-outline-variant px-4 text-label-caps font-semibold uppercase text-on-surface hover:border-primary hover:text-primary"
                onClick={() => onOpenGraphNode(contextGraph.focusNode)}
                disabled={!contextGraph.focusNode}
              >
                <FileText size={16} />
                Open
              </button>
            </div>
          </div>
        </section>

        <div className={`grid flex-1 grid-cols-1 ${isGraphLinksCollapsed ? "lg:grid-cols-[minmax(0,1fr)_76px]" : "lg:grid-cols-[minmax(0,1fr)_360px]"}`}>
          <section
            className={`relative min-h-[680px] overflow-hidden border-b border-border-subtle lg:border-b-0 lg:border-r ${graphDragState?.type === "pan" ? "cursor-grabbing" : "cursor-grab"}`}
            onPointerDown={startGraphPan}
            onPointerMove={moveGraphPointer}
            onPointerUp={endGraphPointer}
            onPointerCancel={endGraphPointer}
            onPointerLeave={endGraphPointer}
            data-graph-viewport
          >
            <div className="absolute left-5 top-5 z-20 flex items-center gap-2 rounded border border-border-subtle bg-surface-container/90 p-2 shadow-sm shadow-black/20 backdrop-blur" data-graph-controls>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded border border-outline-variant text-on-surface hover:border-primary hover:text-primary"
                onClick={() => zoomGraph(0.15)}
                aria-label="Zoom in graph"
                title="Zoom in"
              >
                <Plus size={16} />
              </button>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded border border-outline-variant text-on-surface hover:border-primary hover:text-primary"
                onClick={() => zoomGraph(-0.15)}
                aria-label="Zoom out graph"
                title="Zoom out"
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
                title="Re-adjust graph layout"
              >
                <RotateCcw size={15} />
                Re-adjust
              </button>
            </div>

            <div
              className="relative min-h-[680px] min-w-[920px]"
              style={{
                transform: `translate(${graphPan.x}px, ${graphPan.y}px) scale(${graphScale})`,
                transformOrigin: "center",
                transition: graphDragState ? "none" : "transform 160ms ease",
              }}
              data-graph-world
            >
              <svg className="absolute inset-0 h-full w-full" aria-hidden="true">
                {contextGraph.edges.map((edge) => {
                  const from = graphNodeById.get(edge.from);
                  const to = graphNodeById.get(edge.to);
                  if (!from || !to) return null;
                  const strokeWidth = Math.max(1.5, Math.min(5, edge.score / 2));
                  const opacity = Math.max(0.22, Math.min(0.72, edge.score / 12));
                  return (
                    <line
                      key={edge.id}
                      x1={`${from.x}%`}
                      y1={`${from.y}%`}
                      x2={`${to.x}%`}
                      y2={`${to.y}%`}
                      stroke="rgb(125 183 255)"
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
                  className={`absolute max-w-[240px] -translate-x-1/2 -translate-y-1/2 rounded-lg border px-4 py-3 text-left shadow-sm shadow-black/20 transition hover:border-primary ${
                    node.id === contextGraph.focusId
                      ? "border-primary bg-primary-container text-on-primary-container"
                      : node.kind === "module" || node.kind === "client"
                        ? "border-track-demo/60 bg-surface-container"
                        : node.kind === "track"
                          ? "border-track-ai/60 bg-surface-container"
                          : "border-border-subtle bg-surface-container"
                  } ${graphDragState?.type === "node" && graphDragState.nodeId === node.id ? "cursor-grabbing" : "cursor-move"}`}
                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                  onPointerDown={(event) => startGraphNodeDrag(event, node)}
                  onClick={() => runNodeClick(() => onFocusGraphPath(node.id))}
                  title="Drag to move. Click to focus major context here."
                  data-graph-node
                  data-node-id={node.id}
                >
                  <div className="mb-1 flex items-center gap-2 font-mono text-code-sm uppercase opacity-80">
                    {node.id === contextGraph.focusId ? <Rocket size={15} /> : node.kind === "track" ? <Sparkles size={15} className="text-track-ai" /> : <FileText size={15} />}
                    {node.kind}
                  </div>
                  <div className="line-clamp-2 text-body-md font-semibold">{node.label}</div>
                  {node.summary && <div className="mt-2 font-mono text-code-sm opacity-70">{node.summary}</div>}
                </button>
              ))}

              {!contextGraph.relationships.length && (
                <div className="absolute left-1/2 top-1/2 max-w-md -translate-x-1/2 translate-y-20 rounded-lg border border-border-subtle bg-surface-container p-5 text-center text-body-md text-on-surface-variant">
                  No major context links found for this focus yet. Add module ownership or project module metadata to connect it.
                </div>
              )}
            </div>
          </section>

          <aside className={`bg-surface-sidebar ${isGraphLinksCollapsed ? "p-3" : "p-5"}`}>
            <div className={`mb-5 flex gap-3 ${isGraphLinksCollapsed ? "items-center justify-between lg:flex-col" : "items-start justify-between"}`}>
              {!isGraphLinksCollapsed && (
                <div className="min-w-0">
                  <h2 className="font-display text-headline-sm text-on-surface">Major Context Links</h2>
                  <p className="mt-1 text-metadata text-on-surface-variant">
                    {contextGraph.nodes.length} nodes and {contextGraph.edges.length} links in this view.
                  </p>
                </div>
              )}
              {isGraphLinksCollapsed && (
                <div className="flex min-w-0 items-center gap-3 lg:flex-col">
                  <div className="flex h-10 w-10 items-center justify-center rounded border border-border-subtle bg-surface-container text-primary">
                    <Link2 size={18} />
                  </div>
                  <div className="min-w-0 lg:text-center">
                    <div className="truncate text-label-caps font-semibold uppercase text-on-surface lg:hidden">Major Context Links</div>
                    <div className="font-mono text-code-sm text-on-surface-variant">{contextGraph.edges.length}</div>
                  </div>
                </div>
              )}
              <button
                type="button"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-outline-variant text-on-surface hover:border-primary hover:text-primary"
                onClick={() => setIsGraphLinksCollapsed((current) => !current)}
                aria-label={isGraphLinksCollapsed ? "Expand major context links" : "Collapse major context links"}
                title={isGraphLinksCollapsed ? "Expand major context links" : "Collapse major context links"}
              >
                {isGraphLinksCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
            </div>
            {!isGraphLinksCollapsed && (
              <div className="space-y-3">
                {contextGraph.relationships.map((relationship) => (
                  <article key={relationship.id} className="rounded-lg border border-border-subtle bg-surface-container-low p-4">
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
                      onClick={() => onOpenGraphNode(relationship.toNode)}
                    >
                      Open context
                    </button>
                  </article>
                ))}
              </div>
            )}
          </aside>
        </div>
      </div>
    </OperatorFrame>
  );
}
