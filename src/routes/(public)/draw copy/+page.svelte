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
  import ShapeRecognitionDialog from '$lib/components/ShapeRecognitionDialog.svelte';
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
    selectedTool,
    selectedModel
  } from '$lib/stores/drawStore';

  // Interface extension for Stroke type with hasPressure property
  interface EnhancedStroke extends Stroke {
    hasPressure?: boolean;
    hasHardwarePressure?: boolean; // Flag for true hardware pressure support
    isEraserStroke?: boolean; // Flag for eraser strokes
  }

  // Drawing content object with enhanced strokes
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
  }


  // State variables
  let inputCanvas: HTMLCanvasElement;
  let inputCtx: CanvasRenderingContext2D | null = null;
  let isDrawing = false;
  let currentStroke: EnhancedStroke | null = null;
  // Use the store values for reference but maintain local variables for reactivity
  let strokeColor: string;
  let strokeSize: number;
  let strokeOpacity: number;

  // Subscribe to store changes
  strokeOptions.subscribe(options => {
    strokeColor = options.color;
    strokeSize = options.size;
    strokeOpacity = options.opacity;

    // Re-render strokes when stroke options change to apply taper settings
    if (inputCanvas && inputCtx && drawingContent?.strokes?.length > 0) {
      renderStrokes();
    }
  });

  let imageData: string | null = null;
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
  let analysisElements: any[] = [];
  let showDebugPressure = false; // Toggle for pressure visualization
  let tfObjects: any[] = [];
  let gptObjects: any[] = [];
  let visualizationMode = 'gpt'; // Options: 'gpt', 'tensorflow', 'both'

  // Add canvasScale variable
  let canvasScale = 1; // Scale factor for canvas display relative to internal resolution

  // Drawing content with enhanced strokes
  let drawingContent: EnhancedDrawingContent = {
    strokes: [],
    bounds: { width: 800, height: 600 }
  };

  // Canvas dimensions
  let canvasWidth = 800;
  let canvasHeight = 600;

  // Overlay visibility controls
  let showGPTOverlay = true;  // Control for GPT overlay visibility
  let showTFOverlay = true;   // Control for TensorFlow overlay visibility

  // Constants for throttling analysis
  const ANALYSIS_THROTTLE_MS = 3000; // Increase from 2000ms to 3000ms for better throttling
  const ANALYSIS_DEBOUNCE_MS = 1500; // Adds a debounce to wait 1.5s after editing before analyzing

  // Variables for tracking user edits and analysis state
  let pendingAnalysis = false;
  let lastUserEditTime = 0;
  let lastAnalyzedStrokesHash = '';
  let lastStrokeAnalyzedHash = '';
  let forceAnalysisFlag = false;
  let isResizeEvent = false;
  let analysisDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let renderDebounceTimeout: ReturnType<typeof setTimeout> | null = null; // Declare the missing variable
  let isArtificialEvent = false; // Flag for programmatically triggered events
  let previousAnalyzedStrokeCount = 0; // Track stroke count for analysis
  let previousRecognizedStrokeCount = 0; // Track stroke count for recognition

  // Variables for latest analysis results from API endpoints
  let sketchAnalysisOutput: any = null; // Store the full sketch analysis result
  let strokesAnalysisOutput: any = null; // Store the full stroke analysis result
  let currentCanvasSnapshot: string = ''; // Store the canvas snapshot for displaying in shape recognition dialog

  // Function to build the prompt for GPT-Image-1
  function buildGptImagePrompt() {
    let prompt = `Complete this drawing. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;

    /*
    prompt += `ABSOLUTE RULE: The generated image MUST maintain the PRECISE:
1. Exact positions of ALL elements on the canvas (preserve their x,y coordinates)
2. Direct front-facing, straight-on perspective without any angling or skewing
3. Proportions and sizes of ALL elements relative to each other and the canvas
4. Orientations and facing directions exactly as in the sketch
5. Exact spatial relationships between ALL elements

`;
*/

    // Include the content description from our analysis
    const contentGuide = sketchAnalysis !== "Draw something to see AI's interpretation" ? sketchAnalysis : "A user's drawing.";
    prompt += `CONTENT DESCRIPTION: ${contentGuide}\n\n`;

    // Add user's additional context if provided (preserve this as high priority)
    if (additionalContext) {
      prompt += `USER'S CONTEXT: "${additionalContext}"\n\n`;
    }

    // Include the detailed structural information if available
    // Placeholder: Assume structuralGuide is derived from analysisElements
    if (analysisElements.length > 0) {
      const structuralGuide = `Based on analysis, the drawing contains ${analysisElements.length} main elements. Element positions and basic relationships are implied by the sketch.`;
      prompt += `STRUCTURAL GUIDE: ${structuralGuide}\n\n`;
    }

    // Include the compositional analysis (placeholder)
    const compositionGuide = `Focus on the arrangement within the ${selectedAspectRatio} frame.`;
    prompt += `COMPOSITION GUIDE: ${compositionGuide}\n\n`;

    // Add stroke-based recognition if available
    if (strokeRecognition && strokeRecognition !== "Draw something to see shapes recognized") {
      prompt += `RECOGNIZED SHAPES: ${strokeRecognition}\n\n`;
    }

    // Add AI detection objects section that combines both sources
   // if (detectedObjectsText || tfDetectedObjectsText)
    if (false) {
      prompt += `This is a list of elements that you MUST include,
      with coordinates relative to the canvas.
      For example, "x:0.268,y:0.197 with width:0.386,height:0.457"
      means that the element is located at the 26.8% point from the left, 19.7% point from the top,
      with a width spanning 38.6% of the canvas width, and a height spanning 45.7% of the canvas height.
      \n \n
      DETECTED OBJECTS:\n`;

      if (detectedObjectsText) {
        prompt += `${detectedObjectsText}\n`;
      }

      if (tfDetectedObjectsText) {
        prompt += `${tfDetectedObjectsText}\n`;
      }

      prompt += `\n`;
    }

    // Final instructions for perfect structural fidelity
    prompt += `FINAL INSTRUCTIONS: Create a DIRECT, FRONT-FACING VIEW that maintains the EXACT same composition as the sketch. NEVER distort or reposition any element. Color and texture can be added, but the structural skeleton must remain identical to the original sketch.`;

    // Trim the prompt to ensure it stays within API limits (assuming 4000 char limit)
    return prompt.length > 4000 ? prompt.substring(0, 3997) + '...' : prompt;
  }

  // Reactive update for the GPT image prompt store
  $: {
    const newPrompt = buildGptImagePrompt();
    gptImagePrompt.set(newPrompt);
  }

  // Function to determine if an event is a real user edit vs. a programmatic change
  function isRealUserEdit(): boolean {
    // Skip during resize events - these aren't user edits
    if (isResizeEvent) {
      console.log('Skipping analysis due to resize event');
      return false;
    }

    // Skip during loading or artificial events
    if ($isGenerating || isArtificialEvent) { // Use $ prefix for store value
      console.log('Skipping analysis due to loading or artificial event');
      return false;
    }

    // Skip if we're already analyzing something
    if (isAnalyzing || isRecognizingStrokes) {
      console.log('Skipping analysis due to ongoing analysis');
      return false;
    }

    // Update the last edit time and mark that we have a pending analysis
    lastUserEditTime = Date.now();
    pendingAnalysis = true;
    return true;
  }

  // Computed property for stroke count (reactive)
  $: strokeCount = drawingContent?.strokes?.length || 0;

  let pathBuilderLookup = {}; // Cache for SVG path builders

  // Initialize browser variable for local storage check
  let browser = typeof window !== 'undefined';

  // Track the last resize time
  let lastResizeTime = 0;

  // Initialize on component mount
  onMount(() => {
    // First, set up the canvas
    if (inputCanvas) {
      inputCtx = inputCanvas.getContext('2d');
      resizeCanvas()
      // Initialize canvas
      if (inputCtx) {
        // Increase canvas resolution for better output
        const devicePixelRatio = window.devicePixelRatio || 1;
        inputCanvas.width = 1024;
        inputCanvas.height = 1024;

        // Set initial background
        inputCtx.fillStyle = '#f8f8f8';
        inputCtx.fillRect(0, 0, inputCanvas.width, inputCanvas.height);

        // Initialize stroke renderer
        renderStrokes();

        // Capture initial canvas image for output preview
        imageData = inputCanvas.toDataURL('image/png');
      }
    }

    console.log('Component mounted');
    initializeCanvas();
    mobileCheck();
    window.addEventListener('resize', mobileCheck);

    // Return cleanup function
    return () => {
      window.removeEventListener('resize', mobileCheck);
    };
  });

  // Initialize canvas with proper dimensions
  function initializeCanvas() {
    console.log('Initializing canvas');
    if (inputCanvas) {
      const containerWidth = 800; // Default width
      const containerHeight = getHeightFromAspectRatio(containerWidth, selectedAspectRatio);

      // Set canvas dimensions
      inputCanvas.width = containerWidth;
      inputCanvas.height = containerHeight;

      // Update canvasWidth and canvasHeight variables
      canvasWidth = containerWidth;
      canvasHeight = containerHeight;

      console.log(`Canvas initialized with dimensions: ${canvasWidth}x${canvasHeight}`);

      // Set up canvas context
      inputCtx = inputCanvas.getContext('2d');
      if (inputCtx) {
        inputCtx.lineCap = 'round';
        inputCtx.lineJoin = 'round';
        inputCtx.strokeStyle = strokeColor;
        inputCtx.lineWidth = strokeSize;
      }

      // Capture initial image data for output preview
      imageData = inputCanvas.toDataURL('image/png');
    }
  }

  // Helper function to get height based on aspect ratio
  function getHeightFromAspectRatio(width, aspectRatio) {
    if (aspectRatio === '1:1') {
      return width; // Square
    } else if (aspectRatio === 'portrait') {
      return width * (1024 / 1792); // Portrait 1792x1024
    } else if (aspectRatio === 'landscape') {
      return width * (1792 / 1024); // Landscape 1024x1792
    }
    // Default fallback
    return width;
  }

  // Function to resize canvas
  function resizeCanvas() {
    if (!inputCanvas || !inputCanvas.parentElement) return;

    lastResizeTime = Date.now(); // Track resize time
    isResizeEvent = true; // Flag that this is a resize event

    // Get the actual available space in the container
    const container = inputCanvas.parentElement;

    // Get computed style to account for padding, border, etc.
    const containerStyle = window.getComputedStyle(container);
    const paddingHorizontal = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight);
    const paddingVertical = parseFloat(containerStyle.paddingTop) + parseFloat(containerStyle.paddingBottom);

    // Calculate actual available space accounting for padding
    const availableWidth = container.clientWidth - paddingHorizontal;
    const availableHeight = container.clientHeight - paddingVertical;

    console.log(`Available container space: ${availableWidth}x${availableHeight}`);

    // Set internal resolution based on gpt-image-1 supported formats
    let internalWidth, internalHeight;

    if (selectedAspectRatio === '1:1') {
      // Square 1024x1024
      internalWidth = 1024;
      internalHeight = 1024;
    } else if (selectedAspectRatio === 'portrait') {
      // Portrait 1792x1024
      internalWidth = 1792;
      internalHeight = 1024;
    } else if (selectedAspectRatio === 'landscape') {
      // Landscape 1024x1792
      internalWidth = 1024;
      internalHeight = 1792;
    }

    // Calculate display size based on container constraints
    // Determine which dimension is the limiting factor
    const widthRatio = availableWidth / internalWidth;
    const heightRatio = availableHeight / internalHeight;

    // Use the smaller ratio to ensure the entire canvas fits
    const scaleFactor = Math.min(widthRatio, heightRatio);

    // Calculate new display dimensions ensuring they're never larger than available space
    const newCanvasWidth = Math.min(internalWidth * scaleFactor, availableWidth);
    const newCanvasHeight = Math.min(internalHeight * scaleFactor, availableHeight);

    console.log(`Calculated canvas size: ${newCanvasWidth}x${newCanvasHeight}, scale: ${scaleFactor}`);

    // Set internal canvas dimensions (for rendering)
    inputCanvas.width = internalWidth;
    inputCanvas.height = internalHeight;

    // Update global canvas dimensions for overlays
    canvasWidth = internalWidth;
    canvasHeight = internalHeight;

    // Set display size based on calculated dimensions
    inputCanvas.style.width = `${Math.round(newCanvasWidth)}px`;
    inputCanvas.style.height = `${Math.round(newCanvasHeight)}px`;

    // Store the scale factor for use with overlays
    canvasScale = scaleFactor;

    // Update drawing content bounds to match internal resolution
    drawingContent.bounds = {
      width: internalWidth,
      height: internalHeight
    };

    // Re-render all strokes after a short delay to allow layout to settle
    // Clear any existing render debounce
    if (renderDebounceTimeout) {
      clearTimeout(renderDebounceTimeout);
    }
    renderDebounceTimeout = setTimeout(() => {
      console.log('Rendering strokes after resize debounce');
      renderStrokes();

      // Update the canvas snapshot for the output preview
      imageData = inputCanvas.toDataURL('image/png');

      // Update the canvas snapshot for the shape recognition dialog
      if (showShapeRecognitionDialog && drawingContent.strokes.length > 0) {
        currentCanvasSnapshot = captureCanvasSnapshot();
      }

      // Reset resize event flag after rendering
      setTimeout(() => { isResizeEvent = false; }, 50); // Short delay after render
    }, 100); // Debounce rendering on resize

    console.log(
      `Canvas resized. Container: ${availableWidth}x${availableHeight}, ` +
      `Aspect Ratio: ${selectedAspectRatio}, ` +
      `Display Size: ${Math.round(newCanvasWidth)}x${Math.round(newCanvasHeight)}, ` +
      `Internal Res: ${internalWidth}x${internalHeight}, ` +
      `Scale: ${canvasScale}`
    );
  }

  // Make the component reactive to changes in the drawingContent
  $: {
    if (drawingContent.strokes && drawingContent.strokes.length > 0) {
      if (isRealUserEdit()) {
        console.log('User edit detected, scheduling analysis');

        // Clear any existing timer
        if (analysisDebounceTimer) {
          clearTimeout(analysisDebounceTimer);
        }

        // Set a debounce timer to run analysis after user finishes editing
        analysisDebounceTimer = setTimeout(() => {
          if (pendingAnalysis) {
            console.log('Running analysis after debounce period');
            analyzeSketch();
            recognizeStrokes();
            pendingAnalysis = false;
          }
        }, ANALYSIS_DEBOUNCE_MS);
      }
    }
  }

  // Reactive statement to update canvas when aspect ratio changes
  $: {
    if (browser && selectedAspectRatio) {
      // Only resize the canvas, don't trigger analysis
      resizeCanvas();
    }
  }

  // --- Unified Event Handlers ---

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // Only handle left click/touch

    switch ($selectedTool) {
      case 'pen':
        startPenStroke(e);
        break;
      case 'eraser':
        startEraserStroke(e);
        break;
      case 'select':
        startSelection(e);
        break;
    }
  }

  function onPointerMove(e: PointerEvent) {
    switch ($selectedTool) {
      case 'pen':
        continuePenStroke(e);
        break;
      case 'eraser':
        continueEraserStroke(e);
        break;
      case 'select':
        continueSelection(e);
        break;
    }
  }

  function onPointerUp(e: PointerEvent) {
     switch ($selectedTool) {
      case 'pen':
        endPenStroke(e);
        break;
      case 'eraser':
        endEraserStroke(e);
        break;
      case 'select':
        endSelection(e);
        break;
    }
  }

  // --- Tool Specific Functions ---

  // PEN TOOL
  function startPenStroke(e: PointerEvent) {
    isDrawing = true;
    const isPen = e.pointerType === 'pen';
    isApplePencilActive.set(isPen);
    console.log(`Pen Draw Started. Pointer type: ${e.pointerType}, Pressure: ${e.pressure}`);

    const point = getPointerPosition(e);
    const timestamp = Date.now();
    pointTimes = [timestamp];
    const hasHardwarePressure = isPen && e.pressure > 0 && e.pressure !== 0.5;
    console.log(`Hardware pressure detected: ${hasHardwarePressure}`);

    let currentOptions;
    const unsubscribe = strokeOptions.subscribe(options => { currentOptions = options; });
    unsubscribe();

    currentStroke = {
      tool: 'pen',
      points: [point],
      color: currentOptions.color,
      size: currentOptions.size,
      opacity: currentOptions.opacity,
      hasHardwarePressure: hasHardwarePressure
    };
    inputCanvas.setPointerCapture(e.pointerId);
  }

  function continuePenStroke(e: PointerEvent) {
    if (!isDrawing || !currentStroke || !inputCtx) return;
    const point = getPointerPosition(e);
    const timestamp = Date.now();
    pointTimes.push(timestamp);

    if (!currentStroke.hasHardwarePressure || (e.pointerType === 'pen' && e.pressure === 0.5)) {
       if (currentStroke.points.length > 1) {
        const calculatedPressure = calculatePressureFromVelocity(
          currentStroke.points, currentStroke.points.length - 1, 0.2, true, pointTimes
        );
        point.pressure = calculatedPressure;
      } else {
        point.pressure = 0.5;
      }
    } else {
       console.log(`Using hardware pressure: ${point.pressure}`);
    }

    currentStroke.points.push(point);
    renderStrokes();
  }

  function endPenStroke(e: PointerEvent) {
    if (!isDrawing || !currentStroke) return;
    console.log('Pen Draw Ended');
    isApplePencilActive.set(false);

    // Add final point if needed (can sometimes be missed on fast lifts)
    //const point = getPointerPosition(e);
    //currentStroke.points.push(point);

    drawingContent.strokes.push(currentStroke);
    drawingContent = drawingContent;

    currentStroke = null;
    isDrawing = false;
    inputCanvas.releasePointerCapture(e.pointerId);

    lastUserEditTime = Date.now();
    pendingAnalysis = true;
    triggerAnalysis(); // Renamed function for clarity
  }

  // ERASER TOOL (Simulated)
  // Local variable for eraser size (can be added to store later if needed)
  let eraserSize = 20;

  function startEraserStroke(e: PointerEvent) {
    isDrawing = true;
    console.log('Eraser Started');
    const point = getPointerPosition(e);
    currentStroke = {
      tool: 'eraser',
      points: [point],
      color: '#f8f8f8', // Canvas background color
      size: eraserSize, // Use a dedicated eraser size
      opacity: 1,       // Eraser should be fully opaque
      isEraserStroke: true // Mark as eraser stroke
    };
    inputCanvas.setPointerCapture(e.pointerId);
  }

  function continueEraserStroke(e: PointerEvent) {
    if (!isDrawing || !currentStroke || !inputCtx) return;
    const point = getPointerPosition(e);
    currentStroke.points.push(point);
    // For eraser, render immediately to give feedback
    renderStrokes();
  }

  function endEraserStroke(e: PointerEvent) {
    if (!isDrawing || !currentStroke) return;
    console.log('Eraser Ended');

    drawingContent.strokes.push(currentStroke);
    drawingContent = drawingContent;

    currentStroke = null;
    isDrawing = false;
    inputCanvas.releasePointerCapture(e.pointerId);
    renderStrokes(); // Final render after adding stroke
  }

  // SELECT TOOL (Initial - Bounding Box Selection)
  let isSelecting = false;
  let selectionStartPoint: {x: number, y: number} | null = null;
  let selectionBoxElement: HTMLDivElement | null = null;
  let selectedStrokeIndices: number[] = []; // Keep local for now, can move to store

  function startSelection(e: PointerEvent) {
    isSelecting = true;
    selectedStrokeIndices = []; // Clear previous selection
    const rect = inputCanvas.getBoundingClientRect();
    selectionStartPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    console.log('Selection Started at:', selectionStartPoint);
    createSelectionBoxElement();
    updateSelectionBoxElement(selectionStartPoint.x, selectionStartPoint.y, selectionStartPoint.x, selectionStartPoint.y);
    inputCanvas.setPointerCapture(e.pointerId);
  }

  function continueSelection(e: PointerEvent) {
    if (!isSelecting || !selectionStartPoint || !selectionBoxElement) return;
    const rect = inputCanvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    updateSelectionBoxElement(selectionStartPoint.x, selectionStartPoint.y, currentX, currentY);
  }

  function endSelection(e: PointerEvent) {
    if (!isSelecting || !selectionStartPoint || !selectionBoxElement) return;
    isSelecting = false;
    console.log('Selection Ended');
    inputCanvas.releasePointerCapture(e.pointerId);

    const rect = inputCanvas.getBoundingClientRect();
    const endX = e.clientX - rect.left;
    const endY = e.clientY - rect.top;

    // Define final selection box (ensure x1 < x2, y1 < y2)
    const finalSelectionBox = {
      x1: Math.min(selectionStartPoint.x, endX),
      y1: Math.min(selectionStartPoint.y, endY),
      x2: Math.max(selectionStartPoint.x, endX),
      y2: Math.max(selectionStartPoint.y, endY)
    };

    console.log('Final Selection Box:', finalSelectionBox);

    // Scale selection box coords to internal canvas coords
    const scaleX = inputCanvas.width / rect.width;
    const scaleY = inputCanvas.height / rect.height;
    const scaledSelectionBox = {
      x1: finalSelectionBox.x1 * scaleX,
      y1: finalSelectionBox.y1 * scaleY,
      x2: finalSelectionBox.x2 * scaleX,
      y2: finalSelectionBox.y2 * scaleY
    };

    // Find intersecting strokes
    selectedStrokeIndices = findIntersectingStrokes(scaledSelectionBox);
    console.log('Selected Stroke Indices:', selectedStrokeIndices);

    // Remove the visual selection box element
    removeSelectionBoxElement();

    // Re-render to highlight selected strokes
    renderStrokes();
  }

  // --- Selection Helper Functions ---

  function createSelectionBoxElement() {
    if (!selectionBoxElement) {
      selectionBoxElement = document.createElement('div');
      selectionBoxElement.style.position = 'absolute';
      selectionBoxElement.style.border = '1px dashed blue';
      selectionBoxElement.style.backgroundColor = 'rgba(0, 0, 255, 0.1)';
      selectionBoxElement.style.pointerEvents = 'none'; // Prevent interference
      selectionBoxElement.style.zIndex = '100';
      inputCanvas.parentElement?.appendChild(selectionBoxElement);
    }
  }

  function updateSelectionBoxElement(x1: number, y1: number, x2: number, y2: number) {
    if (!selectionBoxElement) return;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x1 - x2);
    const height = Math.abs(y1 - y2);
    selectionBoxElement.style.left = `${left}px`;
    selectionBoxElement.style.top = `${top}px`;
    selectionBoxElement.style.width = `${width}px`;
    selectionBoxElement.style.height = `${height}px`;
  }

  function removeSelectionBoxElement() {
    if (selectionBoxElement) {
      selectionBoxElement.remove();
      selectionBoxElement = null;
    }
  }

  // Helper function to find strokes intersecting the selection box
  function findIntersectingStrokes(selectionBox) {
    const intersectingIndices: number[] = [];
    drawingContent.strokes.forEach((stroke, index) => {
       if (stroke.isEraserStroke) return; // Don't select eraser strokes

       // Simple check: If any point of the stroke is inside the box
       // A more robust check would involve line segment/box intersection
       const strokeInBox = stroke.points.some(point =>
         point.x >= selectionBox.x1 &&
         point.x <= selectionBox.x2 &&
         point.y >= selectionBox.y1 &&
         point.y <= selectionBox.y2
       );

       if (strokeInBox) {
         intersectingIndices.push(index);
       }
    });
    return intersectingIndices;
  }

  // --- Analysis Trigger ---
  function triggerAnalysis() {
     const now = Date.now();
     if (now - lastAnalysisTime > ANALYSIS_THROTTLE_MS) {
      clearTimeout(analysisDebounceTimer);
      analysisDebounceTimer = setTimeout(() => {
        if (!isAnalyzing && !isRecognizingStrokes && pendingAnalysis) {
          analyzeSketch();
          recognizeStrokes();
          pendingAnalysis = false;
        }
      }, 300); // Short delay to let canvas update
    }
  }

  // Function to get pointer position
  function getPointerPosition(e: PointerEvent): StrokePoint {
    if (!inputCanvas) {
      return { x: 0, y: 0, pressure: 0.5 };
    }

    const rect = inputCanvas.getBoundingClientRect();
    const scaleX = inputCanvas.width / rect.width;
    const scaleY = inputCanvas.height / rect.height;
    const pressure = e.pressure;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      pressure: pressure // Pass raw pressure
    };
  }

  // Function to render all strokes
  function renderStrokes() {
    if (!inputCtx || !inputCanvas) return;

    // Clear canvas
    inputCtx.clearRect(0, 0, inputCanvas.width, inputCanvas.height);

    // Set background
    inputCtx.fillStyle = '#f8f8f8';
    inputCtx.fillRect(0, 0, inputCanvas.width, inputCanvas.height);

    // Get current stroke options from store
    let currentOptions;
    const unsubscribe = strokeOptions.subscribe(options => {
      currentOptions = options;
    });
    unsubscribe(); // Immediately unsubscribe to avoid memory leaks

    // Function to render a single stroke
    const renderStroke = (stroke: EnhancedStroke, index: number) => { // Add index parameter
      if (stroke.points.length < 2) return;

      // Generate perfect-freehand options using values from the store
      const options = {
        size: stroke.size,
        thinning: currentOptions.thinning,     // Use store value
        smoothing: currentOptions.smoothing,    // Use store value
        streamline: currentOptions.streamline,  // Use store value
        easing: currentOptions.easing,          // Use store value
        simulatePressure: !(stroke as EnhancedStroke).hasHardwarePressure, // Correctly use the hasHardwarePressure flag
        last: false,                            // Whether this is the last point
        start: {
          cap: currentOptions.start.cap,        // Use store value
          taper: currentOptions.start.taper,    // Use store value with increased taper
          easing: currentOptions.start.easing,  // Use store value
        },
        end: {
          cap: currentOptions.end.cap,          // Use store value
          taper: currentOptions.end.taper,      // Use store value with increased taper
          easing: currentOptions.end.easing,    // Use store value
        }
      };

      // Create a dramatically responsive pressure curve with higher sensitivity to light pressure
      const enhancedPoints = stroke.points.map(p => {
        // Start with base pressure, default to middle value if not provided
        let basePressure = p.pressure || 0.5;
        // We'll modify this value based on intensity
        let enhancedPressure = basePressure;

        if (currentOptions.pressureIntensity !== 1.0) {
          // Enhanced algorithm for more sensitivity at lower pressures

          // Calculate intensity factor - higher values create more dramatic contrast
          const intensityFactor = Math.max(1, currentOptions.pressureIntensity / 2);

          // Set threshold to detect even lighter pressure changes (was 0.5)
          const lightPressureThreshold = 0.35;

          if (basePressure < lightPressureThreshold) {
            // Light pressure: create a more dramatic curve to amplify subtle differences
            // The cubic curve gives more visual difference at lower pressure values
            const normalizedPressure = basePressure / lightPressureThreshold; // normalize to 0-1 range
            const amplifiedPressure = Math.pow(normalizedPressure, 0.5); // sqrt curve for more sensitivity

            // Scale to a range that gives visible but thin lines even at very light pressure
            enhancedPressure = 0.1 + (0.3 * amplifiedPressure);
          } else {
            // Medium to heavy pressure: transition to thicker lines more quickly
            const normalizedPressure = (basePressure - lightPressureThreshold) / (1 - lightPressureThreshold);

            // This creates a faster ramp-up to thick lines after crossing the threshold
            enhancedPressure = 0.4 + (0.6 * Math.pow(normalizedPressure, 1/intensityFactor));
          }

          // Ensure minimum visibility while allowing for dramatic range
          enhancedPressure = Math.min(1.0, Math.max(0.1, enhancedPressure));
        }

        return [p.x, p.y, enhancedPressure];
      });

      // Generate stroke with perfect-freehand
      const freehandStroke = getStroke(
        enhancedPoints,
        options
      );

      // Get SVG path
      const pathData = getSvgPathFromStroke(freehandStroke);

      if (!pathData) return;

      // Create a path from the SVG data
      const path = new Path2D(pathData);

      // Set fill style
      inputCtx!.fillStyle = stroke.color;
      inputCtx!.globalAlpha = stroke.opacity;

      // Add highlight for selected strokes
      if ($selectedTool === 'select' && selectedStrokeIndices.includes(index)) {
        inputCtx!.strokeStyle = 'rgba(0, 0, 255, 0.5)'; // Blue highlight
        inputCtx!.lineWidth = 2;
        // Draw bounding box (simple version, more accurate would use getStrokeOutlinePoints)
        const bounds = calculateMultiStrokeBoundingBox([stroke]); // Use helper if available
        if (bounds) {
          inputCtx!.strokeRect(bounds.minX - 2, bounds.minY - 2, bounds.width + 4, bounds.height + 4);
        }
        inputCtx!.lineWidth = stroke.size; // Reset line width if needed elsewhere
      }

      // Fill the path
      inputCtx!.fill(path);
    };

    // Render all strokes
    drawingContent.strokes.forEach((stroke, index) => { // Pass index here
      renderStroke(stroke, index); // Pass index to renderStroke
    });

    // Render current stroke if it exists
    if (currentStroke) {
      // Current stroke doesn't have a fixed index yet, handle differently or don't highlight
      renderStroke(currentStroke, -1); // Pass -1 or handle selection logic inside
    }

    // Reset alpha
    inputCtx.globalAlpha = 1;

    // Capture the canvas image for output preview
    if (inputCanvas) {
      imageData = inputCanvas.toDataURL('image/png');
    }
  }

  // Function to analyze the current sketch with OpenAI Vision
  async function analyzeSketch() {
    // Skip analysis if no strokes or already analyzing
    if (isAnalyzing || drawingContent.strokes.length === 0) {
      console.log('Skipping analysis - already analyzing or no strokes');
      return;
    }

    // Check if we need to analyze again
    const now = Date.now();
    if (!forceAnalysisFlag && (now - lastAnalysisTime < ANALYSIS_THROTTLE_MS)) {
      console.log(`Skipping analysis - throttled (${now - lastAnalysisTime}ms < ${ANALYSIS_THROTTLE_MS}ms)`);
      return;
    }

    // Skip if we don't have pending user edits and we're not forcing analysis
    if (!forceAnalysisFlag && !pendingAnalysis) {
      console.log('Skipping analysis - no pending user edits');
      return;
    }

    // Skip if it's been a long time since the last user edit and we're not forcing
    if (!forceAnalysisFlag && (now - lastUserEditTime > ANALYSIS_THROTTLE_MS * 5)) {
      console.log('Skipping analysis - user edit too old');
      pendingAnalysis = false;
      return;
    }

    try {
      isAnalyzing = true;
      // Store current analysis before updating
      previousSketchAnalysis = sketchAnalysis;
      lastAnalysisTime = Date.now();
      sketchAnalysis = 'Analyzing drawing...'; // Show immediate feedback

      // Update tracking variables
      previousAnalyzedStrokeCount = drawingContent.strokes.length;
      lastAnalyzedStrokesHash = generateStrokesHash(drawingContent.strokes);
      pendingAnalysis = false;

      // Reset force flag
      forceAnalysisFlag = false;

      console.log('Starting sketch analysis API call...', new Date().toISOString());

      // Set a timeout for the analysis request
      const timeoutMs = 20000; // 20 seconds max
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Use the existing snapshot if available, or capture a new one
        const imageData = currentCanvasSnapshot || captureCanvasSnapshot();

        // First, use our enhanced sketch analysis endpoint
        const response = await fetch('/api/ai/analyze-sketch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageData,
            enhancedAnalysis: true,
            requestHierarchy: true,
            requestPositions: true,
            excludeTrivialElements: true,
            context: additionalContext || '',
            // Add analysis options to control behavior
            options: {
              complexity: drawingContent.strokes.length > 20 ? 'high' : 'normal',
              detectionMode: 'precise',
              includeConfidence: true
            }
          }),
          signal: controller.signal
        });

        // Clear the timeout
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to analyze sketch');
        }

        const result = await response.json();
        sketchAnalysis = result.description || 'No analysis available';

        // Format the sketchAnalysisOutput properly for the ShapeRecognitionDialog
        sketchAnalysisOutput = {
          ...result,
          // Ensure there's an analysis object with content and confidence properties
          analysis: {
            content: result.description || 'No content analysis',
            confidence: 0.8 // Default confidence if not provided by API
          },
          // Ensure each detected object has a valid confidence value
          detectedObjects: Array.isArray(result.detectedObjects)
            ? result.detectedObjects.map(obj => ({
                ...obj,
                confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.7 // Default confidence
              }))
            : []
        };

        console.log('Formatted sketch analysis output:', sketchAnalysisOutput);

        // Process detected objects as before
        if (result.detectedObjects && Array.isArray(result.detectedObjects)) {
          console.log('Raw detected objects:', result.detectedObjects);

          // Process the detected objects to improve bounding boxes
          const processedElements = [];

          // Get canvas dimensions for calculations
          const canvasWidth = inputCanvas.width;
          const canvasHeight = inputCanvas.height;

          for (const obj of result.detectedObjects) {
            // Find strokes related to this element - use aggressive mode for better object identification
            const relatedStrokes = findRelatedStrokes(
              drawingContent.strokes,
              obj.x,
              obj.y,
              canvasWidth,
              canvasHeight,
              0.18, // Slightly larger search radius for better coverage
              true  // Use aggressive mode to find more related strokes
            );

            // Only proceed if we found related strokes
            if (relatedStrokes.length > 0) {
              // Calculate the precise bounding box for these strokes with padding included
              const boundingBox = calculateMultiStrokeBoundingBox(relatedStrokes, true);

              // Convert to normalized coordinates
              const normalizedBox = normalizeBoundingBox(boundingBox, canvasWidth, canvasHeight);

              // Calculate average pressure for the strokes
              let totalPressure = 0;
              let pressurePoints = 0;
              for (const stroke of relatedStrokes) {
                for (const point of stroke.points) {
                  if (point.pressure !== undefined) {
                    totalPressure += point.pressure;
                    pressurePoints++;
                  }
                }
              }
              const avgPressure = pressurePoints > 0 ? totalPressure / pressurePoints : 0.5;

              // Create a new element with precise dimensions
              const element = {
                ...obj,
                // Use the center point from the API but with precise width/height
                x: obj.x, // Keep original x for consistency
                y: obj.y, // Keep original y for consistency
                // Use calculated width/height instead of default or category-based values
                width: Math.max(normalizedBox.width * canvasWidth, 40), // Minimum size of 40px
                height: Math.max(normalizedBox.height * canvasHeight, 40), // Minimum size of 40px
                // Store bounding box information for more precise rendering
                boundingBox: {
                  minX: normalizedBox.minX,
                  minY: normalizedBox.minY,
                  maxX: normalizedBox.maxX,
                  maxY: normalizedBox.maxY,
                  width: normalizedBox.width,
                  height: normalizedBox.height
                },
                // Ensure color is present
                color: obj.color || getColorForCategory(obj.category || 'default'),
                // Add pressure information for visual effects
                pressure: avgPressure,
                // Add metadata for debugging
                strokesAssociated: relatedStrokes.length,
                confidence: obj.confidence || 0.8
              };
              processedElements.push(element);

              console.log(`Element "${obj.name}" found with ${relatedStrokes.length} related strokes, avg pressure: ${avgPressure.toFixed(2)}`);
            } else {
              // If no related strokes found, use the original element with calculated size
              const element = {
                ...obj,
                // Default width and height if not provided by API
                width: obj.width || calculateElementWidth(obj),
                height: obj.height || calculateElementHeight(obj),
                // Ensure color is present
                color: obj.color || getColorForCategory(obj.category || 'default'),
                // Use default pressure
                pressure: 0.5,
                // Add metadata
                strokesAssociated: 0,
                confidence: obj.confidence || 0.5 // Lower confidence for unassociated elements
              };
              processedElements.push(element);

              console.log(`Element "${obj.name}" found but no related strokes detected`);
            }
          }

          // Update the analysis elements
          // But first, check if we have a meaningful difference to avoid unnecessary UI updates
          const hasSignificantChange = hasElementsChanged(analysisElements, processedElements);

          if (hasSignificantChange || forceAnalysisFlag) {
            // Mark as artificial event to prevent triggering another analysis
            isArtificialEvent = true;
            analysisElements = processedElements;
            console.log('Updated analysis elements with new detection results');
          } else {
            console.log('No significant changes in detected elements, maintaining current UI');
          }
        } else {
          // Otherwise, parse the description to extract elements
          console.log('Sketch analysis updated:', sketchAnalysis);
          updateAnalysisElements(sketchAnalysis);
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);

        // Handle abort errors
        if (fetchError.name === 'AbortError') {
          console.error('Analysis request timed out');
          sketchAnalysis = 'Analysis timed out. Please try again.';
        } else {
          throw fetchError;
        }
      }
    } catch (error) {
      console.error('Error analyzing sketch:', error);
      sketchAnalysis = `Error analyzing sketch: ${error instanceof Error ? error.message : 'Unknown error'}`;

      // Try to use the stroke recognition as fallback for visual elements
      if (strokeRecognition && strokeRecognition !== "Draw something to see shapes recognized") {
        updateAnalysisElements(strokeRecognition);
      }
    } finally {
      // Reset flags
      isAnalyzing = false;
      forceAnalysisFlag = false;
    }
  }

  // Helper function to determine if there are significant changes between element sets
  function hasElementsChanged(oldElements, newElements) {
    // Quick check for length differences
    if (!oldElements || !newElements) return true;
    if (oldElements.length !== newElements.length) return true;

    // If we have a small number of elements, any change is significant
    if (newElements.length <= 3) return true;

    // Count significant changes
    let changedElements = 0;

    // Check for changes in element properties
    for (let i = 0; i < newElements.length; i++) {
      const newEl = newElements[i];

      // Find matching element in old set (if any)
      const oldEl = oldElements.find(el => el.name === newEl.name);

      if (!oldEl) {
        // New element added
        changedElements++;
        continue;
      }

      // Check for position changes
      const positionChanged =
        Math.abs(oldEl.x - newEl.x) > 0.05 ||
        Math.abs(oldEl.y - newEl.y) > 0.05;

      // Check for size changes
      const sizeChanged =
        !oldEl.boundingBox || !newEl.boundingBox ||
        Math.abs(oldEl.boundingBox.width - newEl.boundingBox.width) > 0.05 ||
        Math.abs(oldEl.boundingBox.height - newEl.boundingBox.height) > 0.05;

      if (positionChanged || sizeChanged) {
        changedElements++;
      }
    }

    // Consider changed if more than 25% of elements have changed
    return changedElements > (newElements.length * 0.25);
  }

  // Function to analyze stroke data using our custom recognition service
  async function recognizeStrokes(retries = 2, timeout = 15000) {
    // Skip if no strokes or already analyzing
    if (isRecognizingStrokes || drawingContent.strokes.length === 0) {
      console.log('Skipping stroke recognition - already in progress or no strokes');
      return;
    }

    // Check if we need to analyze again (throttling check)
    const now = Date.now();
    if (!forceAnalysisFlag && (now - lastStrokeAnalysisTime < ANALYSIS_THROTTLE_MS)) {
      console.log(`Skipping stroke recognition - throttled (${now - lastStrokeAnalysisTime}ms < ${ANALYSIS_THROTTLE_MS}ms)`);
      return;
    }

    // Skip if we don't have pending user edits and we're not forcing
    if (!forceAnalysisFlag && !pendingAnalysis) {
      console.log('Skipping stroke recognition - no pending user edits');
      return;
    }

    // Skip if it's been a long time since the last user edit and we're not forcing
    if (!forceAnalysisFlag && (now - lastUserEditTime > ANALYSIS_THROTTLE_MS * 5)) {
      console.log('Skipping stroke recognition - user edit too old');
      pendingAnalysis = false;
      return;
    }

    // Generate a hash and compare with last analyzed strokes
    const currentStrokesHash = generateStrokesHash(drawingContent.strokes);

    // Skip if the strokes haven't changed since last stroke analysis
    if (!forceAnalysisFlag && currentStrokesHash === lastStrokeAnalyzedHash) {
      console.log('Skipping stroke recognition - strokes unchanged');
      pendingAnalysis = false;
      return;
    }

    try {
      isRecognizingStrokes = true;
      // Store current recognition before updating
      previousStrokeRecognition = strokeRecognition;
      lastStrokeAnalysisTime = Date.now();
      strokeRecognition = 'Analyzing drawing...'; // Show feedback immediately

      // Update tracking variables
      previousRecognizedStrokeCount = drawingContent.strokes.length;
      lastStrokeAnalyzedHash = currentStrokesHash;
      pendingAnalysis = false;

      // Reset force flag
      forceAnalysisFlag = false;

      console.log('Starting stroke recognition API call...', new Date().toISOString());

      // Create abort controller for timeout handling
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        console.log('Sending strokes to analysis API:', drawingContent.strokes.length, 'strokes');

        // Validate strokes data before sending
        if (!drawingContent.strokes || drawingContent.strokes.length === 0) {
          throw new Error('No valid strokes to analyze');
        }

        // Check for empty stroke arrays or invalid points
        const validStrokes = drawingContent.strokes.filter(stroke =>
          stroke && stroke.points && Array.isArray(stroke.points) && stroke.points.length > 0
        );

        if (validStrokes.length === 0) {
          throw new Error('No valid points in strokes');
        }

        // Send the strokes directly to our stroke analysis API with enhanced options
        const response = await fetch('/api/ai/analyze-strokes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            strokes: validStrokes,
            enhancedAnalysis: true, // Always use enhanced analysis
            context: additionalContext || '',
            // Add options to control behavior
            options: {
              complexity: 'high', // Always use high complexity for better results
              preferredRecognizer: 'hybrid', // Use both ML and geometric methods
              includeConfidence: true,
              includeTfObjects: true, // Request TensorFlow objects
              detectComplexObjects: true, // Enable detection of complex objects like houses
              improveStructuralUnderstanding: true // Better understand structural relationships
            }
          }),
          signal: controller.signal
        });

        // Clear the timeout since the request completed
        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorMessage = `Server error: ${response.status}`;

          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (parseError) {
            console.error('Failed to parse error response:', parseError);
            // If we can't parse the response, use status text as fallback
            errorMessage = `${response.statusText || 'Server error'} (${response.status})`;
          }

          throw new Error(errorMessage);
        }

        const result = await response.json();
        recognitionResult = result; // Store the full API response
        strokesAnalysisOutput = result; // Store the full API response for the dialog

        // Format the recognition result for display
        if (result.analysis.type === 'drawing') {
          const confidence = Math.round(result.analysis.confidence * 100);
          strokeRecognition = `Recognized as: ${result.analysis.content} (${confidence}% confident)`;

          // Add top alternatives if available
          if (result.debug?.shapeRecognition?.allMatches?.length > 1) {
            const alternatives = result.debug.shapeRecognition.allMatches
              .slice(1, 3) // Get 2nd and 3rd matches
              .map(match => `${match.name} (${Math.round(match.confidence * 100)}%)`)
              .join(', ');

            if (alternatives) {
              strokeRecognition += `\nAlternatives: ${alternatives}`;
            }
          }

          // If we have structured detected shapes, add them to our analysis elements
          if (result.detectedShapes && Array.isArray(result.detectedShapes) &&
              (forceAnalysisFlag || !analysisElements.length || analysisElements.length < result.detectedShapes.length)) {

            // Get canvas dimensions for calculations
            const canvasWidth = inputCanvas.width;
            const canvasHeight = inputCanvas.height;

            // Process the detected shapes to include precise bounding boxes
            const enhancedShapes = result.detectedShapes.map(shape => {
              // Find strokes related to this element
              const relatedStrokes = findRelatedStrokes(
                drawingContent.strokes,
                shape.x,
                shape.y,
                canvasWidth,
                canvasHeight,
                0.2 // Larger search radius for shapes
              );

              // If we found related strokes, calculate precise bounding box
              if (relatedStrokes.length > 0) {
                const boundingBox = calculateMultiStrokeBoundingBox(relatedStrokes);
                const normalizedBox = normalizeBoundingBox(boundingBox, canvasWidth, canvasHeight);

                return {
                  ...shape,
                  // Keep original x,y for consistency with API
                  // Use calculated width/height
                  width: Math.max(normalizedBox.width * canvasWidth, 40), // Minimum size
                  height: Math.max(normalizedBox.height * canvasHeight, 40), // Minimum size
                  // Store precise bounding box for rendering
                  boundingBox: {
                    minX: normalizedBox.minX,
                    minY: normalizedBox.minY,
                    maxX: normalizedBox.maxX,
                    maxY: normalizedBox.maxY,
                    width: normalizedBox.width,
                    height: normalizedBox.height
                  },
                  // Add metadata
                  strokesAssociated: relatedStrokes.length,
                  confidence: shape.confidence || 0.8
                };
              }

              // If no related strokes, keep original shape
              return {
                ...shape,
                // Add metadata
                strokesAssociated: 0,
                confidence: shape.confidence || 0.5  // Lower confidence
              };
            });

            // Check if the new shapes are significantly different from current elements
            const hasSignificantChange = hasElementsChanged(analysisElements, enhancedShapes);

            if (hasSignificantChange || forceAnalysisFlag) {
              // Mark as artificial event to prevent triggering analysis again
              isArtificialEvent = true;
              // Merge with existing elements or replace if we have more detailed information
              analysisElements = enhancedShapes;
              console.log('Updated analysis elements with stroke recognition results');
            } else {
              console.log('No significant changes in detected shapes, maintaining current UI');
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

        // Handle abort errors specially
        if (fetchError.name === 'AbortError') {
          throw new Error('Recognition request timed out. Please try again.');
        }

        // Check network issues specifically
        if (fetchError.message && fetchError.message.includes('Failed to fetch')) {
          console.error('Network error during recognition:', fetchError);
          throw new Error('Network error: Unable to connect to the recognition service. Please check your internet connection.');
        }

        // Check if we should retry
        if (retries > 0) {
          console.log(`Retrying recognition... (${retries} attempts left)`);
          strokeRecognition = 'Connection issue, retrying...';

          // Wait before retrying with exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * (3 - retries)));
          return await recognizeStrokes(retries - 1, timeout);
        }

        // No more retries, propagate the error
        throw fetchError;
      }
    } catch (error) {
      console.error('Error recognizing strokes:', error);

      // Provide user-friendly error messages
      if (error.message && error.message.includes('Failed to fetch')) {
        strokeRecognition = 'Network error: Unable to connect to the recognition service. Please check your internet connection and try again.';
      } else if (error.message && error.message.includes('timed out')) {
        strokeRecognition = 'The recognition service is taking too long to respond. Please try again later.';
      } else if (error.message && error.message.includes('No valid')) {
        strokeRecognition = 'Please draw something that can be recognized.';
      } else {
        strokeRecognition = `Error recognizing strokes: ${error instanceof Error ? error.message : 'Unknown error'}`;
      }

      // Show error in UI
      errorMessage = strokeRecognition;
      setTimeout(() => { errorMessage = null; }, 5000);
    } finally {
      // Reset flags
      isRecognizingStrokes = false;
      forceAnalysisFlag = false;
    }
  }

  // Function to clear the canvas
  function clearCanvas() {
    drawingContent.strokes = [];
    // Trigger Svelte reactivity
    drawingContent = drawingContent;
    generatedImageUrl.set(null); // Reset store
    generatedByModel.set(null); // Reset store
    // Reset the canvas snapshot when clearing the canvas
    currentCanvasSnapshot = '';
    renderStrokes();

    // Update imageData after clearing
    if (inputCanvas) {
      imageData = inputCanvas.toDataURL('image/png');
    }
  }

  // Function to generate image from drawing
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

    try {
      // Set the generating flags
      isGenerating.set(true);
      isEditing.set(true);
      errorMessage = null;

      // Reset previous results
      generatedByModel.set(null);
      generatedImageUrl.set(null);
      editedByModel.set(null);
      editedImageUrl.set(null);

      // Store the current aspect ratio to use for the generated image
      generatedImageAspectRatio = selectedAspectRatio;
      console.log(`Using aspect ratio ${selectedAspectRatio} (${aspectRatios[selectedAspectRatio]}) for generated image`);

      // Create a deep copy of the drawing content to avoid any reactivity issues
      const drawingContentCopy = JSON.parse(JSON.stringify(drawingContent));

      // Get the current prompts from the stores
      const currentPrompt = $gptImagePrompt;
      const currentEditPrompt = $gptEditPrompt;
      console.log('Using prompt from store:', currentPrompt ? 'yes (length: ' + currentPrompt.length + ')' : 'no');
      console.log('Using edit prompt from store:', currentEditPrompt ? 'yes (length: ' + currentEditPrompt.length + ')' : 'no');

      // Add structure preservation metadata
      const structureData = {
        aspectRatio: selectedAspectRatio,
        canvasWidth,
        canvasHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio || 1
      };

      // Create enhanced detected objects with precise coordinates
      const enhancedObjects = analysisElements.map(obj => ({
        label: obj.label || obj.name || 'object',
        x: obj.x / canvasWidth, // normalized 0-1
        y: obj.y / canvasHeight, // normalized 0-1
        width: obj.width / canvasWidth, // normalized 0-1
        height: obj.height / canvasHeight, // normalized 0-1
        centerX: (obj.x + obj.width/2) / canvasWidth, // normalized 0-1
        centerY: (obj.y + obj.height/2) / canvasHeight, // normalized 0-1
        confidence: obj.confidence || 1.0
      }));

      // Prepare request payloads for the endpoints
      const requestPayload = {
        drawingContent: drawingContentCopy,
        imageData,
        additionalContext,
        aspectRatio: selectedAspectRatio,
        sketchAnalysis,
        strokeRecognition,
        prompt: currentPrompt,
        structureData,
        detectedObjects: enhancedObjects
      };

      const editRequestPayload = {
        ...requestPayload,
        prompt: currentEditPrompt
      };

      // Different API calls based on selected model
      if ($selectedModel === 'gpt-image-1') {
        // Use streaming for the edit endpoint with GPT-Image-1
        console.log('Starting streaming image generation...');

        // Use fetch with streaming response for edit-image
        const editResponse = fetch('/api/ai/edit-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(editRequestPayload)
        });

        // Run standard generation in parallel
        const standardResponse = fetch('/api/ai/generate-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestPayload)
        });

        // Handle streaming edit response
        try {
          const response = await editResponse;

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          if (!response.body) {
            throw new Error('No response body for streaming');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = ''; // Buffer to accumulate incomplete data

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              // Decode the chunk and add to buffer
              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;

              // Process complete SSE messages from buffer
              const lines = buffer.split('\n');

              // Keep the last potentially incomplete line in buffer
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '') continue; // Skip empty data lines

                    const data = JSON.parse(jsonStr);
                    console.log('Received streaming event:', data.type);

                    switch (data.type) {
                      case 'status':
                        console.log('Status:', data.message);
                        break;

                      case 'partial_image':
                        console.log(`Received partial image ${data.imageIndex}`);
                        // Update the displayed image with the progressive version
                        editedImageUrl.set(data.imageData);
                        editedByModel.set('gpt-4.1-streaming');
                        break;

                      case 'final_image':
                        console.log('Final image received:', data.imageUrl);
                        editedImageUrl.set(data.imageUrl);
                        editedByModel.set(data.model);
                        if (data.aspectRatio) generatedImageAspectRatio = data.aspectRatio;
                        break;

                      case 'completed':
                        console.log('Image generation completed');
                        if (data.finalImageUrl) {
                          editedImageUrl.set(data.finalImageUrl);
                        }
                        break;

                      case 'error':
                        console.error('Streaming error:', data.error);
                        errorMessage = data.error;
                        break;

                      case 'done':
                        console.log('Stream completed');
                        break;
                    }
                  } catch (parseError) {
                    console.error('Error parsing streaming data:', parseError);
                    console.log('Problematic line length:', line.length);
                    console.log('Line preview:', line.substring(0, 100) + (line.length > 100 ? '...' : ''));
                    // Continue processing other lines instead of failing completely
                  }
                }
              }
            }

            // Process any remaining complete message in buffer
            if (buffer.trim() && buffer.startsWith('data: ')) {
              try {
                const jsonStr = buffer.slice(6).trim();
                if (jsonStr !== '') {
                  const data = JSON.parse(jsonStr);
                  console.log('Final buffered event:', data.type);
                  // Process final message if needed
                }
              } catch (parseError) {
                console.error('Error parsing final buffered data:', parseError);
              }
            }

          } finally {
            reader.releaseLock();
          }
        } catch (streamError) {
          console.error('Streaming failed:', streamError);
          errorMessage = streamError instanceof Error ? streamError.message : 'Streaming error occurred';
        }

        // Handle standard image generation response in parallel
        try {
          const stdResponse = await standardResponse;
          if (stdResponse.ok) {
            const standardResult = await stdResponse.json();
            console.log('Standard image generation successful');

            // Handle different response formats robustly
            const standardImageUrl = standardResult.imageUrl || standardResult.url;
            if (standardImageUrl) {
              generatedImageUrl.set(standardImageUrl);
              generatedByModel.set(standardResult.model || 'gpt-image-1');
              if (standardResult.aspectRatio) {
                generatedImageAspectRatio = standardResult.aspectRatio;
              }
            } else {
              console.error('No image URL found in standard response:', standardResult);
            }
          } else {
            console.error('Failed to generate standard image:', stdResponse.status, stdResponse.statusText);
          }
        } catch (standardError) {
          console.error('Standard generation failed:', standardError);
        }
      } else if ($selectedModel === 'flux-canny-pro' || $selectedModel === 'controlnet-scribble' || $selectedModel === 'stable-diffusion' || $selectedModel === 'latent-consistency') {
        // Call the Replicate API for the selected model
        const replicateResponse = await fetch('/api/ai/edit-replicate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...requestPayload,
            model: $selectedModel // Pass the selected model to the API
          })
        });

        if (replicateResponse.ok) {
          const replicateResult = await replicateResponse.json();
          console.log(`${$selectedModel} image generation successful`);

          // Handle the response
          const replicateImageUrl = replicateResult.imageUrl || replicateResult.url;
          if (replicateImageUrl) {
            // Update the edited image URL with the Replicate result
            editedImageUrl.set(replicateImageUrl);
            editedByModel.set(replicateResult.model || $selectedModel);

            // Also set generated image to keep UI consistent
            generatedImageUrl.set(replicateImageUrl);
            generatedByModel.set(replicateResult.model || $selectedModel);

            if (replicateResult.aspectRatio) {
              generatedImageAspectRatio = replicateResult.aspectRatio;
            }
          } else {
            console.error('No image URL found in Replicate response:', replicateResult);
            throw new Error('No image URL found in Replicate response');
          }
        } else {
          console.error(`Failed to generate image with ${$selectedModel}:`, replicateResponse.status, replicateResponse.statusText);
          throw new Error(`Failed to generate image with ${$selectedModel}`);
        }
      } else {
        throw new Error(`Unsupported model: ${$selectedModel}`);
      }
    } catch (error) {
      console.error('Error generating images:', error);
      errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    } finally {
      isGenerating.set(false);
      isEditing.set(false);
    }
  }

  // Helper function to calculate appropriate width for an element
  function calculateElementWidth(element) {
    // Base size - adjusted by category and importance
    const baseSize = 120;

    // Size multipliers based on category
    const categoryMultipliers = {
      'human': 1.2,
      'animal': 1.1,
      'vehicle': 1.3,
      'building': 1.4,
      'landscape': 1.5,
      'object': 0.9,
      'text': 0.8,
      'detail': 0.7,
      'default': 1.0
    };

    // If element has children, make it larger to encompass them
    const hasChildrenMultiplier = element.children && element.children.length > 0 ? 1.5 : 1.0;

    // If element is a child, make it smaller
    const isChildMultiplier = element.isChild ? 0.8 : 1.0;

    // Calculate final width
    const multiplier = categoryMultipliers[element.category || 'default'] * hasChildrenMultiplier * isChildMultiplier;
    return Math.round(baseSize * multiplier);
  }

  // Helper function to calculate appropriate height for an element
  function calculateElementHeight(element) {
    // Start with the width as a base (for aspect ratio)
    const width = element.width || calculateElementWidth(element);

    // Aspect ratio adjustments based on category
    const aspectRatios = {
      'human': 1.8, // Taller than wide
      'animal': 0.8, // Wider than tall for most animals
      'vehicle': 0.6, // Cars are wider
      'building': 1.5, // Buildings are tall
      'landscape': 0.5, // Landscapes are wide
      'object': 1.0, // Default square
      'text': 0.5, // Text is usually wider
      'detail': 1.0, // Details are square
      'default': 1.0 // Default square
    };

    const aspectRatio = aspectRatios[element.category || 'default'];
    return Math.round(width * aspectRatio);
  }

  // Helper function to get a color based on category
  function getColorForCategory(category) {
    const categoryColors = {
      'human': '#FF5733', // Orange-red
      'animal': '#33FF57', // Light green
      'vehicle': '#3357FF', // Blue
      'building': '#8333FF', // Purple
      'landscape': '#33FFC5', // Teal
      'object': '#FF33E6', // Pink
      'text': '#FFD133', // Yellow
      'detail': '#33B5FF', // Light blue
      'default': '#FF5733' // Default orange-red
    };

    return categoryColors[category] || categoryColors['default'];
  }

  // Function to parse analysis results and extract elements with hierarchical relationships
  function updateAnalysisElements(analysisText) {
    // Reset elements
    analysisElements = [];

    if (!analysisText || analysisText === "Draw something to see AI's interpretation") {
      return;
    }

    // Get canvas dimensions
    const canvasWidth = inputCanvas.width;
    const canvasHeight = inputCanvas.height;

    // List of important objects to identify (filter out trivial elements like 'line')
    const significantObjects = [
      // Human parts
      'human', 'person', 'face', 'head', 'body', 'torso', 'arm', 'hand', 'leg', 'foot', 'eye', 'nose', 'mouth', 'ear', 'hair',
      // Animals
      'animal', 'dog', 'cat', 'bird', 'horse', 'fish',
      // Structures
      'house', 'building', 'window', 'door', 'roof', 'tower', 'castle',
      // Nature
      'tree', 'mountain', 'river', 'sun', 'moon', 'star', 'cloud', 'flower', 'plant',
      // Common objects
      'car', 'chair', 'table', 'book', 'hat', 'crown', 'sword', 'ball'
    ];

    // Patterns to detect objects and their positions
    const objectPatterns = [
      new RegExp(`(${significantObjects.join('|')})\\s(?:in|at|on)\\sthe\\s(top|bottom|left|right|center|upper|lower)(?:\\s(left|right))?`, 'gi'),
      new RegExp(`(?:a|an)\\s(${significantObjects.join('|')})\\s(?:located|positioned|drawn|depicted)\\s(?:in|at|on)\\sthe\\s(top|bottom|left|right|center|upper|lower)(?:\\s(left|right))?`, 'gi'),
      new RegExp(`(?:a|an)\\s(${significantObjects.join('|')})`, 'gi'),
    ];

    // Extract objects and their positions
    let match;
    const objects = [];

    // First pass: extract all objects with positions
    for (const pattern of objectPatterns) {
      while ((match = pattern.exec(analysisText)) !== null) {
        const [, objectName, position1, position2] = match;
        if (objectName) {
          // Determine position based on text description
          const position = getPositionFromText(position1, position2);

          // Create object with generated ID and coordinates
          const objectId = `obj_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const category = getCategoryFromObjectName(objectName);

          objects.push({
            id: objectId,
            name: objectName.toLowerCase(),
            category,
            x: position.x,
            y: position.y,
            children: [],
            isChild: false,
            color: getColorForCategory(category)
          });
        }
      }
    }

    // Second pass: detect parent-child relationships
    // Simple heuristic: if one object's name contains another's, it might be a parent
    for (let i = 0; i < objects.length; i++) {
      for (let j = 0; j < objects.length; j++) {
        if (i !== j) {
          // Check if object j's name contains object i's name
          if (objects[j].name.includes(objects[i].name) && objects[i].name.length < objects[j].name.length) {
            // Object i might be a child of object j
            if (!objects[j].children.includes(objects[i].id)) {
              objects[j].children.push(objects[i].id);
              objects[i].isChild = true;
              objects[i].parentId = objects[j].id;
            }
          }
        }
      }
    }

    // Third pass: calculate precise bounding boxes for each element based on related strokes
    for (const obj of objects) {
      // Find strokes related to this object's position
      const relatedStrokes = findRelatedStrokes(
        drawingContent.strokes,
        obj.x,
        obj.y,
        canvasWidth,
        canvasHeight,
        0.25 // Use a larger search radius for text-based detection which is less precise
      );

      // Calculate size based on strokes if available
      if (relatedStrokes.length > 0) {
        const boundingBox = calculateMultiStrokeBoundingBox(relatedStrokes);
        const normalizedBox = normalizeBoundingBox(boundingBox, canvasWidth, canvasHeight);

        // Update object with calculated dimensions
        obj.width = Math.max(normalizedBox.width * canvasWidth, 40);
        obj.height = Math.max(normalizedBox.height * canvasHeight, 40);
        obj.boundingBox = {
          minX: normalizedBox.minX,
          minY: normalizedBox.minY,
          maxX: normalizedBox.maxX,
          maxY: normalizedBox.maxY,
          width: normalizedBox.width,
          height: normalizedBox.height
        };
      } else {
        // Fallback to category-based dimensions when no strokes found
        obj.width = calculateElementWidth(obj);
        obj.height = calculateElementHeight(obj);
      }
    }

    // Update the analysis elements
    analysisElements = objects;
    console.log('Created analysis elements from text with precise bounds:', analysisElements);
  }

  // Helper function to determine coordinates from text position
  function getPositionFromText(position1, position2) {
    // Default to center if no position info
    let x = 0.5;
    let y = 0.5;

    if (position1) {
      // Vertical position
      if (position1 === 'top' || position1 === 'upper') y = 0.25;
      else if (position1 === 'bottom' || position1 === 'lower') y = 0.75;

      // Horizontal position
      if (position1 === 'left') x = 0.25;
      else if (position1 === 'right') x = 0.75;
    }

    // Handle combined positions (e.g., "top left")
    if (position2) {
      if (position2 === 'left') x = 0.25;
      else if (position2 === 'right') x = 0.75;
    }

    // Add some randomness to avoid perfect overlaps for elements with same position
    x += (Math.random() * 0.1) - 0.05;
    y += (Math.random() * 0.1) - 0.05;

    // Constrain within bounds
    x = Math.max(0.1, Math.min(0.9, x));
    y = Math.max(0.1, Math.min(0.9, y));

    return { x, y };
  }

  // Helper function to determine category from object name
  function getCategoryFromObjectName(name) {
    name = name.toLowerCase();

    // Map object names to categories
    if (['person', 'human', 'face', 'head', 'body', 'arm', 'leg', 'hand', 'foot'].includes(name)) {
      return 'human';
    } else if (['dog', 'cat', 'bird', 'horse', 'fish', 'animal'].includes(name)) {
      return 'animal';
    } else if (['car', 'vehicle', 'truck', 'boat', 'ship', 'plane'].includes(name)) {
      return 'vehicle';
    } else if (['house', 'building', 'tower', 'castle', 'roof', 'window', 'door'].includes(name)) {
      return 'building';
    } else if (['mountain', 'river', 'lake', 'tree', 'forest', 'sun', 'moon', 'sky', 'cloud'].includes(name)) {
      return 'landscape';
    } else if (['chair', 'table', 'book', 'hat', 'crown', 'sword', 'ball'].includes(name)) {
      return 'object';
    } else if (['text', 'word', 'letter', 'number', 'label'].includes(name)) {
      return 'text';
    } else {
      // Default for unrecognized objects
      return 'detail';
    }
  }

  // Function to generate a simplified hash of strokes for comparison
  function generateStrokesHash(strokes: any[]): string {
    if (!strokes || strokes.length === 0) return '';

    // Create a simplified representation of strokes to reduce hash complexity
    // by sampling points and rounding coordinates
    const simplifiedStrokes = strokes.map(stroke => {
      if (!stroke || !stroke.points || !stroke.points.length) {
        return { color: stroke.color, points: [] };
      }

      // Sample only a few points from each stroke for the hash
      const sampleSize = Math.max(2, Math.ceil(stroke.points.length / 10));
      const sampledPoints = [];

      for (let i = 0; i < stroke.points.length; i += Math.ceil(stroke.points.length / sampleSize)) {
        const point = stroke.points[i];
        // Round coordinates to reduce sensitivity to minor changes
        sampledPoints.push({
          x: Math.round(point.x / 5) * 5,
          y: Math.round(point.y / 5) * 5
        });
      }

      return {
        color: stroke.color,
        points: sampledPoints
      };
    });

    // Create a simple hash from the simplified strokes
    return JSON.stringify(simplifiedStrokes);
  }

  // Function to toggle visualization mode
  function toggleVisualizationMode() {
    if (visualizationMode === 'gpt') {
      visualizationMode = 'tensorflow';
    } else if (visualizationMode === 'tensorflow') {
      visualizationMode = 'both';
    } else {
      visualizationMode = 'gpt';
    }
    // Update the individual overlay controls based on mode
    showGPTOverlay = visualizationMode === 'gpt' || visualizationMode === 'both';
    showTFOverlay = visualizationMode === 'tensorflow' || visualizationMode === 'both';

    // You might want to remember this preference for the user
    if (typeof window !== 'undefined') {
      localStorage.setItem('visualizationMode', visualizationMode);
      localStorage.setItem('showGPTOverlay', showGPTOverlay.toString());
      localStorage.setItem('showTFOverlay', showTFOverlay.toString());
    }
  }

  // Add a function to handle individual overlay toggles
  function handleGPTOverlayToggle() {
    showGPTOverlay = !showGPTOverlay;
    // Update visualization mode based on active overlays
    if (showGPTOverlay && showTFOverlay) {
      visualizationMode = 'both';
    } else if (showGPTOverlay) {
      visualizationMode = 'gpt';
    } else if (showTFOverlay) {
      visualizationMode = 'tensorflow';
    } else {
      // Keep the previous mode if both are off
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem('showGPTOverlay', showGPTOverlay.toString());
      localStorage.setItem('visualizationMode', visualizationMode);
    }
  }

  function handleTFOverlayToggle() {
    showTFOverlay = !showTFOverlay;
    // Update visualization mode based on active overlays
    if (showGPTOverlay && showTFOverlay) {
      visualizationMode = 'both';
    } else if (showGPTOverlay) {
      visualizationMode = 'gpt';
    } else if (showTFOverlay) {
      visualizationMode = 'tensorflow';
    } else {
      // Keep the previous mode if both are off
    }

    if (typeof window !== 'undefined') {
      localStorage.setItem('showTFOverlay', showTFOverlay.toString());
      localStorage.setItem('visualizationMode', visualizationMode);
    }
  }

  // Separate TensorFlow objects from regular detected objects
  $: {
    // Filter analysisElements to get only TF/CNN sourced objects
    tfObjects = (analysisElements || []).filter(obj => {
      const source = obj?.detectionSource || obj?.source || '';
      return source === 'tensorflow' || source === 'cnn'; // Keep this filter specific for tfObjects
    });

    // Filter analysisElements to get GPT/other sourced objects
    gptObjects = (analysisElements || []).filter(obj => {
      const source = obj?.detectionSource || obj?.source || '';
      return source !== 'tensorflow' && source !== 'cnn'; // Keep this filter specific for gptObjects
    });
  }

  // Function to track when a edit happens on the canvas
  function onCanvasEdit(editType: string, data?: any) {
    // Update last edit time for throttling
    lastUserEditTime = Date.now();

    // Handle edit differently based on type
    if (editType === 'stroke-added') {
      console.log('Stroke added to canvas');
      // ... existing code ...
    }
    // ... existing code ...
  }

  // Function to capture the current canvas as an image
  function captureCanvasSnapshot() {
    if (!inputCanvas || !drawingContent || drawingContent.strokes.length === 0) {
      return '';
    }

    try {
      // Ensure the canvas is rendered before capturing
      renderStrokes();
      const snapshot = inputCanvas.toDataURL('image/png');
      return snapshot;
    } catch (error) {
      console.error('Error capturing canvas snapshot:', error);
      return '';
    }
  }

  // Function to handle enhanced objects from AIOverlay and update prompt
  function handleEnhancedObjects(event) {
    const enhancedObjects = event.detail.objects;
    updatePromptWithObjects(enhancedObjects);
  }

  // Update the prompt with detailed object information
  function updatePromptWithObjects(objects) {
    if (!objects || objects.length === 0) return;

    // Format object information in a structured way
    const objectsText = objects.map(obj => {
      let desc = `${obj.name} (confidence: ${Math.round(obj.confidence * 100)}%)`;

      if (obj.boundingBox) {
        const bb = obj.boundingBox;
        // Format bounding box as normalized coordinates (0-1 range)
        desc += ` at position x:${bb.minX.toFixed(3)},y:${bb.minY.toFixed(3)} with width:${bb.width.toFixed(3)},height:${bb.height.toFixed(3)}`;
      }

      // Include enhancement information
      if (obj.enhancedBy) {
        const enhancementSources = [];
        if (obj.enhancedBy.semantic) enhancementSources.push('semantic');
        if (obj.enhancedBy.strokes) enhancementSources.push('strokes');
        if (obj.enhancedBy.cnn) enhancementSources.push('cnn');

        if (enhancementSources.length > 0) {
          //desc += ` (enhanced by: ${enhancementSources.join(', ')})`;
        }
      }

      return desc;
    }).join('\n- ');

    // Update our local variable for the prompt building
    if (objectsText) {
      detectedObjectsText = `- ${objectsText}`;
    }

    // Rebuild the prompt with the new object information
    const newPrompt = buildGptImagePrompt();
    gptImagePrompt.set(newPrompt);
  }

  // Add detectedObjectsText variable to store the formatted objects text
  let detectedObjectsText = '';

  // Function to handle objects detected by TensorFlow
  function handleTFObjects(event) {
    const tfDetectedObjects = event.detail.objects;
    updateTFObjectsInPrompt(tfDetectedObjects);
  }

  // Update the prompt with TensorFlow detected objects
  function updateTFObjectsInPrompt(objects) {
    if (!objects || objects.length === 0) return;

    // Format TensorFlow objects (similar to enhancedObjects but simpler format)
    // This is just a basic implementation - adjust based on your TFOverlay output format
    const tfObjectsText = objects.map(obj => {
      let desc = `${obj.name || obj.class} (confidence: ${Math.round((obj.confidence || obj.score) * 100)}%)`;

      if (obj.boundingBox || obj.bbox) {
        const bb = obj.boundingBox || obj.bbox;
        desc += ` at position x:${(bb.x || bb.minX).toFixed(3)},y:${(bb.y || bb.minY).toFixed(3)} with width:${bb.width.toFixed(3)},height:${bb.height.toFixed(3)}`;
      }

      return desc;
    }).join('\n- ');

    // Store in a separate variable for TF objects
    if (tfObjectsText) {
      tfDetectedObjectsText = `- ${tfObjectsText}`;
    }

    // Rebuild the prompt with the updated object information
    const newPrompt = buildGptImagePrompt();
    gptImagePrompt.set(newPrompt);
  }

  // Add variable for TensorFlow detected objects text
  let tfDetectedObjectsText = '';

  // Add a handler for analysis options changes
  function handleAnalysisOptionsChanged(event) {
    console.log('Analysis options changed:', event.detail.options);
    // Set force analysis flag to true and trigger reanalysis
    forceAnalysisFlag = true;
    // Re-analyze with the new options
    runAnalysis(true);
  }

  // Modify the analyzeDrawing function to respect analysis options
  async function analyzeDrawing() {
    if (!drawingContent.strokes || drawingContent.strokes.length === 0) {
      console.log('No strokes to analyze');
      sketchAnalysis = "Draw something to see AI's interpretation";
      strokeRecognition = "Draw something to see shapes recognized";
      return;
    }

    isAnalyzing = true;
    sketchAnalysis = "Analyzing drawing...";

    // Capture current canvas state
    captureCanvas();

    try {
      // Only run GPT-4 Vision analysis if that option is enabled
      if ($analysisOptions.useGPTVision) {
        // Analyze sketch with GPT-4 Vision API
        const response = await fetch('/api/ai/analyze-sketch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            imageData: imageData,
            enhancedAnalysis: true,
            requestHierarchy: true,
            requestPositions: true,
            context: additionalContext
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error: ${errorText}`);
        }

        // Process the response
        const result = await response.json();
        sketchAnalysisOutput = result;

        sketchAnalysis = result.description || result.analysis?.content || "AI couldn't analyze the drawing";

        // Process detected objects from GPT-4 Vision response
        if (result.detectedObjects && Array.isArray(result.detectedObjects)) {
          gptObjects = result.detectedObjects.map(obj => ({
            ...obj,
            id: obj.id || `gpt_${Math.random().toString(36).substring(2, 9)}`,
            source: 'openai',
            confidence: obj.confidence || 0.8
          }));
        }
      } else {
        // Skip GPT-4 Vision analysis
        console.log('GPT-4 Vision analysis skipped due to options settings');
        sketchAnalysis = "GPT-4 Vision analysis disabled";
        gptObjects = [];
      }

      // Only run stroke analysis if that option is enabled
      if ($analysisOptions.useStrokeAnalysis || $analysisOptions.useCNN || $analysisOptions.useShapeRecognition) {
        // Analyze strokes with custom recognition
        isRecognizingStrokes = true;

        // Filter which technologies to use in the stroke analysis
        const strokeAnalysisOptions = {
          useCNN: $analysisOptions.useCNN,
          useShapeRecognition: $analysisOptions.useShapeRecognition,
          useStrokeAnalysis: $analysisOptions.useStrokeAnalysis
        };

        const strokeResponse = await fetch('/api/ai/analyze-strokes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            strokes: drawingContent.strokes,
            enhancedAnalysis: true,
            context: additionalContext,
            options: strokeAnalysisOptions
          }),
        });

        if (!strokeResponse.ok) {
          const errorText = await strokeResponse.text();
          throw new Error(`Stroke API error: ${errorText}`);
        }

        // Process stroke analysis results
        const strokeResult = await strokeResponse.json();
        strokesAnalysisOutput = strokeResult;
        recognitionResult = strokeResult;

        strokeRecognition = strokeResult.analysis?.content || "No shapes recognized";

        // Process combined detection results
        analyzeResults(strokeResult);

        isRecognizingStrokes = false;
      } else {
        // Skip stroke analysis
        console.log('Stroke analysis skipped due to options settings');
        strokeRecognition = "Stroke analysis disabled";
        isRecognizingStrokes = false;
      }

      // Update last analysis time and hash
      lastAnalysisTime = Date.now();
      lastAnalyzedStrokesHash = computeStrokesHash(drawingContent.strokes);
      previousAnalyzedStrokeCount = drawingContent.strokes.length;

      // Reset the pending and force flags
      pendingAnalysis = false;
      forceAnalysisFlag = false;
    } catch (error) {
      console.error('Error analyzing drawing:', error);
      errorMessage = `Analysis error: ${error.message}`;
      sketchAnalysis = "Error analyzing drawing";
      strokeRecognition = "Error analyzing strokes";
    } finally {
      isAnalyzing = false;

      // Build the prompt with whatever results we have
      const newPrompt = buildGptImagePrompt();
      gptImagePrompt.set(newPrompt);
    }
  }

  // Update the analyze-strokes endpoint call in other places as needed

  // Function to build the prompt for GPT-Image-1 Edit (edit-image endpoint)
  function buildGptEditPrompt() {

    let prompt = `Complete this drawing, in the exact same style and proportions as the original. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;

    let prompt2 = `Complete this drawing, in the exact same style and proportions as the original. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;

    // Content description from analysis
    const contentGuide = sketchAnalysis !== "Draw something to see AI's interpretation" ? sketchAnalysis : "A user's drawing.";
    prompt += `\n\nCONTENT DESCRIPTION: ${contentGuide}`;

    // User's additional context
    if (additionalContext) {
      prompt2 += `\n\nUSER'S CONTEXT: \"${additionalContext}\"`;
    }

    // Structural information if available
    if (analysisElements.length > 0) {
      const structuralGuide = `Based on analysis, the drawing contains ${analysisElements.length} main elements. Element positions and basic relationships are implied by the sketch.`;
      prompt += `\n\nSTRUCTURAL GUIDE: ${structuralGuide}`;
    }

    // Compositional analysis
    const compositionGuide = `Focus on the arrangement within the ${selectedAspectRatio} frame.`;
    prompt += `\n\nCOMPOSITION GUIDE: ${compositionGuide}`;

    // Stroke-based recognition if available
    if (strokeRecognition && strokeRecognition !== "Draw something to see shapes recognized") {
      prompt += `\n\nRECOGNIZED SHAPES: ${strokeRecognition}`;
    }

    // Trim to 4000 chars
    return prompt2.length > 4000 ? prompt2.substring(0, 3997) + '...' : prompt2;
  }

  // Reactive update for the GPT edit prompt store - explicit dependencies
  $: {
    // Update the edit prompt when additionalContext, analysis results, or aspect ratio changes
    const newEditPrompt = buildGptEditPrompt();
    gptEditPrompt.set(newEditPrompt);
  }

  // Make the edit prompt explicitly reactive to additionalContext
  $: if (additionalContext !== undefined) {
    const newEditPrompt = buildGptEditPrompt();
    gptEditPrompt.set(newEditPrompt);
  }

  // Make the component reactive to changes in the strokeOptions store
  $: {
    // When strokeOptions updates, update our local variables
    $strokeOptions; // Add reactivity by referencing the store value with $
    // No need to do anything else as we've already set up the subscription
    // to update local variables at component initialization
  }

  // Function to check if the device is mobile and adjust UI accordingly
  function mobileCheck() {
    // Simple mobile check based on screen width
    const isMobile = window.innerWidth < 768;

    // Adjust UI for mobile if needed
    if (isMobile) {
      console.log('Mobile device detected, adjusting UI');
      // Mobile specific adjustments can be added here
    }

    // Trigger canvas resize to adjust for the device
    if (inputCanvas) {
      resizeCanvas();
    }
  }

  // Function to capture the current canvas state
  function captureCanvas() {
    // Capture current canvas as image data
    if (inputCanvas) {
      imageData = inputCanvas.toDataURL('image/png');
      return imageData;
    }
    return null;
  }

  // Function to run analysis with specified options
  function runAnalysis(force = false) {
    // Set force flag and run both analysis methods
    forceAnalysisFlag = force;

    // Run both analysis methods
    analyzeSketch();
    recognizeStrokes();
  }

  // Function to analyze results from the stroke analysis
  function analyzeResults(result) {
    if (!result) return;

    // Process the analysis results
    // This is a placeholder implementation
    console.log('Processing analysis results', result);

    // Update UI elements based on the results
    if (result.analysis && result.analysis.content) {
      strokeRecognition = result.analysis.content;
    }

    // Process detected shapes if available
    if (result.detectedShapes && Array.isArray(result.detectedShapes)) {
      // Code to process detected shapes would go here
    }
  }

  // Function to generate a hash for the strokes
  function computeStrokesHash(strokes) {
    if (!strokes || !strokes.length) return '';

    // Create a simplified representation for hashing
    const simplifiedStrokes = strokes.map(stroke => {
      return {
        color: stroke.color,
        size: stroke.size,
        points: stroke.points.map(p => ({
          x: Math.round(p.x),
          y: Math.round(p.y)
        }))
      };
    });

    // Return a simple string representation as hash
    return JSON.stringify(simplifiedStrokes);
  }

  // Taper is now set in the strokeOptions store

  // State variables for Shape Recognition Dialog
  let showShapeRecognitionDialog = false;
  let showAIDebugMode = false;

  // Position for the shape recognition button
  let buttonPosition = { right: '20px', bottom: '20px' };
  // Position for the shape recognition dialog
  let shapeDialogPosition = { right: '20px', top: '20px' };

  // State for aspect ratio
  let selectedAspectRatio = '1:1'; // Default aspect ratio (square)
  const aspectRatios = {
    '1:1': 1 / 1,          // Square 1024x1024
    'portrait': 1792 / 1024,  // Portrait 1792x1024
    'landscape': 1024 / 1792  // Landscape 1024x1792
  };

  // Store the aspect ratio of the generated image
  let generatedImageAspectRatio = '1:1'; // Default to match the selectedAspectRatio

  // Update the generated image aspect ratio when the canvas aspect ratio changes
  $: {
    if (selectedAspectRatio) {
      // When aspect ratio changes, update the generated image aspect ratio
      // This ensures that the AI output will match the drawing canvas
      generatedImageAspectRatio = selectedAspectRatio;

      // Trigger resize when aspect ratio changes
      if (browser) {
        resizeCanvas();
        // Force redraw of the canvas content at the new aspect ratio
        if (drawingContent.strokes.length > 0) {
          renderStrokes();
        }
      }
    }
  }

  // Function to toggle Shape Recognition Dialog
  function toggleShapeRecognitionDialog() {
    // Toggle the dialog state
    showShapeRecognitionDialog = !showShapeRecognitionDialog;

    // Always capture a fresh canvas snapshot when opening the dialog and there are strokes
    if (showShapeRecognitionDialog && drawingContent.strokes.length > 0) {
      currentCanvasSnapshot = captureCanvasSnapshot();
    }
  }

  // Function to toggle Debug Mode
  function toggleDebugMode() {
    showAIDebugMode = !showAIDebugMode;
  }
