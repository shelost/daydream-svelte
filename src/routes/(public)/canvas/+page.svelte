<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'; // Added tick
  import { fade, scale } from 'svelte/transition';
  import type { Tool, Stroke, StrokePoint } from '$lib/types';
  import { getStroke } from 'perfect-freehand';
  import { getSvgPathFromStroke, calculatePressureFromVelocity, calculateMultiStrokeBoundingBox, findRelatedStrokes, normalizeBoundingBox } from '$lib/utils/drawingUtils.js';
  import VerticalSlider from '$lib/components/VerticalSlider.svelte';
  import { fetchAndLog } from '$lib/utils/fetchAndLog.js'; // <-- ADD THIS IMPORT
  import Omnibar from '$lib/components/Omnibar.svelte'; // <-- IMPORT Omnibar
  import CanvasToolbar from '$lib/components/CanvasToolbar.svelte'; // <-- IMPORT CanvasToolbar
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
  } from '$lib/stores/canvasStore';

  // Import Prism.js for syntax highlighting - make it conditional for production builds
  let Prism: any = null; // Keep at top-level, initialize to null
  let PrismLoaded: boolean = false; // Keep at top-level

  // Dynamically import Prism.js to avoid SSR issues
  onMount(async () => {
    try {
      if (typeof window !== 'undefined') {
        const prismModule = await import('prismjs');
        await import('prismjs/components/prism-markup.js');
        const prismInstance = prismModule.default || prismModule;

        if (prismInstance && typeof prismInstance.highlightElement === 'function') {
          Prism = prismInstance; // Assign to top-level Prism
          PrismLoaded = true;    // Assign to top-level PrismLoaded
          console.log('Prism.js loaded successfully and assigned.');
        } else {
          console.warn('Prism.js loaded but highlightElement method not available or instance invalid.');
          PrismLoaded = false;
        }

        resizeCanvas()
        setTimeout(() => {
          resizeCanvas()
        }, 1000);

        if (!document.querySelector('link[href*="prism-okaidia"]')) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-okaidia.min.css';
          document.head.appendChild(link);
        }

        // After Prism is confirmed loaded (or failed), trigger highlighting if conditions met
        if (outputView === 'code' && generatedSvgCode && svgCodeElement) {
            console.log('onMount: Code view active with SVG code. Triggering processCodeIfNecessary.');
            processCodeIfNecessary(); // New helper function
        }
      }
    } catch (error) {
      console.warn('Failed to load Prism.js in onMount:', error);
      PrismLoaded = false;
      Prism = null;
    }
  });

  // Import Prettier for code formatting
  import prettier from 'prettier/standalone';
  import * as parserHtml from 'prettier/parser-html';
  const htmlParser = parserHtml?.default || parserHtml;

  // Shape type variable for binding to CanvasToolbar
  let shapeType: string = 'rectangle';

  // Session storage key for canvas data
  const CANVAS_STORAGE_KEY = 'canvasDrawingData';

  // Forward declaration for fabric
  let fabric: any;

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
  let fabricCanvasHTML: HTMLCanvasElement; // Renamed for clarity
  let fabricInstance: any = null;
  let inputCtx: CanvasRenderingContext2D | null = null;
  let isDrawing = false;
  let currentStroke: EnhancedStroke | null = null;
  // Use the store values for reference but maintain local variables for reactivity
  let strokeColor: string;
  let strokeSize: number;
  let strokeOpacity: number;
  let canvasBackgroundColor: string = '#f8f8f8'; // Default background color

  let lastUserEditTime = 0;
  let pendingAnalysis = false;

  // Subscribe to store changes
  strokeOptions.subscribe(options => {
    strokeColor = options.color;
    strokeSize = options.size;
    strokeOpacity = options.opacity;

    // If pen tool is active and options change, update currentStroke if any
    if ($selectedTool === 'pen' && currentStroke) {
      currentStroke.color = strokeColor;
      currentStroke.size = strokeSize;
      currentStroke.opacity = strokeOpacity;
      renderStrokes(); // Re-render temporary stroke
    }
    // If eraser tool is active, update EraserBrush width
    if ($selectedTool === 'eraser' && fabricInstance && fabricInstance.isDrawingMode) {
      fabricInstance.freeDrawingBrush.width = eraserSize; // Assuming eraserSize will be derived from strokeSize or a dedicated variable
    }
  });

  let imageData: string | null = null;
  let pointTimes: number[] = []; // Track time for velocity-based pressure
  let errorMessage: string | null = null;
  let fabricErrorMessage: string | null = null; // Add specific fabric error message
  let sketchAnalysis = "Draw something to see AI's interpretation";
  let isAnalyzing = false;
  let strokeRecognition = "Draw something to see shapes recognized";
  let isRecognizingStrokes = false;
  let additionalContext = "";
  let analysisElements: any[] = [];
  let canvasScale = 1; // Scale factor for canvas display relative to internal resolution

  // Define imageModels for Omnibar
  const imageGenerationModels = [
    { value: 'gpt-image-1', label: 'GPT-Image-1' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'flux-canny-pro', label: 'Flux Canny Pro' },
    { value: 'controlnet-scribble', label: 'ControlNet Scribble' },
    { value: 'stable-diffusion', label: 'Stable Diffusion' },
    { value: 'latent-consistency', label: 'Latent Consistency' }
  ];

  // Reactive variable for Omnibar's parentDisabled prop
  $: parentOmnibarDisabled = $isGenerating || ((!fabricInstance || fabricInstance.getObjects().length === 0) && !additionalContext.trim());

  // Drawing content with enhanced strokes - This might become less central with Fabric.js
  let drawingContent: EnhancedDrawingContent = {
    strokes: [], // This will no longer store rendered strokes, Fabric.js does.
    bounds: { width: 800, height: 600 }
  };

  // Canvas dimensions
  let canvasWidth = 800;
  let canvasHeight = 600;


  // Variables for tracking user edits and analysis state
  let isResizeEvent = false;
  let renderDebounceTimeout: ReturnType<typeof setTimeout> | null = null; // Declare the missing variable
  let isArtificialEvent = false; // Flag for programmatically triggered events

  // For Fabric.js canvas
  let fabricLoaded = false;
  let fabricLoadAttempts = 0;
  const MAX_FABRIC_LOAD_ATTEMPTS = 3;

  // Function to dynamically load Fabric.js with retry logic
  function loadFabricScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Skip if already loaded
      if (typeof fabric !== 'undefined') {
        console.log('Fabric.js already loaded');
        fabricLoaded = true;
        fabricErrorMessage = null; // Clear any previous errors
        return resolve();
      }

      // Track attempts to prevent infinite retry loops
      fabricLoadAttempts++;
      if (fabricLoadAttempts > MAX_FABRIC_LOAD_ATTEMPTS) {
        const error = 'Failed to load Fabric.js after multiple attempts';
        fabricErrorMessage = error;
        return reject(new Error(error));
      }

      console.log(`Loading fabric.js (attempt ${fabricLoadAttempts})`);

      const script = document.createElement('script');
      script.src = '/js/fabric.js';
      script.async = true;

      script.onload = () => {
        console.log('Fabric.js loaded successfully');
        fabricLoaded = true;
        fabric = window['fabric']; // Assign to our variable
        fabricErrorMessage = null; // Clear any previous errors
        resolve();
      };

      script.onerror = () => {
        console.error('Failed to load Fabric.js');
        if (fabricLoadAttempts >= MAX_FABRIC_LOAD_ATTEMPTS) {
          fabricErrorMessage = 'Failed to load the drawing engine. Please check your internet connection and refresh the page.';
          reject(new Error('Max retry attempts reached'));
        } else {
          // Retry on failure with a delay
          setTimeout(() => {
            loadFabricScript().then(resolve).catch(reject);
          }, 500);
        }
      };

      document.head.appendChild(script);
    });
  }

  // Initialize Fabric.js canvas
  async function initializeFabricCanvas() {
    if (!fabricCanvasHTML) {
      console.error('Fabric canvas element not yet available');
      return false;
    }

    try {
      if (!fabricLoaded) {
        await loadFabricScript();
      }

      if (typeof fabric !== 'undefined') {
        // Clean up any existing instance to prevent duplicates
        if (fabricInstance) {
          fabricInstance.dispose();
        }

        fabricInstance = new fabric.Canvas(fabricCanvasHTML, {
          backgroundColor: canvasBackgroundColor,
          renderOnAddRemove: true,
          width: fabricCanvasHTML.width,
          height: fabricCanvasHTML.height,
          preserveObjectStacking: true // Good for managing layers
        });

        // Make sure Fabric's internal elements are correctly positioned
        if (fabricInstance.wrapperEl) {
          fabricInstance.wrapperEl.style.position = 'absolute';
          fabricInstance.wrapperEl.style.top = '0';
          fabricInstance.wrapperEl.style.left = '0';
          fabricInstance.wrapperEl.style.width = fabricCanvasHTML.style.width;
          fabricInstance.wrapperEl.style.height = fabricCanvasHTML.style.height;
        }

         // Set default control appearance for all objects
         fabric.Object.prototype.set({
            cornerStyle: 'circle',
            cornerColor: 'white',
            cornerStrokeColor: '#6355FF',
            cornerStrokeWidth: 3,
            cornerSize: 12,
            padding: 0, // Increased padding for better selection handling
            transparentCorners: false,
            borderColor: '#6355FF',
            borderScaleFactor: 1.5,
            borderOpacityWhenMoving: .5,
            touchCornerSize: 20,
          });

          /*
          // Set selection appearance
          canvas.selectionColor = 'rgba(20,0,255,0.05)';
          canvas.selectionBorderColor = '#6355FF';
          canvas.selectionLineWidth = 2;

          canvas.hoverCursor = 'pointer';
          */

        console.log('Fabric.js canvas initialized successfully');
        // Listen to path creation and erasing events to save state automatically
        fabricInstance.on('path:created', () => {
          saveCanvasState();
          recordHistory();
        });
        if (fabricInstance.on) {
          fabricInstance.on('erasing:end', (opt) => {
            // Auto-remove nearly empty paths to avoid leftovers
            const targets = opt?.targets || [];
            let removedSomething = false;
            targets.forEach((obj: any) => {
              if (obj && obj.type === 'path') {
                const bb = obj.getBoundingRect();
                const area = bb.width * bb.height;
                if (area < 25 || (obj.path && obj.path.length < 10)) {
                  fabricInstance.remove(obj);
                  removedSomething = true;
                }
              }
            });
            saveCanvasState();
            if (removedSomething) {
              recordHistory();
            }
          });
        }

        // Replace the existing 'object:modified' handler for more specific logic
        fabricInstance.off('object:modified'); // Remove previous one if any from prior steps
        fabricInstance.on('object:modified', (e) => {
          const target = e.target;
          if (!target) return;

          let propertyChanged = false;
          if (target.type === 'rect') {
            if (target.scaleX !== 1 || target.scaleY !== 1) {
              const newWidth = target.width * target.scaleX;
              const newHeight = target.height * target.scaleY;
              target.set({
                width: newWidth,
                height: newHeight,
                scaleX: 1,
                scaleY: 1
              });
              target.setCoords();
              propertyChanged = true;
            }
          }
          // Add other type-specific modifications here if needed in the future

          // Common post-modification logic
          if (propertyChanged) {
            fabricInstance.requestRenderAll(); // Render immediately if we changed properties
          } else {
            fabricInstance.renderAll(); // Standard render if no specific property change by this handler
          }

          setTimeout(() => {
            saveCanvasState();
            updateImageData(); // Ensure preview is updated
            recordHistory();
            // Update reactive proxies if the active object was the one modified
            if (activeFabricObject && activeFabricObject === target) {
                if (activeFabricObject.type === 'rect' || activeFabricObject.type === 'circle' || activeFabricObject.type === 'triangle') {
                    selectedShapeFillProxy = activeFabricObject.fill || '#cccccc';
                    selectedShapeStrokeProxy = activeFabricObject.stroke || '#000000';
                    selectedShapeStrokeWidthProxy = activeFabricObject.strokeWidth === undefined ? 0 : activeFabricObject.strokeWidth;
                }
            }
          }, 0);
        });

        // Listen for selection events to update activeFabricObject
        fabricInstance.on('selection:created', (e) => {
          if (e.selected && e.selected.length > 0) activeFabricObject = e.selected[0];
          else activeFabricObject = null;
        });
        fabricInstance.on('selection:updated', (e) => {
          if (e.selected && e.selected.length > 0) activeFabricObject = e.selected[0];
          else activeFabricObject = null;
        });
        fabricInstance.on('selection:cleared', () => {
          activeFabricObject = null;
        });

        // NEW: Also listen for additions & removals for history purposes
        fabricInstance.on('object:added', () => {
          // Object addition already triggers a render in Fabric
          setTimeout(() => {
            recordHistory();
          }, 0);
        });

        fabricInstance.on('object:removed', () => {
          // Ensure immediate render
          fabricInstance.renderAll();

          setTimeout(() => {
            recordHistory();
          }, 0);
        });

        // Handle live scaling to adjust width/height instead of scale
        fabricInstance.on('object:scaling', (e) => {
          const target = e.target;
          if (!target) return;

          // We only want this for basic shapes drawn via shape tool (rect, ellipse (radius), triangle)
          if (target.type === 'rect') {
            target.noScaleCache = false;
            const newWidth = target.width * target.scaleX;
            const newHeight = target.height * target.scaleY;
            target.set({
              width: newWidth,
              height: newHeight,
              scaleX: 1,
              scaleY: 1
            });
            target.setCoords();
            fabricInstance.requestRenderAll();
          } else if (target.type === 'triangle') {
            target.noScaleCache = false;
            const newWidth = target.width * target.scaleX;
            const newHeight = target.height * target.scaleY;
            target.set({ width: newWidth, height: newHeight, scaleX: 1, scaleY: 1 });
            target.setCoords();
            fabricInstance.requestRenderAll();
          } else if (target.type === 'ellipse') { // Changed from 'circle' to 'ellipse'
            target.noScaleCache = false;
            // For ellipse, adjust rx and ry based on scaleX and scaleY respectively
            const newRx = target.rx * target.scaleX;
            const newRy = target.ry * target.scaleY;
            target.set({ rx: newRx, ry: newRy, scaleX: 1, scaleY: 1 });
            target.setCoords();
            fabricInstance.requestRenderAll();
          }
        });

        // Add Alt/Option + Drag to Duplicate functionality
        fabricInstance.on('mouse:down', function(opt) {
          if (opt.e.altKey && opt.target && opt.target.selectable) {
            // Store original values
            const originalObj = opt.target;
            const originalLeft = originalObj.left;
            const originalTop = originalObj.top;

            // Get current pointer position
            const pointer = fabricInstance.getPointer(opt.e);

            // Prevent default to avoid original object movement
            opt.e.preventDefault();
            opt.e.stopPropagation();

            // Clear any existing selection
            fabricInstance.discardActiveObject();

            // Clone original object
            originalObj.clone(function(cloned) {
              // Position at exact same coordinates
              cloned.set({
                left: originalLeft,
                top: originalTop,
                evented: true
              });

              // Add to canvas
              fabricInstance.add(cloned);

              // Set as active object (important for controls)
              fabricInstance.setActiveObject(cloned);
              cloned.setCoords();

              // Calculate offset from object center to cursor position
              const offsetX = pointer.x - originalLeft;
              const offsetY = pointer.y - originalTop;

              // Create a transform object to simulate dragging state
              fabricInstance._currentTransform = {
                target: cloned,
                action: 'drag',
                corner: 0,
                scaleX: cloned.scaleX,
                scaleY: cloned.scaleY,
                skewX: cloned.skewX,
                skewY: cloned.skewY,
                offsetX: offsetX,
                offsetY: offsetY,
                originX: cloned.originX,
                originY: cloned.originY,
                ex: pointer.x,
                ey: pointer.y,
                left: cloned.left,
                top: cloned.top,
                theta: cloned.angle * Math.PI / 180,
                width: cloned.width * cloned.scaleX,
                height: cloned.height * cloned.scaleY,
                mouseXSign: 1,
                mouseYSign: 1,
                actionHandler: fabricInstance._getActionFromCorner.bind(fabricInstance, cloned, 0, opt.e) || fabricInstance._actionHandler
              };

              // Set the action handler for dragging
              fabricInstance._currentTransform.actionHandler = function(eventData, transform, x, y) {
                const target = transform.target;
                const newLeft = x - transform.offsetX;
                const newTop = y - transform.offsetY;

                target.set({
                  left: newLeft,
                  top: newTop
                });

                return true;
              };

              // Ensure original stays in place
              originalObj.set({
                left: originalLeft,
                top: originalTop
              });
              originalObj.setCoords();

              // Set canvas state to indicate we're transforming
              fabricInstance._isCurrentlyDrawing = true;

              // Save canvas state after the operation completes
              saveCanvasState();

              // Force canvas to render
              fabricInstance.requestRenderAll();
            });

            // Prevent event propagation
            return false;
          }
        });

        // Enhanced mouse:move handler to handle our custom transform
        fabricInstance.on('mouse:move', function(opt) {
          if (fabricInstance._currentTransform && fabricInstance._currentTransform.action === 'drag') {
            const pointer = fabricInstance.getPointer(opt.e);
            const transform = fabricInstance._currentTransform;

            if (transform.actionHandler) {
              transform.actionHandler(opt.e, transform, pointer.x, pointer.y);
              transform.target.setCoords();
              fabricInstance.requestRenderAll();
            }
          }
        });

        // Enhanced mouse:up handler to complete the transform
        fabricInstance.on('mouse:up', function(opt) {
          if (fabricInstance._currentTransform) {
            const target = fabricInstance._currentTransform.target;

            // Clear the transform state
            fabricInstance._currentTransform = null;
            fabricInstance._isCurrentlyDrawing = false;

            // Ensure the object remains active and visible
            if (target) {
              fabricInstance.setActiveObject(target);
              target.setCoords();
              target.fire('modified');
              fabricInstance.fire('object:modified', { target: target });
              fabricInstance.requestRenderAll();
            }
          }
        });

        // Ensure selection is preserved after mouse:up
        fabricInstance.on('mouse:up', function(opt) {
          // If an object was being transformed, make sure it stays active
          if (fabricInstance._currentTransform && fabricInstance._currentTransform.target) {
            const target = fabricInstance._currentTransform.target;
            fabricInstance.setActiveObject(target);
            target.setCoords();
            fabricInstance.requestRenderAll();
          }
        });

        return true;
      } else {
        console.error('Fabric.js still not available after loading attempt');
        return false;
      }
    } catch (err) {
      console.error('Error initializing Fabric canvas:', err);
      return false;
    }
  }

  // Function to build the prompt for GPT-Image-1 (Ignoring AI, but keeping for structure)
  function buildGptImagePrompt() {
    let prompt = `Complete this drawing. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;
    const contentGuide = sketchAnalysis !== "Draw something to see AI's interpretation" ? sketchAnalysis : "A user's drawing.";
    prompt += `CONTENT DESCRIPTION: ${contentGuide}\n\n`;
    if (additionalContext) {
      prompt += `USER'S CONTEXT: "${additionalContext}"\n\n`;
    }
    if (analysisElements.length > 0) {
      const structuralGuide = `Based on analysis, the drawing contains ${analysisElements.length} main elements. Element positions and basic relationships are implied by the sketch.`;
      prompt += `STRUCTURAL GUIDE: ${structuralGuide}\n\n`;
    }
    const compositionGuide = `Focus on the arrangement within the ${selectedAspectRatio} frame.`;
    prompt += `COMPOSITION GUIDE: ${compositionGuide}\n\n`;
    if (strokeRecognition && strokeRecognition !== "Draw something to see shapes recognized") {
      prompt += `RECOGNIZED SHAPES: ${strokeRecognition}\n\n`;
    }
    prompt += `FINAL INSTRUCTIONS: Create a DIRECT, FRONT-FACING VIEW that maintains the EXACT same composition as the sketch. NEVER distort or reposition any element. Color and texture can be added, but the structural skeleton must remain identical to the original sketch.`;
    return prompt.length > 4000 ? prompt.substring(0, 3997) + '...' : prompt;
  }

  $: {
    const newPrompt = buildGptImagePrompt();
    gptImagePrompt.set(newPrompt);
  }

  function isRealUserEdit(): boolean {
    if (isResizeEvent) return false;
    if ($isGenerating || isArtificialEvent) return false;
    if (isAnalyzing || isRecognizingStrokes) return false;
    lastUserEditTime = Date.now();
    pendingAnalysis = true;
    return true;
  }

  $: strokeCount = fabricInstance?.getObjects()?.length || 0; // Updated to use Fabric.js objects

  let pathBuilderLookup = {};
  let browser = typeof window !== 'undefined';
  let lastResizeTime = 0;

  // Separate initialization function
  async function initializeComponent() {
    if (inputCanvas) {
      inputCtx = inputCanvas.getContext('2d');
    }

    // First, load Fabric.js
    try {
      await loadFabricScript();
      // Then initialize the canvas
      const success = await initializeFabricCanvas();
      if (!success) {
        console.error('Failed to initialize Fabric canvas after script loaded');
        fabricErrorMessage = 'Could not initialize drawing tools. Please try refreshing the page.';
      } else {
        // Successfully initialized
        fabricErrorMessage = null;
        // Set up initial canvas alignment and styles
        setupCanvasAlignment();
      }
    } catch (err) {
      console.error('Error loading Fabric.js:', err);
      fabricErrorMessage = 'Error loading drawing tools. Please check your connection and try refreshing.';
    }

    resizeCanvas(); // Initial resize and setup

      if (inputCtx) {
      renderStrokes(); // Initial render (likely empty perfect-freehand canvas)
      updateImageData(); // Use a centralized function to update imageData
    }

    console.log('Component mounted');
    mobileCheck();

    // Push initial baseline snapshot after component ready & state loaded
    if (fabricInstance) {
      try {
        undoStack.length = 0;
        redoStack.length = 0;
        const baseline = JSON.stringify(fabricInstance.toJSON());
        undoStack.push(baseline);
      } catch (err) {
        console.error('Unable to set initial history baseline', err);
      }
    }
  }

  // Function to ensure all canvases are properly aligned and styled
  function setupCanvasAlignment() {
    if (!fabricInstance || !inputCanvas) return;

    // Get all canvas elements from fabric and ensure they're properly positioned
    const lowerCanvasEl = fabricInstance.lowerCanvasEl;
    const upperCanvasEl = fabricInstance.upperCanvasEl;
    const wrapperEl = fabricInstance.wrapperEl;

    if (lowerCanvasEl && upperCanvasEl && wrapperEl) {
      // Make sure wrapper has correct dimensions and positioning
      Object.assign(wrapperEl.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        overflow: 'visible'
      });

      // Set z-index for each canvas based on current tool
      updateCanvasZIndex($selectedTool);

      console.log('Canvas alignment complete');
    }
  }

  // Function to update z-index based on selected tool
  function updateCanvasZIndex(tool) {
    if (!fabricInstance || !inputCanvas) return;

    const upperCanvasEl = fabricInstance.upperCanvasEl;

    if (upperCanvasEl) {
      if (tool === 'pen' || tool === 'text' || tool === 'shape' || tool === 'image') {
        // Overlay canvas on top for drawing or insertion
        inputCanvas.style.zIndex = '1';
        upperCanvasEl.style.zIndex = '0';
        inputCanvas.style.pointerEvents = 'auto';
        upperCanvasEl.style.pointerEvents = 'none';
      } else {
        // Fabric interaction layer on top for eraser/select
        inputCanvas.style.zIndex = '0';
        upperCanvasEl.style.zIndex = '1';
        inputCanvas.style.pointerEvents = 'none';
        upperCanvasEl.style.pointerEvents = 'auto';
      }
    }
  }

  // Update z-index whenever the tool changes
  $: if (browser && fabricInstance) {
    updateCanvasZIndex($selectedTool);
  }

  // Centralize image data updates to handle fabric availability
  function updateImageData() {
    try {
      if (fabricInstance) {
        imageData = fabricInstance.toDataURL({ format: 'png' });
      } else if (inputCanvas) { // Fallback if fabricInstance not ready
        imageData = inputCanvas.toDataURL('image/png');
      }
    } catch (error) {
      console.error('Error updating image data:', error);
      // Fallback if toDataURL fails
      if (inputCanvas) {
        try {
          imageData = inputCanvas.toDataURL('image/png');
        } catch (e) {
          console.error('Could not get image data from any canvas');
        }
      }
    }
  }

  // Function to save canvas state to sessionStorage
  function saveCanvasState() {
    if (!browser || !fabricInstance) return;

    try {
      // Get JSON representation of canvas
      const canvasData = fabricInstance.toJSON();
      // Save to sessionStorage
      sessionStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(canvasData));
      console.log('Canvas state saved to sessionStorage');
    } catch (error) {
      console.error('Error saving canvas state:', error);
    }
  }

  // Function to load canvas state from sessionStorage
  function loadCanvasState() {
    if (!browser) {
      console.log("Not in browser, skipping loadCanvasState");
      return false;
    }
    if (!fabricInstance) {
      console.error('Fabric instance not available when trying to load canvas state.');
      return false;
    }

    console.log('Attempting to load canvas state from sessionStorage...');
    try {
      const savedData = sessionStorage.getItem(CANVAS_STORAGE_KEY);
      if (savedData) {
        console.log('Found saved data in sessionStorage.');
        // Parse the saved data
        const canvasData = JSON.parse(savedData);
        // Load the canvas with the saved data
        fabricInstance.loadFromJSON(canvasData, () => {
          fabricInstance.renderAll();
          console.log('Canvas state loaded and rendered successfully from sessionStorage.');
          updateImageData(); // Ensure preview is updated immediately
        });
        return true;
      }
      console.log('No saved canvas data found in sessionStorage.');
    } catch (error) {
      console.error('Error loading canvas state:', error);
    }
    return false;
  }

  onMount(() => {
    console.log('Canvas component mounting...');
    // Start initialization process
    initializeComponent().then(() => {
      console.log('initializeComponent finished.');
      // After initialization, try to load saved state
      if (fabricInstance) {
        console.log('Fabric instance is available. Calling loadCanvasState.');
        const loaded = loadCanvasState();
        if (loaded) {
          console.log('Successfully initiated loading of canvas state.');
        } else {
          console.log('Failed to initiate loading or no saved canvas state found.');
        }
      } else {
        console.error("Fabric instance NOT available after component initialization. CANNOT load state.");
      }
    }).catch(err => {
      console.error("Error during initializeComponent promise chain:", err);
    });

    // Add event listeners
    window.addEventListener('resize', mobileCheck);
    window.addEventListener('keydown', handleGlobalKeyDown); // Changed from handleKeyDown to handleGlobalKeyDown

    // Note: beforeNavigate and window.addEventListener('beforeunload', saveCanvasState)
    // are set up in the top-level script block.
    // The 'beforeunload' listener will be cleaned up in the new consolidated onDestroy.

    // Return cleanup function for onMount is not strictly needed here as onDestroy handles it.
  });

  function initializeCanvas() {
    console.log('Initializing canvas');
    resizeCanvas();

      if (inputCtx) {
        inputCtx.lineCap = 'round';
        inputCtx.lineJoin = 'round';
        inputCtx.strokeStyle = strokeColor;
        inputCtx.lineWidth = strokeSize;
      }
    if (fabricInstance) {
      imageData = fabricInstance.toDataURL({ format: 'png' });
    } else if (inputCanvas) {
      imageData = inputCanvas.toDataURL('image/png');
    }
  }

  function getHeightFromAspectRatio(width, aspectRatio) {
    if (aspectRatio === '1:1') return width;
    if (aspectRatio === 'portrait') return width * (1024 / 1792);
    if (aspectRatio === 'landscape') return width * (1792 / 1024);
    return width;
  }

  function resizeCanvas() {
    if (!inputCanvas || !inputCanvas.parentElement || !fabricCanvasHTML) return;

    lastResizeTime = Date.now();
    isResizeEvent = true;

    const container = inputCanvas.parentElement; // Assuming inputCanvas and fabricCanvasHTML share the same parent for sizing
    const containerStyle = window.getComputedStyle(container);
    const paddingHorizontal = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight);
    const paddingVertical = parseFloat(containerStyle.paddingTop) + parseFloat(containerStyle.paddingBottom);

    // Get the actual available space in the container
    const availableWidth = container.clientWidth - paddingHorizontal;
    const availableHeight = container.clientHeight - paddingVertical;

    // Set internal dimensions based on aspect ratio
    let internalWidth, internalHeight;
    if (selectedAspectRatio === '1:1') {
      internalWidth = 1024;
      internalHeight = 1024;
    } else if (selectedAspectRatio === 'portrait') {
      internalWidth = 1024;
      internalHeight = 1792;
    } else {
      internalWidth = 1792;
      internalHeight = 1024;
    } // landscape

    // Calculate the scale factor to fit the canvas within the available space
    // while maintaining aspect ratio
    const widthRatio = availableWidth / internalWidth;
    const heightRatio = availableHeight / internalHeight;
    const scaleFactor = Math.min(widthRatio, heightRatio);

    // Calculate the new displayed dimensions
    const newCanvasWidth = internalWidth * scaleFactor;
    const newCanvasHeight = internalHeight * scaleFactor;

    // Set internal dimensions for both canvases
    inputCanvas.width = internalWidth;
    inputCanvas.height = internalHeight;
    fabricCanvasHTML.width = internalWidth;
    fabricCanvasHTML.height = internalHeight;

    // Position the canvas in the center of the container
    const marginLeft = Math.max(0, (availableWidth - newCanvasWidth) / 2);
    const marginTop = Math.max(0, (availableHeight - newCanvasHeight) / 2);

    // Apply consistent styling to both canvases
    const canvasStyles = {
      width: `${Math.round(newCanvasWidth)}px`,
      height: `${Math.round(newCanvasHeight)}px`,
      position: 'absolute',
      top: `${marginTop}px`,
      left: `${marginLeft}px`
    };

    // Apply styles to perfect-freehand canvas
    Object.assign(inputCanvas.style, canvasStyles);

    // Apply styles to fabric canvas element
    Object.assign(fabricCanvasHTML.style, canvasStyles);

    canvasScale = scaleFactor;
    canvasWidth = internalWidth;
    canvasHeight = internalHeight;

    let canvasContainer = document.getElementsByClassName('canvas-container')[0];
    // Ensure canvasContainer is an HTMLElement before accessing style
    if (fabricInstance && canvasContainer instanceof HTMLElement) {
      // Important: Need to set both element dimensions and fabric dimensions
      fabricInstance.setWidth(internalWidth);
      fabricInstance.setHeight(internalHeight);
      fabricInstance.setDimensions({ width: internalWidth, height: internalHeight });

      // Ensure the CSS dimensions match as well
      fabricInstance.lowerCanvasEl.style.width = canvasStyles.width;
      fabricInstance.lowerCanvasEl.style.height = canvasStyles.height;
      fabricInstance.lowerCanvasEl.style.top = canvasStyles.top;
      fabricInstance.lowerCanvasEl.style.left = canvasStyles.left;

      if (fabricInstance.upperCanvasEl) {
        // Also set dimensions for the upper canvas (interaction layer)
        fabricInstance.upperCanvasEl.style.width = canvasStyles.width;
        fabricInstance.upperCanvasEl.style.height = canvasStyles.height;
        fabricInstance.upperCanvasEl.style.position = 'absolute';
        fabricInstance.upperCanvasEl.style.top = canvasStyles.top;
        fabricInstance.upperCanvasEl.style.left = canvasStyles.left;

        canvasContainer.style.width = canvasStyles.width;
        canvasContainer.style.height = canvasStyles.height;
        canvasContainer.style.position = 'absolute';
        canvasContainer.style.top = canvasStyles.top;
        canvasContainer.style.left = canvasStyles.left;
      }

      fabricInstance.calcOffset();
      fabricInstance.requestRenderAll();
    }

    drawingContent.bounds = { width: internalWidth, height: internalHeight };

    if (renderDebounceTimeout) clearTimeout(renderDebounceTimeout);
    renderDebounceTimeout = setTimeout(() => {
      console.log('Rendering strokes after resize debounce');
      renderStrokes();
      updateImageData(); // Use the centralized function

      // Update the output canvas if it exists
      if (fabricOutputInstance && selectedFormat === 'svg') {
        resizeOutputCanvas();
      }

      setTimeout(() => { isResizeEvent = false; }, 50);
    }, 100);

    console.log(
      `Canvas resized. Display: ${Math.round(newCanvasWidth)}x${Math.round(newCanvasHeight)}, Internal: ${internalWidth}x${internalHeight}, Scale: ${canvasScale.toFixed(2)}, Margins: ${marginLeft.toFixed(0)}px left, ${marginTop.toFixed(0)}px top`
    );
  }

  $: {
    if (browser && inputCanvas && fabricCanvasHTML) {
      if ($selectedTool === 'pen' || $selectedTool === 'text' || $selectedTool === 'shape') {
        // For drawing or object insertion modes, use the overlay canvas for pointer events
        inputCanvas.style.pointerEvents = 'auto';
        inputCanvas.style.zIndex = '1'; // Ensure drawing canvas is on top
        if (fabricInstance) {
          fabricInstance.isDrawingMode = false;
          if (fabricInstance.upperCanvasEl) {
            fabricInstance.upperCanvasEl.style.pointerEvents = 'none';
          }
        }
      } else if ($selectedTool === 'eraser') {
        // Eraser mode handled by Fabric.js
        inputCanvas.style.pointerEvents = 'none';
        if (fabricInstance) {
          fabricInstance.isDrawingMode = true;
          if (fabricInstance.upperCanvasEl) {
            fabricInstance.upperCanvasEl.style.pointerEvents = 'auto';
            fabricInstance.upperCanvasEl.style.zIndex = '2';
          }

          if (!fabricInstance.freeDrawingBrush || !(fabricInstance.freeDrawingBrush instanceof fabric.EraserBrush)) {
             if (fabric.EraserBrush) {
                fabricInstance.freeDrawingBrush = new fabric.EraserBrush(fabricInstance);
             } else {
                console.error("fabric.EraserBrush is not available. Ensure custom build is correct.");
             }
          }
          if (fabricInstance.freeDrawingBrush) {
            fabricInstance.freeDrawingBrush.width = eraserSize;
          }
        }
      } else if ($selectedTool === 'select') {
        // Selection mode
        inputCanvas.style.pointerEvents = 'none';
        if (fabricInstance) {
          fabricInstance.isDrawingMode = false;
          if (fabricInstance.upperCanvasEl) {
            fabricInstance.upperCanvasEl.style.pointerEvents = 'auto';
            fabricInstance.upperCanvasEl.style.zIndex = '2';
          }
        }
      }
    }
  }

  $: {
    // This reactive block for drawingContent.strokes might be less relevant now
    // as Fabric manages its own objects. Kept for potential AI logic (which is ignored here).
    if (drawingContent.strokes && drawingContent.strokes.length > 0) {
      if (isRealUserEdit()) {
        console.log('User edit detected, scheduling analysis (AI part ignored)');
      }
    }
  }

  $: {
    if (browser && selectedAspectRatio) {
      resizeCanvas();
    }
  }

  // --- Unified Event Handlers ---
  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if ($selectedTool === 'pen') {
        startPenStroke(e);
    } else if ($selectedTool === 'text') {
        addTextObject(e);
    } else if ($selectedTool === 'shape') {
        addShapeObject(e);
    } else if ($selectedTool === 'image') {
        activateImageUpload();
    }
  }

  function onPointerMove(e: PointerEvent) {
    if ($selectedTool === 'pen') {
        continuePenStroke(e);
    }
  }

  function onPointerUp(e: PointerEvent) {
    if ($selectedTool === 'pen') {
        endPenStroke(e);
    }
  }

  // --- Tool Specific Functions ---

  // PEN TOOL
  function startPenStroke(e: PointerEvent) {
    isDrawing = true;
    console.log(`Pen Draw Started. Pointer type: ${e.pointerType}, Pressure: ${e.pressure}`);

    const point = getPointerPosition(e);
    const timestamp = Date.now();
    pointTimes = [timestamp];
    const hasHardwarePressure = e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5;

    let currentOptionsValues;
    strokeOptions.subscribe(options => { currentOptionsValues = options; })();

    currentStroke = {
      tool: 'pen',
      points: [point],
      color: currentOptionsValues.color,
      size: currentOptionsValues.size,
      opacity: currentOptionsValues.opacity,
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
    }
    currentStroke.points.push(point);
    renderStrokes();
  }

  function endPenStroke(e: PointerEvent) {
    if (!isDrawing || !currentStroke) return;
    console.log('Pen Draw Ended');

    // Check if Fabric.js is available
    if (!fabricInstance) {
      console.error('Cannot complete stroke - Fabric.js instance not available');
      if (!fabricErrorMessage) {
        fabricErrorMessage = 'Drawing engine not initialized. Please refresh the page.';
      }
      // Still end the stroke cleanly even if we can't add it to Fabric
    currentStroke = null;
    isDrawing = false;
      if (e.pointerId) {
        try {
    inputCanvas.releasePointerCapture(e.pointerId);
        } catch (err) {
          console.error('Error releasing pointer capture:', err);
        }
      }
      renderStrokes(); // Clear the temporary stroke from inputCanvas
      return;
    }

    if (currentStroke.points.length > 1) {
      let currentOptionsValues;
      strokeOptions.subscribe(options => { currentOptionsValues = options; })();

      const freehandStrokeOptions = {
        size: currentStroke.size,
        thinning: currentOptionsValues.thinning,
        smoothing: currentOptionsValues.smoothing,
        streamline: currentOptionsValues.streamline,
        easing: currentOptionsValues.easing,
        simulatePressure: !currentStroke.hasHardwarePressure,
        last: true,
        start: currentOptionsValues.start,
        end: currentOptionsValues.end,
      };

      const enhancedPoints = currentStroke.points.map(p => [p.x, p.y, p.pressure || 0.5]);
      const strokePath = getStroke(enhancedPoints, freehandStrokeOptions);
      const svgPathData = getSvgPathFromStroke(strokePath);

      if (svgPathData) {
        try {
          const fabricPath = new fabric.Path(svgPathData, {
            fill: currentStroke.color,
            strokeWidth: 0,
            opacity: currentStroke.opacity,
            selectable: true,
            evented: true,
          });
          fabricInstance.add(fabricPath);
        } catch (err) {
          console.error('Error creating fabric path:', err);
          if (!fabricErrorMessage) {
            fabricErrorMessage = 'Error adding stroke to canvas. Please refresh the page.';
          }
        }
      }
    }

    currentStroke = null;
    isDrawing = false;
    if (e.pointerId) {
      try {
    inputCanvas.releasePointerCapture(e.pointerId);
      } catch (err) {
        console.error('Error releasing pointer capture:', err);
      }
    }
    renderStrokes(); // Clear the temporary stroke from inputCanvas

    lastUserEditTime = Date.now();
    pendingAnalysis = true;
    updateImageData(); // Use the centralized function
    saveCanvasState(); // Persist state
  }

  // ERASER TOOL
  let eraserSize = 20;
  // Note: $selectedTool reactive block handles setting fabricInstance.isDrawingMode and EraserBrush.
  // start/continue/endEraserStroke are not strictly needed for Fabric's internal drawing,
  // but can be used for logging or triggering other actions if necessary.

  function startEraserStroke(e: PointerEvent) {
    console.log('Eraser Tool Active - Fabric.js handles drawing');
  }

  function continueEraserStroke(e: PointerEvent) {
    // Fabric.js handles this
  }

  function endEraserStroke(e: PointerEvent) {
    console.log('Eraser stroke ended on Fabric.js canvas');
    lastUserEditTime = Date.now();
    pendingAnalysis = true;
    updateImageData(); // Use centralized function
    saveCanvasState();
  }

  // SELECT TOOL
  // Note: $selectedTool reactive block handles setting fabricInstance.isDrawingMode = false.
  // Fabric.js handles selection internally.
  function startSelection(e: PointerEvent) {
    console.log('Select Tool Active - Fabric.js handles selection');
  }

  function continueSelection(e: PointerEvent) {
    // Fabric.js handles this
  }

  function endSelection(e: PointerEvent) {
    console.log('Selection operation ended on Fabric.js canvas');
    updateImageData(); // Use centralized function
    saveCanvasState();
  }

  function getPointerPosition(e: PointerEvent): StrokePoint {
    if (!inputCanvas) return { x: 0, y: 0, pressure: 0.5 };
    const rect = inputCanvas.getBoundingClientRect();
    const scaleX = inputCanvas.width / rect.width; // Use internal resolution for coords
    const scaleY = inputCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      pressure: e.pressure
    };
  }

  function renderStrokes() {
    if (!inputCtx || !inputCanvas) return;
    inputCtx.clearRect(0, 0, inputCanvas.width, inputCanvas.height);

    if (currentStroke && currentStroke.points.length > 1 && $selectedTool === 'pen') { // Only render for pen tool
      let currentOptionsValues;
      strokeOptions.subscribe(options => { currentOptionsValues = options; })();

      const options = {
        size: currentStroke.size,
        thinning: currentOptionsValues.thinning,
        smoothing: currentOptionsValues.smoothing,
        streamline: currentOptionsValues.streamline,
        easing: currentOptionsValues.easing,
        simulatePressure: !(currentStroke as EnhancedStroke).hasHardwarePressure,
        last: false, // Temporary stroke is never "last" in the context of the final path
        start: currentOptionsValues.start,
        end: currentOptionsValues.end,
      };

      const enhancedPoints = currentStroke.points.map(p => [p.x, p.y, p.pressure || 0.5]);
      const freehandStroke = getStroke(enhancedPoints, options);
      const pathData = getSvgPathFromStroke(freehandStroke);

      if (pathData) {
      const path = new Path2D(pathData);
        inputCtx.fillStyle = currentStroke.color;
        inputCtx.globalAlpha = currentStroke.opacity;
        inputCtx.fill(path);
        inputCtx.globalAlpha = 1;
      }
    }
  }

  function clearCanvas() {
    if (fabricInstance) {
      fabricInstance.clear();
      fabricInstance.setBackgroundColor('#f8f8f8', fabricInstance.renderAll.bind(fabricInstance));
      updateImageData(); // Use centralized function

      // Also clear the sessionStorage data
      if (browser) {
        sessionStorage.removeItem(CANVAS_STORAGE_KEY);
        console.log('Canvas storage cleared');
      }
    } else if (inputCtx && inputCanvas) {
      inputCtx.clearRect(0, 0, inputCanvas.width, inputCanvas.height);
      inputCtx.fillStyle = '#f8f8f8'; // Should be transparent
      inputCtx.fillRect(0, 0, inputCanvas.width, inputCanvas.height); // No fill if transparent
      updateImageData(); // Use centralized function

      // Also clear the sessionStorage data
      if (browser) {
        sessionStorage.removeItem(CANVAS_STORAGE_KEY);
        console.log('Canvas storage cleared');
      }
    }

    generatedImageUrl.set(null);
    generatedByModel.set(null);
  }

  // First, create a dedicated function for building SVG-specific prompts
  function buildSvgPrompt() {
    let prompt = `Create an SVG vector image based on this sketch. IMPORTANT: Your response MUST be valid SVG code only, starting with <svg> tag and ending with </svg>. DO NOT include any explanation, markdown formatting, or code blocks - ONLY the raw SVG code.

The SVG should exactly match the structure and layout of the input sketch. Preserve all proportions, positions, and the general design, but add appropriate vector styling, colors, and refinements.

`;

    if (additionalContext) {
      prompt += `Context: ${additionalContext}\n\n`;
    }

    prompt += `Technical requirements:
- Use standard SVG format with xmlns="http://www.w3.org/2000/svg" attribute
- Include appropriate viewBox attribute
- Use vector elements like <path>, <rect>, <circle>, etc.
- Add appropriate fill colors and stroke styles
- Ensure the SVG is properly structured and valid

Again, return ONLY the SVG code with no additional text.`;

    return prompt;
  }

  // Now update the SVG generation portion of the generateImage function
  async function generateImage() {
    // ... inside generateImage(), replace the SVG branch logic
    if (selectedFormat === 'svg') {
      const hasSketch = fabricInstance && fabricInstance.getObjects().length > 0;
      const hasText   = additionalContext.trim().length > 0;

      if (!hasSketch && !hasText) {
        errorMessage = "Please draw something or provide context first!";
        setTimeout(() => { errorMessage = null; }, 3000);
        return;
      }

      // Only capture image data (PNG) when we actually have visible sketch content
      let imageForPayload: string | null = null;
      if (hasSketch) {
        updateImageData();
        imageForPayload = imageData;
      }

      isGenerating.set(true);
      errorMessage = null;

      try {
        const svgPrompt = buildDynamicSvgPrompt(hasSketch, additionalContext);

        const svgRes = await fetchAndLog('/api/ai/generate-svg', { // <-- USE fetchAndLog
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            imageData: imageForPayload, // may be null when no sketch
            prompt: svgPrompt,
            additionalContext,
            model: $selectedModel // forced to gpt-4o elsewhere when SVG selected
          })
        });

        if (!svgRes.ok) {
          const errTxt = await svgRes.text();
          throw new Error(errTxt || 'Failed to generate SVG');
        }

        const data = await svgRes.json();
        if (data.svgCode) {
          const svgCode = extractValidSvg(data.svgCode) || data.svgCode;
          if (!svgCode.startsWith('<svg')) {
            throw new Error('Could not extract valid SVG from response');
          }

          generatedSvgCode = svgCode;
          outputView = 'svg';
          await renderSvgToOutputCanvas(generatedSvgCode);
        } else {
          throw new Error('No SVG returned by server');
        }
      } catch (err) {
        console.error('SVG generation error:', err);
        errorMessage = err instanceof Error ? err.message : 'Unknown SVG generation error';
      } finally {
        isGenerating.set(false);
      }
      return; // Skip raster generation flow
    }

    const objectCount = fabricInstance ? fabricInstance.getObjects().length : 0;
    if (objectCount === 0 && (!drawingContent.strokes || drawingContent.strokes.length === 0) && !additionalContext.trim()) {
      errorMessage = "Please draw something or provide context first!";
      setTimeout(() => { errorMessage = null; }, 3000);
      return;
    }

    // Capture latest snapshot for preview and for API payloads
    updateImageData();

    // Add debugging to verify we're capturing canvas data properly
    console.log('Canvas image data captured:', {
      hasImageData: !!imageData,
      imageDataLength: imageData ? imageData.length : 0,
      fabricObjects: fabricInstance ? fabricInstance.getObjects().length : 0,
      canvasSize: { width: canvasWidth, height: canvasHeight }
    });

    // Verify imageData is valid
    if (!imageData || !imageData.startsWith('data:image/')) {
      console.error('Invalid or missing canvas image data:', imageData ? imageData.substring(0, 50) + '...' : 'null');
      errorMessage = "Failed to capture canvas image data. Please ensure you have drawn something on the canvas.";
      setTimeout(() => { errorMessage = null; }, 3000);
      isGenerating.set(false);
      isEditing.set(false);
      return;
    }

    isGenerating.set(true);
    isEditing.set(true);
    errorMessage = null;

    // Reset previous results
    generatedImageUrl.set(null);
    generatedByModel.set(null);
    editedImageUrl.set(null);
    editedByModel.set(null);

    // Ensure aspect-ratio meta is in sync so the preview box sizes correctly
    generatedImageAspectRatio = selectedAspectRatio;

    // Deep-copy drawingContent to avoid mutating reactive object during async ops
    const drawingContentCopy = JSON.parse(JSON.stringify(drawingContent));

    const currentPrompt = $gptImagePrompt;
    const currentEditPrompt = $gptEditPrompt;

    const structureData = {
      aspectRatio: selectedAspectRatio,
      canvasWidth,
      canvasHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      pixelRatio: window.devicePixelRatio || 1
    };

    const basePayload = {
      drawingContent: drawingContentCopy,
      imageData,
      additionalContext,
      aspectRatio: selectedAspectRatio,
      sketchAnalysis,
      strokeRecognition,
      structureData,
      detectedObjects: analysisElements
    };

    const generatePayload = {
      ...basePayload,
      prompt: currentPrompt,
      originalPrompt: currentPrompt
    };

    const editPayload = {
      ...basePayload,
      prompt: currentEditPrompt,
      originalPrompt: currentPrompt // keep track of original
    };

    try {
      if ($selectedModel === 'gpt-image-1') {
        // Use fetch with streaming response for edit-image
        const editResponse = fetch('/api/ai/edit-image', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(editPayload)
        });

        // Run standard generation in parallel
        const standardResponse = fetch('/api/ai/generate-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(generatePayload)
        });

        // Handle streaming edit response with proper buffering
        editResponse.then(async (response) => {
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
                        isGenerating.set(false);
                        isEditing.set(false);
                        return; // Exit the function
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
        }).catch((error) => {
          console.error('Error in streaming edit:', error);
          errorMessage = error.message || 'Error during streaming generation';
          isGenerating.set(false);
          isEditing.set(false);
        });

        // Handle standard generation response
        standardResponse.then(async (response) => {
          if (!response.ok) {
            console.error('Standard generation failed with status:', response.status);
            return;
          }

          try {
            const data = await response.json();
            const url = data.imageUrl || data.url;
            if (url) {
              generatedImageUrl.set(url);
              generatedByModel.set(data.model || 'gpt-image-1');
              if (data.aspectRatio) generatedImageAspectRatio = data.aspectRatio;
            }
          } catch (error) {
            console.error('Error parsing standard generation response:', error);
          }
        }).catch((error) => {
          console.error('Standard generation failed:', error);
        });

        // Ensure flags are cleared after both operations
        Promise.allSettled([editResponse, standardResponse]).then(() => {
          isGenerating.set(false);
          isEditing.set(false);
        });

      } else {
        // Replicate-based models (non-streaming for now)
        const repRes = await fetchAndLog('/api/ai/edit-replicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...generatePayload, model: $selectedModel })
        });

        if (!repRes.ok) {
          throw new Error(await repRes.text());
        }

        const data = await repRes.json();
        const url = data.imageUrl || data.url;
        if (url) {
          generatedImageUrl.set(url);
          editedImageUrl.set(url);
          generatedByModel.set(data.model || $selectedModel);
          editedByModel.set(data.model || $selectedModel);
          if (data.aspectRatio) generatedImageAspectRatio = data.aspectRatio;
        }

        isGenerating.set(false);
        isEditing.set(false);
      }
    } catch (err) {
      console.error('Error generating image', err);
      if (!(err.message && err.message.includes('apiLogEntry'))) {
          errorMessage = err instanceof Error ? err.message : 'Unknown error during image generation';
      }
      isGenerating.set(false);
      isEditing.set(false);
    }
  }

  function buildGptEditPrompt() { // AI Ignored
    let prompt = `Complete this drawing, in the exact same style and proportions as the original. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;
    let prompt2 = `Complete this drawing, in the exact same style and proportions as the original. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;
    const contentGuide = sketchAnalysis !== "Draw something to see AI's interpretation" ? sketchAnalysis : "A user's drawing.";
    prompt += `\n\nCONTENT DESCRIPTION: ${contentGuide}`;
    if (additionalContext) {
      prompt2 += `\n\nUSER'S CONTEXT: "${additionalContext}"`;
    }
    if (analysisElements.length > 0) {
      const structuralGuide = `Based on analysis, the drawing contains ${analysisElements.length} main elements. Element positions and basic relationships are implied by the sketch.`;
      prompt += `\n\nSTRUCTURAL GUIDE: ${structuralGuide}`;
    }
    const compositionGuide = `Focus on the arrangement within the ${selectedAspectRatio} frame.`;
    prompt += `\n\nCOMPOSITION GUIDE: ${compositionGuide}`;
    if (strokeRecognition && strokeRecognition !== "Draw something to see shapes recognized") {
      prompt += `\n\nRECOGNIZED SHAPES: ${strokeRecognition}`;
    }
    return prompt2.length > 4000 ? prompt2.substring(0, 3997) + '...' : prompt2;
  }

  $: {
    const newEditPrompt = buildGptEditPrompt();
    gptEditPrompt.set(newEditPrompt);
  }

  $: if (additionalContext !== undefined) {
    const newEditPrompt = buildGptEditPrompt();
    gptEditPrompt.set(newEditPrompt);
  }

  $: {
    $strokeOptions;
  }

  function mobileCheck() {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      console.log('Mobile device detected, adjusting UI');
    }
    if (inputCanvas || fabricCanvasHTML) {
      resizeCanvas();
    }
  }

  let selectedAspectRatio = '1:1';
  const aspectRatios = {
    '1:1': 1 / 1,
    'portrait': 1536 / 1024,
    'landscape': 1024 / 1536
  };
  let generatedImageAspectRatio = '1:1';

  $: {
    if (selectedAspectRatio) {
      generatedImageAspectRatio = selectedAspectRatio;
      if (browser) {
        resizeCanvas();
        // After resize, if fabricInstance exists and has objects, ensure they are rendered.
        // If perfect-freehand is in the middle of a stroke, renderStrokes() handles it.
        if (fabricInstance && fabricInstance.getObjects().length > 0) {
          fabricInstance.renderAll();
        } else if (currentStroke && $selectedTool === 'pen') {
          renderStrokes();
        }
      }
    }
  }

  // beforeNavigate to save
  import { beforeNavigate } from '$app/navigation';
  if (browser) {
    beforeNavigate(() => {
      saveCanvasState();
    });
    // Moved 'beforeunload' listener setup here for clarity, will be cleaned in onDestroy
    window.addEventListener('beforeunload', saveCanvasState);
  }

  // CONSOLIDATED onDestroy function
  onDestroy(() => {
    console.log('Canvas component destroying. Saving state and cleaning up.');
    saveCanvasState(); // Ensure state is saved

    if (browser) {
      window.removeEventListener('resize', mobileCheck);
      window.removeEventListener('keydown', handleGlobalKeyDown); // Changed
      window.removeEventListener('beforeunload', saveCanvasState); // Crucial: remove this listener
    }

    if (fabricInstance) {
      fabricInstance.dispose();
      fabricInstance = null; // Help with garbage collection
    }

    if (renderDebounceTimeout) {
      clearTimeout(renderDebounceTimeout);
    }
    // Any other specific cleanup from previous onDestroy blocks would go here.
  });

  // Svelte action for auto-resizing textarea
  function autoResize(node: HTMLTextAreaElement) {
    const MAX_HEIGHT = 160; // Max height in pixels
    const computedStyle = getComputedStyle(node);

    // Calculate base height for one line of text content (excluding padding)
    let singleLineContentHeight;
    const fs = parseFloat(computedStyle.fontSize);
    const lhStyle = computedStyle.lineHeight;

    if (lhStyle === 'normal') {
      singleLineContentHeight = Math.ceil(fs * 1.2); // Common approximation for 'normal'
    } else if (lhStyle.endsWith('px')) {
      singleLineContentHeight = parseFloat(lhStyle);
    } else if (lhStyle.endsWith('em')) {
      singleLineContentHeight = parseFloat(lhStyle) * fs;
    } else if (!isNaN(parseFloat(lhStyle))) { // Unitless number (e.g., "1.5")
      singleLineContentHeight = parseFloat(lhStyle) * fs;
    } else {
      singleLineContentHeight = Math.ceil(fs * 1.2); // Fallback if parsing lhStyle fails
    }

    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;

    // Consider CSS min-height for the content box itself
    const cssMinContentHeight = parseFloat(computedStyle.minHeight) || 0;
    // The effective content height for one line, respecting CSS min-height for the content part.
    const effectiveSingleLineContentHeight = Math.max(singleLineContentHeight, cssMinContentHeight);
    // This is the target minimum height for the textarea (content + padding) when empty or containing a single line.
    const minTargetHeightForOneLine = effectiveSingleLineContentHeight + paddingTop + paddingBottom;

    function resize() {
      if (node.value === '') {
        node.style.height = minTargetHeightForOneLine + 'px';
        node.style.overflowY = 'hidden';
      } else {
        const prevHeightStyle = node.style.height; // Store current explicit style.height
        node.style.height = '1px'; // Temporarily collapse to measure actual content scroll height
        let currentContentScrollHeight = node.scrollHeight; // Includes padding
        node.style.height = prevHeightStyle; // Restore briefly (mostly for safety, will be overridden)

        let targetHeight;
        const epsilon = 2; // Tolerance for floating point comparisons

        // If the measured scroll height for content is at or below one styled line height
        if (currentContentScrollHeight <= minTargetHeightForOneLine + epsilon) {
          targetHeight = minTargetHeightForOneLine;
        } else {
          targetHeight = currentContentScrollHeight;
        }

        if (targetHeight <= MAX_HEIGHT) {
          node.style.height = targetHeight + 'px';
          node.style.overflowY = 'hidden';
        } else {
          node.style.height = MAX_HEIGHT + 'px';
          node.style.overflowY = 'auto';
        }
      }
    }

    node.addEventListener('input', resize);
    setTimeout(resize, 0); // Initial resize on mount

    return {
      destroy() {
        node.removeEventListener('input', resize);
      }
    };
  }

  // Keydown handler for the textarea to submit with Enter
  function handleCanvasInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // Check if the button would be disabled before calling generateImage
      const isDisabled = $isGenerating || (!fabricInstance || fabricInstance.getObjects().length === 0) && !additionalContext.trim();
      if (!isDisabled) {
        generateImage(); // Call the existing submit function
      }
    }
  }

  let textColor: string = '#000000';
  let fontSize: number = 32;
  let fontFamily: string = 'Arial';

  let shapeFillColor: string = '#cccccc';
  let shapeStrokeColor: string = '#000000';
  let shapeStrokeWidth: number = 2;
  // Remove duplicate shapeType declaration
  // let shapeType: string = 'rectangle'; // Default shape

  // For shape selection dropdown
  // const shapeOptionsList = [
  //   { type: 'rectangle', icon: 'check_box_outline_blank' },
  //   { type: 'circle',    icon: 'circle' }, // Using 'circle' material icon
  //   { type: 'triangle',  icon: 'change_history' }
  // ];

  // $: currentShapeIcon = shapeOptionsList.find(s => s.type === shapeType)?.icon || 'check_box_outline_blank';

  // Reactive update for dropdown position
  // $: if (browser && showShapeDropdown && shapeToolButtonElement) {
  //   const rect = shapeToolButtonElement.getBoundingClientRect();
  //   const toolbarRect = shapeToolButtonElement.closest('.tool-selector-toolbar')?.getBoundingClientRect();
  //   if (rect && toolbarRect) {
  //     // Position the dropdown above the button
  //     const buttonCenter = rect.left + (rect.width / 2);
  //     shapeDropdownLeftPosition = `${buttonCenter - 24}px`; // Center the 48px dropdown over the button
  //     shapeDropdownTopPosition = `auto`; // Let bottom property handle vertical position
  //   }
  // }

  // For dynamic toolbar when a shape is selected
  let activeFabricObject: any | null = null;
  let selectedShapeFillProxy: string = '#cccccc';
  let selectedShapeStrokeProxy: string = '#000000';
  let selectedShapeStrokeWidthProxy: number = 0;

  // Image upload variables
  let fileInput: HTMLInputElement;
  let isDraggingOver = false;
  let imageUploadScale = 1.0;

  function addTextObject(e: PointerEvent) {
    if (!fabricInstance) {
      console.error('Fabric instance not ready');
      return;
    }
    const point = getPointerPosition(e);
    const text = new fabric.IText('Text', {
      left: point.x,
      top: point.y,
      fill: textColor,
      fontSize: fontSize,
      fontFamily: fontFamily,
      selectable: true,
      evented: true
    });
    fabricInstance.add(text);
    fabricInstance.setActiveObject(text);
    selectedTool.set('select');
    updateImageData();
    saveCanvasState();
  }

  function addShapeObject(e: PointerEvent) {
    if (!fabricInstance) {
      console.error('Fabric instance not ready');
      return;
    }
    const point = getPointerPosition(e);
    const commonProps = {
      left: point.x,
      top: point.y,
      fill: shapeFillColor,
      stroke: shapeStrokeColor,
      strokeWidth: shapeStrokeWidth,
      selectable: true,
      evented: true
    };
    let obj: any = null;
    switch (shapeType) {
      case 'circle':
        obj = new fabric.Ellipse({ ...commonProps, rx: 50, ry: 50 }); // Use Ellipse for circle
        break;
      case 'triangle':
        obj = new fabric.Triangle({ ...commonProps, width: 100, height: 90 });
        break;
      case 'rectangle':
      default:
        obj = new fabric.Rect({ ...commonProps, width: 120, height: 80 });
        break;
    }
    if (obj) {
      fabricInstance.add(obj);
      fabricInstance.setActiveObject(obj);
    }
    selectedTool.set('select');
    updateImageData();
    saveCanvasState();
  }

  // Handle image upload from file input
  function handleFileInputChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const file = target.files[0];
      uploadImage(file);
      target.value = ''; // Reset file input to allow uploading the same file again
    }
  }

  // Handle drag and drop
  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    isDraggingOver = true;
  }

  function handleDragLeave() {
    isDraggingOver = false;
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDraggingOver = false;

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        uploadImage(file);
      } else {
        errorMessage = "Please drop an image file";
        setTimeout(() => { errorMessage = null; }, 3000);
      }
    }
  }

  // Process image and add to canvas – ensure NO cropping occurs.
  function uploadImage(file: File) {
    if (!fabricInstance) {
      console.error('Fabric instance not ready for uploadImage');
      return;
    }

    const reader = new FileReader();

    if (file.type === 'image/svg+xml') {
      // Handle SVG files
      reader.onload = function (e) {
        const svgString = e.target?.result as string;
        if (!svgString) {
          console.error('Could not read SVG string');
          errorMessage = "Could not read SVG file";
          setTimeout(() => { errorMessage = null; }, 3000);
          return;
        }

        console.log('SVG string loaded, length:', svgString.length);

        let processedSvg = svgString.trim();
        if (processedSvg.startsWith('<?xml')) {
          processedSvg = processedSvg.substring(processedSvg.indexOf('?>') + 2).trim();
          console.log('Removed XML declaration from SVG string.');
        }

        if (!processedSvg.startsWith('<svg')) {
          const svgTagIndex = processedSvg.toLowerCase().indexOf('<svg');
          if (svgTagIndex !== -1) {
            processedSvg = processedSvg.substring(svgTagIndex);
            console.log('Trimmed SVG to start with <svg> tag.');
          } else {
            console.error('SVG content does not seem to contain an <svg> tag.');
            errorMessage = "Invalid SVG content: Missing <svg> tag.";
            setTimeout(() => { errorMessage = null; }, 3000);
            return;
          }
        }

        const svgTagMatch = processedSvg.match(/<svg[^>]*>/i);
        if (svgTagMatch && svgTagMatch[0] && !svgTagMatch[0].includes('xmlns="http://www.w3.org/2000/svg"')) {
          processedSvg = processedSvg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
          console.log('Added SVG namespace to the <svg> tag.');
        }

        try {
          console.log('Attempting to parse SVG with fabric.loadSVGFromString. Processed SVG string snippet:', processedSvg.substring(0, 200));
          fabric.loadSVGFromString(processedSvg, (objects, options) => {
            console.log('fabric.loadSVGFromString callback. Objects:', objects, 'Options:', options);

            let finalObjects = objects;
            if ((!finalObjects || finalObjects.length === 0) && options && options.objects && options.objects.length > 0) {
              console.warn('`objects` array was empty in loadSVGFromString, but `options.objects` has content. Using `options.objects`.');
              finalObjects = options.objects;
            }

            if (finalObjects && Array.isArray(finalObjects) && finalObjects.length > 0) {
              console.log('Proceeding with objects from fabric.loadSVGFromString.');
              processFabricElements(finalObjects, options);
            } else {
              console.warn('`objects` array is empty or invalid after fabric.loadSVGFromString. Attempting fallback with DOMParser, parseSVGDocument & enlivenObjects...');
              try {
                const parser = new DOMParser();
                const svgDoc = parser.parseFromString(processedSvg, "image/svg+xml");

                const parserErrorNode = svgDoc.querySelector('parsererror');
                if (parserErrorNode) {
                  console.error("Error parsing SVG with DOMParser:", parserErrorNode.textContent);
                  errorMessage = "Error parsing SVG: " + (parserErrorNode.textContent || "Unknown DOMParser error");
                  setTimeout(() => { errorMessage = null; }, 5000);
                  return;
                }

                if (!svgDoc.documentElement || svgDoc.documentElement.nodeName === 'parsererror') {
                  console.error('Failed to parse SVG with DOMParser or SVG is empty/invalid (documentElement error).');
                  errorMessage = "Invalid SVG structure after DOMParser.";
                  setTimeout(() => { errorMessage = null; }, 3000);
                  return;
                }
                console.log('DOMParser successful. SVG Document Element:', svgDoc.documentElement);

                // Corrected usage of fabric.parseSVGDocument and fabric.util.enlivenObjects
                fabric.parseSVGDocument(svgDoc.documentElement, (results, optionsFromParseSVG) => {
                  console.log('fabric.parseSVGDocument callback. Results:', results, 'Options from parseSVGDocument:', optionsFromParseSVG);
                  if (results && Array.isArray(results) && results.length > 0) {
                    console.log(`Found ${results.length} elements from parseSVGDocument. Attempting to enliven.`);
                    fabric.util.enlivenObjects(results, (enlivenedFabricObjects: any[]) => {
                      console.log('fabric.util.enlivenObjects callback. Enlivened Objects:', enlivenedFabricObjects);
                      if (enlivenedFabricObjects && Array.isArray(enlivenedFabricObjects) && enlivenedFabricObjects.length > 0) {
                        console.log('SVG enlivened successfully via fallback path.');
                        // Pass the enlivened objects AND the options from this parseSVGDocument step
                        processFabricElements(enlivenedFabricObjects, optionsFromParseSVG);
                      } else {
                        console.error('SVG enlivening via fallback resulted in no objects or an invalid/empty array.');
                        errorMessage = "Could not process SVG elements after parsing (enlivenObjects failed or returned empty).";
                        setTimeout(() => { errorMessage = null; }, 3000);
                      }
                    }, 'fabric'); // Use 'fabric' namespace
                  } else {
                    console.error('fabric.parseSVGDocument resulted in no elements or an invalid results array.');
                    errorMessage = "Could not extract elements using fabric.parseSVGDocument (fallback returned empty/invalid).";
                    setTimeout(() => { errorMessage = null; }, 3000);
                  }
                } /*, reviverFn_if_needed, options_for_parseSVGDocument_if_any */);
              } catch (fallbackError) {
                console.error('Error during SVG fallback parsing process:', fallbackError);
                let message = "Unknown error";
                if (fallbackError instanceof Error) message = fallbackError.message;
                errorMessage = "Failed to parse SVG (fallback): " + message;
                setTimeout(() => { errorMessage = null; }, 3000);
              }
            }
          });
        } catch (loadError) {
          console.error('Error calling fabric.loadSVGFromString (outer try-catch):', loadError);
          let message = "Unknown error";
          if (loadError instanceof Error) message = loadError.message;
          errorMessage = "Error parsing SVG: " + message;
          setTimeout(() => { errorMessage = null; }, 3000);
        }
      };

      // Function to process the elements (either from direct parse or enliven)
      // This function is defined within reader.onload to have access to its scope if needed,
      // but primarily uses fabricInstance, canvasWidth, canvasHeight from the component scope.
      function processFabricElements(fabricObjects: any[], processingOptions: any) {
        console.log('Processing Fabric elements. Count:', fabricObjects.length, 'Processing Options:', processingOptions);
        try {
          if (!fabricObjects || !Array.isArray(fabricObjects) || fabricObjects.length === 0) {
              console.error('processFabricElements called with no valid objects.');
              errorMessage = "No elements to process for SVG.";
              setTimeout(() => { errorMessage = null; }, 3000);
              return;
          }

          let elementToAdd;
          const viewBox = processingOptions?.viewBox; // options from loadSVGFromString or parseSVGDocument callback

          // If there's only one object and no specific viewBox indicating a complex layout, use it directly.
          // Otherwise, group them. Grouping is generally safer for SVGs.
          if (fabricObjects.length === 1 && !viewBox && fabricObjects[0] && typeof fabricObjects[0].set === 'function') {
            elementToAdd = fabricObjects[0];
            console.log('Single SVG element, will add directly.');
          } else {
            elementToAdd = fabric.util.groupSVGElements(fabricObjects, processingOptions || {});
            console.log('Multiple SVG elements or viewBox implies grouping. Group created:', elementToAdd);
          }

          if (!elementToAdd || typeof elementToAdd.set !== 'function') {
            console.error('Failed to create a valid Fabric element/group (elementToAdd is invalid).');
            errorMessage = "Error processing SVG elements into a usable Fabric object.";
            setTimeout(() => { errorMessage = null; }, 3000);
            return;
          }

          // Resetting transform for the new element
          elementToAdd.set({
            left: 0,
            top: 0,
            originX: 'left', // Set origin before calculating scaled dimensions and final position
            originY: 'top',
            scaleX: 1,
            scaleY: 1,
            angle: 0,
            flipX: false,
            flipY: false,
            skewX: 0,
            skewY: 0
          });
          elementToAdd.setCoords(); // Calculate initial coords after reset

          let elementWidth = elementToAdd.width;
          let elementHeight = elementToAdd.height;

          // If width/height are still 0 or undefined, try getBoundingRect (more reliable after setCoords)
          if ((!elementWidth || !elementHeight || elementWidth === 0 || elementHeight === 0) && typeof elementToAdd.getBoundingRect === 'function') {
              const bounds = elementToAdd.getBoundingRect();
              elementWidth = bounds.width;
              elementHeight = bounds.height;
              console.log('Used getBoundingRect for dimensions:', { width: elementWidth, height: elementHeight });
          }

          // If still no valid dimensions, calculate from all raw objects as a last resort
          // This is less likely to be needed if groupSVGElements works well or getBoundingRect is reliable
          if ((!elementWidth || !elementHeight || elementWidth === 0 || elementHeight === 0) && fabricObjects.length > 0){
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              fabricObjects.forEach(obj => {
                if (obj && typeof obj.getBoundingRect === 'function') {
                    obj.setCoords(); // Ensure coords are calculated
                    const ob = obj.getBoundingRect();
                    if(ob.left < minX) minX = ob.left;
                    if(ob.top < minY) minY = ob.top;
                    if(ob.left + ob.width > maxX) maxX = ob.left + ob.width;
                    if(ob.top + ob.height > maxY) maxY = ob.top + ob.height;
                }
              });
              if (isFinite(minX) && isFinite(maxX) && isFinite(minY) && isFinite(maxY)) {
                  elementWidth = maxX - minX;
                  elementHeight = maxY - minY;
                  console.log('Calculated dimensions from bounding box of all raw objects as fallback:', {width: elementWidth, height: elementHeight});
              }
          }


          if (!elementWidth || !elementHeight || elementWidth <= 0 || elementHeight <= 0) {
            console.warn('Element has invalid/zero dimensions after all checks, using default dimensions (200x200) for scaling.', { elementWidth, elementHeight });
            elementWidth = 200; // Default to avoid division by zero
            elementHeight = 200;
          }

          const targetCanvasWidth = fabricInstance.width * 0.9;
          const targetCanvasHeight = fabricInstance.height * 0.9;
          let scale = 1.0;

          scale = Math.min(targetCanvasWidth / elementWidth, targetCanvasHeight / elementHeight);
          // Ensure it's not scaled beyond 100% of its original size unless necessary to meet minDim
          scale = Math.min(scale, 1.0);


          const minAllowableDimension = 100; // px
          const currentMinWidth = elementWidth * scale;
          const currentMinHeight = elementHeight * scale;

          if (currentMinWidth < minAllowableDimension && elementWidth > 0) {
              scale = Math.max(scale, minAllowableDimension / elementWidth);
          }
          if (currentMinHeight < minAllowableDimension && elementHeight > 0) {
              scale = Math.max(scale, minAllowableDimension / elementHeight);
          }

          // Final check to ensure it doesn't exceed canvas boundaries after min_dim scaling
          if (elementWidth * scale > targetCanvasWidth) {
              scale = targetCanvasWidth / elementWidth;
          }
          if (elementHeight * scale > targetCanvasHeight) {
              scale = targetCanvasHeight / elementHeight;
          }


          elementToAdd.set({
            left: fabricInstance.width / 2,
            top: fabricInstance.height / 2,
            originX: 'center',
            originY: 'center',
            scaleX: scale,
            scaleY: scale,
            selectable: true,
            evented: true,
            crossOrigin: 'anonymous' // For SVGs that might contain external refs, though less common
          });

          elementToAdd.setCoords();
          fabricInstance.add(elementToAdd);
          fabricInstance.setActiveObject(elementToAdd);
          selectedTool.set('select');
          fabricInstance.requestRenderAll(); // Use requestRenderAll for better perf

          setTimeout(() => { // Defer non-critical updates
              updateImageData();
              saveCanvasState();
              recordHistory(); // Ensure recordHistory is available in this scope
          }, 0);
          console.log('SVG element processed and added to canvas successfully. Final scale:', scale);

        } catch (processingError) {
          console.error('Error within processFabricElements:', processingError);
          let message = "Unknown error";
          if (processingError instanceof Error) message = processingError.message;
          errorMessage = "Error processing SVG elements: " + message;
          setTimeout(() => { errorMessage = null; }, 3000);
        }
      }

      reader.onerror = function (err) {
        console.error('FileReader error for SVG:', err);
        errorMessage = "Error reading SVG file";
        setTimeout(() => { errorMessage = null; }, 3000);
      };
      reader.readAsText(file);

    } else {
      // Handle raster images (PNG, JPG, etc.)
      reader.onload = function (e) {
        const imgData = e.target?.result as string;
        if (!imgData) {
          console.error('Could not read image data');
          errorMessage = "Could not read image file";
          setTimeout(() => { errorMessage = null; }, 3000);
          return;
        }

        fabric.Image.fromURL(imgData, (img) => {
          if (!img || typeof img.set !== 'function') {
            console.error('Failed to create Fabric image or image object is invalid');
            errorMessage = "Failed to process image";
            setTimeout(() => { errorMessage = null; }, 3000);
            return;
          }

          const originalWidth = img.width;
          const originalHeight = img.height;

          if (!originalWidth || !originalHeight || originalWidth === 0 || originalHeight === 0) {
              console.warn('Uploaded raster image has zero dimensions, using defaults (200x200).', { originalWidth, originalHeight });
              img.set({ width: 200, height: 200 }); // Set some defaults
          }


          const targetCanvasWidth = fabricInstance.width * 0.9;
          const targetCanvasHeight = fabricInstance.height * 0.9;
          let scale = 1.0;

          if (img.width > 0 && img.height > 0) {
              scale = Math.min(targetCanvasWidth / img.width, targetCanvasHeight / img.height);
               // Ensure it's not scaled beyond 100% of its original size unless necessary to meet minDim
              scale = Math.min(scale, 1.0);
          } else { // Should not happen if defaults set above
              scale = 0.5;
          }

          const minAllowableDimension = 100;
          const currentMinWidth = img.width * scale;
          const currentMinHeight = img.height * scale;

          if (currentMinWidth < minAllowableDimension && img.width > 0) {
              scale = Math.max(scale, minAllowableDimension / img.width);
          }
          if (currentMinHeight < minAllowableDimension && img.height > 0) {
              scale = Math.max(scale, minAllowableDimension / img.height);
          }

          // Final check to ensure it doesn't exceed canvas boundaries after min_dim scaling
          if (img.width * scale > targetCanvasWidth) {
              scale = targetCanvasWidth / img.width;
          }
          if (img.height * scale > targetCanvasHeight) {
              scale = targetCanvasHeight / img.height;
          }


          img.set({
            left: fabricInstance.width / 2,
            top: fabricInstance.height / 2,
            originX: 'center',
            originY: 'center',
            scaleX: scale,
            scaleY: scale,
            selectable: true,
            evented: true,
            crossOrigin: 'anonymous' // Important for toDataURL if image source is different
          });

          fabricInstance.add(img);
          fabricInstance.setActiveObject(img);
          selectedTool.set('select');
          fabricInstance.requestRenderAll();

          setTimeout(() => { // Defer non-critical updates
              updateImageData();
              saveCanvasState();
              recordHistory(); // Ensure recordHistory is available in this scope
          }, 0);
          console.log('Raster image added to canvas successfully. Final scale:', scale);

        }, { crossOrigin: 'anonymous' }); // Options for fromURL
      };

      reader.onerror = function(err){
          console.error('FileReader error for raster image:', err);
          errorMessage = "Error reading image file";
          setTimeout(() => { errorMessage = null; }, 3000);
      };
      reader.readAsDataURL(file);
    }
  }

  // Function to trigger file input click
  function activateImageUpload() {
    if (fileInput) {
      fileInput.value = ''; // Clear previous selection to allow re-upload of same file
      fileInput.click();
    }
  }

  // --- UNDO / REDO HISTORY MANAGEMENT ---
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  let isRestoringHistory = false; // flag to suppress history during restore
  const MAX_HISTORY = 50;

  function recordHistory() {
    if (!fabricInstance || isRestoringHistory) return;
    try {
      const snapshot = JSON.stringify(fabricInstance.toJSON());
      // Prevent duplicate states at the top of the stack
      if (undoStack.length === 0 || undoStack[undoStack.length - 1] !== snapshot) {
        undoStack.push(snapshot);
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
        redoStack.length = 0; // clear redo stack on new action
      }
    } catch (err) {
      console.error('Error recording history', err);
    }
  }

  // Edit the applySnapshot function to ensure immediate rendering
  function applySnapshot(snapshot: string) {
    if (!fabricInstance) return;
    isRestoringHistory = true;
    try {
      fabricInstance.loadFromJSON(JSON.parse(snapshot), () => {
        // Immediate visual update first
        fabricInstance.renderAll();

        // Then perform the potentially slower operations
        setTimeout(() => {
          updateImageData();
          saveCanvasState(); // This will save the restored state
          isRestoringHistory = false;
          // DO NOT call recordHistory() here, as this is restoring a state, not a new action.
        }, 0);
      });
    } catch (err) {
      console.error('Error applying history snapshot', err);
      isRestoringHistory = false;
    }
  }

  // Update the undoAction function for immediate rendering
  function undoAction() {
    if (!fabricInstance || undoStack.length === 0) return;
    const current = JSON.stringify(fabricInstance.toJSON());
    redoStack.push(current);
    if (redoStack.length > MAX_HISTORY) redoStack.shift();

    const prev = undoStack.pop();
    if (prev) {
      applySnapshot(prev);
    }
  }

  // Update the redoAction function for immediate rendering
  function redoAction() {
    if (!fabricInstance || redoStack.length === 0) return;
    const current = JSON.stringify(fabricInstance.toJSON());
    undoStack.push(current);
    if (undoStack.length > MAX_HISTORY) undoStack.shift();

    const next = redoStack.pop();
    if (next) {
      applySnapshot(next);
    }
  }

  // --- OBJECT REORDERING (Z-INDEX) ---
  /**
   * Reorder selected objects on the Fabric canvas.
   * @param {'backward' | 'forward' | 'back' | 'front'} direction
   */
  function reorderObjects(direction: 'backward' | 'forward' | 'back' | 'front') {
    if (!fabricInstance) return;
    const activeObjects = fabricInstance.getActiveObjects();
    if (!activeObjects || activeObjects.length === 0) return;

    recordHistory(); // Save state before reordering

    activeObjects.forEach((obj: any) => {
      switch (direction) {
        case 'backward':
          fabricInstance.sendBackwards(obj);
          break;
        case 'forward':
          fabricInstance.bringForward(obj);
          break;
        case 'back':
          fabricInstance.sendToBack(obj);
          break;
        case 'front':
          fabricInstance.bringToFront(obj);
          break;
      }
    });

    // Immediate visual update
    fabricInstance.requestRenderAll();

    // Persist state asynchronously to avoid blocking UI
    setTimeout(() => {
      updateImageData();
      saveCanvasState();
      // recordHistory(); // History already recorded at the start of function
    }, 0);
  }

  // Update the handleGlobalKeyDown function for immediate rendering after delete
  // Renamed from handleKeyDown to handleGlobalKeyDown to avoid conflict with new textarea keydown
  function handleGlobalKeyDown(event: KeyboardEvent) {
    const target = event.target as HTMLElement | null;

    // Check if the event target is the new textarea or any other input/editable element
    if (target && (target.tagName === 'TEXTAREA' && target.classList.contains('text-input-area-canvas')) || target.tagName === 'INPUT' || target.isContentEditable || target.closest('.ql-editor')) {
      return; // Ignore if focus is on the new textarea or other input/textarea, contentEditable, or Quill editor
    }

    // console.log('Key event:', { key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.altKey });

    const isMetaOrCtrl = event.metaKey || event.ctrlKey;
    const isShift = event.shiftKey;

    if ((event.key === 'Delete' || event.key === 'Backspace') && fabricInstance) {
      const activeObjects = fabricInstance.getActiveObjects();
      if (activeObjects && activeObjects.length > 0) {
        event.preventDefault();
        recordHistory(); // save state before deletion

        activeObjects.forEach(obj => fabricInstance.remove(obj));
        fabricInstance.discardActiveObject();
        fabricInstance.requestRenderAll();

        setTimeout(() => {
          updateImageData();
          saveCanvasState();
        }, 0);
      }
      return; // Important to prevent further processing for delete/backspace
    }

    // Z-ordering shortcuts
    if (isMetaOrCtrl) {
      if (event.code === 'BracketLeft' || event.key === '[') {
        event.preventDefault(); event.stopPropagation();
        reorderObjects(isShift ? 'back' : 'backward');
        return;
      }
      if (event.code === 'BracketRight' || event.key === ']') {
        event.preventDefault(); event.stopPropagation();
        reorderObjects(isShift ? 'front' : 'forward');
        return;
      }
      // Undo/Redo
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.stopPropagation();
        if (isShift) {
          redoAction();
        } else {
          undoAction();
        }
        return;
      }
      if (event.key.toLowerCase() === 'y') { // Typically redo
        event.preventDefault(); event.stopPropagation();
        redoAction();
        return;
      }
    }
  }

  // Update proxy variables when activeFabricObject changes or is modified
  $: {
    if (activeFabricObject && (activeFabricObject.type === 'rect' || activeFabricObject.type === 'circle' || activeFabricObject.type === 'triangle' || activeFabricObject.type === 'ellipse')) {
      selectedShapeFillProxy = activeFabricObject.fill || '#cccccc';
      selectedShapeStrokeProxy = activeFabricObject.stroke || '#000000';
      selectedShapeStrokeWidthProxy = activeFabricObject.strokeWidth === undefined ? 0 : activeFabricObject.strokeWidth;
    } else if (activeFabricObject && activeFabricObject.type === 'i-text') {
      // Proxies for text - assuming textColorProxy, fontSizeProxy, fontFamilyProxy exist or will be created
      // textColorProxy = activeFabricObject.fill || '#000000';
      // fontSizeProxy = activeFabricObject.fontSize || 32;
      // fontFamilyProxy = activeFabricObject.fontFamily || 'Arial';
    } else {
      // Reset or set to defaults if no shape is selected or different type
      selectedShapeFillProxy = shapeFillColor;
      selectedShapeStrokeProxy = shapeStrokeColor;
      selectedShapeStrokeWidthProxy = shapeStrokeWidth;
    }
  }

  function updateSelectedObjectProperty(property: string, value: any) {
    if (activeFabricObject) {
      activeFabricObject.set(property, value);
      fabricInstance.requestRenderAll();

      setTimeout(() => {
        // updateImageData(); // ImageData updated on object:modified
        saveCanvasState();
        recordHistory();
      }, 0);
    }
  }

  // Click outside to close shape dropdown
  // function handleClickOutside(event: MouseEvent) {
  //   if (showShapeDropdown && shapeDropdownElement && !shapeDropdownElement.contains(event.target as Node) && shapeToolButtonElement && !shapeToolButtonElement.contains(event.target as Node)) {
  //     showShapeDropdown = false;
  //   }
  // }

  // onMount(() => {
  //   console.log('Canvas component mounting...');
  //   // ... other onMount logic ...
  //   window.addEventListener('click', handleClickOutside);
  // });

  // onDestroy(() => {
  //   // ... other onDestroy logic ...
  //   window.removeEventListener('click', handleClickOutside);
  //   window.removeEventListener('keydown', handleGlobalKeyDown); // Ensure this is also cleaned up
  // });

  // --- NEW: Format selection & SVG output support ---
  // User-selected output format: 'png' (default raster) or 'svg' (vector)
  let selectedFormat: string = 'png';

  // Holds raw SVG markup returned by the backend when selectedFormat === 'svg'
  let generatedSvgCode: string | null = null;

  // Fabric instance for rendering SVG output
  let fabricOutputCanvasHTML: HTMLCanvasElement;
  let fabricOutputInstance: any = null;

  // Reactive: force model to GPT-4o and disable others when SVG format chosen
  $: if (selectedFormat === 'svg') {
    selectedModel.set('gpt-4o');
  }

  // Element for SVG code display (for Prism.js)
  let svgCodeElement: HTMLElement;

  /**
   * Render provided SVG string onto a dedicated Fabric.js canvas inside the output pane.
   * The canvas is created (or recreated) each time a new SVG is generated.
   */
  async function renderSvgToOutputCanvas(svgString: string) {
    try {
      if (!svgString) {
        console.warn('renderSvgToOutputCanvas called with no svgString');
        return;
      }
      console.log('Attempting to render SVG, length:', svgString.length);
      // console.log('SVG string preview:', svgString.substring(0, 500) + '...');

      // Pre-process the SVG string to ensure it's properly formatted
      let processedSvg = extractValidSvg(svgString) || svgString; // Use extractValidSvg first
      if (!processedSvg.trim().startsWith('<svg')) {
        console.error('SVG content does not seem to start with an <svg> tag even after extraction.');
        errorMessage = "Invalid SVG content: Missing <svg> tag.";
        return;
      }

      // Ensure the SVG has the required namespace
      if (!processedSvg.includes('xmlns="http://www.w3.org/2000/svg"')) {
        processedSvg = processedSvg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        console.log('Added SVG namespace to the <svg> tag');
      }

      // Ensure viewBox is present (if not already there, try to create a sensible one)
      if (!processedSvg.match(/viewBox=(?:'[^']+'|"[^"]+")/i)) {
        const widthMatch = processedSvg.match(/width=(?:\'([^\']+)\'|\"([^\"]+)\")/i);
        const heightMatch = processedSvg.match(/height=(?:\'([^\']+)\'|\"([^\"]+)\")/i);

        let vbWidth = canvasWidth; // Default to current main canvas width
        let vbHeight = canvasHeight; // Default to current main canvas height

        if (widthMatch && (widthMatch[1] || widthMatch[2])) {
            const parsedW = parseFloat(widthMatch[1] || widthMatch[2]);
            if (!isNaN(parsedW) && parsedW > 0) vbWidth = parsedW;
        }
        if (heightMatch && (heightMatch[1] || heightMatch[2])) {
            const parsedH = parseFloat(heightMatch[1] || heightMatch[2]);
            if (!isNaN(parsedH) && parsedH > 0) vbHeight = parsedH;
        }

        processedSvg = processedSvg.replace(/<svg/i, `<svg viewBox="0 0 ${vbWidth} ${vbHeight}"`);
        console.log(`Added default viewBox attribute to SVG: viewBox="0 0 ${vbWidth} ${vbHeight}"`);
      }

      // console.log('Processed SVG for rendering:', processedSvg.substring(0,500) + '...');

      await loadFabricScript();

      // Check if we need to make the SVG view visible to ensure proper rendering
      const svgViewContainer = document.querySelector('.output-view.svg-view');
      const wasHidden = svgViewContainer && window.getComputedStyle(svgViewContainer).display === 'none';
      let originalDisplay = null;

      // Temporarily make SVG view visible if it was hidden (we'll restore later)
      if (wasHidden && svgViewContainer) {
        originalDisplay = (svgViewContainer as HTMLElement).style.display;
        (svgViewContainer as HTMLElement).style.display = 'block';
        console.log('Temporarily making SVG view visible for rendering');
      }

      if (fabricOutputInstance) {
        try {
          // First, clear all objects from the canvas
          fabricOutputInstance.clear();

          // Then dispose of the canvas properly
          fabricOutputInstance.dispose();

          // Ensure null references to avoid stale references
          fabricOutputInstance = null;

          // Add a small delay to ensure DOM operations complete
          await new Promise(resolve => setTimeout(resolve, 0));

          console.log('Previous output canvas instance properly disposed');
        } catch (disposeError) {
          console.error('Error disposing previous canvas:', disposeError);
          // Continue with new canvas creation even if disposal had issues
        }
      }

      if (!fabricOutputCanvasHTML) {
        console.error('fabricOutputCanvasHTML is not available');
        // Restore original visibility before returning
        if (wasHidden && svgViewContainer && originalDisplay !== null) {
          (svgViewContainer as HTMLElement).style.display = originalDisplay;
        }
        return;
      }

      // Clean up any existing canvas wrappers from previous renders
      const existingWrappers = document.querySelectorAll('.canvas-container');
      existingWrappers.forEach(wrapper => {
        // Only remove wrappers inside the output display area
        const outputDisplay = document.querySelector('.output-display');
        if (outputDisplay && outputDisplay.contains(wrapper)) {
          try {
            // Clone canvas element before removing wrapper
            const originalCanvas = wrapper.querySelector('canvas');
            if (originalCanvas) {
              const parent = wrapper.parentElement;
              if (parent) {
                const clonedCanvas = fabricOutputCanvasHTML.cloneNode(false);
                parent.replaceChild(clonedCanvas, wrapper);
                fabricOutputCanvasHTML = clonedCanvas as HTMLCanvasElement;
              }
            } else {
              wrapper.remove();
            }
          } catch (err) {
            console.warn('Error cleaning up canvas wrapper:', err);
          }
        }
      });

      // Set dimensions before creating canvas instance
      fabricOutputCanvasHTML.width = canvasWidth;
      fabricOutputCanvasHTML.height = canvasHeight;

      fabricOutputInstance = new fabric.Canvas(fabricOutputCanvasHTML, {
        backgroundColor: '#ffffff',
        renderOnAddRemove: true,
        width: canvasWidth,
        height: canvasHeight,
        preserveObjectStacking: true
      });
      console.log('Fabric output canvas initialized:', fabricOutputInstance.width, 'x', fabricOutputInstance.height);

      if (fabricOutputInstance.wrapperEl) {
        const inputContainer = document.querySelector('.canvas-container-overlay');
        if (inputContainer) {
          const computedStyle = window.getComputedStyle(inputContainer);
          fabricOutputInstance.wrapperEl.style.width = computedStyle.width;
          fabricOutputInstance.wrapperEl.style.height = computedStyle.height;
          fabricOutputInstance.wrapperEl.style.position = 'absolute';
          fabricOutputInstance.wrapperEl.style.top = '0';
          fabricOutputInstance.wrapperEl.style.left = '0';
        }
      }
      if (fabricOutputInstance.lowerCanvasEl && inputCanvas) {
        fabricOutputInstance.lowerCanvasEl.style.width = inputCanvas.style.width;
        fabricOutputInstance.lowerCanvasEl.style.height = inputCanvas.style.height;
      }

      // Centralized function to handle processing and rendering of fabric objects
      const processAndRenderFabricObject = (objToRender, source) => {
        try {
          if (!objToRender) {
            console.error(`processAndRenderFabricObject (${source}): No fabric object provided`);
            errorMessage = 'Failed to render SVG - no object provided';
            return false;
          }

          if (objToRender.type === 'group' && (!objToRender._objects || objToRender._objects.length === 0)) {
            console.error(`processAndRenderFabricObject (${source}): Empty group received`, objToRender);
            errorMessage = 'Failed to render SVG - empty group provided';
            return false;
          }

          console.log(`processAndRenderFabricObject (${source}): Object type:`, objToRender.type);

          // Temporarily add to calculate bounds accurately
          fabricOutputInstance.add(objToRender);
          objToRender.setCoords(); // Update coordinates and dimensions

          // Get object bounds - ensure we consider stroke width
          const bounds = objToRender.getBoundingRect(true);
          fabricOutputInstance.remove(objToRender); // Remove after getting bounds

          console.log(`Calculated bounds:`, bounds);

          if (!bounds || bounds.width === 0 || bounds.height === 0) {
            console.error(`Invalid bounds (zero width/height):`, bounds);
            errorMessage = 'Failed to render SVG - could not determine object dimensions';
            return false;
          }

          // Calculate appropriate scaling
          const canvasTargetWidth = fabricOutputInstance.width * 0.9;
          const canvasTargetHeight = fabricOutputInstance.height * 0.9;

          const scaleX = canvasTargetWidth / bounds.width;
          const scaleY = canvasTargetHeight / bounds.height;
          const scale = Math.min(scaleX, scaleY);

          console.log(`Calculated scale: ${scale} (canvas: ${canvasTargetWidth}x${canvasTargetHeight}, bounds: ${bounds.width}x${bounds.height})`);

          // Position object centered on canvas with appropriate scale
          objToRender.set({
            left: fabricOutputInstance.width / 2,
            top: fabricOutputInstance.height / 2,
            originX: 'center',
            originY: 'center',
            scaleX: scale,
            scaleY: scale
          });

          objToRender.setCoords(); // Update coordinates after transform
          fabricOutputInstance.add(objToRender);

          // If the object is a group, ungroup it so that each SVG element becomes its own Fabric object
          if (objToRender.type === 'group' && objToRender._objects && objToRender._objects.length > 0) {
            // Restore child objects' absolute positions
            objToRender._restoreObjectsState();
            const items = objToRender._objects;
            objToRender._objects = [];
            fabricOutputInstance.remove(objToRender);
            items.forEach(item => {
              // Ensure items respect the same scaling/positioning already applied via group transform
              item.setCoords();
              fabricOutputInstance.add(item);
            });
            console.log(`Ungrouped ${items.length} SVG elements into individual Fabric objects.`);
          }

          fabricOutputInstance.requestRenderAll();
          console.log(`SVG rendered successfully from ${source}`);
          errorMessage = null; // Clear any error messages
          return true;
        } catch (err) {
          console.error(`Error in processAndRenderFabricObject (${source}):`, err);
          errorMessage = `Error processing SVG elements: ${err.message || 'unknown error'}`;
          return false;
        }
      };

      // Try different parsing methods in sequence

      // METHOD 1: Primary method - loadSVGFromString
      let renderSuccess = false;
      console.log('METHOD 1: Attempting primary SVG parsing with loadSVGFromString');
      try {
        fabric.loadSVGFromString(processedSvg, (objects, optionsFromLoadSvg) => { // Renamed options here
          console.log('loadSVGFromString callback received', objects?.length || 0, 'objects');

          if (objects && objects.length > 0) {
            const validObjects = objects.filter(obj => obj && obj.type);
            console.log(`Found ${validObjects.length} valid objects out of ${objects.length} total`);

            if (validObjects.length > 0) {
              let elementToAdd;

              if (validObjects.length === 1) {
                elementToAdd = validObjects[0];
                console.log('Processing single SVG element');
              } else {
                console.log('Grouping multiple SVG elements');
                elementToAdd = fabric.util.groupSVGElements(validObjects, optionsFromLoadSvg || {}); // Use optionsFromLoadSvg
              }

              if (elementToAdd) {
                renderSuccess = processAndRenderFabricObject(elementToAdd, 'METHOD 1: loadSVGFromString');

                // Add this new section to handle text elements
                if (renderSuccess) {
                  // After successful render, extract and render text elements separately
                  const bounds = elementToAdd.getBoundingRect(true);
                  const canvasTargetWidth = fabricOutputInstance.width * 0.9;
                  const canvasTargetHeight = fabricOutputInstance.height * 0.9;
                  const scaleX = canvasTargetWidth / bounds.width;
                  const scaleY = canvasTargetHeight / bounds.height;
                  const scale = Math.min(scaleX, scaleY);

                  // Extract and render text elements with appropriate scaling
                  extractAndRenderTextElements(processedSvg, bounds, scale);
                }
              }
            }
          }

          // If method 1 failed, try the next method
          if (!renderSuccess) {
            tryMethod2();
          } else {
            // If successful, restore original visibility
            restoreVisibility();
          }
        });
      } catch (error) {
        console.error('Error in METHOD 1:', error);
        tryMethod2();
      }

      // METHOD 2: Manual DOM parsing and fabric.parseSVGDocument
      function tryMethod2() {
        console.log('METHOD 2: Attempting DOM parsing with parseSVGDocument');
        try {
          const parser = new DOMParser();
          const svgDoc = parser.parseFromString(processedSvg, 'image/svg+xml');

          const parserError = svgDoc.querySelector('parsererror');
          if (parserError) {
            console.error('XML parsing error:', parserError.textContent);
            const errorDetails = parserError.textContent || "Unknown XML parsing error";
            errorMessage = `SVG Parsing Error (Method 2): ${errorDetails.substring(0, 100)}`;
            tryMethod3();
            return;
          }

          const svgElement = svgDoc.documentElement;
          if (!svgElement || svgElement.nodeName.toLowerCase() !== 'svg') {
            console.error('Not a valid SVG document element or svgElement is null/undefined');
            errorMessage = 'Invalid SVG structure (Method 2): Missing <svg> root element.';
            tryMethod3();
            return;
          }

          let parsedViewBoxObj = null;
          const viewBoxAttr = svgElement.getAttribute('viewBox');
          if (viewBoxAttr) {
            const parts = viewBoxAttr.split(/[\s,]+/).map(Number);
            if (parts.length === 4 && parts.every(p => !isNaN(p))) {
              parsedViewBoxObj = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
            }
          }

          // Initial options for parseSVGDocument, potentially including the viewBox from the SVG element itself.
          const initialParseOptions = parsedViewBoxObj ? { viewBox: parsedViewBoxObj } : {};

          fabric.parseSVGDocument(svgElement, (results, fabricOptionsFromParse) => {
            // Combine initial options (like our parsed viewBox) with options returned by parseSVGDocument
            const finalProcessingOptions = { ...initialParseOptions, ...(fabricOptionsFromParse || {}) };
            console.log('parseSVGDocument returned', results?.length || 0, 'results. Options used for enliven/grouping:', finalProcessingOptions);

            if (results && results.length > 0) {
              fabric.util.enlivenObjects(results, (enlivenedObjects) => {
                console.log('Enlivened', enlivenedObjects?.length || 0, 'objects');

                if (enlivenedObjects && enlivenedObjects.length > 0) {
                  let elementToAdd;

                  if (enlivenedObjects.length === 1) {
                    elementToAdd = enlivenedObjects[0];
                  } else {
                    // Pass the combined finalProcessingOptions to groupSVGElements
                    elementToAdd = fabric.util.groupSVGElements(enlivenedObjects, finalProcessingOptions);
                  }

                  renderSuccess = processAndRenderFabricObject(elementToAdd, 'METHOD 2: parseSVGDocument');

                  if (!renderSuccess) {
                    tryMethod3();
                  } else {
                    // Add text element rendering for Method 2
                    const bounds = elementToAdd.getBoundingRect(true);
                    const canvasTargetWidth = fabricOutputInstance.width * 0.9;
                    const canvasTargetHeight = fabricOutputInstance.height * 0.9;
                    const scaleX = canvasTargetWidth / bounds.width;
                    const scaleY = canvasTargetHeight / bounds.height;
                    const scale = Math.min(scaleX, scaleY);

                    // Extract and render text elements with appropriate scaling
                    extractAndRenderTextElements(processedSvg, bounds, scale);
                    restoreVisibility();
                  }
                } else {
                  tryMethod3(); // No valid objects found
                }
              }, 'fabric');
            } else {
              tryMethod3(); // No results from parseSVGDocument
            }
          });
        } catch (error) {
          console.error('Error in METHOD 2:', error);
          tryMethod3();
        }
      }

      // METHOD 3: Direct path creation as a last resort
      function tryMethod3() {
        console.log('METHOD 3: Attempting direct path element creation');
        try {
          // Extract path elements directly from the SVG string
          const pathRegex = /<path[^>]*d="([^"]*)"[^>]*>/gi;
          const paths = [];
          let match;

          while ((match = pathRegex.exec(processedSvg)) !== null) {
            // Extract other attributes for the path
            const pathElement = match[0];
            const pathData = match[1];

            // Extract fill, stroke, stroke-width if available
            const fillMatch = pathElement.match(/fill="([^"]*)"/);
            const strokeMatch = pathElement.match(/stroke="([^"]*)"/);
            const strokeWidthMatch = pathElement.match(/stroke-width="([^"]*)"/);

            const fill = fillMatch ? fillMatch[1] : 'none';
            const stroke = strokeMatch ? strokeMatch[1] : '#000000';
            const strokeWidth = strokeWidthMatch ? parseFloat(strokeWidthMatch[1]) : 1;

            if (pathData) {
              console.log(`Creating path with data: ${pathData.substring(0, 30)}...`);
              try {
                const fabricPath = new fabric.Path(pathData, {
                  fill: fill,
                  stroke: stroke,
                  strokeWidth: strokeWidth,
                  objectCaching: false // Disable caching for more reliable rendering
                });

                if (fabricPath) {
                  paths.push(fabricPath);
                }
              } catch (pathError) {
                console.error('Error creating individual path:', pathError);
              }
            }
          }

          console.log(`METHOD 3: Extracted ${paths.length} paths from SVG string`);

          if (paths.length > 0) {
            let elementToAdd;

            if (paths.length === 1) {
              elementToAdd = paths[0];
            } else {
              elementToAdd = new fabric.Group(paths, {
                objectCaching: false
              });
            }

            renderSuccess = processAndRenderFabricObject(elementToAdd, 'METHOD 3: direct path creation');

            if (!renderSuccess) {
              showFinalError();
            } else {
              // Add text element rendering for Method 3
              const bounds = elementToAdd.getBoundingRect(true);
              const canvasTargetWidth = fabricOutputInstance.width * 0.9;
              const canvasTargetHeight = fabricOutputInstance.height * 0.9;
              const scaleX = canvasTargetWidth / bounds.width;
              const scaleY = canvasTargetHeight / bounds.height;
              const scale = Math.min(scaleX, scaleY);

              extractAndRenderTextElements(processedSvg, bounds, scale);
              restoreVisibility();
            }
          } else {
            showFinalError();
          }
        } catch (error) {
          console.error('Error in METHOD 3:', error);
          showFinalError();
        }
      }

      function showFinalError() {
        console.error('All SVG parsing methods failed');
        errorMessage = 'Failed to render SVG - no valid elements found after all parsing attempts.';
        restoreVisibility();
      }

      // Helper function to restore original visibility state
      function restoreVisibility() {
        if (wasHidden && svgViewContainer && originalDisplay !== null) {
          // Delay restoring display to ensure rendering is complete
          setTimeout(() => {
            (svgViewContainer as HTMLElement).style.display = originalDisplay;
            console.log('Restored original visibility state of SVG view');
          }, 100);
        }
      }

    } catch (err) {
      console.error('Outer error in renderSvgToOutputCanvas:', err);
      errorMessage = `Failed to render SVG: ${err.message || 'unexpected error'}`;
    }
  }

  // Controls which representation of the generated vector is shown in the output pane
  // "svg" – the rendered preview on a Fabric canvas
  // "code" – raw SVG markup in a scrollable block
  let outputView: string = 'svg';
  let lastFormattedAndHighlightedSvgCode: string | null = null;
  let isHighlightingInProgress = false;

  // Whenever the generated SVG code is cleared (e.g. switching back to PNG mode)
  // make sure the viewer defaults to the preview tab.
  $: if (!generatedSvgCode) {
    outputView = 'svg';
  }

  // React to tab changes - ensure canvas is properly redrawn when returning to SVG view
  // AND apply syntax highlighting when switching to "Code" view.
  $: if (browser && svgCodeElement) {
    if (outputView === 'code' && generatedSvgCode) {
      // We are in code view and have SVG code
      if (generatedSvgCode !== lastFormattedAndHighlightedSvgCode && !isHighlightingInProgress) {
        // The code is new or different from what was last processed, and not already processing
        const processCode = async () => {
          isHighlightingInProgress = true;
          try {
            console.log('Formatting and highlighting new/changed SVG code...');
            const formattedSvg = await prettier.format(generatedSvgCode, {
              parser: 'html',
              plugins: [htmlParser], // htmlParser defined earlier
              printWidth: 80,
              tabWidth: 2,
              useTabs: false,
              htmlWhitespaceSensitivity: 'ignore'
            });
            svgCodeElement.textContent = formattedSvg;
            await tick();

            // Only highlight if Prism is loaded and available
            if (PrismLoaded && Prism && typeof Prism.highlightElement === 'function') {
              try {
                Prism.highlightElement(svgCodeElement);
                console.log('SVG code formatted with Prettier and highlighted with Prism.js');
              } catch (prismError) {
                console.warn('Error applying Prism highlighting:', prismError);
                console.log('SVG code formatted with Prettier (Prism highlighting failed)');
              }
            } else {
              console.log('SVG code formatted with Prettier (Prism.js not available)');
            }

            lastFormattedAndHighlightedSvgCode = generatedSvgCode; // Mark this version as processed
          } catch (error) {
            console.error('Error formatting/highlighting SVG:', error, { parserHtml: htmlParser, generatedSvgCode });
            svgCodeElement.textContent = generatedSvgCode; // Fallback
            await tick();

            // Try to highlight fallback only if Prism is available
            if (PrismLoaded && Prism && typeof Prism.highlightElement === 'function') {
              try {
                Prism.highlightElement(svgCodeElement);
              } catch (prismError) {
                console.warn('Error applying Prism highlighting on fallback:', prismError);
              }
            }

            lastFormattedAndHighlightedSvgCode = generatedSvgCode; // Mark as processed even on error to prevent loop
          } finally {
            isHighlightingInProgress = false;
          }
        };
        processCode();
      } else if (generatedSvgCode === lastFormattedAndHighlightedSvgCode && !isHighlightingInProgress) {
        // Code is the same as last processed.
        // Ensure Prism highlighting is still applied if element was hidden/re-shown.
        if (PrismLoaded && Prism && !svgCodeElement.querySelector('span.token')) { // Check if Prism's spans are missing
            const reapplyHighlight = async () => {
              isHighlightingInProgress = true;
              try {
                console.log('Re-applying Prism highlighting to existing code (no re-format).');
                await tick(); // ensure textContent (already formatted) is in DOM
                if (PrismLoaded && Prism && typeof Prism.highlightElement === 'function') {
                  Prism.highlightElement(svgCodeElement);
                }
              } catch (e) {
                console.warn("Error re-applying highlight:", e);
              } finally {
                isHighlightingInProgress = false;
              }
            }
            reapplyHighlight();
        } else {
          // console.log('SVG code already formatted and highlighted, and visually appears so.');
        }
      }
    } else if (outputView !== 'code') {
      // When not in code view, clear the last processed code marker
      lastFormattedAndHighlightedSvgCode = null;
      // Optionally clear the content of svgCodeElement if it's not needed when hidden
      // if (svgCodeElement) svgCodeElement.textContent = '';
    }
  }

  // Add a helper function to extract valid SVG from a potentially messy response
  function extractValidSvg(responseText) {
    // Try to extract anything between opening and closing SVG tags
    const svgMatch = responseText.match(/<svg[\s\S]*?<\/svg>/i);

    if (svgMatch && svgMatch[0]) {
      let svgCode = svgMatch[0].trim();

      // Ensure the SVG has the required namespace
      if (!svgCode.includes('xmlns="http://www.w3.org/2000/svg"')) {
        svgCode = svgCode.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
      }

      return svgCode;
    }

    return null;
  }

  // Add a window resize listener to update the output canvas size
  $: if (browser && fabricOutputInstance && selectedFormat === 'svg') {
    resizeOutputCanvas();
  }

  // Function to resize the output canvas
  function resizeOutputCanvas() {
    if (!fabricOutputInstance || !fabricOutputCanvasHTML) return;

    // Check if SVG view is visible - if not, save current state to apply later when visible
    const svgViewContainer = document.querySelector('.output-view.svg-view');
    const isVisible = !svgViewContainer || window.getComputedStyle(svgViewContainer).display !== 'none';

    if (!isVisible) {
      console.log('Skipping immediate resize for hidden SVG view - will be updated when shown');
      // Set a flag to resize when the view becomes visible
      return;
    }

    // Match dimensions with input canvas
    fabricOutputInstance.setWidth(canvasWidth);
    fabricOutputInstance.setHeight(canvasHeight);

    // Apply the same CSS scale to maintain aspect ratio
    if (fabricOutputInstance.wrapperEl) {
      const inputContainer = document.querySelector('.canvas-container-overlay');
      if (inputContainer) {
        const computedStyle = window.getComputedStyle(inputContainer);
        fabricOutputInstance.wrapperEl.style.width = computedStyle.width;
        fabricOutputInstance.wrapperEl.style.height = computedStyle.height;
      }
    }

    if (fabricOutputInstance.lowerCanvasEl && inputCanvas) {
      fabricOutputInstance.lowerCanvasEl.style.width = inputCanvas.style.width;
      fabricOutputInstance.lowerCanvasEl.style.height = inputCanvas.style.height;
    }

    if (fabricOutputInstance.upperCanvasEl && inputCanvas) {
      fabricOutputInstance.upperCanvasEl.style.width = inputCanvas.style.width;
      fabricOutputInstance.upperCanvasEl.style.height = inputCanvas.style.height;
    }

    fabricOutputInstance.calcOffset();
    fabricOutputInstance.requestRenderAll();

    console.log('Output canvas resized to match input canvas dimensions');
  }

  // Add the new dynamic prompt builder just before generateImage definition
  function buildDynamicSvgPrompt(hasSketch: boolean, context: string) {
    /*
      Build an SVG-generation prompt that adapts to whether the user has supplied a sketch on the canvas.
      When a sketch exists we preserve the strict structure-fidelity wording so GPT-4o respects the sketch layout.
      When no sketch exists we instead ask for a clean, high-quality vector illustration solely from the text description.
    */
    const baseHeader = `IMPORTANT: Respond with ONLY valid standalone SVG markup – starting with <svg> and ending with </svg>. Do NOT wrap in Markdown, code fences, or add explanations.`;

    // Use canvasWidth and canvasHeight for the viewBox to match input aspect ratio
    const viewBoxInstruction = `Include xmlns="http://www.w3.org/2000/svg" and an appropriate viewBox attribute, for example: viewBox="0 0 ${canvasWidth} ${canvasHeight}". Adjust the x and y of the viewBox if necessary to encompass all drawn elements, but maintain the width and height based on the input canvas dimensions (${canvasWidth}x${canvasHeight}).`;

    const textStyleInstruction = `For any text elements, use proper <text> tags with appropriate x, y positioning and text-anchor attributes.
Ensure font sizes are legible, ideally aiming for a minimum effective size of 24px within the ${canvasWidth}x${canvasHeight} coordinate system.
Place text thoughtfully so it is clearly visible and does not obstruct important visual elements.
Use font-family: "Inter", sans-serif; for all text.`;

    if (hasSketch) {
      return `${baseHeader}

Create an SVG vector image based on the supplied sketch image. The SVG must match the structure and layout of the sketch exactly – every element should align precisely. Preserve all proportions and positions while adding clean vector styling, colours and refinements.
${context ? `\nContext: ${context}\n` : ''}
Technical requirements:
- ${viewBoxInstruction}
- Use semantic vector elements (<path>, <rect>, <circle>, etc.).
- ${textStyleInstruction}
- Use fills and strokes appropriately.
- Ensure the SVG is syntactically correct and renders without external assets.`;
    }

    // No sketch – free illustration based only on text
    return `${baseHeader}

Create a high-quality, accurate SVG illustration that fulfils the following description:\n"${context || 'Illustration'}"\n
Guidelines:
- Use clean, precise vector geometry and sufficient detail so the image is recognisable at any resolution.
- ${viewBoxInstruction}
- ${textStyleInstruction}
- Prefer descriptive grouping and paths rather than raster images.
- Ensure the SVG renders correctly with no external dependencies.`;
  }

  // -----------------------------------------------------------------------------
  //  Modify the SVG branch inside generateImage to use the new prompt builder and
  //  to omit image data when no sketch exists.
  // -----------------------------------------------------------------------------

  // ... locate the start of the SVG branch (selectedFormat === 'svg') inside
  //     generateImage() and replace its initial logic up to the fetch call ...

  // Function to extract and create text elements from SVG
  function extractAndRenderTextElements(svgString, mainObjectBounds, scaleFactor) {
    if (!fabricOutputInstance || !svgString) return;

    try {
      console.log('Extracting text elements from SVG...');
      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgString, 'image/svg+xml');

      const parseError = svgDoc.querySelector('parsererror');
      if (parseError) {
        console.error('SVG parsing error during text extraction:', parseError.textContent);
        return;
      }

      const textNodes = svgDoc.querySelectorAll('text');
      if (!textNodes || textNodes.length === 0) {
        console.log('No text elements found in SVG for extraction.');
        return;
      }
      console.log(`Found ${textNodes.length} text elements in SVG`);

      const svgElement = svgDoc.querySelector('svg');
      let viewBox = { x: 0, y: 0, width: canvasWidth, height: canvasHeight }; // Default to main canvas dimensions

      if (svgElement && svgElement.getAttribute('viewBox')) {
        const viewBoxString = svgElement.getAttribute('viewBox');
        const viewBoxValues = viewBoxString.split(/[\s,]+/).map(Number);
        if (viewBoxValues.length === 4 && viewBoxValues.every(v => !isNaN(v)) && viewBoxValues[2] > 0 && viewBoxValues[3] > 0) {
          viewBox = {
            x: viewBoxValues[0],
            y: viewBoxValues[1],
            width: viewBoxValues[2],
            height: viewBoxValues[3]
          };
          console.log('Using viewBox for text elements:', viewBox);
        } else {
          console.warn('Invalid or zero-dimension viewBox attribute found for text extraction, using canvas defaults:', viewBoxString);
        }
      } else if (svgElement) {
        const widthAttr = svgElement.getAttribute('width');
        const heightAttr = svgElement.getAttribute('height');
        const parsedW = parseFloat(widthAttr);
        const parsedH = parseFloat(heightAttr);
        if (!isNaN(parsedW) && parsedW > 0) viewBox.width = parsedW;
        if (!isNaN(parsedH) && parsedH > 0) viewBox.height = parsedH;
        console.log('No viewBox, using SVG width/height for text elements. Calculated viewBox:', viewBox);
      } else {
        console.warn('No <svg> element or viewBox found for text extraction, using canvas dimension defaults.');
      }

      const canvasCenterX = fabricOutputInstance.width / 2;
      const canvasCenterY = fabricOutputInstance.height / 2;
      const MIN_FONT_SIZE_PX = 12; // Minimum absolute font size on the output canvas

      textNodes.forEach((textNode, index) => {
        const content = textNode.textContent || '';
        if (!content.trim()) return;

        let x = parseFloat(textNode.getAttribute('x') || '0');
        let y = parseFloat(textNode.getAttribute('y') || '0');

        const rawFontSize = textNode.getAttribute('font-size') || window.getComputedStyle(textNode).fontSize || '24';
        let fontSize = parseFloat(rawFontSize.replace('px', ''));
        if (isNaN(fontSize) || fontSize <=0) fontSize = 24; // Default if parsing fails or invalid

        let fill = textNode.getAttribute('fill') || window.getComputedStyle(textNode).fill || '#000000';
        if (fill.toLowerCase() === 'none') fill = '#000000';

        const textAnchor = textNode.getAttribute('text-anchor') || window.getComputedStyle(textNode).textAnchor || 'start';
        let textAlign = 'left';
        if (textAnchor === 'middle') textAlign = 'center';
        else if (textAnchor === 'end') textAlign = 'right';

        let fontFamily = textNode.getAttribute('font-family') || window.getComputedStyle(textNode).fontFamily || 'Inter, sans-serif';
        if (!fontFamily.toLowerCase().includes('inter')) {
          fontFamily = `"Inter", ${fontFamily}`;
        }

        // Convert SVG coordinates (relative to its viewBox) to fabricOutputInstance coordinates
        // The mainObjectBounds and scaleFactor are for the entire SVG graphic group.
        // We need to map text coords from SVG's internal viewBox to the scaled and centered graphic group.

        const relativeXInViewBox = (x - viewBox.x) / viewBox.width;
        const relativeYInViewBox = (y - viewBox.y) / viewBox.height;

        // Position relative to the mainObjectBounds's top-left, then scaled and centered
        const posXOnObject = mainObjectBounds.left + relativeXInViewBox * mainObjectBounds.width;
        const posYOnObject = mainObjectBounds.top + relativeYInViewBox * mainObjectBounds.height;

        // Font size scaling: AI gives font size relative to its viewBox.
        // We need to scale this font size by the same overall scaleFactor applied to the main SVG group.
        let finalFontSize = fontSize * scaleFactor;
        // Enforce minimum practical font size on the output canvas
        if (finalFontSize < MIN_FONT_SIZE_PX) {
            console.warn(`Text "${content.substring(0,20)}..." scaled font size ${finalFontSize.toFixed(1)}px is too small. Boosting to ${MIN_FONT_SIZE_PX}px.`);
            finalFontSize = MIN_FONT_SIZE_PX;
        }

        let originX = 'left';
        if (textAlign === 'center') originX = 'center';
        else if (textAlign === 'right') originX = 'right';

        console.log(`Creating text "${content.substring(0,30)}..." at fabric(${posXOnObject.toFixed(1)}, ${posYOnObject.toFixed(1)}), finalFontSize: ${finalFontSize.toFixed(1)}px`);

        const fabricText = new fabric.IText(content, {
          left: posXOnObject,
          top: posYOnObject,
          originX: originX,
          originY: 'top', // Consistent origin for y-coordinate interpretation
          fontSize: finalFontSize,
          fontFamily: fontFamily,
          letterSpacing: 0,
          fill: fill,
          textAlign: textAlign,
          selectable: true,
          editable: true,
          evented: true,
          objectCaching: false
        });

        fabricOutputInstance.add(fabricText);
      });

      fabricOutputInstance.requestRenderAll();
      console.log('Text elements processed and added to SVG output canvas');

    } catch (err) {
      console.error('Error processing SVG text elements:', err);
    }
  }

  // Helper function to consolidate formatting and highlighting logic
  async function formatAndHighlight(codeToProcess: string) {
    if (!svgCodeElement || !PrismLoaded || !Prism || typeof Prism.highlightElement !== 'function') {
      // If Prism not ready, just format and set text content, or fallback to raw if prettier fails
      if (svgCodeElement) {
        try {
            const formatted = await prettier.format(codeToProcess, {
                parser: 'html', plugins: [htmlParser],
                printWidth: 80, tabWidth: 2, useTabs: false, htmlWhitespaceSensitivity: 'ignore'
            });
            svgCodeElement.textContent = formatted;
            console.log('Formatted code (Prism not ready).');
        } catch (formatError) {
            console.error('Error formatting code (Prism not ready):', formatError);
            svgCodeElement.textContent = codeToProcess; // Fallback to raw code
        }
      }
      return; // Exit if Prism isn't ready
    }

    isHighlightingInProgress = true;
    try {
      const formattedSvg = await prettier.format(codeToProcess, {
        parser: 'html',
        plugins: [htmlParser],
        printWidth: 80,
        tabWidth: 2,
        useTabs: false,
        htmlWhitespaceSensitivity: 'ignore'
      });
      svgCodeElement.textContent = formattedSvg;
      await tick();
      Prism.highlightElement(svgCodeElement);
      console.log('SVG code formatted and highlighted.');
      lastFormattedAndHighlightedSvgCode = codeToProcess;
    } catch (error) {
      console.error('Error in formatAndHighlight:', error);
      svgCodeElement.textContent = codeToProcess; // Fallback to raw code
      await tick();
      try {
        Prism.highlightElement(svgCodeElement); // Try highlighting fallback
      } catch (highlightError) {
        console.warn('Error highlighting fallback SVG code:', highlightError);
      }
      lastFormattedAndHighlightedSvgCode = codeToProcess;
    } finally {
      isHighlightingInProgress = false;
    }
  }

  // New helper to decide if processing is needed (called from onMount and reactive block)
  function processCodeIfNecessary() {
    if (outputView === 'code' && generatedSvgCode && svgCodeElement) {
      if (generatedSvgCode !== lastFormattedAndHighlightedSvgCode && !isHighlightingInProgress) {
        console.log('processCodeIfNecessary: Code changed or not yet processed. Formatting/Highlighting.');
        formatAndHighlight(generatedSvgCode);
      } else if (generatedSvgCode === lastFormattedAndHighlightedSvgCode && !isHighlightingInProgress && PrismLoaded && Prism && !svgCodeElement.querySelector('span.token')) {
        console.log('processCodeIfNecessary: Code same, but spans missing. Re-highlighting.');
        formatAndHighlight(generatedSvgCode); // Re-run to ensure highlighting is applied
      }
    }
  }

  // React to tab changes or code changes
  $: if (browser && svgCodeElement) {
    if (outputView === 'code' && generatedSvgCode) {
      // Conditions met, call the helper
      // This will run if outputView changes to 'code' or generatedSvgCode changes while in 'code' view
      console.log('Reactive block: outputView or generatedSvgCode changed. Triggering processCodeIfNecessary.');
      processCodeIfNecessary();
    } else if (outputView !== 'code') {
      lastFormattedAndHighlightedSvgCode = null;
    }
  }

  function updateCanvasBackgroundColor(color: string) {
    if (fabricInstance) {
      fabricInstance.setBackgroundColor(color, fabricInstance.renderAll.bind(fabricInstance));
      canvasBackgroundColor = color;
      updateImageData();
      saveCanvasState();
    }
  }

