<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { getStroke } from 'perfect-freehand';
  import { getSvgPathFromStroke, getPerfectFreehandOptions, calculatePressureFromVelocity } from '$lib/utils/drawingUtils';
  import type { StrokePoint } from '$lib/types';

  // Props
  export let width: number = 0;
  export let height: number = 0;
  export let strokes: any[] = [];
  export let tool: 'pen' | 'highlighter' | 'eraser' | 'pan' = 'pen';
  export let color: string = '#000000';
  export let size: number = 3;
  export let opacity: number = 1;
  export let thinning: number = 0.5;
  export let smoothing: number = 0.5;
  export let streamline: number = 0.5;
  export let simulatePressure: boolean = true;
  export let capStart: boolean = true;
  export let capEnd: boolean = true;
  export let taperStart: number = 0;
  export let taperEnd: number = 0;
  export let zoom: number = 1;
  export let offsetX: number = 0;
  export let offsetY: number = 0;
  export let readonly: boolean = false;

  // Private state
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let isDrawing = false;
  let isPanning = false;
  let currentStroke: any = null;
  let lastPanPoint: any = null;
  let lastPoint: any = null;
  let pointerCapabilities = { pressure: false };

  // Time tracking for velocity-based pressure
  let lastTime = 0;
  let pointTimes: number[] = [];

  // Set up event dispatcher
  const dispatch = createEventDispatcher();

  onMount(() => {
    initializeCanvas();
    checkPointerCapabilities();

    return () => {
      // Cleanup
    };
  });

  onDestroy(() => {
    // Any cleanup needed
  });

  // Track changes to props and redraw
  $: if (ctx && strokes) {
    renderStrokes();
  }

  $: if (width && height && ctx) {
    resizeCanvas();
  }

  function checkPointerCapabilities() {
    if (typeof window !== 'undefined' && window.PointerEvent) {
      pointerCapabilities.pressure = true;
    } else {
      pointerCapabilities.pressure = false;
    }
  }

  function initializeCanvas() {
    if (!canvas) return;

    ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Failed to get canvas context');
      return;
    }

    resizeCanvas();
    renderStrokes();
  }

  function resizeCanvas() {
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    // Apply DPR scaling
    ctx.scale(dpr, dpr);

    // Set CSS dimensions
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    renderStrokes();
  }

  function renderStrokes() {
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save context for transformations
    ctx.save();

    // Apply zoom and pan
    ctx.translate(offsetX, offsetY);
    ctx.scale(zoom, zoom);

    // Render each stroke
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;

      // Determine tool-specific options
      const toolThinning = stroke.tool === 'highlighter' ? -0.5 : thinning;

      // Generate the stroke with perfect-freehand
      const options = getPerfectFreehandOptions(
        stroke.size,
        toolThinning,
        smoothing,
        streamline,
        simulatePressure,
        capStart,
        capEnd,
        taperStart,
        taperEnd
      );

      const points = stroke.points.map((p: StrokePoint) => [p.x, p.y, p.pressure || 0.5]);
      const freehandStroke = getStroke(points, options);

      // Get SVG path
      const pathData = getSvgPathFromStroke(freehandStroke);

      if (!pathData) continue;

      // Create a path from the SVG data
      const path = new Path2D(pathData);

      // Set fill style based on stroke tool
      if (stroke.tool === 'highlighter') {
        ctx.fillStyle = stroke.color;
        ctx.globalAlpha = 0.4; // Highlighters are semi-transparent
      } else {
        ctx.fillStyle = stroke.color;
        ctx.globalAlpha = stroke.opacity;
      }

      // Fill the path
      ctx.fill(path);
    }

    // Draw current stroke if we're in the middle of drawing
    if (currentStroke && currentStroke.points.length > 1) {
      // Determine tool-specific options
      const toolThinning = currentStroke.tool === 'highlighter' ? -0.5 : thinning;

      const options = getPerfectFreehandOptions(
        currentStroke.size,
        toolThinning,
        smoothing,
        streamline,
        simulatePressure,
        capStart,
        capEnd,
        taperStart,
        taperEnd
      );

      const points = currentStroke.points.map((p: StrokePoint) => [p.x, p.y, p.pressure || 0.5]);
      const freehandStroke = getStroke(points, options);

      // Get SVG path
      const pathData = getSvgPathFromStroke(freehandStroke);

      if (pathData) {
        // Create a path from the SVG data
        const path = new Path2D(pathData);

        // Set fill style based on stroke tool
        if (currentStroke.tool === 'eraser') {
          ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'; // Red for eraser preview
          ctx.globalAlpha = 0.5;
        } else if (currentStroke.tool === 'highlighter') {
          ctx.fillStyle = currentStroke.color;
          ctx.globalAlpha = 0.4;
        } else {
          ctx.fillStyle = currentStroke.color;
          ctx.globalAlpha = currentStroke.opacity;
        }

        // Fill the path
        ctx.fill(path);
      }
    }

    // Reset alpha and restore context
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function handlePointerDown(e: PointerEvent) {
    if (readonly) return;

    e.preventDefault();

    if (tool === 'pan') {
      startPanning(e);
    } else {
      startDrawing(e);
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (readonly) return;

    e.preventDefault();

    if (isPanning) {
      continuePanning(e);
    } else if (isDrawing) {
      continueDrawing(e);
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (readonly) return;

    e.preventDefault();

    if (isPanning) {
      endPanning();
    } else if (isDrawing) {
      finishDrawing();
    }
  }

  function startDrawing(e: PointerEvent) {
    isDrawing = true;
    lastTime = Date.now();
    pointTimes = [];

    // Get pointer position (accounting for zoom and pan)
    const point = getPointerPosition(e);

    // Get pressure if available
    const pressure = pointerCapabilities.pressure && e.pressure !== 0
      ? e.pressure
      : 0.5;

    // Determine tool type (handle stylus eraser)
    let currentTool = tool;
    if (e.pointerType === 'pen' && e.buttons === 32) {
      // Button 32 is the eraser button on most styli
      currentTool = 'eraser';
    }

    // Create new stroke
    currentStroke = {
      points: [{ ...point, pressure }],
      color: color,
      size: size,
      opacity: opacity,
      tool: currentTool
    };

    // Track time for velocity-based pressure
    pointTimes.push(lastTime);
    lastPoint = point;

    // Try to capture pointer
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      console.error('Error capturing pointer:', err);
    }
  }

  function continueDrawing(e: PointerEvent) {
    if (!isDrawing || !currentStroke) return;

    // Get pointer position
    const point = getPointerPosition(e);

    // Get pressure (from device or simulation)
    const pressure = pointerCapabilities.pressure && e.pressure !== 0
      ? e.pressure
      : simulatePressure ? calculateVelocityPressure(point) : 0.5;

    // Add point to current stroke
    currentStroke.points.push({ ...point, pressure });

    // Track time and point for velocity calculation
    const now = Date.now();
    pointTimes.push(now);
    lastTime = now;
    lastPoint = point;

    // Redraw
    renderStrokes();
  }

  function finishDrawing() {
    if (!isDrawing || !currentStroke) return;

    isDrawing = false;

    // Only add stroke if it has enough points
    if (currentStroke.points.length > 1) {
      if (currentStroke.tool === 'eraser') {
        // Handle eraser - dispatch event to parent component
        dispatch('erase', { eraserStroke: currentStroke });
      } else {
        // Add stroke
        dispatch('addStroke', { stroke: currentStroke });
      }
    }

    // Reset
    currentStroke = null;
    pointTimes = [];
    lastPoint = null;

    // Redraw
    renderStrokes();
  }

  function startPanning(e: PointerEvent) {
    isPanning = true;
    lastPanPoint = getPointerPosition(e, false); // Get raw coords for panning

    // Change cursor
    canvas.style.cursor = 'grabbing';

    // Try to capture pointer
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {
      console.error('Error capturing pointer:', err);
    }
  }

  function continuePanning(e: PointerEvent) {
    if (!isPanning || !lastPanPoint) return;

    const currentPoint = getPointerPosition(e, false); // Get raw coords

    // Calculate delta
    const dx = currentPoint.x - lastPanPoint.x;
    const dy = currentPoint.y - lastPanPoint.y;

    // Update offset
    dispatch('pan', { dx, dy });

    // Update last pan point
    lastPanPoint = currentPoint;
  }

  function endPanning() {
    isPanning = false;
    lastPanPoint = null;

    // Reset cursor
    canvas.style.cursor = 'grab';
  }

  function calculateVelocityPressure(point: any): number {
    if (!lastPoint) return 0.5;

    // Calculate distance
    const dx = point.x - lastPoint.x;
    const dy = point.y - lastPoint.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Calculate time delta
    const timeDelta = Date.now() - lastTime;

    // Avoid division by zero
    if (timeDelta === 0) return 0.5;

    // Calculate velocity (pixels per ms)
    const velocity = distance / timeDelta;

    // Convert to pressure (inverse relationship)
    // Clamp between 0.1 and 1.0
    const MAX_VELOCITY = 2.0; // pixels per ms
    return Math.min(Math.max(1 - (velocity / MAX_VELOCITY), 0.1), 1.0);
  }

  function getPointerPosition(e: PointerEvent, applyTransform: boolean = true) {
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    if (applyTransform) {
      // Adjust for zoom and pan
      return {
        x: (clientX - rect.left) / zoom - offsetX / zoom,
        y: (clientY - rect.top) / zoom - offsetY / zoom
      };
    } else {
      // Return raw position relative to canvas
      return {
        x: clientX - rect.left,
        y: clientY - rect.top
      };
    }
  }

  // Update cursor based on tool
  $: cursor = tool === 'pan' ? 'grab' :
             tool === 'eraser' ? 'url(/eraser-cursor.png), default' :
             'crosshair';
</script>

<canvas
  class="drawing-surface"
  bind:this={canvas}
  style="cursor: {cursor}; width: {width}px; height: {height}px;"
  on:pointerdown={handlePointerDown}
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointercancel={handlePointerUp}
></canvas>

<style>
  .drawing-surface {
    touch-action: none;
    display: block;
  }
</style>