</script>

<svelte:head>
  <title>Daydream</title>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
</svelte:head>

<div id = 'app'>
<div class="draw-demo-container">
  <header class="demo-header">

    <div class = 'bar'>
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
            <h3>
              {$isGenerating ? 'Creating...' : 'Create'}
            </h3>
        </button>


      </div>

      <div class = 'dropdown'>
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
                  renderStrokes();
                }}
                showValue={true}
              />
            </div>

                       <!--

            <div class="tool-group aspect-ratio-selector">
              <span class="material-icons tool-icon-label">aspect_ratio</span>
              <select bind:value={selectedAspectRatio} on:change={resizeCanvas}>
                {#each Object.keys(aspectRatios) as ratioKey}
                  <option value={ratioKey}>{ratioKey}</option>
                {/each}
              </select>
            </div>


            <div class="tool-group toggle-switch">
              <span class="material-icons tool-icon-label">auto_awesome</span>
              <div class="switch">
                <input
                  type="checkbox"
                  id="analysis-toggle"
                  bind:checked={showAnalysisView}
                />
                <label for="analysis-toggle"></label>
              </div>
              <span class="tool-label">AI Overlay</span>
            </div>
           -->

            <button class="tool-button clear-button" on:click={clearCanvas}>
              <span class="material-icons">delete_outline</span>
            </button>


          </div>
      </div>
    </div>

    <div class="canvas-wrapper input-canvas" class:ratio-1-1={selectedAspectRatio === '1:1'} class:ratio-portrait={selectedAspectRatio === 'portrait'} class:ratio-landscape={selectedAspectRatio === 'landscape'}>
      <canvas
        bind:this={inputCanvas}
        class="drawing-canvas"
        on:pointerdown={onPointerDown}
        on:pointermove={onPointerMove}
        on:pointerup={onPointerUp}
        on:pointercancel={onPointerUp}
        on:pointerleave={onPointerUp}
      ></canvas>

      <!-- Update the overlay rendering conditions -->
      {#if showAnalysisView && (analysisElements.length > 0 || (drawingContent?.strokes?.length === 0 && !analysisElements.length))}
        {#if showGPTOverlay}
          <div class="ai-overlay-wrapper" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;">
            <AIOverlay
              detectedObjects={analysisElements}
              width={inputCanvas?.width}
              height={inputCanvas?.height}
              visible={showAnalysisView && showGPTOverlay}
              canvasRef={inputCanvas}
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
            canvasWidth={inputCanvas?.width || 800}
            canvasHeight={inputCanvas?.height || 600}
            visible={showAnalysisView && showTFOverlay}
            isAnalyzing={isRecognizingStrokes}
            waitingForInput={drawingContent?.strokes?.length === 0 && !analysisElements.length}
            strokes={drawingContent?.strokes || [] as any}
            on:detectedObjects={handleTFObjects}
          />
        {/if}
      {/if}

      {#if showStrokeOverlay && drawingContent.strokes.length > 0}
        <StrokeOverlay
          strokes={drawingContent.strokes}
          detectedObjects={analysisElements}
          width={inputCanvas?.width || 800}
          height={inputCanvas?.height || 600}
          visible={showStrokeOverlay}
          canvasRef={inputCanvas}
        />
      {/if}
    </div>

    <div class="canvas-wrapper output-canvas" class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-portrait={generatedImageAspectRatio === 'portrait'} class:ratio-landscape={generatedImageAspectRatio === 'landscape'}>
      <div class="output-display" class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-portrait={generatedImageAspectRatio === 'portrait'} class:ratio-landscape={generatedImageAspectRatio === 'landscape'}>
        {#if $editedImageUrl}
          <img src={$editedImageUrl} alt="AI generated image" class="output-image" />
          <button
            class="model-badge download-button"
            on:click={() => {
              // Create a temporary anchor element
              const link = document.createElement('a');
              link.href = $editedImageUrl;
              link.download = `daydream-image-${Date.now()}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
          >
            <span class="material-icons" style="font-size: 16px; margin-right: 4px;">download</span> Download
          </button>
        {:else}
          <!-- Show translucent preview of drawing canvas when no generated image -->
          <div class="drawing-preview" style="aspect-ratio: {inputCanvas?.width}/{inputCanvas?.height}">
            {#if imageData}
              <img src={imageData} alt="Drawing preview" class="drawing-preview-image" style="width: 100%; height: 100%; object-fit: contain;" />

              {#if $isGenerating}
                <div class="ai-scanning-animation">
                  <div class = 'loader'></div>
                  <div class="scanning-status">
                    <h2> Creating</h2>
                    <div class='dots'>
                      <div class='dot'></div>
                      <div class='dot'></div>
                      <div class='dot'></div>
                    </div>
                  </div>
                </div>
              {/if}
              {:else}
              <p>Your AI-generated image will appear here</p>
            {/if}
          </div>

        {/if}

        <!-- Always display the AIOverlay in the output container -->
        <div class="output-overlay-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10;">
          <AIOverlay
            detectedObjects={analysisElements}
            width={inputCanvas?.width}
            height={inputCanvas?.height}
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

        <!-- Update the output AIOverlay with proper scaling -->
        <div class="output-overlay-container" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 10;">
          <AIOverlay
            detectedObjects={analysisElements}
            width={inputCanvas?.width}
            height={inputCanvas?.height}
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






    <!-- Shape Recognition Dialog and Button -->
     <!--
    <ShapeRecognitionButton
      position={buttonPosition}
      active={showShapeRecognitionDialog}
      objectCount={analysisElements.length}
      isAnalyzing={isAnalyzing || isRecognizingStrokes}
      hasTextAnalysis={sketchAnalysis && sketchAnalysis !== "Draw something to see AI's interpretation" && sketchAnalysis !== "Analyzing drawing..."}
      hasStrokesAnalysis={strokeRecognition && strokeRecognition !== "Draw something to see shapes recognized" && strokeRecognition !== "Analyzing drawing..."}
      hasSketchAnalysis={analysisElements.length > 0}
      on:toggle={toggleShapeRecognitionDialog}
    ></ShapeRecognitionButton>
    -->

    <!-- Component for displaying recognized shapes -->
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
        analyzeDrawing();
      }}
    />

    {#if showDebugPressure && drawingContent.strokes.length > 0}
      <div class="pressure-debug-overlay">
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

  #app {
    height: 100vh;
    width: 100%;
    overflow: hidden;
  }

  .loader{
    width: 40px;
    aspect-ratio: 1;
    --c:no-repeat linear-gradient(white 0 0);
    background:
      var(--c) 0    0,
      var(--c) 0    100%,
      var(--c) 50%  0,
      var(--c) 50%  100%,
      var(--c) 100% 0,
      var(--c) 100% 100%;
    background-size: 8px 50%;
    animation: l7-0 1s infinite;
    position: relative;
    overflow: hidden;

    &:before{
      content: "";
      position: absolute;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: white;
      top: calc(50% - 4px);
      left: -8px;
      animation: inherit;
      animation-name: l7-1;
    }
  }

  @keyframes l7-0 {
    16.67% {background-size:8px 30%, 8px 30%, 8px 50%, 8px 50%, 8px 50%, 8px 50%}
    33.33% {background-size:8px 30%, 8px 30%, 8px 30%, 8px 30%, 8px 50%, 8px 50%}
    50%    {background-size:8px 30%, 8px 30%, 8px 30%, 8px 30%, 8px 30%, 8px 30%}
    66.67% {background-size:8px 50%, 8px 50%, 8px 30%, 8px 30%, 8px 30%, 8px 30%}
    83.33% {background-size:8px 50%, 8px 50%, 8px 50%, 8px 50%, 8px 30%, 8px 30%}
  }

  @keyframes l7-1 {
    20%  {left:0px}
    40%  {left:calc(50%  - 4px)}
    60%  {left:calc(100% - 8px)}
    80%,
    100% {left:100%}
  }

  .scanning-status{
    display: none;
    align-items: flex-end;
    justify-content: center;
    gap: 6px;
    height: fit-content;

    h2{
      font-weight: 700;
      letter-spacing: -0.5px;
      margin: 0 !important;
      line-height: 100%;
    }

    .dots{
      display: flex;
      gap: 2px;
      padding-bottom: 3px;
      .dot{
        width: 4px;
        height: 4px;
        border-radius: 0px;
        background-color: white;
        transition: none;
        animation: dot-animation 1.5s infinite;

        &:nth-child(2){
          animation-delay: 0.5s;
        }

        &:nth-child(3){
          animation-delay: 1s;
        }
      }
    }
  }

  @keyframes dot-animation {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
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

    .demo-header {
      text-align: center;
      margin-bottom: 1rem;

      h1 {
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }

      p {
        font-size: 1rem;
        color: #666;
        margin-bottom: 1rem;
      }

      .bar{
        display: flex;
        align-items: center;
        margin: 8px 0 0px 0;
      }

      .context-input-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 550px;

        border: 1px solid rgba(white, 0.05);
        background: rgba(white, .0);
        border-radius: 32px;
        text-align: center;
        box-shadow: -4px 16px 24px rgba(black, 0.2);
        text-shadow: 0 4px 12px rgba(black, .1);

        padding: 6px 6px 6px 16px;

        .context-input {
          font-family: 'Newsreader', 'DM Sans', serif;
          font-size: 18px;
          font-weight: 650;
          line-height: 100%;
          letter-spacing: -.4px;
          color: white;
          background: none;
          border: none;
          flex: 1;

          padding: 2px 0 0 0;

          &::placeholder {
            color: rgba(white, .3);
          }

          &:focus {
            outline: none;
          }
        }
      }

      .error-message {
        display: flex;
        align-items: center;
        gap: 10px;
        color: #d32f2f;
        background: #ffebee;
        padding: 10px 16px;
        border-radius: 8px;
        margin-top: 8px;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(211, 47, 47, 0.3);
        animation: error-pulse 2s infinite;

        .material-icons {
          color: #d32f2f;
        }

        @keyframes error-pulse {
          0%, 100% { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); }
          50% { box-shadow: 0 2px 12px rgba(211, 47, 47, 0.3); }
        }
      }
    }

    .generate-button, .analyze-button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: #635FFF;
      border: none;
      border-radius: 24px;
      padding: 6px 14px 8px 10px;

      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: -4px 12px 16px rgba(black, .1);
      position: relative;
      overflow: hidden;
      color: white;

      h3{
        font-family: 'Newsreader', 'DM Sans', serif;
        font-size: 18px;
        font-weight: 650;
        padding: 4px 0 0 0;
      }

      span{
        font-size: 14px !important;
        font-weight: 900;
        color: #6355FF;
        background: white;
        border-radius: 12px;
        padding: 2px;
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
       // transform: translateY(-.5px);
        box-shadow: 0 6px 18px 4px rgba(156, 39, 176, 0.5);

        &::before {
          opacity: 1;
        }
      }

      &:active {
        transform: translateY(1px);
        box-shadow: 0 2px 5px rgba(156, 39, 176, 0.4);

      }

      &:disabled {
        background: linear-gradient(45deg, #9e9e9e, #bdbdbd);
        cursor: not-allowed;
        box-shadow: none;

        span{
          color: rgba(black, .5);
        }

        &:hover {
          transform: none;
        }
      }

      .material-icons {
        font-size: 18px;
      }
    }

    .canvas-container {
      display: flex;
      justify-content: center;
      align-items: center;
      flex: 1;
      gap: 24px;
      margin: 12px 0;
      min-width: 400px;
      width: 95vw;
      max-height: 85vh;
      position: relative;

      // New wrapper for toolbars
      .toolbars-wrapper {
        display: flex;
        flex-direction: column; // Stack toolbars vertically
        gap: 10px; // Space between toolbars
        height: fit-content; // Adjust height to content
        z-index: 5;

        // Toolbar styles
        .vertical-toolbar {
          background: rgba(black, .35);
          border-radius: 8px;
          box-shadow: -4px 16px 24px rgba(black, 0.25);
          padding: 12px 6px; // Adjusted padding
          box-sizing: border-box;
          width: 52px; // Slightly narrower
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;

          &.tool-selector-toolbar {
            // Specific styles for the tool selector if needed
            gap: 10px;
          }

          &.options-toolbar {
            // Specific styles for the options toolbar if needed
            gap: 20px; // Keep original gap for options
          }

          .tools-group {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            width: 100%; // Ensure tool groups take width

            .tool-group {
              input[type="color"] {
                -webkit-appearance: none;
                border: none;
                outline: none;
                width: 28px;
                height: 28px;
                padding: 0;
                border-radius: 20px;
                cursor: pointer;
                overflow: hidden;
                margin-bottom: 12px;
                position: relative;
                box-shadow: -2px 8px 12px rgba(black, .5);

                &::after {
                  content: '';
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  background: none;
                  border-radius: 20px;
                  border: 1.5px solid rgba(white, .3);
                  box-shadow: inset 1px 2px 3px rgba(white, .25), inset -1px -2px 3px rgba(black, .25);
                }

                &::-webkit-color-swatch-wrapper {
                  padding: 0;
                }

                &::-webkit-color-swatch {
                  border: none;
                  border-radius: 20px;
                }
              }
            }
          }
        }
      }

      .canvas-wrapper {
        flex: 1;
        position: relative;
        display: flex;
        justify-content: center;
        align-items: center;
        overflow: visible;
        transition: all 0.3s ease;
        border-radius: 0;

        &.input-canvas {
          min-width: 300px;
          max-width: 800px;

          // Adjust dimensions based on aspect ratio
          &.ratio-1-1 {
            min-height: 300px;
            max-height: 800px;
            aspect-ratio: 1 / 1;
          }

          &.ratio-portrait {
            min-height: calc(300px * (1024 / 1792));
            max-height: calc(800px * (1024 / 1792));
            aspect-ratio: 1792 / 1024;
          }

          &.ratio-landscape {
            min-height: calc(300px * (1792 / 1024));
            max-height: calc(800px * (1792 / 1024));
            aspect-ratio: 1024 / 1792;
          }

          /* Update to ensure proper canvas containment */
          .drawing-canvas {
            border-radius: 8px;
            margin: 0;
            display: block;
            max-width: 100%;
            max-height: 100%;
            width: auto;
            height: fit-content;
            cursor: crosshair;
            object-fit: contain;
            box-shadow: -12px 32px 32px rgba(black, 0.4);
          }
        }

        &.output-canvas {
          min-width: 300px;
          max-width: 800px;

          // Adjust dimensions based on aspect ratio
          &.ratio-1-1 {
            min-height: 300px;
            max-height: 800px;
            aspect-ratio: 1 / 1;
          }

          &.ratio-portrait {
            min-height: calc(300px * (1024 / 1792));
            max-height: calc(800px * (1024 / 1792));
            aspect-ratio: 1792 / 1024;
          }

          &.ratio-landscape {
            min-height: calc(300px * (1792 / 1024));
            max-height: calc(800px * (1792 / 1024));
            aspect-ratio: 1024 / 1792;
          }

          .output-display {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: 100%;
            border-radius: 8px;
            overflow: visible;
            box-shadow: -12px 32px 32px rgba(black, 0.3);

            &.output-image {
              border-radius: 8px;
            }

            // Dynamically adjust aspect ratio based on the generated image
            &.ratio-1-1 {
              aspect-ratio: 1 / 1; /* Square 1:1 */
            }

            &.ratio-portrait {
              aspect-ratio: 1792 / 1024; /* Portrait */
            }

            &.ratio-landscape {
              aspect-ratio: 1024 / 1792; /* Landscape */
            }

            img {
              max-width: 100%;
              max-height: 100%;
              width: 100%;
              object-fit: contain;
              transition: transform 0.3s ease;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
              border-radius: 4px;
            }

            .model-badge {
              position: absolute;
              bottom: 10px;
              right: 10px;
              background: rgba(0, 0, 0, 0.7);
              color: white;
              padding: 7px 12px 8px 10px;
              border-radius: 8px;
              font-size: 0.8rem;
              backdrop-filter: blur(8px);
            }

            .download-button {
              border: none;
              cursor: pointer;
              display: flex;
              align-items: center;
              transition: background-color 0.2s ease;
              font-family: inherit;
              font-weight: 600;
              box-shadow: 6px 10px 16px rgba(black, .4);
              transition: .2s ease;

              span{
                font-size: 14px !important;
                color: white;
              }

              &:hover {
                background: rgba(0, 0, 0, 0.85);
              }

              &:active {
                transform: translateY(1px);
              }
            }

            .drawing-preview {
              width: 100%;
              height: 100%;
              display: flex;
              justify-content: center;
              align-items: center;
              overflow: hidden;
              position: relative;
              color: #888;
              font-size: 1rem;
              text-align: center;
              border-radius: 8px;

              .drawing-preview-image {
                width: 100%;
                height: 100%;
                object-fit: contain;
                opacity: 0.1; /* Translucent as specified */
              }

              .ai-scanning-animation {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                gap: 16px;

                filter: drop-shadow(-4px 24px 12px rgba(black, 0.3));

                h2 {
                  color: white;
                }
              }
            }

            .output-placeholder {
              p {
                margin: 0;
                color: rgba(white, 0.6);
                font-size: 16px;
                text-align: center;
              }
            }

            // Output overlay container styles
            .output-overlay-container {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              pointer-events: none;
              z-index: 10;
              display: flex;
              justify-content: center;
              align-items: center;
            }
          }
        }

        h2 {
          margin: 0 0 1rem 0;
          font-size: 1.25rem;
          color: #555;
        }
      }

      @media (max-width: 768px) {
        flex-direction: column;
        max-height: none;

        .toolbars-wrapper {
          flex-direction: row; // Side-by-side on mobile
          width: 100%;
          justify-content: center;
          gap: 15px;
        }
      }
    }

    .action-area {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5rem;
      padding: 1rem 0;
      max-width: 800px;
      margin: 0 auto;

      .analyze-button {
        background: linear-gradient(45deg, #1976d2, #2196f3);
        box-shadow: 0 4px 10px rgba(33, 150, 243, 0.3);

        &:hover {
          box-shadow: 0 6px 15px rgba(33, 150, 243, 0.4);
        }

        &:active {
          box-shadow: 0 2px 5px rgba(33, 150, 243, 0.4);
        }
      }

      .mini-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spinner 0.8s linear infinite;
        margin-right: 8px;
      }

      @keyframes spinner {
        to {
          transform: rotate(360deg);
        }
      }
    }
  }

  // Analysis overlay and related styles
  .analysis-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;
  }

  .connection-line {
    position: absolute;
    pointer-events: none;
    opacity: 0.6;
    z-index: 1;

    &::before, &::after {
      content: '';
      position: absolute;
      width: 4px;
      height: 4px;
      background-color: currentColor;
      border-radius: 50%;
      opacity: 0.8;
    }

    &::before {
      left: 0;
      top: 0;
      transform: translate(-50%, -50%);
    }

    &::after {
      right: 0;
      top: 0;
      transform: translate(50%, -50%);
    }
  }

  .analysis-element {
    position: absolute;
    width: 36px;
    height: 36px;
    margin-left: -18px;  /* Half the width */
    margin-top: -18px;   /* Half the height */
    border: 2px solid var(--element-color);
    background-color: rgba(255, 255, 255, 0.9);
    border-radius: 50%;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.3s ease;

    &:hover {
      transform: scale(1.15);
      z-index: 5;
      box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
    }

    /* Different styles based on categories */
    &.human, &.animal {
      &::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background-color: rgba(255, 255, 255, 0.2);
        transform: translate(-50%, -50%);
        z-index: -1;
      }
    }

    &.building, &.landscape {
      &::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 16px;
        height: 16px;
        background-color: rgba(255, 255, 255, 0.2);
        transform: translate(-50%, -50%) rotate(45deg);
        z-index: -1;
      }
    }

    &.parent-element {
      z-index: 3;

      &::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        border: 2px dashed var(--element-color);
        border-radius: 50%;
        opacity: 0.4;
        animation: pulsate 3s ease-out infinite;
      }
    }

    &.child-element {
      width: 28px;
      height: 28px;
      margin-left: -14px;
      margin-top: -14px;
      opacity: 0.9;
    }

    /* Element label styling */
    .element-label {
      position: absolute;
      top: -24px;
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
      background-color: var(--element-color);
      color: white;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: none;
    }

    &:hover .element-label {
      opacity: 1;
      transform: translateX(-50%) translateY(-4px);
    }

    /* Badge for parent elements with children */
    .element-badge {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: 18px;
      height: 18px;
      background-color: var(--element-color);
      border: 2px solid white;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 0.6rem;
      font-weight: bold;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    /* Position marker dot for precise center point */
    .position-marker {
      position: absolute;
      width: 6px;
      height: 6px;
      background-color: var(--element-color);
      border-radius: 50%;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.8);
      opacity: 0.8;
      pointer-events: none;
      transition: all 0.3s ease;
    }

    &:hover .position-marker {
      width: 8px;
      height: 8px;
      box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.9), 0 0 12px rgba(0,0,0,0.3);
      opacity: 1;
    }

    &::before {
      content: '';
      position: absolute;
      width: 40px;
      height: 40px;
      border: 2px dashed var(--element-color);
      border-radius: 50%;
      opacity: 0.6;
      transform: translate(-50%, -50%);
      left: 50%;
      top: 50%;
      pointer-events: none;
      animation: rotate 10s infinite linear;
    }

    /* Add a central dot to mark the exact position */
    &::after {
      content: '';
      position: absolute;
      width: 8px;
      height: 8px;
      background-color: var(--element-color);
      border: 2px solid white;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      left: 50%;
      top: 50%;
      pointer-events: none;
      z-index: 25;
      box-shadow: 0 0 4px rgba(0, 0, 0, 0.3);
    }
  }

  @keyframes pulsate {
    0% {
      transform: scale(1);
      opacity: 0.4;
    }
    50% {
      transform: scale(1.2);
      opacity: 0.2;
    }
    100% {
      transform: scale(1);
      opacity: 0.4;
    }
  }

  @keyframes rotate {
    0% { transform: translate(-50%, -50%) rotate(0deg); }
    100% { transform: translate(-50%, -50%) rotate(360deg); }
  }

  // Tool Button Styles
  .tool-button {
    padding: 6px;
    background: none;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 6px;

    .material-icons {
      font-size: 22px;
      color: #ccc; // Lighter icon color
      transition: color 0.2s, background-color 0.2s;
    }

    &:hover {
      background: rgba(white, 0.1);

      .material-icons {
        color: #6355FF;
      }
    }

    &.clear-button {
      background: rgba(red, .1);

      span {
        color: red;
        text-shadow: 0 0 2px 2px rgba(black, 1);
      }

      &:hover {
        background: rgba(red, .3);

        span {
          color: red;
        }
      }
    }

    // Active state for tool buttons
    &.active {
      background: rgba(#6355FF, 0.2);

      .material-icons {
        color: #6355FF;
      }
    }
  }

  // Pressure Debug Overlay
  .pressure-debug-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;

    .pressure-point {
      position: absolute;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
    }
  }

  // Toggle Switch Styles
  .tool-group.toggle-switch {
    margin: 0.5rem 0;

    .tool-icon-label {
      color: #555;
      margin-bottom: 0.25rem;
    }

    .tool-label {
      font-size: 0.8rem;
      color: #444;
      margin-top: 0.25rem;
    }

    .switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 20px;

      input {
        opacity: 0;
        width: 0;
        height: 0;

        &:checked + label {
          background-color: #6355FF;
        }

        &:checked + label:before {
          transform: translateX(18px);
        }

        &:focus + label {
          box-shadow: 0 0 1px #6355FF;
        }

        &:disabled + label {
          background-color: #ccc;
          cursor: not-allowed;
          opacity: 0.6;
        }

        &:disabled + label:before {
          background-color: #eee;
        }

        // Different colors for different toggles
        &#analysis-toggle:checked + label {
          background-color: #43A047; /* Green for AI analysis */
        }

        &#stroke-overlay-toggle:checked + label {
          background-color: #3949AB; /* Blue for Stroke Recognition */
        }
      }

      label {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #ccc;
        transition: 0.4s;
        border-radius: 20px;
        box-shadow: inset 0 0 5px rgba(0, 0, 0, 0.2);

        &:before {
          position: absolute;
          content: "";
          height: 16px;
          width: 16px;
          left: 3px;
          bottom: 2px;
          background-color: white;
          transition: 0.4s;
          border-radius: 50%;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
        }

        &:hover:before {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }
      }
    }
  }

  .dropdown {
    margin-left: 12px;

    .select-wrapper {
      position: relative;
      display: inline-block;

      .custom-caret {
        position: absolute;
        right: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(white, 0.7);
        font-size: 22px;
        pointer-events: none; // Allow clicks to pass through to the select
        transition: color 0.2s ease;
      }

      &:hover {
        .custom-caret {
          color: white;
        }
      }
    }

    select {
      font-family: 'Newsreader', 'DM Sans', serif;
      font-size: 16px;
      font-weight: 550;
      letter-spacing: -0.24px;
      padding: 12px 40px 12px 16px;
      border-radius: 24px;
      background: rgba(black, 0.2);
      color: white;
      border: 1px solid rgba(white, 0.1);
      cursor: pointer;
      box-shadow: -4px 16px 24px rgba(black, 0.25);
      transition: .2s ease;
      appearance: none; // Remove default caret
      -webkit-appearance: none;
      -moz-appearance: none;

      option {
        background: #333;
        color: white;
      }

      &:hover{
        background: rgba(black, 0.25);
      }

      &:focus {
        outline: none;
      }
    }
  }

</style>