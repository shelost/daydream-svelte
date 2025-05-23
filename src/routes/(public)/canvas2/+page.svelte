<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { fade, scale } from "svelte/transition";
    import type { Tool, Stroke, StrokePoint } from "$lib/types";
    import { getStroke } from "perfect-freehand";
    import {
        getSvgPathFromStroke,
        calculatePressureFromVelocity,
        calculateMultiStrokeBoundingBox,
        findRelatedStrokes,
        normalizeBoundingBox,
    } from "$lib/utils/drawingUtils.js";
    import VerticalSlider from "$lib/components/VerticalSlider.svelte";
    import {
        SvelteFlow,
        Background,
        Controls,
        MiniMap,
        type NodeTypes,
        type EdgeTypes,
    } from "@xyflow/svelte";
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
        selectedModel,
    } from "$lib/stores/canvasStore";

    // Session storage key for canvas data
    const CANVAS_STORAGE_KEY = "canvasDrawingData";

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
    strokeOptions.subscribe((options) => {
        strokeColor = options.color;
        strokeSize = options.size;
        strokeOpacity = options.opacity;

        // If pen tool is active and options change, update currentStroke if any
        if ($selectedTool === "pen" && currentStroke) {
            currentStroke.color = strokeColor;
            currentStroke.size = strokeSize;
            currentStroke.opacity = strokeOpacity;
            renderStrokes(); // Re-render temporary stroke
        }
        // If eraser tool is active, update EraserBrush width
        if (
            $selectedTool === "eraser" &&
            fabricInstance &&
            fabricInstance.isDrawingMode
        ) {
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

    // Drawing content with enhanced strokes - This might become less central with Fabric.js
    let drawingContent: EnhancedDrawingContent = {
        strokes: [], // This will no longer store rendered strokes, Fabric.js does.
        bounds: { width: 800, height: 600 },
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
            if (typeof fabric !== "undefined") {
                console.log("Fabric.js already loaded");
                fabricLoaded = true;
                fabricErrorMessage = null; // Clear any previous errors
                return resolve();
            }

            // Track attempts to prevent infinite retry loops
            fabricLoadAttempts++;
            if (fabricLoadAttempts > MAX_FABRIC_LOAD_ATTEMPTS) {
                const error =
                    "Failed to load Fabric.js after multiple attempts";
                fabricErrorMessage = error;
                return reject(new Error(error));
            }

            console.log(`Loading fabric.js (attempt ${fabricLoadAttempts})`);

            const script = document.createElement("script");
            script.src = "/js/fabric.js";
            script.async = true;

            script.onload = () => {
                console.log("Fabric.js loaded successfully");
                fabricLoaded = true;
                fabric = window["fabric"]; // Assign to our variable
                fabricErrorMessage = null; // Clear any previous errors
                resolve();
            };

            script.onerror = () => {
                console.error("Failed to load Fabric.js");
                if (fabricLoadAttempts >= MAX_FABRIC_LOAD_ATTEMPTS) {
                    fabricErrorMessage =
                        "Failed to load the drawing engine. Please check your internet connection and refresh the page.";
                    reject(new Error("Max retry attempts reached"));
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
            console.error("Fabric canvas element not yet available");
            return false;
        }

        try {
            if (!fabricLoaded) {
                await loadFabricScript();
            }

            if (typeof fabric !== "undefined") {
                // Clean up any existing instance to prevent duplicates
                if (fabricInstance) {
                    fabricInstance.dispose();
                }

                fabricInstance = new fabric.Canvas(fabricCanvasHTML, {
                    backgroundColor: "#f8f8f8",
                    renderOnAddRemove: true,
                    // Ensure Fabric canvas won't create dimensions that are out of sync
                    width: fabricCanvasHTML.width,
                    height: fabricCanvasHTML.height,
                });

                // Make sure Fabric's internal elements are correctly positioned
                if (fabricInstance.wrapperEl) {
                    fabricInstance.wrapperEl.style.position = "absolute";
                    fabricInstance.wrapperEl.style.top = "0";
                    fabricInstance.wrapperEl.style.left = "0";
                    fabricInstance.wrapperEl.style.width =
                        fabricCanvasHTML.style.width;
                    fabricInstance.wrapperEl.style.height =
                        fabricCanvasHTML.style.height;
                }

                // Set default control appearance for all objects
                fabric.Object.prototype.set({
                    cornerStyle: "circle",
                    cornerColor: "white",
                    cornerStrokeColor: "#6355FF",
                    cornerStrokeWidth: 3,
                    cornerSize: 12,
                    padding: 8, // Increased padding for better selection handling
                    transparentCorners: false,
                    borderColor: "#6355FF",
                    borderScaleFactor: 1.5,
                    borderOpacityWhenMoving: 0.5,
                    touchCornerSize: 20,
                });

                /*
          // Set selection appearance
          canvas.selectionColor = 'rgba(20,0,255,0.05)';
          canvas.selectionBorderColor = '#6355FF';
          canvas.selectionLineWidth = 2;

          canvas.hoverCursor = 'pointer';
          */

                console.log("Fabric.js canvas initialized successfully");
                // Listen to path creation and erasing events to save state automatically
                fabricInstance.on("path:created", () => {
                    saveCanvasState();
                });
                if (fabricInstance.on) {
                    fabricInstance.on("erasing:end", () => {
                        saveCanvasState();
                    });
                }
                return true;
            } else {
                console.error(
                    "Fabric.js still not available after loading attempt",
                );
                return false;
            }
        } catch (err) {
            console.error("Error initializing Fabric canvas:", err);
            return false;
        }
    }

    // Function to build the prompt for GPT-Image-1 (Ignoring AI, but keeping for structure)
    function buildGptImagePrompt() {
        let prompt = `Complete this drawing. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;
        const contentGuide =
            sketchAnalysis !== "Draw something to see AI's interpretation"
                ? sketchAnalysis
                : "A user's drawing.";
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
        if (
            strokeRecognition &&
            strokeRecognition !== "Draw something to see shapes recognized"
        ) {
            prompt += `RECOGNIZED SHAPES: ${strokeRecognition}\n\n`;
        }
        prompt += `FINAL INSTRUCTIONS: Create a DIRECT, FRONT-FACING VIEW that maintains the EXACT same composition as the sketch. NEVER distort or reposition any element. Color and texture can be added, but the structural skeleton must remain identical to the original sketch.`;
        return prompt.length > 4000
            ? prompt.substring(0, 3997) + "..."
            : prompt;
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
    let browser = typeof window !== "undefined";
    let lastResizeTime = 0;

    // Separate initialization function
    async function initializeComponent() {
        if (inputCanvas) {
            inputCtx = inputCanvas.getContext("2d");
        }

        // First, load Fabric.js
        try {
            await loadFabricScript();
            // Then initialize the canvas
            const success = await initializeFabricCanvas();
            if (!success) {
                console.error(
                    "Failed to initialize Fabric canvas after script loaded",
                );
                fabricErrorMessage =
                    "Could not initialize drawing tools. Please try refreshing the page.";
            } else {
                // Successfully initialized
                fabricErrorMessage = null;
                // Set up initial canvas alignment and styles
                setupCanvasAlignment();
            }
        } catch (err) {
            console.error("Error loading Fabric.js:", err);
            fabricErrorMessage =
                "Error loading drawing tools. Please check your connection and try refreshing.";
        }

        resizeCanvas(); // Initial resize and setup

        if (inputCtx) {
            renderStrokes(); // Initial render (likely empty perfect-freehand canvas)
            updateImageData(); // Use a centralized function to update imageData
        }

        console.log("Component mounted");
        mobileCheck();
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
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                overflow: "visible",
            });

            // Set z-index for each canvas based on current tool
            updateCanvasZIndex($selectedTool);

            console.log("Canvas alignment complete");
        }
    }

    // Function to update z-index based on selected tool
    function updateCanvasZIndex(tool) {
        if (!fabricInstance || !inputCanvas) return;

        const upperCanvasEl = fabricInstance.upperCanvasEl;

        if (upperCanvasEl) {
            if (tool === "pen") {
                // Draw mode: drawing canvas on top
                inputCanvas.style.zIndex = "1";
                upperCanvasEl.style.zIndex = "0";
                inputCanvas.style.pointerEvents = "auto";
                upperCanvasEl.style.pointerEvents = "none";
            } else {
                // Eraser or select mode: fabric canvas on top
                inputCanvas.style.zIndex = "0";
                upperCanvasEl.style.zIndex = "1";
                inputCanvas.style.pointerEvents = "none";
                upperCanvasEl.style.pointerEvents = "auto";
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
                imageData = fabricInstance.toDataURL({ format: "png" });
            } else if (inputCanvas) {
                // Fallback if fabricInstance not ready
                imageData = inputCanvas.toDataURL("image/png");
            }
        } catch (error) {
            console.error("Error updating image data:", error);
            // Fallback if toDataURL fails
            if (inputCanvas) {
                try {
                    imageData = inputCanvas.toDataURL("image/png");
                } catch (e) {
                    console.error("Could not get image data from any canvas");
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
            sessionStorage.setItem(
                CANVAS_STORAGE_KEY,
                JSON.stringify(canvasData),
            );
            console.log("Canvas state saved to sessionStorage");
        } catch (error) {
            console.error("Error saving canvas state:", error);
        }
    }

    // Function to load canvas state from sessionStorage
    function loadCanvasState() {
        if (!browser || !fabricInstance) return false;

        try {
            const savedData = sessionStorage.getItem(CANVAS_STORAGE_KEY);
            if (savedData) {
                // Parse the saved data
                const canvasData = JSON.parse(savedData);
                // Load the canvas with the saved data
                fabricInstance.loadFromJSON(canvasData, () => {
                    fabricInstance.renderAll();
                    console.log("Canvas state loaded from sessionStorage");
                    updateImageData(); // Ensure preview is updated
                });
                return true;
            }
        } catch (error) {
            console.error("Error loading canvas state:", error);
        }
        return false;
    }

    onMount(() => {
        // Start initialization process
        initializeComponent().then(() => {
            // After initialization, try to load saved state
            if (fabricInstance) {
                const loaded = loadCanvasState();
                if (loaded) {
                    console.log(
                        "Successfully initiated loading of canvas state.",
                    );
                } else {
                    console.log(
                        "No saved canvas state found or fabricInstance not ready for loading.",
                    );
                }
            } else {
                console.error(
                    "Fabric instance not available after component initialization. Cannot load state.",
                );
            }
        });

        // Add event listeners
        window.addEventListener("resize", mobileCheck);

        // Note: beforeNavigate and window.addEventListener('beforeunload', saveCanvasState)
        // are set up in the top-level script block.
        // The 'beforeunload' listener will be cleaned up in the new consolidated onDestroy.

        // Return cleanup function for onMount is not strictly needed here as onDestroy handles it.
    });

    function initializeCanvas() {
        console.log("Initializing canvas");
        resizeCanvas();

        if (inputCtx) {
            inputCtx.lineCap = "round";
            inputCtx.lineJoin = "round";
            inputCtx.strokeStyle = strokeColor;
            inputCtx.lineWidth = strokeSize;
        }
        if (fabricInstance) {
            imageData = fabricInstance.toDataURL({ format: "png" });
        } else if (inputCanvas) {
            imageData = inputCanvas.toDataURL("image/png");
        }
    }

    function getHeightFromAspectRatio(width, aspectRatio) {
        if (aspectRatio === "1:1") return width;
        if (aspectRatio === "portrait") return width * (1024 / 1792);
        if (aspectRatio === "landscape") return width * (1792 / 1024);
        return width;
    }

    function resizeCanvas() {
        if (!inputCanvas || !inputCanvas.parentElement || !fabricCanvasHTML)
            return;

        lastResizeTime = Date.now();
        isResizeEvent = true;

        const drawDemoContainer = document.querySelector('.draw-demo-container') as HTMLElement;
        if (!drawDemoContainer) return;

        // Get the canvas-container element (parent of canvas-wrapper)
        const canvasContainer = document.querySelector('.canvas-container') as HTMLElement;
        if (!canvasContainer) return;

        // Get the canvas-wrapper element
        const canvasWrapper = document.querySelector('.canvas-wrapper.input-canvas') as HTMLElement;
        if (!canvasWrapper) return;

        // Calculate available space in the draw-demo-container
        const header = document.querySelector('.demo-header') as HTMLElement;
        const headerHeight = header?.offsetHeight || 0;
        const availableHeight = drawDemoContainer.clientHeight - headerHeight - 40; // 40px for margins/padding
        const availableWidth = canvasContainer.clientWidth - 100; // Account for toolbars and margins

        // Determine internal resolution based on aspect ratio
        let internalWidth, internalHeight;
        if (selectedAspectRatio === "1:1") {
            internalWidth = 1024;
            internalHeight = 1024;
        } else if (selectedAspectRatio === "portrait") {
            internalWidth = 1792;
            internalHeight = 1024;
        } else { // landscape
            internalWidth = 1024;
            internalHeight = 1792;
        }

        // Calculate how to fit the canvas in the available space while maintaining aspect ratio
        const widthRatio = availableWidth / internalWidth;
        const heightRatio = availableHeight / internalHeight;
        const scaleFactor = Math.min(widthRatio, heightRatio, 1);

        const displayWidth = Math.floor(internalWidth * scaleFactor);
        const displayHeight = Math.floor(internalHeight * scaleFactor);

        // Set the canvas-wrapper size to exactly match the canvas display dimensions
        canvasWrapper.style.width = `${displayWidth}px`;
        canvasWrapper.style.height = `${displayHeight}px`;
        canvasWrapper.style.minWidth = `${displayWidth}px`;
        canvasWrapper.style.maxWidth = `${displayWidth}px`;
        canvasWrapper.style.minHeight = `${displayHeight}px`;
        canvasWrapper.style.maxHeight = `${displayHeight}px`;

        // Set internal dimensions for both canvases (actual drawing resolution)
        inputCanvas.width = internalWidth;
        inputCanvas.height = internalHeight;
        fabricCanvasHTML.width = internalWidth;
        fabricCanvasHTML.height = internalHeight;

        // Apply consistent styling to both canvases
        const canvasStyles = {
            width: `${displayWidth}px`,
            height: `${displayHeight}px`,
            position: "absolute",
            top: "0",
            left: "0",
        };

        // Apply styles to perfect-freehand canvas
        Object.assign(inputCanvas.style, canvasStyles);

        // Apply styles to fabric canvas element
        Object.assign(fabricCanvasHTML.style, canvasStyles);

        // Update the canvas-container-overlay to match
        const overlayContainer = document.querySelector('.canvas-container-overlay') as HTMLElement;
        if (overlayContainer) {
            overlayContainer.style.width = `${displayWidth}px`;
            overlayContainer.style.height = `${displayHeight}px`;
        }

        canvasScale = scaleFactor;
        canvasWidth = internalWidth;
        canvasHeight = internalHeight;

        if (fabricInstance) {
            // Important: Need to set both element dimensions and fabric dimensions
            fabricInstance.setWidth(internalWidth);
            fabricInstance.setHeight(internalHeight);
            fabricInstance.setDimensions({
                width: internalWidth,
                height: internalHeight,
            });

            // Ensure the CSS dimensions match as well
            fabricInstance.lowerCanvasEl.style.width = canvasStyles.width;
            fabricInstance.lowerCanvasEl.style.height = canvasStyles.height;

            if (fabricInstance.upperCanvasEl) {
                // Also set dimensions for the upper canvas (interaction layer)
                fabricInstance.upperCanvasEl.style.width = canvasStyles.width;
                fabricInstance.upperCanvasEl.style.height = canvasStyles.height;
                fabricInstance.upperCanvasEl.style.position = "absolute";
                fabricInstance.upperCanvasEl.style.top = "0";
                fabricInstance.upperCanvasEl.style.left = "0";
            }

            fabricInstance.calcOffset();
            fabricInstance.requestRenderAll();
        }

        drawingContent.bounds = {
            width: internalWidth,
            height: internalHeight,
        };

        if (renderDebounceTimeout) clearTimeout(renderDebounceTimeout);
        renderDebounceTimeout = setTimeout(() => {
            console.log("Rendering strokes after resize debounce");
            renderStrokes();
            updateImageData(); // Use the centralized function
            setTimeout(() => {
                isResizeEvent = false;
            }, 50);
        }, 100);

        console.log(
            `Canvas resized. Display: ${displayWidth}x${displayHeight}, Internal: ${internalWidth}x${internalHeight}, Scale: ${canvasScale.toFixed(2)}`
        );
    }

    $: {
        if (browser && inputCanvas && fabricCanvasHTML) {
            if ($selectedTool === "pen") {
                // For pen tool, we want to draw on the perfect-freehand canvas
                inputCanvas.style.pointerEvents = "auto";
                inputCanvas.style.zIndex = "1"; // Ensure drawing canvas is on top
                if (fabricInstance) {
                    fabricInstance.isDrawingMode = false;
                    // Make sure fabric canvas doesn't capture pointer events when in pen mode
                    if (fabricInstance.upperCanvasEl) {
                        fabricInstance.upperCanvasEl.style.pointerEvents =
                            "none";
                    }
                }
            } else if ($selectedTool === "eraser") {
                // For eraser tool, we want to use Fabric.js eraser brush
                inputCanvas.style.pointerEvents = "none";
                if (fabricInstance) {
                    fabricInstance.isDrawingMode = true;
                    // Make sure fabric canvas captures pointer events in eraser mode
                    if (fabricInstance.upperCanvasEl) {
                        fabricInstance.upperCanvasEl.style.pointerEvents =
                            "auto";
                        fabricInstance.upperCanvasEl.style.zIndex = "2"; // Put fabric interaction layer on top
                    }

                    if (
                        !fabricInstance.freeDrawingBrush ||
                        !(
                            fabricInstance.freeDrawingBrush instanceof
                            fabric.EraserBrush
                        )
                    ) {
                        if (fabric.EraserBrush) {
                            // Ensure EraserBrush exists
                            fabricInstance.freeDrawingBrush =
                                new fabric.EraserBrush(fabricInstance);
                        } else {
                            console.error(
                                "fabric.EraserBrush is not available. Ensure custom build is correct.",
                            );
                        }
                    }
                    if (fabricInstance.freeDrawingBrush) {
                        // Check if brush was set
                        fabricInstance.freeDrawingBrush.width = eraserSize;
                    }
                }
            } else if ($selectedTool === "select") {
                // For select tool, we want to use Fabric.js selection capabilities
                inputCanvas.style.pointerEvents = "none";
                if (fabricInstance) {
                    fabricInstance.isDrawingMode = false;
                    // Make sure fabric canvas captures pointer events in select mode
                    if (fabricInstance.upperCanvasEl) {
                        fabricInstance.upperCanvasEl.style.pointerEvents =
                            "auto";
                        fabricInstance.upperCanvasEl.style.zIndex = "2"; // Put fabric interaction layer on top
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
                console.log(
                    "User edit detected, scheduling analysis (AI part ignored)",
                );
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
        if ($selectedTool === "pen") {
            startPenStroke(e);
        }
    }

    function onPointerMove(e: PointerEvent) {
        if ($selectedTool === "pen") {
            continuePenStroke(e);
        }
    }

    function onPointerUp(e: PointerEvent) {
        if ($selectedTool === "pen") {
            endPenStroke(e);
        }
    }

    // --- Tool Specific Functions ---

    // PEN TOOL
    function startPenStroke(e: PointerEvent) {
        isDrawing = true;
        console.log(
            `Pen Draw Started. Pointer type: ${e.pointerType}, Pressure: ${e.pressure}`,
        );

        const point = getPointerPosition(e);
        const timestamp = Date.now();
        pointTimes = [timestamp];
        const hasHardwarePressure =
            e.pointerType === "pen" && e.pressure > 0 && e.pressure !== 0.5;

        let currentOptionsValues;
        strokeOptions.subscribe((options) => {
            currentOptionsValues = options;
        })();

        currentStroke = {
            tool: "pen",
            points: [point],
            color: currentOptionsValues.color,
            size: currentOptionsValues.size,
            opacity: currentOptionsValues.opacity,
            hasHardwarePressure: hasHardwarePressure,
        };
        inputCanvas.setPointerCapture(e.pointerId);
    }

    function continuePenStroke(e: PointerEvent) {
        if (!isDrawing || !currentStroke || !inputCtx) return;
        const point = getPointerPosition(e);
        const timestamp = Date.now();
        pointTimes.push(timestamp);

        if (
            !currentStroke.hasHardwarePressure ||
            (e.pointerType === "pen" && e.pressure === 0.5)
        ) {
            if (currentStroke.points.length > 1) {
                const calculatedPressure = calculatePressureFromVelocity(
                    currentStroke.points,
                    currentStroke.points.length - 1,
                    0.2,
                    true,
                    pointTimes,
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
        console.log("Pen Draw Ended");

        // Check if Fabric.js is available
        if (!fabricInstance) {
            console.error(
                "Cannot complete stroke - Fabric.js instance not available",
            );
            if (!fabricErrorMessage) {
                fabricErrorMessage =
                    "Drawing engine not initialized. Please refresh the page.";
            }
            // Still end the stroke cleanly even if we can't add it to Fabric
            currentStroke = null;
            isDrawing = false;
            if (e.pointerId) {
                try {
                    inputCanvas.releasePointerCapture(e.pointerId);
                } catch (err) {
                    console.error("Error releasing pointer capture:", err);
                }
            }
            renderStrokes(); // Clear the temporary stroke from inputCanvas
            return;
        }

        if (currentStroke.points.length > 1) {
            let currentOptionsValues;
            strokeOptions.subscribe((options) => {
                currentOptionsValues = options;
            })();

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

            const enhancedPoints = currentStroke.points.map((p) => [
                p.x,
                p.y,
                p.pressure || 0.5,
            ]);
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
                    console.error("Error creating fabric path:", err);
                    if (!fabricErrorMessage) {
                        fabricErrorMessage =
                            "Error adding stroke to canvas. Please refresh the page.";
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
                console.error("Error releasing pointer capture:", err);
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
        console.log("Eraser Tool Active - Fabric.js handles drawing");
    }

    function continueEraserStroke(e: PointerEvent) {
        // Fabric.js handles this
    }

    function endEraserStroke(e: PointerEvent) {
        console.log("Eraser stroke ended on Fabric.js canvas");
        lastUserEditTime = Date.now();
        pendingAnalysis = true;
        updateImageData(); // Use centralized function
        saveCanvasState();
    }

    // SELECT TOOL
    // Note: $selectedTool reactive block handles setting fabricInstance.isDrawingMode = false.
    // Fabric.js handles selection internally.
    function startSelection(e: PointerEvent) {
        console.log("Select Tool Active - Fabric.js handles selection");
    }

    function continueSelection(e: PointerEvent) {
        // Fabric.js handles this
    }

    function endSelection(e: PointerEvent) {
        console.log("Selection operation ended on Fabric.js canvas");
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
            pressure: e.pressure,
        };
    }

    function renderStrokes() {
        if (!inputCtx || !inputCanvas) return;
        inputCtx.clearRect(0, 0, inputCanvas.width, inputCanvas.height);

        if (
            currentStroke &&
            currentStroke.points.length > 1 &&
            $selectedTool === "pen"
        ) {
            // Only render for pen tool
            let currentOptionsValues;
            strokeOptions.subscribe((options) => {
                currentOptionsValues = options;
            })();

            const options = {
                size: currentStroke.size,
                thinning: currentOptionsValues.thinning,
                smoothing: currentOptionsValues.smoothing,
                streamline: currentOptionsValues.streamline,
                easing: currentOptionsValues.easing,
                simulatePressure: !(currentStroke as EnhancedStroke)
                    .hasHardwarePressure,
                last: false, // Temporary stroke is never "last" in the context of the final path
                start: currentOptionsValues.start,
                end: currentOptionsValues.end,
            };

            const enhancedPoints = currentStroke.points.map((p) => [
                p.x,
                p.y,
                p.pressure || 0.5,
            ]);
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
            fabricInstance.setBackgroundColor(
                "#f8f8f8",
                fabricInstance.renderAll.bind(fabricInstance),
            );
            updateImageData(); // Use centralized function

            // Also clear the sessionStorage data
            if (browser) {
                sessionStorage.removeItem(CANVAS_STORAGE_KEY);
                console.log("Canvas storage cleared");
            }
        } else if (inputCtx && inputCanvas) {
            inputCtx.clearRect(0, 0, inputCanvas.width, inputCanvas.height);
            inputCtx.fillStyle = "#f8f8f8"; // Should be transparent
            inputCtx.fillRect(0, 0, inputCanvas.width, inputCanvas.height); // No fill if transparent
            updateImageData(); // Use centralized function

            // Also clear the sessionStorage data
            if (browser) {
                sessionStorage.removeItem(CANVAS_STORAGE_KEY);
                console.log("Canvas storage cleared");
            }
        }

        generatedImageUrl.set(null);
        generatedByModel.set(null);
    }

    async function generateImage() {
        if (fabricInstance && fabricInstance.getObjects().length === 0) {
            errorMessage = "Please draw something first!";
            setTimeout(() => {
                errorMessage = null;
            }, 3000);
            return;
        } else if (
            !fabricInstance &&
            (!currentStroke || currentStroke.points.length === 0)
        ) {
            // Fallback check if fabric not ready
            errorMessage = "Please draw something first!";
            setTimeout(() => {
                errorMessage = null;
            }, 3000);
            return;
        }

        console.log("Starting image generation...");
        updateImageData(); // Use centralized function
        console.log(
            "Canvas image captured for preview (from Fabric if available)",
        );

        isGenerating.set(true);
        // AI logic is ignored. Simulate a delay for preview update.
        setTimeout(() => {
            isGenerating.set(false);
            console.log(
                "Simulated image generation finished. AI calls skipped.",
            );
        }, 1000);
    }

    function buildGptEditPrompt() {
        // AI Ignored
        let prompt = `Complete this drawing, in the exact same style and proportions as the original. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;
        let prompt2 = `Complete this drawing, in the exact same style and proportions as the original. DO NOT change the original image sketch at all; simply add onto the existing drawing EXACTLY as it is. CRITICAL STRUCTURE PRESERVATION: You MUST treat this sketch as an EXACT STRUCTURAL TEMPLATE. `;
        const contentGuide =
            sketchAnalysis !== "Draw something to see AI's interpretation"
                ? sketchAnalysis
                : "A user's drawing.";
        prompt += `\n\nCONTENT DESCRIPTION: ${contentGuide}`;
        if (additionalContext) {
            prompt2 += `\n\nUSER'S CONTEXT: \"${additionalContext}\"`;
        }
        if (analysisElements.length > 0) {
            const structuralGuide = `Based on analysis, the drawing contains ${analysisElements.length} main elements. Element positions and basic relationships are implied by the sketch.`;
            prompt += `\n\nSTRUCTURAL GUIDE: ${structuralGuide}`;
        }
        const compositionGuide = `Focus on the arrangement within the ${selectedAspectRatio} frame.`;
        prompt += `\n\nCOMPOSITION GUIDE: ${compositionGuide}`;
        if (
            strokeRecognition &&
            strokeRecognition !== "Draw something to see shapes recognized"
        ) {
            prompt += `\n\nRECOGNIZED SHAPES: ${strokeRecognition}`;
        }
        return prompt2.length > 4000
            ? prompt2.substring(0, 3997) + "..."
            : prompt2;
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
            console.log("Mobile device detected, adjusting UI");
        }
        if (inputCanvas || fabricCanvasHTML) {
            resizeCanvas();
        }
    }

    let selectedAspectRatio = "1:1";
    const aspectRatios = {
        "1:1": 1 / 1,
        portrait: 1536 / 1024,
        landscape: 1024 / 1536,
    };
    let generatedImageAspectRatio = "1:1";

    $: {
        if (selectedAspectRatio) {
            generatedImageAspectRatio = selectedAspectRatio;
            if (browser) {
                resizeCanvas();
                // After resize, if fabricInstance exists and has objects, ensure they are rendered.
                // If perfect-freehand is in the middle of a stroke, renderStrokes() handles it.
                if (fabricInstance && fabricInstance.getObjects().length > 0) {
                    fabricInstance.renderAll();
                } else if (currentStroke && $selectedTool === "pen") {
                    renderStrokes();
                }
            }
        }
    }

    // beforeNavigate to save
    import { beforeNavigate } from "$app/navigation";
    if (browser) {
        beforeNavigate(() => {
            saveCanvasState();
        });
        // Moved 'beforeunload' listener setup here for clarity, will be cleaned in onDestroy
        window.addEventListener("beforeunload", saveCanvasState);
    }

    // CONSOLIDATED onDestroy function
    onDestroy(() => {
        console.log(
            "Canvas component destroying. Saving state and cleaning up.",
        );
        saveCanvasState(); // Ensure state is saved

        if (browser) {
            window.removeEventListener("resize", mobileCheck);
            window.removeEventListener("beforeunload", saveCanvasState); // Crucial: remove this listener
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
</script>

<svelte:head>
    <title>Daydream</title>
    <link
        href="https://fonts.googleapis.com/icon?family=Material+Icons"
        rel="stylesheet"
    />
    <link
        href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
        rel="stylesheet"
    />
    <!-- Fabric.js is now loaded dynamically in onMount() -->
</svelte:head>

<div id="app" in:scale={{ start: 0.95, opacity: 0.5 }}>
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
                        disabled={$isGenerating ||
                            ((!fabricInstance ||
                                fabricInstance.getObjects().length === 0) &&
                                !currentStroke &&
                                $selectedTool === "pen")}
                    >
                        <span class="material-icons">arrow_forward</span>
                        <h3>
                            {$isGenerating ? "Creating..." : "Create"}
                        </h3>
                    </button>
                </div>

                <div class="dropdown">
                    <div class="select-wrapper">
                        <select id="model-selector" bind:value={$selectedModel}>
                            <option value="gpt-image-1" selected>
                                gpt-image-1
                            </option>
                            <option value="flux-canny-pro">
                                flux-canny-pro
                            </option>
                            <option value="controlnet-scribble">
                                controlnet-scribble
                            </option>
                            <option value="stable-diffusion">
                                stable-diffusion
                            </option>
                            <option value="latent-consistency">
                                LCM (Fast)
                            </option>
                        </select>
                        <span class="material-icons custom-caret"
                            >expand_more</span
                        >
                    </div>
                </div>
            </div>

            {#if errorMessage}
                <div class="error-message" transition:fade={{ duration: 200 }}>
                    <span class="material-icons">error_outline</span>
                    {errorMessage}
                    <button
                        on:click={() => window.location.reload()}
                        class="reload-button"
                    >
                        <span class="material-icons">refresh</span> Reload
                    </button>
                </div>
            {/if}

            {#if fabricErrorMessage}
                <div class="error-message" transition:fade={{ duration: 200 }}>
                    <span class="material-icons">error_outline</span>
                    {fabricErrorMessage}
                    <button
                        on:click={() => window.location.reload()}
                        class="reload-button"
                    >
                        <span class="material-icons">refresh</span> Reload
                    </button>
                </div>
            {/if}
        </header>

        <div class="canvas-container">
            <div class="toolbars-wrapper">
                <!-- New Tool Selection Toolbar -->

                <div class="vertical-toolbar tool-selector-toolbar">
                    <button
                        class="tool-button"
                        class:active={$selectedTool === "pen"}
                        on:click={() => selectedTool.set("pen")}
                        title="Pen Tool"
                    >
                        <span class="material-symbols-outlined">
                            stylus_pen
                        </span>
                    </button>
                    <button
                        class="tool-button"
                        class:active={$selectedTool === "eraser"}
                        on:click={() => selectedTool.set("eraser")}
                        title="Eraser Tool"
                    >
                        <span class="material-symbols-outlined">
                            ink_eraser
                        </span>
                    </button>
                    <button
                        class="tool-button"
                        class:active={$selectedTool === "select"}
                        on:click={() => selectedTool.set("select")}
                        title="Select Tool"
                    >
                        <span class="material-symbols-outlined">
                            arrow_selector_tool
                        </span>
                    </button>
                </div>

                <!-- Existing Stroke Options Toolbar -->
                <div class="vertical-toolbar options-toolbar">
                    <div class="tools-group">
                        <div class="tool-group">
                            <input
                                type="color"
                                bind:value={strokeColor}
                                on:input={() => {
                                    strokeOptions.update((opts) => ({
                                        ...opts,
                                        color: strokeColor,
                                    }));
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
                                    strokeOptions.update((opts) => ({
                                        ...opts,
                                        size: strokeSize,
                                    }));
                                    if ($selectedTool === "eraser")
                                        eraserSize = strokeSize;
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
                                    strokeOptions.update((opts) => ({
                                        ...opts,
                                        opacity: strokeOpacity,
                                    }));
                                }}
                                showValue={true}
                            />
                        </div>

                        <!-- AI related UI Ignored -->

                        <button
                            class="tool-button clear-button"
                            on:click={clearCanvas}
                        >
                            <span class="material-icons">delete_outline</span>
                        </button>
                    </div>
                </div>
            </div>


            <div
                class="canvas-wrapper input-canvas"
                class:ratio-1-1={selectedAspectRatio === "1:1"}
                class:ratio-portrait={selectedAspectRatio === "portrait"}
                class:ratio-landscape={selectedAspectRatio === "landscape"}
            >
                <!-- Canvas container to properly position all canvases together -->
                <div
                    class="canvas-container-overlay"
                    style="position: relative; width: 100%; height: 100%;"
                >
                    <!-- Fabric.js canvas (lower canvas) -->
                    <canvas class="fabric-canvas" bind:this={fabricCanvasHTML}>
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
                </div>
            </div>

            <div
                class="canvas-wrapper output-canvas"
                class:ratio-1-1={generatedImageAspectRatio === "1:1"}
                class:ratio-portrait={generatedImageAspectRatio === "portrait"}
                class:ratio-landscape={generatedImageAspectRatio ===
                    "landscape"}
            >
                <div
                    class="output-display"
                    class:ratio-1-1={generatedImageAspectRatio === "1:1"}
                    class:ratio-portrait={generatedImageAspectRatio ===
                        "portrait"}
                    class:ratio-landscape={generatedImageAspectRatio ===
                        "landscape"}
                >
                    {#if $editedImageUrl}
                        <img
                            src={$editedImageUrl}
                            alt="AI generated image"
                            class="output-image"
                        />
                        <button
                            class="model-badge download-button"
                            on:click={() => {
                                const link = document.createElement("a");
                                link.href = $editedImageUrl;
                                link.download = `daydream-image-${Date.now()}.png`;
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                            }}
                        >
                            <span
                                class="material-icons"
                                style="font-size: 16px; margin-right: 4px;"
                                >download</span
                            > Download
                        </button>
                    {:else}
                        <div
                            class="drawing-preview"
                            style="aspect-ratio: {fabricCanvasHTML?.width ||
                                inputCanvas?.width}/{fabricCanvasHTML?.height ||
                                inputCanvas?.height}"
                        >
                            {#if imageData}
                                <img
                                    src={imageData}
                                    alt="Drawing preview"
                                    class="drawing-preview-image"
                                    style="width: 100%; height: 100%; object-fit: contain;"
                                />

                                {#if $isGenerating}
                                    <div class="ai-scanning-animation">
                                        <div class="loader"></div>
                                        <div class="scanning-status">
                                            <h2>Creating</h2>
                                            <div class="dots">
                                                <div class="dot"></div>
                                                <div class="dot"></div>
                                                <div class="dot"></div>
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

<style lang="scss">
    // Styles are unchanged as per instructions.
    #app {
        height: 100vh;
        width: 100%;
        overflow: hidden;
    }

    .loader {
        width: 40px;
        aspect-ratio: 1;
        --c: no-repeat linear-gradient(white 0 0);
        background:
            var(--c) 0 0,
            var(--c) 0 100%,
            var(--c) 50% 0,
            var(--c) 50% 100%,
            var(--c) 100% 0,
            var(--c) 100% 100%;
        background-size: 8px 50%;
        animation: l7-0 1s infinite;
        position: relative;
        overflow: hidden;

        &:before {
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
        16.67% {
            background-size:
                8px 30%,
                8px 30%,
                8px 50%,
                8px 50%,
                8px 50%,
                8px 50%;
        }
        33.33% {
            background-size:
                8px 30%,
                8px 30%,
                8px 30%,
                8px 30%,
                8px 50%,
                8px 50%;
        }
        50% {
            background-size:
                8px 30%,
                8px 30%,
                8px 30%,
                8px 30%,
                8px 30%,
                8px 30%;
        }
        66.67% {
            background-size:
                8px 50%,
                8px 50%,
                8px 30%,
                8px 30%,
                8px 30%,
                8px 30%;
        }
        83.33% {
            background-size:
                8px 50%,
                8px 50%,
                8px 50%,
                8px 50%,
                8px 30%,
                8px 30%;
        }
    }

    @keyframes l7-1 {
        20% {
            left: 0px;
        }
        40% {
            left: calc(50% - 4px);
        }
        60% {
            left: calc(100% - 8px);
        }
        80%,
        100% {
            left: 100%;
        }
    }

    .scanning-status {
        display: none;
        align-items: flex-end;
        justify-content: center;
        gap: 6px;
        height: fit-content;

        h2 {
            font-weight: 700;
            letter-spacing: -0.5px;
            margin: 0 !important;
            line-height: 100%;
        }

        .dots {
            display: flex;
            gap: 2px;
            padding-bottom: 3px;
            .dot {
                width: 4px;
                height: 4px;
                border-radius: 0px;
                background-color: white;
                transition: none;
                animation: dot-animation 1.5s infinite;

                &:nth-child(2) {
                    animation-delay: 0.5s;
                }

                &:nth-child(3) {
                    animation-delay: 1s;
                }
            }
        }
    }

    @keyframes dot-animation {
        0%,
        100% {
            opacity: 1;
        }
        50% {
            opacity: 0;
        }
    }

    .draw-demo-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        box-sizing: border-box;
        height: 90vh;
        width: 100%;
        padding: 20px 0 12px 0;

        .demo-header {
            text-align: center;
            margin-bottom: 8px;

            h1 {
                font-size: 2rem;
                margin-bottom: 0.5rem;
            }

            p {
                font-size: 1rem;
                color: #666;
                margin-bottom: 1rem;
            }

            .bar {
                display: flex;
                align-items: center;
            }

            .context-input-container {
                display: flex;
                align-items: center;
                justify-content: space-between;
                width: 550px;

                border: 1px solid rgba(white, 0.05);
                background: rgba(white, 0);
                border-radius: 32px;
                text-align: center;
                box-shadow: -4px 16px 24px rgba(black, 0.2);
                text-shadow: 0 4px 12px rgba(black, 0.1);

                padding: 6px 6px 6px 16px;

                .context-input {
                    font-family: "Newsreader", "DM Sans", serif;
                    font-size: 16px;
                    font-weight: 650;
                    line-height: 100%;
                    letter-spacing: -0.3px;
                    color: white;
                    background: none;
                    border: none;
                    flex: 1;

                    padding: 2px 0 0 0;

                    &::placeholder {
                        color: rgba(white, 0.3);
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

                .reload-button {
                    margin-left: auto;
                    background: rgba(211, 47, 47, 0.1);
                    border: 1px solid rgba(211, 47, 47, 0.3);
                    color: #d32f2f;
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
                    0%,
                    100% {
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                    }
                    50% {
                        box-shadow: 0 2px 12px rgba(211, 47, 47, 0.3);
                    }
                }
            }
        }

        .generate-button,
        .analyze-button {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            background: #635fff;
            border: none;
            border-radius: 24px;
            padding: 6px 12px 7px 10px;

            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: -4px 12px 16px rgba(black, 0.1);
            position: relative;
            overflow: hidden;
            color: white;

            h3 {
                // /font-family: 'Newsreader', 'DM Sans', serif;
                font-size: 14px;
                font-weight: 600;
                letter-spacing: -0.3px;
            }

            span {
                font-size: 12px !important;
                font-weight: 900;
                color: #6355ff;
                background: white;
                border-radius: 12px;
                padding: 1px;
            }

            &::before {
                content: "";
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: linear-gradient(
                    45deg,
                    rgba(255, 255, 255, 0.1),
                    rgba(255, 255, 255, 0)
                );
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

                span {
                    color: rgba(black, 0.5);
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
                    background: rgba(black, 0.35);
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
                                box-shadow: -2px 8px 12px rgba(black, 0.5);

                                &::after {
                                    content: "";
                                    position: absolute;
                                    top: 0;
                                    left: 0;
                                    width: 100%;
                                    height: 100%;
                                    background: none;
                                    border-radius: 20px;
                                    border: 1.5px solid rgba(white, 0.3);
                                    box-shadow:
                                        inset 1px 2px 3px rgba(white, 0.25),
                                        inset -1px -2px 3px rgba(black, 0.25);
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
                position: relative;
                display: flex;
                justify-content: center;
                align-items: center;
                overflow: visible; // Changed from hidden to visible for Fabric controls
                transition: all 0.3s ease;
                border-radius: 0; // Was 8px, can be 0 if canvas elements themselves have border-radius
                height: auto; // Will be set by JS
                width: auto; // Will be set by JS

                &.input-canvas {
                    // This wrapper contains both fabric and perfect-freehand canvases
                    position: relative;
                    background: white;
                    box-shadow: -12px 32px 32px rgba(black, 0.4);
                    border-radius: 8px;

                    // The aspect ratio classes are kept for reference but actual dimensions
                    // are now handled by the resizeCanvas function
                    &.ratio-1-1, &.ratio-portrait, &.ratio-landscape {
                        // Styles are preserved but dimensions are set programmatically
                    }

                    // New container for canvas overlay
                    .canvas-container-overlay {
                        position: relative;
                        border-radius: 8px;
                        overflow: visible;
                    }

                    .fabric-canvas,
                    .drawing-canvas {
                        border-radius: 8px; // Apply border-radius to canvas elements themselves
                        margin: 0;
                        display: block;
                        object-fit: contain; // Ensure canvas content scales correctly
                        position: absolute;
                        top: 0;
                        left: 0;
                    }

                    .fabric-canvas {
                        z-index: 0; // Lower canvas should be below
                    }

                    .drawing-canvas {
                        // perfect-freehand overlay
                        z-index: 1; // Drawing canvas on top
                        background-color: transparent;
                        cursor: crosshair;
                        // pointer-events will be managed by JS
                    }
                }

                &.output-canvas {
                    min-width: 300px;
                    max-width: 800px;
                    display: none;

                    // Remaining output canvas styles...
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

        &::before,
        &::after {
            content: "";
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
        margin-left: -18px; /* Half the width */
        margin-top: -18px; /* Half the height */
        border: 2px solid var(--element-color);
        background-color: rgba(255, 255, 255, 0.9);
        border-radius: 50%;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 3px 8px rgba(0, 0, 0, 0.2);
        transition:
            transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1),
            box-shadow 0.3s ease;

        &:hover {
            transform: scale(1.15);
            z-index: 5;
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
        }

        /* Different styles based on categories */
        &.human,
        &.animal {
            &::before {
                content: "";
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

        &.building,
        &.landscape {
            &::before {
                content: "";
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
                content: "";
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
            transition:
                opacity 0.2s,
                transform 0.2s;
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
            box-shadow:
                0 0 0 3px rgba(255, 255, 255, 0.9),
                0 0 12px rgba(0, 0, 0, 0.3);
            opacity: 1;
        }

        &::before {
            content: "";
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
            content: "";
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
        0% {
            transform: translate(-50%, -50%) rotate(0deg);
        }
        100% {
            transform: translate(-50%, -50%) rotate(360deg);
        }
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
            font-size: 22px;
            font-weight: 400;
            color: #ccc; // Lighter icon color
            transition:
                color 0.2s,
                background-color 0.2s;
        }

        &:hover {
            background: rgba(white, 0.1);

            span {
                color: #55ff9c;
            }
        }

        &.clear-button {
            background: rgba(red, 0.1);

            span {
                color: red;
                text-shadow: 0 0 2px 2px rgba(black, 1);
            }

            &:hover {
                background: rgba(red, 0.3);

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
                    background-color: #6355ff;
                }

                &:checked + label:before {
                    transform: translateX(18px);
                }

                &:focus + label {
                    box-shadow: 0 0 1px #6355ff;
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
                    background-color: #43a047; /* Green for AI analysis */
                }

                &#stroke-overlay-toggle:checked + label {
                    background-color: #3949ab; /* Blue for Stroke Recognition */
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
            transition: 0.2s ease;
            appearance: none; // Remove default caret
            -webkit-appearance: none;
            -moz-appearance: none;

            option {
                background: #333;
                color: white;
            }

            &:hover {
                background: rgba(black, 0.25);
            }

            &:focus {
                outline: none;
            }
        }
    }
</style>
