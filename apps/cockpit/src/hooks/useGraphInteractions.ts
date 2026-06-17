import { useEffect, useState } from "react";

export function useGraphInteractions(focusId) {
  const [graphScale, setGraphScale] = useState(1);
  const [graphPan, setGraphPan] = useState({ x: 0, y: 0 });
  const [graphNodePositions, setGraphNodePositions] = useState({});
  const [graphDragState, setGraphDragState] = useState(null);
  const [graphDidDrag, setGraphDidDrag] = useState(false);

  function zoomGraph(delta) {
    setGraphScale((current) => Math.max(0.65, Math.min(1.8, Number((current + delta).toFixed(2)))));
  }

  function resetGraphLayout() {
    setGraphScale(1);
    setGraphPan({ x: 0, y: 0 });
    setGraphNodePositions({});
    setGraphDragState(null);
    setGraphDidDrag(false);
  }

  function startGraphPan(event) {
    if (event.button !== 0) return;
    if (event.target.closest("[data-graph-node], [data-graph-controls]")) return;
    setGraphDidDrag(false);
    setGraphDragState({
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: graphPan.x,
      originY: graphPan.y,
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function startGraphNodeDrag(event, node) {
    if (event.button !== 0) return;
    event.stopPropagation();
    setGraphDidDrag(false);
    setGraphDragState({
      type: "node",
      pointerId: event.pointerId,
      nodeId: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveGraphPointer(event) {
    if (!graphDragState) return;
    const deltaX = event.clientX - graphDragState.startX;
    const deltaY = event.clientY - graphDragState.startY;
    if (Math.abs(deltaX) + Math.abs(deltaY) > 4) setGraphDidDrag(true);

    if (graphDragState.type === "pan") {
      setGraphPan({
        x: graphDragState.originX + deltaX,
        y: graphDragState.originY + deltaY,
      });
      return;
    }

    const world = event.currentTarget.querySelector("[data-graph-world]");
    const rect = world?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    const nextX = Math.max(5, Math.min(95, graphDragState.originX + (deltaX / rect.width) * 100));
    const nextY = Math.max(8, Math.min(92, graphDragState.originY + (deltaY / rect.height) * 100));
    setGraphNodePositions((current) => ({
      ...current,
      [graphDragState.nodeId]: { x: nextX, y: nextY },
    }));
  }

  function endGraphPointer(event) {
    if (graphDragState?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    setGraphDragState(null);
  }

  function runNodeClick(action) {
    if (graphDidDrag) {
      setGraphDidDrag(false);
      return;
    }
    action?.();
  }

  useEffect(() => {
    resetGraphLayout();
  }, [focusId]);

  return {
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
  };
}
