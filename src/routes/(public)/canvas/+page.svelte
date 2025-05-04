<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { Tool, Stroke, StrokePoint } from '$lib/types';
  import { getStroke } from 'perfect-freehand';
  import { getSvgPathFromStroke, calculatePressureFromVelocity, calculateMultiStrokeBoundingBox, findRelatedStrokes, normalizeBoundingBox } from '$lib/utils/drawingUtils.js';
  import VerticalSlider from '$lib/components/VerticalSlider.svelte';
  import AIOverlay from '$lib/components/AIOverlay.svelte';
  import StrokeOverlay from '$lib/components/StrokeOverlay.svelte';
  import TFOverlay from '$lib/components/TFOverlay.svelte';
  import ShapeRecognitionButton from '$lib/components/ShapeRecognitionButton.svelte';
  import ShapeRecognitionDialog from '$lib/components/ShapeRecognitionDialog.svelte';
  import { fabric } from 'fabric'; // Import Fabric.js

  import {
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
  } from '$lib/stores/drawStore';

  // Interface extension for Stroke type with hasPressure property
  interface EnhancedStroke extends Stroke {
    hasPressure?: boolean;
    hasHardwarePressure?: boolean; // Flag for true hardware pressure support
    // Removed isEraserStroke - Fabric handles erasing differently
  }

  // Drawing content object with enhanced strokes (still needed for analysis)
  interface EnhancedDrawingContent {
    strokes: EnhancedStroke[];
    bounds?: {
      width: number;
      height: number;
    };
  }

  // Analysis element type
  interface AnalysisElement {
    id: string;
    name: string;
    category?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    color: string;
    isChild?: boolean;
    parentId?: string;
    children?: string[];
    pressure?: number; // Add pressure property for visual effects
    boundingBox?: {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      width: number;
      height: number;
    };
    // Add originalStrokeIndex to link analysis elements back to drawingContent if needed
    originalStrokeIndex?: number;
  }

  // --- Fabric.js State ---
  let fabricCanvasEl: HTMLCanvasElement; // Reference to the HTML canvas element
  let fabricCanvas: fabric.Canvas; // Fabric canvas instance

  // --- Component State ---
  let isDrawing = false;
  let currentStroke: EnhancedStroke | null = null; // Still needed for Perfect Freehand points
  let strokeColor: string;
  let strokeSize: number;
  let strokeOpacity: number;
  let eraserSize = 20; // Keep local eraser size for Fabric brush

  // Subscribe to store changes for stroke options
  const unsubscribeStrokeOptions = strokeOptions.subscribe(options => {
    strokeColor = options.color;
    strokeSize = options.size;
    strokeOpacity = options.opacity;

    // Update Fabric brush if drawing mode is active (e.g., for pen, though less direct impact now)
    if (fabricCanvas && fabricCanvas.isDrawingMode && fabricCanvas.freeDrawingBrush) {
      // fabricCanvas.freeDrawingBrush.color = strokeColor; // Path color set on creation
      // fabricCanvas.freeDrawingBrush.width = strokeSize; // Path size comes from Perfect Freehand
    } else if (fabricCanvas && $selectedTool === 'eraser' && fabricCanvas.freeDrawingBrush) {
        // Update eraser brush size if active
        fabricCanvas.freeDrawingBrush.width = eraserSize;
    }
    fabricCanvas?.requestRenderAll(); // Re-render if options change
  });

  let imageData: string | null = null; // For snapshot/preview
  let pointTimes: number[] = []; // Track time for velocity-based pressure
  let errorMessage: string | null = null;
  let showAnalysisView = false; // Toggle for AI analysis view
  let showStrokeOverlay = true; // Toggle for stroke recognition overlay
  let sketchAnalysis = "Draw something to see AI's interpretation";
  let previousSketchAnalysis = "";
  let isAnalyzing = false;
  let lastAnalysisTime = 0;
  let strokeRecognition = "Draw something to see shapes recognized";
  let previousStrokeRecognition = "";
  let isRecognizingStrokes = false;
  let lastStrokeAnalysisTime = 0;
  let recognitionResult: any = null; // Store the full API response
  let additionalContext = "";
  let analysisElements: AnalysisElement[] = [];
  let showDebugPressure = false; // Toggle for pressure visualization
  let tfObjects: any[] = [];
  let gptObjects: any[] = [];
  let visualizationMode = 'gpt'; // Options: 'gpt', 'tensorflow', 'both'

  let canvasScale = 1; // Scale factor for display vs internal resolution (still needed for overlays)

  // drawingContent stores the raw stroke data for AI analysis
  let drawingContent: EnhancedDrawingContent = {
    strokes: [],
    bounds: { width: 800, height: 600 } // Initial bounds, updated in resizeCanvas
  };

  // Canvas dimensions (internal resolution)
  let canvasWidth = 1024; // Default internal width
  let canvasHeight = 1024; // Default internal height

  // Overlay visibility controls
  let showGPTOverlay = true;
  let showTFOverlay = true;

  // Throttling/Debouncing constants
  const ANALYSIS_THROTTLE_MS = 3000;
  const ANALYSIS_DEBOUNCE_MS = 1500;

  // Analysis state tracking
  let pendingAnalysis = false;
  let lastUserEditTime = 0;
  let lastAnalyzedStrokesHash = '';
  let lastStrokeAnalyzedHash = '';
  let forceAnalysisFlag = false;
  let isResizeEvent = false;
  let analysisDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let renderDebounceTimeout: ReturnType<typeof setTimeout> | null = null;
  let isArtificialEvent = false;
  let previousAnalyzedStrokeCount = 0;
  let previousRecognizedStrokeCount = 0;

  // Latest analysis results
  let sketchAnalysisOutput: any = null;
  let strokesAnalysisOutput: any = null;
  let currentCanvasSnapshot: string = '';

  // --- Function to build prompts (Unchanged) ---
  function buildGptImagePrompt() {
    let prompt = `Complete this drawing. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;
    const contentGuide = sketchAnalysis !== "Draw something to see AI's interpretation" ? sketchAnalysis : "A user's drawing.";
    prompt += `CONTENT DESCRIPTION: ${contentGuide}

`;
    if (additionalContext) {
      prompt += `USER'S CONTEXT: "${additionalContext}"

`;
    }
    if (analysisElements.length > 0) {
      const structuralGuide = `Based on analysis, the drawing contains ${analysisElements.length} main elements. Element positions and basic relationships are implied by the sketch.`;
      prompt += `STRUCTURAL GUIDE: ${structuralGuide}

`;
    }
    const compositionGuide = `Focus on the arrangement within the ${selectedAspectRatio} frame.`;
    prompt += `COMPOSITION GUIDE: ${compositionGuide}

`;
    if (strokeRecognition && strokeRecognition !== "Draw something to see shapes recognized") {
      prompt += `RECOGNIZED SHAPES: ${strokeRecognition}

`;
    }
    if (detectedObjectsText || tfDetectedObjectsText) {
      prompt += `This is a list of elements that you MUST include,
      with coordinates relative to the canvas.
      For example, "x:0.268,y:0.197 with width:0.386,height:0.457"
      means that the element is located at the 26.8% point from the left, 19.7% point from the top,
      with a width spanning 38.6% of the canvas width, and a height spanning 45.7% of the canvas height.



      DETECTED OBJECTS:
`;
      if (detectedObjectsText) {
        prompt += `${detectedObjectsText}
`;
      }
      if (tfDetectedObjectsText) {
        prompt += `${tfDetectedObjectsText}
`;
      }
      prompt += `
`;
    }
    prompt += `FINAL INSTRUCTIONS: Create a DIRECT, FRONT-FACING VIEW that maintains the EXACT same composition as the sketch. NEVER distort or reposition any element. Color and texture can be added, but the structural skeleton must remain identical to the original sketch.`;
    return prompt.length > 4000 ? prompt.substring(0, 3997) + '...' : prompt;
  }
  $: {
    const newPrompt = buildGptImagePrompt();
    gptImagePrompt.set(newPrompt);
  }
  function buildGptEditPrompt() {
    let prompt = `Complete this drawing, in the exact same style and proportions as the original. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;
    const contentGuide = sketchAnalysis !== "Draw something to see AI's interpretation" ? sketchAnalysis : "A user's drawing.";
    prompt += `

CONTENT DESCRIPTION: ${contentGuide}`;
    if (additionalContext) {
      prompt += `

USER'S CONTEXT: "${additionalContext}"`;
    }
    if (analysisElements.length > 0) {
      const structuralGuide = `Based on analysis, the drawing contains ${analysisElements.length} main elements. Element positions and basic relationships are implied by the sketch.`;
      prompt += `

STRUCTURAL GUIDE: ${structuralGuide}`;
    }
    const compositionGuide = `Focus on the arrangement within the ${selectedAspectRatio} frame.`;
    prompt += `

COMPOSITION GUIDE: ${compositionGuide}`;
    if (strokeRecognition && strokeRecognition !== "Draw something to see shapes recognized") {
      prompt += `

RECOGNIZED SHAPES: ${strokeRecognition}`;
    }
    return prompt.length > 4000 ? prompt.substring(0, 3997) + '...' : prompt;
  }
  $: {
    const newEditPrompt = buildGptEditPrompt();
    gptEditPrompt.set(newEditPrompt);
  }
  $: if (additionalContext !== undefined) {
    const newEditPrompt = buildGptEditPrompt();
    gptEditPrompt.set(newEditPrompt);
  }

  // --- Utility Functions (Mostly Unchanged, adapted for Fabric where needed) ---
  function isRealUserEdit(): boolean {
    if (isResizeEvent) return false;
    if ($isGenerating || isArtificialEvent) return false;
    if (isAnalyzing || isRecognizingStrokes) return false;
    lastUserEditTime = Date.now();
    pendingAnalysis = true;
    return true;
  }

  $: strokeCount = drawingContent?.strokes?.length || 0;
  let browser = typeof window !== 'undefined';
  let lastResizeTime = 0;

  // --- Initialization ---
  onMount(() => {
    initializeFabricCanvas();
    mobileCheck();
    window.addEventListener('resize', mobileCheck);

    return () => {
      window.removeEventListener('resize', mobileCheck);
      fabricCanvas?.dispose(); // Clean up Fabric canvas instance
      unsubscribeStrokeOptions(); // Unsubscribe from store
    };
  });

  function initializeFabricCanvas() {
    if (!fabricCanvasEl || fabricCanvas) return; // Prevent double initialization

    console.log('Initializing Fabric canvas');
    fabricCanvas = new fabric.Canvas(fabricCanvasEl, {
      backgroundColor: '#f8f8f8',
      isDrawingMode: false, // Start in selection mode or pen mode? Let's start pen.
      selection: false, // Disable group selection initially
      // Optimize rendering for freehand drawing
      renderOnAddRemove: false, // We'll manually render
      // enableRetinaScaling: true, // Consider enabling for sharper rendering
    });

    // Set initial dimensions
    resizeCanvas();

    // Set up Fabric event listeners for selection
    fabricCanvas.on('selection:created', handleFabricSelection);
    fabricCanvas.on('selection:updated', handleFabricSelection);
    fabricCanvas.on('selection:cleared', handleFabricSelection);

    // Set initial tool based on store
    updateTool($selectedTool);

      // Capture initial image data for output preview
    imageData = captureCanvasSnapshot();

    console.log('Fabric canvas initialized');
  }

  // --- Canvas Sizing ---
  function getHeightFromAspectRatio(width: number, aspectRatio: string): number {
     const ratios = {
        '1:1': 1 / 1,
        'portrait': 1024 / 1792, // Height/Width for portrait
        'landscape': 1792 / 1024 // Height/Width for landscape
    };
    // Return width * (height/width ratio)
    return width * (ratios[aspectRatio] || 1);
  }

  function resizeCanvas() {
    if (!fabricCanvasEl || !fabricCanvasEl.parentElement || !fabricCanvas) return;

    lastResizeTime = Date.now();
    isResizeEvent = true;

    const container = fabricCanvasEl.parentElement;
    const containerStyle = window.getComputedStyle(container);
    const paddingHorizontal = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight);
    const paddingVertical = parseFloat(containerStyle.paddingTop) + parseFloat(containerStyle.paddingBottom);
    const availableWidth = container.clientWidth - paddingHorizontal;
    const availableHeight = container.clientHeight - paddingVertical;

    let internalWidth, internalHeight;
    if (selectedAspectRatio === '1:1') { internalWidth = 1024; internalHeight = 1024; }
    else if (selectedAspectRatio === 'portrait') { internalWidth = 1024; internalHeight = 1792; } // Corrected: Fabric uses Width x Height
    else { internalWidth = 1792; internalHeight = 1024; } // Landscape

    const widthRatio = availableWidth / internalWidth;
    const heightRatio = availableHeight / internalHeight;
    const scaleFactor = Math.min(widthRatio, heightRatio);

    const displayWidth = Math.min(internalWidth * scaleFactor, availableWidth);
    const displayHeight = Math.min(internalHeight * scaleFactor, availableHeight);

    // Set Fabric canvas internal dimensions
    fabricCanvas.setWidth(internalWidth);
    fabricCanvas.setHeight(internalHeight);

    // Set CSS dimensions for display scaling
    fabricCanvas.setDimensions({ width: `${displayWidth}px`, height: `${displayHeight}px` }, { cssOnly: true });

    // Update state variables used by overlays etc.
    canvasWidth = internalWidth;
    canvasHeight = internalHeight;
    canvasScale = scaleFactor; // Still potentially useful for overlays if they don't use Fabric coords

    // Update drawing content bounds (might be redundant if Fabric handles it)
    drawingContent.bounds = { width: internalWidth, height: internalHeight };

    // Debounce rendering
    if (renderDebounceTimeout) clearTimeout(renderDebounceTimeout);
    renderDebounceTimeout = setTimeout(() => {
      console.log('Rendering Fabric canvas after resize debounce');
      fabricCanvas.renderAll(); // Use renderAll for Fabric
      imageData = captureCanvasSnapshot(); // Update snapshot

      if (showShapeRecognitionDialog && drawingContent.strokes.length > 0) {
        currentCanvasSnapshot = captureCanvasSnapshot();
      }
      setTimeout(() => { isResizeEvent = false; }, 50);
    }, 100);

    console.log(
      `Fabric Canvas resized. Container: ${availableWidth}x${availableHeight}, ` +
      `Aspect: ${selectedAspectRatio}, Display: ${Math.round(displayWidth)}x${Math.round(displayHeight)}, ` +
      `Internal: ${internalWidth}x${internalHeight}, Scale: ${canvasScale}`
    );
  }

  // --- Reactive Triggers ---
  $: { // Trigger analysis on drawingContent changes (still needed for stroke analysis)
    if (drawingContent.strokes && drawingContent.strokes.length > 0) {
      if (isRealUserEdit()) {
        console.log('User edit detected (drawingContent), scheduling analysis');
        if (analysisDebounceTimer) clearTimeout(analysisDebounceTimer);
        analysisDebounceTimer = setTimeout(() => {
          if (pendingAnalysis) {
            console.log('Running analysis after debounce (drawingContent)');
            analyzeSketch(); // Uses Fabric snapshot
            recognizeStrokes(); // Uses drawingContent.strokes
            pendingAnalysis = false;
          }
        }, ANALYSIS_DEBOUNCE_MS);
      }
    }
  }

  $: { // React to aspect ratio changes
    if (browser && selectedAspectRatio) {
      resizeCanvas(); // Resize Fabric canvas
    }
  }

  // --- Event Handlers ---
  function onPointerDown(e: PointerEvent) {
    console.log(`🖱️ Pointer down at x: ${e.clientX}, y: ${e.clientY}, tool: ${$selectedTool}`);

    if (!fabricCanvas) {
      console.error("No fabric canvas available");
      return;
    }

    // Get canvas-relative coordinates
    const pointer = fabricCanvas.getPointer(e);
    console.log(`Canvas coords: x: ${pointer.x}, y: ${pointer.y}`);

    if ($selectedTool === 'pen') {
      startPenStroke(e);
    } else if ($selectedTool === 'eraser') {
      // Let Fabric handle eraser in drawing mode
    } else if ($selectedTool === 'select') {
      // Let Fabric handle selection
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDrawing) return; // Only process moves if we're actually drawing

    // Add console logging for debugging (limit frequency to avoid flooding console)
    if (currentStroke && currentStroke.points.length % 10 === 0) {
      console.log(`Pointer move at x: ${e.clientX}, y: ${e.clientY}, points: ${currentStroke.points.length}`);
    }

    if ($selectedTool === 'pen') {
      continuePenStroke(e);
    }
    // Other tools are handled by Fabric.js internally
  }

  function onPointerUp(e: PointerEvent) {
    console.log(`🖱️ Pointer up at x: ${e.clientX}, y: ${e.clientY}`);

    if (!isDrawing) return; // Only process up if we were drawing

    if ($selectedTool === 'pen') {
      endPenStroke(e);
    }
    // Other tools are handled by Fabric.js
  }

  // --- Tool Specific Functions (Adapted for Fabric) ---

  // PEN TOOL (Collect points, add Fabric path on end)
  function startPenStroke(e: PointerEvent) {
    console.log("🖋️ Starting pen stroke");

    // No need to check tool === 'pen' here, onPointerDown already did
    isDrawing = true; // Our flag to track point collection

    // Ensure Fabric modes are correct (should be handled by updateTool, but double check)
    if (fabricCanvas) {
      fabricCanvas.isDrawingMode = false;
      fabricCanvas.selection = false;
    }

    const isPen = e.pointerType === 'pen';
    isApplePencilActive.set(isPen);

    const pointer = getPointerPosition(e); // Use Fabric-aware position
    const timestamp = Date.now();
    pointTimes = [timestamp];
    const hasHardwarePressure = isPen && e.pressure > 0 && e.pressure !== 0.5;

    let currentOptions;
    const unsubscribe = strokeOptions.subscribe(options => { currentOptions = options; });
    unsubscribe();

    console.log("Current stroke options:", currentOptions);
    console.log("Current opacity:", strokeOpacity);

    currentStroke = {
      tool: 'pen',
      points: [pointer], // Use pointer from getPointerPosition
      color: currentOptions.color,
      size: currentOptions.size,
      opacity: strokeOpacity, // Use strokeOpacity directly
      hasHardwarePressure: hasHardwarePressure
    };

    console.log("Created new stroke:", currentStroke);
  }

  function continuePenStroke(e: PointerEvent) {
    if (!isDrawing || !currentStroke) return;

    const point = getPointerPosition(e);
    const timestamp = Date.now();

    // Add point to current stroke
    currentStroke.points.push(point);
    pointTimes.push(timestamp);

    console.log(`Added point: x=${point.x}, y=${point.y}, total points: ${currentStroke.points.length}`);
  }

  function endPenStroke(e: PointerEvent) {
    if (!isDrawing || !currentStroke || !fabricCanvas) {
      console.log("Not ending stroke - conditions not met", { isDrawing, hasCurrentStroke: !!currentStroke, hasFabricCanvas: !!fabricCanvas });
      return;
    }

    console.log(`🖋️ Ending pen stroke with ${currentStroke.points.length} points`);

    const strokeToAdd = { ...currentStroke }; // Clone before resetting
    isDrawing = false;
    currentStroke = null; // Reset immediately
    isApplePencilActive.set(false);

    // Add stroke data to our analysis store
    drawingContent.strokes.push(strokeToAdd);
    drawingContent = {...drawingContent}; // Trigger reactivity

    // --- Generate Fabric Path ---
    if (strokeToAdd.points.length > 1) {
      let currentOptions;
      const unsubscribe = strokeOptions.subscribe(options => { currentOptions = options; });
      unsubscribe();

      // Generate Perfect Freehand stroke points (using our stored raw points)
      const options = {
        size: strokeToAdd.size,
        thinning: currentOptions.thinning,
        smoothing: currentOptions.smoothing,
        streamline: currentOptions.streamline,
        easing: currentOptions.easing,
        simulatePressure: !strokeToAdd.hasHardwarePressure,
        start: currentOptions.start,
        end: currentOptions.end,
      };

      console.log("Creating path with options:", options);

      // Map points for Perfect Freehand (including pressure calculation)
      const enhancedPoints = strokeToAdd.points.map(p => {
        let basePressure = p.pressure || 0.5;
        let enhancedPressure = basePressure;
        // Pressure intensity logic
        if (currentOptions.pressureIntensity !== 1.0) {
            const intensityFactor = Math.max(1, currentOptions.pressureIntensity / 2);
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

      try {
        const freehandStroke = getStroke(enhancedPoints, options);
        const pathData = getSvgPathFromStroke(freehandStroke);

        if (pathData) {
          console.log("Generated path data:", pathData.substring(0, 30) + "...");

          const fabricPath = new fabric.Path(pathData, {
            fill: strokeToAdd.color,
            opacity: strokeToAdd.opacity, // Use the stroke's opacity
            strokeWidth: 0, // Perfect Freehand generates filled paths
            selectable: $selectedTool === 'select', // Selectable only if select tool is active
            evented: $selectedTool === 'select', // Events only if select tool is active
            objectCaching: false, // Crucial for performance with complex freehand paths
            // Store index for linking back to drawingContent
            data: { originalStrokeIndex: drawingContent.strokes.length - 1 }
          });

          fabricCanvas.add(fabricPath);
          fabricCanvas.requestRenderAll(); // Render the newly added path
          console.log("Added path to canvas");
        } else {
          console.error("Failed to generate path data");
        }
      } catch (error) {
        console.error("Error creating path:", error);
      }
    } else {
      console.warn("Not enough points to create a path:", strokeToAdd.points.length);
    }

    // Reset and Trigger Analysis
    lastUserEditTime = Date.now();
    pendingAnalysis = true;
    triggerAnalysis();
  }

  // ERASER TOOL (Use Fabric's EraserBrush)
  // Function not needed, handled by updateTool
  // function startEraserStroke(e: PointerEvent) { /* ... */ }

  // Function not needed, handled by Fabric
  // function continueEraserStroke(e: PointerEvent) { /* ... */ }

  // Function not needed, handled by Fabric
  // function endEraserStroke(e: PointerEvent) { /* ... */ }

  // SELECT TOOL (Use Fabric's built-in selection)
  let selectedStrokeIndices: number[] = []; // Store indices from drawingContent based on Fabric selection

  // --- Fabric Selection Event Handler ---
  function handleFabricSelection() {
    if (!fabricCanvas) return;

    const activeObjects = fabricCanvas.getActiveObjects();
    selectedStrokeIndices = activeObjects
      .map(obj => {
        // Access our custom property through the data object
        return obj.data?.originalStrokeIndex as number;
      })
      .filter(index => typeof index === 'number'); // Filter out undefined/non-numeric

    console.log('Fabric Selection Updated. Indices:', selectedStrokeIndices);
  }


  // --- Tool Switching Logic ---
  function updateTool(tool: 'pen' | 'eraser' | 'select') {
    if (!fabricCanvas) {
      console.error("Cannot update tool: No fabric canvas available");
      return;
    }

    console.log('Switching tool to:', tool);
    // The button click will update the store value

    // Deselect objects when switching away from select tool
    if ($selectedTool === 'select' && tool !== 'select') {
      fabricCanvas.discardActiveObject();
      fabricCanvas.requestRenderAll();
    }

    if (tool === 'pen') {
      // For pen, we handle drawing manually using our custom pointer handlers
      fabricCanvas.isDrawingMode = false;
      fabricCanvas.selection = false; // Disable Fabric selection while in pen mode
      fabricCanvas.defaultCursor = 'crosshair';

      // Make existing paths non-interactive during pen drawing
      fabricCanvas.forEachObject(obj => {
        if (obj instanceof fabric.Path) {
          obj.set({ selectable: false, evented: false });
        }
      });

      console.log("✅ Pen tool configured");
    } else if (tool === 'eraser') {
      // For eraser, use Fabric's built-in eraser brush
      const eraserBrush = new fabric.EraserBrush(fabricCanvas);
      eraserBrush.width = eraserSize;
      fabricCanvas.freeDrawingBrush = eraserBrush;
      fabricCanvas.isDrawingMode = true; // Enable Fabric's drawing mode
      fabricCanvas.selection = false; // Disable selection during eraser

      console.log("✅ Eraser tool configured");
    } else if (tool === 'select') {
      // For select, disable drawing and enable selection
      fabricCanvas.isDrawingMode = false;
      fabricCanvas.selection = true;
      fabricCanvas.defaultCursor = 'default';

      // Make paths interactive for selection
      fabricCanvas.forEachObject(obj => {
        if (obj instanceof fabric.Path) {
          obj.set({ selectable: true, evented: true });
        }
      });

      console.log("✅ Select tool configured");
    }

    fabricCanvas.requestRenderAll();
  }

  // Reactive effect to call updateTool when the store changes
  $: if (fabricCanvas && $selectedTool) {
    updateTool($selectedTool);
  }

  // --- Analysis Trigger ---
  function triggerAnalysis() {
     const now = Date.now();
     if (now - lastAnalysisTime > ANALYSIS_THROTTLE_MS) {
      if (analysisDebounceTimer) clearTimeout(analysisDebounceTimer);
      analysisDebounceTimer = setTimeout(() => {
        if (!isAnalyzing && !isRecognizingStrokes && pendingAnalysis) {
          analyzeSketch();
          recognizeStrokes();
          pendingAnalysis = false;
        }
      }, 300);
    }
  }

  // --- Pointer Position ---
  function getPointerPosition(e: PointerEvent): StrokePoint {
    if (!fabricCanvas) return { x: 0, y: 0, pressure: 0.5 };

    const pointer = fabricCanvas.getPointer(e);
    return {
      x: pointer.x,
      y: pointer.y,
      pressure: e.pressure !== undefined ? e.pressure : 0.5
    };
  }

  // --- Rendering (Simplified - Fabric handles internal rendering) ---
  // The old renderStrokes function is removed. We call fabricCanvas.requestRenderAll() instead.

  // --- AI Analysis Functions (Largely Unchanged, use Fabric snapshot) ---
  async function analyzeSketch() {
    if (isAnalyzing || drawingContent.strokes.length === 0) { // Still check drawingContent as proxy for "something drawn"
      console.log('Skipping sketch analysis - already analyzing or no content');
      return;
    }
    const now = Date.now();
    if (!forceAnalysisFlag && (now - lastAnalysisTime < ANALYSIS_THROTTLE_MS)) {
      console.log(`Skipping sketch analysis - throttled`);
      return;
    }
    // Skip checks based on pendingAnalysis might need adjustment if erasing should trigger analysis
    if (!forceAnalysisFlag && !pendingAnalysis) {
      console.log('Skipping sketch analysis - no pending user edits');
      return;
    }

    try {
      isAnalyzing = true;
      previousSketchAnalysis = sketchAnalysis;
      lastAnalysisTime = Date.now();
      sketchAnalysis = 'Analyzing drawing...';
      previousAnalyzedStrokeCount = drawingContent.strokes.length; // Based on raw strokes
      lastAnalyzedStrokesHash = generateStrokesHash(drawingContent.strokes); // Based on raw strokes
      pendingAnalysis = false;
      forceAnalysisFlag = false;
      console.log('Starting sketch analysis API call...');
      const timeoutMs = 20000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Capture snapshot from Fabric canvas
        const currentImageData = captureCanvasSnapshot();
        if (!currentImageData) throw new Error("Could not capture canvas image.");

        const response = await fetch('/api/ai/analyze-sketch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageData: currentImageData, // Use Fabric snapshot
            enhancedAnalysis: true,
            requestHierarchy: true,
            requestPositions: true,
            excludeTrivialElements: true,
            context: additionalContext || '',
            options: {
              complexity: drawingContent.strokes.length > 20 ? 'high' : 'normal',
              detectionMode: 'precise',
              includeConfidence: true
            }
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to analyze sketch');
        }
        const result = await response.json();
        sketchAnalysis = result.description || 'No analysis available';
        sketchAnalysisOutput = { /* ... (formatting logic same as before) ... */ };
        console.log('Formatted sketch analysis output:', sketchAnalysisOutput);

        // Process detected objects logic (same as before, uses drawingContent.strokes for findRelatedStrokes)
        if (result.detectedObjects && Array.isArray(result.detectedObjects)) {
           const processedElements: AnalysisElement[] = [];
           const currentCanvasWidth = canvasWidth; // Use internal width
           const currentCanvasHeight = canvasHeight; // Use internal height

          for (const obj of result.detectedObjects) {
                // Find strokes related to this element using drawingContent data
            const relatedStrokes = findRelatedStrokes(
                    drawingContent.strokes, // Use raw stroke data
                    obj.x * currentCanvasWidth, // Convert normalized API response to canvas coords
                    obj.y * currentCanvasHeight,
                    currentCanvasWidth,
                    currentCanvasHeight,
                    0.18,
                    true
                );

                const element: AnalysisElement = {
                    id: obj.id || `gpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                    name: obj.name || 'Unnamed Element',
                    category: obj.category || 'default',
                    x: obj.x * currentCanvasWidth, // Store as canvas coords
                    y: obj.y * currentCanvasHeight,
                    width: obj.width ? obj.width * currentCanvasWidth : undefined,
                    height: obj.height ? obj.height * currentCanvasHeight : undefined,
                color: obj.color || getColorForCategory(obj.category || 'default'),
                    isChild: obj.isChild,
                    parentId: obj.parentId,
                    children: obj.children,
                    confidence: obj.confidence || 0.8,
                };

                if (relatedStrokes.length > 0) {
                    const boundingBox = calculateMultiStrokeBoundingBox(relatedStrokes, true); // Based on raw strokes
                    const normalizedBox = normalizeBoundingBox(boundingBox, currentCanvasWidth, currentCanvasHeight);
                    element.width = Math.max(normalizedBox.width * currentCanvasWidth, 40);
                    element.height = Math.max(normalizedBox.height * currentCanvasHeight, 40);
                    element.boundingBox = {
                        minX: normalizedBox.minX, minY: normalizedBox.minY,
                        maxX: normalizedBox.maxX, maxY: normalizedBox.maxY,
                        width: normalizedBox.width, height: normalizedBox.height
                    };
                    let totalPressure = 0, pressurePoints = 0;
                    relatedStrokes.forEach(s => s.points.forEach(p => { if(p.pressure !== undefined) { totalPressure += p.pressure; pressurePoints++; }}));
                    element.pressure = pressurePoints > 0 ? totalPressure / pressurePoints : 0.5;
                    // element.originalStrokeIndex = relatedStrokes[0]... ? // Need a way to link back if required
                    console.log(`Element "${obj.name}" found with ${relatedStrokes.length} related strokes.`);
                } else {
                    element.width = element.width || calculateElementWidth(element);
                    element.height = element.height || calculateElementHeight(element);
                    element.pressure = 0.5;
              console.log(`Element "${obj.name}" found but no related strokes detected`);
            }
                processedElements.push(element);
          }

          const hasSignificantChange = hasElementsChanged(analysisElements, processedElements);
          if (hasSignificantChange || forceAnalysisFlag) {
                isArtificialEvent = true; // Prevent re-triggering analysis immediately
            analysisElements = processedElements;
            console.log('Updated analysis elements with new detection results');
                // Add short delay before resetting artificial event flag
                setTimeout(() => { isArtificialEvent = false; }, 100);
          } else {
            console.log('No significant changes in detected elements, maintaining current UI');
          }
        } else {
            console.log('Sketch analysis updated (text only):', sketchAnalysis);
            // Consider if updateAnalysisElements (which uses findRelatedStrokes) is still desired here
            // updateAnalysisElements(sketchAnalysis); // This parses text and tries to find strokes
        }

      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          console.error('Analysis request timed out');
          sketchAnalysis = 'Analysis timed out.';
        } else { throw fetchError; }
      }
    } catch (error) {
      console.error('Error analyzing sketch:', error);
      sketchAnalysis = `Error analyzing sketch: ${error instanceof Error ? error.message : 'Unknown error'}`;
      // Fallback logic (same as before)
      // if (strokeRecognition && strokeRecognition !== "...") { updateAnalysisElements(strokeRecognition); }
    } finally {
      isAnalyzing = false;
      forceAnalysisFlag = false;
    }
  }

  // Helper function to check for element changes (Unchanged)
  function hasElementsChanged(oldElements: AnalysisElement[], newElements: AnalysisElement[]): boolean {
    if (!oldElements || !newElements) return true;
    if (oldElements.length !== newElements.length) return true;
    if (newElements.length <= 3) return true; // Any change is significant for small numbers
    let changedElements = 0;
    const threshold = 0.05; // Position/size change threshold

    for (let i = 0; i < newElements.length; i++) {
      const newEl = newElements[i];
        const oldEl = oldElements.find(el => el.name === newEl.name); // Simple matching by name
      if (!oldEl) {
            changedElements++; continue;
        }
        const posChanged = Math.abs((oldEl.x / canvasWidth) - (newEl.x / canvasWidth)) > threshold ||
                           Math.abs((oldEl.y / canvasHeight) - (newEl.y / canvasHeight)) > threshold;
        const sizeChanged = !oldEl.boundingBox || !newEl.boundingBox ||
                            Math.abs(oldEl.boundingBox.width - newEl.boundingBox.width) > threshold ||
                            Math.abs(oldEl.boundingBox.height - newEl.boundingBox.height) > threshold;
        if (posChanged || sizeChanged) {
        changedElements++;
      }
    }
    return changedElements > (newElements.length * 0.25);
  }

  // Analyze stroke data (Uses drawingContent.strokes - Unchanged logic)
  async function recognizeStrokes(retries = 2, timeout = 15000) {
    if (isRecognizingStrokes || drawingContent.strokes.length === 0) {
      console.log('Skipping stroke recognition - already in progress or no strokes');
      return;
    }
    const now = Date.now();
    if (!forceAnalysisFlag && (now - lastStrokeAnalysisTime < ANALYSIS_THROTTLE_MS)) {
      console.log(`Skipping stroke recognition - throttled`);
      return;
    }
    if (!forceAnalysisFlag && !pendingAnalysis) {
      console.log('Skipping stroke recognition - no pending user edits');
      return;
    }
    const currentStrokesHash = generateStrokesHash(drawingContent.strokes);
    if (!forceAnalysisFlag && currentStrokesHash === lastStrokeAnalyzedHash) {
      console.log('Skipping stroke recognition - strokes unchanged');
      pendingAnalysis = false;
      return;
    }

    try {
      isRecognizingStrokes = true;
      previousStrokeRecognition = strokeRecognition;
      lastStrokeAnalysisTime = Date.now();
      strokeRecognition = 'Analyzing strokes...';
      previousRecognizedStrokeCount = drawingContent.strokes.length;
      lastStrokeAnalyzedHash = currentStrokesHash;
      pendingAnalysis = false;
      forceAnalysisFlag = false;
      console.log('Starting stroke recognition API call...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const validStrokes = drawingContent.strokes.filter(stroke =>
          stroke && stroke.points && Array.isArray(stroke.points) && stroke.points.length > 0
        );
        if (validStrokes.length === 0) throw new Error('No valid points in strokes');

        const response = await fetch('/api/ai/analyze-strokes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            strokes: validStrokes, // Send raw stroke data
            enhancedAnalysis: true,
            context: additionalContext || '',
            options: {
              complexity: 'high',
              preferredRecognizer: 'hybrid',
              includeConfidence: true,
              includeTfObjects: true,
              detectComplexObjects: true,
              improveStructuralUnderstanding: true
            }
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          let errorMessage = `Server error: ${response.status}`;
            try { errorMessage = (await response.json()).error || errorMessage; } catch (e) {}
          throw new Error(errorMessage);
        }
        const result = await response.json();
        recognitionResult = result;
        strokesAnalysisOutput = result;

        // Format result description (same as before)
        if (result.analysis.type === 'drawing') {
          const confidence = Math.round(result.analysis.confidence * 100);
          strokeRecognition = `Recognized as: ${result.analysis.content} (${confidence}% confident)`;
          // Add alternatives logic (same as before)
          if (result.debug?.shapeRecognition?.allMatches?.length > 1) {
             const alternatives = result.debug.shapeRecognition.allMatches.slice(1, 3).map(m => `${m.name} (${Math.round(m.confidence*100)}%)`).join(', ');
             if (alternatives) strokeRecognition += `
Alternatives: ${alternatives}`;
          }

          // Update analysis elements if stroke recognition provides shapes
          if (result.detectedShapes && Array.isArray(result.detectedShapes) &&
              (forceAnalysisFlag || !analysisElements.length || analysisElements.length < result.detectedShapes.length)) {

              const currentCanvasWidth = canvasWidth;
              const currentCanvasHeight = canvasHeight;

               // Process shapes (uses findRelatedStrokes with drawingContent)
            const enhancedShapes = result.detectedShapes.map(shape => {
                    const relatedStrokes = findRelatedStrokes(drawingContent.strokes, shape.x * currentCanvasWidth, shape.y * currentCanvasHeight, currentCanvasWidth, currentCanvasHeight, 0.2);
                    const element: AnalysisElement = {
                        id: shape.id || `shape_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                        name: shape.name || 'Unnamed Shape',
                        category: shape.category || 'geometric',
                        x: shape.x * currentCanvasWidth,
                        y: shape.y * currentCanvasHeight,
                        color: shape.color || '#cccccc', // Default color for shapes
                        confidence: shape.confidence || 0.7,
                    };
              if (relatedStrokes.length > 0) {
                const boundingBox = calculateMultiStrokeBoundingBox(relatedStrokes);
                        const normalizedBox = normalizeBoundingBox(boundingBox, currentCanvasWidth, currentCanvasHeight);
                        element.width = Math.max(normalizedBox.width * currentCanvasWidth, 30);
                        element.height = Math.max(normalizedBox.height * currentCanvasHeight, 30);
                        element.boundingBox = { ...normalizedBox };
                        // element.originalStrokeIndex = ... // Link if needed
                    } else {
                         element.width = shape.width ? shape.width * currentCanvasWidth : 50; // Default size
                         element.height = shape.height ? shape.height * currentCanvasHeight : 50;
                    }
                    return element;
                });

            const hasSignificantChange = hasElementsChanged(analysisElements, enhancedShapes);
            if (hasSignificantChange || forceAnalysisFlag) {
              isArtificialEvent = true;
                    analysisElements = enhancedShapes; // Replace or merge as needed
              console.log('Updated analysis elements with stroke recognition results');
                    setTimeout(() => { isArtificialEvent = false; }, 100);
            } else {
                    console.log('No significant changes in detected shapes from strokes, maintaining current UI');
            }
          }
        } else if (result.analysis.type === 'text') {
          strokeRecognition = `Detected handwritten text: ${result.analysis.content || ''}`;
        } else {
          strokeRecognition = `Unrecognized pattern`;
        }
        console.log('Stroke recognition updated:', strokeRecognition);

      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          throw new Error('Recognition request timed out.');
        }
        if (fetchError.message && fetchError.message.includes('Failed to fetch')) {
           throw new Error('Network error: Unable to connect.');
        }
        if (retries > 0) {
          console.log(`Retrying recognition... (${retries} attempts left)`);
          strokeRecognition = 'Connection issue, retrying...';
          await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries)));
          return await recognizeStrokes(retries - 1, timeout);
        }
        throw fetchError;
      }
    } catch (error) {
      console.error('Error recognizing strokes:', error);
      // User-friendly error message logic (same as before)
      if (error.message?.includes('Network error')) strokeRecognition = error.message;
      else if (error.message?.includes('timed out')) strokeRecognition = 'Recognition service timed out.';
      else if (error.message?.includes('No valid')) strokeRecognition = 'Please draw something recognizable.';
      else strokeRecognition = `Error recognizing strokes: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errorMessage = strokeRecognition;
      setTimeout(() => { errorMessage = null; }, 5000);
    } finally {
      isRecognizingStrokes = false;
      forceAnalysisFlag = false;
    }
  }

  // --- Canvas Actions ---
  function clearCanvas() {
    fabricCanvas?.clear(); // Clear Fabric canvas
    drawingContent.strokes = []; // Clear raw stroke data
    drawingContent = drawingContent; // Trigger reactivity
    analysisElements = []; // Clear analysis elements
    // selectedStrokeIndices = []; // Clear selection - Handled by Fabric selection:cleared event
    generatedImageUrl.set(null);
    generatedByModel.set(null);
    editedImageUrl.set(null);
    editedByModel.set(null);
    currentCanvasSnapshot = '';
    sketchAnalysis = "Draw something to see AI's interpretation";
    strokeRecognition = "Draw something to see shapes recognized";
    imageData = captureCanvasSnapshot(); // Update snapshot after clearing
  }

  // Function to generate image (Uses Fabric snapshot, drawingContent for context)
  async function generateImage() {
    if (drawingContent.strokes.length === 0) { // Check raw strokes
      errorMessage = "Please draw something first!";
      setTimeout(() => { errorMessage = null; }, 3000);
      return;
    }
    console.log('Starting image generation with', drawingContent.strokes.length, 'raw strokes');
    if (additionalContext) console.log('Additional context:', additionalContext);

    const currentImageData = captureCanvasSnapshot(); // Get Fabric snapshot
    if (!currentImageData) {
        errorMessage = "Could not capture drawing.";
        setTimeout(() => { errorMessage = null; }, 3000);
        return;
    }
    imageData = currentImageData; // Update preview

    try {
      isGenerating.set(true); isEditing.set(true); errorMessage = null;
      generatedByModel.set(null); generatedImageUrl.set(null);
      editedByModel.set(null); editedImageUrl.set(null);
      generatedImageAspectRatio = selectedAspectRatio;

      // Use raw stroke data for context/payload if needed by backend, but image comes from Fabric
      const drawingContentCopy = JSON.parse(JSON.stringify(drawingContent));
      const currentPrompt = $gptImagePrompt;
      const currentEditPrompt = $gptEditPrompt;

      // Structure data uses current canvas dimensions
      const structureData = { aspectRatio: selectedAspectRatio, canvasWidth, canvasHeight, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, pixelRatio: window.devicePixelRatio || 1 };

      // Enhanced objects based on analysisElements (using canvas coordinates)
      const enhancedObjects = analysisElements.map(obj => ({
        label: obj.label || obj.name || 'object',
        x: obj.x / canvasWidth, y: obj.y / canvasHeight, // Normalize
        width: (obj.width || 50) / canvasWidth, height: (obj.height || 50) / canvasHeight, // Normalize, provide default
        centerX: (obj.x + (obj.width || 50)/2) / canvasWidth, centerY: (obj.y + (obj.height || 50)/2) / canvasHeight,
        confidence: obj.confidence || 1.0
      }));

      // Payloads use Fabric snapshot and drawingContent for context
      const requestPayload = {
        drawingContent: drawingContentCopy, // Raw strokes for context
        imageData: currentImageData,        // Visual snapshot from Fabric
        additionalContext, aspectRatio: selectedAspectRatio,
        sketchAnalysis, strokeRecognition, prompt: currentPrompt,
        structureData, detectedObjects: enhancedObjects
      };
      const editRequestPayload = { ...requestPayload, prompt: currentEditPrompt };

      // API calls (same as before)
      const [standardResponse, editResponse] = await Promise.all([
        fetch('/api/ai/generate-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestPayload) }),
        fetch('/api/ai/edit-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editRequestPayload) })
      ]);

      // Response handling (same as before)
      if (standardResponse.ok) {
        const standardResult = await standardResponse.json();
        const standardImageUrl = standardResult.imageUrl || standardResult.url;
        if (standardImageUrl) { generatedImageUrl.set(standardImageUrl); generatedByModel.set(standardResult.model || 'gpt-image-1'); if (standardResult.aspectRatio) { generatedImageAspectRatio = standardResult.aspectRatio; } }
        else { console.error('No image URL in standard response:', standardResult); }
      } else { console.error('Failed standard generation:', standardResponse.status, standardResponse.statusText); }

      if (editResponse.ok) {
        const editResult = await editResponse.json();
        const editImageUrl = editResult.imageUrl || editResult.url;
        if (editImageUrl) { editedImageUrl.set(editImageUrl); editedByModel.set(editResult.model || 'gpt-image-1-edit'); }
        else { console.error('No image URL in edit response:', editResult); }
      } else { console.error('Failed edit generation:', editResponse.status, editResponse.statusText); }

      if (!standardResponse.ok && !editResponse.ok) throw new Error('Failed to generate both images');

    } catch (error) {
      console.error('Error generating images:', error);
      errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    } finally {
      isGenerating.set(false); isEditing.set(false);
    }
  }

  // --- Helper Functions (Unchanged or minor adaptations) ---
  function calculateElementWidth(element) { /* ... (same logic) ... */ return 120; }
  function calculateElementHeight(element) { /* ... (same logic) ... */ return 120; }
  function getColorForCategory(category) { /* ... (same logic) ... */ return '#FF5733'; }
  function updateAnalysisElements(analysisText) { /* ... (same logic, uses drawingContent) ... */ }
  function getPositionFromText(position1, position2) { /* ... (same logic) ... */ return { x: 0.5, y: 0.5 }; }
  function getCategoryFromObjectName(name) { /* ... (same logic) ... */ return 'detail'; }
  function generateStrokesHash(strokes: any[]): string { /* ... (same logic) ... */ return JSON.stringify(strokes); }

  // --- UI Interaction Functions (Unchanged) ---
  function toggleVisualizationMode() { /* ... (same logic) ... */ }
  function handleGPTOverlayToggle() { /* ... (same logic) ... */ }
  function handleTFOverlayToggle() { /* ... (same logic) ... */ }

  $: { // TF/GPT object filtering (Unchanged)
    tfObjects = (analysisElements || []).filter(obj => { const s = obj?.source || ''; return s === 'tensorflow' || s === 'cnn'; });
    gptObjects = (analysisElements || []).filter(obj => { const s = obj?.source || ''; return s !== 'tensorflow' && s !== 'cnn'; });
  }

  function onCanvasEdit(editType: string, data?: any) { /* ... (same logic) ... */ }

  // Capture snapshot using Fabric
  function captureCanvasSnapshot(): string {
    if (!fabricCanvas) return '';
    try {
      // Ensure canvas is rendered - though Fabric usually handles this
      // fabricCanvas.renderAll(); // Might be needed if updates aren't immediate
      return fabricCanvas.toDataURL({ format: 'png', quality: 0.9 }); // Use Fabric's method
    } catch (error) {
      console.error('Error capturing Fabric canvas snapshot:', error);
      return '';
    }
  }

  function handleEnhancedObjects(event) { /* ... (same logic) ... */ }
  function updatePromptWithObjects(objects) { /* ... (same logic) ... */ }
  let detectedObjectsText = '';
  function handleTFObjects(event) { /* ... (same logic) ... */ }
  function updateTFObjectsInPrompt(objects) { /* ... (same logic) ... */ }
  let tfDetectedObjectsText = '';
  function handleAnalysisOptionsChanged(event) { /* ... (same logic) ... */ }
  async function analyzeDrawing() { /* ... (Modified to use Fabric snapshot, keep core logic) ... */ }
  function mobileCheck() { /* ... (same logic, calls resizeCanvas) ... */ }
  function captureCanvas() { return captureCanvasSnapshot(); } // Alias
  function runAnalysis(force = false) { /* ... (same logic) ... */ }
  function analyzeResults(result) { /* ... (same logic) ... */ }
  function computeStrokesHash(strokes) { return generateStrokesHash(strokes); } // Alias

  // --- Shape Dialog State (Unchanged) ---
  let showShapeRecognitionDialog = false;
  let showAIDebugMode = false;
  let buttonPosition = { right: '20px', bottom: '20px' };
  let shapeDialogPosition = { right: '20px', top: '20px' };

  // --- Aspect Ratio State (Unchanged) ---
  let selectedAspectRatio = '1:1';
  const aspectRatios = { '1:1': 1/1, 'portrait': 1024/1792, 'landscape': 1792/1024 };
  let generatedImageAspectRatio = '1:1';

  $: { // Update generated aspect ratio when selection changes (Unchanged)
    if (selectedAspectRatio) {
      generatedImageAspectRatio = selectedAspectRatio;
      if (browser) { resizeCanvas(); } // Resize already handles Fabric
    }
  }

  // --- Dialog Toggles (Unchanged) ---
  function toggleShapeRecognitionDialog() {
    showShapeRecognitionDialog = !showShapeRecognitionDialog;
    if (showShapeRecognitionDialog && drawingContent.strokes.length > 0) { // Check raw strokes
      currentCanvasSnapshot = captureCanvasSnapshot(); // Use Fabric snapshot
    }
  }
  function toggleDebugMode() { showAIDebugMode = !showAIDebugMode; }

  // --- Component Cleanup ---
  onDestroy(() => {
      if (fabricCanvas) {
          // Remove event listeners
          fabricCanvas.off('selection:created', handleFabricSelection);
          fabricCanvas.off('selection:updated', handleFabricSelection);
          fabricCanvas.off('selection:cleared', handleFabricSelection);
          fabricCanvas.dispose();
      }
      if (analysisDebounceTimer) clearTimeout(analysisDebounceTimer);
      if (renderDebounceTimeout) clearTimeout(renderDebounceTimeout);
      unsubscribeStrokeOptions(); // Ensure unsubscription
  });

</script>

<svelte:head>
  <title>Daydream Canvas</title>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
</svelte:head>

<div id = 'app'>
<div class="draw-demo-container">
  <header class="demo-header">
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
        disabled={$isGenerating || strokeCount === 0}
      >
        <span class="material-icons">arrow_forward</span>
        {$isGenerating ? 'Creating...' : 'Create'}
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
          on:click={() => updateTool('pen')}
          title="Pen Tool"
        >
          <span class="material-icons">edit</span>
        </button>
        <button
          class="tool-button"
          class:active={$selectedTool === 'eraser'}
          on:click={() => updateTool('eraser')}
          title="Eraser Tool"
        >
          <!-- Use a standard eraser icon -->
          <span class="material-icons">design_services</span>
        </button>
        <button
          class="tool-button"
          class:active={$selectedTool === 'select'}
          on:click={() => updateTool('select')}
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
                on:input={(e) => { // Use on:input for immediate feedback
                  strokeColor = e.currentTarget.value;
                  strokeOptions.update(opts => ({...opts, color: strokeColor}));
                }}
              />
            </div>


            <div class="tool-group">
              <VerticalSlider
                min={1}
                max={50}
                step={0.5}
                bind:value={strokeSize}
                color="#333"
                height="120px"
                showValue={true}
              />
              <label style="color: #ccc; font-size: 10px;">Stroke</label>
            </div>

            <div class="tool-group">
              <VerticalSlider
                min={1}
                max={50}
                step={1}
                bind:value={eraserSize}
                color="#FF5733"
                height="120px"
                onChange={() => {
                  // Update eraser brush width if it's active
                   if (fabricCanvas && $selectedTool === 'eraser' && fabricCanvas.freeDrawingBrush) {
                      fabricCanvas.freeDrawingBrush.width = eraserSize;
                  }
                }}
                showValue={true}
              />
              <label style="color: #ccc; font-size: 10px;">Eraser</label>
            </div>


            <div class="tool-group">
              <VerticalSlider
                min={0.1}
                max={1.0}
                step={0.1}
                bind:value={strokeOpacity}
                color="#666"
                height="120px"
                showValue={true}
              />
              <label style="color: #ccc; font-size: 10px;">Opacity</label>
            </div>

            <button class="tool-button" on:click={clearCanvas}>
              <span class="material-icons">delete_outline</span>
            </button>


          </div>
      </div>
    </div>

    <div class="canvas-wrapper input-canvas" class:ratio-1-1={selectedAspectRatio === '1:1'} class:ratio-portrait={selectedAspectRatio === 'portrait'} class:ratio-landscape={selectedAspectRatio === 'landscape'}>
      <!-- Canvas element for Fabric.js -->
      <canvas
        id="fabric-canvas"
        bind:this={fabricCanvasEl}
        class="drawing-canvas"
        style="position: absolute; top: 0; left: 0;"
        width={canvasWidth}
        height={canvasHeight}
      ></canvas>


      <!-- Overlays - Need careful positioning/scaling relative to Fabric canvas -->
      <!-- The overlays still use `canvasWidth` and `canvasHeight` which are the *internal* Fabric dimensions -->
      <!-- They also use `canvasScale` which relates internal res to CSS display size -->
      <!-- This *might* work if overlays scale themselves correctly based on these props -->
      {#if showAnalysisView && (analysisElements.length > 0 || (drawingContent?.strokes?.length === 0 && !analysisElements.length))}
        {#if showGPTOverlay}
          <div class="ai-overlay-wrapper" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
            <AIOverlay
              detectedObjects={analysisElements}
              width={canvasWidth}
              height={canvasHeight}
              visible={showAnalysisView && showGPTOverlay}
              canvasRef={null}
              strokes={drawingContent.strokes as any[]}
              isAnalyzing={isAnalyzing}
              waitingForInput={!isAnalyzing && drawingContent.strokes.length === 0}
              canvasZoom={canvasScale}
              debugMode={false}
              on:enhancedObjects={handleEnhancedObjects}
            />
          </div>
        {/if}

        {#if showTFOverlay}
          <TFOverlay
            analysisObjects={tfObjects}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            visible={showAnalysisView && showTFOverlay}
            isAnalyzing={isRecognizingStrokes}
            waitingForInput={drawingContent?.strokes?.length === 0 && !analysisElements.length}
            strokes={drawingContent?.strokes || [] as any}
            on:detectedObjects={handleTFObjects}
            canvasScale={canvasScale}
          />
        {/if}
      {/if}

      {#if showStrokeOverlay && drawingContent.strokes.length > 0}
        <StrokeOverlay
          strokes={drawingContent.strokes}
          detectedObjects={analysisElements}
          width={canvasWidth}
          height={canvasHeight}
          visible={showStrokeOverlay}
          canvasRef={null}
          canvasScale={canvasScale}
        />
      {/if}
    </div>

    <div class="canvas-wrapper output-canvas" class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-portrait={generatedImageAspectRatio === 'portrait'} class:ratio-landscape={generatedImageAspectRatio === 'landscape'}>
      <div class="output-display" class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-portrait={generatedImageAspectRatio === 'portrait'} class:ratio-landscape={generatedImageAspectRatio === 'landscape'}>
        {#if $editedImageUrl}
          <img src={$editedImageUrl} alt="AI generated image" />
          {#if $generatedByModel}
            <div class="model-badge">
              Generated by {$generatedByModel === 'gpt-image-1' ? 'GPT-image-1' : $generatedByModel}
            </div>
          {/if}
        {:else}
          <div class="drawing-preview" style="aspect-ratio: {canvasWidth}/{canvasHeight}">
            {#if imageData}
              <img src={imageData} alt="Drawing preview" class="drawing-preview-image" style="width: 100%; height: 100%; object-fit: contain;" />

              {#if $isGenerating}
                <div class="ai-scanning-animation">
                  <div class="scanning-status">
                    <h2> Creating ... </h2>
                  </div>
                </div>
              {/if}
              {:else}
              <p>Your AI-generated image will appear here</p>
            {/if}
          </div>
        {/if}

        <!-- Output Overlay -->
        <div class="output-overlay-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10;">
          <AIOverlay
            detectedObjects={analysisElements}
            width={canvasWidth}
            height={canvasHeight}
            visible={showAnalysisView && showGPTOverlay}
            canvasRef={null}
            strokes={drawingContent.strokes as any[]}
            isAnalyzing={isAnalyzing}
            waitingForInput={!isAnalyzing && drawingContent.strokes.length === 0}
            canvasZoom={canvasScale}
            debugMode={false}
            on:enhancedObjects={handleEnhancedObjects}
          />
        </div>
      </div>
    </div>
  </div>

  <div class="action-area">
     <!-- Shape Recognition Dialog and Button (Unchanged) -->
     <!-- Removed ShapeRecognitionButton toggle for brevity -->
    <ShapeRecognitionDialog
      show={showShapeRecognitionDialog}
      position={shapeDialogPosition}
      detectedObjects={analysisElements}
      isAnalyzing={isAnalyzing || isRecognizingStrokes}
      isAnalyzingText={isAnalyzing}
      sketchAnalysis={sketchAnalysis}
      strokeRecognition={strokeRecognition}
      debugMode={showAIDebugMode}
      on:close={() => showShapeRecognitionDialog = false}
      on:toggleDebug={toggleDebugMode}
      canvasSnapshot={currentCanvasSnapshot}
      sketchAnalysisOutput={sketchAnalysisOutput}
      strokesAnalysisOutput={strokesAnalysisOutput}
      on:optionsChanged={handleAnalysisOptionsChanged}
      on:refreshAnalysis={() => {
        forceAnalysisFlag = true;
        analyzeDrawing(); // Uses Fabric snapshot now
      }}
    />

    {#if showDebugPressure && drawingContent.strokes.length > 0}
      <!-- Debug Pressure Overlay would need coordinates adjusted for Fabric canvas -->
       <div class="pressure-debug-overlay" style="width: {canvasWidth}px; height: {canvasHeight}px; transform: scale({canvasScale})">
        {#each drawingContent.strokes as stroke, i}
          {#each stroke.points as point, j}
            {#if point.pressure !== undefined}
              <div
                class="pressure-point"
                style="
                  left: {point.x}px;
                  top: {point.y}px;
                  background-color: hsl({Math.floor(point.pressure * 240)}, 100%, 50%);
                  opacity: {point.pressure};
                  width: {Math.max(4, point.pressure * 16)}px;
                  height: {Math.max(4, point.pressure * 16)}px;
                "
                title="Pressure: {point.pressure.toFixed(2)}"
              ></div>
            {/if}
          {/each}
        {/each}
    </div>
    {/if}

  </div>
</div>
</div>

<style lang="scss">
/* Styles are intentionally kept identical to the original file */
/* Minor adjustments might be needed for Fabric's container if layout breaks, but avoiding changes as requested */

  #app{
    height: 100vh;
    width: 100%;
    overflow: hidden;
  }

  .draw-demo-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    box-sizing: border-box;
    height: 100vh;
    width: 100%;
    padding: 12px;
  }

  .demo-header {
    text-align: center;
    margin-bottom: 1rem;
    z-index: 10; /* Ensure header is above canvas */
    position: relative; /* Needed for z-index */

    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    p {
      font-size: 1rem;
      color: #666;
      margin-bottom: 1rem;
    }

    .context-input-container {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 0.5rem;
      width: 550px;
      padding: 8px;
      border: 1px solid rgba(white, 0.05);
      background: rgba(0,0,0, .5); // Darker semi-transparent background
      backdrop-filter: blur(10px); // Blur effect
      border-radius: 32px;
      text-align: center;
      box-shadow: -4px 16px 24px rgba(black, 0.2);
      text-shadow: 0 4px 12px rgba(black, .1);

      .context-input {
        font-family: 'Newsreader', 'DM Sans', serif;
        font-size: 18px;
        font-weight: 600;
        letter-spacing: -.5px;
        color: white;
        background: none;
        border: none;
        flex: 1;
        padding: 4px 8px;


        &::placeholder {
          color: rgba(white, .3);
        }

        &:focus {
          outline: none;
        }
      }
    }
  }

  .generate-button, .analyze-button {

      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      background: #635FFF;
      border: none;
      border-radius: 24px;
      padding: 8px 16px 10px 12px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: -4px 12px 16px rgba(black, .1);
      position: relative;
      overflow: hidden;
      color: white;

      span{
        color: white;
      }

      &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(45deg, rgba(255,255,255,0.1), rgba(255,255,255,0));
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 15px rgba(99, 95, 255, 0.4); // Use button color for shadow

        &::before {
          opacity: 1;
        }
      }

      &:active {
        transform: translateY(1px);
        box-shadow: 0 2px 5px rgba(99, 95, 255, 0.4);
      }

      &:disabled {
        background: #9e9e9e; // Simpler disabled background
        cursor: not-allowed;
        box-shadow: none;
        opacity: 0.6;

        &:hover {
          transform: none;
          box-shadow: none;
           &::before {
             opacity: 0;
           }
        }
      }

      .material-icons {
        font-size: 18px;
      }
    }

  .canvas-container {
    display: flex;
    justify-content: center;
    align-items: flex-start; // Align items to the top
    flex-grow: 1; // Allow container to grow
    gap: 24px;
    margin: 12px 0;
    width: 100%; // Use full width
    max-width: calc(100vw - 40px); // Max width respecting padding
    height: calc(100vh - 150px); // Adjust height based on header/footer estimate
    max-height: calc(100vh - 150px);
    position: relative;
    overflow: hidden; // Hide overflow

    .toolbars-wrapper {
      display: flex;
      flex-direction: column;
      gap: 10px;
      height: fit-content;
      z-index: 5;
      margin-top: 20px; // Add margin to push toolbars down slightly
    }

    @media (max-width: 768px) {
      flex-direction: column;
      height: auto; // Adjust height for mobile
      max-height: none;
      align-items: center; // Center items vertically on mobile

      .toolbars-wrapper {
        flex-direction: row;
        width: 100%;
        justify-content: center;
        gap: 15px;
        margin-top: 0;
        margin-bottom: 10px; // Space below toolbars on mobile
      }
    }
  }

  /* Toolbar styles */
  .vertical-toolbar {
    background: rgba(30, 30, 30, 0.7); // Darker semi-transparent background
    backdrop-filter: blur(10px); // Blur effect
    border-radius: 8px;
    box-shadow: -4px 16px 24px rgba(black, 0.15);
    padding: 12px 6px;
    box-sizing: border-box;
    width: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;

    &.tool-selector-toolbar {
      gap: 10px;
    }

    &.options-toolbar {
      gap: 20px;
    }
  }

  .tool-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    width: 100%;

     label { // Style for slider labels
        color: #ccc;
        font-size: 10px;
        margin-top: 4px; // Space above label
     }
  }

  .tool-icon-label {
    color: #ccc;
    font-size: 18px;
  }

  input[type="color"] {
    -webkit-appearance: none;
    appearance: none; // Standard property
    border: none;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 50%; // Make it circular
    cursor: pointer;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.2); // Subtle border
  }

  input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
  input[type="color"]::-webkit-color-swatch { border: none; border-radius: 50%; }
  input[type="color"]::-moz-color-swatch { border: none; border-radius: 50%; } // Firefox

  .canvas-wrapper {
    flex: 1; // Allow wrappers to take space
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden; // Important for containing Fabric canvas
    transition: all 0.3s ease;
    border-radius: 8px; // Keep rounded corners for the wrapper
    max-width: 50%; // Limit max width for side-by-side layout
    max-height: 100%; // Limit max height

    /* Style the Fabric canvas container */
    .canvas-container { // This class is added by Fabric
        width: 100%;
        height: 100%;
        position: relative;
    }

    /* Target the actual canvas element Fabric creates/uses */
    canvas.drawing-canvas, .upper-canvas { // Target Fabric's upper canvas too
        //position: absolute; // Fabric handles positioning
        //top: 0;
        //left: 0;
        border-radius: 8px; // Apply border radius to the canvas itself
        margin: 0;
        display: block;
        max-width: 100%;
        max-height: 100%;
        object-fit: contain; // Use contain to fit within wrapper
        cursor: crosshair; // Default cursor
        box-shadow: -12px 32px 32px rgba(black, 0.4);
      }

    &.input-canvas {
      // Specific styles if needed
    }

    &.output-canvas {
       // Specific styles if needed
    }

    // Aspect ratio classes applied to the wrapper
    &.ratio-1-1 { aspect-ratio: 1 / 1; }
    &.ratio-portrait { aspect-ratio: 1024 / 1792; }
    &.ratio-landscape { aspect-ratio: 1792 / 1024; }

    h2 { /* Style for potential text inside wrapper */
      margin: 0 0 1rem 0;
      font-size: 1.25rem;
      color: #555;
    }
  }

  .output-display {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    border-radius: 8px; // Rounded corners for the display area
    overflow: hidden; // Clip content

    // Aspect ratio classes applied to the display div
    &.ratio-1-1 { aspect-ratio: 1 / 1; }
    &.ratio-portrait { aspect-ratio: 1024 / 1792; }
    &.ratio-landscape { aspect-ratio: 1792 / 1024; }

    img {
      display: block; // Ensure img behaves like a block
      max-width: 100%;
      max-height: 100%;
      object-fit: contain; // Fit image within the container
      transition: transform 0.3s ease;
      // Remove box-shadow and border-radius from img, apply to parent
    }

    .model-badge {
      position: absolute;
      bottom: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.8rem;
      backdrop-filter: blur(4px);
      z-index: 1; // Ensure badge is above image
    }
  }

  .action-area {
    // Styles remain the same
    }

    .error-message {
    // Styles remain the same
  }

  // --- Overlay Positioning ---
  // Overlays need to be positioned absolutely within their respective canvas-wrapper
  .ai-overlay-wrapper, .tf-overlay-wrapper, .stroke-overlay-wrapper, .pressure-debug-overlay, .output-overlay-container {
    position: absolute;
    top: 0;
      left: 0;
    width: 100%; // Cover the wrapper
    height: 100%; // Cover the wrapper
    pointer-events: none; // Allow interaction with canvas below
      display: flex;
      justify-content: center;
    align-items: center;
    overflow: hidden; // Prevent overlay content spilling out
  }

  // --- AIOverlay/TFOverlay/StrokeOverlay Components ---
  // Assuming these components internally handle scaling based on the width/height props passed
  // They receive the *internal* canvas dimensions. If they render SVG/elements directly,
  // they might need the `canvasScale` prop as well to adjust their coordinate system or viewbox.
  // For now, assuming they manage scaling internally.

  .pressure-debug-overlay {
     // Needs careful scaling if using absolute positioning for points
     // Applying scale here, points inside use canvas coords
     transform-origin: top left;
  }

  .pressure-point {
    // Styles remain the same
  }

  // --- Drawing Preview ---
  .drawing-preview {
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
    position: relative; // Needed for absolute positioned children
    color: rgba(white, 0.3); // Lighter text
    font-size: 1rem;
    text-align: center;
  }

  .drawing-preview-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0.1; // Translucent preview
    position: absolute; // Position behind text/animations
    top: 0;
    left: 0;
  }

  .ai-scanning-animation{
    position: relative; // Position relative to preview container
    z-index: 1; // Ensure it's above the preview image
    display: flex;
    flex-direction: column; // Stack text/spinner
    justify-content: center;
    align-items: center;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0, 0.3); // Semi-transparent overlay during generation

    h2{
      color: white;
      font-size: 1.2em;
      margin-bottom: 10px; // Space between text and spinner
      text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    }

    /* Add a simple spinner */
    &::after {
        content: '';
    display: block;
        width: 30px;
        height: 30px;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spinner 0.8s linear infinite;
    }
  }

  @keyframes spinner { to { transform: rotate(360deg); } }


  /* Tool button active state */
  .tool-button.active {
    background: rgba(#6355FF, 0.2);
    .material-icons {
      color: #6355FF;
    }
  }

  /* Ensure Fabric's selection box is visible */
  .canvas-container .upper-canvas {
      // Fabric's upper canvas handles selection, cursors etc.
      // Ensure it's on top and interactive when needed.
      z-index: 2; // Above the lower canvas
  }

</style>