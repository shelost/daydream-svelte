<script lang="ts">
  import { onMount, onDestroy, afterUpdate } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { Tool, DrawingContent, Stroke, StrokePoint } from '$lib/types';
  import { updatePageContent } from '$lib/supabase/pages';
  import { getStroke } from 'perfect-freehand';
  import { getSvgPathFromStroke, getPerfectFreehandOptions, calculatePressureFromVelocity } from '$lib/utils/drawingUtils';
  import FloatingToolbar from './Drawing/FloatingToolbar.svelte';
  import ZoomControl from './ZoomControl.svelte';

  export let pageId: string;
  export let content: DrawingContent;
  export let selectedTool: Tool = 'draw';
  export let onSaving: (status: boolean) => void;
  export let onSaveStatus: (status: 'saved' | 'saving' | 'error') => void;

  // Internal tool state for FloatingToolbar compatibility
  // FloatingToolbar uses 'pen' while our Tool type uses 'draw'
  $: floatingToolbarTool = selectedTool === 'draw' ? 'pen' as const :
                         selectedTool === 'eraser' ? 'eraser' as const :
                         selectedTool === 'pan' ? 'pan' as const : 'pen' as const;

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let saveTimeout: any;
  let isDrawing = false;
  let currentStroke: Stroke | null = null;
  let isPanning = false;
  let lastPanPoint: StrokePoint | null = null;
  let offsetX = 0;
  let offsetY = 0;
  let zoom = 1;
  let showInstructions = true;
  let pointerCapabilities: PointerCapabilities = { pressure: false };

  // Track time for velocity-based pressure
  let lastTime = 0;
  let pointTimes: number[] = [];

  // Drawing settings
  let strokeColor = '#000000';
  let strokeSize = 3;
  let strokeOpacity = 1;
  let thinning = 0.5;
  let smoothing = 0.5;
  let streamline = 0.5;
  let simulatePressure = true;
  let capStart = true;
  let capEnd = true;
  let taperStart = 0;
  let taperEnd = 0;

  // Store stroke history for undo/redo
  let strokeHistory: Stroke[][] = [];
  let currentHistoryIndex = -1;
  let maxHistorySteps = 50;

  // Keyboard shortcuts
  let keyboardMap: Record<string, (event?: KeyboardEvent) => void> = {};

  // Define pointer capabilities interface
  interface PointerCapabilities {
    pressure: boolean;
  }

  onMount(() => {
    try {
      // Check pointer capabilities
      checkPointerCapabilities();

      // Initialize the drawing
      initializeDrawing();

      // Set up event listeners
      window.addEventListener('resize', resizeCanvas);
      window.addEventListener('keydown', handleKeyDown);

      // Hide instructions after 3 seconds
      setTimeout(() => {
        showInstructions = false;
      }, 3000);

      // Set up keyboard shortcuts
      setupKeyboardShortcuts();
    } catch (error) {
      console.error('Error initializing drawing:', error);
    }

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('keydown', handleKeyDown);
    };
  });

  onDestroy(() => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
  });

  afterUpdate(() => {
    updateToolMode();
  });

  function setupKeyboardShortcuts() {
    keyboardMap = {
      'p': () => updateToolSelection('draw'),
      'h': () => updateToolSelection('highlighter'),
      'e': () => updateToolSelection('eraser'),
      ' ': () => updateToolSelection('pan'),
      'z': (event?: KeyboardEvent) => {
        if (event?.ctrlKey || event?.metaKey) {
          if (event?.shiftKey) {
            redo();
          } else {
            undo();
          }
        }
      },
      '+': () => {
        zoom = Math.min(zoom + 0.1, 5);
        renderStrokes();
      },
      '-': () => {
        zoom = Math.max(zoom - 0.1, 0.5);
        renderStrokes();
      },
      '0': () => {
        zoom = 1;
        offsetX = 0;
        offsetY = 0;
        renderStrokes();
      }
    };
  }

  function updateToolSelection(tool: 'draw' | 'highlighter' | 'eraser' | 'pan') {
    if (tool === 'pan') {
      selectedTool = 'pan';
    } else if (tool === 'eraser') {
      selectedTool = 'eraser';
      currentStroke = null;
    } else {
      selectedTool = 'draw';
      currentStroke = null;
    }
    updateToolMode();
  }

  function handleKeyDown(e: KeyboardEvent) {
    const key = e.key.toLowerCase();

    // Execute the mapped function if it exists
    if (keyboardMap[key]) {
      keyboardMap[key](e);
    }
  }

  function checkPointerCapabilities() {
    if (typeof window !== 'undefined' && window.PointerEvent) {
      pointerCapabilities.pressure = true;
    } else {
      pointerCapabilities.pressure = false;
      simulatePressure = true;
    }
  }

  function initializeDrawing() {
    // Initialize the drawing canvas
    if (canvas) {
      ctx = canvas.getContext('2d');

      if (!ctx) {
        console.error('Could not get canvas context');
        return;
      }

      // Set canvas size
      resizeCanvas();

      // Initialize content if it doesn't exist
      if (!content.strokes) {
        content.strokes = [];
      }

      // Initialize stroke history
      strokeHistory = [];
      currentHistoryIndex = -1;
      saveHistoryState();

      // Render existing strokes
      renderStrokes();
    } else {
      console.error('Canvas element is not defined');
    }
  }

  function resizeCanvas() {
    if (!canvas || !ctx || !canvas.parentElement) {
      console.error('Canvas, context, or parent element is not defined');
      return;
    }

    try {
      const rect = canvas.parentElement.getBoundingClientRect();

      // Set canvas dimensions with device pixel ratio for sharper rendering
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      // Scale the context
      ctx.scale(dpr, dpr);

      // Set CSS dimensions
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      // Re-render after resize
      renderStrokes();
    } catch (error) {
      console.error('Error resizing canvas:', error);
    }
  }

  function renderStrokes() {
    if (!ctx || !content.strokes) return;

    try {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Save context state for transformations
      ctx.save();

      // Apply zoom and pan
      ctx.translate(offsetX, offsetY);
      ctx.scale(zoom, zoom);

      // Render each stroke
      for (const stroke of content.strokes) {
        if (stroke.points.length < 2) continue;

        // Generate the stroke with perfect-freehand
        const perfectFreehandOptions = getPerfectFreehandOptions(
          stroke.size,
          stroke.tool === 'highlighter' ? -0.5 : thinning,
          smoothing,
          streamline,
          simulatePressure,
          capStart,
          capEnd,
          taperStart,
          taperEnd
        );

        const freehandStroke = getStroke(
          stroke.points.map(p => [p.x, p.y, p.pressure || 0.5]),
          perfectFreehandOptions
        );

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

      // Reset alpha
      ctx.globalAlpha = 1;

      // Restore context state
      ctx.restore();
    } catch (error) {
      console.error('Error rendering strokes:', error);
    }
  }

  function startDrawing(e: PointerEvent) {
    if (selectedTool === 'pan') {
      startPanning(e);
      return;
    }

    isDrawing = true;
    lastTime = Date.now();
    pointTimes = [];

    // Get pointer position
    const point = getPointerPosition(e);

    // Capture pressure if available
    const pressure = pointerCapabilities.pressure && e.pressure !== 0
      ? e.pressure
      : 0.5;

    // Create a new stroke
    let tool: 'pen' | 'highlighter' | 'eraser' = 'pen';

    // Set appropriate tool based on selected tool or stylus eraser button
    if (selectedTool === 'eraser') {
      tool = 'eraser';
    } else if (e.pointerType === 'pen' && e.buttons === 32) {
      // Eraser button on stylus
      tool = 'eraser';
    } else if (selectedTool === 'draw') {
      tool = 'pen';
    }

    currentStroke = {
      points: [{...point, pressure}],
      color: strokeColor,
      size: strokeSize,
      opacity: strokeOpacity,
      tool: tool
    };

    // Track time for velocity-based pressure
    pointTimes.push(lastTime);

    // Try to capture pointer for events outside canvas
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (error) {
      console.error('Error capturing pointer:', error);
    }
  }

  function continueDrawing(e: PointerEvent) {
    if (selectedTool === 'pan' && isPanning) {
      continuePanning(e);
      return;
    }

    if (!isDrawing || !currentStroke || !ctx) return;

    // Get pointer position
    const point = getPointerPosition(e);

    // Capture pressure if available
    const pressure = pointerCapabilities.pressure && e.pressure !== 0
      ? e.pressure
      : simulatePressure ? calculateVelocityPressure() : 0.5;

    // Add point to current stroke
    currentStroke.points.push({...point, pressure});

    // Track time for velocity-based pressure
    const now = Date.now();
    pointTimes.push(now);
    lastTime = now;

    // Redraw
    renderCurrentStroke();
  }

  function calculateVelocityPressure(): number {
    if (!currentStroke || currentStroke.points.length < 2) return 0.5;

    const index = currentStroke.points.length - 1;
    return calculatePressureFromVelocity(currentStroke.points, index);
  }

  function finishDrawing(e: PointerEvent) {
    if (selectedTool === 'pan' && isPanning) {
      endPanning();
      return;
    }

    if (!isDrawing || !currentStroke || !ctx) return;

    isDrawing = false;

    // Handle different tool actions
    if (currentStroke.tool === 'eraser') {
      // Perform erasing
      eraseStrokes();
    } else {
      // Add the current stroke to content
      if (currentStroke.points.length > 1) {
        content.strokes.push({...currentStroke});

        // Save history state
        saveHistoryState();

        // Save changes
        autoSave();
      }
    }

    // Release pointer capture
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (error) {
      console.error('Error releasing pointer capture:', error);
    }

    // Reset current stroke
    currentStroke = null;
    pointTimes = [];

    // Re-render to show final result
    renderStrokes();
  }

  function startPanning(e: PointerEvent) {
    isPanning = true;
    lastPanPoint = getPointerPosition(e);

    // Change cursor
    canvas.style.cursor = 'grabbing';

    // Try to capture pointer for events outside canvas
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (error) {
      console.error('Error capturing pointer:', error);
    }
  }

  function continuePanning(e: PointerEvent) {
    if (!isPanning || !lastPanPoint) return;

    const currentPoint = getPointerPosition(e);

    // Update offset
    offsetX += (currentPoint.x - lastPanPoint.x);
    offsetY += (currentPoint.y - lastPanPoint.y);

    // Update last point
    lastPanPoint = currentPoint;

    // Re-render with new offsets
    renderStrokes();
  }

  function endPanning() {
    isPanning = false;
    lastPanPoint = null;

    // Reset cursor
    canvas.style.cursor = 'default';
  }

  function eraseStrokes() {
    if (!currentStroke) return;

    // Filter out strokes that intersect with the eraser stroke
    const eraserPoints = currentStroke.points;
    const eraserSize = strokeSize * 2; // Make eraser a bit more generous

    // Create a simplified representation of the eraser path
    const eraserPathPoints = eraserPoints.map(p => [p.x, p.y]);

    let removedAny = false;

    // Filter out strokes that intersect with the eraser
    const newStrokes = content.strokes.filter(stroke => {
      // Skip tiny strokes
      if (stroke.points.length < 2) return true;

      // Check for intersection with the eraser path
      const strokePathPoints = stroke.points.map(p => [p.x, p.y]);
      const intersects = doPathsIntersect(strokePathPoints, eraserPathPoints, eraserSize);

      if (intersects) {
        removedAny = true;
      }

      return !intersects;
    });

    // If strokes were removed, update the content
    if (removedAny) {
      content.strokes = newStrokes;

      // Save history state
      saveHistoryState();

      // Save changes
      autoSave();
    }
  }

  function doPathsIntersect(
    path1: number[][],
    path2: number[][],
    threshold: number
  ): boolean {
    // Improved path intersection checking
    // First do a quick bounding box check to rule out obviously non-intersecting paths
    let path1MinX = Infinity, path1MinY = Infinity, path1MaxX = -Infinity, path1MaxY = -Infinity;
    let path2MinX = Infinity, path2MinY = Infinity, path2MaxX = -Infinity, path2MaxY = -Infinity;

    // Calculate bounding boxes
    for (const [x, y] of path1) {
      path1MinX = Math.min(path1MinX, x);
      path1MinY = Math.min(path1MinY, y);
      path1MaxX = Math.max(path1MaxX, x);
      path1MaxY = Math.max(path1MaxY, y);
    }

    for (const [x, y] of path2) {
      path2MinX = Math.min(path2MinX, x);
      path2MinY = Math.min(path2MinY, y);
      path2MaxX = Math.max(path2MaxX, x);
      path2MaxY = Math.max(path2MaxY, y);
    }

    // Add threshold to bounding box
    path2MinX -= threshold;
    path2MinY -= threshold;
    path2MaxX += threshold;
    path2MaxY += threshold;

    // Check if bounding boxes don't overlap
    if (path1MaxX < path2MinX || path1MinX > path2MaxX || path1MaxY < path2MinY || path1MinY > path2MaxY) {
      return false;
    }

    // If bounding boxes overlap, check point distances
    // For efficiency, only check every few points on longer paths
    const path1Step = Math.max(1, Math.floor(path1.length / 20));
    const path2Step = Math.max(1, Math.floor(path2.length / 20));

    for (let i = 0; i < path1.length; i += path1Step) {
      const [x1, y1] = path1[i];
      for (let j = 0; j < path2.length; j += path2Step) {
        const [x2, y2] = path2[j];
        const dx = x1 - x2;
        const dy = y1 - y2;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared < threshold * threshold) {
          return true;
        }
      }
    }

    return false;
  }

  function renderCurrentStroke() {
    if (!currentStroke || !ctx) return;

    try {
      // Render all existing strokes
      renderStrokes();

      // Apply zoom and pan transforms
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(zoom, zoom);

      // Only proceed if we have at least 2 points
      if (currentStroke.points.length < 2) {
        ctx.restore();
        return;
      }

      // Generate the stroke with perfect-freehand
      const perfectFreehandOptions = getPerfectFreehandOptions(
        currentStroke.size,
        currentStroke.tool === 'highlighter' ? -0.5 : thinning,
        smoothing,
        streamline,
        simulatePressure,
        capStart,
        capEnd,
        taperStart,
        taperEnd
      );

      const freehandStroke = getStroke(
        currentStroke.points.map(p => [p.x, p.y, p.pressure || 0.5]),
        perfectFreehandOptions
      );

      // Get SVG path
      const pathData = getSvgPathFromStroke(freehandStroke);

      if (!pathData) {
        ctx.restore();
        return;
      }

      // Create a path from the SVG data
      const path = new Path2D(pathData);

      // Set fill style based on stroke tool
      if (currentStroke.tool === 'eraser') {
        // For eraser preview, show a translucent path
        ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
      } else if (currentStroke.tool === 'highlighter') {
        ctx.fillStyle = currentStroke.color;
        ctx.globalAlpha = 0.4; // Highlighters are semi-transparent
      } else {
        ctx.fillStyle = currentStroke.color;
        ctx.globalAlpha = currentStroke.opacity;
      }

      // Fill the path
      ctx.fill(path);

      // Reset alpha
      ctx.globalAlpha = 1;
      ctx.restore();
    } catch (error) {
      console.error('Error rendering current stroke:', error);
      ctx.restore();
    }
  }

  function getPointerPosition(e: MouseEvent | TouchEvent | PointerEvent): StrokePoint {
    if (!canvas) {
      console.error('Canvas is not defined');
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    // Handle different event types
    if ('touches' in e) {
      // Touch event
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      // Mouse or pointer event
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Calculate position relative to canvas
    const x = (clientX - rect.left) / zoom - offsetX / zoom;
    const y = (clientY - rect.top) / zoom - offsetY / zoom;

    return { x, y };
  }

  function updateToolMode() {
    if (!canvas) return;

    if (selectedTool === 'pan') {
      canvas.style.cursor = 'grab';
    } else if (selectedTool === 'eraser') {
      canvas.style.cursor = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'8\' fill=\'rgba(255,0,0,0.2)\' stroke=\'%23ff0000\' stroke-width=\'2\'/%3E%3C/svg%3E") 12 12, auto';
    } else {
      canvas.style.cursor = 'crosshair';
    }
  }

  function autoSave() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    onSaving(true);
    onSaveStatus('saving');

    saveTimeout = setTimeout(async () => {
      try {
        const { error } = await updatePageContent(pageId, content);

        if (error) {
          console.error('Error saving drawing:', error);
          onSaveStatus('error');
        } else {
          onSaveStatus('saved');
        }
      } catch (err) {
        console.error('Unexpected error saving drawing:', err);
        onSaveStatus('error');
      } finally {
        onSaving(false);
      }
    }, 1000);
  }

  // History management functions
  function saveHistoryState() {
    // Create a deep copy of the current strokes
    const currentState = JSON.parse(JSON.stringify(content.strokes));

    // If we're not at the end of history, truncate
    if (currentHistoryIndex < strokeHistory.length - 1) {
      strokeHistory = strokeHistory.slice(0, currentHistoryIndex + 1);
    }

    // Add new state to history
    strokeHistory.push(currentState);

    // Update current index
    currentHistoryIndex = strokeHistory.length - 1;

    // Limit history size
    if (strokeHistory.length > maxHistorySteps) {
      strokeHistory.shift();
      currentHistoryIndex--;
    }
  }

  function undo() {
    if (currentHistoryIndex <= 0) return;

    // Go back one step
    currentHistoryIndex--;

    // Restore that state
    content.strokes = JSON.parse(JSON.stringify(strokeHistory[currentHistoryIndex]));

    // Render and save
    renderStrokes();
    autoSave();
  }

  function redo() {
    if (currentHistoryIndex >= strokeHistory.length - 1) return;

    // Go forward one step
    currentHistoryIndex++;

    // Restore that state
    content.strokes = JSON.parse(JSON.stringify(strokeHistory[currentHistoryIndex]));

    // Render and save
    renderStrokes();
    autoSave();
  }

  // Handle toolbar events
  function onToolChange(event: CustomEvent) {
    const { tool } = event.detail;

    if (tool === 'pan') {
      selectedTool = 'pan';
    } else if (tool === 'eraser') {
      selectedTool = 'eraser';
    } else if (tool === 'pen' || tool === 'highlighter') {
      selectedTool = 'draw';
      // Set the current stroke tool type for rendering
      if (currentStroke) {
        currentStroke.tool = tool;
      }
    }

    updateToolMode();
  }

  function onColorChange(event: CustomEvent) {
    strokeColor = event.detail.color;
    if (currentStroke) {
      currentStroke.color = strokeColor;
      renderCurrentStroke();
    }
  }

  function onSizeChange(event: CustomEvent) {
    strokeSize = event.detail.size;
    if (currentStroke) {
      currentStroke.size = strokeSize;
      renderCurrentStroke();
    }
  }

  function onOpacityChange(event: CustomEvent) {
    strokeOpacity = event.detail.opacity;
    if (currentStroke) {
      currentStroke.opacity = strokeOpacity;
      renderCurrentStroke();
    }
  }

  function onThinningChange(event: CustomEvent) {
    thinning = event.detail.thinning;
    renderCurrentStroke();
  }

  function onSmoothingChange(event: CustomEvent) {
    smoothing = event.detail.smoothing;
    renderCurrentStroke();
  }

  function onStreamlineChange(event: CustomEvent) {
    streamline = event.detail.streamline;
    renderCurrentStroke();
  }

  function onPressureChange(event: CustomEvent) {
    simulatePressure = event.detail.showPressure;
    renderCurrentStroke();
  }

  function onCapStartChange(event: CustomEvent) {
    capStart = event.detail.capStart;
    renderCurrentStroke();
  }

  function onCapEndChange(event: CustomEvent) {
    capEnd = event.detail.capEnd;
    renderCurrentStroke();
  }

  function onTaperStartChange(event: CustomEvent) {
    taperStart = event.detail.taperStart;
    renderCurrentStroke();
  }

  function onTaperEndChange(event: CustomEvent) {
    taperEnd = event.detail.taperEnd;
    renderCurrentStroke();
  }
</script>

<div class="drawing-container">
  <canvas
    class="drawing-canvas"
    bind:this={canvas}
    on:pointerdown={startDrawing}
    on:pointermove={continueDrawing}
    on:pointerup={finishDrawing}
    on:pointercancel={finishDrawing}
    on:wheel={(e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        zoom = Math.max(0.5, Math.min(5, zoom + delta));
        renderStrokes();
      }
    }}
  />

  {#if showInstructions}
    <div class="instructions" transition:fade={{ duration: 200 }}>
      {#if pointerCapabilities.pressure}
        Using pen pressure for stroke thickness
      {:else}
        Using velocity for simulated pressure
      {/if}
    </div>
  {/if}

  <ZoomControl
    zoom={zoom}
    on:resetZoom={() => {
      zoom = 1;
      offsetX = 0;
      offsetY = 0;
      renderStrokes();
    }}
    on:zoomIn={() => {
      zoom = Math.min(zoom + 0.1, 5);
      renderStrokes();
    }}
    on:zoomOut={() => {
      zoom = Math.max(zoom - 0.1, 0.5);
      renderStrokes();
    }}
  />

  <FloatingToolbar
    selectedTool={floatingToolbarTool}
    {strokeColor}
    {strokeSize}
    opacity={strokeOpacity}
    {thinning}
    {smoothing}
    {streamline}
    showPressure={simulatePressure}
    {capStart}
    {capEnd}
    {taperStart}
    {taperEnd}
    on:toolChange={onToolChange}
    on:colorChange={onColorChange}
    on:sizeChange={onSizeChange}
    on:opacityChange={onOpacityChange}
    on:thinningChange={onThinningChange}
    on:smoothingChange={onSmoothingChange}
    on:streamlineChange={onStreamlineChange}
    on:pressureChange={onPressureChange}
    on:capStartChange={onCapStartChange}
    on:capEndChange={onCapEndChange}
    on:taperStartChange={onTaperStartChange}
    on:taperEndChange={onTaperEndChange}
  />
</div>

<style lang="scss">
  .drawing-container {
    position: relative;
    flex: 1;
    overflow: hidden;
    background-color: white;
    display: flex;
    width: 100%;
    height: 100%;
  }

  .drawing-canvas {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    touch-action: none;
  }

  .instructions {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    pointer-events: none;
  }
</style>