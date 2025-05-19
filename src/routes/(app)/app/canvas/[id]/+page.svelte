<script lang="ts">
  // @ts-nocheck
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/appStore';
  import { getPage } from '$lib/supabase/pages';
  import { TOOL_SELECT } from '$lib/types';
  import { afterNavigate, disableScrollHandling } from '$app/navigation';
  import { fade, scale } from 'svelte/transition';
  import { getStroke } from 'perfect-freehand';
  import { getSvgPathFromStroke } from '$lib/utils/drawingUtils.js';
  import VerticalSlider from '$lib/components/VerticalSlider.svelte';
  import {
    fabricCanvas,
    currentFabricObject,
    fabricObjects,
    isEraserMode,
    fabricCanvasState,
    gptImagePrompt,
    gptEditPrompt,
    generatedImageUrl,
    generatedByModel,
    isGenerating,
    editedImageUrl,
    editedByModel,
    isEditing,
    analysisOptions,
    strokeOptions,
    isApplePencilActive,
    selectedTool
  } from '$lib/stores/canvasStore';

  import Toolbar from '$lib/components/Toolbar.svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import Canvas from '$lib/components/Canvas.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { selectionStore, updateSelection } from '$lib/stores/selectionStore';

  let pageData;
  let loading = true;
  let error = '';
  let isDrawingMode = false;
  let saving = false;
  let saveStatus = 'saved';
  let pageId;
  let unsubscribe = () => {};
  let canvasComponent;
  let zoom = 1; // Add zoom state

  // Add variables for selected object information
  let selectedObjectType = null;
  let selectedObjectId = null;

  // Add state for selected objects
  let selectedObject = null;
  let selectedObjects = [];

  // Canvas references
  let fabricCanvasElement: HTMLCanvasElement;
  let drawingCanvas: HTMLCanvasElement;
  let drawingCtx: CanvasRenderingContext2D;
  let fabric: any; // Fabric.js instance

  // State variables
  let isDrawing = false;
  let currentPath: any = null;
  let currentPoints: any[] = [];
  let pointTimes: number[] = [];
  let canvasWidth = 800;
  let canvasHeight = 600;
  let canvasScale = 1;
  let additionalContext = '';

  // Subscribe to store changes
  $: strokeColor = $strokeOptions.color;
  $: strokeSize = $strokeOptions.size;
  $: strokeOpacity = $strokeOptions.opacity;

  // Add local variable for tool state
  let currentTool;
  selectedTool.subscribe(value => {
    currentTool = value;
  });

  // This function loads the page data based on the current pageId
  async function loadPageData(id) {
    if (!id) return;

    loading = true;
    error = '';

    try {
      const { data, error: pageError } = await getPage(id);

      if (pageError) {
        console.error('Error loading page:', pageError);
        error = pageError.message;
        return;
      }

      if (!data) {
        error = 'Page not found';
        return;
      }

      // Verify this is a canvas page
      if (data.type !== 'canvas') {
        error = 'This is not a canvas page';
        return;
      }

      // Initialize default content if needed
      if (!data.content) {
        data.content = { objects: [], drawings: [] };
      }

      pageData = data;
    } catch (err) {
      console.error('Unexpected error loading page:', err);
      error = err instanceof Error ? err.message : 'Failed to load page';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    try {
      loading = true;
      error = '';

      if (!$user) {
        goto('/');
        return;
      }

      // Set the page ID from the URL parameter
      pageId = $page.params.id;

      // Get page data from database
      const { data, error: pageError } = await getPage($page.params.id);

      if (pageError) {
        error = pageError.message;
        return;
      }

      if (!data) {
        error = 'Page not found';
        return;
      }

      // Verify the page belongs to the current user
      if (data.user_id !== $user.id) {
        error = 'You do not have permission to view this page';
        return;
      }

      // Validate that this is a canvas page
      if (data.type !== 'canvas') {
        goto(`/app/${data.type}/${data.id}`);
        return;
      }

      // Update local page data
      pageData = data;

      // Generate a thumbnail if one doesn't exist yet
      setTimeout(() => {
        if (canvasComponent && canvasComponent.generateThumbnail &&
           (!pageData.thumbnail_url || pageData.thumbnail_url === '')) {
          console.log('Generating initial thumbnail for canvas');
          canvasComponent.generateThumbnail();
        }
      }, 5000); // Wait 5 seconds for canvas to fully load

      // Update Panel props
      updatePanelProps();

      // Initialize Fabric.js
      fabric = (window as any).fabric;

      if (!fabric) {
        console.error('Fabric.js not loaded');
        return;
      }

      // Initialize Fabric.js canvas
      const canvas = new fabric.Canvas(fabricCanvasElement, {
        isDrawingMode: false,
        selection: true,
        width: canvasWidth,
        height: canvasHeight
      });

      // Store the canvas instance
      fabricCanvas.set(canvas);

      // Initialize drawing canvas
      if (drawingCanvas) {
        drawingCtx = drawingCanvas.getContext('2d');
        drawingCanvas.width = canvasWidth;
        drawingCanvas.height = canvasHeight;
      }

      // Initialize eraser brush
      const eraserBrush = new fabric.EraserBrush(canvas);
      eraserBrush.width = 20;
      canvas.eraserBrush = eraserBrush;

      // Set up event handlers
      setupEventHandlers(canvas);

      // Handle tool changes
      selectedTool.subscribe((tool) => {
        if (!canvas) return;

        switch (tool) {
          case 'pen':
            canvas.isDrawingMode = false;
            break;
          case 'eraser':
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush = canvas.eraserBrush;
            break;
          case 'select':
            canvas.isDrawingMode = false;
            break;
        }
      });

    } catch (err) {
      if (err instanceof Error) {
        error = err.message;
      }
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
  });

  // This runs after navigation, including when params change but component stays the same
  afterNavigate(({ from, to }) => {
    if (from && to && from.route.id === to.route.id && from.params?.id !== to.params?.id) {
      const newPageId = to.params?.id;
      if (newPageId && newPageId !== pageId) {
        pageId = newPageId;
        loadPageData(pageId);
      }
    }

    // Disable scroll handling to prevent jumping
    disableScrollHandling();
  });

  function handleSaving(isSaving) {
    saving = isSaving;
  }

  function handleSaveStatus(status) {
    saveStatus = status;
  }

  function handleToolChange(tool) {
    selectedTool.set(tool);
    isDrawingMode = tool === 'pen';
  }

  function handleGenerateThumbnail() {
    if (canvasComponent && typeof canvasComponent.generateThumbnail === 'function') {
      console.log('Manually generating thumbnail');
      canvasComponent.generateThumbnail();
    }
  }

  // Add zoom control handlers
  function handleZoomIn() {
    if (canvasComponent && typeof canvasComponent.zoomIn === 'function') {
      console.log('Zooming in');
      canvasComponent.zoomIn();
      // Update local zoom state to reflect change in Canvas component
      if (canvasComponent.zoom) {
        zoom = canvasComponent.zoom;
      }
    }
  }

  function handleZoomOut() {
    if (canvasComponent && typeof canvasComponent.zoomOut === 'function') {
      console.log('Zooming out');
      canvasComponent.zoomOut();
      // Update local zoom state to reflect change in Canvas component
      if (canvasComponent.zoom) {
        zoom = canvasComponent.zoom;
      }
    }
  }

  function handleResetZoom() {
    if (canvasComponent && typeof canvasComponent.resetZoom === 'function') {
      console.log('Resetting zoom');
      canvasComponent.resetZoom();
      // Update local zoom state to reflect change in Canvas component
      zoom = 1;
    }
  }

  // Additional reactive statement to ensure canvasComponent is properly detected
  $: {
    if (canvasComponent) {
      console.log('Canvas component is ready');
    }
  }

  // Add a reactive statement to ensure tool changes propagate to the Canvas
  $: if (canvasComponent?.setTool && selectedTool) {
    console.log('Parent: Updating canvas tool to:', selectedTool);
    try {
      canvasComponent.setTool(selectedTool);
    } catch (err) {
      console.warn('Error setting tool:', err);
    }
  }

  // Ensure zoom always starts at 100% when page loads, but only after canvas is ready
  $: if (pageData && canvasComponent) {
    // Wait for the canvas component to be fully mounted
    setTimeout(() => {
      if (!canvasComponent?.resetZoom) return;

      try {
        // Set initial zoom and center view
        zoom = 1;
        canvasComponent.resetZoom();
      } catch (err) {
        console.warn('Error resetting zoom, canvas might not be ready yet:', err);
      }
    }, 800); // Increased delay to ensure canvas is mounted and initialized
  }

  // Add handler for selection changes
  function handleSelectionChange(event) {
    const { object, objects, type } = event.detail;
    console.log('Canvas page received selectionChange event:', { type, objectCount: objects?.length || 0 });

    // Update local state
    selectedObject = object;
    selectedObjectType = type;
    selectedObjects = objects || [];

    console.log('Updated selection state:', { selectedObjectType, objectsCount: selectedObjects.length });

    // Update selection store instead of directly updating Panel
    updateSelection({
      selectedObject: object,
      selectedObjectType: type,
      selectedObjects: objects || [],
      currentPageId: pageId
    });
  }

  // Function to update Panel props
  function updatePanelProps() {
    const parentLayout = document.querySelector('div.app-layout');
    if (!parentLayout) {
      console.warn('Cannot find app-layout to update Panel props');
      return;
    }

    const panelElements = parentLayout.querySelectorAll('aside.panel');
    if (panelElements.length === 0) {
      console.warn('Cannot find Panel element');
      return;
    }

    // Find the Svelte component
    const panel = panelElements[0].__svelte_component__;
    if (!panel) {
      console.warn('Panel Svelte component not found');
      return;
    }

    console.log('Updating Panel with:', {
      selectedObject,
      selectedObjectType,
      selectedObjects,
      currentPageId: $page.params.id
    });

    panel.$set({
      selectedObject,
      selectedObjectType,
      selectedObjects,
      currentPageId: $page.params.id
    });
  }

  function setupEventHandlers(canvas: any) {
    // Drawing canvas event handlers
    drawingCanvas.addEventListener('pointerdown', onPointerDown);
    drawingCanvas.addEventListener('pointermove', onPointerMove);
    drawingCanvas.addEventListener('pointerup', onPointerUp);
    drawingCanvas.addEventListener('pointerleave', onPointerUp);

    // Fabric.js canvas event handlers
    canvas.on('path:created', onPathCreated);
    canvas.on('selection:created', onSelectionCreated);
    canvas.on('selection:updated', onSelectionUpdated);
    canvas.on('selection:cleared', onSelectionCleared);
    canvas.on('erasing:end', onErasingEnd);
  }

  function onPointerDown(e: PointerEvent) {
    if (currentTool !== 'pen') return;

    isDrawing = true;
    const point = getPointerPosition(e);
    currentPoints = [point];
    pointTimes = [Date.now()];

    // Start new path
    currentPath = {
      points: currentPoints,
      pressure: e.pressure,
      thinning: $strokeOptions.thinning,
      smoothing: $strokeOptions.smoothing,
      streamline: $strokeOptions.streamline,
      easing: $strokeOptions.easing,
      start: $strokeOptions.start,
      end: $strokeOptions.end
    };

    drawingCanvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDrawing || currentTool !== 'pen') return;

    const point = getPointerPosition(e);
    currentPoints.push(point);
    pointTimes.push(Date.now());

    // Update current path
    if (currentPath) {
      currentPath.points = currentPoints;
      renderCurrentStroke();
    }
  }

  function onPointerUp(e: PointerEvent) {
    if (!isDrawing || currentTool !== 'pen') return;

    isDrawing = false;
    drawingCanvas.releasePointerCapture(e.pointerId);

    // Convert the current stroke to a Fabric.js path
    if (currentPath && currentPath.points.length > 1) {
      const perfectStroke = getStroke(currentPath.points.map(p => [p.x, p.y, p.pressure]), {
        size: strokeSize,
        thinning: currentPath.thinning,
        smoothing: currentPath.smoothing,
        streamline: currentPath.streamline,
        easing: currentPath.easing,
        start: currentPath.start,
        end: currentPath.end
      });

      const pathData = getSvgPathFromStroke(perfectStroke);

      if (pathData) {
        const fabricPath = new fabric.Path(pathData, {
          fill: strokeColor,
          opacity: strokeOpacity,
          erasable: true
        });

        $fabricCanvas.add(fabricPath);
        fabricObjects.update(objects => [...objects, fabricPath]);
      }
    }

    // Clear the drawing canvas
    clearDrawingCanvas();
    currentPath = null;
    currentPoints = [];
  }

  function onPathCreated(e: any) {
    const path = e.path;
    fabricObjects.update(objects => [...objects, path]);
  }

  function onSelectionCreated(e: any) {
    currentFabricObject.set(e.selected[0]);
  }

  function onSelectionUpdated(e: any) {
    currentFabricObject.set(e.selected[0]);
  }

  function onSelectionCleared() {
    currentFabricObject.set(null);
  }

  function onErasingEnd({ targets, drawables }: any) {
    // Update objects after erasing
    fabricObjects.update(objects =>
      objects.filter(obj => !targets.includes(obj))
    );
  }

  function getPointerPosition(e: PointerEvent) {
    const rect = drawingCanvas.getBoundingClientRect();
    const scaleX = drawingCanvas.width / rect.width;
    const scaleY = drawingCanvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      pressure: e.pressure || 0.5
    };
  }

  function renderCurrentStroke() {
    if (!currentPath || !drawingCtx) return;

    // Clear the drawing canvas
    clearDrawingCanvas();

    // Generate the stroke with perfect-freehand
    const perfectStroke = getStroke(currentPath.points.map(p => [p.x, p.y, p.pressure]), {
      size: strokeSize,
      thinning: currentPath.thinning,
      smoothing: currentPath.smoothing,
      streamline: currentPath.streamline,
      easing: currentPath.easing,
      start: currentPath.start,
      end: currentPath.end
    });

    // Draw the stroke
    const pathData = getSvgPathFromStroke(perfectStroke);
    if (pathData) {
      const path = new Path2D(pathData);
      drawingCtx.fillStyle = strokeColor;
      drawingCtx.globalAlpha = strokeOpacity;
      drawingCtx.fill(path);
      drawingCtx.globalAlpha = 1;
    }
  }

  function clearDrawingCanvas() {
    if (!drawingCtx) return;
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  }

  function clearCanvas() {
    if ($fabricCanvas) {
      $fabricCanvas.clear();
      fabricObjects.set([]);
    }
    clearDrawingCanvas();
  }

  async function generateImage() {
    // Implementation of image generation
    // This would be similar to the original implementation
  }
