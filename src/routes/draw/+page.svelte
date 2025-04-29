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

  // Interface extension for Stroke type with hasPressure property
  interface EnhancedStroke extends Stroke {
    hasPressure?: boolean;
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
  let strokeColor = '#000000';
  let strokeSize = 4;
  let strokeOpacity = 0.8;
  let imageData: string | null = null;
  let pointTimes: number[] = []; // Track time for velocity-based pressure
  let isGenerating = false;
  let generatedImageUrl: string | null = null;
  let generatedByModel: string | null = null;
  let errorMessage: string | null = null;
  let showAnalysisView = true; // Toggle for AI analysis view
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
  let currentCanvasSnapshot: string = ''; // Store the current canvas snapshot

  // Function to determine if an event is a real user edit vs. a programmatic change
  function isRealUserEdit(): boolean {
    // Skip during resize events - these aren't user edits
    if (isResizeEvent) {
      console.log('Skipping analysis due to resize event');
      return false;
    }

    // Skip during loading or artificial events
    if (isGenerating || isArtificialEvent) {
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
      }
    }

    // Start analyzing strokes automatically after a short delay
    setTimeout(() => {
      // Only if we have strokes to analyze
      if (drawingContent.strokes.length > 0) {
        recognizeStrokes();
        analyzeSketch();
      }
    }, 1000);

    return () => {
      // Cleanup when component unmounts
      if (renderDebounceTimeout) {
        clearTimeout(renderDebounceTimeout);
      }
    };
  });

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

  // Track the last resize time
  let lastResizeTime = 0;

  // Function to resize canvas
  function resizeCanvas() {
    if (!inputCanvas || !inputCanvas.parentElement) return;

    lastResizeTime = Date.now(); // Track resize time
    isResizeEvent = true; // Flag that this is a resize event

    const container = inputCanvas.parentElement;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight - 50; // Account for header

    // Get the selected aspect ratio value
    const targetRatio = aspectRatios[selectedAspectRatio];

    // Calculate dimensions that will fit in the container while maintaining aspect ratio
    let newCanvasWidth = 0;
    let newCanvasHeight = 0;

    // For vertical aspect ratios (height > width)
    if (targetRatio < 1) {
      // Start by trying to fit the height
      newCanvasHeight = Math.min(containerHeight, 800); // Cap at 800px height
      newCanvasWidth = newCanvasHeight * targetRatio;

      // If width exceeds container width, recalculate based on width
      if (newCanvasWidth > containerWidth) {
        newCanvasWidth = containerWidth;
        newCanvasHeight = newCanvasWidth / targetRatio;
      }
    }
    // For square or horizontal aspect ratios
    else {
      // Start by trying to fit the width
      newCanvasWidth = Math.min(containerWidth, 800); // Cap at 800px width
      newCanvasHeight = newCanvasWidth / targetRatio;

      // If height exceeds container height, recalculate based on height
      if (newCanvasHeight > containerHeight) {
        newCanvasHeight = containerHeight;
        newCanvasWidth = newCanvasHeight * targetRatio;
      }
    }

    // Use a fixed internal resolution for high quality, but maintain the aspect ratio
    const internalResolutionBase = 1024;
    const internalWidth = Math.round(internalResolutionBase * targetRatio);
    const internalHeight = internalResolutionBase;

    // Set internal canvas dimensions (for rendering)
    inputCanvas.width = internalWidth;
    inputCanvas.height = internalHeight;

    // Set display size based on calculated dimensions
    inputCanvas.style.width = `${Math.round(newCanvasWidth)}px`;
    inputCanvas.style.height = `${Math.round(newCanvasHeight)}px`;

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
      // Reset resize event flag after rendering
      setTimeout(() => { isResizeEvent = false; }, 50); // Short delay after render
    }, 100); // Debounce rendering on resize

    console.log(
      `Canvas resized. Container: ${containerWidth}x${containerHeight}, ` +
      `Aspect Ratio: ${selectedAspectRatio} (${targetRatio.toFixed(2)}), ` +
      `Display Size: ${Math.round(newCanvasWidth)}x${Math.round(newCanvasHeight)}, ` +
      `Internal Res: ${internalWidth}x${internalHeight}`
    );
  }

  // Reactive statement to resize canvas when aspect ratio changes or on window resize
  $: {
    if (browser) {
      resizeCanvas(); // Initial resize
      // Trigger analysis if needed after resize
      if (drawingContent.strokes.length > 0 && !isAnalyzing && !isRecognizingStrokes) {
        forceAnalysisFlag = true; // Force analysis after resize if there's content
        analyzeSketch();
        recognizeStrokes();
      }
    }
  }

  // Function to start drawing
  function startDrawing(e: PointerEvent) {
    if (e.button !== 0) return; // Only draw on left click/touch

    isDrawing = true;
    console.log('Drawing started');

    // Get pointer position
    const point = getPointerPosition(e);

    // Store initial timestamp for pressure calculation
    const timestamp = Date.now();
    pointTimes = [timestamp];

    // Check if pressure is supported by the device
    const hasPressure = e.pressure !== 0 && e.pressure !== 0.5;
    console.log(`Pressure supported: ${hasPressure}, value: ${e.pressure}`);

    // Create a new stroke
    currentStroke = {
      tool: 'pen',
      points: [point],
      color: strokeColor,
      size: strokeSize,
      opacity: strokeOpacity,
      hasPressure: hasPressure
    };

    // Capture pointer
    inputCanvas.setPointerCapture(e.pointerId);
  }

  // Function to continue drawing
  function continueDrawing(e: PointerEvent) {
    if (!isDrawing || !currentStroke || !inputCtx) return;

    // Get pointer position and pressure
    const point = getPointerPosition(e);

    // Store timestamp for velocity-based pressure
    const timestamp = Date.now();
    pointTimes.push(timestamp);

    // If the device doesn't support pressure, calculate it based on velocity
    if (!currentStroke.hasPressure && currentStroke.points.length > 1) {
      // Calculate pressure based on velocity between points
      const calculatedPressure = calculatePressureFromVelocity(
        currentStroke.points,
        currentStroke.points.length - 1,
        0.2, // velocityScale
        true, // use time-based velocity
        pointTimes
      );

      // Update pressure in the point
      point.pressure = calculatedPressure;
    }

    // Add point to current stroke
    currentStroke.points.push(point);

    // Render all strokes including the current one
    renderStrokes();
  }

  // Function to end drawing
  function endDrawing(e: PointerEvent) {
    if (!isDrawing || !currentStroke) return;

    console.log('Drawing ended');

    // Add the current stroke to strokes array
    drawingContent.strokes.push(currentStroke);
    // Trigger Svelte reactivity with reassignment
    drawingContent = drawingContent;
    console.log('Stroke added, total strokes:', drawingContent.strokes.length);

    // Reset current stroke
    currentStroke = null;
    isDrawing = false;

    // Release pointer
    inputCanvas.releasePointerCapture(e.pointerId);

    // Mark this as an edit time
    lastUserEditTime = Date.now();
    pendingAnalysis = true;

    // Trigger sketch analysis after a short delay to let the canvas update
    // Only if we haven't analyzed recently
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

    // Calculate scaling factors in case the canvas rendering size differs from its CSS display size
    const scaleX = inputCanvas.width / rect.width;
    const scaleY = inputCanvas.height / rect.height;

    // Check if the device provides pressure
    const pressure = e.pressure !== 0 ? e.pressure : 0.5;

    // Apply the scaling to get the correct position within the canvas
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      pressure: pressure
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

    // Function to render a single stroke
    const renderStroke = (stroke: EnhancedStroke) => {
      if (stroke.points.length < 2) return;

      // Generate perfect-freehand options
      const options = {
        size: stroke.size,
        thinning: 0.5,     // How much to thin the stroke
        smoothing: 0.5,    // How much to smooth the stroke
        streamline: 0.5,   // How much to streamline the stroke
        easing: (t: number) => t, // Linear easing
        simulatePressure: !(stroke as EnhancedStroke).hasPressure, // Only simulate if hardware pressure not available
        last: false,       // Whether this is the last point
        start: {
          cap: true,       // Cap at the start
          taper: 0,        // No taper
          easing: (t: number) => t, // Linear easing
        },
        end: {
          cap: true,       // Cap at the end
          taper: 0,        // No taper
          easing: (t: number) => t, // Linear easing
        }
      };

      // Generate stroke with perfect-freehand
      const freehandStroke = getStroke(
        stroke.points.map(p => [p.x, p.y, p.pressure || 0.5]),
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

      // Fill the path
      inputCtx!.fill(path);
    };

    // Render all strokes
    for (const stroke of drawingContent.strokes) {
      renderStroke(stroke);
    }

    // Render current stroke if it exists
    if (currentStroke) {
      renderStroke(currentStroke);
    }

    // Reset alpha
    inputCtx.globalAlpha = 1;
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

    // Skip if we don't have pending user edits
    if (!forceAnalysisFlag && !pendingAnalysis && (now - lastUserEditTime > ANALYSIS_THROTTLE_MS * 2)) {
      console.log('Skipping analysis - no recent user edits');
      return;
    }

    // Generate a perceptual hash of the current strokes to check if they've changed meaningfully
    const currentStrokesHash = generateStrokesHash(drawingContent.strokes);

    // Skip if the strokes haven't changed meaningfully since last analysis
    if (!forceAnalysisFlag && currentStrokesHash === lastAnalyzedStrokesHash) {
      console.log('Skipping analysis - strokes unchanged');
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
      lastAnalyzedStrokesHash = currentStrokesHash;
      pendingAnalysis = false;

      // Reset force flag
      forceAnalysisFlag = false;

      console.log('Starting sketch analysis API call...');

      // Set a timeout for the analysis request
      const timeoutMs = 20000; // 20 seconds max
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Capture the current canvas as an image
        const imageData = captureCanvasSnapshot();

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

    // Skip if we don't have pending user edits
    if (!forceAnalysisFlag && !pendingAnalysis && (now - lastUserEditTime > ANALYSIS_THROTTLE_MS * 2)) {
      console.log('Skipping stroke recognition - no recent user edits');
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

      console.log('Starting stroke recognition API call...');

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
    generatedImageUrl = null;
    generatedByModel = null;
    renderStrokes();
  }

  // Function to generate image from drawing
  async function generateImage() {
    if (drawingContent.strokes.length === 0) {
      errorMessage = "Please draw something first!";
      setTimeout(() => { errorMessage = null; }, 3000);
      return;
    }

    console.log('Starting image generation with', drawingContent.strokes.length, 'strokes');
    if (additionalContext) {
      console.log('Additional context provided:', additionalContext);
    }

    try {
      isGenerating = true;
      errorMessage = null;
      generatedByModel = null;

      // Store the current aspect ratio to use for the generated image
      // This ensures the generated image matches the drawing canvas
      generatedImageAspectRatio = selectedAspectRatio;
      console.log(`Using aspect ratio ${selectedAspectRatio} (${aspectRatios[selectedAspectRatio]}) for generated image`);

      // Capture the canvas image and store it for preview during loading
      imageData = inputCanvas.toDataURL('image/png');

      // Create a deep copy of the drawing content to avoid any reactivity issues
      const drawingContentCopy = JSON.parse(JSON.stringify(drawingContent));

      // Analyze the drawing to extract any text
      console.log('Sending to text analysis API...');
      const textAnalysisResponse = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          drawingContent: drawingContentCopy,
          userPrompt: "Extract any text or labels from this drawing, and describe what objects or scenes are depicted.",
          imageData,
          useVision: true
        })
      });

      if (!textAnalysisResponse.ok) {
        throw new Error("Failed to analyze drawing");
      }

      const textAnalysis = await textAnalysisResponse.json();
      console.log('Text analysis completed');

      // Prepare detailed structural information from our analysis elements
      let structuralDetails = null;
      if (analysisElements.length > 0) {
        // Collect information about all analyzed elements and their precise positions
        structuralDetails = {
          elementCount: analysisElements.length,
          elements: analysisElements.map(element => ({
            id: element.id,
            name: element.name,
            category: element.category || 'unknown',
            position: {
              x: element.x,
              y: element.y,
            },
            bounds: element.boundingBox ? {
              minX: element.boundingBox.minX,
              minY: element.boundingBox.minY,
              maxX: element.boundingBox.maxX,
              maxY: element.boundingBox.maxY,
              width: element.boundingBox.width,
              height: element.boundingBox.height
            } : {
              // Fallback for elements without precise bounds
              minX: element.x - (element.width / canvasWidth) / 2,
              minY: element.y - (element.height / canvasHeight) / 2,
              width: element.width / canvasWidth,
              height: element.height / canvasHeight
            },
            isChild: element.isChild || false,
            parentId: element.parentId,
            children: element.children || []
          }))
        };

        console.log('Including detailed structural information:', structuralDetails);
      }

      // Now call the endpoint to generate an image based on the drawing
      console.log('Sending to image generation API...');
      const response = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          drawingContent: drawingContentCopy,
          imageData,
          textAnalysis: textAnalysis.message,
          additionalContext: additionalContext,
          sketchAnalysis: sketchAnalysis,
          strokeRecognition: strokeRecognition,
          structuralDetails: structuralDetails, // Send the detailed structural information
          aspectRatio: selectedAspectRatio, // Explicitly set the selected aspect ratio
          aspectRatioValue: aspectRatios[selectedAspectRatio] // Also pass the numerical value for precision
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate image');
      }

      const result = await response.json();
      console.log('Image generation successful');
      console.log('API response:', result);
      console.log('API response type:', typeof result);
      console.log('API response keys:', Object.keys(result));  // Log all keys in the response

      // Handle different response formats robustly
      const imageUrl = result.imageUrl || result.url;
      if (!imageUrl) {
        console.error('No image URL found in response:', result);
        errorMessage = 'Missing image URL in API response';
        return;
      }

      // Set the URL and model values, and store returned aspect ratio if available
      generatedImageUrl = imageUrl;
      generatedByModel = result.model || 'AI Model';
      if (result.aspectRatio) {
        generatedImageAspectRatio = result.aspectRatio;
      }
    } catch (error) {
      console.error('Error generating image:', error);
      errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    } finally {
      isGenerating = false;
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

  // Handle pointer up event - end drawing
  function onPointerUp(e: PointerEvent) {
    if (!isDrawing || !currentStroke) return;

    // Add the final point
    const point = getPointerPosition(e);
    currentStroke.points.push(point);

    // Add the stroke to the drawing content
    drawingContent.strokes.push(currentStroke);
    // Trigger Svelte reactivity with reassignment
    drawingContent = drawingContent;
    console.log('Stroke added, total strokes:', drawingContent.strokes.length);

    // Reset current stroke
    currentStroke = null;
    isDrawing = false;

    // Release pointer
    inputCanvas.releasePointerCapture(e.pointerId);

    // Mark this as an edit time
    lastUserEditTime = Date.now();
    pendingAnalysis = true;

    // Trigger sketch analysis after a short delay to let the canvas update
    // Only if we haven't analyzed recently
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

  // State variables for Shape Recognition Dialog
  let showShapeRecognitionDialog = false;
  let showAIDebugMode = false;

  // Function to toggle Shape Recognition Dialog
  function toggleShapeRecognitionDialog() {
    // Capture canvas snapshot when dialog is opened
    if (!showShapeRecognitionDialog) {
      currentCanvasSnapshot = captureCanvasSnapshot();
    }
    showShapeRecognitionDialog = !showShapeRecognitionDialog;
  }

  // Function to toggle Debug Mode
  function toggleDebugMode() {
    showAIDebugMode = !showAIDebugMode;
  }

  // Position for the shape recognition button
  let buttonPosition = { right: '20px', bottom: '70px' };
  // Position for the shape recognition dialog
  let shapeDialogPosition = { right: '20px', top: '120px' };

  // State for aspect ratio
  let selectedAspectRatio = '4:5'; // Default aspect ratio (vertical 4:5)
  const aspectRatios = {
    '4:5': 4 / 5,   // Vertical 4:5 aspect ratio
    '1:1': 1 / 1,   // Square aspect ratio
    '9:16': 9 / 16  // Vertical 9:16 aspect ratio (more extreme vertical)
  };

  // Store the aspect ratio of the generated image
  let generatedImageAspectRatio = '4:5'; // Default to match the selectedAspectRatio

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
</script>

<svelte:head>
  // ... existing code ...
  <title>Precision AI Structure-Preserving Image Generator | Daydream</title>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
</svelte:head>

<div class="draw-demo-container">
  <header class="demo-header">
    <div class="context-input-container">
      <input
        id="context-input"
        type="text"
        bind:value={additionalContext}
        placeholder="Describe what you're drawing (e.g., 'A castle on a mountain at sunset')"
        class="context-input"
      />
    </div>
  </header>

  <div class="canvas-container">
    <div class="vertical-toolbar">
        <div class="tools-group">
          <div class="tool-group">
            <span class="material-icons tool-icon-label">brush</span>
            <VerticalSlider
              min={1}
              max={20}
              step={0.5}
              bind:value={strokeSize}
              color="#6355FF"
              height="100px"
              onChange={() => renderStrokes()}
              showValue={true}
            />
          </div>

          <div class="tool-group">
            <span class="material-icons tool-icon-label">palette</span>
            <input
              type="color"
              bind:value={strokeColor}
              on:change={renderStrokes}
            />
          </div>

          <div class="tool-group">
            <span class="material-icons tool-icon-label">opacity</span>
            <VerticalSlider
              min={0.1}
              max={1}
              step={0.1}
              bind:value={strokeOpacity}
              color="#6355FF"
              height="100px"
              onChange={() => renderStrokes()}
              showValue={true}
            />
          </div>

          <!-- Aspect Ratio Selector -->
          <div class="tool-group aspect-ratio-selector">
            <span class="material-icons tool-icon-label">aspect_ratio</span>
            <select bind:value={selectedAspectRatio} on:change={resizeCanvas}>
              {#each Object.keys(aspectRatios) as ratioKey}
                <option value={ratioKey}>{ratioKey}</option>
              {/each}
            </select>
            <span class="tool-label">Aspect Ratio</span>
          </div>

          <!-- Updated analysis toggles to show both separately -->
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

          <div class="tool-group toggle-switch">
            <span class="material-icons tool-icon-label">description</span>
            <div class="switch">
              <input
                type="checkbox"
                id="stroke-overlay-toggle"
                bind:checked={showStrokeOverlay}
              />
              <label for="stroke-overlay-toggle"></label>
            </div>
            <span class="tool-label">Stroke Recognition</span>
          </div>

          <button class="tool-button" on:click={clearCanvas}>
            <span class="material-icons">delete_outline</span>
          </button>
        </div>
    </div>

    <div class="canvas-wrapper input-canvas" class:ratio-4-5={selectedAspectRatio === '4:5'} class:ratio-1-1={selectedAspectRatio === '1:1'} class:ratio-9-16={selectedAspectRatio === '9:16'}>
      <h2>Your Sketch</h2>
      <canvas
        bind:this={inputCanvas}
        class="drawing-canvas"
        on:pointerdown={startDrawing}
        on:pointermove={continueDrawing}
        on:pointerup={onPointerUp}
        on:pointercancel={onPointerUp}
        on:pointerleave={onPointerUp}
      ></canvas>

      <!-- Update the overlay rendering conditions -->
      {#if showAnalysisView && (analysisElements.length > 0 || (drawingContent?.strokes?.length === 0 && !analysisElements.length))}
        {#if showGPTOverlay}
          <AIOverlay
            detectedObjects={gptObjects}
            width={inputCanvas?.width || 800}
            height={inputCanvas?.height || 600}
            visible={showAnalysisView && showGPTOverlay}
            canvasRef={inputCanvas}
            isAnalyzing={isAnalyzing}
            waitingForInput={drawingContent?.strokes?.length === 0 && !analysisElements.length}
            strokes={drawingContent?.strokes || [] as any}
          />
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

    <div class="canvas-wrapper output-canvas" class:ratio-4-5={generatedImageAspectRatio === '4:5'} class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-9-16={generatedImageAspectRatio === '9:16'}>
      <h2>Generated Image</h2>
      <div class="output-display" class:ratio-4-5={generatedImageAspectRatio === '4:5'} class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-9-16={generatedImageAspectRatio === '9:16'}>
        {#if generatedImageUrl}
          <img src={generatedImageUrl} alt="AI generated image" />
          {#if generatedByModel}
            <div class="model-badge">
              Generated by {generatedByModel === 'gpt-image-1' ? 'GPT-image-1' : generatedByModel}
            </div>
          {/if}
        {:else if isGenerating}
          <div class="ai-scanning-animation">
            <!-- Show translucent version of the sketch being analyzed -->
            <div class="sketch-preview">
              <img src={imageData} alt="Sketch preview" class="sketch-preview-image" />
              <div class="scanning-line"></div>
              <div class="scanning-grid"></div>
              <div class="scan-highlight"></div>
            </div>
            <div class="scanning-status">
              <span>Analyzing structure</span>
              <div class="status-text">Preserving exact positions and proportions</div>
            </div>
          </div>
        {:else}
          <div class="empty-output">
            <p>Your AI-generated image will appear here</p>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="action-area">
    <button
      class="generate-button"
      on:click={generateImage}
      disabled={isGenerating || strokeCount === 0}
    >
      <span class="material-icons">image</span>
      {isGenerating ? 'Generating...' : 'Generate Structure-Perfect Image'}
    </button>

    {#if errorMessage}
      <div class="error-message" transition:fade={{ duration: 200 }}>
        <span class="material-icons">error_outline</span>
        {errorMessage}
      </div>
    {/if}

    <!-- Debug info -->
    <div class="debug-info">
      <p>Button state: {isGenerating ? 'Generating in progress' : (strokeCount === 0 ? 'No strokes drawn' : 'Ready to generate')}</p>
      <p>Stroke count: {strokeCount}</p>

      <!-- Sketch Analysis Section -->
      <div class="sketch-analysis">
        <h4>AI Sketch Interpretation (GPT-4 Vision):</h4>
        <div class="analysis-text">
          {#if isAnalyzing}
            <div class="analysis-status-tag analyzing">
            <div class="mini-spinner"></div>
              <span>Analyzing with GPT-4 Vision...</span>
            </div>
            <p>{previousSketchAnalysis}</p>
          {:else}
            <div class="analysis-status-tag updated">
              <span class="material-icons">check_circle</span>
              <span>Up to date</span>
            </div>
            <p>{sketchAnalysis}</p>
          {/if}
        </div>
        <button
          class="analyze-button"
          on:click={() => {
            forceAnalysisFlag = true;
            analyzeSketch();
          }}
          disabled={isAnalyzing || strokeCount === 0}
        >
          <span class="material-icons">psychology</span>
          {isAnalyzing ? 'Analyzing...' : 'Analyze Sketch Now'}
        </button>
      </div>

      <!-- Stroke Recognition Section -->
      <div class="stroke-recognition">
        <h4>Shape Recognition (TensorFlow, CNN, Stroke Analysis):</h4>
        <div class="analysis-text">
          {#if isRecognizingStrokes}
            <div class="analysis-status-tag analyzing">
              <div class="mini-spinner"></div>
              <span>Analyzing with multiple AI technologies...</span>
            </div>
            <p style="white-space: pre-line">{previousStrokeRecognition}</p>
          {:else if recognitionResult && recognitionResult.detectedShapes && recognitionResult.detectedShapes.length > 0}
            <div class="analysis-status-tag updated">
              <span class="material-icons">check_circle</span>
              <span>Up to date</span>
            </div>
            <p style="white-space: pre-line">{strokeRecognition}</p>

            <!-- Enhanced TensorFlow debugging section -->
            <div class="tf-detected-objects">
              <h5>TensorFlow detected objects:</h5>
              <div class="object-list">
                {#if recognitionResult.detectedShapes.filter(obj => obj.detectionSource === 'tensorflow' || obj.enhancedByCNN === true).length > 0}
                  {#each recognitionResult.detectedShapes.filter(obj => obj.detectionSource === 'tensorflow' || obj.enhancedByCNN === true) as obj, i}
                    <div class="detected-object">
                      <div class="object-header">
                        <span class="object-name">{obj.name}</span>
                        <span class="object-confidence">{Math.round(obj.confidence * 100)}%</span>
                      </div>
                      {#if obj.boundingBox}
                        <div class="object-position">
                          Position: x:{Math.round(obj.boundingBox.centerX * 100)}%,
                          y:{Math.round(obj.boundingBox.centerY * 100)}%
                        </div>
                        <div class="object-size">
                          Size: {Math.round(obj.boundingBox.width * 100)}% ×
                          {Math.round(obj.boundingBox.height * 100)}%
                        </div>
                        <div class="object-bbox-visualization"
                             style="background-color: {obj.color || '#9C27B0'}22;
                                    border: 2px solid {obj.color || '#9C27B0'};
                                    position: relative;
                                    width: 100%;
                                    height: 60px;">
                          <!-- Visual representation of the object's position -->
                          <div class="object-indicator"
                               style="position: absolute;
                                      left: {obj.boundingBox.centerX * 100}%;
                                      top: {obj.boundingBox.centerY * 100}%;
                                      width: 10px;
                                      height: 10px;
                                      border-radius: 50%;
                                      background-color: {obj.color || '#9C27B0'};
                                      transform: translate(-50%, -50%);">
                          </div>
                          <!-- Visual representation of the bounding box -->
                          <div class="object-bbox"
                               style="position: absolute;
                                      left: {obj.boundingBox.minX * 100}%;
                                      top: {obj.boundingBox.minY * 100}%;
                                      width: {obj.boundingBox.width * 100}%;
                                      height: {obj.boundingBox.height * 100}%;
                                      border: 1px dashed {obj.color || '#9C27B0'};">
                          </div>
                          <div class="object-label"
                               style="position: absolute;
                                      left: {Math.min(Math.max(obj.boundingBox.minX * 100, 5), 95)}%;
                                      top: {Math.min(Math.max(obj.boundingBox.minY * 100 - 15, 5), 80)}%;
                                      font-size: 10px;
                                      color: {obj.color || '#9C27B0'};
                                      white-space: nowrap;">
                            {obj.name}
                          </div>
                        </div>
                      {/if}
                      <div class="object-source">
                        Source: {obj.enhancedByCNN ? 'CNN' : obj.detectionSource || obj.source || 'Unknown'}
                      </div>
                    </div>
                  {/each}
                {:else}
                  <p>No TensorFlow objects detected. Try adding more details to your drawing.</p>
                {/if}
              </div>
            </div>

            <!-- Original shape recognition results -->
            <div class="shape-recognition-results">
              <h5>Shape recognition results:</h5>
              {#if recognitionResult.debug?.shapeRecognition?.shapes}
                <div class="shapes-list">
                  {#each recognitionResult.debug.shapeRecognition.shapes.slice(0, 3) as shape}
                    <div class="shape-item">
                      <span class="shape-name">{shape.type}</span>
                      <span class="shape-confidence">{Math.round(shape.confidence * 100)}%</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <div class="analysis-status-tag updated">
              <span class="material-icons">check_circle</span>
              <span>Up to date</span>
            </div>
            <p style="white-space: pre-line">{strokeRecognition}</p>
          {/if}
        </div>
        <button
          class="analyze-button"
          on:click={() => {
            forceAnalysisFlag = true;
            recognizeStrokes();
          }}
          disabled={isRecognizingStrokes || strokeCount === 0}
        >
          <span class="material-icons">category</span>
          {isRecognizingStrokes ? 'Recognizing...' : 'Recognize Shapes Now'}
        </button>
      </div>

      <div class="debug-buttons">
        <!-- Test button to manually add a stroke -->
        <button
          on:click={() => {
            const testStroke = {
              tool: 'pen' as const,
              points: [
                { x: 100, y: 100, pressure: 0.5 },
                { x: 200, y: 200, pressure: 0.5 }
              ],
              color: '#000000',
              size: 3,
              opacity: 1
            };
            drawingContent.strokes.push(testStroke);
            // Trigger Svelte reactivity
            drawingContent = drawingContent;
            renderStrokes();
            console.log('Test stroke added, new count:', drawingContent.strokes.length);
          }}
          class="test-button"
        >
          Add Test Stroke
        </button>

        <!-- Refresh button to force reactivity updates -->
        <button
          class="test-button"
          on:click={() => {
            // Force refresh drawingContent to update UI
            drawingContent = {...drawingContent, strokes: [...drawingContent.strokes]};
            console.log('Forced refresh. Current stroke count:', drawingContent.strokes.length);
          }}
        >
          Refresh Count
        </button>

        <button class="test-button" on:click={() => showDebugPressure = !showDebugPressure}>
          {showDebugPressure ? 'Hide Pressure Debug' : 'Show Pressure Debug'}
        </button>
      </div>
    </div>

    <!-- Shape Recognition Dialog and Button -->
    <ShapeRecognitionButton
      position={buttonPosition}
      active={showShapeRecognitionDialog}
      objectCount={analysisElements.length}
      isAnalyzing={isAnalyzing || isRecognizingStrokes}
      hasTextAnalysis={sketchAnalysis && sketchAnalysis.length > 0}
      hasStrokesAnalysis={strokeRecognition && strokeRecognition.length > 0}
      hasSketchAnalysis={analysisElements.length > 0}
      on:toggle={toggleShapeRecognitionDialog}
    ></ShapeRecognitionButton>

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
      canvasSnapshot={currentCanvasSnapshot || captureCanvasSnapshot()}
      sketchAnalysisOutput={sketchAnalysisOutput}
      strokesAnalysisOutput={strokesAnalysisOutput}
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

<style lang="scss">
  .draw-demo-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    height: 100vh;
    width: 100%;
    padding: 1rem;
  }

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

    .context-input-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-top: 0.5rem;

      width: 800px;

      label {
        font-size: 0.9rem;
        color: #666;
        margin-bottom: 0.25rem;
      }

      .context-input {
        width: 90%;
        max-width: 600px;
        padding: 12px 16px;
        border: 1px solid #ddd;
        border-radius: 32px;
        font-size: 16px;
        font-weight: 500;
        letter-spacing: -.5px;
          text-align: center;
        box-shadow: 0 8px 12px rgba(black, 0.1);

        &:focus {
          outline: none;
          //border-color: #9c27b0;
          //box-shadow: 0 0 0 2px rgba(156, 39, 176, 0.2);
        }
      }
    }
  }

  .canvas-container {
    display: flex;
    justify-content: center;
    flex: 1;
    gap: 1rem;
    margin-bottom: 1rem;
    min-width: 400px;
    width: 95vw;
    max-height: 85vh;
    position: relative;

    @media (max-width: 768px) {
      flex-direction: column;
      max-height: none;
    }
  }

  /* Toolbar styles */
  .vertical-toolbar {
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    padding: 0;
    width: 60px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    z-index: 5;
  }

  .tool-group {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .tool-icon-label {
    color: #555;
    font-size: 20px;
  }

  /* Color picker styles */
  input[type="color"] {
    -webkit-appearance: none;
    border: none;
    width: 40px;
    height: 40px;
    border-radius: 20px;
    cursor: pointer;
    overflow: hidden;
  }

  input[type="color"]::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  input[type="color"]::-webkit-color-swatch {
    border: none;
    border-radius: 20px;
  }

  /* Aspect ratio selector styles */
  .aspect-ratio-selector select {
    width: 100%;
    padding: 0.5rem;
    border-radius: 4px;
    background: #f0f0f0;
    border: 1px solid #ddd;
    font-size: 14px;
    cursor: pointer;
  }

  .aspect-ratio-selector select:hover {
    background: #e8e8e8;
  }

  .aspect-ratio-selector select:focus {
    outline: none;
    border-color: #6355FF;
    box-shadow: 0 0 0 2px rgba(99, 85, 255, 0.2);
  }

  .tool-label {
    font-size: 12px;
    color: #666;
    text-align: center;
    margin-top: 4px;
  }

  .canvas-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    padding: 1rem;
    margin: 0 1rem;
    transition: all 0.3s ease;
    overflow: hidden;

    &.input-canvas {
      min-width: 300px;
      max-width: 800px;

      // Adjust dimensions based on aspect ratio
      &.ratio-4-5 {
        min-height: calc(300px * (5/4));
        max-height: calc(800px * (5/4));
        aspect-ratio: 4 / 5;
      }

      &.ratio-1-1 {
        min-height: 300px;
        max-height: 800px;
        aspect-ratio: 1 / 1;
      }

      &.ratio-9-16 {
        min-height: calc(300px * (16/9));
        max-height: calc(800px * (16/9));
        aspect-ratio: 9 / 16;
      }

      .drawing-canvas {
        background: white;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        margin: 0 auto;
        display: block;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        cursor: crosshair;
        touch-action: none; /* Prevent browser handling of drags/pinch gestures */
      }
    }

    &.output-canvas {
      min-width: 300px;
      max-width: 800px;
      background: #fafafa;

      // Adjust dimensions based on aspect ratio
      &.ratio-4-5 {
        min-height: calc(300px * (5/4));
        max-height: calc(800px * (5/4));
        aspect-ratio: 4 / 5;
      }

      &.ratio-1-1 {
        min-height: 300px;
        max-height: 800px;
        aspect-ratio: 1 / 1;
      }

      &.ratio-9-16 {
        min-height: calc(300px * (16/9));
        max-height: calc(800px * (16/9));
        aspect-ratio: 9 / 16;
      }
    }

    h2 {
      margin: 0 0 1rem 0;
      font-size: 1.25rem;
      color: #555;
    }
  }

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

  .analysis-element::before {
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
  .analysis-element::after {
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

  @keyframes rotate {
    0% { transform: translate(-50%, -50%) rotate(0deg); }
    100% { transform: translate(-50%, -50%) rotate(360deg); }
  }

  .parent-element {
    z-index: 20;
  }

  .child-element {
    height: 24px;
    min-width: 50px;
    z-index: 15;
    font-size: 11px;
  }

  .child-element::before {
    width: 30px;
    height: 30px;
  }

  .element-badge {
    position: absolute;
    top: -8px;
    right: -8px;
    background-color: #fff;
    color: #333;
    font-size: 10px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    border: 1px solid var(--element-color);
    transition: transform 0.2s;

    &:hover {
      transform: scale(1.1);
    }
  }

  .element-label {
    color: white;
    font-size: 11px;
    font-weight: 600;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
    text-transform: capitalize;
  }

  @keyframes pulse {
    0% {
      opacity: 0.8;
      transform: translate(-50%, -50%) scale(1);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
    }
    50% {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1.05);
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.25);
    }
    100% {
      opacity: 0.8;
      transform: translate(-50%, -50%) scale(1);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
    }
  }

  .output-display {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    background: #f8f8f8;

    // Dynamically adjust aspect ratio based on the generated image
    &.ratio-4-5 {
      aspect-ratio: 4 / 5; /* Portrait 4:5 */
    }

    &.ratio-1-1 {
      aspect-ratio: 1 / 1; /* Square 1:1 */
    }

    &.ratio-9-16 {
      aspect-ratio: 9 / 16; /* Portrait 9:16 */
    }

    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      transition: transform 0.3s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      border-radius: 4px;

      &:hover {
        transform: scale(1.02);
      }
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

    .generate-button, .analyze-button {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: linear-gradient(45deg, #7b1fa2, #9c27b0);
      color: white;
      border: none;
      border-radius: 30px;
      padding: 10px 24px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 10px rgba(156, 39, 176, 0.3);
      min-width: 230px;
      position: relative;
      overflow: hidden;

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
        box-shadow: 0 6px 15px rgba(156, 39, 176, 0.4);

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

        &:hover {
          transform: none;
        }
      }

      .material-icons {
        font-size: 18px;
      }
    }

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

    .debug-info {
      color: #666;
      padding: 1rem;
      background: #f5f5f5;
      border-radius: 8px;
      width: 100%;
      max-width: 800px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
      border: 1px solid #e0e0e0;

      p {
        margin: 0.25rem 0;
      }

      .sketch-analysis, .stroke-recognition {
        margin-top: 1rem;
        padding: 1rem;
        background: #fff;
        border-radius: 8px;
        border: 1px solid #ddd;
        text-align: left;
        box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.05);

        h4 {
          margin: 0 0 0.75rem 0;
          font-size: 1.1rem;
          color: #333;
          display: flex;
          align-items: center;
          gap: 8px;

          &::before {
            content: '';
            display: block;
            width: 4px;
            height: 16px;
            background-color: #2196f3;
            border-radius: 2px;
          }
        }

        .analysis-text {
          background: #f8f8f8;
          padding: 0.75rem;
          border-radius: 6px;
          margin: 0.5rem 0;
          border: 1px solid #e0e0e0;
          max-height: 150px;
          overflow-y: auto;
          position: relative;

          p {
            margin: 0;
            opacity: 0.9;
            line-height: 1.5;
          }
        }
      }

      .stroke-recognition h4::before {
        background-color: #ff9800;
      }

      /* Add new styles for TensorFlow object visualization */
      .tf-detected-objects {
        margin-top: 10px;
        border-top: 1px solid #eee;
        padding-top: 10px;

        h5 {
          font-size: 0.9rem;
          margin: 5px 0;
          color: #555;
        }

        .object-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-top: 5px;
          max-height: 300px;
          overflow-y: auto;
        }

        .detected-object {
          background: white;
          border: 1px solid #e0e0e0;
          border-radius: 4px;
          padding: 8px;
          font-size: 0.85rem;
        }

        .object-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 4px;
          font-weight: bold;
        }

        .object-confidence {
          background: #f0f0f0;
          padding: 2px 6px;
          border-radius: 10px;
          font-size: 0.75rem;
        }

        .object-position, .object-size, .object-source {
          font-size: 0.75rem;
          color: #666;
          margin: 2px 0;
        }

        .object-source {
          margin-top: 5px;
          font-style: italic;
        }
      }

      .shape-recognition-results {
        margin-top: 10px;
        border-top: 1px solid #eee;
        padding-top: 10px;

        h5 {
          font-size: 0.9rem;
          margin: 5px 0;
          color: #555;
        }

        .shapes-list {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
          margin-top: 5px;
        }

        .shape-item {
          background: #f0f0f0;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 0.75rem;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .shape-confidence {
          background: white;
          padding: 1px 4px;
          border-radius: 10px;
          font-size: 0.7rem;
        }
      }

      .debug-buttons {
        display: flex;
        gap: 8px;
        margin-top: 1rem;

      .test-button {
          background: #f5f5f5;
          border: 1px solid #ddd;
          padding: 6px 12px;
        border-radius: 4px;
          font-size: 12px;
        cursor: pointer;
          transition: all 0.2s;

        &:hover {
            background: #e0e0e0;
          }
        }
      }
    }

    .tips {
      max-width: 600px;
      text-align: left;

      h3 {
        margin-bottom: 0.5rem;
      }

      ul {
        padding-left: 1.5rem;
        margin: 0;

        li {
          margin-bottom: 0.25rem;
        }
      }
    }
  }

  .analysis-status-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 500;
    margin-bottom: 6px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

    &.analyzing {
      background-color: #FFF3E0;
      border: 1px solid #FFB74D;
      color: #E65100;
    }

    &.updated {
      background-color: #E8F5E9;
      border: 1px solid #81C784;
      color: #2E7D32;
    }

    .material-icons {
      font-size: 0.9rem;
    }

    .mini-spinner {
      width: 10px;
      height: 10px;
      margin-right: 0;
      border-width: 1px;
    }
  }

  .bounding-box {
    position: absolute;
    border: 2px dashed var(--box-color);
    border-radius: 6px;
    pointer-events: none;
    opacity: 0.5;
    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
    z-index: 1;
    box-shadow: 0 0 0 rgba(0, 0, 0, 0);

    &:hover {
      opacity: 0.85;
      border-width: 3px;
      box-shadow: 0 0 12px rgba(0, 0, 0, 0.15);
    }

    /* Different styles for parent vs child boxes */
    &.parent-box {
      border-style: dashed;
      border-width: 3px;
    }

    &.child-box {
      border-style: dotted;
      border-width: 2px;
    }

    /* Category-specific styles */
    &.human, &.animal {
      border-style: solid;
    }

    &.building, &.landscape {
      border-style: dashed;
      border-width: 3px;
    }

    &.text {
      border-style: dotted;
      border-width: 2px;
    }

    .box-label {
      position: absolute;
      top: -28px;
      left: 0;
      background-color: var(--box-color);
      color: white;
      font-size: 0.8rem;
      padding: 4px 10px;
      border-radius: 6px;
      white-space: nowrap;
      text-transform: capitalize;
      font-weight: 600;
      box-shadow: 0 3px 6px rgba(0, 0, 0, 0.25);
      opacity: 0.95;
      pointer-events: none;
      transform: translateY(0);
      transition: transform 0.2s ease-out, box-shadow 0.2s ease;
      letter-spacing: 0.02em;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      }

      .category-indicator {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: inherit;
        border: 1px solid rgba(255, 255, 255, 0.8);
      }
    }

    /* Highlight box corners */
    &::before, &::after {
      content: '';
      position: absolute;
      width: 8px;
      height: 8px;
      border: 2px solid var(--box-color);
      background: white;
      opacity: 0.75;
      transition: opacity 0.3s, width 0.2s, height 0.2s, background 0.2s;
      pointer-events: none;
    }

    &::before {
      top: -5px;
      left: -5px;
      border-radius: 50%;
    }

    &::after {
      bottom: -5px;
      right: -5px;
      border-radius: 50%;
    }

    &:hover::before, &:hover::after {
      opacity: 1;
      width: 10px;
      height: 10px;
      background: var(--box-color);
      border-color: white;
    }
  }

  .connection-line {
    position: absolute;
    pointer-events: none;
    opacity: 0.5;
    z-index: 0;
    transition: opacity 0.3s, transform 0.3s;

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
    transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);

    &:hover {
      transform: scale(1.15);
      z-index: 5;
    }

    /* Different styles based on category */
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
  }

  .pressure-debug-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 10;
  }

  .pressure-point {
    position: absolute;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.3);
  }

  .debug-buttons {
    display: flex;
    gap: 8px;
    margin-top: 1rem;

    .test-button {
      background: #f5f5f5;
      border: 1px solid #ddd;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        background: #e0e0e0;
      }
    }
  }

  .debug-info {
    /* ... existing styles ... */

    .sketch-analysis, .stroke-recognition {
      /* ... existing styles ... */
    }

    /* Add new styles for TensorFlow object visualization */
    .tf-detected-objects {
      margin-top: 10px;
      border-top: 1px solid #eee;
      padding-top: 10px;

      h5 {
        font-size: 0.9rem;
        margin: 5px 0;
        color: #555;
      }

      .object-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 5px;
        max-height: 300px;
        overflow-y: auto;
      }

      .detected-object {
        background: white;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        padding: 8px;
        font-size: 0.85rem;
      }

      .object-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
        font-weight: bold;
      }

      .object-confidence {
        background: #f0f0f0;
        padding: 2px 6px;
        border-radius: 10px;
        font-size: 0.75rem;
      }

      .object-position, .object-size, .object-source {
        font-size: 0.75rem;
        color: #666;
        margin: 2px 0;
      }

      .object-source {
        margin-top: 5px;
        font-style: italic;
      }
    }

    .shape-recognition-results {
      margin-top: 10px;
      border-top: 1px solid #eee;
      padding-top: 10px;

      h5 {
        font-size: 0.9rem;
        margin: 5px 0;
        color: #555;
      }

      .shapes-list {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 5px;
      }

      .shape-item {
        background: #f0f0f0;
        padding: 3px 8px;
        border-radius: 12px;
        font-size: 0.75rem;
        display: flex;
        align-items: center;
        gap: 5px;
      }

      .shape-confidence {
        background: white;
        padding: 1px 4px;
        border-radius: 10px;
        font-size: 0.7rem;
      }
    }
  }

  .aspect-ratio-selector {
    .aspect-selector {
      width: 100%;
      padding: 0.5rem 0;

      select {
        width: 100%;
        padding: 0.5rem;
        border-radius: 4px;
        background: #f0f0f0;
        border: 1px solid #ddd;
        font-size: 14px;
        cursor: pointer;

        &:hover {
          background: #e8e8e8;
        }

        &:focus {
          outline: none;
          border-color: #6355FF;
          box-shadow: 0 0 0 2px rgba(99, 85, 255, 0.2);
        }
      }
    }
  }

  /* Toggle switch styles */
  .tool-group.toggle-switch {
    margin: 0.5rem 0;
  }

  .tool-group.toggle-switch .tool-icon-label {
    color: #555;
    margin-bottom: 0.25rem;
  }

  .tool-group.toggle-switch .tool-label {
    font-size: 0.8rem;
    color: #444;
    margin-top: 0.25rem;
  }

  .switch {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 20px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .switch input:checked + label {
    background-color: #6355FF;
  }

  .switch input:checked + label:before {
    transform: translateX(18px);
  }

  /* Different colors for different toggles */
  .switch input#analysis-toggle:checked + label {
    background-color: #43A047; /* Green for AI analysis */
  }

  .switch input#stroke-overlay-toggle:checked + label {
    background-color: #3949AB; /* Blue for Stroke Recognition */
  }

  .switch input:focus + label {
    box-shadow: 0 0 1px #6355FF;
  }

  .switch input:disabled + label {
    background-color: #ccc;
    cursor: not-allowed;
    opacity: 0.6;
  }

  .switch input:disabled + label:before {
    background-color: #eee;
  }

  .switch label {
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
  }

  .switch label:before {
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

  .switch label:hover:before {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }

  /* Tool button styles */
  .tool-button {
    padding: 10px 0;
    width: 100%;
    background: none;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 4px;
  }

  .tool-button .material-icons {
    font-size: 22px;
    color: #555;
    transition: color 0.2s;
  }

  .tool-button:hover {
    background: #e0e0e0;
  }

  .tool-button:hover .material-icons {
    color: #6355FF;
  }
</style>