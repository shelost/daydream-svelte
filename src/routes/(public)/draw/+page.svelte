<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { Tool, Stroke, StrokePoint } from '$lib/types';
  import { getStroke } from 'perfect-freehand';

  import { getSvgPathFromStroke, calculatePressureFromVelocity, calculateMultiStrokeBoundingBox, findRelatedStrokes, normalizeBoundingBox } from '$lib/utils/drawingUtils.js';
  import VerticalSlider from '$lib/components/VerticalSlider.svelte';
  import AIOverlay from '$lib/components/AIOverlay.svelte';
  import StrokeOverlay from '$lib/components/StrokeOverlay.svelte';
  import TFOverlay from '$lib/components/TFOverlay.svelte';
  import ShapeRecognitionButton from '$lib/components/ShapeRecognitionButton.svelte';
  import LayerPanel from '$lib/components/LayerPanel.svelte';
  import {
    selectedTool,
    strokeOptions,
    analysisOptions,
    gptImagePrompt,
    gptEditPrompt,
    generatedImageUrl,
    generatedByModel,
    editedImageUrl,
    editedByModel,
    isGenerating,
    isEditing,
    selectedModel,
    // Layer-related imports
    layers,
    activeLayerId,
    activeLayer,
    showLayerPanel
  } from '$lib/stores/drawStore';

  // Canvas variables
  let inputCanvas: HTMLCanvasElement;
  let canvasWrapper: HTMLDivElement;
  let canvasWidth = 1200;
  let canvasHeight = 900;
  let initialCanvasWidth = canvasWidth;
  let initialCanvasHeight = canvasHeight;
  let canvasScale = 1;
  let isPointerDown = false;
  let inputCtx: CanvasRenderingContext2D;
  let strokeColor = "#000000";
  let strokeSize = 15;
  let activeStroke: Stroke | null = null;
  let hasPressureSupport = false;
  let panPosition = { x: 0, y: 0 };
  let lastPointerPosition = { x: 0, y: 0 };

  // Stored strokes
  type StrokeWithSVGPath = Stroke & { svgPath: string };
  type DrawingContent = {
    strokes: StrokeWithSVGPath[];
    width: number;
    height: number;
  };

  // Modified to work with layers
  let drawingContent: DrawingContent = {
    strokes: [],
    width: canvasWidth,
    height: canvasHeight
  };

  // ... (existing variables)

  function onWindowResize() {
    if (canvasWrapper) {
      const rect = canvasWrapper.getBoundingClientRect();
      const wrapperWidth = rect.width;
      const wrapperHeight = rect.height;

      // Let's adapt the canvas to fill the wrapper while maintaining aspect ratio
      const maxCanvasWidth = Math.max(800, wrapperWidth - 80);
      const maxCanvasHeight = Math.max(600, wrapperHeight - 80);

      const aspectRatio = initialCanvasWidth / initialCanvasHeight;

      if (maxCanvasWidth / aspectRatio <= maxCanvasHeight) {
        // Width is the constraint
        canvasWidth = maxCanvasWidth;
        canvasHeight = maxCanvasWidth / aspectRatio;
      } else {
        // Height is the constraint
        canvasHeight = maxCanvasHeight;
        canvasWidth = maxCanvasHeight * aspectRatio;
      }

      // We now know the size the canvas should be, but we don't actually resize the canvas element
      // Instead, we scale it with CSS to avoid blurry lines
      canvasScale = canvasWidth / initialCanvasWidth;

      if (inputCanvas) {
        inputCanvas.style.transform = `scale(${canvasScale})`;
        renderStrokes();
      }
    }
  }

  // Initialize canvas and context
  onMount(() => {
    console.log("Canvas component mounted");

    if (inputCanvas) {
      inputCtx = inputCanvas.getContext('2d')!;
      if (inputCtx) {
        // Set the canvas size once at the beginning
        inputCanvas.width = initialCanvasWidth;
        inputCanvas.height = initialCanvasHeight;

        // Clear the canvas
        inputCtx.fillStyle = "white";
        inputCtx.fillRect(0, 0, inputCanvas.width, inputCanvas.height);
      }
    }

    // Set up resize handling
    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    return () => {
      window.removeEventListener('resize', onWindowResize);
    };
  });

  // Updated function to handle pointer down events with layer support
  function onPointerDown(e: PointerEvent) {
    // No action if we're not in drawing mode
    if ($selectedTool !== 'pen') return;

    e.preventDefault();

    const rect = inputCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvasScale;
    const y = (e.clientY - rect.top) / canvasScale;

    isPointerDown = true;
    hasPressureSupport = e.pressure !== 0 && e.pressure !== 0.5;

    // Create a new active stroke
    activeStroke = {
      id: Math.random().toString(36).substring(2, 15),
      tool: $selectedTool,
      options: {...$strokeOptions},
      points: [{
        x,
        y,
        pressure: hasPressureSupport ? e.pressure : 0.5,
        timestamp: Date.now()
      }]
    };

    lastPointerPosition = { x, y };

    // Draw the initial point
    renderActiveStroke();
  }

  // Updated function to handle pointer move events
  function onPointerMove(e: PointerEvent) {
    if (!isPointerDown || !activeStroke) return;

    e.preventDefault();

    const rect = inputCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvasScale;
    const y = (e.clientY - rect.top) / canvasScale;

    // Calculate velocity for pressure simulation
    const timestamp = Date.now();
    const dx = x - lastPointerPosition.x;
    const dy = y - lastPointerPosition.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const lastTimestamp = activeStroke.points[activeStroke.points.length - 1].timestamp;
    const timeDelta = timestamp - lastTimestamp;
    const velocity = timeDelta > 0 ? distance / timeDelta : 0;

    // Only add points if they're a certain distance apart
    if (distance > 0.5) {
      // Add the point to the active stroke
      activeStroke.points.push({
        x,
        y,
        pressure: hasPressureSupport ? e.pressure : calculatePressureFromVelocity(velocity, 0.3, 5),
        timestamp
      });

      lastPointerPosition = { x, y };

      // Draw the updated stroke
      renderActiveStroke();
    }
  }

  // Updated function to handle pointer up events with layer support
  function onPointerUp(e: PointerEvent) {
    if (!isPointerDown || !activeStroke) return;

    e.preventDefault();
    isPointerDown = false;

    // Complete the stroke by adding the final point
    const rect = inputCanvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / canvasScale;
    const y = (e.clientY - rect.top) / canvasScale;

    if (activeStroke.points.length > 0) {
      activeStroke.points.push({
        x,
        y,
        pressure: hasPressureSupport ? e.pressure : 0.5,
        timestamp: Date.now()
      });
    }

    // Only add the stroke if it has at least 2 points
    if (activeStroke.points.length >= 2) {
      // Generate the SVG path for the stroke
      const perfectStroke = getStroke(activeStroke.points, {
        size: activeStroke.options.size,
        thinning: activeStroke.options.thinning,
        smoothing: activeStroke.options.smoothing,
        streamline: activeStroke.options.streamline,
        easing: activeStroke.options.easing,
        start: activeStroke.options.start,
        end: activeStroke.options.end
      });

      const svgPath = getSvgPathFromStroke(perfectStroke);

      // Add the completed stroke with SVG path to the active layer
      $layers = $layers.map(layer => {
        if (layer.id === $activeLayerId) {
          return {
            ...layer,
            strokes: [
              ...layer.strokes,
              {
                ...activeStroke,
                svgPath,
                color: strokeColor
              }
            ]
          };
        }
        return layer;
      });
    }

    // Reset active stroke
    activeStroke = null;

    // Render all strokes to update the canvas
    renderStrokes();
  }

  // Updated function to render the active stroke
  function renderActiveStroke() {
    if (!activeStroke || !inputCtx) return;

    // Clear the canvas for re-rendering
    renderStrokes();

    // Generate the perfect freehand stroke
    const perfectStroke = getStroke(activeStroke.points, {
      size: activeStroke.options.size,
      thinning: activeStroke.options.thinning,
      smoothing: activeStroke.options.smoothing,
      streamline: activeStroke.options.streamline,
      easing: activeStroke.options.easing,
      start: activeStroke.options.start,
      end: activeStroke.options.end
    });

    // Draw the stroke
    inputCtx.fillStyle = strokeColor;
    inputCtx.beginPath();

    // Use the SVG path data to create a path
    const svgPath = getSvgPathFromStroke(perfectStroke);
    const path = new Path2D(svgPath);
    inputCtx.fill(path);
  }

  // Updated function to render all strokes from all visible layers
  function renderStrokes() {
    if (!inputCtx) return;

    // Clear the canvas
    inputCtx.fillStyle = "white";
    inputCtx.fillRect(0, 0, inputCanvas.width, inputCanvas.height);

    // Get all visible layers
    const visibleLayers = $layers.filter(layer => layer.visible);

    // Render strokes from each visible layer
    visibleLayers.forEach(layer => {
      layer.strokes.forEach(stroke => {
        if (stroke.svgPath) {
          const path = new Path2D(stroke.svgPath);
          inputCtx.fillStyle = stroke.color || '#000';
          inputCtx.fill(path);
        }
      });
    });

    // Build flat list of all strokes for analysis
    drawingContent = {
      strokes: visibleLayers.flatMap(layer => layer.strokes),
      width: canvasWidth,
      height: canvasHeight
    };

    // Update the thumbnails for all layers
    // We'll rely on the LayerPanel component to handle this
  }

  // Updated clear canvas function with layer support
  function clearCanvas() {
    if (inputCtx) {
      // Clear only the active layer's strokes
      $layers = $layers.map(layer => {
        if (layer.id === $activeLayerId) {
          return {
            ...layer,
            strokes: []
          };
        }
        return layer;
      });

      renderStrokes();
    }
  }

  // Rest of the code stays largely the same...

  // Toggle layer panel
  function toggleLayerPanel() {
    $showLayerPanel = !$showLayerPanel;
  }

  // Keep tracking layer changes to update the canvas
  $: if ($layers || $activeLayerId) {
    // When layers or active layer changes, re-render
    if (inputCtx) {
      renderStrokes();
    }
  }

  // Function to collect all strokes before generating images
  function collectAllVisibleStrokes() {
    const visibleLayers = $layers.filter(layer => layer.visible);
    return {
      strokes: visibleLayers.flatMap(layer => layer.strokes),
      width: canvasWidth,
      height: canvasHeight
    };
  }

  // Updated function to generate image that uses all visible layers
  async function generateImage() {
    if (drawingContent.strokes.length === 0) {
      errorMessage = "Please draw something first!";
      setTimeout(() => { errorMessage = null; }, 3000);
      return;
    }

    console.log('Starting image generation with', drawingContent.strokes.length, 'strokes');
    console.log('Using model:', $selectedModel);
    if (additionalContext) {
      console.log('Additional context provided:', additionalContext);
    }

    // Always capture the canvas image first for preview
    imageData = inputCanvas.toDataURL('image/png');
    console.log('Canvas image captured for preview');

    // Collect all visible strokes
    const allVisibleStrokes = collectAllVisibleStrokes();

    isGenerating.set(true);
    isEditing.set(true);

    try {
      // Construct request payload
      const requestPayload = {
        drawingContent: allVisibleStrokes,
        imageData,
        prompt: prompt || "A clean, detailed image based on this sketch",
        additionalContext: additionalContext || "",
        aspectRatio: canvasWidth / canvasHeight
      };

      // The rest of the generateImage function remains the same
      // ...

    } catch (error) {
      console.error('Error generating images:', error);
      errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    } finally {
      isGenerating.set(false);
      isEditing.set(false);
    }
  }
