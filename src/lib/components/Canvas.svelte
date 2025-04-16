<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, tick, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { getStroke, type StrokeOptions } from 'perfect-freehand';
  import { writable, type Writable } from 'svelte/store';
  import { gsap } from 'gsap';
  import { pages } from '$lib/stores/pages';
  import type { Tool, CanvasContent, DrawingContent } from '$lib/types';
  import { updatePageContent, createPage, getPage, uploadThumbnail } from '$lib/supabase/pages';
  import { getSvgPathFromStroke } from '$lib/utils/drawingUtils';
  import { user } from '$lib/stores/auth';
  import ZoomControl from './ZoomControl.svelte';

  // After imports and before script code, add a variable for tracking last render time
  let lastRenderTimestamp = 0;
  let renderFlagResetTimeout: ReturnType<typeof setTimeout> | null = null;

  // Props
  export let content: CanvasContent = { objects: [], drawings: [] };
  export let pageId: string = '';
  export let selectedTool: Tool = 'select';
  export let isDrawingMode = false; // Export isDrawingMode
  export let onSaving: (isSaving: boolean) => void = () => {};
  export let onSaveStatus: (status: 'saving' | 'saved' | 'error') => void = () => {};
  export let onToolChange: (tool: Tool) => void = () => {};

  // Expose selected object properties to parent components
  export let selectedObjectType: string | null = null;
  export let selectedObjectId: string | null = null;

  // DOM references
  let canvasEl: HTMLCanvasElement;
  let canvasContainer: HTMLDivElement;

  // Fabric.js references
  let canvas: any = null; // Fabric.Canvas instance
  let fabricLib: any = null; // Fabric.js library
  let fabricLoaded = false;

  // Debug logging - helpful for tracking reactivity issues
  let debugLogging = false;
  function log(...args: any[]) {
    if (debugLogging) console.log(...args);
  }

  // State initialization flags - using let for Svelte reactivity
  let initialized = false;
  let contentLoaded = false;
  let isSaving = false;
  let isActivelyDrawing = false;

  // Prevent loops with explicit flags
  let skipNextViewportSave = false;
  let skipNextContentSave = false;
  let saveTimeout: any = null;

  // Internal non-reactive state copy - critical for loop prevention
  let localContent: any = null;

  // Canvas viewport state
  let zoom = 1;
  const minZoom = 0.1;
  const maxZoom = 5;
  const zoomStep = 0.1;

  // Initial viewport values - can be updated from content prop
  let initialViewport = {
    zoom: 1,
    panX: 0,
    panY: 0
  };

  // Object selection state for displaying toolbar
  let selectedObject: any = null;
  let objectType: string = '';
  let showToolbar = false;
  let toolbarPosition = { top: 0, left: 0 };

  // Update exported properties when selection changes
  $: {
    selectedObjectType = objectType || null;
    selectedObjectId = selectedObject ? getObjectId(selectedObject) : null;
  }

  // Styling presets for toolbar
  const fontFamilies = ['Inter', 'Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
  const fontSizes = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72];

  // Text properties for selected object
  let textProps = {
    fontFamily: 'Inter',
    fontSize: 18,
    fontWeight: 'normal',
    fontStyle: 'normal',
    textAlign: 'left',
    underline: false,
    color: '#333333'
  };

  // Shape properties for selected object
  let shapeProps = {
    fill: '#f0f0f0',
    stroke: '#333333',
    strokeWidth: 1,
    opacity: 1
  };

  // Drawing tool state
  let drawingSettings = {
    color: '#000000',
    size: 3,
    opacity: 1.0,
    smoothing: 0.5,
    streamline: 0.5
  };

  // Drawing area state
  let isCreatingDrawingArea = false;
  let drawingAreaStart = { x: 0, y: 0 };
  let drawingAreaRect: any = null;
  let activeDrawingId: string | null = null;
  let activeDrawingReference: any = null;

  // Default style presets
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
      fontFamily: 'Inter',
      fontSize: 18,
      charSpacing: -20,
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

  // Main component initialization
  onMount(() => {
    const initPromise = async () => {
      try {
        log('Canvas component mounting...');

        // Dynamically import fabric.js to avoid SSR issues
        const { fabric } = await import('fabric');
        fabricLib = fabric;
        fabricLoaded = true;

        // Validate DOM elements
        if (!canvasEl) {
          console.error('Canvas element is not defined');
          return;
        }

        if (!canvasContainer) {
          console.error('Canvas container is not defined');
          return;
        }

        log('Initializing canvas with dimensions:',
          canvasContainer.clientWidth, canvasContainer.clientHeight);

        // Initialize the canvas with proper size and options
        canvas = new fabric.Canvas(canvasEl, {
          backgroundColor: '#ffffff',
          width: canvasContainer.clientWidth || 800,
          height: canvasContainer.clientHeight || 600,
          preserveObjectStacking: true,
          selection: true,
          centeredScaling: true,
          stopContextMenu: true,
          fireRightClick: true,
          // Improve selection behavior
          selectionKey: '', // Allow selection without modifier keys (empty string instead of null)
          selectionColor: 'rgba(65, 105, 225, 0.2)', // Better selection visibility
          selectionLineWidth: 1.5,
          selectionBorderColor: 'rgba(65, 105, 225, 0.75)',
          selectionFullyContained: false,
          // Handle right-click events
          skipTargetFind: false
        });

        // Using untrack for all initialization that shouldn't trigger reactivity
        untrack(() => {
          // Initialize local content from props (if available) to avoid reactivity
          if (content && !localContent) {
            localContent = safeClone(content);

            // Extract viewport settings from content if available
            if (localContent.viewport) {
              initialViewport = {
                zoom: localContent.viewport.zoom || 1,
                panX: localContent.viewport.panX || 0,
                panY: localContent.viewport.panY || 0
              };
            }
          }

          // Set initial zoom from viewport
          zoom = initialViewport.zoom || 1;
          canvas.setZoom(zoom);

          // Set initial position if available
          if (initialViewport.panX !== undefined && initialViewport.panY !== undefined) {
            canvas.viewportTransform[4] = initialViewport.panX;
            canvas.viewportTransform[5] = initialViewport.panY;
          }

          canvas.renderAll();
        });

        // Load saved content (if available)
        if (localContent && Object.keys(localContent).length > 0) {
          await loadCanvasContent(localContent);
        } else {
          // No content to load, just mark as initialized
          contentLoaded = true;
          initialized = true;
        }

        // Set up event handlers
        setupEventHandlers();
        setupSelectionHandlers();

        // Set up wheel zoom handler - this preserves cursor position during zoom
        canvasContainer.addEventListener('wheel', (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY;
            let newZoom = zoom;

            if (delta < 0) {
              // Zoom in
              newZoom = Math.min(maxZoom, zoom + zoomStep);
            } else {
              // Zoom out
              newZoom = Math.max(minZoom, zoom - zoomStep);
            }

            if (newZoom !== zoom) {
              // Get mouse position relative to canvas
              const rect = canvasEl.getBoundingClientRect();
              const point = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
              };

              zoomToPoint(newZoom, point);
            }
          }
        }, { passive: false });

        // Set up resize handler
        window.addEventListener('resize', handleResize);

        // Update tool mode for initial setup
        updateToolMode();

        // Initial render
        canvas.renderAll();

        // After a short delay, mark initialization as complete
        setTimeout(() => {
          initialized = true;
          log('Canvas initialization complete');
        }, 500);
      } catch (error) {
        console.error('Error initializing canvas:', error);
        initialized = true; // Ensure we don't block future operations
        contentLoaded = true;
      }
    };

    return initPromise();
  });

  // Load canvas content with proper untracking to avoid reactivity
  async function loadCanvasContent(contentToLoad: any): Promise<void> {
    if (!canvas || !contentToLoad) return;

    // Use untrack to prevent loops during content loading
    return new Promise<void>((resolve) => {
      untrack(() => {
        // Set a flag to avoid saving during the initial load
        skipNextViewportSave = true;

        try {
          // Load canvas objects without triggering reactivity
          canvas.loadFromJSON(contentToLoad, () => {
            // After loading canvas, setup objects
            canvas.forEachObject((obj: any) => {
              // Setup objects without triggering reactivity
              if (obj.data?.type === 'drawing') {
                setupDrawingObject(obj);
              }
            });

            // Set viewport after loading, still within untrack
            if (contentToLoad.viewport) {
              zoom = contentToLoad.viewport.zoom || 1;
              canvas.setViewportTransform([
                zoom, 0, 0, zoom,
                contentToLoad.viewport.panX || 0,
                contentToLoad.viewport.panY || 0
              ]);
            }

            canvas.renderAll();
            contentLoaded = true;
            initialized = true;
            resolve();
          });
        } catch (error) {
          console.error('Error loading canvas content:', error);
          contentLoaded = true;
          initialized = true;
          resolve();
        }
      });
    });
  }

  onDestroy(() => {
    // Ensure we clean up any remaining resources
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    if (canvasContainer) {
      // We removed the wheel event listener in the onMount cleanup, no need to do it here
    }
    window.removeEventListener('resize', handleResize);
  });

  // ======= EVENT HANDLERS =======

  function setupEventHandlers() {
    if (!canvas || !fabricLib) {
      console.error('Cannot setup event handlers - canvas or fabric is undefined');
      return;
    }

    // Add debug logging
    log('Setting up event handlers for tool:', selectedTool);

    // Remove all existing listeners to avoid duplicates
    canvas.off('mouse:down');
    canvas.off('mouse:move');
    canvas.off('mouse:up');
    canvas.off('mouse:over');
    canvas.off('mouse:out');

    // Set hover cursor for all objects
    canvas.hoverCursor = 'pointer';

    // Add hover effects for objects
    canvas.on('mouse:over', (e: any) => {
      if (e.target && !isActivelyDrawing) {
        // Don't change cursor for drawing objects in drawing mode
        if (isDrawingMode && e.target.data?.type === 'drawing') {
          return;
        }

        // Change cursor based on the type of object
        if (e.target.type === 'i-text' || e.target.type === 'text') {
          canvas.defaultCursor = 'text';
        } else {
          canvas.defaultCursor = 'pointer';
        }

        // Add subtle hover effect if not in drawing mode
        if (!isDrawingMode && e.target.opacity !== undefined) {
          e.target._originalOpacity = e.target.opacity;
          e.target.set('opacity', Math.min(1, e.target.opacity * 1.1));
          canvas.renderAll();
        }
      }
    });

    canvas.on('mouse:out', (e: any) => {
      if (e.target && !isActivelyDrawing) {
        // Reset cursor
        canvas.defaultCursor = 'default';

        // Remove hover effect
        if (!isDrawingMode && e.target._originalOpacity !== undefined) {
          e.target.set('opacity', e.target._originalOpacity);
          delete e.target._originalOpacity;
          canvas.renderAll();
        }
      }
    });

    // Set up tool-specific handlers
    // Based on selected tool, attach appropriate event handlers
    if (selectedTool === 'select') {
      // Keep default selection behavior
      enableSelectMode();
    } else if (selectedTool === 'pan') {
      enablePanMode();
    } else if (selectedTool === 'rectangle') {
      enableRectangleMode();
    } else if (selectedTool === 'text') {
      enableTextMode();
    } else if (selectedTool === 'draw') {
      enableDrawMode();
    } else if (selectedTool === 'eraser') {
      enableEraserMode();
    }

    // Enable common handlers for all modes
    canvas.on('mouse:up', verifySelectionState);
  }

  // Handle keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    // Only handle if canvas is in focus
    if (!document.activeElement ||
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA') return;

    // Delete or Backspace to delete selected objects
    if ((e.key === 'Delete' || e.key === 'Backspace') && canvas) {
      untrack(() => {
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
          activeObjects.forEach((obj: any) => canvas.remove(obj));
          canvas.discardActiveObject();
          canvas.renderAll();
          scheduleAutoSave();
        }
      });
    }

    // Ctrl+Z for undo (not implemented yet)
    if (e.key === 'z' && (e.ctrlKey || e.metaKey) && canvas) {
      log('Undo requested - to be implemented');
    }

    // Ctrl+Y or Ctrl+Shift+Z for redo (not implemented yet)
    if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) ||
        (e.key === 'z' && e.shiftKey && (e.ctrlKey || e.metaKey)) &&
        canvas) {
      log('Redo requested - to be implemented');
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

  // Selection handlers for toolbar
  function setupSelectionHandlers() {
    if (!canvas) return;

    // Add event handlers for object selection
    canvas.on('selection:created', handleObjectSelected);
    canvas.on('selection:updated', handleObjectSelected);
    canvas.on('selection:cleared', handleSelectionCleared);

    // Add mouse up handler to verify selection state
    canvas.on('mouse:up', verifySelectionState);

    // When objects are modified, update toolbar properties
    canvas.on('object:modified', () => {
      if (selectedObject) {
        updateToolbarProperties();
      }
    });

    // Make sure objects are properly selectable
    makeObjectsSelectable();
  }

  // Make all objects selectable with appropriate cursor
  function makeObjectsSelectable() {
    if (!canvas) return;

    canvas.getObjects().forEach((obj: any) => {
      // Don't make drawing objects selectable when in drawing mode
      if (isDrawingMode && obj.data?.type === 'drawing' && obj.data?.referenceId !== activeDrawingReference?.id) {
        return;
      }

      obj.selectable = true;
      obj.evented = true;
      obj.hoverCursor = 'pointer';
    });

    canvas.renderAll();
  }

  // Handle selection cleared event
  function handleSelectionCleared() {
    untrack(() => {
      // Clear selection state
      selectedObject = null;
      objectType = '';
      showToolbar = false;

      logSelectionState('selection:cleared');

      // When selection is cleared, switch back to select tool
      // but only if we're not actively using another tool
      if (!isActivelyDrawing && selectedTool !== 'select'
          && selectedTool !== 'rectangle' && selectedTool !== 'text') {
        setTool('select');
      }
    });
  }

  // Verify our selection state matches Fabric.js state
  function verifySelectionState() {
    if (!canvas) return;

    untrack(() => {
      const activeObject = canvas.getActiveObject();

      // If Fabric.js has no active object but we think we have one, clear our state
      if (!activeObject && selectedObject) {
        console.log('Selection state mismatch detected: Fabric.js has no active object but we do');
        selectedObject = null;
        objectType = '';
        showToolbar = false;

        // Update exported values
        selectedObjectType = null;
        selectedObjectId = null;

        logSelectionState('selection-verification');
      }
      // If Fabric.js has an active object but we don't, update our state
      else if (activeObject && !selectedObject) {
        console.log('Selection state mismatch detected: Fabric.js has active object but we don\'t');
        handleObjectSelected({ target: activeObject });
      }
    });
  }

  // Helper for logging selection state
  function logSelectionState(source: string) {
    const hasActiveObject = canvas ? !!canvas.getActiveObject() : false;
    console.log(`[${source}] Selection state:`, {
      fabricHasActiveObject: hasActiveObject,
      selectedObject: selectedObject ? { type: objectType, id: getObjectId(selectedObject) } : null,
      exported: { type: selectedObjectType, id: selectedObjectId }
    });
  }

  // Handle object selection
  function handleObjectSelected(options: any) {
    // Make sure we have valid input - either options or a target
    const target = options?.target || options?.selected?.[0] || null;

    untrack(() => {
      // Try to get active object from canvas if not provided
      const activeObject = target || (canvas ? canvas.getActiveObject() : null);

      // Handle case where we have no active object
      if (!activeObject) {
        selectedObject = null;
        objectType = '';
        showToolbar = false;
        logSelectionState('handle-selected-no-object');
        return;
      }

      // Set the selected object
      selectedObject = activeObject;

      // Determine object type more carefully
      if (activeObject.type === 'i-text' || activeObject.type === 'text') {
        objectType = 'text';

        // Don't change tool on selection - only on double-click now
        // Keep the select tool for moving text objects
      } else if (activeObject.type === 'rect' && !activeObject.data?.type) {
        // Only treat as rectangle if it's not part of a drawing
        objectType = 'rectangle';

        // Keep the select tool for moving rectangle objects
      } else if (activeObject.type === 'circle') {
        objectType = 'circle';

        // Keep the select tool for moving circle objects
      } else if (activeObject.type === 'path') {
        objectType = 'path';

        // Keep the select tool for moving path objects
      } else if (activeObject.type === 'group' && activeObject.data?.type === 'drawing') {
        objectType = 'drawing';
      } else {
        objectType = activeObject.type;

        // Keep the select tool for moving other objects
      }

      // Log object details for debugging
      logSelectionState('handle-object-selected');

      // Don't show toolbar for drawing objects, they have their own interface
      if (objectType === 'drawing') {
        showToolbar = false;
        return;
      }

      // Update toolbar properties based on selected object
      updateToolbarProperties();

      // Position toolbar at the top of the canvas
      toolbarPosition = {
        top: 16,
        left: canvas ? canvas.width / 2 : 400
      };

      // Force toolbar to show
      showToolbar = true;

      console.log('Object selected:', objectType, 'Toolbar showing:', showToolbar);
    });
  }

  // Helper function to extract object ID
  function getObjectId(obj: any): string {
    if (!obj) return 'Unknown';

    // First check for explicit IDs
    if (obj.id) return obj.id;

    // Check data property which often contains metadata
    if (obj.data) {
      if (obj.data.id) return obj.data.id;
      if (obj.data.referenceId) return obj.data.referenceId;
    }

    // For text objects, use the first 10 chars of text content as identifier
    if (obj.type === 'text' || obj.type === 'i-text') {
      return obj.text ? `${obj.text.substring(0, 10)}...` : 'Text';
    }

    // For objects without explicit IDs, create one based on position
    return `${obj.type}-${Math.round(obj.left || 0)}-${Math.round(obj.top || 0)}`;
  }

  // Update toolbar based on selected object
  function updateToolbarProperties() {
    if (!selectedObject) return;

    untrack(() => {
      if (objectType === 'text' || objectType === 'i-text') {
        // Update text properties
        textProps = {
          fontFamily: selectedObject.fontFamily || 'Arial',
          fontSize: selectedObject.fontSize || 20,
          fontWeight: selectedObject.fontWeight || 'normal',
          fontStyle: selectedObject.fontStyle || 'normal',
          textAlign: selectedObject.textAlign || 'left',
          underline: selectedObject.underline || false,
          color: selectedObject.fill || '#333333'
        };
      } else {
        // Update shape properties
        shapeProps = {
          fill: selectedObject.fill || '#f0f0f0',
          stroke: selectedObject.stroke || '#333333',
          strokeWidth: selectedObject.strokeWidth || 1,
          opacity: selectedObject.opacity || 1
        };
      }
    });
  }

  // Apply text property changes to the selected object
  function applyTextProperties(prop: string, value: any) {
    if (!selectedObject || !canvas) return;

    // Update the object with new properties
    untrack(() => {
      const newProps: {[key: string]: any} = {};
      newProps[prop] = value;
      selectedObject.set(newProps);
      canvas.renderAll();
      scheduleAutoSave();

      // Update our toolbar state
      const textPropsObj: {[key: string]: any} = textProps;
      textPropsObj[prop] = value;
    });
  }

  // Apply shape property changes to the selected object
  function applyShapeProperties(prop: string, value: any) {
    if (!selectedObject || !canvas) return;

    // Update the object with new properties
    untrack(() => {
      const newProps: {[key: string]: any} = {};
      newProps[prop] = value;
      selectedObject.set(newProps);
      canvas.renderAll();
      scheduleAutoSave();

      // Update our toolbar state
      const shapePropsObj: {[key: string]: any} = shapeProps;
      shapePropsObj[prop] = value;
    });
  }

  // ======= TOOLBAR FUNCTIONS =======

  // Create text object
  function createText(pointer: {x: number, y: number}) {
    if (!canvas || !fabricLib) return;

    untrack(() => {
      const text = new fabricLib.IText('Double-click to edit', {
        left: pointer.x,
        top: pointer.y,
        ...defaultStyles.text,
        // Use default origins (top-left) to ensure object appears exactly where clicked
        originX: 'left',
        originY: 'top'
      });

      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.renderAll();

      // Set isActivelyDrawing to false to ensure tool update works
      isActivelyDrawing = false;

      // Change tool to select after creating text
      // This ensures we stay in select mode for moving the text
      // Double-click will be needed to edit
      setTool('select');

      // Manually call handleObjectSelected to update toolbar
      handleObjectSelected({ target: text });

      // For newly created text, automatically enter editing mode
      setTimeout(() => {
        text.enterEditing();

        // Simulate a click to position cursor at the end
        if (text.hiddenTextarea) {
          text.selectAll();
          text.selectionStart = 0;
          text.selectionEnd = text.text.length;
        }
      }, 50);

      // Save changes
      scheduleAutoSave();
    });
  }

  // Create rectangle
  function createRectangle(pointer: {x: number, y: number}) {
    if (!canvas || !fabricLib) return;

    untrack(() => {
      const rect = new fabricLib.Rect({
        left: pointer.x,
        top: pointer.y,
        width: 100,
        height: 100,
        ...defaultStyles.rectangle,
        // Use default origins (top-left) to ensure object appears exactly where clicked
        originX: 'left',
        originY: 'top'
      });

      canvas.add(rect);
      canvas.setActiveObject(rect);
      canvas.renderAll();

      // Set isActivelyDrawing to false to ensure tool update works
      isActivelyDrawing = false;

      // Change tool to select after creating rectangle
      // This ensures we stay in select mode for moving the rectangle
      // Double-click will be needed to edit properties via the toolbar
      setTool('select');

      // Manually call handleObjectSelected to update toolbar
      handleObjectSelected({ target: rect });

      // Save changes
      scheduleAutoSave();
    });
  }

  // Create welcome text (for blank canvas)
  function addDefaultWelcomeText() {
    if (!canvas || !fabricLib) return;

    untrack(() => {
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;

      const welcomeText = new fabricLib.IText('hello there', {
        left: canvasWidth / 2,
        top: canvasHeight / 2,
        ...defaultStyles.welcomeText
      });

      canvas.add(welcomeText);
      canvas.renderAll();

      // Save the initial state
      scheduleAutoSave();
    });
  }

  // ======= TOOL MODE FUNCTIONS =======

  // Update the canvas mode based on the selected tool
  function updateToolMode() {
    if (!canvas) return;

    untrack(() => {
      // Reset cursor
      canvas.defaultCursor = 'default';

      // Update the canvas mode based on the selected tool
      switch(selectedTool) {
        case 'select':
          canvas.selection = true;
          canvas.isDrawingMode = false;
          canvas.getObjects().forEach((obj: any) => {
            if (!isDrawingMode || (obj.data && obj.data.type === 'drawing' && obj.data.referenceId === activeDrawingReference?.id)) {
              obj.selectable = true;
              obj.evented = true;
            }
          });
          break;

        case 'pan':
          canvas.selection = false;
          canvas.isDrawingMode = false;
          canvas.getObjects().forEach((obj: any) => {
            obj.selectable = false;
            obj.evented = false;
          });
          canvas.defaultCursor = 'grab';
          enablePanMode();
          break;

        case 'draw':
          canvas.selection = false;
          canvas.isDrawingMode = false;
          if (isDrawingMode) {
            // In drawing mode, only the active drawing should be selectable
            canvas.getObjects().forEach((obj: any) => {
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
            canvas.getObjects().forEach((obj: any) => {
              obj.selectable = false;
              obj.evented = false;
            });
            canvas.defaultCursor = 'crosshair';
          }
          break;

        case 'text':
          canvas.isDrawingMode = false;
          canvas.selection = false;
          canvas.getObjects().forEach((obj: any) => {
            obj.selectable = true;
            obj.evented = true;
          });
          canvas.defaultCursor = 'text';
          break;

        case 'rectangle':
          canvas.isDrawingMode = false;
          canvas.selection = false;
          canvas.getObjects().forEach((obj: any) => {
            obj.selectable = true;
            obj.evented = true;
          });
          canvas.defaultCursor = 'crosshair';
          break;

        case 'eraser':
          canvas.isDrawingMode = false;
          canvas.selection = false;
          canvas.getObjects().forEach((obj: any) => {
            obj.selectable = true;
            obj.evented = true;
          });
          canvas.defaultCursor = 'not-allowed';
          break;
      }

      canvas.renderAll();
    });
  }

  // Enable panning mode
  function enablePanMode() {
    if (!canvas) return;

    console.log('Enabling pan mode');

    untrack(() => {
      // Store the initial position
      let isDragging = false;
      let lastPosX: number;
      let lastPosY: number;

      // Remove existing handlers
      canvas.off('mouse:down');
      canvas.off('mouse:move');
      canvas.off('mouse:up');

      // Add pan-specific handlers
      canvas.on('mouse:down', function(opt: any) {
        // Only handle pan events when the selected tool is 'pan'
        if (selectedTool !== 'pan') {
          console.log('Pan handler ignoring mouse down - tool is', selectedTool);
          return;
        }

        console.log('Pan mode: mouse down');
        // Set flag to prevent reactivity loops
        isActivelyDrawing = true;
        const evt = opt.e;

        isDragging = true;
        lastPosX = evt.clientX;
        lastPosY = evt.clientY;
        canvas.defaultCursor = 'grabbing';
      });

      canvas.on('mouse:move', function(opt: any) {
        if (selectedTool !== 'pan' || !isDragging) return;

        const evt = opt.e;

        untrack(() => {
          const vpt = canvas.viewportTransform;
          vpt[4] += evt.clientX - lastPosX;
          vpt[5] += evt.clientY - lastPosY;

          lastPosX = evt.clientX;
          lastPosY = evt.clientY;
        });

        canvas.requestRenderAll();
      });

      canvas.on('mouse:up', function() {
        if (selectedTool !== 'pan') return;

        console.log('Pan mode: mouse up');
        isDragging = false;
        canvas.defaultCursor = 'grab';
        canvas.renderAll();

        // Save viewport state with a flag to prevent redundant updates
        skipNextViewportSave = true;
        saveViewport();

        // Reset flag after panning is complete
        setTimeout(() => {
          isActivelyDrawing = false;
        }, 100);
      });
    });
  }

  // ======= ZOOM FUNCTIONS =======

  // Zoom in centered on canvas
  function zoomIn() {
    const newZoom = Math.min(maxZoom, zoom + zoomStep);
    const center = {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
    zoomToPoint(newZoom, center);
  }

  // Zoom out centered on canvas
  function zoomOut() {
    const newZoom = Math.max(minZoom, zoom - zoomStep);
    const center = {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
    zoomToPoint(newZoom, center);
  }

  // Reset zoom to original
  function resetZoom() {
    const center = {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
    zoom = 1;
    canvas.viewportTransform[4] = 0;
    canvas.viewportTransform[5] = 0;
    canvas.setZoom(1);
    canvas.renderAll();

    // Save viewport state - explicitly set skip flag before calling
    skipNextViewportSave = true;
    saveViewport();

    // Reset flag after zooming is complete (with a small delay)
    setTimeout(() => {
      isActivelyDrawing = false;
      skipNextViewportSave = false; // Ensure flag is reset here too
    }, 100);
  }

  // Zoom to a specific point
  function zoomToPoint(newZoom: number, point: {x: number, y: number}) {
    if (!canvas) return;

    // Temporarily set flag to prevent reactivity loops
    isActivelyDrawing = true;

    untrack(() => {
      // Store old zoom and calculate scale factor
      const oldZoom = zoom;

      // Get viewport transform
      const vpt = canvas.viewportTransform;

      // Calculate new viewport transform and scale factor
      const clampedNewZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));
      const scaleFactor = clampedNewZoom / oldZoom;

      vpt[0] = clampedNewZoom;
      vpt[3] = clampedNewZoom;

      // Adjust viewportTransform to zoom around point
      const center = {
        x: (point.x - vpt[4]) / oldZoom,
        y: (point.y - vpt[5]) / oldZoom
      };

      vpt[4] -= center.x * (scaleFactor - 1) * oldZoom;
      vpt[5] -= center.y * (scaleFactor - 1) * oldZoom;

      // Update zoom value and render
      zoom = clampedNewZoom;

      canvas.setZoom(clampedNewZoom);
      canvas.requestRenderAll();

      // Save viewport state - explicitly set skip flag before calling
      skipNextViewportSave = true;
      saveViewport();
    });

    // Reset flag after zooming is complete (with a small delay)
    setTimeout(() => {
      isActivelyDrawing = false;
      skipNextViewportSave = false; // Ensure flag is reset here too
    }, 100);
  }

  // ======= RESIZE HANDLING =======

  // Handle window resize
  function handleResize() {
    // Add null checks to prevent errors
    if (!canvas || !canvasEl || !canvasContainer) return;

    try {
      untrack(() => {
        // Adjust canvas dimensions to fit parent
        const parentWidth = canvasContainer.clientWidth;
        const parentHeight = canvasContainer.clientHeight;

        canvas.setDimensions({
          width: parentWidth,
          height: parentHeight
        });

        canvas.renderAll();
      });
    } catch (error) {
      console.error('Error resizing canvas:', error);
    }
  }

  // ======= VIEWPORT SAVING =======

  // Save viewport state (zoom/pan)
  function saveViewport() {
    // Multiple safeguards against initialization loops
    if (!initialized || !contentLoaded || !canvas || !localContent) return;

    // Skip this save if flag is set
    if (skipNextViewportSave) {
      // DO NOT reset the flag here, let the calling function manage it
      return;
    }

    // Use untrack for all operations to break reactivity chains
    untrack(() => {
      const currentVpt = canvas.viewportTransform;
      const currentZoom = canvas.getZoom(); // Read directly from canvas

      // Create a new viewport object (don't modify existing one)
      const newViewport = {
        zoom: currentZoom,
        panX: currentVpt?.[4] || 0,
        panY: currentVpt?.[5] || 0
      };

      // Check if values have actually changed against the last saved state
      const lastSavedViewport = localContent?.viewport || { zoom: 1, panX: 0, panY: 0 };

      // Use a small tolerance for floating point comparisons
      const zoomChanged = Math.abs(lastSavedViewport.zoom - newViewport.zoom) > 0.001;
      const panXChanged = Math.abs(lastSavedViewport.panX - newViewport.panX) > 0.1;
      const panYChanged = Math.abs(lastSavedViewport.panY - newViewport.panY) > 0.1;

      if (!zoomChanged && !panXChanged && !panYChanged) {
        return; // No significant changes, don't trigger updates
      }

      log('Viewport changed, scheduling save:', newViewport);

      // Update our local content copy
      localContent = {
        ...localContent,
        viewport: newViewport
      };

      // Schedule a save operation
      scheduleAutoSave(newViewport);
    });
  }

  // Schedule an auto-save operation
  function scheduleAutoSave(viewportToSave?: { zoom: number; panX: number; panY: number }) {
    // Don't try to save until initialization is complete
    if (!initialized || !contentLoaded || !canvas) return;

    // Clear any pending save
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      saveTimeout = null;
    }

    // Set flags
    isSaving = true;
    onSaving(true);
    onSaveStatus('saving');

    // Schedule the save
    saveTimeout = setTimeout(() => {
      performSave(viewportToSave);
    }, 1000);
  }

  // Perform the actual save operation
  async function performSave(viewportToSave: { zoom: number; panX: number; panY: number } | undefined) {
    try {
      // Ensure we're not in an inconsistent state
      if (!canvas) {
        isSaving = false;
        onSaving(false);
        onSaveStatus('error');
        return;
      }

      // Get the current selected object before saving (to restore selection after save)
      const activeObject = canvas.getActiveObject();
      let activeObjectId = null;

      if (activeObject) {
        // Store a unique identifier for the active object if possible
        activeObjectId = activeObject.data?.id || (activeObject.id || null);
      }

      // Use untrack to break the reactivity chain
      const canvasJson = untrack(() => canvas.toJSON(['data']));

      // Use the provided viewport data if available, otherwise get current
      const viewportData = viewportToSave || untrack(() => ({
        zoom: canvas.getZoom(),
        panX: canvas.viewportTransform?.[4] || 0,
        panY: canvas.viewportTransform?.[5] || 0
      }));

      canvasJson.viewport = viewportData;

      // Create a completely new object for the update
      const updatedContent = safeClone(canvasJson);

      // Update database
      const { data, error } = await updatePageContent(pageId, updatedContent);

      if (error) {
        console.error('Error saving canvas:', error);
        onSaveStatus('error');
      } else {
        // IMPORTANT: Update local content copy without triggering reactivity loops
        // This prevents the canvas from being reset after save
        untrack(() => {
          localContent = updatedContent;

          // Update the content prop directly to keep it in sync (without reloading canvas)
          // This ensures parent component also has the latest data
          content = data.content || updatedContent;
        });

        // If we had a selected object, try to restore the selection
        if (activeObjectId && canvas) {
          untrack(() => {
            if (activeObject && canvas.contains(activeObject)) {
              // If the original object is still there, re-select it
              canvas.setActiveObject(activeObject);
              canvas.renderAll();

              // Make sure toolbar shows up for this object
              handleObjectSelected({ target: activeObject });
            }
          });
        }

        onSaveStatus('saved');
        log('Canvas saved successfully.');
      }
    } catch (err) {
      console.error('Unexpected error saving canvas:', err);
      onSaveStatus('error');
    } finally {
      // Important: Reset these flags AFTER saving is complete
      isSaving = false;
      onSaving(false);
      saveTimeout = null;
    }
  }

  // ======= DRAWING OBJECT MANAGEMENT =======

  // Create a drawing object on the canvas
  function createDrawingObject(drawingRef: any) {
    if (!canvas || !fabricLib) return null;

    // Use untrack to prevent reactivity
    let group: any;

    untrack(() => {
      // Create a group for the drawing
      group = new fabricLib.Group([], {
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
      group.on('mousedown', function(this: any, e: any) {
        // Check if we're clicking on the edit button
        const target = e.target;
        if (target && target.data && target.data.isEditButton) {
          // Find the drawing reference
          const ref = content.drawings.find(d => d.id === this.referenceId);
          if (ref) {
            // Enter drawing mode
            untrack(() => {
              ref.isEditing = true;
              activeDrawingId = ref.drawing_id;
              activeDrawingReference = ref;
              enterDrawingMode(ref);
              scheduleAutoSave();
            });
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
    });

    return group;
  }

  // Setup a drawing object during canvas loading
  function setupDrawingObject(obj: any) {
    if (!obj || !obj.data || !obj.data.referenceId) return;

    untrack(() => {
      // Find the drawing reference
      const drawingRef = content.drawings?.find(d => d.id === obj.data.referenceId);
      if (!drawingRef) return;

      // Add custom properties
      obj.customDrawingId = drawingRef.drawing_id;
      obj.referenceId = drawingRef.id;

      // Add a click handler specifically for this drawing object
      obj.on('mousedown', function(this: any, e: any) {
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
            scheduleAutoSave();
          }
        }
      });
    });
  }

  // Function to enter drawing mode
  async function enterDrawingMode(drawingRef: any) {
    if (!canvas) return;

    isDrawingMode = true;

    // Find the drawing object on canvas
    const drawingObj = canvas.getObjects().find((obj: any) =>
      obj.data && obj.data.type === 'drawing' && obj.data.referenceId === drawingRef.id
    );

    if (!drawingObj) {
      console.error('Drawing object not found');
      return;
    }

    // Use untrack to prevent reactivity loops when modifying objects
    untrack(() => {
      // Clear any edit button
      drawingObj._objects = drawingObj._objects.filter((obj: any) =>
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
      canvas.getObjects().forEach((obj: any) => {
        if (obj !== drawingObj) {
          obj.selectable = false;
          obj.evented = false;
        }
      });

      canvas.setActiveObject(drawingObj);
      canvas.renderAll();
    });

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
      untrack(() => {
        drawingRef.drawingData = data.content;
      });

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
      untrack(() => {
        activeDrawingReference.isEditing = false;
      });
    }

    activeDrawingId = null;

    // Re-enable selection on all objects
    untrack(() => {
      canvas.getObjects().forEach((obj: any) => {
        obj.selectable = true;
        obj.evented = true;
      });

      // Find all drawing objects and remove exit buttons, add edit buttons
      canvas.getObjects().forEach((obj: any) => {
        if (obj.data && obj.data.type === 'drawing') {
          // Remove exit button
          obj._objects = obj._objects.filter((child: any) =>
            !(child.data && child.data.isExitButton)
          );

          // Add edit button if it doesn't have one
          const hasEditButton = obj._objects.some((child: any) =>
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
    });

    // Save the canvas state
    scheduleAutoSave();
  }

  // Function to render existing strokes
  function renderDrawingStrokes(drawingObj: any, content: any) {
    if (!canvas || !fabricLib || !content || !content.strokes) return;

    // Use untrack to prevent reactivity loops
    untrack(() => {
      // Remove any existing stroke paths
      drawingObj._objects = drawingObj._objects.filter((obj: any) =>
        !(obj.data && obj.data.isStroke)
      );

      // Render each stroke
      content.strokes.forEach((stroke: any) => {
        // Skip strokes with less than 2 points
        if (stroke.points.length < 2) return;

        // Map points to the format expected by perfect-freehand
        const points = stroke.points.map((point: any) =>
          [point.x, point.y, point.pressure || 0.5]
        );

        // Generate perfect-freehand options
        const options = getPerfectFreehandOptions(
          stroke.size,
          stroke.tool === 'highlighter' ? -0.5 : 0.5,
          0.5,
          0.5,
          true,
          true,
          true,
          0,
          0
        );

        // Generate the stroke
        const freehandStroke = getStroke(points, options);

        // Convert to SVG path
        const path = getSvgPathFromStroke(freehandStroke);

        // Skip if path couldn't be generated
        if (!path) return;

        // Create Fabric.js path object
        const fabricPath = new fabricLib.Path(path, {
          fill: stroke.color,
          opacity: stroke.tool === 'highlighter' ? 0.4 : stroke.opacity,
          selectable: false,
          evented: false,
          originX: 'left',
          originY: 'top',
          data: {
            isStroke: true,
            strokeId: stroke.id || fabricLib.util.uuid(),
            toolType: stroke.tool
          }
        });

        drawingObj.addWithUpdate(fabricPath);
      });

      canvas.renderAll();
    });
  }

  // Generate options for perfect-freehand
  function getPerfectFreehandOptions(
    size: number,
    thinning: number,
    smoothing: number,
    streamline: number,
    simulatePressure = true,
    capStart = true,
    capEnd = true,
    taperStart = 0,
    taperEnd = 0
  ): StrokeOptions {
    return {
      size: size || 3,
      thinning: thinning || 0.5,
      smoothing: smoothing || 0.5,
      streamline: streamline || 0.5,
      simulatePressure,
      last: capEnd,
      start: {
        taper: taperStart,
        cap: capStart
      },
      end: {
        taper: taperEnd,
        cap: capEnd
      }
    };
  }

  // Function to save the drawing data
  async function saveDrawing(drawingRef: any) {
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

  // ======= REACTIVITY MANAGEMENT =======

  // Handle content changes and reactivity
  $: {
    if (initialized && contentLoaded && content) {
      untrack(() => {
        // Only process external content changes when they're genuinely different
        // and not during active operations
        const contentStr = JSON.stringify(content);
        const localContentStr = JSON.stringify(localContent);

        if (contentStr !== localContentStr && !isActivelyDrawing && !isSaving) {
          log('External content change detected');

          // Check if this is a complete refresh needed or a minor update
          const currentObjects = canvas ? canvas.getObjects().length : 0;
          const incomingObjectCount = content.objects ? content.objects.length : 0;

          // If objects are similar in count, we can do a more careful update
          // to preserve selection state
          if (Math.abs(currentObjects - incomingObjectCount) <= 1 && canvas) {
            // Save current state
            const activeObject = canvas.getActiveObject();
            let activeObjectId = activeObject ? (activeObject.data?.id || activeObject.id) : null;

            // Update local content reference
            localContent = safeClone(content);

            // Set flag to prevent viewport save
            skipNextViewportSave = true;

            // Don't reload the entire canvas, just update viewport if needed
            if (content.viewport && canvas) {
              zoom = content.viewport.zoom || 1;
              canvas.setViewportTransform([
                zoom, 0, 0, zoom,
                content.viewport.panX || 0,
                content.viewport.panY || 0
              ]);
              canvas.renderAll();
            }

            log('Soft refresh with selection preservation');
          } else {
            log('Full canvas refresh needed');
            // Major change - need full refresh
            // Set to prevent circular updates
            skipNextViewportSave = true;
            localContent = safeClone(content);

            // Update canvas with new content
            if (canvas) {
              canvas.clear();
              canvas.loadFromJSON(localContent, () => {
                canvas.forEachObject((obj: any) => {
                  if (obj.data?.type === 'drawing') {
                    setupDrawingObject(obj);
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
        }
      });
    }
  }

  // Update tool mode when drawing mode changes
  $: {
    if (canvas && isDrawingMode !== undefined) {
      updateToolMode();
    }
  }

  // ======= DRAWING EVENT HANDLERS =======

  // Setup drawing-specific event handlers
  function setupDrawingEventHandlers(drawingObj: any, drawingRef: any) {
    if (!canvas) return;

    let isDrawing = false;
    let currentStroke: any = null;
    let isPanning = false;
    let lastPanPoint: any = null;

    // Get the rect boundaries for the drawing
    const boundingRect = drawingObj._objects.find((obj: any) => obj.type === 'rect');

    // Handle mouse down
    drawingObj.on('mousedown', function(e: any) {
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
    drawingObj.on('mousemove', function(e: any) {
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
    function startDrawing(e: any) {
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
        color: drawingSettings.color,
        size: drawingSettings.size,
        opacity: drawingSettings.opacity,
        tool: 'pen'
      };
    }

    // Function to continue drawing
    function continueDrawing(e: any) {
      if (!isDrawing || !currentStroke) return;

      try {
        // Wrap the whole function in untrack to prevent reactivity issues
        untrack(() => {
          // Calculate the point relative to the drawing
          const pointer = canvas.getPointer(e.e);
          const x = pointer.x - drawingObj.left;
          const y = pointer.y - drawingObj.top;

          // Add point to current stroke
          currentStroke.points.push({ x, y, pressure: 0.5 });
        });

        // Render current stroke - this function now has its own rate limiting
        renderCurrentStroke(drawingObj, currentStroke);
      } catch (error) {
        console.error('Error in continueDrawing:', error);

        // Ensure we don't get stuck in drawing mode on error
        isDrawing = false;
        isActivelyDrawing = false;
      }
    }

    // Function to finish drawing
    function finishDrawing() {
      if (!isDrawing || !currentStroke) return;

      try {
        // First set local flag to prevent any more drawing
        isDrawing = false;

        // Handle according to tool type
        if (currentStroke.tool !== 'eraser') {
          // Only add and save strokes that have meaningful content
          if (currentStroke.points.length > 1) {
            untrack(() => {
              // Initialize drawing data if needed
              if (!drawingRef.drawingData) {
                drawingRef.drawingData = { strokes: [] };
              }

              if (!drawingRef.drawingData.strokes) {
                drawingRef.drawingData.strokes = [];
              }

              // Add the current stroke to the permanent drawing data
              drawingRef.drawingData.strokes.push({...currentStroke}); // Clone to avoid references
            });

            // Save the drawing - outside of untrack to allow saving to work
            saveDrawing(drawingRef);
          }
        } else {
          // Process eraser strokes
          processEraserStroke(drawingObj, currentStroke, drawingRef);
        }
      } catch (error) {
        console.error('Error in finishDrawing:', error);
      } finally {
        // Clear current stroke and reset flags
        currentStroke = null;

        // Let the flag reset happen naturally via timeout in renderCurrentStroke
        // This prevents immediate switching back and possible race conditions
      }
    }

    // Function to start erasing
    function startErasing(e: any) {
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
    function startPanning(e: any) {
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
    function continuePanning(e: any) {
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

      // Update the drawing object position using untrack
      untrack(() => {
        drawingObj.left += dx;
        drawingObj.top += dy;
        drawingObj.setCoords();

        // Update last point
        lastPanPoint = currentPoint;
      });

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

      // Update the drawingRef position using untrack
      untrack(() => {
        drawingRef.position = {
          x: drawingObj.left,
          y: drawingObj.top,
          width: drawingRef.position.width,
          height: drawingRef.position.height
        };
      });

      // Save the canvas state
      scheduleAutoSave();
    }
  }

  // Function to render the current stroke
  function renderCurrentStroke(drawingObj: any, stroke: any) {
    if (!canvas || !fabricLib) return;

    // Early out if needed
    if (!stroke || !stroke.points || stroke.points.length < 2) return;

    // Implement rate limiting - don't re-render too frequently
    const now = Date.now();
    const timeSinceLastRender = now - lastRenderTimestamp;
    if (timeSinceLastRender < 16) { // ~60fps max
      return; // Skip this render cycle
    }

    // Set active drawing flag
    isActivelyDrawing = true;
    lastRenderTimestamp = now;

    try {
      // Use untrack to prevent reactivity loops
      untrack(() => {
        // Remove any temporary stroke
        drawingObj._objects = drawingObj._objects.filter((obj: any) =>
          !(obj.data && obj.data.isTemporaryStroke)
        );

        // Map points to the format expected by perfect-freehand
        const points = stroke.points.map((point: any) =>
          [point.x, point.y, point.pressure || 0.5]
        );

        // Generate perfect-freehand options
        const options = getPerfectFreehandOptions(
          stroke.size,
          stroke.tool === 'highlighter' ? -0.5 : 0.5,
          0.5,
          0.5,
          true,
          true,
          true,
          0,
          0
        );

        // Generate the stroke
        const freehandStroke = getStroke(points, options);

        // Convert to SVG path
        const path = getSvgPathFromStroke(freehandStroke);

        // Skip if path couldn't be generated
        if (!path) return;

        // Create Fabric.js path object with appropriate styling
        let pathOptions: any;

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
      });

      // Render outside of untrack but still rate limited
      canvas.requestRenderAll();

    } catch (error) {
      console.error('Error in renderCurrentStroke:', error);
    }

    // Reset the drawing flag after a short delay
    if (renderFlagResetTimeout) {
      clearTimeout(renderFlagResetTimeout);
    }

    renderFlagResetTimeout = setTimeout(() => {
      isActivelyDrawing = false;
      renderFlagResetTimeout = null;
    }, 100);
  }

  // Helper function for eraser collision detection
  function isPointInStroke(eraserPoint: any, stroke: any, eraserSize: number): boolean {
    // Check if any point in the stroke is within eraser radius
    for (const point of stroke.points) {
      const dx = eraserPoint.x - point.x;
      const dy = eraserPoint.y - point.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // If distance is less than combined radius, collision happened
      if (distance < (eraserSize + (stroke.size || 3)) / 2) {
        return true;
      }
    }
    return false;
  }

  // Function to handle eraser strokes
  function processEraserStroke(drawingObj: any, eraserStroke: any, drawingRef: any) {
    if (!eraserStroke || !drawingRef || !drawingRef.drawingData) return;

    // Skip if the drawing doesn't have strokes yet
    if (!drawingRef.drawingData.strokes) {
      untrack(() => {
        drawingRef.drawingData.strokes = [];
      });
      return;
    }

    // The eraser size to use for collision detection
    const eraserSize = eraserStroke.size;

    // Filter out strokes that intersect with the eraser
    const newStrokes = drawingRef.drawingData.strokes.filter((stroke: any) => {
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
      untrack(() => {
        drawingRef.drawingData.strokes = newStrokes;
      });

      // Re-render the strokes
      renderDrawingStrokes(drawingObj, drawingRef.drawingData);

      // Save the drawing
      saveDrawing(drawingRef);
    }
  }

  // Add a flag to track internal tool changes
  let internalToolChange = false;

  // Set tool function - export to make it accessible to parent components
  export function setTool(tool: Tool) {
    // Set the flag to indicate this is an internal change
    internalToolChange = true;

    console.log('setTool called with:', tool, 'previous tool:', selectedTool);

    // Update the selected tool
    selectedTool = tool;
    isDrawingMode = tool === 'draw';

    // Log for debugging
    log('Tool changed to:', tool, 'isDrawingMode:', isDrawingMode);

    // Update cursor and event handlers
    updateToolMode();
    setupEventHandlers();

    // If canvas is finished loading, save state
    if (canvas && initialized && contentLoaded) {
      saveCanvas();
    }

    // The selectedTool reactive binding will automatically update the parent
    // Additional notification for non-binding scenarios
    onToolChange(tool);

    // Reset the flag after a short delay to allow for Svelte's reactivity to process
    setTimeout(() => {
      internalToolChange = false;
    }, 0);
  }

  // Handler for toolbar tool change events
  // Keep this function for internal use even though the toolbar is now external
  function handleToolChange(event: CustomEvent) {
    const { tool } = event.detail;
    setTool(tool);
  }

  // Export method to save canvas state
  export function saveCanvas() {
    if (initialized && contentLoaded && canvas) {
      scheduleAutoSave();
    }
  }

  // Add a reactive statement to handle selectedTool changes from external sources
  $: if (initialized && canvas && selectedTool && !internalToolChange) {
    console.log('Canvas component detected external selectedTool change:', selectedTool);
    // Update tool mode and reattach handlers
    updateToolMode();
    setupEventHandlers();
  }

  // Reset active drawing flag to clear state
  function resetActiveDrawingFlag() {
    if (renderFlagResetTimeout) {
      clearTimeout(renderFlagResetTimeout);
    }

    renderFlagResetTimeout = setTimeout(() => {
      isActivelyDrawing = false;
    }, 50);
  }

  // Enable select mode handlers
  function enableSelectMode() {
    if (!canvas) return;

    // Reset cursor
    canvas.defaultCursor = 'default';

    // Make all objects selectable except for drawing objects when in drawing mode
    makeObjectsSelectable();

    // Mouse down in select mode
    canvas.on('mouse:down', (event: any) => {
      // Just track for debugging
      isActivelyDrawing = true;
      console.log('Select mode: mouse down');

      // If clicking on an object, we don't need to do anything special
      // Fabric.js will handle the selection

      // Reset flag for reactivity
      resetActiveDrawingFlag();
    });

    // Add double-click handler for text editing
    canvas.on('mouse:dblclick', (event: any) => {
      if (!event.target) return;

      // Handle double-click on text objects
      if (event.target.type === 'i-text' || event.target.type === 'text') {
        console.log('Double-click on text object');

        // Enter editing mode directly
        event.target.enterEditing();
        canvas.renderAll();
      }
    });

    // Additional handler for exiting text editing
    canvas.on('text:editing:exited', (e: any) => {
      console.log('Text editing exited');

      // Schedule save after text editing
      scheduleAutoSave();
    });

    // Handle object modification
    canvas.on('object:modified', (e: any) => {
      console.log('Object modified:', e.target?.type);

      // Set flag to false after completion
      isActivelyDrawing = false;

      // Save changes
      scheduleAutoSave();
    });
  }

  // Enable rectangle creation mode
  function enableRectangleMode() {
    if (!canvas) return;

    // Set cursor
    canvas.defaultCursor = 'crosshair';

    // Make objects selectable
    makeObjectsSelectable();

    // Mouse down in rectangle mode
    canvas.on('mouse:down', (event: any) => {
      // Set flag to prevent reactivity loops
      isActivelyDrawing = true;

      // Only create rectangle when clicking on empty canvas
      if (event.target) {
        // If clicking on an existing object, select it and change to select tool
        setTool('select');
        isActivelyDrawing = false;
        return;
      }

      // Create rectangle at click point
      const pointer = canvas.getPointer(event.e);
      console.log('Creating rectangle at:', pointer.x, pointer.y);
      createRectangle(pointer);
    });
  }

  // Enable text creation mode
  function enableTextMode() {
    if (!canvas) return;

    // Set cursor
    canvas.defaultCursor = 'text';

    // Make objects selectable
    makeObjectsSelectable();

    // Mouse down in text mode
    canvas.on('mouse:down', (event: any) => {
      // Set flag to prevent reactivity loops
      isActivelyDrawing = true;

      // Only create text when clicking on empty canvas
      if (event.target) {
        // If clicking on an existing object, select it and change to select tool
        setTool('select');
        isActivelyDrawing = false;
        return;
      }

      // Create text at click point
      const pointer = canvas.getPointer(event.e);
      console.log('Creating text at:', pointer.x, pointer.y);
      createText(pointer);
    });
  }

  // Enable draw mode
  function enableDrawMode() {
    if (!canvas) return;

    // Set cursor
    canvas.defaultCursor = 'crosshair';

    // In draw mode, make most objects non-selectable except drawing objects
    canvas.getObjects().forEach((obj: any) => {
      if (obj.data?.type === 'drawing') {
        obj.selectable = true;
        obj.evented = true;
      } else {
        obj.selectable = false;
        obj.evented = false;
      }
    });

    canvas.renderAll();

    // Mouse down in draw mode
    canvas.on('mouse:down', (event: any) => {
      // Set flag to prevent reactivity loops
      isActivelyDrawing = true;

      // If we're already editing a drawing, ignore
      if (isDrawingMode) {
        isActivelyDrawing = false;
        return;
      }

      // If clicking on a drawing object, enter drawing mode for it
      if (event.target && event.target.data?.type === 'drawing') {
        console.log('Clicking on drawing object, enter drawing mode');

        // Find the drawing reference for this object
        const drawingRef = content.drawings?.find((d: any) =>
          d.id === event.target.data.referenceId
        );

        if (drawingRef) {
          // Enter drawing mode for this drawing
          enterDrawingMode(drawingRef);
        }

        isActivelyDrawing = false;
        return;
      }

      // If not already creating a drawing area, start creating one
      if (!isCreatingDrawingArea && !activeDrawingId) {
        // Start creating drawing area
        isCreatingDrawingArea = true;
        const pointer = canvas.getPointer(event.e);
        drawingAreaStart = { x: pointer.x, y: pointer.y };

        // Create a rectangle to represent the drawing area
        untrack(() => {
          drawingAreaRect = new fabricLib.Rect({
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
        });
      }
    });

    // Mouse move in draw mode
    canvas.on('mouse:move', (event: any) => {
      // Drawing area sizing logic
      if (isCreatingDrawingArea && drawingAreaRect) {
        const pointer = canvas.getPointer(event.e);

        // Update rectangle dimensions
        const width = pointer.x - drawingAreaStart.x;
        const height = pointer.y - drawingAreaStart.y;

        // Use untrack to prevent reactivity issues when modifying objects
        untrack(() => {
          if (drawingAreaRect) {
            drawingAreaRect.set({
              width: width,
              height: height
            });
            canvas.renderAll();
          }
        });
      }
    });

    // Mouse up in draw mode
    canvas.on('mouse:up', async (event: any) => {
      try {
        // Drawing area finalization logic
        if (isCreatingDrawingArea && drawingAreaRect) {
          // Finish creating drawing area
          isCreatingDrawingArea = false;
          const pointer = canvas.getPointer(event.e);

          // Make sure the rectangle has positive dimensions
          const width = Math.abs(pointer.x - drawingAreaStart.x);
          const height = Math.abs(pointer.y - drawingAreaStart.y);

          // Don't create tiny drawing areas
          if (width < 50 || height < 50) {
            untrack(() => {
              if (drawingAreaRect) {
                canvas.remove(drawingAreaRect);
                drawingAreaRect = null;
                canvas.renderAll();
              }
            });
            isActivelyDrawing = false; // Reset flag
            return;
          }

          // Position correctly for negative dimensions
          const left = pointer.x < drawingAreaStart.x ? pointer.x : drawingAreaStart.x;
          const top = pointer.y < drawingAreaStart.y ? pointer.y : drawingAreaStart.y;

          untrack(() => {
            if (drawingAreaRect) {
              drawingAreaRect.set({
                left: left,
                top: top,
                width: width,
                height: height,
                selectable: true
              });
              canvas.renderAll();
            }
          });

          // Create a new drawing page in the database
          try {
            if (!$user) {
              console.error('User not authenticated');
              isActivelyDrawing = false;
              return;
            }

            // Create a new drawing page
            const { data: newDrawing, error } = await createPage(
              $user.id,
              'drawing',
              `Drawing ${Math.floor(Math.random() * 10000)}`,
              { strokes: [] }
            );

            if (error) {
              console.error('Error creating drawing page:', error);
              isActivelyDrawing = false; // Make sure to reset flag
              return;
            }

            if (!newDrawing) {
              console.error('Failed to create drawing page');
              isActivelyDrawing = false; // Make sure to reset flag
              return;
            }

            // Add the new page to our store
            pages.update((currentPages: any[]) => [...currentPages, newDrawing]);

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

              // Remove placeholder rectangle
              if (drawingAreaRect) {
                canvas.remove(drawingAreaRect);
                drawingAreaRect = null;
              }

              // Create the drawing object
              const group = createDrawingObject(drawingRef);

              // Enter drawing mode
              enterDrawingMode(drawingRef);

              // Save the canvas state
              scheduleAutoSave();
            });
          } catch (err) {
            console.error('Error setting up drawing:', err);
            untrack(() => {
              if (drawingAreaRect) {
                canvas.remove(drawingAreaRect);
                drawingAreaRect = null;
                canvas.renderAll();
              }
            });
            isActivelyDrawing = false; // Make sure to reset flag
          }
        } else {
          // For other mouse up events, just reset the flag
          isActivelyDrawing = false;
        }
      } finally {
        // Always reset the drawing flag when mouse up completes
        isActivelyDrawing = false;
      }
    });
  }

  // Enable eraser mode
  function enableEraserMode() {
    if (!canvas) return;

    // Set cursor
    canvas.defaultCursor = 'not-allowed';

    // Make all objects selectable
    makeObjectsSelectable();

    // Mouse down in eraser mode
    canvas.on('mouse:down', (event: any) => {
      // Set flag to prevent reactivity loops
      isActivelyDrawing = true;

      // Handle eraser functionality - only work when clicking on an object
      if (event.target) {
        untrack(() => {
          console.log('Erasing object:', event.target.type);
          canvas.remove(event.target);
          canvas.renderAll();

          // Save after erasing
          scheduleAutoSave();
        });
      }

      // Reset flag for reactivity
      resetActiveDrawingFlag();
    });
  }

  // Save canvas content to database
  async function saveCanvasContent(shouldGenerateThumbnail = false) {
    if (!pageId || !$user || !initialized || !contentLoaded) return false;

    try {
      // Set saving state
      isSaving = true;
      onSaving(true);
      onSaveStatus('saving');

      // Export canvas content as JSON
      const data = canvas.toJSON(['id', 'data']);

      // Add viewport data to content
      const viewportData = {
        zoom: zoom || 1,
        panX: canvas.viewportTransform ? canvas.viewportTransform[4] : 0,
        panY: canvas.viewportTransform ? canvas.viewportTransform[5] : 0,
      };

      const contentToSave = {
        ...data,
        viewport: viewportData
      };

      // Update local reference
      localContent = safeClone(contentToSave);

      // Save to database
      const { error } = await updatePageContent(pageId, contentToSave);

      if (error) {
        console.error('Error saving canvas:', error);
        onSaveStatus('error');
        return false;
      }

      // Generate and upload thumbnail if requested
      if (shouldGenerateThumbnail && canvas) {
        await generateThumbnail();
      }

      return true;
    } catch (err) {
      console.error('Error saving canvas:', err);
      onSaveStatus('error');
      return false;
    } finally {
      // Update save status
      isSaving = false;
      onSaving(false);
      onSaveStatus('saved');
    }
  }

  // Debounced version of the save function to prevent too many saves
  function saveDebouncedContent() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveCanvasContent(true); // Generate thumbnail on debounced save
    }, 2000); // 2 second debounce
  }

  // Content update handler
  function handleContentUpdated() {
    log('Content updated - should save');

    if (!pageId || !$user || !initialized || !contentLoaded) return;

    // Skip if this update is from loading initial content
    if (skipNextContentSave) {
      skipNextContentSave = false;
      return;
    }

    // Schedule a save
    saveDebouncedContent();
  }

  // Exported function to trigger thumbnail generation from parent components
  export function generateThumbnail() {
    if (!canvas || !pageId) return;

    try {
      console.log("Starting Canvas thumbnail generation...");

      // Create a new Fabric StaticCanvas for the thumbnail
      const thumbnailWidth = 320;
      const thumbnailHeight = 180;
      const thumbnailCanvas = document.createElement('canvas');
      thumbnailCanvas.width = thumbnailWidth;
      thumbnailCanvas.height = thumbnailHeight;

      // Create a fabric static canvas for the thumbnail
      const thumbnailFabricCanvas = new fabric.StaticCanvas(thumbnailCanvas, {
        width: thumbnailWidth,
        height: thumbnailHeight,
        backgroundColor: '#ffffff'
      });

      // Get visible objects
      const visibleObjects = canvas.getObjects().filter((obj: any) => obj.visible !== false);

      if (visibleObjects.length > 0) {
        // Calculate bounds to get proper scaling
        const bounds = calculateContentBounds(visibleObjects);

        // Add padding (10%)
        const padding = 0.1;
        const paddedWidth = (bounds.maxX - bounds.minX) * (1 + padding);
        const paddedHeight = (bounds.maxY - bounds.minY) * (1 + padding);

        // Calculate scale to fit the content
        const scaleX = thumbnailWidth / paddedWidth;
        const scaleY = thumbnailHeight / paddedHeight;
        const scale = Math.min(scaleX, scaleY);

        // Calculate offsets to center content
        const offsetX = (thumbnailWidth / scale - (bounds.maxX - bounds.minX)) / 2 - bounds.minX;
        const offsetY = (thumbnailHeight / scale - (bounds.maxY - bounds.minY)) / 2 - bounds.minY;

        // Clone objects to the thumbnail canvas
        visibleObjects.forEach((obj: any) => {
          try {
            // Clone the object
            const clonedObj = fabric.util.object.clone(obj);

            // Make it non-interactive
            clonedObj.selectable = false;
            clonedObj.evented = false;

            // Add it to the thumbnail canvas
            thumbnailFabricCanvas.add(clonedObj);
          } catch (err) {
            console.error("Error cloning object for thumbnail:", err);
          }
        });

        // Set viewport transform
        thumbnailFabricCanvas.setViewportTransform([
          scale, 0, 0, scale,
          offsetX * scale, offsetY * scale
        ]);

        // Render the thumbnail
        thumbnailFabricCanvas.renderAll();
      } else {
        // Render fallback
        renderFallbackThumbnail(thumbnailFabricCanvas);
      }

      // Convert to blob and upload
      return new Promise<void>((resolve) => {
        thumbnailCanvas.toBlob(async (blob) => {
          if (blob) {
            try {
              const result = await uploadThumbnail(pageId, blob);
              console.log("Canvas thumbnail uploaded successfully", result);

              // Cleanup
              thumbnailFabricCanvas.dispose();

              resolve();
            } catch (err) {
              console.error("Error uploading canvas thumbnail:", err);
              thumbnailFabricCanvas.dispose();
              resolve();
            }
          } else {
            console.error("Failed to create blob from thumbnail canvas");
            thumbnailFabricCanvas.dispose();
            resolve();
          }
        }, 'image/png', 0.8);
      });
    } catch (err) {
      console.error("Error in thumbnail generation:", err);
    }
  }

  // Render fallback thumbnail for empty canvas
  function renderFallbackThumbnail(fabricCanvas: fabric.StaticCanvas) {
    // Clear the canvas
    fabricCanvas.clear();

    // Set background color
    fabricCanvas.setBackgroundColor('#f5f5f5', fabricCanvas.renderAll.bind(fabricCanvas));

    // Create centered text
    const titleText = new fabric.Text('Canvas Preview', {
      left: fabricCanvas.width / 2,
      top: fabricCanvas.height / 2 + 20,
      fontFamily: 'Arial',
      fontSize: 14,
      fill: '#666666',
      textAlign: 'center',
      originX: 'center',
      originY: 'center'
    });

    // Create an icon
    const icon = new fabric.Text('dashboard', {
      left: fabricCanvas.width / 2,
      top: fabricCanvas.height / 2 - 15,
      fontFamily: 'Material Icons',
      fontSize: 30,
      fill: '#cccccc',
      textAlign: 'center',
      originX: 'center',
      originY: 'center'
    });

    // Add the elements to the canvas
    fabricCanvas.add(icon, titleText);
    fabricCanvas.renderAll();
  }

  // Helper function to calculate content bounds
  function calculateContentBounds(objects: any[]) {
    // Default bounds - use canvas dimensions as fallback
    const bounds = {
      minX: Infinity,
      minY: Infinity,
      maxX: -Infinity,
      maxY: -Infinity
    };

    // Calculate combined bounds of all objects
    for (const obj of objects) {
      // Skip objects without position
      if (typeof obj.left !== 'number' || typeof obj.top !== 'number') continue;

      let objWidth = 100; // Default width
      let objHeight = 100; // Default height

      // Determine object dimensions based on type
      if (obj.type === 'textbox' || obj.type === 'i-text') {
        // For text, use the width and height
        objWidth = obj.width || (obj.getScaledWidth ? obj.getScaledWidth() : 100);
        objHeight = obj.height || (obj.getScaledHeight ? obj.getScaledHeight() : 20);
      } else if (obj.type === 'image') {
        // For images, use image dimensions
        objWidth = obj.width || (obj.getScaledWidth ? obj.getScaledWidth() : 100);
        objHeight = obj.height || (obj.getScaledHeight ? obj.getScaledHeight() : 100);
      } else {
        // For other objects, use width/height or calculate from bounding rect
        objWidth = obj.width || (obj.getScaledWidth ? obj.getScaledWidth() : 100);
        objHeight = obj.height || (obj.getScaledHeight ? obj.getScaledHeight() : 100);
      }

      // Calculate object bounds with rotation
      const angle = obj.angle || 0;
      const points = [
        { x: obj.left, y: obj.top },
        { x: obj.left + objWidth, y: obj.top },
        { x: obj.left + objWidth, y: obj.top + objHeight },
        { x: obj.left, y: obj.top + objHeight }
      ];

      const originX = obj.left + (objWidth / 2);
      const originY = obj.top + (objHeight / 2);

      // Apply rotation to each point
      for (const point of points) {
        const rotated = rotatePoint(point, { x: originX, y: originY }, angle);
        bounds.minX = Math.min(bounds.minX, rotated.x);
        bounds.minY = Math.min(bounds.minY, rotated.y);
        bounds.maxX = Math.max(bounds.maxX, rotated.x);
        bounds.maxY = Math.max(bounds.maxY, rotated.y);
      }
    }

    // If no valid bounds were calculated, use fallback values
    if (bounds.minX === Infinity || bounds.minY === Infinity ||
        bounds.maxX === -Infinity || bounds.maxY === -Infinity) {
      return {
        minX: 0,
        minY: 0,
        maxX: canvas.width || 800,
        maxY: canvas.height || 600
      };
    }

    return bounds;
  }

  // Helper function to rotate a point around an origin
  function rotatePoint(point: {x: number, y: number}, origin: {x: number, y: number}, angle: number) {
    const angleRad = (angle * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);

    // Translate point to origin
    const x = point.x - origin.x;
    const y = point.y - origin.y;

    // Rotate and translate back
    return {
      x: x * cos - y * sin + origin.x,
      y: x * sin + y * cos + origin.y
    };
  }

  // Helper function to render an object to the thumbnail context
  function renderObjectToContext(ctx: CanvasRenderingContext2D, obj: any) {
    try {
      // Skip invisible objects
      if (obj.visible === false) return;

      // Draw based on object type
      if (obj.type === 'textbox' || obj.type === 'i-text') {
        // Text object
        ctx.save();

        // Apply rotation if needed
        if (obj.angle) {
          const centerX = obj.left + obj.width / 2;
          const centerY = obj.top + obj.height / 2;
          ctx.translate(centerX, centerY);
          ctx.rotate((obj.angle * Math.PI) / 180);
          ctx.translate(-centerX, -centerY);
        }

        // Set text properties
        ctx.font = `${obj.fontStyle || ''} ${obj.fontWeight || ''} ${obj.fontSize || 16}px ${obj.fontFamily || 'Arial'}`;
        ctx.fillStyle = obj.fill || '#000000';
        ctx.textAlign = obj.textAlign || 'left';

        // Draw text
        ctx.fillText(obj.text || '', obj.left, obj.top + obj.fontSize);

        ctx.restore();
      } else if (obj.type === 'rect') {
        // Rectangle
        ctx.save();

        // Apply rotation if needed
        if (obj.angle) {
          const centerX = obj.left + obj.width / 2;
          const centerY = obj.top + obj.height / 2;
          ctx.translate(centerX, centerY);
          ctx.rotate((obj.angle * Math.PI) / 180);
          ctx.translate(-centerX, -centerY);
        }

        // Set fill and stroke
        ctx.fillStyle = obj.fill || 'rgba(0,0,0,0)';
        ctx.strokeStyle = obj.stroke || '#000000';
        ctx.lineWidth = obj.strokeWidth || 1;

        // Draw rectangle
        ctx.fillRect(obj.left, obj.top, obj.width, obj.height);
        if (obj.strokeWidth > 0) {
          ctx.strokeRect(obj.left, obj.top, obj.width, obj.height);
        }

        ctx.restore();
      } else if (obj.type === 'circle') {
        // Circle
        ctx.save();

        const centerX = obj.left + obj.radius;
        const centerY = obj.top + obj.radius;

        // Apply rotation if needed
        if (obj.angle) {
          ctx.translate(centerX, centerY);
          ctx.rotate((obj.angle * Math.PI) / 180);
          ctx.translate(-centerX, -centerY);
        }

        // Set fill and stroke
        ctx.fillStyle = obj.fill || 'rgba(0,0,0,0)';
        ctx.strokeStyle = obj.stroke || '#000000';
        ctx.lineWidth = obj.strokeWidth || 1;

        // Draw circle
        ctx.beginPath();
        ctx.arc(centerX, centerY, obj.radius, 0, 2 * Math.PI);
        ctx.fill();
        if (obj.strokeWidth > 0) {
          ctx.stroke();
        }

        ctx.restore();
      } else if (obj.type === 'path') {
        // Path object (like freehand drawing)
        ctx.save();

        // Apply transformation
        if (obj.angle) {
          const centerX = obj.left + obj.width / 2;
          const centerY = obj.top + obj.height / 2;
          ctx.translate(centerX, centerY);
          ctx.rotate((obj.angle * Math.PI) / 180);
          ctx.translate(-centerX, -centerY);
        }

        // Set path properties
        ctx.strokeStyle = obj.stroke || '#000000';
        ctx.lineWidth = obj.strokeWidth || 1;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Draw path
        if (obj.path) {
          ctx.beginPath();

          // Fabric.js paths are complex - this is a simplified version
          const path = obj.path;
          let first = true;

          for (let i = 0; i < path.length; i++) {
            const item = path[i];
            if (!item || !Array.isArray(item) || item.length === 0) continue;

            const cmd = item[0]; // Command is the first element of the array

            if (cmd === 'M') { // Move to
              ctx.moveTo(item[1] + obj.left, item[2] + obj.top);
              first = false;
            } else if (cmd === 'L') { // Line to
              ctx.lineTo(item[1] + obj.left, item[2] + obj.top);
            } else if (cmd === 'Q') { // Quadratic curve
              ctx.quadraticCurveTo(
                item[1] + obj.left, item[2] + obj.top,
                item[3] + obj.left, item[4] + obj.top
              );
            } else if (cmd === 'C') { // Cubic curve
              ctx.bezierCurveTo(
                item[1] + obj.left, item[2] + obj.top,
                item[3] + obj.left, item[4] + obj.top,
                item[5] + obj.left, item[6] + obj.top
              );
            }
          }

          // Apply fill and stroke
          if (obj.fill && obj.fill !== 'rgba(0,0,0,0)') {
            ctx.fillStyle = obj.fill;
            ctx.fill();
          }

          ctx.stroke();
        }

        ctx.restore();
      } else if (obj.type === 'image') {
        // For images, we can't directly render them
        ctx.save();

        // Apply rotation if needed
        if (obj.angle) {
          const centerX = obj.left + obj.width / 2;
          const centerY = obj.top + obj.height / 2;
          ctx.translate(centerX, centerY);
          ctx.rotate((obj.angle * Math.PI) / 180);
          ctx.translate(-centerX, -centerY);
        }

        // Draw a placeholder rectangle
        ctx.strokeStyle = '#cccccc';
        ctx.lineWidth = 1;
        ctx.strokeRect(obj.left, obj.top, obj.width, obj.height);

        // Add an image icon
        ctx.fillStyle = '#999999';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Draw a simple icon instead of emoji
        drawImageIcon(ctx, obj.left + obj.width / 2, obj.top + obj.height / 2);

        ctx.restore();
      }
      // Add more object type handlers as needed
    } catch (err) {
      console.error("Error rendering object to thumbnail:", err);
    }
  }

  // Helper function to draw an image icon
  function drawImageIcon(ctx: CanvasRenderingContext2D, x: number, y: number) {
    // Save current context state
    ctx.save();

    // Use Material Icons for the image icon
    ctx.font = '16px "Material Icons"';
    ctx.fillStyle = '#999999';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('image', x, y);

    // Restore context state
    ctx.restore();
  }
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

<div class="canvas-container" bind:this={canvasContainer}>
  <div class="canvas-wrapper">
    <canvas bind:this={canvasEl}></canvas>

    <!-- Tool instructions -->
    {#if selectedTool === 'draw'}
      <div class="instructions">
        Free drawing mode. Click and drag to create a drawing area.
      </div>
    {/if}

    {#if selectedTool === 'rectangle'}
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

    <!-- Drawing mode instruction -->
    {#if isDrawingMode}
      <div class="instructions">
        Drawing mode active. Use tools to draw within the drawing area.
      </div>
    {/if}

    <!-- Loading indicator -->
    {#if !contentLoaded}
      <div class="loading-indicator">
        <div class="spinner"></div>
        <div>Loading canvas...</div>
      </div>
    {/if}

    <!-- Zoom control -->
    <ZoomControl
      {zoom}
      on:resetZoom={resetZoom}
      on:zoomIn={zoomIn}
      on:zoomOut={zoomOut}
    />

    <!-- Selected Object Info -->
    {#if selectedObject}
      <div class="object-info" transition:slide={{ duration: 300, easing: cubicOut }}>
        <div class="info-title">Selected Object</div>
        <div class="info-row">
          <span class="info-label">Type:</span>
          <span class="info-value">{objectType}</span>
        </div>
        <div class="info-row">
          <span class="info-label">ID:</span>
          <span class="info-value">{getObjectId(selectedObject)}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Position:</span>
          <span class="info-value">x: {Math.round(selectedObject.left || 0)}, y: {Math.round(selectedObject.top || 0)}</span>
        </div>
        {#if selectedObject.width !== undefined && selectedObject.height !== undefined}
          <div class="info-row">
            <span class="info-label">Size:</span>
            <span class="info-value">{Math.round(selectedObject.width || 0)} × {Math.round(selectedObject.height || 0)}</span>
          </div>
        {/if}
      </div>
    {:else}
      <div class="object-info" transition:slide={{ duration: 300, easing: cubicOut }}>
        <div class="info-title">Active Tool</div>
        <div class="info-row">
          <span class="info-label">Tool:</span>
          <span class="info-value tool-value">{selectedTool}</span>
        </div>
        {#if isDrawingMode}
          <div class="info-row">
            <span class="info-label">Mode:</span>
            <span class="info-value">Drawing</span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Contextual toolbar for selected objects -->
    {#if selectedObject}
      <div
        class="object-toolbar"
        style="top: {toolbarPosition.top}px; left: {toolbarPosition.left}px;"
        transition:slide={{ duration: 300, easing: cubicOut }}
        class:visible={showToolbar}
      >
        {#if objectType === 'text' || objectType === 'i-text'}
          <div class="text-toolbar">
            <select
              value={textProps.fontFamily}
              on:change={(e) => applyTextProperties('fontFamily', (e.target as HTMLSelectElement)?.value)}>
              {#each fontFamilies as family}
                <option value={family}>{family}</option>
              {/each}
            </select>

            <select
              value={textProps.fontSize}
              on:change={(e) => applyTextProperties('fontSize', Number((e.target as HTMLSelectElement)?.value))}>
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
                <span class="material-icons">format_align_left</span>
              </button>
              <button
                class={textProps.textAlign === 'center' ? 'active' : ''}
                on:click={() => applyTextProperties('textAlign', 'center')}
                title="Align Center">
                <span class="material-icons">format_align_center</span>
              </button>
              <button
                class={textProps.textAlign === 'right' ? 'active' : ''}
                on:click={() => applyTextProperties('textAlign', 'right')}
                title="Align Right">
                <span class="material-icons">format_align_right</span>
              </button>
            </div>

            <div class="color-picker">
              <input
                type="color"
                value={textProps.color}
                on:input={(e) => applyTextProperties('fill', (e.target as HTMLInputElement)?.value)}
                title="Text Color"
              />
            </div>
          </div>
        {:else}
          <div class="shape-toolbar">
            <div class="color-picker">
              <input
                type="color"
                value={shapeProps.fill}
                on:input={(e) => applyShapeProperties('fill', (e.target as HTMLInputElement)?.value)}
                title="Fill Color"
              />
            </div>
            <div class="color-picker">
              <input
                type="color"
                value={shapeProps.stroke}
                on:input={(e) => applyShapeProperties('stroke', (e.target as HTMLInputElement)?.value)}
                title="Stroke Color"
              />
            </div>
            <div class="range-slider">
              <label>Stroke width:</label>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                value={shapeProps.strokeWidth}
                on:input={(e) => applyShapeProperties('strokeWidth', Number((e.target as HTMLInputElement)?.value))}
              />
              <span>{shapeProps.strokeWidth}px</span>
            </div>
            <div class="range-slider">
              <label>Opacity:</label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={shapeProps.opacity}
                on:input={(e) => applyShapeProperties('opacity', Number((e.target as HTMLInputElement)?.value))}
              />
              <span>{Math.round(shapeProps.opacity * 100)}%</span>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .canvas-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #f5f5f5;
    display: flex;

    .canvas-wrapper {
      position: relative;
      flex: 1;
      height: 100%;
    }

    canvas {
      position: absolute;
      top: 0;
      left: 0;
    }

    .instructions {
      position: absolute;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 14px;
      pointer-events: none;
      z-index: 100;
    }

    .loading-indicator {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;

      .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid rgba(0, 0, 0, 0.1);
        border-top-color: #3498db;
        border-radius: 50%;
        animation: spin 1s ease-in-out infinite;
      }
    }

    .object-toolbar {
      position: absolute;
      background: white;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
      padding: 16px;
      z-index: 100;
      transform: translateX(-50%);
      /* Remove these properties as we're using Svelte's slide transition */
      /* opacity: 0;
      transition: opacity 0.2s ease-out, transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      transform: translateX(-50%) translateY(-10px); */

      /* Base transform to center horizontally */
      transform: translateX(-50%);

      /* Better border and modern styling */
      border: 1px solid rgba(0, 0, 0, 0.08);
      backdrop-filter: blur(4px);

      &.visible {
        /* We don't need these with Svelte transitions */
        /* opacity: 1;
        transform: translateX(-50%) translateY(0); */
      }

      /* Rest of the styling remains the same */
      .text-toolbar, .shape-toolbar {
        display: flex;
        gap: 12px;
        align-items: center;

        select {
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid #ddd;
        }

        .toolbar-button-group {
          display: flex;
          gap: 2px;

          button {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f5f5f5;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-weight: bold;
            cursor: pointer;

            &.active {
              background: #e0e0e0;
              border-color: #aaa;
            }

            &:hover {
              background: #e9e9e9;
            }
          }
        }

        .color-picker {
          input {
            width: 32px;
            height: 32px;
            padding: 0;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
          }
        }

        .range-slider {
          display: flex;
          align-items: center;
          gap: 8px;

          label {
            font-size: 12px;
            white-space: nowrap;
          }

          input {
            width: 100px;
          }

          span {
            font-size: 12px;
            width: 36px;
          }
        }
      }
    }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .object-info {
    position: fixed;
    top: 15px;
    left: 50%;
    transform: translateX(-50%);
    background: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
    padding: 10px 15px;
    z-index: 100;
    font-size: 13px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    max-width: 300px;
    backdrop-filter: blur(4px);
    display: none;
    flex-direction: column;
    gap: 4px;
  }

  .info-title {
    font-weight: 600;
    margin-bottom: 5px;
    color: #333;
    font-size: 14px;
    border-bottom: 1px solid #eee;
    padding-bottom: 5px;
  }

  .info-row {
    display: flex;
    margin-bottom: 2px;
    align-items: center;
    font-size: 12px;
  }

  .info-label {
    font-weight: 500;
    min-width: 60px;
    color: #666;
  }

  .info-value {
    color: #333;
    word-break: break-word;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: 'Roboto Mono', monospace, system-ui;
    background: #f8f8f8;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 11px;
  }

  .tool-value {
    color: #333;
    font-weight: bold;
  }
</style>