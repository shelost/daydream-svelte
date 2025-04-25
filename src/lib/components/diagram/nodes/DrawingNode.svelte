<!-- src/lib/components/diagram/nodes/DrawingNode.svelte -->
<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { getStroke } from 'perfect-freehand';
  import { Handle, Position } from '@xyflow/svelte';
  import { drawingSettings } from '$lib/stores/drawingStore';

  // Expose node data
  export let id;
  export let data;
  export let selected;
  export let isConnectable = true;

  // Initialize with empty strokes array if not present
  if (!data.strokes) {
    data.strokes = [];
  }

  // Set default dimensions if not set
  if (!data.width) data.width = 300;
  if (!data.height) data.height = 200;

  const dispatch = createEventDispatcher();

  // Draw state
  let canvas;
  let ctx;
  let isDrawing = false;
  let currentStroke = null;
  let devicePixelRatio = 1;

  // Set up drawing settings
  let strokeSize = $drawingSettings.strokeSize || 3;
  let strokeColor = $drawingSettings.strokeColor || '#000000';
  let strokeOpacity = $drawingSettings.strokeOpacity || 1;

  // Drawing parameters
  const thinning = 0.5;
  const smoothing = 0.5;
  const streamline = 0.5;
  const taperStart = 0;
  const taperEnd = 0;
  const capStart = true;
  const capEnd = true;
  const simulatePressure = true;

  onMount(() => {
    if (!canvas) return;

    // Initialize canvas
    devicePixelRatio = window.devicePixelRatio || 1;
    ctx = canvas.getContext('2d');

    // Set up canvas size with device pixel ratio for crisp rendering
    resizeCanvas();

    // Initial render of existing strokes
    renderStrokes();
  });

  function resizeCanvas() {
    if (!canvas) return;

    // Set canvas dimensions with pixel ratio applied
    canvas.width = data.width * devicePixelRatio;
    canvas.height = data.height * devicePixelRatio;

    // Scale all drawing operations by the device pixel ratio
    ctx.scale(devicePixelRatio, devicePixelRatio);

    // Apply CSS dimensions
    canvas.style.width = `${data.width}px`;
    canvas.style.height = `${data.height}px`;
  }

  function startDrawing(e) {
    // Only allow drawing when node is selected
    if (!selected) return;

    e.stopPropagation(); // Prevent parent node dragging

    isDrawing = true;

    // Get pointer position relative to canvas
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Create a new stroke
    currentStroke = {
      points: [{x, y, pressure: 0.5}],
      color: strokeColor,
      size: strokeSize,
      opacity: strokeOpacity,
      tool: 'pen'
    };

    // Try to capture pointer for events outside canvas
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (error) {
      console.error('Error capturing pointer:', error);
    }
  }

  function continueDrawing(e) {
    if (!isDrawing || !currentStroke) return;

    e.stopPropagation(); // Prevent parent node dragging

    // Get pointer position
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Clamp coordinates to canvas bounds
    const boundedX = Math.max(0, Math.min(x, data.width));
    const boundedY = Math.max(0, Math.min(y, data.height));

    // Add point with simulated pressure
    currentStroke.points.push({
      x: boundedX,
      y: boundedY,
      pressure: 0.5
    });

    // Render the current stroke
    renderCurrentStroke();
  }

  function finishDrawing(e) {
    if (!isDrawing) return;

    e.stopPropagation(); // Prevent parent node dragging

    isDrawing = false;

    // Add the current stroke to strokes array if it has points
    if (currentStroke && currentStroke.points.length > 1) {
      data.strokes.push({...currentStroke});

      // Notify parent component that data has changed
      dispatch('nodeUpdated', { id, data });
    }

    // Reset current stroke
    currentStroke = null;

    // Release pointer capture
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (error) {
      console.error('Error releasing pointer:', error);
    }

    // Render all strokes
    renderStrokes();
  }

  function renderStrokes() {
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, data.width, data.height);

    // Background (white by default)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, data.width, data.height);

    // Render each stroke
    if (data.strokes && data.strokes.length > 0) {
      for (const stroke of data.strokes) {
        if (stroke.points.length < 2) continue;

        // Get SVG path for the stroke
        const strokePath = getSvgPathFromStroke(
          getStroke(
            stroke.points.map(p => [p.x, p.y, p.pressure || 0.5]),
            getPerfectFreehandOptions(stroke.size)
          )
        );

        if (!strokePath) continue;

        // Create a path and fill it
        const path = new Path2D(strokePath);

        // Set fill style
        ctx.fillStyle = stroke.color;
        ctx.globalAlpha = stroke.opacity;

        // Fill the path
        ctx.fill(path);
      }
    }

    // Reset alpha
    ctx.globalAlpha = 1;
  }

  function renderCurrentStroke() {
    if (!ctx || !currentStroke) return;

    // Render all strokes first
    renderStrokes();

    // Only proceed if we have at least 2 points
    if (currentStroke.points.length < 2) return;

    // Get SVG path for the current stroke
    const strokePath = getSvgPathFromStroke(
      getStroke(
        currentStroke.points.map(p => [p.x, p.y, p.pressure || 0.5]),
        getPerfectFreehandOptions(currentStroke.size)
      )
    );

    if (!strokePath) return;

    // Create a path and fill it
    const path = new Path2D(strokePath);

    // Set fill style
    ctx.fillStyle = currentStroke.color;
    ctx.globalAlpha = currentStroke.opacity;

    // Fill the path
    ctx.fill(path);

    // Reset alpha
    ctx.globalAlpha = 1;
  }

  // Helper functions for perfect-freehand settings
  function getPerfectFreehandOptions(size) {
    return {
      size: size || 3,
      thinning,
      smoothing,
      streamline,
      easing: (t) => t,
      start: {
        taper: taperStart,
        cap: capStart
      },
      end: {
        taper: taperEnd,
        cap: capEnd
      },
      simulatePressure
    };
  }

  // Convert perfect-freehand stroke to SVG path
  function getSvgPathFromStroke(points) {
    if (!points.length) return '';

    const d = points.reduce(
      (acc, [x0, y0], i, arr) => {
        const [x1, y1] = arr[(i + 1) % arr.length];
        acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        return acc;
      },
      ['M', ...points[0], 'Q']
    );

    d.push('Z');
    return d.join(' ');
  }

  function clearCanvas() {
    data.strokes = [];
    renderStrokes();
    dispatch('nodeUpdated', { id, data });
  }

  // Resize handler to update node dimensions
  function handleResize(e) {
    const { width, height } = e.detail;
    data.width = width;
    data.height = height;
    resizeCanvas();
    renderStrokes();
    dispatch('nodeUpdated', { id, data });
  }