</script>

<svelte:head>
  <title>{pageData ? pageData.title : 'Canvas'} - Daydream</title>
  <link rel="icon" href="/square.png" />
</svelte:head>

<div class="editor-layout">
  <div class="editor-main">
    {#if loading}
      <div class="loading-container">
        <p>Loading canvas...</p>
      </div>
    {:else if error}
      <div class="error-container">
        <p>Error: {error}</p>
        <button on:click={() => goto('/app')}>Back to Home</button>
      </div>
    {:else}
      <TitleBar
        page={pageData}
        saving={saving}
        saveStatus={saveStatus}
        selectedTool={selectedTool}
        isDrawingMode={isDrawingMode}
        selectedObjectType={selectedObjectType}
        selectedObjectId={selectedObjectId}
        zoom={zoom}
        on:generateThumbnail={handleGenerateThumbnail}
        on:zoomIn={handleZoomIn}
        on:zoomOut={handleZoomOut}
        on:resetZoom={handleResetZoom}
      />

      <div class="workspace">
        <div class="canvas-area">
          {#key pageData.id}
          <Canvas
            pageId={pageData.id}
            content={pageData.content}
            bind:selectedTool={currentTool}
            bind:isDrawingMode={isDrawingMode}
            bind:selectedObjectType={selectedObjectType}
            bind:selectedObjectId={selectedObjectId}
            bind:zoom={zoom}
            onSaving={handleSaving}
            onSaveStatus={handleSaveStatus}
            bind:this={canvasComponent}
            on:selectionChange={handleSelectionChange}
          />
          {/key}
        </div>

        <div class="draw-demo-container">
          <header class="demo-header">
            <div class="bar">
              <div class="context-input-container">
                <input
                  id="context-input"
                  type="text"
                  bind:value={additionalContext}
                  placeholder="What are you drawing?"
                  class="context-input"
                />
                <button
                  class="generate-button"
                  on:click={generateImage}
                  disabled={$isGenerating || $fabricObjects.length === 0}
                >
                  <span class="material-icons">arrow_forward</span>
                  <h3>{$isGenerating ? 'Creating...' : 'Create'}</h3>
                </button>
              </div>
            </div>
          </header>

          <div class="canvas-container">
            <div class="toolbars-wrapper">
              <div class="vertical-toolbar tool-selector-toolbar">
                <button
                  class="tool-button"
                  class:active={currentTool === 'pen'}
                  on:click={() => selectedTool.set('pen')}
                  title="Pen Tool"
                >
                  <span class="material-icons">edit</span>
                </button>
                <button
                  class="tool-button"
                  class:active={currentTool === 'eraser'}
                  on:click={() => selectedTool.set('eraser')}
                  title="Eraser Tool"
                >
                  <span class="material-icons">layers_clear</span>
                </button>
                <button
                  class="tool-button"
                  class:active={currentTool === 'select'}
                  on:click={() => selectedTool.set('select')}
                  title="Select Tool"
                >
                  <span class="material-icons">touch_app</span>
                </button>
              </div>

              <div class="vertical-toolbar options-toolbar">
                <div class="tools-group">
                  <div class="tool-group">
                    <input
                      type="color"
                      bind:value={strokeColor}
                      on:change={() => {
                        strokeOptions.update(opts => ({...opts, color: strokeColor}));
                      }}
                    />
                  </div>

                  <div class="tool-group">
                    <VerticalSlider
                      min={1}
                      max={30}
                      step={0.5}
                      bind:value={strokeSize}
                      color="#6355FF"
                      height="120px"
                      onChange={() => {
                        strokeOptions.update(opts => ({...opts, size: strokeSize}));
                      }}
                      showValue={true}
                    />
                  </div>

                  <div class="tool-group">
                    <VerticalSlider
                      min={0.1}
                      max={1}
                      step={0.1}
                      bind:value={strokeOpacity}
                      color="#6355FF"
                      height="120px"
                      onChange={() => {
                        strokeOptions.update(opts => ({...opts, opacity: strokeOpacity}));
                      }}
                      showValue={true}
                    />
                  </div>

                  <button class="tool-button clear-button" on:click={clearCanvas}>
                    <span class="material-icons">delete_outline</span>
                  </button>
                </div>
              </div>
            </div>

            <div class="canvas-wrapper input-canvas">
              <!-- Fabric.js canvas -->
              <canvas
                bind:this={fabricCanvasElement}
                class="fabric-canvas"
              ></canvas>

              <!-- Perfect Freehand drawing canvas -->
              <canvas
                bind:this={drawingCanvas}
                class="drawing-canvas"
                style="position: absolute; top: 0; left: 0; pointer-events: {$currentTool === 'pen' ? 'auto' : 'none'};"
              ></canvas>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .editor-layout {
    flex: 1;
    height: 100%;
    width: 100%;
    overflow: hidden;
    display: flex;
  }

  .editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .toolbar{
    position: absolute;
    z-index: 2;
    left: 0;
    bottom: 0;
    margin: 12px;
    width: 100vw;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .workspace {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
  }

  .loading-container,
  .error-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 2rem;
    text-align: center;

    p {
      margin-bottom: 1rem;
      font-size: 1.1rem;
    }

    button {
      padding: 0.5rem 1rem;
      background-color: $primary-color;
      color: white;
      border: none;
      border-radius: $border-radius-sm;
      cursor: pointer;
    }
  }

  .error-container {
    p {
      color: $error-color;
    }
  }

  .canvas-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .canvas-wrapper {
    position: relative;

    .fabric-canvas {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 1;
    }

    .drawing-canvas {
      position: absolute;
      top: 0;
      left: 0;
      z-index: 2;
    }
  }
</style>