</script>

<svelte:head>
  <title>Daydream</title>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
  <!-- Ensure this specific one for outlined symbols is present -->
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet" />
  <!-- Add Inter font from Google Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

</svelte:head>

<div id = 'app' in:scale={{ start: .98, opacity: 0.5}}>
  <div class="draw-demo-container">


    <div id="main">
      <div class="toolbars-wrapper">
        <!-- New Tool Selection Toolbar -->

        <!-- Existing Stroke Options Toolbar -->
        <div class="vertical-toolbar options-toolbar">
          <div class="tools-group">

            {#if $selectedTool === 'pen' || $selectedTool === 'eraser'}
              <!-- PEN/ERASER Tool Options -->
              <div class="tool-group">
                <input
                  type="color"
                  bind:value={strokeColor}
                  on:input={() => {
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
                    if ($selectedTool === 'eraser') eraserSize = strokeSize;
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

            {:else if $selectedTool === 'select'}
              {#if activeFabricObject && (activeFabricObject.type === 'rect' || activeFabricObject.type === 'circle' || activeFabricObject.type === 'triangle' || activeFabricObject.type === 'ellipse')}
                <!-- SELECTED SHAPE Object Options -->
                <div class="tool-group">
                  <input type="color" value={selectedShapeFillProxy}
                    on:input={(e) => {
                      selectedShapeFillProxy = e.currentTarget.value;
                      updateSelectedObjectProperty('fill', selectedShapeFillProxy);
                    }} />
                </div>
                <div class="tool-group">
                  <input type="color" value={selectedShapeStrokeProxy}
                    on:input={(e) => {
                      selectedShapeStrokeProxy = e.currentTarget.value;
                      updateSelectedObjectProperty('stroke', selectedShapeStrokeProxy);
                    }} />
                </div>
                <div class="tool-group">
                  <VerticalSlider
                    min={0}
                    max={30}
                    step={1}
                    bind:value={selectedShapeStrokeWidthProxy}
                    color="#6355FF"
                    height="120px"
                    onChange={() => {
                      if (activeFabricObject && activeFabricObject.strokeWidth !== selectedShapeStrokeWidthProxy) {
                        updateSelectedObjectProperty('strokeWidth', selectedShapeStrokeWidthProxy);
                      }
                    }}
                    showValue={true}
                  />
                </div>
              {:else}
                <!-- CANVAS BACKGROUND COLOR when no shape is selected -->
                <div class="tool-group">
                  <input
                    type="color"
                    value={canvasBackgroundColor}
                    on:input={(e) => updateCanvasBackgroundColor(e.currentTarget.value)}
                  />
                </div>
              {/if}
            {:else if $selectedTool === 'shape'}
              <!-- SHAPE Tool (for new shape) Options -->
              <div class="tool-group">
                <input type="color" bind:value={shapeFillColor} />
              </div>
              <div class="tool-group">
                <input type="color" bind:value={shapeStrokeColor} />
              </div>

              <div class="tool-group">
                <VerticalSlider min={0} max={30} step={1} bind:value={shapeStrokeWidth} color="#6355FF" height="120px" showValue={true} />
              </div>
            {:else if $selectedTool === 'text'}

              <div class="tool-group">
                <input type="color" bind:value={textColor} />
              </div>
              <!-- Future: Font Size (Slider/Input), Font Family (Dropdown) -->

              <div class="tool-group">
                  <VerticalSlider min={8} max={128} step={1} bind:value={fontSize} color="#6355FF" height="100px" showValue={true} />
              </div>
              <!-- Placeholder for font family dropdown -->

            {:else}
              <!-- Default: Could be empty or show global options if any -->
              <!-- Or just the clear button which is outside this if/else block -->
            {/if}

            <button class="tool-button clear-button" on:click={clearCanvas}>
              <span class="material-icons">delete_outline</span>
            </button>

          </div>
        </div>
      </div>


      <div class = 'area'>
        <div class="canvas-wrapper input-canvas" class:ratio-1-1={selectedAspectRatio === '1:1'} class:ratio-portrait={selectedAspectRatio === 'portrait'} class:ratio-landscape={selectedAspectRatio === 'landscape'}>
          <!-- Canvas container to properly position all canvases together -->
          <div
            class="canvas-container-overlay"
            style="position: relative; width: 100%; height: 100%;"
            class:dragging-over={isDraggingOver}
            on:dragover={handleDragOver}
            on:dragleave={handleDragLeave}
            on:drop={handleDrop}
          >
            <!-- Fabric.js canvas (lower canvas) -->
            <canvas class='fabric-canvas' bind:this={fabricCanvasHTML}>
          </canvas>

            <!-- Perfect-freehand canvas (temporary drawing, transparent overlay) -->
          <canvas
            bind:this={inputCanvas}
            class="drawing-canvas"
            on:pointerdown={onPointerDown}
            on:pointermove={onPointerMove}
            on:pointerup={onPointerUp}
            on:pointercancel={onPointerUp}
            on:pointerleave={onPointerUp}
          ></canvas>

            <!-- Drag overlay message -->
            {#if isDraggingOver}
            <div class="drag-overlay" transition:fade={{duration: 150}}>
              <span class="material-symbols-outlined">file_upload</span>
              <p>Drop image to upload</p>
            </div>
            {/if}
          </div>
        </div>

        <!-- Replace the toolbar with the CanvasToolbar component -->
        <CanvasToolbar
          bind:shapeType={shapeType}
          activateImageUpload={activateImageUpload}
        />
      </div>


      <!-- Hidden file input for image uploads -->
      <input
        type="file"
        bind:this={fileInput}
        on:change={handleFileInputChange}
        accept="image/*,.svg"
        style="display: none;"
      />

      <div class = 'area'>
        <div class="canvas-wrapper output-canvas" class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-portrait={generatedImageAspectRatio === 'portrait'} class:ratio-landscape={generatedImageAspectRatio === 'landscape'}>
          <div class="output-display" class:ratio-1-1={generatedImageAspectRatio === '1:1'} class:ratio-portrait={generatedImageAspectRatio === 'portrait'} class:ratio-landscape={generatedImageAspectRatio === 'landscape'}>
            {#if generatedSvgCode}
              <!-- Tab selector for vector output -->
              <div class="output-tabs">
                <button class="tab-button {outputView === 'svg' ? 'active' : ''}" on:click={() => outputView = 'svg'}>
                  SVG
                </button>
                <button class="tab-button {outputView === 'code' ? 'active' : ''}" on:click={() => outputView = 'code'}>
                  Code
                </button>
              </div>

              <!-- Keep both views in the DOM and toggle visibility instead -->
              <div class="output-view svg-view" style="display: {outputView === 'svg' ? 'block' : 'none'}; width: 100%; height: 100%; position: relative;">
                <canvas class="output-svg-canvas" bind:this={fabricOutputCanvasHTML}></canvas>
              </div>
              <div class="output-view code-view" style="display: {outputView === 'code' ? 'block' : 'none'}; width: 100%; height: 100%;">
                <!-- Modified for correct Prism.js syntax highlighting -->
                <pre class="svg-code-display language-markup"><code bind:this={svgCodeElement} class="language-markup"></code></pre>
              </div>

              {#if $isGenerating}
                <div class="ai-scanning-animation">
                  <div class='loader'></div>
                </div>
              {/if}
            {:else if $editedImageUrl}
              <img src={$editedImageUrl} alt="AI generated image" class="output-image" />
              <button
                class="model-badge download-button"
                on:click={() => {
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
              <div class="drawing-preview" style="aspect-ratio: {(fabricCanvasHTML?.width || inputCanvas?.width)}/{(fabricCanvasHTML?.height || inputCanvas?.height)}">
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
          </div>
        </div>
      </div>
    </div>

  </div>

  <Omnibar
    settingType="image"
    bind:additionalContext
    bind:selectedFormat
    bind:currentSelectedModel={$selectedModel}
    isGenerating={$isGenerating}
    onSubmit={generateImage}
    parentDisabled={parentOmnibarDisabled}
    imageModels={imageGenerationModels}
  />

</div>



<style lang="scss">
// Styles are unchanged as per instructions.
  #app {
    height: 100%;
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
    height: 100%;
    width: 100%;

    .demo-header {
      text-align: center;

      width: 550px;
      position: fixed;
      bottom: 12px;
      left: calc(50vw - 275px);

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
      }

      .context-input-container {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        backdrop-filter: blur(12px);

        border: 1px solid rgba(white, 0.05);
        background: rgba(white, .1);
        border-radius: 32px;
        text-align: center;
        box-shadow: -4px 16px 24px rgba(black, 0.2);
        text-shadow: 0 4px 12px rgba(black, .1);

        padding: 6px 6px 6px 16px;

        .context-input {
          font-family: 'Newsreader', 'DM Sans', serif;
          font-size: 16px;
          font-weight: 650;
          line-height: 100%;
          letter-spacing: -.3px;
          color: white;
          background: none;
          border: none;
          border-radius: 0;
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
        position: absolute;
        bottom: 100px;
        display: flex;
        align-items: center;
        gap: 10px;
        color: white;
        backdrop-filter: blur(16px);
        background: rgba(rgb(211, 0, 0), .4);
        padding: 10px 16px;
        border-radius: 16px;
        margin-top: 8px;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        border: 1px solid rgba(211, 47, 47, 0.3);
        animation: error-pulse 2s infinite;

        .material-icons {
          color: white;
        }

        .reload-button {
          margin-left: auto;
          background: rgba(211, 47, 47, 0.1);
          border: 1px solid rgba(211, 47, 47, 0.3);
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
          transition: all 0.2s ease;

          &:hover {
            background: rgba(211, 47, 47, 0.2);
          }

          .material-icons {
            font-size: 14px;
          }
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
      padding: 6px 12px 7px 10px;

      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: -4px 12px 16px rgba(black, .1);
      position: relative;
      overflow: hidden;
      color: white;

      h3{
        // /font-family: 'Newsreader', 'DM Sans', serif;
        font-size: 14px;
        font-weight: 600;
        letter-spacing: -.3px;
      }

      span{
        font-size: 12px !important;
        font-weight: 900;
        color: #6355FF;
        background: white;
        border-radius: 12px;
        padding: 1px;
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

    #main {
      display: flex;
      justify-content: center;
      align-items: center;
      box-sizing: border-box;
      flex: 1;
      gap: 0;
      min-width: 400px;
      padding: 8px 16px;
      height: 100%;
      position: relative;
      width: 1400px;
      max-width: 100%;
      background: rgba(#030025, .05);

      .area{
        flex: 1;
        height: 100%;
        padding: 12px;
      }

      // New wrapper for toolbars
      .toolbars-wrapper {
        display: flex;
        flex-direction: column; // Stack toolbars vertically
        gap: 10px; // Space between toolbars
        height: fit-content; // Adjust height to content
        z-index: 5;
        position: relative; // Needed for dropdown positioning

        // Toolbar styles
        .vertical-toolbar {
          background: rgba(black, .8);
          border-radius: 12px;
          box-shadow: -4px 16px 24px rgba(black, 0.25);
          padding: 8px 4px; // Adjusted padding
          box-sizing: border-box;
          width: 48px; // Slightly narrower
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;

          &.tool-selector-toolbar {
            // Specific styles for the tool selector if needed
            gap: 6px;
            position: relative; // Parent for dropdown if needed
          }

          &.options-toolbar {
            // Specific styles for the options toolbar if needed
            gap: 20px; // Keep original gap for options
            flex: 1;
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
                margin-bottom: 4px;
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
                  border: 0px solid rgba(white, 0);
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

              .tool-label {
                display: block;
                text-align: center;
                color: #ccc;
                font-size: 12px;
                margin-bottom: 4px;
                font-weight: 500;
                text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
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
        overflow: visible; // Changed from hidden to visible for Fabric controls
        transition: all 0.3s ease;
        box-shadow: none;
        border-radius: 0; // Was 8px, can be 0 if canvas elements themselves have border-radius
        margin: auto;

        &.input-canvas { // This wrapper contains both fabric and perfect-freehand canvases
          position: relative;
          min-width: 300px;
          max-width: 800px; // Max width of the drawing area
          box-shadow: -12px 32px 32px rgba(black, 0.1);

          // Adjust dimensions based on aspect ratio
          &.ratio-1-1 {
            min-height: 300px;
            max-height: calc(100vh - 160px); // Example max height
            aspect-ratio: 1 / 1;
          }

          &.ratio-portrait {
            min-height: calc(300px * (1024 / 1792)); // Min height based on aspect ratio
            max-height: calc(800px * (1024 / 1792)); // Max height based on aspect ratio and max width
            aspect-ratio: 1792 / 1024;
          }

          &.ratio-landscape {
            min-height: calc(300px * (1792 / 1024));
            max-height: calc(800px * (1792 / 1024));
            aspect-ratio: 1024 / 1792;
          }

          // New container for canvas overlay
          .canvas-container-overlay {
            position: relative;
            width: 100%;
            height: 100%;
            overflow: visible;
            border-radius: 8px;

            &.dragging-over {
              &::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                border-radius: 8px;
                z-index: 10;
                pointer-events: none;
              }
            }
          }

          .fabric-canvas, .drawing-canvas {
            border-radius: 4px; // Apply border-radius to canvas elements themselves
            margin: 0;
            display: block;
            max-width: 100%;
            max-height: 100%;
            width: auto; // Let CSS handle this based on aspect ratio and container
            height: auto; // Let CSS handle this
            object-fit: contain; // Ensure canvas content scales correctly
            position: absolute;
            top: 0;
            left: 0;
          }

          .fabric-canvas {
            z-index: 0; // Lower canvas should be below
          }

          .drawing-canvas { // perfect-freehand overlay
            z-index: 1; // Drawing canvas on top
            background-color: transparent;
            cursor: crosshair;
            // pointer-events will be managed by JS
          }
        }

        &.output-canvas {
          min-width: 300px;
          max-width: 800px;
          box-shadow: -12px 32px 32px rgba(black, 0.1);

          // Adjust dimensions based on aspect ratio
          &.ratio-1-1 {
            min-height: 300px;
            max-height: calc(100vh - 160px);
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
            width: 100%; // Use 100% of wrapper
            height: 100%; // Use 100% of wrapper
            border-radius: 4px;
            overflow: hidden; // Clip image if it overflows due to aspect ratio mismatch

            &.output-image { // Class for the img tag itself if needed
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

            img { // Styles for the actual image
              max-width: 100%;
              max-height: 100%;
              width: 100%; // Fill the container width
              height: 100%; // Fill the container height
              object-fit: contain; // Ensure aspect ratio is maintained
              transition: transform 0.3s ease;
              // box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); // Shadow on wrapper is enough
              border-radius: 4px; // Image itself can have slight radius
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
        .canvas-container {
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

    span {
      font-size: 20px;
      font-weight: 400;
      color: #ccc; // Lighter icon color
      transition: color 0.2s, background-color 0.2s;
    }

    &:hover {
      background: rgba(white, 0.1);

      span {
        color: #55ff9c;
      }
    }

    &:active{
      transform: none;
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
      background: rgba(#a0ffc8, 1);

      span {
        color: black;
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

  .dropdown { // This class was for the old model selector, now part of .canvas-input-area
    margin-left: 12px;
    // display: none; // No longer hidden, part of the new input bar

    .select-wrapper { // This styling is now covered by .model-select-wrapper-canvas
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

    select { // This styling is now covered by .model-select-wrapper-canvas > select
      //font-family: 'Newsreader', 'DM Sans', serif;
      font-size: 13px;
      font-weight: 550;
      letter-spacing: -0.24px;
      padding: 10px 40px 12px 16px;
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

  .drag-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: white;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 8px;
    z-index: 11;
    pointer-events: none;

    span {
      font-size: 48px;
      margin-bottom: 12px;
    }

    p {
      font-size: 18px;
      font-weight: 500;
    }
  }

  .tool-button-group {
    display: flex;
    align-items: center;
    // background: rgba(255,0,0,0.1); // for debugging layout
    border-radius: 6px; // Match tool-button
    overflow: hidden; // Clip corners if needed
    width: fit-content; // Take full width of the slot in vertical toolbar


    .main-shape-button {
      flex-grow: 1; // Main button takes available space
      border-radius: 6px 0 0 6px; // Rounded left corners
      padding: 6px 0 6px 6px;
    }
    .shape-dropdown-trigger {
      padding: 8px 2px 8px 0;
      border-radius: 0 6px 6px 0; // Rounded right corners
      border-left: 1px solid rgba(white, 0.05); // Separator
      span {
        text-align: left;
        width: 12px;
        font-size: 16px; // Smaller arrow
      }
    }
    // Hover/active states for the group
    &:hover {
      .main-shape-button, .shape-dropdown-trigger {
       // background: rgba(white, 0.1);
       background: none;
         span {
          color: #55ff9c;
        }
      }
    }
    .main-shape-button.active, .main-shape-button.active + .shape-dropdown-trigger {
       background: rgba(#a0ffc8, 1);
        span {
          color: black;
        }
    }
     .main-shape-button.active:hover, .main-shape-button.active + .shape-dropdown-trigger {
       //background: rgba(#a0ffc8, 0.9);
        span {
          color: black;
        }
    }
  }

  .shape-select-dropdown {
    position: absolute;
    // Remove left and bottom values as they will be dynamic now
    background: rgba(black, .45);
    backdrop-filter: blur(12px);
    border-radius: 8px;
    box-shadow: 0 -4px 12px rgba(black, 0.3);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 10; // Above other elements
    width: 48px; // Same width as toolbar buttons for consistency
    height: fit-content;

    .dropdown-item {
      width: 100%;
      box-sizing: border-box;
      // Uses .tool-button styles by default
    }
  }

  // Styles for the new canvas input area (adapted from image page)
  .canvas-input-area {
    width: 550px;
    max-width: 90vw;
    padding: 0; // Removed padding as it's on the form now
    position: fixed;
    bottom: 18px;
    left: calc(50% - 275px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 0; // Ensure it's above other content

    .input-form {
      display: flex;
      flex-direction: column;
      align-items: flex-end; // Align items to bottom for varying textarea height
      width: 100%;
      background: rgba(20, 20, 22, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px; // Consistent large radius
      padding: 8px;
      box-shadow: 0 16px 32px 8px rgba(black, 0.3);
      backdrop-filter: blur(20px);
      gap: 0px;
    }

    .text-input-area-canvas { // Specific class for canvas textarea
      width: 100%;
      flex-grow: 1;
      background: transparent;
      border: none;
      color: white;
      font-family: "ivypresto-headline", serif;
      font-size: 20px;
      font-weight: 500;
      line-height: 130%;
      letter-spacing: .4px;
      padding: 10px 12px;
      border-radius: 12px; // Slightly smaller radius than form
      resize: none;
      overflow-y: auto; // Hidden by autoResize, but fallback
      min-height: 2g0px; // Corresponds to single line of text
      max-height: 160px; // Max height before scrolling
      transition: background-color 0.2s ease, box-shadow 0.2s ease;
      text-shadow: -.25px 0px 0px rgba(white, 0.9);
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.2) transparent;

      &::placeholder {
        color: #999;
        text-shadow: -.2px 0px 0px #999;
      }

      &:focus {
        outline: none;
      }
    }

    .input-controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px;
      width: 100%;

      .select-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
    }

    .model-select-wrapper-canvas, .format-select-wrapper-canvas { // Shared styles for model & format select
      position: relative;

      select {
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        font-weight: 500;
        padding: 8px 32px 8px 10px; // Adjusted padding
        border-radius: 24px;
        color: #e0e0e0;
        background: rgba(white, .03);
        border: none;
        //background: rgba(255, 255, 255, 0.08);
        //border: 1px solid rgba(255, 255, 255, 0.1);
        cursor: pointer;
        transition: background-color 0.2s ease, border-color 0.2s ease;
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;

        option {
          color: #e0e0e0;
        }

        &:hover {
          background: rgba(white, .05);
        }

        &:focus {
          outline: none;
          border-color: rgba(255, 255, 255, 0.2);
        }
      }

      .custom-caret {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(255, 255, 255, 0.5);
        font-size: 18px;
        pointer-events: none;
      }
    }

    .submit-button-canvas { // Specific class for canvas submit button
      width: 30px;
      height: 30px;
      padding: 0;
      border-radius: 24px;
      background: var(--highlight);
      color: white;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s ease, opacity 0.2s ease;

      .material-symbols-outlined {
        font-size: 18px;
        font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      }

      &:hover:not(:disabled) {
        background: #ff3974;
      }

      &:disabled {
        background: #4a4a50;
        cursor: not-allowed;
        opacity: 0.7;
      }
    }

    .mini-spinner-canvas { // Specific class for canvas spinner
      width: 20px;
      height: 20px;
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spinner-kf 0.8s linear infinite;
    }

    @keyframes spinner-kf {
      to {
        transform: rotate(360deg);
      }
    }
  }

  /* ================= SVG / CODE TAB BAR ================= */
  .output-tabs {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    gap: 4px;
    z-index: 25;
  }

  .output-tabs .tab-button {
    padding: 4px 12px;
    font-size: 12px;
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(0, 0, 0, 0.5);
    color: #eee;
    cursor: pointer;
    backdrop-filter: blur(6px);
    transition: background-color 0.2s;
  }

  .output-tabs .tab-button.active,
  .output-tabs .tab-button:hover {
    background: #6355FF;
    color: #fff;
  }

  .svg-code-display {
    width: 100%;
    height: 100%;
    padding: 20px;
    box-sizing: border-box;
    font-family: monospace;
    font-size: 12px;
    line-height: 150%;
    color: #ddd; /* Fallback color if theme doesn't cover everything */
    background: #272822; /* Default background for Okaidia theme */
    overflow: auto;
    border: none;
    border-radius: 4px;
    resize: none; /* Textarea specific, pre doesn't need this */
    white-space: pre-wrap; /* Ensure long lines wrap */
    word-wrap: break-word; /* Break long words if necessary */
  }

  .output-svg-canvas {
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
  }

  /* Ensure output display has correct dimensions matching input canvas */
  .output-display {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;

    /* Ensure canvas wrapper has correct position */
    .canvas-container {
      position: absolute;
      top: 0;
      left: 0;
      width: 100% !important;
      height: 100% !important;
    }
  }
</style>
