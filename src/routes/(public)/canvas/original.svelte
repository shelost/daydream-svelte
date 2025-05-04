<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { Tool, Stroke, StrokePoint } from '$lib/types';
  import { getStroke } from 'perfect-freehand';
  import { getSvgPathFromStroke, calculatePressureFromVelocity, calculateMultiStrokeBoundingBox, findRelatedStrokes, normalizeBoundingBox } from '$lib/utils/drawingUtils.js';
  import VerticalSlider from '$lib/components/VerticalSlider.svelte';
  import ShapeRecognitionButton from '$lib/components/ShapeRecognitionButton.svelte';
  import ShapeRecognitionDialog from '$lib/components/ShapeRecognitionDialog.svelte';
  import { fabric } from 'fabric'; // Import Fabric.js
  import {
    strokeOptions,
    isApplePencilActive,
    selectedTool
  } from '$lib/stores/drawStore';

  // Interface extension for Stroke type - Simplified for temporary storage
  interface TempStrokePoint extends StrokePoint {
    timestamp: number;
  }

  interface TempStroke {
      tool: 'pen' | 'eraser';
      points: TempStrokePoint[];
      color: string;
      size: number;
      opacity: number;
      hasHardwarePressure: boolean;
      // No need for isEraserStroke flag with Fabric
  }


  // --- Fabric.js State ---
  let fabricCanvasContainer: HTMLDivElement;
  let fabricCanvasElement: HTMLCanvasElement;
  let fabricCanvas: fabric.Canvas | null = null;
  let currentFabricBrush: fabric.BaseBrush | null = null;

  // --- Component State ---
  let isDrawing = false; // Tracks if pointer is down for any tool
  let currentTempStroke: TempStroke | null = null; // Temporary storage for pen points

  // Use the store values for reference but maintain local variables for reactivity
  let strokeColor: string;
  let strokeSize: number;
  let strokeOpacity: number;
  let pressureIntensity: number;
  let pfOptions; // To store perfect-freehand options derived from strokeOptions

  // Subscribe to store changes for options
  const unsubscribeStrokeOptions = strokeOptions.subscribe(options => {
    strokeColor = options.color;
    strokeSize = options.size;
    strokeOpacity = options.opacity;
    pressureIntensity = options.pressureIntensity;

    // Update pfOptions used for generating stroke shapes
    pfOptions = {
        thinning: options.thinning,
        smoothing: options.smoothing,
        streamline: options.streamline,
        easing: options.easing,
        start: options.start,
        end: options.end,
    };

    // Update Fabric brush settings if canvas exists and brush is pencil
    if (fabricCanvas && currentFabricBrush instanceof fabric.PencilBrush) {
        currentFabricBrush.color = strokeColor;
        currentFabricBrush.width = strokeSize;
        // Opacity is handled on the Path object, not the brush
    }
     // Update Eraser brush size if it's active
     if (fabricCanvas && fabricCanvas.freeDrawingBrush instanceof fabric.EraserBrush) {
        fabricCanvas.freeDrawingBrush.width = strokeSize; // Link eraser size to strokeSize for now
    }
  });

  // --- Removed State (Handled by Fabric or incompatible) ---
  // let drawingContent: EnhancedDrawingContent = { strokes: [] }; // Fabric manages objects
  // let imageData: string | null = null; // Fabric canvas has toDataURL
  // let analysisElements: any[] = []; // Overlays removed
  // let selectedStrokeIndices: number[] = []; // Fabric handles selection
  // let selectionBoxElement: HTMLDivElement | null = null; // Fabric handles selection box

  // --- Standard State (mostly unchanged) ---
  let errorMessage: string | null = null;
  // let showAnalysisView = false; // Analysis UI removed for now
  // let sketchAnalysis = "Draw something to see AI's interpretation"; // Analysis UI removed
  // let isAnalyzing = false; // Analysis logic removed
  // let lastAnalysisTime = 0; // Analysis logic removed
  let additionalContext = ""; // Keep for potential future use

  // Canvas dimensions (used for Fabric canvas sizing)
  let canvasWidth = 1024;
  let canvasHeight = 1024;
  let canvasScale = 1; // Can be used for Fabric zooming later if needed

  // Initialize on component mount
  onMount(() => {
    if (fabricCanvasElement && fabricCanvasContainer) {
        fabricCanvas = new fabric.Canvas(fabricCanvasElement, {
            width: canvasWidth,
            height: canvasHeight,
            backgroundColor: '#f8f8f8', // Set background color
            isDrawingMode: $selectedTool === 'pen' || $selectedTool === 'eraser', // Initial drawing mode
            selection: $selectedTool === 'select', // Initial selection mode
        });

        // Set initial brush based on selected tool store
        updateFabricBrush();

        // Handle Fabric events (Example: object selection)
        fabricCanvas.on('selection:created', (e) => {
            console.log('Fabric Selection Created:', e.selected);
            // Update any selection state if needed externally
        });
         fabricCanvas.on('selection:updated', (e) => {
            console.log('Fabric Selection Updated:', e.selected);
        });
        fabricCanvas.on('selection:cleared', (e) => {
            console.log('Fabric Selection Cleared');
        });

         fabricCanvas.on('path:created', (e) => {
            // This event fires after PencilBrush or EraserBrush finishes a path
            // We might not need this if we use our custom Perfect Freehand approach
             console.log('Fabric Path Created (Brush):', e.path);
             // For EraserBrush, Fabric handles applying the erase effect automatically
             // For PencilBrush (if we were using it directly), we could style it here
        });


        // Add event listeners for pointer events on the Fabric container
        // Fabric handles internal canvas events, but we capture on the container
        fabricCanvasContainer.addEventListener('pointerdown', onPointerDown);
        fabricCanvasContainer.addEventListener('pointermove', onPointerMove);
        // Capture pointer up/cancel/leave on the window to catch lifts outside canvas
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
        // fabricCanvasContainer.addEventListener('pointerleave', onPointerUp); // Usually handled by pointerup on window

        resizeFabricCanvas(); // Initial sizing
        window.addEventListener('resize', resizeFabricCanvas); // Resize listener

        console.log('Fabric Canvas Initialized');
    }

    return () => {
      // Cleanup
      window.removeEventListener('resize', resizeFabricCanvas);
      if (fabricCanvasContainer) {
          fabricCanvasContainer.removeEventListener('pointerdown', onPointerDown);
          fabricCanvasContainer.removeEventListener('pointermove', onPointerMove);
      }
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      if (fabricCanvas) {
        fabricCanvas.dispose(); // Dispose Fabric canvas resources
        fabricCanvas = null;
      }
       unsubscribeStrokeOptions(); // Unsubscribe from store
    };
  });

  // Function to resize Fabric canvas to fit container
  function resizeFabricCanvas() {
      if (!fabricCanvas || !fabricCanvasContainer) return;

      const containerWidth = fabricCanvasContainer.clientWidth;
      const containerHeight = fabricCanvasContainer.clientHeight;
      const aspectRatio = canvasWidth / canvasHeight; // Use internal aspect ratio

      let newWidth = containerWidth;
      let newHeight = containerWidth / aspectRatio;

      if (newHeight > containerHeight) {
          newHeight = containerHeight;
          newWidth = containerHeight * aspectRatio;
      }

      fabricCanvas.setWidth(newWidth);
      fabricCanvas.setHeight(newHeight);
      fabricCanvas.calcOffset(); // Recalculate canvas offsets
      fabricCanvas.requestRenderAll(); // Re-render

      console.log(`Fabric Canvas Resized: ${newWidth}x${newHeight}`);
  }


  // --- Tool Switching Logic ---
  $: { // Reactive statement for selectedTool changes
      console.log("Selected tool changed:", $selectedTool);
      if (fabricCanvas) {
          updateFabricBrush();
      }
  }

  function updateFabricBrush() {
      if (!fabricCanvas) return;

      if ($selectedTool === 'pen') {
          fabricCanvas.isDrawingMode = true;
          fabricCanvas.selection = false; // Disable object selection
          // Use a placeholder brush or null initially; we'll create paths manually
          // Using PencilBrush directly conflicts with Perfect Freehand shapes
          fabricCanvas.freeDrawingBrush = new fabric.BaseBrush(fabricCanvas); // Basic brush does nothing
          currentFabricBrush = fabricCanvas.freeDrawingBrush; // Update reference if needed
          makeObjectsUnselectable();
      } else if ($selectedTool === 'eraser') {
          fabricCanvas.isDrawingMode = true;
          fabricCanvas.selection = false;
          const eraserBrush = new fabric.EraserBrush(fabricCanvas);
          eraserBrush.width = strokeSize; // Link to strokeSize for consistency
          fabricCanvas.freeDrawingBrush = eraserBrush;
          currentFabricBrush = eraserBrush;
          makeObjectsUnselectable();
           console.log("Switched to Eraser Brush, width:", eraserBrush.width);
      } else if ($selectedTool === 'select') {
          fabricCanvas.isDrawingMode = false;
          fabricCanvas.selection = true; // Enable object selection
          currentFabricBrush = null;
          makeObjectsSelectable();
      }
  }

  function makeObjectsSelectable() {
      fabricCanvas?.getObjects().forEach(obj => {
          // Only make non-eraser paths selectable
          if (obj.type === 'path' && !(obj as any).isEraserPath) {
               obj.set({ selectable: true, evented: true });
          } else {
               obj.set({ selectable: false, evented: false });
          }
      });
       fabricCanvas?.requestRenderAll();
       console.log("Made objects selectable");
  }

   function makeObjectsUnselectable() {
      fabricCanvas?.getObjects().forEach(obj => obj.set({ selectable: false, evented: false }));
      fabricCanvas?.discardActiveObject(); // Deselect any active object
      fabricCanvas?.requestRenderAll();
      console.log("Made objects unselectable");
  }

  // --- Unified Event Handlers ---

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || !fabricCanvas) return;

    // Let Fabric handle its internal events first if needed (e.g., selection clicks)
    // We primarily handle drawing initiation here for Pen tool
    if ($selectedTool === 'pen') {
        startPenStroke(e);
    }
    // Fabric's drawing mode handles eraser and its own selection logic internally via its listeners
  }

  function onPointerMove(e: PointerEvent) {
     if ($selectedTool === 'pen') {
         continuePenStroke(e);
     }
    // Fabric's drawing mode handles eraser move events
    // Fabric's selection mode handles selection box drawing
  }

  function onPointerUp(e: PointerEvent) {
     if ($selectedTool === 'pen') {
         endPenStroke(e);
     }
     // Fabric's drawing mode handles eraser path:created
     // Fabric's selection mode handles selection:created/updated/cleared
  }

  // --- Tool Specific Functions ---

  // PEN TOOL (Using Perfect Freehand for Path Generation)
  function startPenStroke(e: PointerEvent) {
    if (!fabricCanvas) return;
    isDrawing = true; // Use our flag for custom pen logic
    const isPen = e.pointerType === 'pen';
    isApplePencilActive.set(isPen);
    console.log(`Custom Pen Draw Started. Pointer type: ${e.pointerType}, Pressure: ${e.pressure}`);

    const point = getFabricPointerPosition(e); // Use Fabric's pointer method
    if (!point) return;

    const timestamp = Date.now();
    const hasHardwarePressure = isPen && e.pressure > 0 && e.pressure !== 0.5;
    console.log(`Hardware pressure detected: ${hasHardwarePressure}`);

    // Initialize temporary stroke data
    currentTempStroke = {
      tool: 'pen',
      points: [{ ...point, pressure: e.pressure, timestamp: timestamp }], // Store raw pressure
      color: strokeColor,
      size: strokeSize,
      opacity: strokeOpacity,
      hasHardwarePressure: hasHardwarePressure
    };

    // No setPointerCapture needed, Fabric might handle this or we manage focus differently
  }

  function continuePenStroke(e: PointerEvent) {
    if (!isDrawing || !currentTempStroke || !fabricCanvas) return;

    const point = getFabricPointerPosition(e);
    if (!point) return;

    const timestamp = Date.now();

    // Add point with raw pressure to temporary stroke
    currentTempStroke.points.push({ ...point, pressure: e.pressure, timestamp: timestamp });

    // OPTIONAL: Render a temporary thin line preview while drawing (using Fabric)
    // This requires more complex logic to draw/clear temporary lines on move.
    // For simplicity, we'll only draw the final stroke in endPenStroke.
  }

  function endPenStroke(e: PointerEvent) {
    if (!isDrawing || !currentTempStroke || !fabricCanvas) return;
    isDrawing = false;
    isApplePencilActive.set(false);
    console.log('Custom Pen Draw Ended');

    if (currentTempStroke.points.length < 2) {
        currentTempStroke = null;
        return; // Not enough points for a stroke
    }

    // Process points for Perfect Freehand (apply pressure intensity)
    const enhancedPfPoints = currentTempStroke.points.map(p => {
      let basePressure = p.pressure || 0.5;
      let enhancedPressure = basePressure;

      if (pressureIntensity !== 1.0) {
        const intensityFactor = Math.max(1, pressureIntensity / 2);
        const lightPressureThreshold = 0.35;
        if (basePressure < lightPressureThreshold) {
          const normalizedPressure = basePressure / lightPressureThreshold;
          const amplifiedPressure = Math.pow(normalizedPressure, 0.5);
          enhancedPressure = 0.1 + (0.3 * amplifiedPressure);
        } else {
          const normalizedPressure = (basePressure - lightPressureThreshold) / (1 - lightPressureThreshold);
          enhancedPressure = 0.4 + (0.6 * Math.pow(normalizedPressure, 1/intensityFactor));
        }
        enhancedPressure = Math.min(1.0, Math.max(0.1, enhancedPressure));
      }
      return [p.x, p.y, enhancedPressure];
    });

    // Generate the stroke outline points using Perfect Freehand
    const pfStrokeOptions = {
        ...pfOptions, // Spread the options from the store
        size: currentTempStroke.size,
        simulatePressure: !currentTempStroke.hasHardwarePressure,
    };
    const outlinePoints = getStroke(enhancedPfPoints, pfStrokeOptions);

    if (outlinePoints.length < 3) {
        currentTempStroke = null;
        return; // Not enough outline points
    }

    // Convert Perfect Freehand outline to Fabric Path
    const pathData = getSvgPathFromStroke(outlinePoints);
    if (pathData) {
        const fabricPath = new fabric.Path(pathData, {
            fill: currentTempStroke.color,
            opacity: currentTempStroke.opacity,
            selectable: false, // Keep selectable false initially
            evented: false,
            objectCaching: false, // May help with performance, especially with erasing
            erasable: true,      // Make the path erasable
            perPixelTargetFind: true, // Important for erasing accuracy
        });
        // Add custom property if needed later (e.g., to distinguish from other objects)
        // (fabricPath as any).isPenStroke = true;
        fabricCanvas.add(fabricPath);
        fabricCanvas.requestRenderAll();
         console.log("Added Perfect Freehand path to Fabric");
    }

    currentTempStroke = null; // Clear temporary stroke data
  }

  // ERASER TOOL (Using Fabric EraserBrush)
  // No specific start/continue/end needed as Fabric handles it in drawing mode
  // Brush is set in updateFabricBrush()

  // SELECT TOOL (Using Fabric Selection)
  // No specific start/continue/end needed as Fabric handles it when not in drawing mode
  // Selection enabled/disabled in updateFabricBrush()

  // Helper to get pointer coords relative to Fabric canvas
  function getFabricPointerPosition(e: PointerEvent | MouseEvent): { x: number; y: number } | null {
      if (!fabricCanvas) return null;
      const pointer = fabricCanvas.getPointer(e);
      return pointer;
  }


  // --- Removed/Obsolete Functions ---
  // calculatePressureFromVelocity (still used in drawingUtils, but maybe not needed here if HW pressure works)
  // findRelatedStrokes, normalizeBoundingBox, calculateMultiStrokeBoundingBox (analysis removed)
  // renderStrokes (Fabric handles rendering)
  // analyzeSketch, recognizeStrokes (analysis removed)
  // updateAnalysisElements, getPositionFromText, etc. (analysis removed)
  // generateStrokesHash (analysis removed)
  // createSelectionBoxElement, updateSelectionBoxElement, removeSelectionBoxElement (Fabric handles selection UI)
  // findIntersectingStrokes (Fabric handles selection logic)

  // --- Functions Kept (Potentially for future use) ---
  function clearCanvas() {
    if (fabricCanvas) {
      fabricCanvas.clear(); // Clear Fabric canvas objects
      fabricCanvas.backgroundColor = '#f8f8f8'; // Re-set background if needed
      fabricCanvas.requestRenderAll();
      console.log("Fabric Canvas Cleared");
    }
    // Reset any relevant non-Fabric state if necessary
    errorMessage = null;
  }

  // --- Placeholder / Future ---
  // generateImage function needs complete rewrite to:
  // 1. Get image data from Fabric canvas: fabricCanvas.toDataURL()
  // 2. Send this data to the backend API
  async function generateImage() {
     errorMessage = "Image generation with Fabric canvas not implemented yet.";
     console.warn("generateImage function needs to be adapted for Fabric.js");
      if (!fabricCanvas) return;
       // Example: Get canvas data
       const imageDataURL = fabricCanvas.toDataURL({ format: 'png' });
       console.log("Fabric Canvas Data URL (example):", imageDataURL.substring(0, 100) + "...");
       // TODO: Implement fetch call to backend with this imageDataURL
  }

  // Helper function to calculate appropriate width/height/color (kept if needed elsewhere)
  function calculateElementWidth(element) { /* ... as before ... */ return 120; }
  function calculateElementHeight(element) { /* ... as before ... */ return 120; }
  function getColorForCategory(category) { /* ... as before ... */ return '#FF5733'; }
  function hasElementsChanged(oldElements, newElements) { /* ... as before ... */ return true; }
  function computeStrokesHash(strokes) { /* ... as before ... */ return ''; }

  // Mobile check remains relevant
  function mobileCheck() {
    const isMobile = window.innerWidth < 768;
    if (isMobile) console.log('Mobile device detected');
    // resizeFabricCanvas(); // Resize is handled by listener
  }

  // Capture canvas snapshot (now uses Fabric method)
  function captureCanvasSnapshot() {
    if (!fabricCanvas) return '';
    try {
        return fabricCanvas.toDataURL({ format: 'png' });
    } catch (error) {
      console.error('Error capturing Fabric canvas snapshot:', error);
      return '';
    }
  }

  // --- UI State ---
  // State variables for Shape Recognition Dialog (Keep UI elements, but logic is disabled)
  let showShapeRecognitionDialog = false;
  let showAIDebugMode = false;
  let buttonPosition = { right: '20px', bottom: '20px' };
  let shapeDialogPosition = { right: '20px', top: '20px' };
  let currentCanvasSnapshot = ''; // Added missing variable for canvas snapshot

  // Aspect Ratio (Keep for potential Fabric canvas sizing)
  let selectedAspectRatio = '1:1'; // Default aspect ratio (square)
  const aspectRatios = {
    '1:1': 1 / 1,          // Square 1024x1024
    'portrait': 1792 / 1024,  // Portrait 1792x1024
    'landscape': 1024 / 1792  // Landscape 1024x1792
  };
  let generatedImageAspectRatio = '1:1'; // Keep for output display

  // Function to toggle Shape Recognition Dialog (Keep UI toggle, disable functionality)
  function toggleShapeRecognitionDialog() {
    showShapeRecognitionDialog = !showShapeRecognitionDialog;
     if (showShapeRecognitionDialog) {
         errorMessage = "AI Analysis features are disabled in this Fabric.js canvas version.";
         setTimeout(() => errorMessage = null, 3000);
         currentCanvasSnapshot = captureCanvasSnapshot(); // Still capture for dialog display
     }
  }
   function toggleDebugMode() { showAIDebugMode = !showAIDebugMode; }