</script>

<div class="drawing-node {selected ? 'selected' : ''}" style="width: {data.width}px; height: {data.height + 30}px;">
  <div class="drawing-node-header">
    <input
      class="node-title"
      type="text"
      bind:value={data.label}
      on:change={() => dispatch('nodeUpdated', { id, data })}
      placeholder="Drawing title"
    />
    <div class="node-controls">
      <button class="clear-button" on:click|stopPropagation={clearCanvas} title="Clear drawing">
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
    </div>
  </div>

  <div class="drawing-area">
    <canvas
      bind:this={canvas}
      on:pointerdown={startDrawing}
      on:pointermove={continueDrawing}
      on:pointerup={finishDrawing}
      on:pointercancel={finishDrawing}
    ></canvas>
  </div>

  <!-- Connector handles for diagram connections -->
  <Handle
    type="source"
    position={Position.Right}
    id="right"
    style="right: 0px; top: 50%;"
    {isConnectable}
  />
  <Handle
    type="source"
    position={Position.Bottom}
    id="bottom"
    style="bottom: 0px; left: 50%;"
    {isConnectable}
  />
  <Handle
    type="target"
    position={Position.Left}
    id="left"
    style="left: 0px; top: 50%;"
    {isConnectable}
  />
  <Handle
    type="target"
    position={Position.Top}
    id="top"
    style="top: 0px; left: 50%;"
    {isConnectable}
  />
</div>

<style>
  .drawing-node {
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
    transition: box-shadow 0.3s ease;
  }

  .drawing-node.selected {
    box-shadow: 0 0 0 2px #4285F4;
  }

  .drawing-node-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
    background: #f5f5f5;
    border-bottom: 1px solid #eee;
  }

  .node-title {
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 500;
    flex: 1;
  }

  .node-controls {
    display: flex;
    gap: 5px;
  }

  .clear-button {
    background: none;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border-radius: 4px;
    color: #777;
  }

  .clear-button:hover {
    background: rgba(0, 0, 0, 0.05);
    color: #222;
  }

  .drawing-area {
    flex: 1;
    position: relative;
    overflow: hidden;
    cursor: crosshair;
    touch-action: none;
  }

  canvas {
    touch-action: none;
    display: block;
    user-select: none;
    background-color: white;
  }
</style>