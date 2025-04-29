<script lang="ts">
  import { onMount, onDestroy, afterUpdate } from 'svelte';
  import { fabric } from 'fabric';
  import { completeBoundingBox } from '$lib/utils/boundingBoxUtils';
  import type { DetectedObject } from '$lib/types/detectedObject';
  import type { Stroke } from '$lib/types/drawing';
  import { createEventDispatcher } from 'svelte';
  import { debounce } from 'lodash';

  // Extend Stroke type to include segment properties
  interface ExtendedStroke extends Stroke {
    isSegment?: boolean;
    parentStrokeId?: string;
    segmentIndex?: number;
  }

  // Define extended type for fabric objects with custom properties
  interface ExtendedFabricObject extends fabric.Object {
    statusTag?: boolean;
    objectId?: string;
    aiAnimationIndex?: number;
    objectType?: string;
    confidence?: number;
    color?: string;
    highlight?: boolean;
  }

  // Prop declarations for the component
  export let detectedObjects: DetectedObject[] = [];
  export let width: number = 800;
  export let height: number = 600;
  export let visible: boolean = true;
  export let canvasRef: HTMLCanvasElement | null = null;
  export let strokes: ExtendedStroke[] = [];
  export let isAnalyzing: boolean = false; // New prop to indicate if analysis is in progress
  export let waitingForInput: boolean = false; // New prop to indicate if waiting for user input
  export let canvasZoom: number = 1;
  export let debugMode = false; // Add debug flag for detailed visualization

  // Local state
  let overlayCanvas: HTMLCanvasElement;
  let fabricCanvas: fabric.StaticCanvas;
  let containerElement: HTMLDivElement;
  let resizeObserver: ResizeObserver;
  let lastUpdateTime = 0;
  let initialSyncDone = false;
  let lastDetectedObjects: any[] = [];
  let lastStrokesLength = 0;
  let initialized = false;
  let objectsRendered = [];
  let resizeTimeout;
  let renderDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastObjectsWithEnhancedBoxes: any[] = [];
  let usingCnnEnhancedBoxes = false;
  let showStatusTag = true; // Whether to show the status tag
  let statusTagTimer: ReturnType<typeof setTimeout> | null = null;
  let wasAnalyzing = false;
  let canvasEl: HTMLCanvasElement;
  let canvas: fabric.Canvas;
  let statusTag: any;
  let previousDetectedObjects: DetectedObject[] = [];
  let previousStrokes: Stroke[] = [];
  let skipFullRender = false;
  let rendered = false;
  let objectCount = 0;
  let lastRenderedObjectsHash = '';
  let renderTimeout;
  let statusTagVisible = false;
  let animateStatusTag = false;
  let statusTagText = '';
  let renderDebounceTimeout;

  // Track all animation frame IDs for cleanup
  let activeAnimationFrames: number[] = [];

  const dispatch = createEventDispatcher();

  // Update canvas display based on visibility
  $: if (overlayCanvas && initialized) {
    overlayCanvas.style.display = visible ? 'block' : 'none';
  }

  // Colors for different object categories
  const categoryColors = {
    'eye': 'rgba(75, 192, 192, 0.7)',    // Teal
    'left eye': 'rgba(75, 192, 192, 0.7)',
    'right eye': 'rgba(75, 192, 192, 0.7)',
    'nose': 'rgba(255, 159, 64, 0.7)',   // Orange
    'mouth': 'rgba(255, 99, 132, 0.7)',  // Red
    'ear': 'rgba(255, 205, 86, 0.7)',    // Yellow
    'face': 'rgba(255, 127, 80, 0.7)',   // Coral
    'head': 'rgba(255, 160, 122, 0.7)',  // Light salmon
    'body': 'rgba(233, 150, 122, 0.7)',  // Dark salmon
    'circle': 'rgba(156, 39, 176, 0.7)', // Purple
    'rectangle': 'rgba(63, 81, 181, 0.7)', // Indigo
    'triangle': 'rgba(33, 150, 243, 0.7)', // Blue
    'line': 'rgba(0, 188, 212, 0.7)',    // Cyan
    'arrow': 'rgba(139, 195, 74, 0.7)',  // Light Green
    'star': 'rgba(255, 193, 7, 0.7)',    // Amber
    'human': 'rgba(255, 87, 51, 0.7)',   // Red-orange
    'animal': 'rgba(255, 51, 165, 0.7)', // Pink
    'building': 'rgba(51, 87, 255, 0.7)', // Blue
    'nature': 'rgba(51, 255, 87, 0.7)',  // Green
    'house': 'rgba(63, 81, 181, 0.7)',   // Indigo
    'roof': 'rgba(139, 0, 0, 0.7)',      // Dark Red
    'door': 'rgba(0, 100, 0, 0.7)',      // Dark Green
    'window': 'rgba(255, 193, 7, 0.7)',  // Amber
    'default': 'rgba(156, 39, 176, 0.7)' // Purple
  };

  /**
   * Compares detected objects to see if they've significantly changed
   * to warrant a re-render
   */
  function hasDetectedObjectsChanged() {
    // Check for enhancement status change
    const newHasEnhancements = detectedObjects.some(obj => obj.enhancedByCNN);
    if (newHasEnhancements !== usingCnnEnhancedBoxes) {
      usingCnnEnhancedBoxes = newHasEnhancements;
      return true;
    }

    // Check if array length changed
    if (lastDetectedObjects.length !== detectedObjects.length) {
      return true;
    }

    // Check for significant changes in object properties
    for (let i = 0; i < detectedObjects.length; i++) {
      const current = detectedObjects[i];
      const previous = lastDetectedObjects[i];

      // If different objects or object types
      if (!previous || current.name !== previous.name ||
          (current.detectionSource !== previous.detectionSource) || current.id !== previous.id) {
        return true;
      }

      // If bounding box changed significantly
      if (current.boundingBox && previous.boundingBox) {
        const cb = current.boundingBox;
        const pb = previous.boundingBox;

        // Check if bounding box changed by more than 5%
        const positionThreshold = 0.05;

        // Check for significant changes in critical properties
        if (Math.abs((cb.minX || cb.x || 0) - (pb.minX || pb.x || 0)) > positionThreshold ||
            Math.abs((cb.minY || cb.y || 0) - (pb.minY || pb.y || 0)) > positionThreshold ||
            Math.abs(cb.width - pb.width) > positionThreshold ||
            Math.abs(cb.height - pb.height) > positionThreshold) {
          return true;
        }
      } else if (current.boundingBox !== previous.boundingBox) {
        // One has a bounding box, the other doesn't
        return true;
      }

      // Check for enhancement changes
      if (current.enhancedByCNN !== previous.enhancedByCNN ||
          current.enhancedByStrokes !== previous.enhancedByStrokes) {
        return true;
      }
    }

    // No significant changes detected
    return false;
  }

  function getColorForObject(obj) {
    if (!obj) return categoryColors.default;

    // Check if object is CNN-enhanced - use a different shade if so
    const enhancementAdjustment = obj.enhancedByCNN ? '!important' : '';

    const category = (obj.category || '').toLowerCase();
    const name = (obj.name || '').toLowerCase();
    const type = (obj.type || '').toLowerCase();

    return obj.color ||
           categoryColors[name] ||
           categoryColors[category] ||
           categoryColors[type] ||
           categoryColors.default;
  }

  /**
   * NEW: Semantic bounding box extraction
   * Uses object name and relative position to infer better bounding boxes
   * Less dependent on strokes and more on common visual patterns
   */
  function semanticBoundingBoxExtraction(obj, allObjects) {
    if (!obj || !obj.name) return null;

    const objName = obj.name.toLowerCase();

    // If object already has a valid bounding box, return it
    if (obj.boundingBox &&
        obj.boundingBox.width > 0 &&
        obj.boundingBox.height > 0 &&
        obj.enhancedBySemanticAnalysis) {
      return obj.boundingBox;
    }

    // Find house object if present for reference
    const houseObject = allObjects.find(o =>
      o.name && o.name.toLowerCase().includes('house') && o.boundingBox);

    // Default to using existing bounding box if available
    let bb = obj.boundingBox ? { ...obj.boundingBox } : null;

    if (houseObject && houseObject.boundingBox) {
      const houseBB = houseObject.boundingBox;

      // Extract house dimensions
      const houseMinX = houseBB.minX !== undefined ? houseBB.minX : houseBB.x || 0;
      const houseMinY = houseBB.minY !== undefined ? houseBB.minY : houseBB.y || 0;
      const houseWidth = houseBB.width || 0;
      const houseHeight = houseBB.height || 0;

      // Create more precise bounding boxes based on semantic understanding
      if (objName.includes('roof')) {
        // Roof is typically the top 1/4 to 1/3 of a house
        bb = {
          minX: houseMinX,
          minY: houseMinY,
          width: houseWidth,
          height: houseHeight * 0.3,
          maxX: houseMinX + houseWidth,
          maxY: houseMinY + houseHeight * 0.3,
          centerX: houseMinX + houseWidth/2,
          centerY: houseMinY + houseHeight * 0.15
        };
      }
      else if (objName.includes('door')) {
        // Door is typically in the bottom center, about 1/4 of house width
        const doorWidth = houseWidth * 0.25;
        const doorHeight = houseHeight * 0.4;
        bb = {
          minX: houseMinX + (houseWidth - doorWidth) / 2,
          minY: houseMinY + houseHeight * 0.6,
          width: doorWidth,
          height: doorHeight,
          maxX: houseMinX + (houseWidth + doorWidth) / 2,
          maxY: houseMinY + houseHeight,
          centerX: houseMinX + houseWidth/2,
          centerY: houseMinY + houseHeight * 0.8
        };
      }
      else if (objName.includes('window')) {
        // Default to left window unless specified
        const isLeftWindow = objName.includes('left') || !objName.includes('right');
        const windowWidth = houseWidth * 0.2;
        const windowHeight = houseHeight * 0.25;

        if (isLeftWindow) {
          bb = {
            minX: houseMinX + houseWidth * 0.15,
            minY: houseMinY + houseHeight * 0.4,
            width: windowWidth,
            height: windowHeight,
            maxX: houseMinX + houseWidth * 0.35,
            maxY: houseMinY + houseHeight * 0.65,
            centerX: houseMinX + houseWidth * 0.25,
            centerY: houseMinY + houseHeight * 0.525
          };
        } else {
          bb = {
            minX: houseMinX + houseWidth * 0.65,
            minY: houseMinY + houseHeight * 0.4,
            width: windowWidth,
            height: windowHeight,
            maxX: houseMinX + houseWidth * 0.85,
            maxY: houseMinY + houseHeight * 0.65,
            centerX: houseMinX + houseWidth * 0.75,
            centerY: houseMinY + houseHeight * 0.525
          };
        }
      }
    }

    return bb;
  }

  /**
   * NEW: Get points from a stroke that are inside a bounding box
   * Used to refine semantic bounding boxes with actual stroke data
   */
  function getPointsInsideBoundingBox(stroke, boundingBox) {
    if (!stroke || !stroke.points || !boundingBox) return [];

    const insidePoints = [];
    const bb = boundingBox;
    const minX = bb.minX !== undefined ? bb.minX : bb.x || 0;
    const minY = bb.minY !== undefined ? bb.minY : bb.y || 0;
    const maxX = minX + (bb.width || 0);
    const maxY = minY + (bb.height || 0);

    // Padding to accommodate minor errors (3% of canvas)
    const padding = 0.03;

    for (const point of stroke.points) {
      const x = point.x !== undefined ? point.x : point[0];
      const y = point.y !== undefined ? point.y : point[1];

      // Check if point is inside the bounding box (with padding)
      if (x >= minX - padding && x <= maxX + padding &&
          y >= minY - padding && y <= maxY + padding) {
        insidePoints.push({x, y});
      }
    }

    return insidePoints;
  }

  /**
   * NEW: Refine bounding box with actual stroke data
   * Adjust semantic bounding box based on actual strokes
   */
  function refineBoundingBoxWithStrokeData(boundingBox, strokes) {
    if (!boundingBox || !strokes || strokes.length === 0) return boundingBox;

    let relevantPoints = [];

    // Collect points from strokes that are inside or near this bounding box
    for (const stroke of strokes) {
      const insidePoints = getPointsInsideBoundingBox(stroke, boundingBox);
      relevantPoints = [...relevantPoints, ...insidePoints];
    }

    // If we found enough points, refine the bounding box
    if (relevantPoints.length >= 10) {
      // Find min/max coordinates from actual points
      let minX = 1, minY = 1, maxX = 0, maxY = 0;

      for (const point of relevantPoints) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }

      // Add small padding (2% of canvas)
      const padding = 0.02;

      // Create refined bounding box
      return {
        minX: Math.max(0, minX - padding),
        minY: Math.max(0, minY - padding),
        maxX: Math.min(1, maxX + padding),
        maxY: Math.min(1, maxY + padding),
        width: Math.min(1, maxX - minX + padding * 2),
        height: Math.min(1, maxY - minY + padding * 2),
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2
      };
    }

    return boundingBox;
  }

  // Calculate proximity between a stroke and an object (simplified)
  function calculateProximity(stroke, obj) {
    if (!stroke || !stroke.points || !obj) return Infinity;

    // If no bounding box, use the object center point
    if (!obj.boundingBox) {
      const centerX = obj.x || obj.position?.x || 0.5;
      const centerY = obj.y || obj.position?.y || 0.5;

    // Find minimum distance from any point in the stroke to the object center
    let minDistance = Infinity;

    for (const point of stroke.points) {
      const pointX = point.x !== undefined ? point.x : point[0];
      const pointY = point.y !== undefined ? point.y : point[1];

      const dx = pointX - centerX;
      const dy = pointY - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      minDistance = Math.min(minDistance, distance);
    }

    return minDistance;
  }

    // When we have a bounding box, find minimum distance to the box
    const bb = obj.boundingBox;
    const objMinX = bb.minX !== undefined ? bb.minX : bb.x;
    const objMinY = bb.minY !== undefined ? bb.minY : bb.y;
    const objMaxX = objMinX + bb.width;
    const objMaxY = objMinY + bb.height;

    let minDistance = Infinity;
    let pointsInside = 0;

    for (const point of stroke.points) {
      const pointX = point.x !== undefined ? point.x : point[0];
      const pointY = point.y !== undefined ? point.y : point[1];

      // Check if point is inside the bounding box
      if (pointX >= objMinX && pointX <= objMaxX &&
          pointY >= objMinY && pointY <= objMaxY) {
        pointsInside++;
        // For points inside, use a very small distance value
        minDistance = 0;
      } else {
        // For points outside, calculate distance to nearest edge or corner
        const distToLeft = Math.abs(pointX - objMinX);
        const distToRight = Math.abs(pointX - objMaxX);
        const distToTop = Math.abs(pointY - objMinY);
        const distToBottom = Math.abs(pointY - objMaxY);

        // Find closest edge
        let edgeDist;
        if (pointX >= objMinX && pointX <= objMaxX) {
          // Point is within horizontal bounds
          edgeDist = Math.min(distToTop, distToBottom);
        } else if (pointY >= objMinY && pointY <= objMaxY) {
          // Point is within vertical bounds
          edgeDist = Math.min(distToLeft, distToRight);
        } else {
          // Point is outside both bounds, calculate distance to nearest corner
          const distToTopLeft = Math.sqrt(distToLeft * distToLeft + distToTop * distToTop);
          const distToTopRight = Math.sqrt(distToRight * distToRight + distToTop * distToTop);
          const distToBottomLeft = Math.sqrt(distToLeft * distToLeft + distToBottom * distToBottom);
          const distToBottomRight = Math.sqrt(distToRight * distToRight + distToBottom * distToBottom);
          edgeDist = Math.min(distToTopLeft, distToTopRight, distToBottomLeft, distToBottomRight);
        }

        minDistance = Math.min(minDistance, edgeDist);
      }
    }

    // If many points are inside, distance is effectively zero
    if (pointsInside > stroke.points.length * 0.3) {
      return 0;
    }

    return minDistance;
  }

  // Find strokes related to an object (simplified)
  function findRelatedStrokes(obj) {
    if (!strokes || strokes.length === 0 || !obj) return [];

    // Use a wider threshold to find all potentially related strokes
    let threshold = 0.15; // 15% of canvas size

    // Calculate proximity for all strokes
    const proximityResults = strokes.map(stroke => {
      const proximity = calculateProximity(stroke, obj);
      return { stroke, proximity };
    });

    // Sort by proximity - closest first
    proximityResults.sort((a, b) => a.proximity - b.proximity);

    // Return strokes within the threshold distance
    return proximityResults
      .filter(result => result.proximity < threshold)
      .map(result => result.stroke);
  }

  // Improved association between objects and strokes
  function calculateObjectStrokeAssociations() {
    if (!detectedObjects || !strokes || !strokes.length) return detectedObjects;

    // Clone the objects to avoid modifying originals
    const enhancedObjects = JSON.parse(JSON.stringify(detectedObjects));

    // First, apply semantic bounding box extraction to all objects
    for (let i = 0; i < enhancedObjects.length; i++) {
      const obj = enhancedObjects[i];

      // Extract semantic bounding box
      const semanticBB = semanticBoundingBoxExtraction(obj, enhancedObjects);

      if (semanticBB) {
        obj.originalBoundingBox = obj.boundingBox;
        obj.boundingBox = semanticBB;
        obj.enhancedBySemanticAnalysis = true;
      }
    }

    // Second pass: refine bounding boxes with actual stroke data
    for (let i = 0; i < enhancedObjects.length; i++) {
      const obj = enhancedObjects[i];

      // Only process objects with semantic bounding boxes
      if (obj.enhancedBySemanticAnalysis) {
        // Find strokes related to this object using the semantic bounding box
        const relatedStrokes = findRelatedStrokes(obj);

        // If we found related strokes, refine the bounding box
        if (relatedStrokes.length > 0) {
          // Refine bounding box based on actual stroke data
          const refinedBB = refineBoundingBoxWithStrokeData(obj.boundingBox, relatedStrokes);

          if (refinedBB) {
            obj.boundingBox = refinedBB;
            obj.strokeIds = relatedStrokes.map(s => s.id || '');
            obj.enhancedByStrokes = true;
          }
        }
      }
    }

    return enhancedObjects;
  }

  function initFabricCanvas() {
    if (!overlayCanvas) return;

    // Clean up previous instance if it exists
    if (fabricCanvas) {
      fabricCanvas.dispose();
    }

    // Create a new static canvas (non-interactive)
    fabricCanvas = new fabric.StaticCanvas(overlayCanvas, {
      width,
      height,
      renderOnAddRemove: true,
      selection: false
    });

    // Make sure it's visible or hidden based on prop
    overlayCanvas.style.display = visible ? 'block' : 'none';

    initialized = true;
    renderObjects();
  }

  // Capture a snapshot of an object's bounding box area
  function captureObjectSnapshot(obj) {
    if (!obj.boundingBox || !fabricCanvas) return null;

    try {
      const bb = obj.boundingBox;
      const left = (bb.minX !== undefined ? bb.minX : bb.x) * width;
      const top = (bb.minY !== undefined ? bb.minY : bb.y) * height;
      const boxWidth = bb.width * width;
      const boxHeight = bb.height * height;

      // Create a temporary canvas to capture just this area
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = boxWidth;
      tempCanvas.height = boxHeight;
      const ctx = tempCanvas.getContext('2d');

      if (!ctx) return null;

      // Get the DOM element from fabricCanvas
      const fabricCanvasEl = fabricCanvas.getElement();

      if (!fabricCanvasEl) return null;

      // Draw the portion of the main canvas to this temporary canvas
      ctx.drawImage(
        fabricCanvasEl,
        left, top, boxWidth, boxHeight,
        0, 0, boxWidth, boxHeight
      );

      // Return as data URL
      return tempCanvas.toDataURL('image/png');
    } catch (error) {
      console.error('Error capturing object snapshot:', error);
      return null;
    }
  }

  function renderObjects() {
    if (!fabricCanvas || !initialized) return;

    // Clear previous objects
    fabricCanvas.clear();
    objectsRendered = [];

    if (!detectedObjects || !detectedObjects.length || !visible) {
      return;
    }

    // Filter out TensorFlow and CNN objects to avoid duplication with TFOverlay
    const nonTFObjects = detectedObjects.filter(obj => {
      // Check both detectionSource and source properties
      const source = obj.detectionSource || obj.source || '';
      // Return true for objects that are NOT from tensorflow or CNN
      return !(
        source === 'tensorflow' ||
        source === 'cnn' ||
        source.includes('sketch-cnn') ||
        obj.enhancedByCNN === true
      );
    });

    // Apply our semantic bounding box analysis
    const enhancedObjects = calculateObjectStrokeAssociations();

    // Dispatch the enhanced objects for debugging purposes
    dispatch('enhancedObjects', {
      objects: enhancedObjects.map(obj => {
        // Try to capture a snapshot of this object if in debug mode
        const snapshot = debugMode ? captureObjectSnapshot(obj) : null;

        return {
          name: obj.name,
          confidence: obj.confidence,
          boundingBox: obj.boundingBox,
          enhancedBy: {
            semantic: obj.enhancedBySemanticAnalysis || false,
            strokes: obj.enhancedByStrokes || false,
            cnn: obj.enhancedByCNN || false
          },
          snapshot
        };
      })
    });

    // Ensure all objects have complete bounding boxes
    const objectsToRender = enhancedObjects.map(obj => {
      // Skip objects without bounding boxes
      if (!obj.boundingBox) return obj;

      // Complete the bounding box to ensure all properties are available
      return {
        ...obj,
        boundingBox: completeBoundingBox(obj.boundingBox)
      };
    });

    // Store in state for comparison
    lastObjectsWithEnhancedBoxes = [...objectsToRender];

    // Render each detected object
    objectsToRender.forEach((obj, index) => {
      if (!obj.boundingBox) return;

      // Get color based on category, name, or type
      const color = getColorForObject(obj);

      // Create a rectangle for the bounding box
      const bb = obj.boundingBox;

      // Determine the position based on available properties
      const left = (bb.minX !== undefined ? bb.minX : bb.x) * width;
      const top = (bb.minY !== undefined ? bb.minY : bb.y) * height;
      const boxWidth = bb.width * width;
      const boxHeight = bb.height * height;

      // Create bounding box rectangle with dashed/solid line based on confidence and enhancement
      const strokeStyle = [];
      if (obj.enhancedBySemanticAnalysis && !obj.enhancedByStrokes) {
        // Semantic-only: dots and dashes
        strokeStyle.push(2, 2, 5, 2);
      } else if (!obj.enhancedBySemanticAnalysis && obj.enhancedByStrokes) {
        // Strokes-only: long dashes
        strokeStyle.push(10, 5);
      } else if (obj.enhancedBySemanticAnalysis && obj.enhancedByStrokes) {
        // Combined enhancement: solid line
        // Leave strokeStyle empty for solid line
      } else {
        // Default: regular dashes
        strokeStyle.push(5, 5);
      }

      const boxRect = new fabric.Rect({
        left,
        top,
        width: boxWidth,
        height: boxHeight,
        fill: 'transparent',
        stroke: color,
        strokeWidth: obj.enhancedByStrokes || obj.enhancedBySemanticAnalysis ? 2.5 : 2,
        strokeDashArray: strokeStyle.length > 0 ? strokeStyle : undefined,
        rx: 3,
        ry: 3,
        objectId: obj.id || `obj_${index}`,
        selectable: false,
        hoverCursor: 'default'
      });

      // Create enhancement indicator based on the enhancement source
      let enhancementIndicator = '';
      if (obj.enhancedBySemanticAnalysis && obj.enhancedByStrokes) {
        enhancementIndicator = ' (S+D)'; // Semantic + Data
      } else if (obj.enhancedBySemanticAnalysis) {
        enhancementIndicator = ' (S)'; // Semantic
      } else if (obj.enhancedByStrokes) {
        enhancementIndicator = ' (D)'; // Data/Strokes
      }

      // Create label background with enhancement indicator
      const labelText = `${obj.name}${enhancementIndicator}`;
      const labelWidth = Math.max(labelText.length * 8 + 16, 60);

      const labelBg = new fabric.Rect({
        left,
        top: top - 25,
        width: labelWidth,
        height: 20,
        fill: color,
        rx: 3,
        ry: 3,
        selectable: false,
        hoverCursor: 'default'
      });

      // Create text label
      const label = new fabric.Text(labelText, {
        left: left + 8,
        top: top - 23,
        fontSize: 12,
        fontFamily: 'sans-serif',
        fill: '#FFFFFF',
        selectable: false,
        hoverCursor: 'default'
      });

      // Add to canvas
      fabricCanvas.add(boxRect);
      fabricCanvas.add(labelBg);
      fabricCanvas.add(label);

      // Track rendered objects
      objectsRendered.push({
        rect: boxRect,
        labelBg,
        label,
        objectId: obj.id || `obj_${index}`
      });

      // Add corner position indicators in debug mode
      if (debugMode) {
        // Add small dots at bounding box corners
        const cornerSize = 4;
        const corners = [
          { x: left, y: top }, // Top-left
          { x: left + boxWidth, y: top }, // Top-right
          { x: left, y: top + boxHeight }, // Bottom-left
          { x: left + boxWidth, y: top + boxHeight } // Bottom-right
        ];

        corners.forEach((corner, idx) => {
          const dot = new fabric.Circle({
            left: corner.x - cornerSize/2,
            top: corner.y - cornerSize/2,
            radius: cornerSize,
            fill: color,
            stroke: '#FFFFFF',
            strokeWidth: 1,
            selectable: false
          });
          fabricCanvas.add(dot);
        });
      }
    });

    // If we have objects detected, show status tag with count
    renderStatusTag();

    // Render the canvas
    fabricCanvas.renderAll();

    // Optionally visualize the stroke-to-object mapping for debugging
    if (debugMode) {
      renderStrokeAssociations(objectsToRender);
    }
  }

  // Render status tag showing analysis state
  function renderStatusTag() {
    if (!fabricCanvas || !initialized || !visible) return;

    // Remove any existing status tag
    const existingTags = fabricCanvas.getObjects().filter(obj => (obj as ExtendedFabricObject).statusTag === true);
    existingTags.forEach(tag => fabricCanvas.remove(tag));

    if (!showStatusTag) return;

    // Position in the top-right corner with some padding
    const padding = 10;
    const tagTop = padding;
    const tagHeight = 36; // Slightly taller for better appearance

    let tagText = '';
    let tagColor = '';
    let tagWidth = 0;
    let showSpinner = false;
    let useAIAnimation = false;

    // Filter objects to count only non-TensorFlow objects
    const nonTFObjects = detectedObjects.filter(obj => {
      // Check both detectionSource and source properties
      const source = obj.detectionSource || obj.source || '';
      // Return true for objects that are NOT from tensorflow or CNN
      return !(
        source === 'tensorflow' ||
        source === 'cnn' ||
        source.includes('sketch-cnn') ||
        obj.enhancedByCNN === true
      );
    });

    if (isAnalyzing) {
      // Show analyzing status
      tagText = 'Analyzing with AI...';
      tagColor = 'rgba(156, 39, 176, 0.9)'; // Purple for AI
      tagWidth = 150;
      showSpinner = true;
      useAIAnimation = true;
    } else if (nonTFObjects && nonTFObjects.length > 0) {
      // Show detected objects count - include source information
      const count = nonTFObjects.length;
      tagText = `${count} AI-detected object${count !== 1 ? 's' : ''}`;
      tagColor = 'rgba(156, 39, 176, 0.9)'; // Purple for AI
      tagWidth = Math.max(tagText.length * 7 + 30, 180);
    } else if (waitingForInput) {
      // Show waiting for input status
      tagText = 'Waiting for AI analysis';
      tagColor = 'rgba(156, 39, 176, 0.9)'; // Purple
      tagWidth = 170;
    } else {
      // If no objects detected and not analyzing, don't show tag
      return;
    }

    // Position from right edge
    const tagLeft = width - tagWidth - padding;

    // Create background rectangle with improved styling
    const tagBg = new fabric.Rect({
      left: tagLeft,
      top: tagTop,
      width: tagWidth,
      height: tagHeight,
      fill: tagColor,
      rx: 6,
      ry: 6,
      selectable: false,
      hoverCursor: 'default',
      statusTag: true, // Mark as status tag for easy identification
      shadow: new fabric.Shadow({
        color: 'rgba(0,0,0,0.3)',
        offsetX: 1,
        offsetY: 1,
        blur: 5
      }),
      opacity: 0 // Start with opacity 0 for fade-in effect
    });

    // Create the text label with improved styling
    const labelText = new fabric.Text(tagText, {
      left: tagLeft + (showSpinner ? 40 : 28),
      top: tagTop + 8,
      fontSize: 15,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontWeight: 'bold',
      fill: '#FFFFFF',
      selectable: false,
      hoverCursor: 'default',
      statusTag: true,
      opacity: 0 // Start with opacity 0 for fade-in effect
    });

    // Add to canvas
    fabricCanvas.add(tagBg);
    fabricCanvas.add(labelText);

    // Create AI-specific animation instead of simple emoji spinner
    if (showSpinner) {
      if (useAIAnimation) {
        // Create AI animation elements
        const circleRadius = 8;
        const circleSpacing = 18;
        const startX = tagLeft + 20;
        const centerY = tagTop + tagHeight/2;

        // Create pulsing circles
        for (let i = 0; i < 3; i++) {
          const circle = new fabric.Circle({
            left: startX + i * circleSpacing - circleRadius,
            top: centerY - circleRadius,
            radius: circleRadius,
            fill: '#FFFFFF',
            selectable: false,
            hoverCursor: 'default',
            statusTag: true,
            opacity: 0,
            aiAnimationIndex: i // Store animation index
          });
          fabricCanvas.add(circle);
        }

        // Animate circles with pulse effect
        animateAICircles();
      } else {
        // Create simple spinner as fallback
        const icon = new fabric.Text('⚙️', {
          left: tagLeft + 12,
          top: tagTop + 8,
          fontSize: 16,
          fontFamily: 'sans-serif',
          fill: '#FFFFFF',
          selectable: false,
          hoverCursor: 'default',
          statusTag: true,
          opacity: 0
        });
        fabricCanvas.add(icon);
        animateSpinner(icon);
      }
    }

    // Fade in animation
    let fadeInAnimationId: number | null = null;
    const fadeIn = () => {
      // Safety check - ensure the canvas still exists and is valid
      if (!fabricCanvas || !fabricCanvas.getContext()) {
        if (fadeInAnimationId) {
          cancelAnimationFrame(fadeInAnimationId);
          activeAnimationFrames = activeAnimationFrames.filter(id => id !== fadeInAnimationId);
          fadeInAnimationId = null;
        }
        return;
      }

      try {
      const statusElements = fabricCanvas.getObjects().filter(obj => (obj as ExtendedFabricObject).statusTag === true);

        if (!statusElements.length) {
          // No elements to animate, cancel animation
          if (fadeInAnimationId) {
            cancelAnimationFrame(fadeInAnimationId);
            activeAnimationFrames = activeAnimationFrames.filter(id => id !== fadeInAnimationId);
            fadeInAnimationId = null;
          }
          return;
        }

      statusElements.forEach(el => {
          if (el) {
        const currentOpacity = el.get('opacity') || 0;
        const newOpacity = Math.min(1, currentOpacity + 0.1);
        el.set('opacity', newOpacity);
          }
      });

        // Check again before rendering
        if (fabricCanvas && fabricCanvas.getContext()) {
      fabricCanvas.renderAll();

      if (statusElements[0] && statusElements[0].get('opacity') < 1) {
            fadeInAnimationId = requestAnimationFrame(fadeIn);
            // Track the animation frame
            if (fadeInAnimationId) {
              activeAnimationFrames.push(fadeInAnimationId);
            }
          } else {
            fadeInAnimationId = null;
          }
        } else {
          // Canvas has become invalid
          if (fadeInAnimationId) {
            cancelAnimationFrame(fadeInAnimationId);
            activeAnimationFrames = activeAnimationFrames.filter(id => id !== fadeInAnimationId);
            fadeInAnimationId = null;
          }
        }
      } catch (error) {
        console.error('Error during fadeIn animation:', error);
        if (fadeInAnimationId) {
          cancelAnimationFrame(fadeInAnimationId);
          activeAnimationFrames = activeAnimationFrames.filter(id => id !== fadeInAnimationId);
          fadeInAnimationId = null;
        }
      }
    };

    // Start the animation with proper safety checks
    if (fabricCanvas && fabricCanvas.getContext()) {
    fadeIn();
    }
  }

  // Create an AI animation with pulsing circles
  function animateAICircles() {
    if (!fabricCanvas || !fabricCanvas.getContext()) return;

    const circles = fabricCanvas.getObjects().filter(obj =>
      (obj as ExtendedFabricObject).statusTag === true &&
      (obj as ExtendedFabricObject).aiAnimationIndex !== undefined
    );

    if (circles.length === 0) return;

    let animationFrameId: number | null = null;
    const animationDuration = 1200; // ms for full animation cycle
    const startTime = Date.now();

    const animate = () => {
      // Safety check - ensure we should continue animation
      if (!isAnalyzing || !fabricCanvas || !fabricCanvas.getContext()) {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
          activeAnimationFrames = activeAnimationFrames.filter(id => id !== animationFrameId);
          animationFrameId = null;
        }
        return;
      }

      try {
      const elapsed = (Date.now() - startTime) % animationDuration;
      const progress = elapsed / animationDuration;

      circles.forEach((circle, i) => {
          if (circle) {
        // Calculate individual circle animation offset
        const offsetProgress = (progress + i * 0.2) % 1;

        // Pulse effect - grow and shrink
        const scale = 0.7 + Math.sin(offsetProgress * Math.PI) * 0.5;
        circle.set({
          scaleX: scale,
          scaleY: scale,
          opacity: Math.sin(offsetProgress * Math.PI) * 0.5 + 0.5
        });
          }
      });

        // Check again before rendering
        if (fabricCanvas && fabricCanvas.getContext()) {
      fabricCanvas.renderAll();
      animationFrameId = requestAnimationFrame(animate);
          // Track the animation frame
          if (animationFrameId) {
            activeAnimationFrames.push(animationFrameId);
          }
        } else {
          if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            activeAnimationFrames = activeAnimationFrames.filter(id => id !== animationFrameId);
            animationFrameId = null;
          }
        }
      } catch (error) {
        console.error('Error during AI circles animation:', error);
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
          activeAnimationFrames = activeAnimationFrames.filter(id => id !== animationFrameId);
          animationFrameId = null;
        }
      }
    };

    animate();
  }

  // Legacy spinner animation for fallback
  function animateSpinner(icon) {
    if (!icon) return;

    let angle = 0;
    let spinId: number | null = null;

    const animate = () => {
      // Check if we should continue animation
      if (!isAnalyzing || !icon || !fabricCanvas || !fabricCanvas.getContext()) {
        if (spinId) {
          cancelAnimationFrame(spinId);
          activeAnimationFrames = activeAnimationFrames.filter(id => id !== spinId);
          spinId = null;
        }
        return;
      }

      try {
      angle = (angle + 5) % 360;
      icon.set({ angle });

        // Check again before rendering
        if (fabricCanvas && fabricCanvas.getContext()) {
          fabricCanvas.renderAll();
      spinId = requestAnimationFrame(animate);
          // Track the animation frame
          if (spinId) {
            activeAnimationFrames.push(spinId);
          }
        } else {
          if (spinId) {
            cancelAnimationFrame(spinId);
            activeAnimationFrames = activeAnimationFrames.filter(id => id !== spinId);
            spinId = null;
          }
        }
      } catch (error) {
        console.error('Error during spinner animation:', error);
        if (spinId) {
          cancelAnimationFrame(spinId);
          activeAnimationFrames = activeAnimationFrames.filter(id => id !== spinId);
          spinId = null;
        }
      }
    };

    animate();
  }

  function updateCanvasSize() {
    if (!fabricCanvas || !overlayCanvas) return;

    // Get the actual size of the drawing canvas (both internal and display size)
    if (canvasRef) {
      const drawingCanvas = canvasRef;
      const displayWidth = drawingCanvas.clientWidth || drawingCanvas.offsetWidth || width;
      const displayHeight = drawingCanvas.clientHeight || drawingCanvas.offsetHeight || height;

      // Get the internal resolution of the drawing canvas
      const internalWidth = drawingCanvas.width;
      const internalHeight = drawingCanvas.height;

      // Set the internal dimensions to match the drawing canvas internal resolution
      fabricCanvas.setWidth(internalWidth);
      fabricCanvas.setHeight(internalHeight);

      // Set the CSS display size to match the drawing canvas display size
      overlayCanvas.style.width = `${displayWidth}px`;
      overlayCanvas.style.height = `${displayHeight}px`;

      // Update the container dimensions
      if (containerElement) {
        containerElement.style.width = `${displayWidth}px`;
        containerElement.style.height = `${displayHeight}px`;
      }
    } else {
      // Fallback to passed props if canvasRef is not available
      fabricCanvas.setWidth(width);
      fabricCanvas.setHeight(height);

      overlayCanvas.style.width = `${width}px`;
      overlayCanvas.style.height = `${height}px`;

      if (containerElement) {
        containerElement.style.width = `${width}px`;
        containerElement.style.height = `${height}px`;
      }
    }

    // Update positions of all objects based on new dimensions
    renderObjects();

    // Mark the time of this update
    lastUpdateTime = Date.now();
  }

  // Optionally visualize the stroke-to-object mapping for debugging
  function renderStrokeAssociations(enhancedObjects) {
    if (!fabricCanvas || !strokes || !strokes.length) return;

    // Only render debug visualization in development mode
    if (import.meta.env?.MODE !== 'development') return;

    // Find segmented objects
    const segmentedObjects = enhancedObjects.filter(obj =>
      obj.enhancedBySegments || obj.structureEstimation);

    // Draw connection lines for standard objects
    enhancedObjects.forEach((obj, index) => {
      if (!obj.strokeIds || (!obj.enhancedByStrokes && !obj.enhancedBySegments)) return;

      // Find all related strokes
      const relatedStrokes = strokes.filter(s =>
        obj.strokeIds.includes(s.id || ''));

      // Draw connecting lines between object center and stroke centers
      if (relatedStrokes.length > 0) {
        const objCenterX = obj.boundingBox.centerX * width;
        const objCenterY = obj.boundingBox.centerY * height;

        relatedStrokes.forEach(stroke => {
          if (!stroke.points || stroke.points.length === 0) return;

          // Calculate stroke center
          let strokeCenterX = 0, strokeCenterY = 0;
          let pointCount = 0;

          stroke.points.forEach(point => {
            const x = point.x !== undefined ? point.x : point[0];
            const y = point.y !== undefined ? point.y : point[1];

            strokeCenterX += x;
            strokeCenterY += y;
            pointCount++;
          });

          if (pointCount > 0) {
            strokeCenterX = (strokeCenterX / pointCount) * width;
            strokeCenterY = (strokeCenterY / pointCount) * height;

            // Draw connection line with special styling for segments
            const line = new fabric.Line([
              objCenterX, objCenterY,
              strokeCenterX, strokeCenterY
            ], {
              stroke: obj.enhancedBySegments ? 'rgba(255,165,0,0.6)' : 'rgba(0,200,255,0.3)',
              strokeWidth: obj.enhancedBySegments ? 2 : 1,
              strokeDashArray: obj.enhancedBySegments ? [4, 4] : [2, 2],
              selectable: false
            });

            fabricCanvas.add(line);
          }
        });
      }
    });

    // For segment-based detection, add extra visualization
    segmentedObjects.forEach(obj => {
      if (!obj.strokeIds || !obj.boundingBox) return;

      // Find stroke segments if present
      const segments = strokes.filter(s =>
        s.isSegment && obj.strokeIds.includes(s.id || ''));

      if (segments.length > 0) {
        // Mark the segments with highlighted points
        segments.forEach(segment => {
          if (!segment.points) return;

          // Draw segment start and end points
          const startPoint = segment.points[0];
          const endPoint = segment.points[segment.points.length - 1];

          if (startPoint && endPoint) {
            // Start marker (green diamond)
            const startX = (startPoint.x !== undefined ? startPoint.x : startPoint[0]) * width;
            const startY = (startPoint.y !== undefined ? startPoint.y : startPoint[1]) * height;

            const startMarker = new fabric.Rect({
              left: startX - 4,
              top: startY - 4,
              width: 8,
              height: 8,
              fill: 'rgba(0,255,0,0.8)',
              angle: 45,
              selectable: false
            });

            // End marker (red diamond)
            const endX = (endPoint.x !== undefined ? endPoint.x : endPoint[0]) * width;
            const endY = (endPoint.y !== undefined ? endPoint.y : endPoint[1]) * height;

            const endMarker = new fabric.Rect({
              left: endX - 4,
              top: endY - 4,
              width: 8,
              height: 8,
              fill: 'rgba(255,0,0,0.8)',
              angle: 45,
              selectable: false
            });

            fabricCanvas.add(startMarker);
            fabricCanvas.add(endMarker);

            // Draw semi-transparent path along segment
            const segmentPath = new fabric.Polyline(
              segment.points.map(p => ({
                x: (p.x !== undefined ? p.x : p[0]) * width,
                y: (p.y !== undefined ? p.y : p[1]) * height
              })),
              {
                stroke: 'rgba(255,165,0,0.4)',
                strokeWidth: 3,
                fill: 'transparent',
                selectable: false
              }
            );

            fabricCanvas.add(segmentPath);
          }
        });
      }

      // If this is a structure estimation, show it differently
      if (obj.structureEstimation) {
        const bb = obj.boundingBox;
        const left = bb.minX * width;
        const top = bb.minY * height;
        const boxWidth = bb.width * width;
        const boxHeight = bb.height * height;

        // Draw dotted rectangle to indicate estimation
        const estimationRect = new fabric.Rect({
          left,
          top,
          width: boxWidth,
          height: boxHeight,
          fill: 'transparent',
          stroke: 'rgba(255,0,255,0.7)',
          strokeWidth: 1.5,
          strokeDashArray: [3, 3],
          selectable: false
        });

        fabricCanvas.add(estimationRect);

        // Add "EST" label
        const estimationLabel = new fabric.Text("EST", {
          left: left + 5,
          top: top + 5,
          fontSize: 10,
          fontFamily: 'sans-serif',
          fill: 'rgba(255,0,255,0.7)',
          selectable: false
        });

        fabricCanvas.add(estimationLabel);
      }
    });
  }

  function toggleVisibility() {
    if (!overlayCanvas) return;
    overlayCanvas.style.display = visible ? 'block' : 'none';

    if (visible && fabricCanvas) {
      renderObjects();
    }
  }

  function syncWithDrawingCanvas() {
    if (!canvasRef || !overlayCanvas || !containerElement) return;

    try {
      // Get the drawing canvas position relative to its container
      const rect = canvasRef.getBoundingClientRect();
      const parentRect = canvasRef.parentElement ? canvasRef.parentElement.getBoundingClientRect() : rect;

      // Calculate the offset of the drawing canvas within its container
      const offsetLeft = rect.left - parentRect.left;
      const offsetTop = rect.top - parentRect.top;

      // Apply the same offset to the overlay
      containerElement.style.left = `${offsetLeft}px`;
      containerElement.style.top = `${offsetTop}px`;

      // Update size to match drawing canvas
      updateCanvasSize();
      initialSyncDone = true;
    } catch (error) {
      console.error('Error syncing overlay with drawing canvas:', error);
    }
  }

  // Setup resize observer to watch the drawing canvas for size changes
  function setupResizeObserver() {
    if (!canvasRef || typeof ResizeObserver === 'undefined') return;

    // Clean up existing observer if it exists
    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    resizeObserver = new ResizeObserver((entries) => {
      // Throttle updates to improve performance
      if (Date.now() - lastUpdateTime < 16) { // ~60fps
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(syncWithDrawingCanvas, 16);
        return;
      }

      syncWithDrawingCanvas();
    });

    try {
      resizeObserver.observe(canvasRef);

      // Also observe parent element to detect position changes
      if (canvasRef.parentElement) {
        resizeObserver.observe(canvasRef.parentElement);
      }
    } catch (error) {
      console.error('Error setting up ResizeObserver:', error);
    }
  }

  // Setup window resize handler as a fallback
  function handleWindowResize() {
    // Throttle updates to improve performance
    if (Date.now() - lastUpdateTime < 16) { // ~60fps
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(syncWithDrawingCanvas, 16);
      return;
    }

    syncWithDrawingCanvas();
  }

  // Check if the element is actually visible in the DOM
  function isElementVisible(element) {
    if (!element) return false;

    // Check if element has zero size
    if (element.offsetWidth === 0 || element.offsetHeight === 0) {
      return false;
    }

    // Check visibility via computed style
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }

    return true;
  }

  // Force a sync after a slight delay (useful for components that might render late)
  function deferredSync() {
    setTimeout(() => {
      if (canvasRef && overlayCanvas && isElementVisible(canvasRef) && !initialSyncDone) {
        syncWithDrawingCanvas();
      }
    }, 100);
  }

  // Initialize canvas when mounted
  onMount(() => {
    initFabricCanvas();

    // Setup resize observers and listeners
    setupResizeObserver();
    window.addEventListener('resize', handleWindowResize);

    // Initial sync with drawing canvas
    syncWithDrawingCanvas();

    // Additional deferred sync to catch late renders
    deferredSync();
  });

  // Cleanup on destroy
  onDestroy(() => {
    if (fabricCanvas) {
      fabricCanvas.dispose();
    }

    // Clean up resize observers and listeners
    if (resizeObserver) {
      try {
        if (canvasRef) resizeObserver.unobserve(canvasRef);
        if (canvasRef && canvasRef.parentElement) resizeObserver.unobserve(canvasRef.parentElement);
        resizeObserver.disconnect();
      } catch (error) {
        console.error('Error cleaning up ResizeObserver:', error);
      }
    }

    // Cancel all active animation frames
    if (activeAnimationFrames.length > 0) {
      console.log(`Cleaning up ${activeAnimationFrames.length} animation frames`);
      activeAnimationFrames.forEach(id => {
        try {
          cancelAnimationFrame(id);
        } catch (e) {
          console.error('Error cancelling animation frame:', e);
        }
      });
      activeAnimationFrames = [];
    }

    if (resizeTimeout) {
      clearTimeout(resizeTimeout);
    }

    if (renderDebounceTimer) {
      clearTimeout(renderDebounceTimer);
    }

    if (statusTagTimer) {
      clearTimeout(statusTagTimer);
    }

    window.removeEventListener('resize', handleWindowResize);
  });

  // Handle size changes
  $: if (initialized && (width || height)) {
    updateCanvasSize();
  }

  // Debounced and optimized rendering for detected objects & strokes
  $: if (initialized && (detectedObjects || strokes)) {
    // Clear any existing debounce timer
    if (renderDebounceTimer) {
      clearTimeout(renderDebounceTimer);
    }

    // Skip full rendering if we're showing the "waiting for input" state
    const skipFullRender = waitingForInput && detectedObjects.length === 0;
    if (skipFullRender) {
      // Just ensure the status tag is shown
      showStatusTag = true;
      renderStatusTag();
    } else {
      // Check if we need to re-render based on data changes
      const objectsChanged = hasDetectedObjectsChanged();
      const strokesChanged = lastStrokesLength !== strokes.length;
      const analysisStateChanged = isAnalyzing !== wasAnalyzing;

      if (objectsChanged || strokesChanged || analysisStateChanged) {
        // Debounce the render by 100ms to avoid excessive re-renders
        renderDebounceTimer = setTimeout(() => {
          // Only do a full objects re-render if objects or strokes changed
          if (objectsChanged || strokesChanged) {
            renderObjects();
          } else if (analysisStateChanged) {
            // If only the analyzing state changed, just update the status tag
            renderStatusTag();
          }

          // Update our tracking variables
          lastDetectedObjects = [...detectedObjects];
          lastStrokesLength = strokes.length;
          wasAnalyzing = isAnalyzing;
        }, 100);
      }
    }
  }

  // Handle visibility changes immediately
  $: if (initialized && visible !== undefined) {
    toggleVisibility();
  }

  // Re-sync when canvas reference changes
  $: if (canvasRef && initialized) {
    syncWithDrawingCanvas();
    setupResizeObserver();
  }

  // Update status tag when the analysis state changes
  $: if (initialized && fabricCanvas) {
    // Make status tag visible again when analysis state changes
    showStatusTag = true;
    renderStatusTag();
  }

  // Re-initialize if canvas reference changes
  afterUpdate(() => {
    if (overlayCanvas && !initialized) {
      initFabricCanvas();
    }

    // Attempt to sync again if not already done
    if (canvasRef && overlayCanvas && !initialSyncDone) {
      deferredSync();
    }
  });
</script>

<div
  bind:this={containerElement}
  class="ai-overlay-container"
  style="position: absolute; top: 0; left: 0; width: {width}px; height: {height}px; pointer-events: none; z-index: 10; overflow: hidden;"
>
  <canvas
    bind:this={overlayCanvas}
    width={width}
    height={height}
    style="position: absolute; top: 0; left: 0; pointer-events: none;"
  ></canvas>
</div>

<style>
  .ai-overlay-container {
    overflow: hidden;
    position: absolute;
  }
</style>
