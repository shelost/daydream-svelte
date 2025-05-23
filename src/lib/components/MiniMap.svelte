<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';

  // Props
  export let width: number = 200;
  export let height: number = 150;
  export let canvasWidth: number = 800;
  export let canvasHeight: number = 600;
  export let viewportX: number = 0;
  export let viewportY: number = 0;
  export let viewportWidth: number = 800;
  export let viewportHeight: number = 600;
  export let zoom: number = 1;
  export let drawingContent: any = null;
  export let canvasColor: string = '#ffffff';
  export let backgroundColor: string = '#f0f0f0';

  // State
  let miniMapCanvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;
  let isDragging = false;
  let lastPosition = { x: 0, y: 0 };
  let scale = 1; // Scale factor for mapping real canvas to minimap

  // Set up event dispatcher
  const dispatch = createEventDispatcher();

  onMount(() => {
    initializeMiniMap();
    window.addEventListener('resize', updateMiniMap);
  });

  onDestroy(() => {
    window.removeEventListener('resize', updateMiniMap);
  });

  function initializeMiniMap() {
    if (!miniMapCanvas) return;

    ctx = miniMapCanvas.getContext('2d');
    if (!ctx) return;

    // Set up the canvas with correct dimensions
    miniMapCanvas.width = width;
    miniMapCanvas.height = height;

    // Calculate scale factor
    calculateScale();

    // Initial render
    renderMiniMap();
  }

  function calculateScale() {
    // Add a padding factor to see more of the canvas in the minimap
    const bufferFactor = 0.8; // Show the canvas at 80% of the minimap size to have space around it

    // Calculate the scale to fit the entire canvas in the minimap with buffer
    const xScale = (width * bufferFactor) / canvasWidth;
    const yScale = (height * bufferFactor) / canvasHeight;

    // Use the smaller scale to ensure the entire canvas is visible
    scale = Math.min(xScale, yScale);
  }

  function updateMiniMap() {
    if (!miniMapCanvas || !ctx) return;

    calculateScale();
    renderMiniMap();
  }

  function renderMiniMap() {
    if (!ctx) return;

    // Clear the minimap
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Calculate the scaled dimensions with buffer
    const scaledWidth = canvasWidth * scale;
    const scaledHeight = canvasHeight * scale;

    // Center the canvas in the minimap
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = (height - scaledHeight) / 2;

    // Draw a subtle grid for better spatial awareness
    drawGrid(offsetX, offsetY, scaledWidth, scaledHeight);

    // Draw the canvas area
    ctx.fillStyle = canvasColor;
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.fillRect(offsetX, offsetY, scaledWidth, scaledHeight);
    ctx.strokeRect(offsetX, offsetY, scaledWidth, scaledHeight);

    // Draw content if available
    if (drawingContent && drawingContent.strokes && drawingContent.strokes.length > 0) {
      renderStrokes(offsetX, offsetY);
    }

    // Draw the current viewport
    drawViewport(offsetX, offsetY);
  }

  function renderStrokes(offsetX: number, offsetY: number) {
    if (!ctx || !drawingContent || !drawingContent.strokes) return;

    // Draw simplified versions of strokes
    drawingContent.strokes.forEach((stroke: any) => {
      if (!stroke || !stroke.points || stroke.points.length < 2) return;

      ctx.beginPath();
      const startPoint = stroke.points[0];
      ctx.moveTo(
        offsetX + startPoint.x * scale,
        offsetY + startPoint.y * scale
      );

      // Draw simplified path through points
      for (let i = 1; i < stroke.points.length; i++) {
        const point = stroke.points[i];
        ctx.lineTo(
          offsetX + point.x * scale,
          offsetY + point.y * scale
        );
      }

      // Style based on stroke properties
      ctx.strokeStyle = stroke.color || '#000000';
      ctx.lineWidth = (stroke.size || 1) * scale / 2;
      ctx.stroke();
    });
  }

  // Draw a grid to help with spatial awareness
  function drawGrid(offsetX: number, offsetY: number, width: number, height: number) {
    if (!ctx) return;

    // Draw a subtle grid in the background
    const gridSize = 50 * scale; // Grid size in minimap pixels

    ctx.strokeStyle = 'rgba(200, 200, 200, 0.3)';
    ctx.lineWidth = 0.5;

    // Draw vertical grid lines
    for (let x = offsetX; x <= offsetX + width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, offsetY);
      ctx.lineTo(x, offsetY + height);
      ctx.stroke();
    }

    // Draw horizontal grid lines
    for (let y = offsetY; y <= offsetY + height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(offsetX, y);
      ctx.lineTo(offsetX + width, y);
      ctx.stroke();
    }
  }

  function drawViewport(offsetX: number, offsetY: number) {
    if (!ctx) return;

    // Calculate viewport rectangle in minimap coordinates
    // Adjust for zoom to show how much of the canvas is visible
    const vpX = offsetX + viewportX * scale / zoom;
    const vpY = offsetY + viewportY * scale / zoom;
    const vpWidth = viewportWidth * scale / zoom;
    const vpHeight = viewportHeight * scale / zoom;

    // Draw viewport outline
    ctx.strokeStyle = '#4285F4'; // Blue for visibility
    ctx.lineWidth = 2;
    ctx.strokeRect(vpX, vpY, vpWidth, vpHeight);

    // Add semi-transparent fill
    ctx.fillStyle = 'rgba(66, 133, 244, 0.1)';
    ctx.fillRect(vpX, vpY, vpWidth, vpHeight);

    // Add a small indicator at the center of the viewport
    const centerX = vpX + vpWidth / 2;
    const centerY = vpY + vpHeight / 2;

    ctx.beginPath();
    ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#4285F4';
    ctx.fill();
  }

  function handleMouseDown(e: MouseEvent) {
    isDragging = true;
    const rect = miniMapCanvas.getBoundingClientRect();
    lastPosition = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    miniMapCanvas.style.cursor = 'grabbing';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;

    const rect = miniMapCanvas.getBoundingClientRect();
    const currentPosition = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };

    // Calculate the movement delta
    const deltaX = currentPosition.x - lastPosition.x;
    const deltaY = currentPosition.y - lastPosition.y;

    // Update the lastPosition
    lastPosition = currentPosition;

    // Convert minimap coordinates to canvas coordinates
    const canvasDeltaX = deltaX / scale * zoom;
    const canvasDeltaY = deltaY / scale * zoom;

    // Dispatch event to move viewport
    dispatch('moveViewport', {
      deltaX: -canvasDeltaX,
      deltaY: -canvasDeltaY
    });
  }

  function handleMouseUp() {
    isDragging = false;
    miniMapCanvas.style.cursor = 'grab';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  function handleClick(e: MouseEvent) {
    if (isDragging) return; // Don't handle click if we were dragging

    const rect = miniMapCanvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Calculate the scaled canvas offset
    const offsetX = (width - canvasWidth * scale) / 2;
    const offsetY = (height - canvasHeight * scale) / 2;

    // Ensure the click is within the canvas bounds in the minimap
    if (clickX >= offsetX && clickX <= offsetX + canvasWidth * scale &&
        clickY >= offsetY && clickY <= offsetY + canvasHeight * scale) {

      // Convert minimap coordinates to canvas coordinates
      const canvasX = (clickX - offsetX) / scale;
      const canvasY = (clickY - offsetY) / scale;

      // Calculate the new center of the viewport
      const newViewportX = canvasX * zoom - viewportWidth / 2;
      const newViewportY = canvasY * zoom - viewportHeight / 2;

      // Dispatch event to center viewport
      dispatch('centerViewport', {
        x: -newViewportX,
        y: -newViewportY
      });
    }
  }

  // Watch for props changes
  $: if (canvasWidth || canvasHeight || width || height) {
    updateMiniMap();
  }

  $: if (viewportX || viewportY || viewportWidth || viewportHeight || zoom) {
    renderMiniMap();
  }

  $: if (drawingContent) {
    renderMiniMap();
  }
</script>

<div class="minimap-container" style="width: {width}px; height: {height}px;">
  <canvas
    bind:this={miniMapCanvas}
    width={width}
    height={height}
    style="cursor: grab;"
    on:mousedown={handleMouseDown}
    on:click={handleClick}
  ></canvas>
</div>

<style>
  .minimap-container {
    position: absolute;
    bottom: 20px;
    right: 20px;
    border: 1px solid rgba(0, 0, 0, 0.2);
    border-radius: 4px;
    background-color: white;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    overflow: hidden;
    z-index: 10;
  }

  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>