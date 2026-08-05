import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const MIN_SCALE = 0.25;
const MAX_SCALE = 2.5;
const FIT_PADDING = 48;
/** Clears the floating zoom controls so the top row of nodes is never hidden. */
const FIT_PADDING_TOP = 84;
/** Clears the interaction hint printed along the bottom edge. */
const FIT_PADDING_BOTTOM = 56;
/** Never auto-fit below this: a map nobody can read is worse than one you pan. */
const MIN_FIT_SCALE = 0.45;
/** One mouse-wheel notch (deltaY 120) lands near 1.2x, so zoom stays controllable. */
const WHEEL_ZOOM_RATE = 0.0015;

function clampScale(value) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Number(value.toFixed(3))));
}

/**
 * Pan/zoom for the graph canvases. The viewport is a fixed-size window onto a
 * world of `canvasWidth x canvasHeight` pixels; `transform-origin: 0 0` keeps the
 * zoom maths honest so zoom can be anchored at the pointer.
 *
 * `fitKey` changes whenever the rendered node set changes, which re-frames the
 * view on the new content.
 */
export function useGraphInteractions(focusId, fitKey = "") {
  const [graphScale, setGraphScale] = useState(1);
  const [graphPan, setGraphPan] = useState({ x: 0, y: 0 });
  const [graphNodePositions, setGraphNodePositions] = useState({});
  const [graphDragState, setGraphDragState] = useState(null);
  const [graphDidDrag, setGraphDidDrag] = useState(false);
  const [viewportElement, setViewportElement] = useState<HTMLElement | null>(null);

  // Mirrors of the transform so the native wheel listener never reads stale state.
  const transformRef = useRef({ scale: 1, pan: { x: 0, y: 0 } });
  const viewportRef = useRef<HTMLElement | null>(null);
  const didAdjustRef = useRef(false);

  const applyTransform = useCallback((scale, pan) => {
    transformRef.current = { scale, pan };
    setGraphScale(scale);
    setGraphPan(pan);
  }, []);

  const zoomAtPoint = useCallback(
    (clientX, clientY, nextScaleRaw) => {
      const viewport = viewportRef.current;
      const { scale, pan } = transformRef.current;
      const nextScale = clampScale(nextScaleRaw);
      if (nextScale === scale) return;
      const rect = viewport?.getBoundingClientRect();
      if (!rect?.width || !rect?.height) {
        applyTransform(nextScale, pan);
        return;
      }
      // Keep the world point under the cursor pinned while the scale changes.
      const pointerX = clientX - rect.left;
      const pointerY = clientY - rect.top;
      const worldX = (pointerX - pan.x) / scale;
      const worldY = (pointerY - pan.y) / scale;
      applyTransform(nextScale, {
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale,
      });
    },
    [applyTransform],
  );

  const zoomGraph = useCallback(
    (delta) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      const { scale } = transformRef.current;
      didAdjustRef.current = true;
      if (!rect?.width || !rect?.height) {
        applyTransform(clampScale(scale + delta), transformRef.current.pan);
        return;
      }
      zoomAtPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, scale + delta);
    },
    [applyTransform, zoomAtPoint],
  );

  /**
   * Frames every rendered node inside the viewport. Returns false when the DOM
   * has no measurable layout yet (jsdom, or a canvas that has not painted), in
   * which case the caller keeps the neutral 100% / no-pan transform.
   */
  const fitGraphToContent = useCallback(() => {
    const viewport = viewportRef.current;
    const world = viewport?.querySelector("[data-graph-world]");
    if (!viewport || !world) return false;

    const viewportRect = viewport.getBoundingClientRect();
    const worldRect = world.getBoundingClientRect();
    const nodes = world.querySelectorAll("[data-graph-node]");
    if (!viewportRect.width || !viewportRect.height || !nodes.length) return false;

    // Measure the scale the browser has actually applied rather than trusting
    // state: this can run before a pending transform has been committed.
    const layoutWidth = (world as HTMLElement).offsetWidth;
    const currentScale = layoutWidth ? worldRect.width / layoutWidth : transformRef.current.scale;
    if (!currentScale) return false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (!rect.width && !rect.height) continue;
      minX = Math.min(minX, (rect.left - worldRect.left) / currentScale);
      minY = Math.min(minY, (rect.top - worldRect.top) / currentScale);
      maxX = Math.max(maxX, (rect.right - worldRect.left) / currentScale);
      maxY = Math.max(maxY, (rect.bottom - worldRect.top) / currentScale);
    }

    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    if (!(contentWidth > 0) || !(contentHeight > 0)) return false;

    // The usable box excludes the floating controls and the hint line, so a
    // fitted graph is fully readable rather than merely fully rendered.
    const availableWidth = viewportRect.width - FIT_PADDING * 2;
    const availableHeight = viewportRect.height - FIT_PADDING_TOP - FIT_PADDING_BOTTOM;
    if (!(availableWidth > 0) || !(availableHeight > 0)) return false;

    const fitScale = Math.min(availableWidth / contentWidth, availableHeight / contentHeight);
    const nextScale = clampScale(Math.min(1, Math.max(MIN_FIT_SCALE, fitScale)));
    const scaledWidth = contentWidth * nextScale;
    const scaledHeight = contentHeight * nextScale;
    // Centre what fits; anchor to the content's top-left corner when it does not.
    const panX =
      scaledWidth <= availableWidth
        ? FIT_PADDING + (availableWidth - scaledWidth) / 2 - minX * nextScale
        : FIT_PADDING - minX * nextScale;
    const panY =
      scaledHeight <= availableHeight
        ? FIT_PADDING_TOP + (availableHeight - scaledHeight) / 2 - minY * nextScale
        : FIT_PADDING_TOP - minY * nextScale;

    applyTransform(nextScale, { x: panX, y: panY });
    return true;
  }, [applyTransform]);

  const resetGraphView = useCallback(() => {
    transformRef.current = { scale: 1, pan: { x: 0, y: 0 } };
    setGraphScale(1);
    setGraphPan({ x: 0, y: 0 });
    setGraphNodePositions({});
    setGraphDragState(null);
    setGraphDidDrag(false);
    didAdjustRef.current = false;
  }, []);

  /**
   * Fits now if the canvas is measurable, otherwise retries after paint. The
   * timeout is the one that matters in a background tab, where requestAnimationFrame
   * never fires — without it the graph would open unframed.
   */
  const scheduleFit = useCallback(() => {
    if (fitGraphToContent()) return undefined;
    const frame = requestAnimationFrame(() => fitGraphToContent());
    const timer = setTimeout(() => fitGraphToContent(), 80);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [fitGraphToContent]);

  const resetGraphLayout = useCallback(() => {
    resetGraphView();
    scheduleFit();
  }, [resetGraphView, scheduleFit]);

  function startGraphPan(event) {
    if (event.button !== 0) return;
    if (event.target.closest("[data-graph-node], [data-graph-controls]")) return;
    setGraphDidDrag(false);
    didAdjustRef.current = true;
    setGraphDragState({
      type: "pan",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.pan.x,
      originY: transformRef.current.pan.y,
    });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function startGraphNodeDrag(event, node) {
    if (event.button !== 0) return;
    event.stopPropagation();
    setGraphDidDrag(false);
    didAdjustRef.current = true;
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
      applyTransform(transformRef.current.scale, {
        x: graphDragState.originX + deltaX,
        y: graphDragState.originY + deltaY,
      });
      return;
    }

    const world = event.currentTarget.querySelector("[data-graph-world]");
    const rect = world?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    const nextX = Math.max(2, Math.min(98, graphDragState.originX + (deltaX / rect.width) * 100));
    const nextY = Math.max(3, Math.min(97, graphDragState.originY + (deltaY / rect.height) * 100));
    setGraphNodePositions((current) => ({
      ...current,
      [graphDragState.nodeId]: { x: nextX, y: nextY },
    }));
  }

  function endGraphPointer(event) {
    if (
      graphDragState?.pointerId === event.pointerId &&
      event.currentTarget.hasPointerCapture?.(event.pointerId)
    ) {
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

  const attachGraphViewport = useCallback((element: HTMLElement | null) => {
    viewportRef.current = element;
    setViewportElement(element);
  }, []);

  // Cmd/Ctrl + wheel — and trackpad pinch, which browsers report as ctrl+wheel —
  // zooms at the cursor; a plain wheel pans the canvas. This has to be a native
  // listener: React's synthetic wheel handler cannot preventDefault.
  useEffect(() => {
    if (!viewportElement) return undefined;

    function handleWheel(event: WheelEvent) {
      const { scale, pan } = transformRef.current;
      didAdjustRef.current = true;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        zoomAtPoint(
          event.clientX,
          event.clientY,
          scale * Math.exp(-event.deltaY * WHEEL_ZOOM_RATE),
        );
        return;
      }
      const isShiftPan = event.shiftKey && !event.deltaX;
      applyTransform(scale, {
        x: pan.x - (isShiftPan ? event.deltaY : event.deltaX),
        y: pan.y - (isShiftPan ? 0 : event.deltaY),
      });
    }

    viewportElement.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewportElement.removeEventListener("wheel", handleWheel);
  }, [applyTransform, viewportElement, zoomAtPoint]);

  // Re-frame whenever the focus or the rendered node set changes.
  useLayoutEffect(() => {
    resetGraphView();
    return scheduleFit();
  }, [fitKey, focusId, resetGraphView, scheduleFit]);

  // Keep an untouched view framed when the pane is resized.
  useEffect(() => {
    if (!viewportElement || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (didAdjustRef.current) return;
      fitGraphToContent();
    });
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [fitGraphToContent, viewportElement]);

  return {
    graphScale,
    graphPan,
    graphNodePositions,
    graphDragState,
    zoomGraph,
    resetGraphLayout,
    fitGraphToContent,
    attachGraphViewport,
    startGraphPan,
    startGraphNodeDrag,
    moveGraphPointer,
    endGraphPointer,
    runNodeClick,
  };
}