</script>

<svelte:head>
  <title>Daydream Canvas (Fabric.js)</title>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
</svelte:head>

<div id='app'>
<div class="draw-demo-container">
  <header class="demo-header">
    <div class="context-input-container">
      <input
        id="context-input"
        type="text"
        bind:value={additionalContext}
        placeholder="Image generation context (optional)"
        class="context-input"
      />
      <button
        class="generate-button"
        on:click={generateImage}
        disabled={false} <!-- Re-enable button, logic inside checks -->
      >
        <span class="material-icons">auto_fix_high</span>
         Generate
      </button>
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
      <!-- Tool Selection Toolbar -->
      <div class="vertical-toolbar tool-selector-toolbar">
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
          <!-- Using a different icon that looks more like an eraser -->
           <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="currentColor"><path d="M0 0h24v24H0z" fill="none"/><path d="M16.5 10c-.28 0-.5.22-.5.5v3c0 .28.22.5.5.5s.5-.22.5-.5v-3c0-.28-.22-.5-.5-.5zM18 10c-.28 0-.5.22-.5.5v3c0 .28.22.5.5.5s.5-.22.5-.5v-3c0-.28-.22-.5-.5-.5zm-8.5 6H22v2H9.5zM6 18H4V8l4.25-6h9.5L22 8v8h-2.5c-.83 0-1.5-.67-1.5-1.5v-3c0-.83-.67-1.5-1.5-1.5S15 9.67 15 10.5v3c0 .83-.67 1.5-1.5 1.5S12 14.33 12 13.5v-3c0-.83-.67-1.5-1.5-1.5S9 9.67 9 10.5v3c0 .83-.67 1.5-1.5 1.5zM6 6l-4 4v2h4V6zm12 0l4 4v2h-4V6z"/></svg>
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

      <!-- Stroke Options Toolbar -->
      <div class="vertical-toolbar options-toolbar">
          <div class="tools-group">

            <div class="tool-group">
              <input
                type="color"
                bind:value={strokeColor}
                on:change={() => {
                  strokeOptions.update(opts => ({...opts, color: strokeColor}));
                  // Fabric brush color updated via store subscription
                }}
              />
              <span class="tool-label" style="font-size: 10px; color: #aaa;">Color</span>
            </div>


            <div class="tool-group">
              <VerticalSlider
                min={1}
                max={50}
                step={0.5}
                bind:value={strokeSize}
                color="#6355FF"
                height="120px"
                onChange={() => {
                  strokeOptions.update(opts => ({...opts, size: strokeSize}));
                   // Fabric brush size updated via store subscription
                }}
                showValue={true}
              />
               <span class="tool-label" style="font-size: 10px; color: #aaa;">Size</span>
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
                  // Opacity applied when creating Fabric path
                }}
                showValue={true}
              />
               <span class="tool-label" style="font-size: 10px; color: #aaa;">Opacity</span>
            </div>

            <button class="tool-button" on:click={clearCanvas}>
              <span class="material-icons">delete_outline</span>
            </button>
          </div>
      </div>
    </div>

    <!-- Fabric Canvas Container -->
    <div class="canvas-wrapper input-canvas fabric-container" bind:this={fabricCanvasContainer}>
        <canvas bind:this={fabricCanvasElement}></canvas>
        <!-- Overlays removed - would need Fabric-specific implementation -->
    </div>

    <!-- Output canvas remains for potential AI image display -->
    <div class="canvas-wrapper output-canvas" style="display:none;" class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-portrait={generatedImageAspectRatio === 'portrait'} class:ratio-landscape={generatedImageAspectRatio === 'landscape'}>
        <div class="output-display" class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-portrait={generatedImageAspectRatio === 'portrait'} class:ratio-landscape={generatedImageAspectRatio === 'landscape'}>
            <!-- Image display logic -->
        </div>
    </div>
  </div>

  <div class="action-area">
    <!-- Shape Recognition Dialog and Button (UI only, functionality disabled) -->
    <ShapeRecognitionButton
      position={buttonPosition}
      active={showShapeRecognitionDialog}
      objectCount={0} <!-- Disabled -->
      isAnalyzing={false} <!-- Disabled -->
      hasTextAnalysis={false} <!-- Disabled -->
      hasStrokesAnalysis={false} <!-- Disabled -->
      hasSketchAnalysis={false} <!-- Disabled -->
      on:toggle={toggleShapeRecognitionDialog}
    ></ShapeRecognitionButton>

    <ShapeRecognitionDialog
      show={showShapeRecognitionDialog}
      position={shapeDialogPosition}
      detectedObjects={[]} <!-- Disabled -->
      isAnalyzing={false} <!-- Disabled -->
      isAnalyzingText={false} <!-- Disabled -->
      sketchAnalysis={"AI Analysis disabled for Fabric Canvas"}
      strokeRecognition={"AI Analysis disabled for Fabric Canvas"}
      debugMode={showAIDebugMode}
      on:close={() => showShapeRecognitionDialog = false}
      on:toggleDebug={toggleDebugMode}
      canvasSnapshot={currentCanvasSnapshot}
      sketchAnalysisOutput={null} <!-- Disabled -->
      strokesAnalysisOutput={null} <!-- Disabled -->
      on:optionsChanged={() => {}} <!-- Disabled -->
      on:refreshAnalysis={() => {}} <!-- Disabled -->
    />
  </div>
