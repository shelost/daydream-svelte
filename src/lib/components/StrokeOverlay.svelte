<script lang="ts">
  import { onMount, onDestroy, afterUpdate } from 'svelte';
  import { fabric } from 'fabric';

  // Props to receive stroke data and canvas dimensions
  export let strokes: any[] = [];
  export let detectedObjects: any[] = [];
  export let width: number = 800;
  export let height: number = 600;
  export let visible: boolean = true;
  export let canvasRef: HTMLCanvasElement | null = null; // Reference to the main drawing canvas element

  // Local state
  let overlayCanvas: HTMLCanvasElement;
  let fabricCanvas: fabric.StaticCanvas;
  let containerElement: HTMLDivElement;
  let resizeObserver: ResizeObserver;
  let resizeTimeout: ReturnType<typeof setTimeout>;
  let lastUpdateTime = 0;
  let initialSyncDone = false;
  let initialized = false;

  // Update canvas display based on visibility
  $: if (overlayCanvas && initialized) {
    overlayCanvas.style.display = visible ? 'block' : 'none';
  }

  // Colors for different object categories
  const categoryColors = {
    'human': 'rgba(255, 87, 51, 0.7)',   // Red-orange
    'animal': 'rgba(255, 51, 165, 0.7)', // Pink
    'building': 'rgba(51, 87, 255, 0.7)', // Blue
    'nature': 'rgba(51, 255, 87, 0.7)',  // Green
    'face': 'rgba(255, 127, 80, 0.7)',   // Coral
    'head': 'rgba(255, 160, 122, 0.7)',  // Light salmon
    'body': 'rgba(233, 150, 122, 0.7)',  // Dark salmon
    'circle': 'rgba(156, 39, 176, 0.7)', // Purple
    'rectangle': 'rgba(63, 81, 181, 0.7)', // Indigo
    'triangle': 'rgba(33, 150, 243, 0.7)', // Blue
    'line': 'rgba(0, 188, 212, 0.7)',    // Cyan
    'arrow': 'rgba(139, 195, 74, 0.7)',  // Light Green
    'star': 'rgba(255, 193, 7, 0.7)',    // Amber
    'default': 'rgba(156, 39, 176, 0.7)' // Purple
  };

  function getColorForObject(obj) {
    if (!obj) return categoryColors.default;

    const category = (obj.category || '').toLowerCase();
    const name = (obj.name || '').toLowerCase();
    const type = (obj.type || '').toLowerCase();

    return obj.color ||
           categoryColors[category] ||
           categoryColors[name] ||
           categoryColors[type] ||
           categoryColors.default;
  }

  function initFabricCanvas() {
    if (!overlayCanvas) return;

    // Clean up previous instance if it exists
    if (fabricCanvas) {
      fabricCanvas.dispose();
    }

    // Create a new static canvas (non-interactive)
    fabricCanvas = new fabric.StaticCanvas(overlayCanvas, {
      width,
      height,
      renderOnAddRemove: true,
      selection: false
    });

    // Make sure it's visible or hidden based on prop
    overlayCanvas.style.display = visible ? 'block' : 'none';

    initialized = true;
    renderStrokes();
  }

  // Find which strokes belong to which detected objects
  function findRelatedStrokes(objectId) {
    if (!detectedObjects || !strokes) return [];

    // Find the object
    const obj = detectedObjects.find(o => o.id === objectId || o.name === objectId);
    if (!obj) return [];

    // Check if object already has stroke IDs referenced
    if (obj.strokeIds && Array.isArray(obj.strokeIds) && obj.strokeIds.length > 0) {
      return strokes.filter(stroke => obj.strokeIds.includes(stroke.id));
    }

    // If object has spatial information (bounding box), find strokes that overlap
    if (obj.boundingBox) {
      const bb = obj.boundingBox;

      return strokes.filter(stroke => {
        if (!stroke.points || stroke.points.length === 0) return false;

        // Check if any point of the stroke is inside the bounding box
        return stroke.points.some(point => {
          const x = point.x || point[0];
          const y = point.y || point[1];
          return x >= bb.minX && x <= bb.maxX && y >= bb.minY && y <= bb.maxY;
        });
      });
    }

    // No clear way to associate, return empty
    return [];
  }

  function renderStrokes() {
    if (!fabricCanvas || !initialized) return;

    // Clear previous canvas contents
    fabricCanvas.clear();

    if (!detectedObjects || !detectedObjects.length || !strokes || !strokes.length || !visible) {
      return;
    }

    // Process each detected object and highlight its strokes
    detectedObjects.forEach((obj, objIndex) => {
      const objectId = obj.id || `obj_${objIndex}`;
      const color = getColorForObject(obj);

      // Find strokes related to this object
      const relatedStrokes = findRelatedStrokes(objectId);

      // Render each related stroke with the object's color
      relatedStrokes.forEach((stroke, strokeIndex) => {
        if (!stroke.points || stroke.points.length < 2) return;

        // Convert points array to format expected by fabric.js
        const points = stroke.points.map(point => {
          // Handle both {x, y} objects and [x, y] arrays
          const x = point.x !== undefined ? point.x * width : point[0] * width;
          const y = point.y !== undefined ? point.y * height : point[1] * height;
          return { x, y };
        });

        // Create path for this stroke
        const pathData = points.reduce((path, point, i) => {
          if (i === 0) return `M ${point.x} ${point.y}`;
          return `${path} L ${point.x} ${point.y}`;
        }, '');

        const strokePath = new fabric.Path(pathData, {
          fill: 'transparent',
          stroke: color,
          strokeWidth: stroke.size || 3,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          objectId: `${objectId}_stroke_${strokeIndex}`,
          selectable: false,
          hoverCursor: 'default'
        });

        fabricCanvas.add(strokePath);
      });

      // Add a small label for the object if strokes were found
      if (relatedStrokes.length > 0) {
        // Find a good position for the label (near the first stroke)
        let labelX = width / 2;
        let labelY = height / 2;

        if (relatedStrokes[0] && relatedStrokes[0].points && relatedStrokes[0].points.length > 0) {
          const firstPoint = relatedStrokes[0].points[0];
          labelX = (firstPoint.x || firstPoint[0]) * width;
          labelY = (firstPoint.y || firstPoint[1]) * height - 20;
        }

        // Create label background
        const labelBg = new fabric.Rect({
          left: labelX,
          top: labelY,
          width: obj.name ? Math.max(obj.name.length * 8 + 16, 60) : 60,
          height: 20,
          fill: color,
          rx: 3,
          ry: 3,
          selectable: false,
          hoverCursor: 'default'
        });

        // Create text label
        const label = new fabric.Text(obj.name || `Object ${objIndex + 1}`, {
          left: labelX + 8,
          top: labelY + 2,
          fontSize: 12,
          fontFamily: 'sans-serif',
          fill: '#FFFFFF',
          selectable: false,
          hoverCursor: 'default'
        });

        // Add label to canvas
        fabricCanvas.add(labelBg);
        fabricCanvas.add(label);
      }
    });

    // Render the canvas
    fabricCanvas.renderAll();
  }

  function updateCanvasSize() {
    if (!fabricCanvas || !overlayCanvas) return;

    // Get the actual size of the drawing canvas (both internal and display size)
    if (canvasRef) {
      const drawingCanvas = canvasRef;
      const displayWidth = drawingCanvas.clientWidth || drawingCanvas.offsetWidth || width;
      const displayHeight = drawingCanvas.clientHeight || drawingCanvas.offsetHeight || height;

      // Get the internal resolution of the drawing canvas
      const internalWidth = drawingCanvas.width;
      const internalHeight = drawingCanvas.height;

      // Set the internal dimensions to match the drawing canvas internal resolution
      fabricCanvas.setWidth(internalWidth);
      fabricCanvas.setHeight(internalHeight);

      // Set the CSS display size to match the drawing canvas display size
      overlayCanvas.style.width = `${displayWidth}px`;
      overlayCanvas.style.height = `${displayHeight}px`;

      // Update the container dimensions
      if (containerElement) {
        containerElement.style.width = `${displayWidth}px`;
        containerElement.style.height = `${displayHeight}px`;
      }
    } else {
      // Fallback to passed props if canvasRef is not available
      fabricCanvas.setWidth(width);
      fabricCanvas.setHeight(height);

      overlayCanvas.style.width = `${width}px`;
      overlayCanvas.style.height = `${height}px`;

      if (containerElement) {
        containerElement.style.width = `${width}px`;
        containerElement.style.height = `${height}px`;
      }
    }

    // Re-render strokes after resize
    renderStrokes();

    // Mark the time of this update
    lastUpdateTime = Date.now();
  }

  function toggleVisibility() {
    if (!overlayCanvas) return;
    overlayCanvas.style.display = visible ? 'block' : 'none';

    if (visible && fabricCanvas) {
      renderStrokes();
    }
  }

  function syncWithDrawingCanvas() {
    if (!canvasRef || !overlayCanvas || !containerElement) return;

    try {
      // Get the drawing canvas position relative to its container
      const rect = canvasRef.getBoundingClientRect();
      const parentRect = canvasRef.parentElement ? canvasRef.parentElement.getBoundingClientRect() : rect;

      // Calculate the offset of the drawing canvas within its container
      const offsetLeft = rect.left - parentRect.left;
      const offsetTop = rect.top - parentRect.top;

      // Apply the same offset to the overlay
      containerElement.style.left = `${offsetLeft}px`;
      containerElement.style.top = `${offsetTop}px`;

      // Update size to match drawing canvas
      updateCanvasSize();
      initialSyncDone = true;
    } catch (error) {
      console.error('Error syncing overlay with drawing canvas:', error);
    }
  }

  // Setup resize observer to watch the drawing canvas for size changes
  function setupResizeObserver() {
    if (!canvasRef || typeof ResizeObserver === 'undefined') return;

    // Clean up existing observer if it exists
    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    resizeObserver = new ResizeObserver((entries) => {
      // Throttle updates to improve performance
      if (Date.now() - lastUpdateTime < 16) { // ~60fps
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(syncWithDrawingCanvas, 16);
        return;
      }

      syncWithDrawingCanvas();
    });

    try {
      resizeObserver.observe(canvasRef);

      // Also observe parent element to detect position changes
      if (canvasRef.parentElement) {
        resizeObserver.observe(canvasRef.parentElement);
      }
    } catch (error) {
      console.error('Error setting up ResizeObserver:', error);
    }
  }

  // Setup window resize handler as a fallback
  function handleWindowResize() {
    // Throttle updates to improve performance
    if (Date.now() - lastUpdateTime < 16) { // ~60fps
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(syncWithDrawingCanvas, 16);
      return;
    }

    syncWithDrawingCanvas();
  }

  // Check if the element is actually visible in the DOM
  function isElementVisible(element) {
    if (!element) return false;

    // Check if element has zero size
    if (element.offsetWidth === 0 || element.offsetHeight === 0) {
      return false;
    }

    // Check visibility via computed style
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }

    return true;
  }

  // Force a sync after a slight delay (useful for components that might render late)
  function deferredSync() {
    setTimeout(() => {
      if (canvasRef && overlayCanvas && isElementVisible(canvasRef) && !initialSyncDone) {
        syncWithDrawingCanvas();
      }
    }, 100);
  }

  // Initialize canvas when mounted
  onMount(() => {
    initFabricCanvas();

    // Setup resize observers and listeners
    setupResizeObserver();
    window.addEventListener('resize', handleWindowResize);

    // Initial sync with drawing canvas
    syncWithDrawingCanvas();

    // Additional deferred sync to catch late renders
    deferredSync();
  });

  // Cleanup on destroy
  onDestroy(() => {
    if (fabricCanvas) {
      fabricCanvas.dispose();
    }

    // Clean up resize observers and listeners
    if (resizeObserver) {
      try {
        if (canvasRef) resizeObserver.unobserve(canvasRef);
        if (canvasRef && canvasRef.parentElement) resizeObserver.unobserve(canvasRef.parentElement);
        resizeObserver.disconnect();
      } catch (error) {
        console.error('Error cleaning up ResizeObserver:', error);
      }
    }

    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }

    window.removeEventListener('resize', handleWindowResize);
  });

  // Watch for changes that require re-rendering
  $: if (initialized && (width || height)) {
    updateCanvasSize();
  }

  $: if (initialized && (detectedObjects || strokes)) {
    renderStrokes();
  }

  $: if (initialized && visible !== undefined) {
    toggleVisibility();
  }

  // Re-sync when canvas reference changes
  $: if (canvasRef && initialized) {
    syncWithDrawingCanvas();
    setupResizeObserver();
  }

  // Re-initialize if canvas reference changes
  afterUpdate(() => {
    if (overlayCanvas && !initialized) {
      initFabricCanvas();
    }

    // Attempt to sync again if not already done
    if (canvasRef && overlayCanvas && !initialSyncDone) {
      deferredSync();
    }
  });
</script>

<div
  bind:this={containerElement}
  class="stroke-overlay-container"
  style="position: absolute; top: 0; left: 0; width: {width}px; height: {height}px; pointer-events: none; z-index: 11; overflow: hidden;"
>
  <canvas
    bind:this={overlayCanvas}
    width={width}
    height={height}
    style="position: absolute; top: 0; left: 0; pointer-events: none;"
  ></canvas>
</div>

<style>
  .stroke-overlay-container {
    overflow: hidden;
    position: absolute;
  }
</style>
