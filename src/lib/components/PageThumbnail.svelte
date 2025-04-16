<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Page } from '$lib/types';
  // Import fabric - we know it's already installed from the package.json
  import { fabric } from 'fabric';

  export let page: Page;
  export let size: 'small' | 'medium' | 'large' = 'medium';

  let canvasElement: HTMLCanvasElement;
  let fabricCanvas: fabric.StaticCanvas | null = null;
  let loading = true;
  let error = false;

  // Size mapping for different thumbnail sizes
  const sizeMap = {
    small: { width: 160, height: 90 },
    medium: { width: 240, height: 135 },
    large: { width: 320, height: 180 }
  };

  // Get dimensions based on the size prop
  $: dimensions = sizeMap[size];

  onMount(() => {
    initializeCanvas();
  });

  onDestroy(() => {
    // Clean up Fabric.js canvas
    if (fabricCanvas) {
      fabricCanvas.dispose();
      fabricCanvas = null;
    }
  });

  async function initializeCanvas() {
    if (!canvasElement) return;

    try {
      // Create a static fabric canvas (non-interactive)
      fabricCanvas = new fabric.StaticCanvas(canvasElement, {
        width: dimensions.width,
        height: dimensions.height,
        renderOnAddRemove: false,
        backgroundColor: '#ffffff'
      });

      // Set pixel ratio for high-res displays
      const dpr = window.devicePixelRatio || 1;
      if (fabricCanvas) {
        fabricCanvas.setDimensions({
          width: dimensions.width * dpr,
          height: dimensions.height * dpr
        }, { cssOnly: false });
        fabricCanvas.setZoom(dpr);
      }

      // Load the page content
      await loadPageContent();

      // Hide loading indicator
      loading = false;
    } catch (err) {
      console.error('Error initializing thumbnail canvas:', err);
      error = true;
      loading = false;
    }
  }

  async function loadPageContent() {
    if (!fabricCanvas || !page) return;

    try {
      if (page.type === 'canvas') {
        await loadCanvasContent();
      } else if (page.type === 'drawing') {
        await loadDrawingContent();
      }

      // Request a render
      fabricCanvas.renderAll();
    } catch (err) {
      console.error('Error loading page content for thumbnail:', err);
      renderFallbackContent();
    }
  }

  async function loadCanvasContent() {
    if (!fabricCanvas || !page || page.type !== 'canvas') return;

    try {
      // If we have content, parse and render it
      if (page.content && typeof page.content === 'object') {
        // Extract objects from content
        const objects = page.content.objects || [];

        if (objects.length > 0) {
          // Calculate the bounds of all objects to determine scaling
          const bounds = calculateObjectsBounds(objects);

          // Add padding to the bounds (10%)
          const padding = 0.1;
          const paddedWidth = bounds.width * (1 + padding);
          const paddedHeight = bounds.height * (1 + padding);

          // Calculate scale to fit everything in the thumbnail
          const scaleX = dimensions.width / paddedWidth;
          const scaleY = dimensions.height / paddedHeight;
          const scale = Math.min(scaleX, scaleY);

          // Set the canvas zoom to fit everything
          fabricCanvas.setZoom(scale);

          // Calculate offsets to center the content
          const offsetX = (dimensions.width / scale - bounds.width) / 2 - bounds.left;
          const offsetY = (dimensions.height / scale - bounds.height) / 2 - bounds.top;

          // Set viewport transform for centering
          fabricCanvas.setViewportTransform([
            scale, 0, 0, scale,
            offsetX * scale, offsetY * scale
          ]);

          // Load the objects
          await loadFabricObjects(objects);
          return;
        }
      }

      // If no content or empty objects array, render fallback
      renderFallbackContent();
    } catch (err) {
      console.error('Error loading canvas content for thumbnail:', err);
      renderFallbackContent();
    }
  }

  async function loadFabricObjects(objects: any[]) {
    if (!fabricCanvas) return;

    try {
      // Create a promise that resolves when objects are loaded
      return new Promise<void>((resolve) => {
        if (fabricCanvas) {
          // Use fabric's loadFromJSON method with our objects
          // We create a minimal JSON structure with just the objects
          fabricCanvas.loadFromJSON({ objects: objects }, () => {
            if (fabricCanvas) {
              // Make all objects non-interactive
              fabricCanvas.forEachObject((obj: fabric.Object) => {
                obj.selectable = false;
                obj.evented = false;
              });

              // Render the canvas
              fabricCanvas.renderAll();
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    } catch (err) {
      console.error('Error loading fabric objects:', err);
      throw err;
    }
  }

  async function loadDrawingContent() {
    if (!fabricCanvas || !page || page.type !== 'drawing') return;

    try {
      // If we have strokes in the drawing content
      if (page.content && page.content.strokes && page.content.strokes.length > 0) {
        const strokes = page.content.strokes;

        // Calculate bounds of all stroke points
        const bounds = calculateStrokesBounds(strokes);

        // Add padding to the bounds (10%)
        const padding = 0.1;
        const paddedWidth = bounds.width * (1 + padding);
        const paddedHeight = bounds.height * (1 + padding);

        // Calculate scale to fit everything in the thumbnail
        const scaleX = dimensions.width / paddedWidth;
        const scaleY = dimensions.height / paddedHeight;
        const scale = Math.min(scaleX, scaleY);

        // Set the canvas zoom to fit everything
        fabricCanvas.setZoom(scale);

        // Calculate offsets to center the content
        const offsetX = (dimensions.width / scale - bounds.width) / 2 - bounds.minX;
        const offsetY = (dimensions.height / scale - bounds.height) / 2 - bounds.minY;

        // Set viewport transform for centering
        fabricCanvas.setViewportTransform([
          scale, 0, 0, scale,
          offsetX * scale, offsetY * scale
        ]);

        // Render each stroke as a fabric path
        for (const stroke of strokes) {
          if (stroke.points.length < 2) continue;

          // Create a fabric path from stroke points
          const pathData = createSvgPathFromStroke(stroke.points);

          // Set fill and opacity based on stroke properties
          const path = new fabric.Path(pathData, {
            fill: stroke.tool === 'highlighter' ? 'transparent' : stroke.color,
            stroke: stroke.color,
            strokeWidth: stroke.size,
            opacity: stroke.tool === 'highlighter' ? 0.4 : stroke.opacity,
            strokeLineCap: 'round',
            strokeLineJoin: 'round',
            selectable: false,
            evented: false
          });

          // Add the path to canvas
          fabricCanvas.add(path);
        }

        return;
      }

      // If no content or empty strokes array, render fallback
      renderFallbackContent();
    } catch (err) {
      console.error('Error loading drawing content for thumbnail:', err);
      renderFallbackContent();
    }
  }

  function calculateObjectsBounds(objects: any[]) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;

    objects.forEach(obj => {
      // Get object bounds considering rotation, scale and position
      const objLeft = obj.left - (obj.width * obj.scaleX) / 2;
      const objTop = obj.top - (obj.height * obj.scaleY) / 2;
      const objRight = obj.left + (obj.width * obj.scaleX) / 2;
      const objBottom = obj.top + (obj.height * obj.scaleY) / 2;

      left = Math.min(left, objLeft);
      top = Math.min(top, objTop);
      right = Math.max(right, objRight);
      bottom = Math.max(bottom, objBottom);
    });

    // If no objects or invalid bounds, use default
    if (left === Infinity || top === Infinity || right === -Infinity || bottom === -Infinity) {
      return {
        left: 0,
        top: 0,
        width: dimensions.width,
        height: dimensions.height
      };
    }

    return {
      left,
      top,
      width: right - left,
      height: bottom - top
    };
  }

  function calculateStrokesBounds(strokes: any[]) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    strokes.forEach(stroke => {
      stroke.points.forEach((point: {x: number, y: number}) => {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      });
    });

    // If no strokes or invalid bounds, use default
    if (minX === Infinity || minY === Infinity || maxX === -Infinity || maxY === -Infinity) {
      return {
        minX: 0,
        minY: 0,
        width: dimensions.width,
        height: dimensions.height
      };
    }

    return {
      minX,
      minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  function createSvgPathFromStroke(points: Array<{x: number, y: number}>) {
    if (points.length < 2) return '';

    let path = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }

    return path;
  }

  function renderFallbackContent() {
    if (!fabricCanvas) return;

    // Clear the canvas
    fabricCanvas.clear();

    // Set white background
    fabricCanvas.setBackgroundColor('#f5f5f5', fabricCanvas.renderAll.bind(fabricCanvas));

    // Create centered text
    const titleText = new fabric.Text(page.title || 'Untitled', {
      left: dimensions.width / 2,
      top: dimensions.height / 2 + 20,
      fontFamily: 'Arial',
      fontSize: 14,
      fill: '#666666',
      textAlign: 'center',
      originX: 'center',
      originY: 'center'
    });

    // Create an icon based on page type
    const iconText = page.type === 'canvas' ? 'dashboard' : 'edit';
    const icon = new fabric.Text(iconText, {
      left: dimensions.width / 2,
      top: dimensions.height / 2 - 15,
      fontFamily: 'Material Icons',
      fontSize: 30,
      fill: '#cccccc',
      textAlign: 'center',
      originX: 'center',
      originY: 'center'
    });

    // Add the elements to the canvas
    fabricCanvas.add(icon, titleText);
    fabricCanvas.renderAll();
  }
</script>

<div class="thumbnail-container" style="width: {dimensions.width}px; height: {dimensions.height}px;">
  {#if loading}
    <div class="thumbnail-loading">
      <div class="spinner"></div>
    </div>
  {:else if error}
    <div class="thumbnail-placeholder">
      <div class="placeholder-icon">
        <span class="material-icons">{page.type === 'canvas' ? 'dashboard' : 'edit'}</span>
      </div>
      <div class="placeholder-label">{page.title || 'Untitled'}</div>
    </div>
  {/if}

  <canvas
    bind:this={canvasElement}
    width={dimensions.width}
    height={dimensions.height}
    class="thumbnail-canvas"
  ></canvas>
</div>

<style lang="scss">
  .thumbnail-container {
    position: relative;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    transition: transform 0.2s ease, box-shadow 0.2s ease;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
  }

  .thumbnail-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .thumbnail-loading {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: rgba(245, 245, 245, 0.9);
    z-index: 2;

    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid rgba(0, 0, 0, 0.1);
      border-top-color: var(--primary-color, #6355FF);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  }

  .thumbnail-placeholder {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background-color: #f5f5f5;
    z-index: 1;

    .placeholder-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;

      .material-icons {
        font-size: 32px;
        color: #cccccc;
      }
    }

    .placeholder-label {
      font-size: 12px;
      color: #666666;
      text-align: center;
      padding: 0 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
  }
</style>