</div>

<style lang="scss">
    // Keep existing styles, but add style for Fabric container if needed
    .fabric-container {
        // Ensure the container behaves correctly
        width: 100%;
        height: 100%;
        position: relative; // Needed for absolute positioning of canvas element

        canvas {
            // Fabric might manage this, but ensure it fills container
            position: absolute;
            top: 0;
            left: 0;
            border-radius: 8px; // Apply border-radius if desired
             box-shadow: -12px 32px 32px rgba(black, 0.4); // Keep shadow
        }
    }

    // Update cursor based on selected tool
    .fabric-container {
        cursor: default; // Default cursor
        &.pen-mode { cursor: crosshair; }
        &.eraser-mode {
            cursor: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="rgba(0,0,0,0.5)" d="M5.5 18a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V11h-13z"/><path fill="black" d="M18.5 6a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5V11h10z"/><path fill="none" stroke="black" stroke-width="1" d="M8.5 6.5v-2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v2"/></svg>') 12 12, auto; // Custom eraser cursor
        }
        &.select-mode { cursor: default; }
    }


  #app{
    height: 100vh;
    width: 100%;
    overflow: hidden;
    background-color: #2d2d2d; // Darker background for contrast
  }

  .draw-demo-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start; // Align top
    box-sizing: border-box;
    height: 100vh;
    width: 100%;
    padding: 12px;
    gap: 10px; // Add gap between header and canvas container
  }

  .demo-header {
    width: 100%;
    max-width: 600px; // Limit header width
    text-align: center;
    // margin-bottom: 1rem; // Removed, using gap in parent
    flex-shrink: 0; // Prevent header from shrinking

    .context-input-container {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0 auto; // Center input container
      width: 90%;
      max-width: 550px;
      padding: 8px;
      border: 1px solid rgba(white, 0.08);
      background: rgba(0, 0, 0, .15);
      border-radius: 32px;
      box-shadow: inset 0 1px 2px rgba(black, 0.2), -4px 8px 16px rgba(black, 0.2);
      text-shadow: 0 1px 2px rgba(black, .1);

      .context-input {
        font-family: 'Inter', 'DM Sans', sans-serif; // Changed font
        font-size: 16px; // Slightly smaller
        font-weight: 500;
        letter-spacing: -.2px;
        color: #e0e0e0; // Lighter text color
        background: none;
        border: none;
        flex: 1;
        padding: 4px 8px; // Add padding

        &::placeholder {
          color: rgba(white, .3);
        }

        &:focus {
          outline: none;
        }
      }
    }
  }

  .generate-button { // Updated button styles
      display: inline-flex; // Changed display
      align-items: center;
      justify-content: center;
      gap: 6px; // Increased gap
      background: #635FFF;
      border: none;
      border-radius: 20px; // Adjusted radius
      padding: 8px 16px 8px 12px; // Adjusted padding
      font-size: 14px; // Adjusted size
      font-family: 'Inter', sans-serif;
      font-weight: 600; // Adjusted weight
      color: white;
      cursor: pointer;
      transition: all 0.2s ease; // Faster transition
      box-shadow: 0 2px 5px rgba(0,0,0, 0.1), 0 4px 8px rgba(99, 95, 255, 0.2);
      position: relative;
      overflow: hidden;

      span.material-icons { // Target icon specifically
        font-size: 18px;
        color: white;
      }

      &:hover {
        transform: translateY(-1px);
        box-shadow: 0 3px 8px rgba(0,0,0, 0.15), 0 5px 12px rgba(99, 95, 255, 0.3);
        background: linear-gradient(45deg, #706dff, #5955ff); // Gradient on hover
      }

      &:active {
        transform: translateY(0px);
        box-shadow: 0 1px 3px rgba(0,0,0, 0.1), 0 2px 4px rgba(99, 95, 255, 0.2);
        background: #5955ff;
      }

      &:disabled {
        background: #555; // Darker disabled background
        color: #999;
        cursor: not-allowed;
        box-shadow: none;
        opacity: 0.6;

        span.material-icons { color: #999; }

        &:hover {
          transform: none;
          box-shadow: none;
          background: #555;
        }
      }
  }

  .error-message { // Position error below button
      margin-top: 10px; // Add space above
      display: flex;
      align-items: center;
      gap: 8px;
      color: #ff8a80; // Lighter error color
      background: rgba(211, 47, 47, 0.2); // Transparent error bg
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      border: 1px solid rgba(211, 47, 47, 0.3);

      .material-icons {
          color: #ff8a80;
          font-size: 18px;
      }
  }

  .canvas-container {
    display: flex;
    justify-content: center;
    align-items: flex-start; // Align toolbars to top
    flex: 1; // Take remaining space
    gap: 15px; // Adjusted gap
    // margin: 12px 0; // Removed margin
    width: 100%; // Use full width
    // max-height: 85vh; // Removed max-height
    position: relative;
    padding: 0 10px; // Add horizontal padding
    box-sizing: border-box;

    .toolbars-wrapper {
      display: flex;
      flex-direction: row; // Keep toolbars side-by-side
      gap: 10px;
      height: fit-content;
      z-index: 5;
      padding-top: 10px; // Add padding to align with canvas visually
      position: absolute; // Position toolbars absolutely
      left: 15px;
      top: 15px;
    }

    @media (max-width: 768px) {
       padding: 0 5px; // Less padding on mobile
       gap: 10px;

      .toolbars-wrapper {
        position: static; // Static position on mobile
        flex-direction: row;
        width: 100%;
        justify-content: center;
        gap: 10px;
        padding-top: 0;
        margin-bottom: 10px;
      }
    }
  }

  /* Toolbar styles */
  .vertical-toolbar {
    background: rgba(55, 55, 55, 0.8); // Darker, more opaque toolbar
    backdrop-filter: blur(8px);
    border-radius: 10px; // More rounded
    box-shadow: 0 4px 12px rgba(black, 0.25);
    border: 1px solid rgba(white, 0.1);
    padding: 8px 5px; // Adjusted padding
    box-sizing: border-box;
    width: 48px; // Adjusted width
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px; // Consistent gap

    &.tool-selector-toolbar {
       gap: 6px; // Smaller gap for tool icons
    }

    &.options-toolbar {
       gap: 15px; // Gap for option groups
    }
  }

  .tool-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px; // Smaller gap within group
    width: 100%;
  }

  .tool-icon-label { // Style for labels within sliders etc.
    color: #aaa;
    font-size: 10px; // Smaller font size
    margin-top: 2px;
  }

  /* Color picker styles */
  input[type="color"] {
    -webkit-appearance: none;
    border: 1px solid rgba(white, 0.15); // Subtle border
    width: 24px; // Smaller size
    height: 24px;
    padding: 0;
    border-radius: 50%; // Circular
    cursor: pointer;
    overflow: hidden;
     box-shadow: inset 0 0 3px rgba(black, 0.2);
  }

  input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  input[type="color"]::-webkit-color-swatch { border: none; border-radius: 50%; }


  .tool-label { // General label for tool groups (like Color, Size)
    font-size: 10px; // Smaller font size
    color: #aaa;
    text-align: center;
    margin-top: 0px; // Reduced margin
    line-height: 1;
  }

  .canvas-wrapper {
    flex: 1;
    position: relative; // Needed for Fabric canvas positioning
    display: flex; // Use flex to center content
    justify-content: center;
    align-items: center;
    overflow: hidden; // Hide overflow
    // transition: all 0.3s ease; // Removed transition
    border-radius: 10px; // Add border radius
    // background: #f0f0f0; // Light background for contrast
    min-height: 300px; // Ensure minimum height

    &.input-canvas { // Specific styles for the main drawing area
        // Max width/height handled by resize logic now
         background: transparent; // Container itself is transparent
    }

    // Remove specific ratio classes as resize handles it
  }


  .output-display {
    // ... existing styles ...
  }

  .action-area {
    width: 100%;
    display: flex;
    justify-content: center; // Center items like dialog button
    padding: 0 12px 12px 12px; // Add padding
    box-sizing: border-box;
    // position: absolute; // Remove absolute positioning if it was there
    // bottom: 10px; // Remove bottom positioning
    gap: 1rem;
  }

  /* Tool button styles */
  .tool-button {
    padding: 6px; // Reduced padding
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    transition: background-color 0.2s ease;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 6px; // Slightly rounded corners
    height: 38px; // Fixed height
    box-sizing: border-box;

    .material-icons, svg { // Target both icon types
      font-size: 20px; // Smaller icons
      color: #bbb; // Default icon color
      transition: color 0.2s;
      fill: #bbb; // Fill for SVG icon
      width: 20px; // Explicit size for SVG
      height: 20px;
    }

    &:hover {
      background: rgba(white, 0.1);
      .material-icons, svg { color: #fff; fill: #fff; }
    }

     // Active state for tool buttons
    &.active {
        background: rgba(99, 95, 255, 0.25); // More visible active state
        border: 1px solid rgba(99, 95, 255, 0.4); // Add subtle border
        .material-icons, svg {
            color: #a9a7ff; // Brighter active icon color
            fill: #a9a7ff;
        }
    }
  }

   // Active state moved below general button styles for specificity


</style>