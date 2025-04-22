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

  // Create event dispatcher
  const dispatch = createEventDispatcher();

  // Type definition for the fabric library
  interface FabricLib {
    fabric: {
      Canvas: any;
      StaticCanvas: any;
      Rect: any;
      Circle: any;
      IText: any;
      Text: any;
      Group: any;
      Line: any;
      Path: any;
      Object: any;
      util: any;
    };
  }

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
  // Export zoom property
  export let zoom = 1;

  // Expose selected object properties to parent components
  export let selectedObjectType: string | null = null;
  export let selectedObjectId: string | null = null;

  // DOM references
  let canvasEl: HTMLCanvasElement;
  let canvasContainer: HTMLDivElement;

  // Fabric.js references
  let canvas: any = null; // Fabric.Canvas instance
  let fabricLib: FabricLib | null = null; // Fabric.js library
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
    // Make sure we explicitly set selectedObjectType based on objectType
    selectedObjectType = objectType || null;

    // Also set the ID if available
    selectedObjectId = selectedObject ? getObjectId(selectedObject) : null;

    // More detailed logging about what is being exported
    console.log('Canvas exporting object info:', {
      objectType,
      selectedObjectType,
      selectedObjectId,
      hasObject: !!selectedObject
    });

    // Dispatch selection change event to parent component
    dispatch('selectionChange', {
      object: selectedObject,
      objects: selectedObject ? [selectedObject] : [],
      type: selectedObjectType
    });
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
      fill: '#333333',
      scaleX: 1,
      scaleY: 1,
      originX: 'left',
      originY: 'top',
      textAlign: 'left',
      padding: 0 // Add padding to improve bounding box consistency
    },
    welcomeText: {
      fontFamily: 'Arial',
      fontSize: 32,
      fill: '#666666',
      fontWeight: 'bold',
      textAlign: 'center',
      originX: 'center',
      originY: 'center',
      scaleX: 1,
      scaleY: 1,
      padding: 0 // Add padding to improve bounding box consistency
    }
  };

  // Helper function to safely clone objects without preserving reactivity
  function safeClone(obj: any) {
    if (!obj) return obj;
    return JSON.parse(JSON.stringify(obj));
  }

  // Configure initial fabric settings
  function setupFabricGlobals(fabricLib: any) {
    if (!fabricLib) return;

    // Configure global object caching settings for better rendering consistency
    fabricLib.fabric.Object.prototype.objectCaching = true;

    // Increase cache dimensions for better quality
    fabricLib.fabric.Object.prototype.cacheProperties =
      fabricLib.fabric.Object.prototype.cacheProperties.concat([
        'strokeWidth', 'strokeDashArray', 'fontSize', 'fontFamily', 'charSpacing'
      ]);

    // Set higher dirty rendering tolerance to force more re-renders
    fabricLib.fabric.Object.prototype.statefullCache = true;
    fabricLib.fabric.Object.prototype.noScaleCache = false;

    // Ensure text objects use consistent scaling behavior
    fabricLib.fabric.IText.prototype.lockScalingFlip = true;

    // Improve text metrics calculation
    fabricLib.fabric.Text.prototype.dynamicMinWidth = true;
  }

  // Main component initialization
  onMount(async () => {
    const initPromise = async () => {
      try {
        log('Canvas component mounting...');

        // Import fabric.js dynamically to ensure it's only loaded on the client
        if (!fabricLib) {
          try {
            fabricLib = await import('fabric');
            fabricLoaded = true;

            // Set higher precision for object properties to ensure better scaling preservation
            if (fabricLib && fabricLib.fabric && fabricLib.fabric.Object) {
              // Set NUM_FRACTION_DIGITS to higher precision for better scaling preservation
              fabricLib.fabric.Object.NUM_FRACTION_DIGITS = 4;
            }

            log('Fabric.js loaded');
          } catch (importErr) {
            console.error('Failed to import fabric.js:', importErr);
            return;
          }
        }

        // Check if the canvas element exists
        if (!canvasEl) {
          console.error('Canvas element reference is missing');
          return;
        }

        // Initialize the canvas
        try {
          // Ensure fabricLib is not null before using it
          if (!fabricLib) {
            throw new Error('Fabric library not loaded');
          }

          // Setup global fabric settings
          setupFabricGlobals(fabricLib);

          canvas = new fabricLib.fabric.Canvas(canvasEl, {
            backgroundColor: '#ffffff',
            preserveObjectStacking: true,
            stopContextMenu: true,
            fireRightClick: true,
            // Add these settings to improve rendering consistency:
            renderOnAddRemove: true,
            stateful: true,
            imageSmoothingEnabled: true // Better rendering quality
          });

          // Set default control appearance for all objects
          fabricLib.fabric.Object.prototype.set({
            cornerStyle: 'circle',
            cornerColor: 'white',
            cornerStrokeColor: '#6355FF',
            cornerStrokeWidth: 3,
            cornerSize: 8,
            padding: 1, // Increased padding for better selection handling
            transparentCorners: false,
            borderColor: '#6355FF',
            borderScaleFactor: 1.5,
            borderOpacityWhenMoving: .5,
            touchCornerSize: 20,
          });

          // Set selection appearance
          canvas.selectionColor = 'rgba(20,0,255,0.05)';
          canvas.selectionBorderColor = '#6355FF';
          canvas.selectionLineWidth = 2;

          canvas.hoverCursor = 'pointer';

  function animate(e: any, dir: any) {
    if (e.target) {
      // Skip animation for text objects to prevent scaling issues
      if (e.target.type === 'text' || e.target.type === 'i-text' || e.target.type === 'textbox') {
        // For text objects, just highlight with border change
        const originalBorderColor = e.target.borderColor;
        e.target.set({
          borderColor: dir ? '#ff0000' : '#6355FF'
        });
        canvas.requestRenderAll();

        // Reset border color after animation
        setTimeout(() => {
          e.target.set({ borderColor: originalBorderColor });
          canvas.requestRenderAll();
        }, 100);
        return;
      }

      // For non-text objects, use original animation
      if (fabricLib && canvas) {
        fabricLib.fabric.util.animate({
          startValue: e.target.angle,
          endValue: dir ? 10 : 0,
          duration: 100,
          onChange: function(value: any) {
            e.target.rotate(value);
            canvas.renderAll();
          },
          onComplete: function() {
            e.target.setCoords();
          }
        });

        fabricLib.fabric.util.animate({
          startValue: e.target.scaleX,
          endValue: dir ? 1.2 : 1,
          duration: 100,
          onChange: function(value: any) {
            e.target.scale(value);
            canvas.renderAll();
          },
          onComplete: function() {
            e.target.setCoords();
          }
        });
      }
    }
  }
  canvas.on('mouse:down', function(e: any) { animate(e, 1); });
  canvas.on('mouse:up', function(e: any) { animate(e, 0); });


          // Initialize fabric canvas event handlers for text scaling fix
          initializeFabricCanvas();

        } catch (canvasErr) {
          console.error('Failed to initialize fabric canvas:', canvasErr);
          return;
        }

        // Add a check to ensure canvas was properly initialized
        if (!canvas) {
          console.error('Failed to initialize canvas');
          return;
        }

        // Set canvas size based on container
        handleResize();

        // Set initial zoom to 100%
        zoom = 1;

        // Make a local copy of content for reactivity control
        localContent = safeClone(content);

        // Set up event handlers for window resize
        window.addEventListener('resize', handleResize);

        // Set up keyboard shortcuts
        window.addEventListener('keydown', handleKeyDown);

        // Setup initial viewport
        initializeViewport();

        // Setup event handlers
        setupEventHandlers();

        // Setup selection handlers
        setupSelectionHandlers();

        // Add a custom event listener for object updates
        if (canvasEl) {
          // Create an event listener for updating objects
          canvasEl.addEventListener('fabric:update-object', (event: any) => {
            console.log('Canvas received fabric:update-object event:', event.detail);
            const { object, updates } = event.detail;
            if (object && updates) {
              updateObject(object, updates);
            }
          });
        }

        // Make this instance available globally for debugging/access
        if (window) {
          // Cast window to any to avoid TypeScript errors
          (window as any).canvasInstance = {
            updateObject,
            clearSelection: () => canvas && canvas.discardActiveObject(),
            groupSelection: () => console.log('Group selection not implemented'),
            ungroupSelection: () => console.log('Ungroup selection not implemented'),
            alignSelection: () => console.log('Align selection not implemented'),
            distributeSelection: () => console.log('Distribute selection not implemented')
          };
        }

        // Load content if available
        if (content && Object.keys(content).length > 0) {
          await loadCanvasContent(content);
        }

        // After a short delay, mark initialization as complete
        setTimeout(() => {
          if (!initialized) {
            initialized = true;
            log('Canvas initialization complete');
          }
        }, 500);
      } catch (error) {
        console.error('Error in Canvas component initialization:', error);
        // Ensure we don't block future operations even if there's an error
        initialized = true;
        contentLoaded = true;
      }
    };

    // Start the initialization process
    initPromise();

    // Cleanup on component unmount
    return () => {
      // Remove event listeners
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);

      if (canvasEl) {
        canvasEl.removeEventListener('fabric:update-object', () => {});
      }

      // Dispose of the canvas if it was initialized
      if (canvas) {
        canvas.dispose();
      }

      // Clean up global instance
      if (window && (window as any).canvasInstance) {
        (window as any).canvasInstance = null;
      }

      console.log('Canvas component unmounted');
    };
  });

  onDestroy(() => {
    // Ensure we clean up any remaining resources
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }

    // Remove event listeners
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('keydown', handleKeyDown);

    if (canvasContainer) {
      // We removed the wheel event listener in the onMount cleanup, no need to do it here
    }
  });

  // ======= EVENT HANDLERS =======

  function setupEventHandlers() {
    if (!canvas || !fabricLib) {
      console.warn('Cannot setup event handlers - canvas or fabric is not fully initialized yet');
      // Return early instead of throwing an error
      return;
    }

    try {
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
        if (!e.target || isActivelyDrawing) return;

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
    } catch (err) {
      console.error('Error in setupEventHandlers:', err);
    }
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
          console.log(`Deleting ${activeObjects.length} objects using ${e.key} key`);
          activeObjects.forEach((obj: any) => canvas.remove(obj));
          canvas.discardActiveObject();
          canvas.renderAll();
          scheduleAutoSave();

          // Prevent default browser behavior for Backspace key
          if (e.key === 'Backspace') {
            e.preventDefault();
          }
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

    // When objects are modified, update toolbar properties and handle text scaling
    canvas.on('object:modified', (event: any) => {
      if (!event.target) return;

      const obj = event.target;

      // Use our normalization function for all object types
        untrack(() => {
        normalizeObjectScaling(obj);

          // Update the canvas
          canvas.renderAll();

        // Schedule auto save after modifying the object
        scheduleAutoSave();

      // Update toolbar properties if this is the selected object
        if (selectedObject === obj) {
        updateToolbarProperties();
      }
      });
    });

    // Handle text editing events
    canvas.on('text:changed', function(event: any) {
      if (!event.target) return;

      // Schedule an autosave when text content changes
      scheduleAutoSave();
    });

    // Handle exiting text edit mode to ensure proper object dimensions
    canvas.on('text:editing:exited', function(event: any) {
      if (!event.target) return;

      const obj = event.target;

      // Use our normalization function for consistent handling
        untrack(() => {
        normalizeObjectScaling(obj);
          canvas.renderAll();
          scheduleAutoSave();
        });
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

      // Dispatch selection cleared event
      dispatch('selectionChange', {
        object: null,
        objects: [],
        type: null
      });
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

        // Dispatch selection cleared event
        dispatch('selectionChange', {
          object: null,
          objects: [],
          type: null
        });

        return;
      }

      // Log more detailed information about the selected object
      console.log('Object selected:', {
        type: activeObject.type,
        data: activeObject.data,
        id: activeObject.id,
        isText: activeObject.type === 'i-text' || activeObject.type === 'text'
      });

      // Set selected object
      selectedObject = activeObject;

      // Focus the canvas element to ensure keyboard events are captured
      if (canvasEl) {
        canvasEl.focus();
      }

      // Determine object type more carefully
      if (activeObject.type === 'i-text' || activeObject.type === 'text') {
        objectType = 'text';
        console.log('Identified as TEXT object');
      } else if (activeObject.type === 'rect' && !activeObject.data?.type) {
        // Only treat as rectangle if it's not part of a drawing
        objectType = 'rectangle';
        console.log('Identified as RECTANGLE object');
      } else if (activeObject.type === 'circle') {
        objectType = 'circle';
        console.log('Identified as CIRCLE object');
      } else if (activeObject.type === 'path') {
        objectType = 'path';
        console.log('Identified as PATH object');
      } else if (activeObject.type === 'group' && activeObject.data?.type === 'drawing') {
        objectType = 'drawing';
        console.log('Identified as DRAWING object');
      } else {
        objectType = activeObject.type;
        console.log('Identified as OTHER object type:', activeObject.type);
      }

      // Log object details for debugging
      logSelectionState('handle-object-selected');

      // Immediately update exported properties to ensure consistency
      selectedObjectType = objectType || null;
      selectedObjectId = selectedObject ? getObjectId(selectedObject) : null;

      // Add an extra log for clarity when identifying text objects
      if (objectType === 'text') {
        console.log('TEXT OBJECT SELECTED - details:', {
          text: activeObject.text,
          fontFamily: activeObject.fontFamily,
          fontSize: activeObject.fontSize,
          type: activeObject.type
        });
      }

      // Don't show toolbar for drawing objects, they have their own interface
      if (objectType === 'drawing') {
        showToolbar = false;

        // Dispatch selection change event immediately
        console.log('Dispatching selectionChange event for drawing');
        dispatch('selectionChange', {
          object: selectedObject,
          objects: [selectedObject],
          type: objectType
        });

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

      // Dispatch selection change event to parent component
      console.log('Dispatching selectionChange event with type:', objectType);
      dispatch('selectionChange', {
        object: selectedObject,
        objects: [selectedObject],
        type: objectType
      });
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

  // Function to create text object
  function createText(pointer: {x: number, y: number}) {
    if (!canvas || !fabricLib) return;

    untrack(() => {
      // Create a new IText object with proper settings
      const text = new fabricLib.fabric.IText('Double-click to edit', {
        left: pointer.x,
        top: pointer.y,
        ...defaultStyles.text,
        // Explicitly set all scale-related properties for consistency
        scaleX: 1,
        scaleY: 1,
        originX: 'left',
        originY: 'top',
        // Add unique ID to help with selection tracking and restoration
        data: { id: fabricLib.fabric.util.uuid() }
      });

      // Add to canvas and select it
      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.renderAll();

      // Make sure the text object is properly positioned
      text.setCoords();

      // Schedule save before entering edit mode
      scheduleAutoSave();

      // Set isActivelyDrawing to false to ensure tool update works
      isActivelyDrawing = false;

      // For newly created text, automatically enter editing mode
      setTimeout(() => {
        // Change tool to select after creating text
        setTool('select');

        // Manually call handleObjectSelected to update toolbar
        handleObjectSelected({ target: text });

        // Enter edit mode immediately
        text.enterEditing();
        canvas.requestRenderAll();

        // Simulate a click to position cursor at the end
        if (text.hiddenTextarea) {
          text.selectAll();
          text.selectionStart = 0;
          text.selectionEnd = text.text.length;
        }
      }, 50);
    });
  }

  // Create rectangle
  function createRectangle(pointer: {x: number, y: number}) {
    if (!canvas || !fabricLib) return;

    untrack(() => {
      // Use fabricLib.fabric.Rect instead of fabricLib.Rect
      const rect = new fabricLib.fabric.Rect({
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

      // Save changes
      scheduleAutoSave();

      // Set isActivelyDrawing to false to ensure tool update works
      isActivelyDrawing = false;

      // Change tool to select after creating rectangle
      setTimeout(() => {
        setTool('select');

        // Manually call handleObjectSelected to update toolbar
        handleObjectSelected({ target: rect });

        // Make sure the rect is selected and controls are visible
        canvas.setActiveObject(rect);
        canvas.requestRenderAll();
      }, 50);
    });
  }

  // Create welcome text (for blank canvas)
  function addDefaultWelcomeText() {
    if (!canvas || !fabricLib) return;

    untrack(() => {
      const canvasWidth = canvas.width;
      const canvasHeight = canvas.height;

      const welcomeText = new fabricLib.fabric.IText('hello there', {
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

      // Reset all event handlers to prevent overlap
      setupEventHandlers();

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
          enableDrawMode();
          break;

        case 'text':
          canvas.isDrawingMode = false;
          canvas.selection = false;
          canvas.getObjects().forEach((obj: any) => {
            obj.selectable = true;
            obj.evented = true;
          });
          canvas.defaultCursor = 'text';
          enableTextMode();
          break;

        case 'rectangle':
          canvas.isDrawingMode = false;
          canvas.selection = false;
          canvas.getObjects().forEach((obj: any) => {
            obj.selectable = true;
            obj.evented = true;
          });
          canvas.defaultCursor = 'crosshair';
          enableRectangleMode();
          break;

        case 'eraser':
          canvas.isDrawingMode = false;
          canvas.selection = false;
          canvas.getObjects().forEach((obj: any) => {
            obj.selectable = true;
            obj.evented = true;
          });
          canvas.defaultCursor = 'not-allowed';
          enableEraserMode();
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
  export function zoomIn() {
    const newZoom = Math.min(maxZoom, zoom + zoomStep);
    const center = {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
    zoomToPoint(newZoom, center);
  }

  // Zoom out centered on canvas
  export function zoomOut() {
    const newZoom = Math.max(minZoom, zoom - zoomStep);
    const center = {
      x: canvas.width / 2,
      y: canvas.height / 2
    };
    zoomToPoint(newZoom, center);
  }

  // Reset zoom to original
  export function resetZoom() {
    // Guard against null or undefined canvas
    if (!canvas) {
      console.warn('Cannot reset zoom - canvas is not initialized');
      return;
    }

    try {
      // Safely access canvas properties
      const canvasWidth = canvas.width || 0;
      const canvasHeight = canvas.height || 0;

      const center = {
        x: canvasWidth / 2,
        y: canvasHeight / 2
      };

      // Update zoom state
      zoom = 1;

      // Only access viewportTransform if it exists
      if (canvas.viewportTransform) {
        canvas.viewportTransform[4] = 0;
        canvas.viewportTransform[5] = 0;
      }

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
    } catch (err) {
      console.error('Error in resetZoom:', err);
    }
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

      // Synchronize canvas layers before saving to ensure correct display
      syncCanvasLayers();

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

              // Force a sync after selection to ensure proper display
              syncCanvasLayers();

              // Make sure toolbar shows up for this object
              handleObjectSelected({ target: activeObject });
            }
          });
        } else {
          // Even if we don't have a selection to restore, sync canvas layers
          syncCanvasLayers();
        }

        onSaveStatus('saved');
        log('Canvas saved successfully.');
      }
    } catch (err) {
      console.error('Unexpected error saving canvas:', err);
      onSaveStatus('error');

      // Try to sync canvas layers even after error
      if (canvas) {
        syncCanvasLayers();
      }
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
      group = new fabricLib.fabric.Group([], {
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
      const rect = new fabricLib.fabric.Rect({
        width: drawingRef.position.width,
        height: drawingRef.position.height,
        fill: 'rgba(255, 255, 255, 0.9)',
        stroke: '#8888FF',
        strokeWidth: 1,
        originX: 'left',
        originY: 'top'
      });

      // Add an edit button if not already in edit mode
      const editButton = new fabricLib.fabric.Text('Edit Drawing', {
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
      const exitButton = new fabricLib.fabric.Text('Exit Drawing', {
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
            const editButton = new fabricLib.fabric.Text('Edit Drawing', {
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
        const fabricPath = new fabricLib.fabric.Path(path, {
          fill: stroke.color,
          opacity: stroke.tool === 'highlighter' ? 0.4 : stroke.opacity,
          selectable: false,
          evented: false,
          originX: 'left',
          originY: 'top',
          data: {
            isStroke: true,
            strokeId: stroke.id || fabricLib.fabric.util.uuid(),
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
        if (!isActivelyDrawing && !isSaving && content &&
            (!localContent || JSON.stringify(content) !== JSON.stringify(localContent))) {

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

            // Set flag to prevent circular updates
            skipNextViewportSave = true;

            // Don't reload the entire canvas, just update viewport if needed
            if (content.viewport && canvas) {
              zoom = content.viewport.zoom || 1;
              canvas.setViewportTransform([
                zoom, 0, 0, zoom,
                content.viewport.panX || 0,
                content.viewport.panY || 0
              ]);

              // Ensure all object coordinates are updated after viewport change
              canvas.forEachObject((obj: any) => {
                if (obj.setCoords) obj.setCoords();
              });

              // Force a complete sync of display and interactive layers
              syncCanvasLayers();
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

                // Force a complete sync of all object coordinates and display
                syncCanvasLayers();
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

        const fabricPath = new fabricLib.fabric.Path(path, pathOptions);
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
    try {
      // Log for debugging
      console.log('Canvas component detected external selectedTool change:', tool);

      // Set the flag to indicate this is an internal change
      internalToolChange = true;

      // Update the selected tool
      selectedTool = tool;
      isDrawingMode = tool === 'draw';

      // Only attempt to update mode and handlers if canvas is initialized
      if (canvas && fabricLoaded) {
        // Update cursor and event handlers
        if (typeof updateToolMode === 'function') {
          updateToolMode();
        }

        if (typeof setupEventHandlers === 'function') {
          setupEventHandlers();
        }

        // If canvas is finished loading, save state
        if (initialized && contentLoaded) {
          saveCanvas();
        }
      } else {
        console.log('Canvas or fabric not initialized yet, tool change will be applied when ready');
      }

      // The selectedTool reactive binding will automatically update the parent
      // Additional notification for non-binding scenarios
      if (typeof onToolChange === 'function') {
        onToolChange(tool);
      }
    } catch (err) {
      console.error('Error in setTool:', err);
    } finally {
      // Reset the flag after a short delay to allow for Svelte's reactivity to process
      setTimeout(() => {
        internalToolChange = false;
      }, 0);
    }
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
      e.target?.setCoords()

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

    // Clear existing mouse event handlers
    canvas.off('mouse:down');
    canvas.off('mouse:move');
    canvas.off('mouse:up');

    // Mouse down in rectangle mode
    canvas.on('mouse:down', (event: any) => {
      // Set flag to prevent reactivity loops
      isActivelyDrawing = true;

      // Only create rectangle when clicking on empty canvas
      if (event.target) {
        // If clicking on an existing object, select it and change to select tool
        canvas.setActiveObject(event.target);
        canvas.renderAll();

        // Reset flag and change to select tool
        isActivelyDrawing = false;
        setTool('select');
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

    // Clear existing mouse event handlers
    canvas.off('mouse:down');
    canvas.off('mouse:move');
    canvas.off('mouse:up');

    // Mouse down in text mode
    canvas.on('mouse:down', (event: any) => {
      // Set flag to prevent reactivity loops
      isActivelyDrawing = true;

      // Only create text when clicking on empty canvas
      if (event.target) {
        // If clicking on an existing object, select it and change to select tool
        canvas.setActiveObject(event.target);
        canvas.renderAll();

        // Reset flag and change to select tool
        isActivelyDrawing = false;
        setTool('select');
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
          drawingAreaRect = new fabricLib.fabric.Rect({
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
              id: fabricLib.fabric.util.uuid(),
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
  async function saveCanvasContent(shouldGenerateThumbnail = false): Promise<boolean> {
    if (!canvas || !pageId || !initialized || !contentLoaded) {
      return false;
    }

    try {
      // Set saving state
      isSaving = true;
      onSaving(true);
      onSaveStatus('saving');

      // First, force sync all objects to ensure they're properly rendered
      if (canvas) {
        // Fix text rendering issues before saving
        fixTextRendering();

        // Force a full re-render to ensure display is current
        canvas.renderAll();
      }

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

      // After saving, force another sync to ensure everything is properly displayed
      if (canvas) {
        // Fix text rendering again to ensure consistency
        fixTextRendering();

        // Force a full re-render again
        canvas.requestRenderAll();
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
    if (!canvas || !pageId || !fabricLib) return;

    try {
      console.log("Starting Canvas thumbnail generation...");

      // Create a new Fabric StaticCanvas for the thumbnail
      const thumbnailWidth = 320;
      const thumbnailHeight = 180;
      const thumbnailCanvas = document.createElement('canvas');
      thumbnailCanvas.width = thumbnailWidth;
      thumbnailCanvas.height = thumbnailHeight;

      // Create a fabric static canvas for the thumbnail
      const thumbnailFabricCanvas = new fabricLib.fabric.StaticCanvas(thumbnailCanvas, {
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
            const clonedObj = fabricLib.fabric.util.object.clone(obj);

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
  function renderFallbackThumbnail(fabricCanvas: any) {
    if (!fabricLib) return;

    // Clear the canvas
    fabricCanvas.clear();

    // Set background color
    fabricCanvas.setBackgroundColor('#f5f5f5', fabricCanvas.renderAll.bind(fabricCanvas));

    // Create centered text
    const titleText = new fabricLib.fabric.Text('Canvas Preview', {
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
    const icon = new fabricLib.fabric.Text('dashboard', {
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

  // Initialize viewport settings based on content
  function initializeViewport() {
    if (!canvas || !fabricLoaded) {
      console.warn('Cannot initialize viewport - canvas or fabric not ready');
      return;
    }

    try {
      // Set initial viewport values from content or defaults
      const vpt = canvas.viewportTransform;
      if (!vpt) {
        console.warn('Canvas viewportTransform is undefined');
        return;
      }

      if (content && content.viewport) {
        // Use content viewport if available
        initialViewport = {
          zoom: content.viewport.zoom || 1,
          panX: content.viewport.panX || 0,
          panY: content.viewport.panY || 0
        };
      } else {
        // Use default viewport if not available
        initialViewport = {
          zoom: 1,
          panX: 0,
          panY: 0
        };
      }

      // Apply the viewport transform
      zoom = initialViewport.zoom;
      vpt[0] = zoom;
      vpt[3] = zoom;
      vpt[4] = initialViewport.panX;
      vpt[5] = initialViewport.panY;

      // Update the canvas
      canvas.setZoom(zoom);
      canvas.renderAll();

      log('Viewport initialized:', initialViewport);
    } catch (err) {
      console.error('Error initializing viewport:', err);
    }
  }

  // Load canvas content with proper untracking to avoid reactivity
  async function loadCanvasContent(contentToLoad: any): Promise<void> {
    if (!canvas || !contentToLoad) {
      console.warn('Cannot load canvas content - canvas or content is missing');
      return Promise.resolve();
    }

    // Use untrack to prevent loops during content loading
    return new Promise<void>((resolve) => {
      untrack(() => {
        // Set a flag to avoid saving during the initial load
        skipNextViewportSave = true;

        try {
          // Load canvas objects without triggering reactivity
          canvas.loadFromJSON(contentToLoad, () => {
            try {
              console.log('Canvas loaded from JSON, fixing text objects...');

              // After loading canvas, identify and fix text objects first
              canvas.forEachObject((obj: any) => {
                if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
                  // Apply specific fixes for text objects
                  fixTextPositioningOnLoad(obj);
                }
              });

              // Then handle all remaining objects
              canvas.forEachObject((obj: any) => {
                // Setup drawing objects
                if (obj && obj.data?.type === 'drawing') {
                  setupDrawingObject(obj);
                }

                // For non-text objects, apply general normalization
                if (obj.type !== 'text' && obj.type !== 'i-text' && obj.type !== 'textbox') {
                  normalizeObjectScaling(obj);
                }

                // Ensure object coordinates are updated
                if (obj.setCoords) obj.setCoords();

                // Mark as dirty to force redraw
                if (obj.set) obj.set({ dirty: true });
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

              // Force complete sync of display and interactive layers
              syncCanvasLayers();

              // Do a final render to ensure everything is displayed correctly
              canvas.renderAll();

              contentLoaded = true;
              initialized = true;
              resolve();
            } catch (setupErr) {
              console.error('Error setting up canvas objects:', setupErr);
              contentLoaded = true;
              initialized = true;
              resolve();
            }
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

  function initializeFabricCanvas() {
    if (!canvas) return;

    // Add object:modified handler to handle scaling for text objects
    canvas.on('object:modified', function(event: any) {
      if (!event.target) return;

      const obj = event.target;

      // Special handling for text objects to convert scaling to font size
      if ((obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') &&
          (obj.scaleX !== 1 || obj.scaleY !== 1)) {
        untrack(() => {
          // Use our comprehensive normalization function
          normalizeObjectScaling(obj);

          // Update toolbar properties if this is the selected object
          if (selectedObject === obj) {
            updateToolbarProperties();
          }
        });
      }
      // For all other modifications, just schedule an autosave
      else {
        scheduleAutoSave();
      }

      // Make sure to sync display and interactive layers after any modification
      syncCanvasLayers();
    });

    // Add text:changed handler to ensure proper text object handling after editing
    canvas.on('text:changed', function(event: any) {
      if (!event.target) return;

      // Force cache regeneration for text objects
      if (event.target._clearCache) {
        event.target._clearCache();
      }

      // Ensure coordinates are updated after text changes
      if (event.target.setCoords) {
        event.target.setCoords();
      }

      // Schedule an autosave when text content changes
      scheduleAutoSave();

      // Force a sync after text changes
      syncCanvasLayers();
    });

    // Handle exiting text edit mode to ensure proper object dimensions
    canvas.on('text:editing:exited', function(event: any) {
      if (!event.target) return;

      const obj = event.target;

      // Use our normalization function for consistent handling
      untrack(() => {
        // Apply full normalization
        normalizeObjectScaling(obj);

        // Extra step to ensure dimensions are accurate
        obj._clearCache();
        obj.setCoords();

        // Render and save
        canvas.renderAll();
        scheduleAutoSave();

        // Sync layers after exiting text editing mode
        syncCanvasLayers();
      });
    });

    // Add specific handler for text objects to fix scaling issues when typing
    canvas.on('text:editing:entered', function(event: any) {
      if (!event.target) return;

      // Ensure scaling is reset when entering edit mode
      // This fixes issues where text could appear at wrong scale during editing
      const obj = event.target;

      if (obj.scaleX !== 1 || obj.scaleY !== 1) {
        untrack(() => {
          normalizeObjectScaling(obj);
          canvas.renderAll();
        });
      }
    });

    // Add handler for object scaling to ensure proper display
    canvas.on('object:scaling', function(event: any) {
      if (!event.target) return;

      // Update coordinates during scaling to keep interactive layer in sync
      if (event.target.setCoords) {
        event.target.setCoords();
      }
    });

    // Listen for object position changes
    canvas.on('object:moving', function(event: any) {
      if (!event.target) return;

      // Update coordinates during movement to keep interactive layer in sync
      if (event.target.setCoords) {
        event.target.setCoords();
      }
    });
  }

  // ... existing code ...

  // ... existing code ...

  // ... existing code ...

  // ... existing code ...

  // Apply viewport settings to the canvas
  function applyViewport(viewportSettings: any) {
    if (!canvas || !viewportSettings) return;

    try {
      // Apply zoom
      if (viewportSettings.zoom) {
        zoom = viewportSettings.zoom;
      }

      // Apply pan position
      canvas.setViewportTransform([
        zoom, 0, 0, zoom,
        viewportSettings.panX || 0,
        viewportSettings.panY || 0
      ]);

      // Render the canvas
      canvas.renderAll();
    } catch (err) {
      console.error('Error applying viewport settings:', err);
    }
  }

  // Add a new function to normalize object scaling after the setupEventHandlers function
  function normalizeObjectScaling(obj: any) {
    if (!obj) return;

    try {
      // Apply default scales if they're missing
      if (obj.scaleX === undefined || obj.scaleX === null) obj.scaleX = 1;
      if (obj.scaleY === undefined || obj.scaleY === null) obj.scaleY = 1;

      // Handle text objects specifically
      if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
        // For scaled text, update the fontSize instead of keeping the scale
        if (obj.scaleX !== 1 || obj.scaleY !== 1) {
          // Apply default fontSize if it's missing
          if (obj.fontSize === undefined || obj.fontSize === null) obj.fontSize = 20;

          // Convert scaling to font size for text objects - use the average of X and Y scales
          // to handle cases where the user might have scaled non-uniformly
          const avgScale = (obj.scaleX + obj.scaleY) / 2;
          const newFontSize = Math.round(obj.fontSize * avgScale);

          obj.set({
            fontSize: newFontSize,
            scaleX: 1,
            scaleY: 1,
            // Ensure padding is appropriate for the new fontSize
            padding: 0,
          });

          // Make sure originX and originY are properly set
          // for consistent positioning behavior
          if (!obj.originX) obj.originX = 'left';
          if (!obj.originY) obj.originY = 'top';

          // For center-aligned text, make sure the positioning is consistent
          if (obj.textAlign === 'center') {
            // Fix positioning for center-aligned text
            obj.left = obj.left + (obj.width * (obj.scaleX - 1) / 2);
          }
          else if (obj.textAlign === 'right') {
            // Fix positioning for right-aligned text
            obj.left = obj.left + (obj.width * (obj.scaleX - 1));
          }
        }

        // Ensure consistent caching and dimensions for text objects
        // to prevent visual glitches
        obj.set({
          dirty: true,
          // Enforce lockUniScaling to prevent non-uniform scaling from causing issues
          lockUniScaling: false
        });
      }
      // Handle shapes and other objects
      else if (obj.type === 'rect' || obj.type === 'circle' || obj.type === 'path') {
        // If object has non-uniform scaling, normalize it
        if (obj.scaleX !== 1 || obj.scaleY !== 1) {
          // For shapes, apply scaling to dimensions
          if (obj.width !== undefined && obj.height !== undefined) {
            obj.set({
              width: obj.width * obj.scaleX,
              height: obj.height * obj.scaleY,
              scaleX: 1,
              scaleY: 1
            });
          }
          // For path objects or objects without explicit dimensions
          else if (obj.type === 'path') {
            // For path objects, we preserve scale as they often need it
            // Just ensure both scales are the same to avoid distortion
            const avgScale = (obj.scaleX + obj.scaleY) / 2;
            obj.set({
              scaleX: avgScale,
              scaleY: avgScale
            });
          }
        }
      }

      // For any object type, ensure we clear cache and update coordinates
      if (obj._clearCache) obj._clearCache();
      if (obj.setCoords) obj.setCoords();

      // Ensure object's dirty state is set to force re-rendering
      if (obj.set) {
        obj.set({ dirty: true });
      }

      // If the object has objects (like a group), normalize all of them
      if (obj._objects && Array.isArray(obj._objects)) {
        obj._objects.forEach((childObj: any) => {
          normalizeObjectScaling(childObj);
        });
      }

      // Force object to update its appearance after modifications
      if (obj.canvas && obj.canvas.renderAll) {
        obj.canvas.renderAll();
      }
    } catch (err) {
      console.error('Error normalizing object scaling:', err, obj);
    }
  }

  // ... existing code ...

  // ... existing code ...

  // ... existing code ...

  // Add a new method to update object properties from sidebar changes
  export function updateObject(object: any, updates: any) {
    if (!object || !canvas) return;

    // For debug logging of updates
    console.log('Updating object with:', updates);

    // Make a copy of updates to avoid modifying the original
    const updatesToApply = { ...updates };

    // Special handling for text alignment
    if (object.type === 'text' || object.type === 'i-text' || object.type === 'textbox') {
      // If text alignment is changing, adjust position to maintain visual position
      if (updatesToApply.textAlign && updatesToApply.textAlign !== object.textAlign) {
        fixTextPositionForAlignmentChange(object, object.textAlign, updatesToApply.textAlign);
      }

      // For fontSize changes, ensure scale is reset
      if (updatesToApply.fontSize) {
        updatesToApply.scaleX = 1;
        updatesToApply.scaleY = 1;
      }

      // For font family changes, we need to regenerate the cache
      if (updatesToApply.fontFamily) {
        // Set dirty flag to force redraw
        updatesToApply.dirty = true;
      }
    }

    // Apply updates to the object
    object.set(updatesToApply);

    // Special handling for text objects after update
    if (object.type === 'text' || object.type === 'i-text' || object.type === 'textbox') {
      // Force cache regeneration for text objects
      object._clearCache();

      // Update padding based on font size if needed
      if (updatesToApply.fontSize && object.padding < 5) {
        object.set({ padding: Math.max(5, Math.round(object.fontSize * 0.15)) });
      }
    }

    // Update coordinates and render
    object.setCoords();
    canvas.renderAll();

    // Special handling for color changes - force a proper redraw
    if (updatesToApply.fill || updatesToApply.stroke) {
      // Re-render to ensure color changes are applied
      setTimeout(() => {
        canvas.requestRenderAll();
      }, 0);
    }

    // Schedule an autosave after object update
    scheduleAutoSave();
  }

  // Helper function to find an object by ID
  function findObjectById(id: string) {
    if (!canvas) return null;

    // First look in the active selection if there is one
    const activeSelection = canvas.getActiveObject();
    if (activeSelection && activeSelection.type === 'activeSelection' && activeSelection._objects) {
      for (const obj of activeSelection._objects) {
        if (obj.id === id || (obj.data && obj.data.id === id)) {
          return obj;
        }
      }
    }

    // Then look through all objects
    const objects = canvas.getObjects();
    return objects.find(obj => obj.id === id || (obj.data && obj.data.id === id)) || null;
  }

  // Helper function to find an object by position
  function findObjectByPosition(left: number, top: number, tolerance: number = 5) {
    if (!canvas) return null;

    const objects = canvas.getObjects();
    return objects.find(obj => {
      return Math.abs(obj.left - left) <= tolerance &&
             Math.abs(obj.top - top) <= tolerance;
    }) || null;
  }

  // ... existing code ...

  // Add a function to fix canvas positioning issues
  function fixCanvasPosition() {
    if (!canvas || !canvasContainer) return;

    try {
      // Get all canvas-container elements created by Fabric.js
      const fabricContainers = canvasContainer.querySelectorAll('.canvas-container');

      // Force absolute positioning to avoid display shift issues
      fabricContainers.forEach((container: HTMLElement) => {
        container.style.position = 'absolute';
        container.style.top = '0';
        container.style.left = '0';
      });

      // Ensure our canvas wrapper has the correct positioning
      const wrapper = canvasContainer.querySelector('.canvas-wrapper');
      if (wrapper) {
        (wrapper as HTMLElement).style.position = 'relative';
      }
    } catch (err) {
      console.error('Error fixing canvas position:', err);
    }
  }

  // Setup canvas and bind events
  onMount(async () => {
    // Setup the initial canvas
    await initializeFabricCanvas();

    // Fix canvas positioning
    fixCanvasPosition();

    // Setup event handlers if canvas is initialized
    if (canvas) {
      setupEventHandlers();
      setupSelectionHandlers();

      try {
        // Set up object update event listeners
        if (canvasEl) {
          // Create an event listener for updating objects
          canvasEl.addEventListener('fabric:update-object', (event: any) => {
            console.log('Canvas received fabric:update-object event:', event.detail);
            const { object, updates } = event.detail;
            if (object && updates) {
              updateObject(object, updates);
            }
          });
        }

        if (window) {
          // Make canvas instance methods available externally
          (window as any).canvasAPI = {
            updateObject,
            clearSelection: () => canvas && canvas.discardActiveObject(),
            groupSelection,
            ungroupSelection,
            alignSelection,
            distributeSelection
          };
        }

        // Make this instance available globally for debugging/access
        if (window) {
          // Cast window to any to avoid TypeScript errors
          (window as any).canvasInstance = {
            updateObject,
            clearSelection: () => canvas && canvas.discardActiveObject(),
            groupSelection: () => console.log('Group selection not implemented'),
            ungroupSelection: () => console.log('Ungroup selection not implemented'),
            alignSelection: () => console.log('Align selection not implemented'),
            distributeSelection: () => console.log('Distribute selection not implemented')
          };
        }
      } catch (err) {
        console.error('Error setting up canvas API:', err);
      }
    }

    // Now that canvas is ready, attach keyboard and resize handlers
    window.addEventListener('resize', handleResize);

    // Set up keyboard shortcuts
    window.addEventListener('keydown', handleKeyDown);

    // Setup initial viewport
    initializeViewport();

    // Run a full layer sync after initialization
    syncCanvasLayers();

    // Run fix canvas position again after a short delay to handle any post-init layout changes
    setTimeout(fixCanvasPosition, 500);

    initialized = true;
  });

  // Add a function to sync display and interactive layers
  function syncCanvasLayers() {
    if (!canvas) return;

    try {
      // Force all objects to update their caches and coordinates
      canvas.forEachObject((obj: any) => {
        // Clear any caches
        if (obj._clearCache) obj._clearCache();

        // Update coordinates
        if (obj.setCoords) obj.setCoords();

        // Mark as dirty to force redraw
        if (obj.set) obj.set({ dirty: true });

        // Special handling for text objects that might have a separate display
        if (obj.type === 'text' || obj.type === 'i-text') {
          // Ensure text rendering and interactive areas match
          if (obj.initDimensions) obj.initDimensions();
          if (obj.__lastRenderedText !== obj.text) {
            obj.__lastRenderedText = obj.text;
          }
        }

        // If it's a group, handle all child objects
        if (obj._objects && Array.isArray(obj._objects)) {
          obj._objects.forEach((childObj: any) => {
            if (childObj._clearCache) childObj._clearCache();
            if (childObj.setCoords) childObj.setCoords();
            if (childObj.set) childObj.set({ dirty: true });
          });
        }
      });

      // Force a complete redraw of the canvas
      canvas.requestRenderAll();
    } catch (err) {
      console.error('Error syncing canvas layers:', err);
    }
  }

  // Add a new function to fix text rendering for all text objects
  function fixTextRendering() {
    if (!canvas) return;

    canvas.forEachObject((obj: any) => {
      if (obj.type === 'text' || obj.type === 'i-text' || obj.type === 'textbox') {
        // Apply comprehensive fix for text objects
        fixTextPositioningOnLoad(obj);
      }
    });

    // Force a complete render
    canvas.renderAll();
  }

  // Add a function to fix position for text alignment changes
  function fixTextPositionForAlignmentChange(obj: any, oldAlign: string, newAlign: string) {
    if (!obj || obj.type !== 'text' && obj.type !== 'i-text' && obj.type !== 'textbox') {
      return;
    }

    // Calculate object width
    const width = obj.width * obj.scaleX;

    // Adjust position based on alignment change
    if (oldAlign === 'left' && newAlign === 'center') {
      // Left -> Center: move right by half width
      obj.left += width / 2;
    }
    else if (oldAlign === 'left' && newAlign === 'right') {
      // Left -> Right: move right by full width
      obj.left += width;
    }
    else if (oldAlign === 'center' && newAlign === 'left') {
      // Center -> Left: move left by half width
      obj.left -= width / 2;
    }
    else if (oldAlign === 'center' && newAlign === 'right') {
      // Center -> Right: move right by half width
      obj.left += width / 2;
    }
    else if (oldAlign === 'right' && newAlign === 'left') {
      // Right -> Left: move left by full width
      obj.left -= width;
    }
    else if (oldAlign === 'right' && newAlign === 'center') {
      // Right -> Center: move left by half width
      obj.left -= width / 2;
    }

    // Update object coordinates
    obj.setCoords();
  }

  // Function to explicitly fix text positioning issues on load
  function fixTextPositioningOnLoad(obj: any) {
    if (!obj || (obj.type !== 'text' && obj.type !== 'i-text' && obj.type !== 'textbox')) {
      return;
    }

    try {
      // 1. Ensure scale is 1:1
      const wasScaled = obj.scaleX !== 1 || obj.scaleY !== 1;
      const oldFontSize = obj.fontSize || 18;
      let newFontSize = oldFontSize;

      // If the text was scaled, adjust font size
      if (wasScaled) {
        const avgScale = (obj.scaleX + obj.scaleY) / 2;
        newFontSize = Math.round(oldFontSize * avgScale);
      }

      // 2. Ensure origin settings are consistent
      if (!obj.originX) obj.originX = 'left';
      if (!obj.originY) obj.originY = 'top';

      // 3. Calculate width before applying changes
      const originalWidth = obj.width * obj.scaleX;
      const originalHeight = obj.height * obj.scaleY;

      // 4. Apply consistent settings
      obj.set({
        fontSize: newFontSize,
        scaleX: 1,
        scaleY: 1,
        padding: Math.max(5, Math.round(newFontSize * 0.15)),
        dirty: true
      });

      // 5. Fix positioning based on textAlign
      // For center or right-aligned text, the position needs adjustment
      // because the bounding box origin changes when scale is reset
      if (obj.textAlign === 'center') {
        // Calculate new width after scaling reset
        obj._clearCache();
        const newWidth = obj.width;
        // Adjust horizontal position to keep text centered at same spot
        obj.left += (originalWidth - newWidth) / 2;
      }
      else if (obj.textAlign === 'right') {
        // Calculate new width after scaling reset
        obj._clearCache();
        const newWidth = obj.width;
        // Adjust horizontal position to keep right edge at same spot
        obj.left += (originalWidth - newWidth);
      }

      // 6. Force regeneration of all caches
      obj._clearCache();
      obj.setCoords();
    } catch (err) {
      console.error('Error fixing text positioning:', err);
    }
  }
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

<div class="canvas-container" bind:this={canvasContainer}>
  <div class="canvas-wrapper">
    <canvas
      bind:this={canvasEl}
      tabindex="0"
    ></canvas>
  </div>

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
</div>

<style lang="scss">
  .canvas-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #f5f5f5;
    display: flex;

    /* This forces all fabric.js containers to have consistent positioning */
    .canvas-container {
      position: absolute !important;
      top: 0;
      left: 0;
    }

    .canvas-wrapper {
      position: relative;
      flex: 1;
      height: 100%;
    }

    canvas {
      position: absolute;
      top: 0;
      left: 0;
      border: 1px solid yellow;
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