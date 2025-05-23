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
          backgroundColor: '#f8f8f8',
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
    const availableWidth = container.clientWidth - paddingHorizontal;
    const availableHeight = container.clientHeight - paddingVertical;

    let internalWidth, internalHeight;
    if (selectedAspectRatio === '1:1') { internalWidth = 1024; internalHeight = 1024; }
    else if (selectedAspectRatio === 'portrait') { internalWidth = 1792; internalHeight = 1024; }
    else { internalWidth = 1024; internalHeight = 1792; } // landscape

    const widthRatio = availableWidth / internalWidth;
    const heightRatio = availableHeight / internalHeight;
    const scaleFactor = Math.min(widthRatio, heightRatio, 1);

    const newCanvasWidth = Math.min(internalWidth * scaleFactor, availableWidth);
    const newCanvasHeight = Math.min(internalHeight * scaleFactor, availableHeight);

    // Set internal dimensions for both canvases
    inputCanvas.width = internalWidth;
    inputCanvas.height = internalHeight;
    fabricCanvasHTML.width = internalWidth;
    fabricCanvasHTML.height = internalHeight;

    // Apply consistent styling to both canvases
    const canvasStyles = {
      width: `${Math.round(newCanvasWidth)}px`,
      height: `${Math.round(newCanvasHeight)}px`,
      position: 'absolute',
      top: '0',
      left: '0'
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

      if (fabricInstance.upperCanvasEl) {
        // Also set dimensions for the upper canvas (interaction layer)
        fabricInstance.upperCanvasEl.style.width = canvasStyles.width;
        fabricInstance.upperCanvasEl.style.height = canvasStyles.height;
        fabricInstance.upperCanvasEl.style.position = 'absolute';
        fabricInstance.upperCanvasEl.style.top = '0';
        fabricInstance.upperCanvasEl.style.left = '0';
        canvasContainer.style.width = canvasStyles.width;
        canvasContainer.style.height = canvasStyles.height;
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
      `Canvas resized. Display: ${Math.round(newCanvasWidth)}x${Math.round(newCanvasHeight)}, Internal: ${internalWidth}x${internalHeight}, Scale: ${canvasScale.toFixed(2)}`
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
      } else if ($selectedTool === 'select' && activeFabricObject && (activeFabricObject.type === 'rect' || activeFabricObject.type === 'circle' || activeFabricObject.type === 'triangle' || activeFabricObject.type === 'ellipse')}
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
    flex-grow: 0;
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
      flex: 1;
      gap: 0;
      //margin: 12px 0;
      min-width: 400px;
      width: 95vw;
      padding: 8px 16px;
      height: 100%;
      position: relative;

      .area{
        flex: 1;
        height: 100%;
        padding: 12px;
        background: rgba(black, .1);
        //box-shadow: -4px 16px 24px rgba(black, 0.25);
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
          background: rgba(black, .35);
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
            box-shadow: -12px 32px 32px rgba(black, 0.3);

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