</script>

<!-- HTML section with added layer panel and layer button -->
<div class="draw-page">
  <header>
    <div class="top-bar">
      <a href="/" class="logo-link">daydream</a>

      <div class = 'middle-content'>
        <input
          type="text"
          placeholder="Describe your image or give extra guidance..."
          bind:value={prompt}
          class="prompt-input"
        />

        <input
          type="text"
          placeholder="Additional details, style, etc."
          bind:value={additionalContext}
          class="prompt-input additional-context"
        />

        <button class="generate-button" on:click={generateImage} disabled={$isGenerating || $isEditing}>
          {#if $isGenerating || $isEditing}
            <div class="loader"></div>
            Creating...
          {:else}
            Create
          {/if}
        </button>

        <div class="dropdown">
          <div class="select-wrapper">
            <select id="model-selector" bind:value={$selectedModel}>
              <option value="gpt-image-1" selected> gpt-image-1 </option>
              <option value="flux-canny-pro"> flux-canny-pro </option>
              <option value="controlnet-scribble"> controlnet-scribble </option>
              <option value="stable-diffusion"> stable-diffusion </option>
              <option value="latent-consistency"> LCM (Fast) </option>
            </select>
            <span class="material-icons custom-caret">expand_more</span>
          </div>
        </div>
      </div>

      <div class="right-buttons">
        <button class="clear-button" on:click={clearCanvas}>
          <span class="material-icons">delete</span>
        </button>
        <button class="download-button" on:click={downloadCurrentCanvas}>
          <span class="material-icons">file_download</span>
        </button>
      </div>
    </div>

    {#if errorMessage}
    <div class="error-message" transition:fade={{ duration: 200 }}>
      <span class="material-icons">error_outline</span>
      {errorMessage}
    </div>
  {/if}
  </header>

  <div class="canvas-container">
    <div class="toolbars-wrapper">
      <!-- New Tool Selection Toolbar -->

      <div class="vertical-toolbar tool-selector-toolbar" style="display: none">
        <button
          class="tool-button"
          class:active={$selectedTool === 'pen'}
          on:click={() => selectedTool.set('pen')}
          title="Pen Tool"
        >
          <span class="material-icons">edit</span>
        </button>
        <button
          class="tool-button"
          class:active={$selectedTool === 'eraser'}
          on:click={() => selectedTool.set('eraser')}
          title="Eraser Tool"
        >
          <span class="material-icons">layers_clear</span>
        </button>
        <button
          class="tool-button"
          class:active={$selectedTool === 'select'}
          on:click={() => selectedTool.set('select')}
          title="Select Tool"
        >
          <span class="material-icons">touch_app</span>
        </button>
      </div>

      <!-- Existing Stroke Options Toolbar -->
      <div class="vertical-toolbar options-toolbar">
          <div class="tools-group">

            <div class="tool-group">
              <input
                type="color"
                bind:value={strokeColor}
                on:change={() => {
                  strokeOptions.update(opts => ({...opts, color: strokeColor}));
                  renderStrokes();
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
                  renderStrokes();
                }}
                showValue={true}
              />
            </div>

            <!-- Layer button -->
            <button
              class="tool-button layer-button"
              class:active={$showLayerPanel}
              on:click={toggleLayerPanel}
              title="Layer Panel"
            >
              <span class="material-icons">layers</span>
            </button>
          </div>

          <div class="tools-group">
            <button
              class="tool-button"
              on:click={toggleAIOverlay}
              class:active={showAIOverlay}
              title="Toggle AI Analysis Overlay"
            >
              <span class="material-icons">auto_awesome</span>
            </button>

            <button
              class="tool-button"
              on:click={toggleBoundingBoxes}
              class:active={showBoundingBoxes}
              title="Toggle Bounding Boxes"
            >
              <span class="material-icons">filter_center_focus</span>
            </button>

            <button
              class="tool-button"
              on:click={toggleStrokeDebug}
              class:active={showStrokeDebug}
              title="Toggle Stroke Analysis"
            >
              <span class="material-icons">gesture</span>
            </button>

            <button
              class="tool-button"
              on:click={toggleTFOverlay}
              class:active={showTFOverlay}
              title="Toggle TensorFlow Overlay"
            >
              <span class="material-icons">view_in_ar</span>
            </button>
          </div>

      </div>
    </div>

    <!-- Draggable canvas container -->
    <div class="canvas-area" bind:this={canvasWrapper}>
      <canvas
        id="input-canvas"
        bind:this={inputCanvas}
        on:pointerdown={onPointerDown}
        on:pointermove={onPointerMove}
        on:pointerup={onPointerUp}
        on:pointercancel={onPointerUp}
        on:pointerleave={onPointerUp}
        touch-action="none"
      ></canvas>

      {#if showAIOverlay && lastAPIResponse}
        <AIOverlay
          response={lastAPIResponse}
          scale={canvasScale}
          showBoundingBoxes={showBoundingBoxes}
        />
      {/if}

      {#if showStrokeDebug && drawingContent.strokes.length > 0}
        <StrokeOverlay
          strokes={drawingContent.strokes}
          scale={canvasScale}
        />
      {/if}

      {#if showTFOverlay && tfPredictions}
        <TFOverlay
          predictions={tfPredictions}
          scale={canvasScale}
        />
      {/if}

      {#if showShapeRecognition}
        <ShapeRecognitionButton
          drawingContent={drawingContent}
          scale={canvasScale}
          stroke={activeStroke}
        />
      {/if}
    </div>

    {#if $showLayerPanel}
      <LayerPanel />
    {/if}

    {#if $generatedImageUrl}
      <div class="result-panel" transition:fade={{duration: 300}}>
        <div class="result-header">
          <h3>Generated Image</h3>
          <div class="model-tag">{$generatedByModel || 'AI Model'}</div>
          <button class="close-result" on:click={() => generatedImageUrl.set(null)}>
            <span class="material-icons">close</span>
          </button>
        </div>
        <div class="result-content">
          <img
            src={$generatedImageUrl}
            alt="AI generated image"
            style="aspect-ratio: {generatedImageAspectRatio};"
          />
          <button class="download-result" on:click={() => downloadImage($generatedImageUrl, 'daydream-ai-generated')}>
            <span class="material-icons">download</span>
            Download
          </button>
        </div>
      </div>
    {/if}

    {#if $editedImageUrl && $editedImageUrl !== $generatedImageUrl}
      <div class="result-panel edited-result" transition:fade={{duration: 300}}>
        <div class="result-header">
          <h3>Edited Image</h3>
          <div class="model-tag">{$editedByModel || 'AI Edit'}</div>
          <button class="close-result" on:click={() => editedImageUrl.set(null)}>
            <span class="material-icons">close</span>
          </button>
        </div>
        <div class="result-content">
          <img
            src={$editedImageUrl}
            alt="AI edited image"
            style="aspect-ratio: {generatedImageAspectRatio};"
          />
          <button class="download-result" on:click={() => downloadImage($editedImageUrl, 'daydream-ai-edited')}>
            <span class="material-icons">download</span>
            Download
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  // Add styling for the layer button
  .layer-button {
    margin-top: 12px;

    &.active {
      background: rgba(99, 85, 255, 0.5);
    }

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }

  // All other existing styles remain unchanged
</style>