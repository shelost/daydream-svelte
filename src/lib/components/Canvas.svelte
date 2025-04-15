<script lang="ts">
  import { onMount, onDestroy, afterUpdate, untrack } from 'svelte';
  import type { Tool, CanvasContent, DrawingContent } from '$lib/types';
  import { updatePageContent, createPage, getPage } from '$lib/supabase/pages';
  import { getStroke } from 'perfect-freehand';
  import { pages, user } from '$lib/stores/appStore';
  import { gsap } from 'gsap';
  import { getSvgPathFromStroke, getPerfectFreehandOptions, isPointInStroke } from '$lib/utils/drawingUtils';
  import ZoomControl from './ZoomControl.svelte';

  // Add an error handler for effect_update_depth_exceeded errors
  if (typeof window !== 'undefined') {
    const originalError = console.error;
    console.error = function(...args) {
      if (args[0] && typeof args[0] === 'string' && args[0].includes('effect_update_depth_exceeded')) {
        console.warn('EFFECT LOOP DETECTED IN CANVAS COMPONENT - Stack trace:');
        console.warn(new Error().stack);
      }
      return originalError.apply(this, args);
    };
  }

  export let pageId: string;
  export let content: CanvasContent;
  export let selectedTool: Tool = 'select';
  export let onSaving: (status: boolean) => void;
  export let onSaveStatus: (status: 'saved' | 'saving' | 'error') => void;

  let canvasEl: HTMLCanvasElement;
  let canvasContainer: HTMLDivElement;
  let canvas: any; // fabric.Canvas
  let saveTimeout: any;
  let fabricLoaded = false;
  let fabricLib: any; // Store the fabric library reference
  let initialized = false; // Flag to track if the canvas has been fully initialized
  let contentLoaded = false; // Track if content has been loaded
  let skipNextViewportSave = false; // Flag to prevent reactivity loops
  let isActivelyDrawing = false; // Flag to track when actively drawing
  let isSaving = false; // Flag to track when saving is in progress

  // Canvas view properties
  let zoom = 1;
  let minZoom = 0.1;
  let maxZoom = 5;
  let zoomStep = 0.1;
  let isPanning = false;

  // Store initial viewport to avoid reactivity loops
  let initialViewport = content?.viewport ? {
    zoom: content.viewport.zoom || 1,
    panX: content.viewport.panX || 0,
    panY: content.viewport.panY || 0
  } : { zoom: 1, panX: 0, panY: 0 };

  // Create a local deep copy of the content to prevent modifying props directly
  let localContent: CanvasContent = content ? JSON.parse(JSON.stringify(content)) : null;

  // Selected object and toolbar state
  let selectedObject: any = null;
  let showToolbar = false;
  let toolbarPosition = { top: 0, left: 0 };
  let objectType = '';

  // Text properties
  let textProps = {
    fontFamily: 'Arial',
    fontSize: 20,
    fontWeight: 'normal',
    fontStyle: 'normal',
    textAlign: 'left',
    underline: false,
    color: '#333333'
  };

  // Shape properties
  let shapeProps = {
    fill: 'rgba(200, 200, 255, 0.3)',
    stroke: '#8888FF',
    strokeWidth: 1,
    opacity: 1
  };

  // Available font families
  const fontFamilies = [
    'Arial',
    'Times New Roman',
    'Courier New',
    'Georgia',
    'Verdana',
    'Helvetica'
  ];

  // Available font sizes
  const fontSizes = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64];

  // Options for perfect-freehand
  const perfectFreehandOptions = {
    size: 8,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5
  };

  // Drawing tool state
  let isCreatingDrawingArea = false;
  let drawingAreaStart = { x: 0, y: 0 };
  let drawingAreaRect: fabric.Rect | null = null;
  let activeDrawingId: string | null = null;
  let activeDrawingReference: any = null;
  let isDrawingMode = false;

  // Default shape styles
  const defaultStyles = {
    rectangle: {
      fill: 'rgba(200, 200, 255, 0.3)',
      stroke: '#8888FF',
      strokeWidth: 1
    },
    circle: {
      fill: 'rgba(200, 255, 200, 0.3)',
      stroke: '#88FF88',
      strokeWidth: 1
    },
    text: {
      fontFamily: 'Arial',
      fontSize: 20,
      fill: '#333333'
    },
    welcomeText: {
      fontFamily: 'Arial',
      fontSize: 32,
      fill: '#666666',
      fontWeight: 'bold',
      textAlign: 'center',
      originX: 'center',
      originY: 'center'
    }
  };

  // Helper function to safely clone objects without preserving reactivity
  function safeClone(obj: any) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
  }

  onMount(async () => {
    try {
      // Dynamically import fabric.js
      const { fabric } = await import('fabric');
      fabricLib = fabric;
      fabricLoaded = true;

      if (!canvasEl) {
        console.error('Canvas element is not defined');
        return;
      }

      // Check parent element before initializing
      if (!canvasContainer) {
        console.error('Canvas container is not defined');
        return;
      }

      console.log('Initializing canvas with dimensions:',
                 canvasContainer.clientWidth, canvasContainer.clientHeight);

      // Initialize the canvas
      canvas = new fabric.Canvas(canvasEl, {
        backgroundColor: '#ffffff',
        width: canvasContainer.clientWidth || 800,
        height: canvasContainer.clientHeight || 600,
        preserveObjectStacking: true,
        selection: true,
        centeredScaling: true,
        stopContextMenu: true,
        fireRightClick: true
      });

      // Set initial zoom from initial viewport (not from content directly)
      // Apply directly to canvas without going through applyZoom
      zoom = initialViewport.zoom || 1;
      canvas.setZoom(zoom);

      // Set initial position if available
      if (initialViewport.panX !== undefined && initialViewport.panY !== undefined) {
        canvas.viewportTransform[4] = initialViewport.panX;
        canvas.viewportTransform[5] = initialViewport.panY;
      }

      // Render once after all changes
      canvas.renderAll();

      // Use untrack to break the initialization chain
      untrack(() => {
        if (content && !localContent) {
          localContent = safeClone(content);
        }
      });

      // Load the saved content
      if (localContent && Object.keys(localContent).length > 0) {
        // Use untrack to prevent loops during initial content loading
        untrack(() => {
          const restoreViewport = localContent.viewport;

          // Set a flag to avoid saving during the initial load
          skipNextViewportSave = true;

          try {
            // Load canvas objects without triggering reactivity
            canvas.loadFromJSON(localContent, () => {
              // After loading canvas, setup objects
              canvas.forEachObject((obj: fabric.Object) => {
                // Setup objects without triggering reactivity
                if (obj.data?.type === 'drawing') {
                  createDrawingObject(obj);
                }
              });

              // Set viewport after loading, still within untrack
              if (restoreViewport) {
                zoom = restoreViewport.zoom || 1;
                canvas.setViewportTransform([
                  zoom, 0, 0, zoom,
                  restoreViewport.panX || 0,
                  restoreViewport.panY || 0
                ]);
              }

              canvas.renderAll();
              contentLoaded = true;
              initialized = true;
            });
          } catch (error) {
            console.error('Error loading canvas content:', error);
            contentLoaded = true;
            initialized = true;
          }
        });
      } else {
        // No content to load, just mark as initialized
        contentLoaded = true;
        initialized = true;
      }

      // Set up event handlers
      setupEventHandlers(fabric);
      setupObjectSelectionHandlers();

      // Set up wheel zoom handler
      canvasContainer.addEventListener('wheel', handleWheel, { passive: false });

      // Set up resize handler
      window.addEventListener('resize', handleResize);

      // Update tool mode for initial setup
      updateToolMode();

      // Initial render
      canvas.renderAll();

      // Add debug mouse click handler to canvas container
      canvasContainer.addEventListener('click', (e) => {
        console.log('Container clicked at:', e.clientX, e.clientY);
        console.log('Current tool:', selectedTool);
      });

      // After a short delay, mark initialization as complete
      setTimeout(() => {
        // Mark initialization as complete to prevent reactive loops
        initialized = true;
        console.log('Canvas initialization complete');
      }, 500);
    } catch (error) {
      console.error('Error initializing canvas:', error);
      initialized = true; // Ensure we don't block future operations
      contentLoaded = true;
    }

    return () => {
      // Cleanup canvas
      if (canvas) {
        canvas.dispose();
      }
      if (canvasContainer) {
        canvasContainer.removeEventListener('wheel', handleWheel);
        canvasContainer.removeEventListener('click', () => {});
      }
      window.removeEventListener('resize', handleResize);
    };
  });

  // Function to add a default welcome text to the center of canvas
  function addDefaultWelcomeText(fabric) {
    if (!canvas) return;

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    const welcomeText = new fabric.IText('hello there', {
      left: canvasWidth / 2,
      top: canvasHeight / 2,
      ...defaultStyles.welcomeText
    });

    canvas.add(welcomeText);
    canvas.renderAll();

    // Save the initial state
    autoSave();
  }

  afterUpdate(() => {
    if (canvas) {
      updateToolMode();
    }
  });

  onDestroy(() => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    if (canvasContainer) {
      canvasContainer.removeEventListener('wheel', handleWheel);
    }
    window.removeEventListener('resize', handleResize);
  });

  // Set up handlers for object selection to show the toolbar
  function setupObjectSelectionHandlers() {
    if (!canvas) return;

    canvas.on('selection:created', handleObjectSelected);
    canvas.on('selection:updated', handleObjectSelected);
    canvas.on('selection:cleared', () => {
      selectedObject = null;
      showToolbar = false;
    });

    // When objects are modified, update toolbar properties
    canvas.on('object:modified', () => {
      if (selectedObject) {
        updateToolbarProperties();
      }
      autoSave();
    });
  }

  // Handle when an object is selected
  function handleObjectSelected(options) {
    const activeObject = canvas.getActiveObject();
    if (!activeObject) {
      showToolbar = false;
      return;
    }

    selectedObject = activeObject;

    // Determine object type
    if (activeObject.type === 'i-text' || activeObject.type === 'text') {
      objectType = 'text';
    } else if (activeObject.type === 'rect') {
      objectType = 'rectangle';
    } else if (activeObject.type === 'circle') {
      objectType = 'circle';
    } else if (activeObject.type === 'path') {
      objectType = 'path';
    } else {
      objectType = activeObject.type;
    }

    // Update toolbar properties based on selected object
    updateToolbarProperties();

    // Position toolbar at the top of the canvas
    toolbarPosition = {
      top: 16,
      left: canvas.width / 2
    };

    showToolbar = true;
  }

  // Update toolbar properties based on the selected object
  function updateToolbarProperties() {
    if (!selectedObject) return;

    if (objectType === 'text' || objectType === 'i-text') {
      textProps = {
        fontFamily: selectedObject.fontFamily,
        fontSize: selectedObject.fontSize,
        fontWeight: selectedObject.fontWeight,
        fontStyle: selectedObject.fontStyle,
        textAlign: selectedObject.textAlign,
        underline: selectedObject.underline,
        color: selectedObject.fill
      };
    } else {
      shapeProps = {
        fill: selectedObject.fill,
        stroke: selectedObject.stroke,
        strokeWidth: selectedObject.strokeWidth,
        opacity: selectedObject.opacity
      };
    }
  }

  // Apply text property changes to the selected object
  function applyTextProperties(prop, value) {
    if (!selectedObject || !canvas) return;

    // Update the object with new properties
    selectedObject.set(prop, value);
    canvas.renderAll();
    autoSave();

    // Update our toolbar state
    textProps[prop] = value;
  }

  // Apply shape property changes to the selected object
  function applyShapeProperties(prop, value) {
    if (!selectedObject || !canvas) return;

    // Update the object with new properties
    selectedObject.set(prop, value);
    canvas.renderAll();
    autoSave();

    // Update our toolbar state
    shapeProps[prop] = value;
  }

  function setupEventHandlers(fabric) {
    if (!canvas || !fabric) {
      console.error('Cannot setup event handlers - canvas or fabric is undefined');
      return;
    }

    // Clear any existing event handlers to prevent duplication
    canvas.off('mouse:down');

    // Add console log to verify handler is being set up
    console.log('Setting up event handlers for tool:', selectedTool);

    // Mouse down event
    canvas.on('mouse:down', async (event) => {
      isActivelyDrawing = true; // Set flag to prevent reactivity loops

      if (selectedTool === 'draw' && !isCreatingDrawingArea && !activeDrawingId) {
        // Start creating drawing area
        isCreatingDrawingArea = true;
        const pointer = canvas.getPointer(event.e);
        drawingAreaStart = { x: pointer.x, y: pointer.y };

        // Create a rectangle to represent the drawing area
        drawingAreaRect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 0,
          height: 0,
          fill: 'rgba(200, 200, 255, 0.2)',
          stroke: '#8888FF',
          strokeWidth: 1,
          selectable: false,
          evented: false
        });

        canvas.add(drawingAreaRect);
        canvas.renderAll();
      } else if (selectedTool === 'draw' && activeDrawingId && activeDrawingReference) {
        // We're already in drawing mode, handle this in the drawing object
      }
    });

    // Mouse move event
    canvas.on('mouse:move', (event) => {
      if (selectedTool === 'draw' && isCreatingDrawingArea && drawingAreaRect) {
        const pointer = canvas.getPointer(event.e);

        // Update rectangle dimensions
        const width = pointer.x - drawingAreaStart.x;
        const height = pointer.y - drawingAreaStart.y;

        // Use untrack to prevent reactivity issues when modifying objects
        untrack(() => {
          drawingAreaRect.set({
            width: width,
            height: height
          });
        });

        canvas.renderAll();
      }
    });

    // Mouse up event
    canvas.on('mouse:up', async (event) => {
      // Handle mouse up logic
      try {
        if (selectedTool === 'draw' && isCreatingDrawingArea && drawingAreaRect) {
          const pointer = canvas.getPointer(event.e);

          // Finish creating drawing area
          isCreatingDrawingArea = false;

          // Make sure the rectangle has positive dimensions
          const width = Math.abs(pointer.x - drawingAreaStart.x);
          const height = Math.abs(pointer.y - drawingAreaStart.y);

          // Don't create tiny drawing areas
          if (width < 50 || height < 50) {
            canvas.remove(drawingAreaRect);
            drawingAreaRect = null;
            canvas.renderAll();
            isActivelyDrawing = false; // Reset flag
            return;
          }

          // Position correctly for negative dimensions
          const left = pointer.x < drawingAreaStart.x ? pointer.x : drawingAreaStart.x;
          const top = pointer.y < drawingAreaStart.y ? pointer.y : drawingAreaStart.y;

          untrack(() => {
            drawingAreaRect.set({
              left: left,
              top: top,
              width: width,
              height: height,
              selectable: true
            });
          });

          canvas.renderAll();

          // Create a new drawing page in the database
          try {
            if (!$user) {
              console.error('User not authenticated');
              isActivelyDrawing = false; // Reset flag
              return;
            }

            // Create a new drawing page
            const { data: newDrawing, error } = await createPage(
              $user.id,
              'drawing',
              `Drawing ${Math.floor(Math.random() * 10000)}`,
              {
                strokes: []
              }
            );

            if (error) {
              console.error('Error creating drawing page:', error);
              return;
            }

            if (!newDrawing) {
              console.error('Failed to create drawing page');
              return;
            }

            // Add the new page to our store
            pages.update(currentPages => [...currentPages, newDrawing]);

            // Create a drawing reference for this canvas
            const drawingRef = {
              id: fabricLib.util.uuid(),
              drawing_id: newDrawing.id,
              position: {
                x: left,
                y: top,
                width: width,
                height: height
              },
              isEditing: true
            };

            // Use untrack to prevent reactivity loops when modifying content
            untrack(() => {
              if (!content.drawings) {
                content.drawings = [];
              }
              content.drawings.push(drawingRef);

              // Set the active drawing
              activeDrawingId = newDrawing.id;
              activeDrawingReference = drawingRef;
            });

            // Replace the rectangle with a drawing object
            canvas.remove(drawingAreaRect);
            drawingAreaRect = null;

            // Create a group to represent the drawing area
            createDrawingObject(drawingRef);

            // Enter drawing mode
            enterDrawingMode(drawingRef);

            // Save the canvas state
            autoSave();

          } catch (err) {
            console.error('Error setting up drawing:', err);
            canvas.remove(drawingAreaRect);
            drawingAreaRect = null;
            canvas.renderAll();
          }
        }
      } finally {
        // Always reset the drawing flag when mouse up completes
        isActivelyDrawing = false;
      }
    });

    // Object modified event - save changes
    canvas.on('object:modified', () => {
      // Set the flag to prevent reactivity loops during save
      isActivelyDrawing = true;
      autoSave();
      // Reset the flag after a short delay
      setTimeout(() => {
        isActivelyDrawing = false;
      }, 100);
    });

    // Object added event - save changes
    canvas.on('object:added', (e) => {
      console.log('Object added to canvas:', e.target);
      // Set the flag to prevent reactivity loops during save
      isActivelyDrawing = true;
      autoSave();
      // Reset the flag after a short delay
      setTimeout(() => {
        isActivelyDrawing = false;
      }, 100);
    });

    // Handle keyboard shortcuts
    document.removeEventListener('keydown', handleKeyDown);
    document.addEventListener('keydown', handleKeyDown);
  }

  function handleKeyDown(e) {
    // Only handle if canvas is in focus
    if (!document.activeElement || document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

    // Delete or Backspace to delete selected objects
    if ((e.key === 'Delete' || e.key === 'Backspace') && canvas) {
      const activeObjects = canvas.getActiveObjects();
      if (activeObjects.length > 0) {
        activeObjects.forEach(obj => canvas.remove(obj));
        canvas.discardActiveObject();
        canvas.renderAll();
        autoSave();
      }
    }

    // Ctrl+Z for undo
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && canvas) {
      // Implement undo functionality
      // (requires canvas history implementation)
      // For now, just console log
      console.log('Undo requested - to be implemented');
    }

    // Ctrl+Y or Ctrl+Shift+Z for redo
    if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
        (e.key === 'z' && e.shiftKey && (e.ctrlKey || e.metaKey)) &&
        canvas) {
      // Implement redo functionality
      console.log('Redo requested - to be implemented');
    }

    // Ctrl++ or Ctrl+= to zoom in
    if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey) && canvas) {
      e.preventDefault();
      zoomIn();
    }

    // Ctrl+- to zoom out
    if (e.key === '-' && (e.ctrlKey || e.metaKey) && canvas) {
      e.preventDefault();
      zoomOut();
    }

    // Ctrl+0 to reset zoom
    if (e.key === '0' && (e.ctrlKey || e.metaKey) && canvas) {
      e.preventDefault();
      resetZoom();
    }
  }

  function startDrawingPath(pointer, fabric) {
    console.log('Starting drawing path at', pointer);

    // Don't set drawing mode here, just create a path
    const path = new fabric.Path(`M ${pointer.x} ${pointer.y}`, {
      stroke: '#000000',
      strokeWidth: 3,
      fill: '',
      strokeLineCap: 'round',
      strokeLineJoin: 'round'
    });

    canvas.add(path);
    canvas.setActiveObject(path);
    canvas.renderAll();
    autoSave();
  }

  function createRectangle(pointer, fabric) {
    console.log('Creating rectangle at', pointer);

    const rect = new fabric.Rect({
      left: pointer.x,
      top: pointer.y,
      width: 100,
      height: 100,
      ...defaultStyles.rectangle,
      originX: 'center',
      originY: 'center'
    });

    canvas.add(rect);
    canvas.setActiveObject(rect);
    canvas.renderAll();
    autoSave();
  }

  function createText(pointer, fabric) {
    const text = new fabric.IText('Double-click to edit', {
      left: pointer.x,
      top: pointer.y,
      ...defaultStyles.text,
      originX: 'center',
      originY: 'center'
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    autoSave();
  }

  function createTextWithDefaultMessage(pointer, fabric) {
    console.log('Creating text at', pointer);

    const text = new fabric.IText('hello there', {
      left: pointer.x,
      top: pointer.y,
      ...defaultStyles.text,
      originX: 'center',
      originY: 'center'
    });

    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.renderAll();
    autoSave();
  }

  function updateToolMode() {
    if (!canvas) return;

    // Reset cursor
    canvas.defaultCursor = 'default';

    // Update the canvas mode based on the selected tool
    switch(selectedTool) {
      case 'select':
        canvas.selection = true;
        canvas.getObjects().forEach(obj => {
          if (!isDrawingMode || (obj.data && obj.data.type === 'drawing' && obj.data.referenceId === activeDrawingReference?.id)) {
            obj.selectable = true;
            obj.evented = true;
          }
        });
        break;

      case 'pan':
        canvas.selection = false;
        canvas.getObjects().forEach(obj => {
          obj.selectable = false;
          obj.evented = false;
        });
        canvas.defaultCursor = 'grab';
        break;

      case 'draw':
        canvas.selection = false;
        if (isDrawingMode) {
          // In drawing mode, only the active drawing should be selectable
          canvas.getObjects().forEach(obj => {
            if (obj.data && obj.data.type === 'drawing' && obj.data.referenceId === activeDrawingReference?.id) {
              obj.selectable = true;
              obj.evented = true;
            } else {
              obj.selectable = false;
              obj.evented = false;
            }
          });
          canvas.defaultCursor = 'crosshair';
        } else {
          // Drawing mode is used to create drawing areas
          canvas.getObjects().forEach(obj => {
            obj.selectable = false;
            obj.evented = false;
          });
          canvas.defaultCursor = 'crosshair';
        }
        break;

      case 'text':
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.defaultCursor = 'text';
        canvas.hoverCursor = 'text';
        break;
      case 'polygon':
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
        canvas.hoverCursor = 'crosshair';
        break;
      case 'eraser':
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.defaultCursor = 'not-allowed';
        canvas.hoverCursor = 'not-allowed';
        break;
      default:
        canvas.isDrawingMode = false;
        canvas.selection = true;
        canvas.defaultCursor = 'default';
        canvas.hoverCursor = 'move';
    }

    canvas.renderAll();
  }

  function enablePanMode() {
    if (!canvas) return;

    // Store the initial position
    let isDragging = false;
    let lastPosX;
    let lastPosY;

    canvas.off('mouse:down');
    canvas.off('mouse:move');
    canvas.off('mouse:up');

    canvas.on('mouse:down', function(opt) {
      if (selectedTool !== 'pan') return;
      isActivelyDrawing = true; // Set flag to prevent reactivity loops
      const evt = opt.e;
      isDragging = true;
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;
      canvas.defaultCursor = 'grabbing';
    });

    canvas.on('mouse:move', function(opt) {
      if (selectedTool !== 'pan' || !isDragging) return;
      const evt = opt.e;

      // Use untrack to prevent reactivity when modifying viewport
      untrack(() => {
        const vpt = canvas.viewportTransform;
        vpt[4] += evt.clientX - lastPosX;
        vpt[5] += evt.clientY - lastPosY;
      });

      canvas.requestRenderAll();
      lastPosX = evt.clientX;
      lastPosY = evt.clientY;

      // Save viewport position
      saveViewport();
    });

    canvas.on('mouse:up', function() {
      isDragging = false;
      if (selectedTool === 'pan') {
        canvas.defaultCursor = 'grab';
      }
      // Reset the flag after a short delay
      setTimeout(() => {
        isActivelyDrawing = false;
      }, 100);
    });
  }

  function handleWheel(e) {
    // Only handle wheel events with Ctrl/Cmd key for zooming
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY;

      // Get pointer position before zoom
      const pointer = canvas.getPointer(e);

      // Calculate new zoom level
      let newZoom = zoom;
      if (delta > 0) {
        newZoom = Math.max(minZoom, zoom - zoomStep);
      } else {
        newZoom = Math.min(maxZoom, zoom + zoomStep);
      }

      // Apply zoom centered at pointer position
      zoomToPoint(newZoom, pointer);
    } else if (selectedTool === 'pan' || e.shiftKey) {
      // Pan with wheel or shift+wheel
      e.preventDefault();
      const vpt = canvas.viewportTransform;

      if (e.shiftKey) {
        // Horizontal scroll with shift key
        vpt[4] -= e.deltaY;
      } else {
        // Vertical scroll without shift
        vpt[5] -= e.deltaY;
      }

      canvas.requestRenderAll();
      saveViewport();
    }
  }

  function zoomToPoint(newZoom, point) {
    if (!canvas) return;

    // Temporarily set flag to prevent reactivity loops
    isActivelyDrawing = true;

    // Store old zoom and calculate scale factor
    const oldZoom = zoom;
    const scaleFactor = newZoom / oldZoom;

    // Get viewport transform
    const vpt = canvas.viewportTransform;

    // Calculate new viewport transform
    vpt[0] = newZoom;
    vpt[3] = newZoom;

    // Adjust viewportTransform to zoom around point
    const center = {
      x: point.x / oldZoom,
      y: point.y / oldZoom
    };

    vpt[4] = vpt[4] + center.x * (1 - scaleFactor) * oldZoom;
    vpt[5] = vpt[5] + center.y * (1 - scaleFactor) * oldZoom;

    // Update zoom value and render
    zoom = newZoom;
    canvas.setZoom(newZoom);
    canvas.requestRenderAll();

    // Save viewport state with a flag to prevent redundant updates
    skipNextViewportSave = true;
    saveViewport();

    // Reset flag after zooming is complete (with a small delay to ensure other operations complete)
    setTimeout(() => {
      isActivelyDrawing = false;
    }, 100);
  }

  function applyZoom(newZoom) {
    if (!canvas) return;

    // Prevent redundant updates that could cause loops
    if (zoom === newZoom) return;

    skipNextViewportSave = true;
    zoom = newZoom;
    canvas.setZoom(newZoom);
    canvas.requestRenderAll();

    // Only save viewport if we've completed initialization
    if (initialized && contentLoaded) {
      saveViewport();
    }
  }

  function zoomIn() {
    const newZoom = Math.min(maxZoom, zoom + zoomStep);
    const center = {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
    zoomToPoint(newZoom, center);
  }

  function zoomOut() {
    const newZoom = Math.max(minZoom, zoom - zoomStep);
    const center = {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
    zoomToPoint(newZoom, center);
  }

  function resetZoom() {
    const center = {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
    zoomToPoint(1, center);
  }

  function saveViewport() {
    // Multiple safeguards against initialization loops
    if (!initialized || !contentLoaded || !canvas || !localContent) return;

    // Skip this save if flag is set (prevents recursive updates)
    if (skipNextViewportSave) {
      skipNextViewportSave = false;
      return;
    }

    // Use untrack for all operations to break reactivity chains
    untrack(() => {
      // Create a new viewport object (don't modify existing one)
      const newViewport = {
        zoom,
        panX: canvas.viewportTransform?.[4] || 0,
        panY: canvas.viewportTransform?.[5] || 0
      };

      // Check if values have actually changed
      const currentViewport = localContent?.viewport || {};

      // Use a safe comparison with proper type guards
      if (
        currentViewport.zoom === newViewport.zoom &&
        currentViewport.panX === newViewport.panX &&
        currentViewport.panY === newViewport.panY
      ) {
        return; // No changes, don't trigger updates
      }

      // Update our local content copy instead of the prop directly
      localContent = {
        ...localContent,
        viewport: newViewport
      };

      // Debounce the save to avoid too many calls
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }

      saveTimeout = setTimeout(() => {
        autoSave();
      }, 1000);
    });
  }

  function handleResize() {
    // Add null checks to prevent errors
    if (!canvas || !canvasEl || !canvasContainer) return;

    try {
      // Adjust canvas dimensions to fit parent
      const parentWidth = canvasContainer.clientWidth;
      const parentHeight = canvasContainer.clientHeight;

      canvas.setDimensions({
        width: parentWidth,
        height: parentHeight
      });

      canvas.renderAll();
    } catch (error) {
      console.error('Error resizing canvas:', error);
    }
  }

  // Modified autoSave to be more careful with content updates and break reactivity loops
  function autoSave() {
    // Don't try to save until initialization is complete
    if (!initialized || !contentLoaded || !canvas) return;

    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    isSaving = true; // Set flag to prevent reactivity loops
    onSaving(true);
    onSaveStatus('saving');

    saveTimeout = setTimeout(async () => {
      try {
        // Use untrack to break the reactivity chain
        const canvasJson = untrack(() => canvas.toJSON(['data']));

        // Ensure viewport data is saved
        const viewportData = untrack(() => ({
          zoom,
          panX: canvas.viewportTransform[4],
          panY: canvas.viewportTransform[5]
        }));

        canvasJson.viewport = viewportData;

        // Create a completely new object for the update
        const updatedContent = safeClone(canvasJson);

        // Update database first before triggering reactivity
        const { error } = await updatePageContent(pageId, updatedContent);

        if (error) {
          console.error('Error saving canvas:', error);
          onSaveStatus('error');
        } else {
          // Update local content copy without triggering reactivity loops
          untrack(() => {
            localContent = updatedContent;

            // Update the prop reference only when necessary and after successful save
            // This prevents unnecessary reactivity during normal operations
            if (JSON.stringify(content) !== JSON.stringify(updatedContent)) {
              content = updatedContent;
            }
          });

          onSaveStatus('saved');
        }
      } catch (err) {
        console.error('Unexpected error saving canvas:', err);
        onSaveStatus('error');
      } finally {
        onSaving(false);
        isSaving = false; // Reset flag after saving is complete
      }
    }, 1000);
  }

  // Function to create a drawing object on the canvas
  function createDrawingObject(drawingRef) {
    if (!canvas || !fabricLib) return;

    // Create a group for the drawing
    const group = new fabricLib.Group([], {
      left: drawingRef.position.x,
      top: drawingRef.position.y,
      width: drawingRef.position.width,
      height: drawingRef.position.height,
      originX: 'left',
      originY: 'top',
      selectable: true,
      hasControls: true,
      hasBorders: true,
      data: { type: 'drawing', referenceId: drawingRef.id }
    });

    // Add a background rect
    const rect = new fabricLib.Rect({
      width: drawingRef.position.width,
      height: drawingRef.position.height,
      fill: 'rgba(255, 255, 255, 0.9)',
      stroke: '#8888FF',
      strokeWidth: 1,
      originX: 'left',
      originY: 'top'
    });

    // Add an edit button if not already in edit mode
    const editButton = new fabricLib.Text('Edit Drawing', {
      left: drawingRef.position.width / 2,
      top: drawingRef.position.height / 2,
      fontSize: 16,
      fill: '#4444FF',
      originX: 'center',
      originY: 'center',
      selectable: false,
      fontFamily: 'Arial',
      data: { isEditButton: true }
    });

    group.addWithUpdate(rect);

    if (!drawingRef.isEditing) {
      group.addWithUpdate(editButton);
    }

    // Add custom properties
    group.customDrawingId = drawingRef.drawing_id;
    group.referenceId = drawingRef.id;

    // Add to canvas
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.renderAll();

    // Add a click handler specifically for this drawing object
    group.on('mousedown', function(e) {
      // Check if we're clicking on the edit button
      const target = e.target;
      if (target && target.data && target.data.isEditButton) {
        // Find the drawing reference
        const ref = content.drawings.find(d => d.id === this.referenceId);
        if (ref) {
          // Enter drawing mode
          ref.isEditing = true;
          activeDrawingId = ref.drawing_id;
          activeDrawingReference = ref;
          enterDrawingMode(ref);
          autoSave();
        }
      }
    });

    // Animate the appearance of the drawing object
    gsap.from(group, {
      opacity: 0,
      scale: 0.9,
      duration: 0.3,
      ease: "power2.out"
    });

    return group;
  }

  // Function to enter drawing mode
  async function enterDrawingMode(drawingRef) {
    if (!canvas) return;

    isDrawingMode = true;

    // Find the drawing object on canvas
    const drawingObj = canvas.getObjects().find(obj =>
      obj.data && obj.data.type === 'drawing' && obj.data.referenceId === drawingRef.id
    );

    if (!drawingObj) {
      console.error('Drawing object not found');
      return;
    }

    // Clear any edit button
    drawingObj._objects = drawingObj._objects.filter(obj =>
      !(obj.data && obj.data.isEditButton)
    );

    // Add an exit button
    const exitButton = new fabricLib.Text('Exit Drawing', {
      left: 60,
      top: 20,
      fontSize: 14,
      fill: '#FF4444',
      originX: 'left',
      originY: 'top',
      selectable: false,
      fontFamily: 'Arial',
      data: { isExitButton: true }
    });

    drawingObj.addWithUpdate(exitButton);

    // Disable selection on other objects
    canvas.discardActiveObject();
    canvas.getObjects().forEach(obj => {
      if (obj !== drawingObj) {
        obj.selectable = false;
        obj.evented = false;
      }
    });

    canvas.setActiveObject(drawingObj);
    canvas.renderAll();

    // Load the drawing content
    try {
      const { data, error } = await getPage(drawingRef.drawing_id);

      if (error) {
        console.error('Error loading drawing:', error);
        exitDrawingMode();
        return;
      }

      if (!data || data.type !== 'drawing') {
        console.error('Invalid drawing data');
        exitDrawingMode();
        return;
      }

      // Store the drawing data so we can use it for rendering
      drawingRef.drawingData = data.content;

      // Render existing strokes
      renderDrawingStrokes(drawingObj, data.content);

      // Setup drawing event handlers
      setupDrawingEventHandlers(drawingObj, drawingRef);
    } catch (err) {
      console.error('Error entering drawing mode:', err);
      exitDrawingMode();
    }
  }

  // Function to exit drawing mode
  function exitDrawingMode() {
    if (!canvas) return;

    isDrawingMode = false;

    if (activeDrawingReference) {
      activeDrawingReference.isEditing = false;
    }

    activeDrawingId = null;

    // Re-enable selection on all objects
    canvas.getObjects().forEach(obj => {
      obj.selectable = true;
      obj.evented = true;
    });

    // Find all drawing objects and remove exit buttons, add edit buttons
    canvas.getObjects().forEach(obj => {
      if (obj.data && obj.data.type === 'drawing') {
        // Remove exit button
        obj._objects = obj._objects.filter(child =>
          !(child.data && child.data.isExitButton)
        );

        // Add edit button if it doesn't have one
        const hasEditButton = obj._objects.some(child =>
          child.data && child.data.isEditButton
        );

        if (!hasEditButton) {
          const editButton = new fabricLib.Text('Edit Drawing', {
            left: obj.width / 2,
            top: obj.height / 2,
            fontSize: 16,
            fill: '#4444FF',
            originX: 'center',
            originY: 'center',
            selectable: false,
            fontFamily: 'Arial',
            data: { isEditButton: true }
          });

          obj.addWithUpdate(editButton);
        }
      }
    });

    canvas.renderAll();

    // Save the canvas state
    autoSave();
  }

  // Function to setup drawing event handlers
  function setupDrawingEventHandlers(drawingObj, drawingRef) {
    if (!canvas) return;

    let isDrawing = false;
    let currentStroke = null;
    let isPanning = false;
    let lastPanPoint = null;

    // Get the rect boundaries for the drawing
    const boundingRect = drawingObj._objects.find(obj => obj.type === 'rect');

    // Handle mouse down
    drawingObj.on('mousedown', function(e) {
      if (!isDrawingMode) return;

      // Check if clicking on exit button
      const target = e.target;
      if (target && target.data && target.data.isExitButton) {
        exitDrawingMode();
        return;
      }

      // Handle different tool actions
      switch (selectedTool) {
        case 'draw':
          startDrawing(e);
          break;
        case 'eraser':
          startErasing(e);
          break;
        case 'pan':
          startPanning(e);
          break;
        default:
          // Other tools not implemented yet
          break;
      }
    });

    // Handle mouse move
    drawingObj.on('mousemove', function(e) {
      if (!isDrawingMode) return;

      // Handle different tool actions
      if (isPanning && lastPanPoint) {
        continuePanning(e);
      } else if (isDrawing && currentStroke) {
        continueDrawing(e);
      }
    });

    // Handle mouse up
    drawingObj.on('mouseup', function() {
      if (!isDrawingMode) return;

      if (isPanning) {
        endPanning();
      } else if (isDrawing) {
        finishDrawing();
      }
    });

    // Function to start drawing
    function startDrawing(e) {
      isDrawing = true;

      // Calculate the point relative to the drawing
      const pointer = canvas.getPointer(e.e);
      const x = pointer.x - drawingObj.left;
      const y = pointer.y - drawingObj.top;

      // Check if within bounds
      if (x < 0 || y < 0 || x > boundingRect.width || y > boundingRect.height) {
        isDrawing = false;
        return;
      }

      // Create new stroke
      currentStroke = {
        points: [{ x, y, pressure: 0.5 }],
        color: '#000000', // Default color, can be customized
        size: 3, // Default size, can be customized
        opacity: 1,
        tool: 'pen'
      };
    }

    // Function to continue drawing
    function continueDrawing(e) {
      if (!isDrawing || !currentStroke) return;

      isActivelyDrawing = true; // Set flag to prevent reactivity loops during drawing

      // Calculate the point relative to the drawing
      const pointer = canvas.getPointer(e.e);
      const x = pointer.x - drawingObj.left;
      const y = pointer.y - drawingObj.top;

      // Add point to current stroke
      currentStroke.points.push({ x, y, pressure: 0.5 });

      // Render current stroke
      renderCurrentStroke(drawingObj, currentStroke, drawingRef);
    }

    // Function to finish drawing
    function finishDrawing() {
      if (!isDrawing || !currentStroke) return;

      isDrawing = false;

      // Add the current stroke to drawing data if it's not an eraser stroke
      if (currentStroke.tool !== 'eraser') {
        if (!drawingRef.drawingData) {
          drawingRef.drawingData = { strokes: [] };
        }

        if (!drawingRef.drawingData.strokes) {
          drawingRef.drawingData.strokes = [];
        }

        if (currentStroke.points.length > 1) {
          drawingRef.drawingData.strokes.push(currentStroke);

          // Save the drawing
          saveDrawing(drawingRef);
        }
      } else {
        // Process eraser strokes
        processEraserStroke(drawingObj, currentStroke, drawingRef);
      }

      currentStroke = null;
      isActivelyDrawing = false; // Reset flag after drawing is complete
    }

    // Function to start erasing
    function startErasing(e) {
      isDrawing = true;

      // Calculate the point relative to the drawing
      const pointer = canvas.getPointer(e.e);
      const x = pointer.x - drawingObj.left;
      const y = pointer.y - drawingObj.top;

      // Check if within bounds
      if (x < 0 || y < 0 || x > boundingRect.width || y > boundingRect.height) {
        isDrawing = false;
        return;
      }

      // Create new eraser stroke
      currentStroke = {
        points: [{ x, y, pressure: 0.5 }],
        color: 'rgba(255, 0, 0, 0.2)', // Red for eraser preview
        size: 20, // Larger size for eraser
        opacity: 0.5,
        tool: 'eraser'
      };
    }

    // Function to start panning
    function startPanning(e) {
      isPanning = true;

      // Calculate the point relative to the drawing
      const pointer = canvas.getPointer(e.e);
      lastPanPoint = {
        x: pointer.x,
        y: pointer.y
      };

      // Change cursor
      canvas.defaultCursor = 'grabbing';
      canvas.renderAll();
    }

    // Function to continue panning
    function continuePanning(e) {
      if (!isPanning || !lastPanPoint) return;

      // Calculate the point relative to the drawing
      const pointer = canvas.getPointer(e.e);
      const currentPoint = {
        x: pointer.x,
        y: pointer.y
      };

      // Calculate the difference
      const dx = currentPoint.x - lastPanPoint.x;
      const dy = currentPoint.y - lastPanPoint.y;

      // Update the drawing object position
      drawingObj.left += dx;
      drawingObj.top += dy;
      drawingObj.setCoords();

      // Update last point
      lastPanPoint = currentPoint;

      // Update canvas
      canvas.renderAll();
    }

    // Function to end panning
    function endPanning() {
      isPanning = false;
      lastPanPoint = null;

      // Reset cursor
      canvas.defaultCursor = 'default';
      canvas.renderAll();

      // Update the drawingRef position
      drawingRef.position = {
        x: drawingObj.left,
        y: drawingObj.top,
        width: drawingRef.position.width,
        height: drawingRef.position.height
      };

      // Save the canvas state
      autoSave();
    }
  }

  // Function to render existing strokes
  function renderDrawingStrokes(drawingObj, content) {
    if (!canvas || !fabricLib || !content || !content.strokes) return;

    // Remove any existing stroke paths
    drawingObj._objects = drawingObj._objects.filter(obj =>
      !(obj.data && obj.data.isStroke)
    );

    // Render each stroke
    content.strokes.forEach(stroke => {
      // Skip strokes with less than 2 points
      if (stroke.points.length < 2) return;

      // Map points from our format to perfect-freehand's format [x, y, pressure]
      const points = stroke.points.map(point => [point.x, point.y, point.pressure || 0.5]);

      // Generate perfect-freehand options based on the stroke tool type
      const options = getPerfectFreehandOptions(
        stroke.size,
        stroke.tool === 'highlighter' ? -0.5 : 0.5, // Negative thinning for highlighters
        0.5, // smoothing
        0.5, // streamline
        true, // simulatePressure
        true, // capStart
        true, // capEnd
        0,    // taperStart
        0     // taperEnd
      );

      // Generate the stroke with perfect-freehand
      const freehandStroke = getStroke(points, options);

      // Create path for the stroke
      const path = getSvgPathFromStroke(freehandStroke);

      // Skip if path couldn't be generated
      if (!path) return;

      // Create Fabric.js path object
      const fabricPath = new fabricLib.Path(path, {
        fill: stroke.color,
        opacity: stroke.tool === 'highlighter' ? 0.4 : stroke.opacity, // Highlighters are semi-transparent
        selectable: false,
        evented: false,
        originX: 'left',
        originY: 'top',
        data: { isStroke: true, toolType: stroke.tool }
      });

      drawingObj.addWithUpdate(fabricPath);
    });

    canvas.renderAll();
  }

  // Function to render the current stroke
  function renderCurrentStroke(drawingObj, stroke, drawingRef) {
    if (!canvas || !fabricLib) return;

    // Remove any temporary stroke
    drawingObj._objects = drawingObj._objects.filter(obj =>
      !(obj.data && obj.data.isTemporaryStroke)
    );

    // Skip if points are too few
    if (stroke.points.length < 2) return;

    // Map points from our format to perfect-freehand's format [x, y, pressure]
    const points = stroke.points.map(point => [point.x, point.y, point.pressure || 0.5]);

    // Generate perfect-freehand options based on the stroke tool type
    const options = getPerfectFreehandOptions(
      stroke.size,
      stroke.tool === 'highlighter' ? -0.5 : 0.5, // Negative thinning for highlighters
      0.5, // smoothing
      0.5, // streamline
      true, // simulatePressure
      true, // capStart
      true, // capEnd
      0,    // taperStart
      0     // taperEnd
    );

    // Generate the stroke with perfect-freehand
    const freehandStroke = getStroke(points, options);

    // Create path for the stroke
    const path = getSvgPathFromStroke(freehandStroke);

    // Skip if path couldn't be generated
    if (!path) return;

    // Create Fabric.js path object with appropriate styling based on tool type
    let pathOptions;

    if (stroke.tool === 'eraser') {
      // For eraser preview, show a translucent red path
      pathOptions = {
        fill: 'rgba(255, 0, 0, 0.2)',
        opacity: 0.5,
        selectable: false,
        evented: false,
        originX: 'left',
        originY: 'top',
        data: { isTemporaryStroke: true, toolType: 'eraser' }
      };
    } else if (stroke.tool === 'highlighter') {
      pathOptions = {
        fill: stroke.color,
        opacity: 0.4, // Highlighters are semi-transparent
        selectable: false,
        evented: false,
        originX: 'left',
        originY: 'top',
        data: { isTemporaryStroke: true, toolType: 'highlighter' }
      };
    } else {
      // Regular pen
      pathOptions = {
        fill: stroke.color,
        opacity: stroke.opacity,
        selectable: false,
        evented: false,
        originX: 'left',
        originY: 'top',
        data: { isTemporaryStroke: true, toolType: 'pen' }
      };
    }

    const fabricPath = new fabricLib.Path(path, pathOptions);
    drawingObj.addWithUpdate(fabricPath);
    canvas.renderAll();
  }

  // Function to save the drawing data
  async function saveDrawing(drawingRef) {
    if (!drawingRef || !drawingRef.drawingData || !drawingRef.drawing_id) return;

    try {
      onSaving(true);
      onSaveStatus('saving');

      // Update the drawing page content
      const { error } = await updatePageContent(
        drawingRef.drawing_id,
        drawingRef.drawingData
      );

      if (error) {
        console.error('Error saving drawing:', error);
        onSaveStatus('error');
        return;
      }

      onSaveStatus('saved');
    } catch (err) {
      console.error('Error saving drawing:', err);
      onSaveStatus('error');
    } finally {
      onSaving(false);
    }
  }

  // Add a function to handle eraser in drawing mode
  function processEraserStroke(drawingObj, eraserStroke, drawingRef) {
    if (!eraserStroke || !drawingRef || !drawingRef.drawingData) return;

    // Skip if the drawing doesn't have strokes yet
    if (!drawingRef.drawingData.strokes) {
      drawingRef.drawingData.strokes = [];
      return;
    }

    // The eraser size to use for collision detection
    const eraserSize = eraserStroke.size;

    // Filter out strokes that intersect with the eraser stroke
    const newStrokes = drawingRef.drawingData.strokes.filter(stroke => {
      // Skip tiny strokes
      if (stroke.points.length < 2) return true;

      // Check for intersection with any point in the eraser stroke
      for (const eraserPoint of eraserStroke.points) {
        if (isPointInStroke(eraserPoint, stroke, eraserSize)) {
          return false; // Remove this stroke
        }
      }

      return true; // Keep this stroke
    });

    // If strokes were removed, update the drawing data
    if (newStrokes.length < drawingRef.drawingData.strokes.length) {
      drawingRef.drawingData.strokes = newStrokes;

      // Re-render the strokes
      renderDrawingStrokes(drawingObj, drawingRef.drawingData);

      // Save the drawing
      saveDrawing(drawingRef);
    }
  }

  // Make sure to update tool mode when drawing mode changes
  $: {
    if (canvas && isDrawingMode !== undefined) {
      updateToolMode();
    }
  }

  // Reactive block that manages content updates - replace with this version
  $: {
    if (initialized && contentLoaded && content) {
      // Only process external content changes when they're genuinely different
      untrack(() => {
        const contentStr = JSON.stringify(content);
        const localContentStr = JSON.stringify(localContent);

        if (contentStr !== localContentStr && !isActivelyDrawing && !isSaving) {
          console.log('External content change detected, updating canvas');
          // Set to prevent circular updates
          skipNextViewportSave = true;
          localContent = safeClone(content);

          // Update canvas with new content if necessary
          if (canvas) {
            canvas.clear();
            canvas.loadFromJSON(localContent, () => {
              canvas.forEachObject((obj: fabric.Object) => {
                if (obj.data?.type === 'drawing') {
                  createDrawingObject(obj);
                }
              });

              // Restore viewport
              if (localContent.viewport) {
                zoom = localContent.viewport.zoom || 1;
                canvas.setViewportTransform([
                  zoom, 0, 0, zoom,
                  localContent.viewport.panX || 0,
                  localContent.viewport.panY || 0
                ]);
              }

              canvas.renderAll();
            });
          }
        }
      });
    }
  }
</script>

<div class="canvas-container" bind:this={canvasContainer}>
  <div class="canvas-wrapper">
    <canvas bind:this={canvasEl}></canvas>

    <!-- Tool instructions -->
    {#if selectedTool === 'draw'}
      <div class="instructions">
        Free drawing mode. Click and drag to draw.
      </div>
    {/if}

    {#if selectedTool === 'polygon'}
      <div class="instructions">
        Click to add a rectangle.
      </div>
    {/if}

    {#if selectedTool === 'text'}
      <div class="instructions">
        Click to add text.
      </div>
    {/if}

    {#if selectedTool === 'pan'}
      <div class="instructions">
        Click and drag to pan around the canvas.
      </div>
    {/if}

    {#if selectedTool === 'eraser'}
      <div class="instructions">
        Click on objects to erase them.
      </div>
    {/if}

    <!-- Contextual toolbar for selected objects -->
    {#if showToolbar && selectedObject}
      <div class="object-toolbar" style="top: {toolbarPosition.top}px; left: {toolbarPosition.left}px;">
        {#if objectType === 'text' || objectType === 'i-text'}
          <div class="text-toolbar">
            <select
              value={textProps.fontFamily}
              on:change={(e) => applyTextProperties('fontFamily', e.target.value)}>
              {#each fontFamilies as family}
                <option value={family}>{family}</option>
              {/each}
            </select>

            <select
              value={textProps.fontSize}
              on:change={(e) => applyTextProperties('fontSize', Number(e.target.value))}>
              {#each fontSizes as size}
                <option value={size}>{size}</option>
              {/each}
            </select>

            <div class="toolbar-button-group">
              <button
                class={textProps.fontWeight === 'bold' ? 'active' : ''}
                on:click={() => applyTextProperties('fontWeight', textProps.fontWeight === 'bold' ? 'normal' : 'bold')}
                title="Bold">
                B
              </button>

              <button
                class={textProps.fontStyle === 'italic' ? 'active' : ''}
                on:click={() => applyTextProperties('fontStyle', textProps.fontStyle === 'italic' ? 'normal' : 'italic')}
                title="Italic">
                I
              </button>

              <button
                class={textProps.underline ? 'active' : ''}
                on:click={() => applyTextProperties('underline', !textProps.underline)}
                title="Underline">
                U
              </button>
            </div>

            <div class="toolbar-button-group">
              <button
                class={textProps.textAlign === 'left' ? 'active' : ''}
                on:click={() => applyTextProperties('textAlign', 'left')}
                title="Align Left">
                ←
              </button>

              <button
                class={textProps.textAlign === 'center' ? 'active' : ''}
                on:click={() => applyTextProperties('textAlign', 'center')}
                title="Align Center">
                ↔
              </button>

              <button
                class={textProps.textAlign === 'right' ? 'active' : ''}
                on:click={() => applyTextProperties('textAlign', 'right')}
                title="Align Right">
                →
              </button>
            </div>

            <input
              type="color"
              value={textProps.color}
              on:input={(e) => applyTextProperties('fill', e.target.value)}
              title="Text Color"
            />
          </div>
        {:else}
          <div class="shape-toolbar">
            <input
              type="color"
              value={shapeProps.fill}
              on:input={(e) => applyShapeProperties('fill', e.target.value)}
              title="Fill Color"
            />

            <input
              type="color"
              value={shapeProps.stroke}
              on:input={(e) => applyShapeProperties('stroke', e.target.value)}
              title="Stroke Color"
            />

            <div class="slider-group">
              <label>Stroke:</label>
              <input
                type="range"
                min="0"
                max="20"
                step="0.5"
                value={shapeProps.strokeWidth}
                on:input={(e) => applyShapeProperties('strokeWidth', Number(e.target.value))}
              />
              <span>{shapeProps.strokeWidth}px</span>
            </div>

            <div class="slider-group">
              <label>Opacity:</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={shapeProps.opacity}
                on:input={(e) => applyShapeProperties('opacity', Number(e.target.value))}
              />
              <span>{Math.round(shapeProps.opacity * 100)}%</span>
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Zoom controls -->
    <ZoomControl
      zoom={zoom}
      on:resetZoom={resetZoom}
      on:zoomIn={zoomIn}
      on:zoomOut={zoomOut}
    />
  </div>
</div>

<style lang="scss">
  .canvas-container {
    position: relative;
    flex: 1;
    overflow: hidden;
    background-color: #f0f0f0;
    width: 100%;
    height: 100%;
  }

  .canvas-wrapper {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  canvas {
    width: 100%;
    height: 100%;
    position: relative;
  }

  .instructions {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 8px 16px;
    border-radius: 20px;
    font-size: 14px;
    pointer-events: none;
    z-index: 100;
  }

  .object-toolbar {
    position: absolute;
    transform: translateX(-50%);
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    padding: 8px;
    z-index: 1000;
    min-width: 300px;

    .text-toolbar, .shape-toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    select {
      border: 1px solid #ddd;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 14px;
    }

    input[type="color"] {
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      padding: 0;
      background: none;
    }

    .toolbar-button-group {
      display: flex;
      border: 1px solid #ddd;
      border-radius: 4px;
      overflow: hidden;

      button {
        border: none;
        background: white;
        padding: 4px 8px;
        font-size: 14px;
        cursor: pointer;
        min-width: 32px;

        &:not(:last-child) {
          border-right: 1px solid #ddd;
        }

        &:hover {
          background: #f5f5f5;
        }

        &.active {
          background: #e0e0e0;
          font-weight: bold;
        }
      }
    }

    .slider-group {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;

      label {
        min-width: 60px;
        font-size: 14px;
      }

      input[type="range"] {
        flex: 1;
      }

      span {
        min-width: 40px;
        text-align: right;
        font-size: 14px;
      }
    }
  }

  .zoom-controls {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    align-items: center;
    background: rgba(255, 255, 255, 0.9);
    padding: 4px 8px;
    border-radius: 20px;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
    z-index: 100;
  }

  .zoom-button {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 50%;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;

    &:hover {
      background: rgba(0, 0, 0, 0.1);
    }

    &.reset {
      width: auto;
      border-radius: 14px;
      padding: 0 8px;
      margin-left: 8px;
      font-size: 12px;
    }
  }

  .zoom-text {
    margin: 0 8px;
    font-size: 12px;
    min-width: 40px;
    text-align: center;
  }
</style>