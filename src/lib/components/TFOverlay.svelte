<!--
  TFOverlay.svelte
  This component displays TensorFlow and CNN detected objects on the canvas
  It's a companion to AIOverlay.svelte which handles GPT-4V and basic shape recognition
-->
<script lang="ts">
  import { fabric } from 'fabric';
  import { onMount, onDestroy, createEventDispatcher, afterUpdate } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import debounce from 'lodash/debounce';
  import type { DetectedObject } from '$lib/types/detectedObject';
  import type { Stroke } from '$lib/types/drawing';

  // Simple deep equal utility since we're missing the imported one
  function deepEqual(objA: any, objB: any, threshold = 0): boolean {
    // Handle primitive types
    if (typeof objA !== 'object' || typeof objB !== 'object' ||
        objA === null || objB === null) {
      if (threshold > 0 && typeof objA === 'number' && typeof objB === 'number') {
        return Math.abs(objA - objB) <= threshold;
      }
      return objA === objB;
    }

    // Check if both are arrays
    if (Array.isArray(objA) && Array.isArray(objB)) {
      if (objA.length !== objB.length) return false;
      for (let i = 0; i < objA.length; i++) {
        if (!deepEqual(objA[i], objB[i], threshold)) return false;
      }
      return true;
    }

    // Compare object keys
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);

    if (keysA.length !== keysB.length) return false;

    // Check each key
    for (const key of keysA) {
      if (!keysB.includes(key)) return false;
      if (!deepEqual(objA[key], objB[key], threshold)) return false;
    }

    return true;
  }

  // Define custom fabric object type for status tag
  // @ts-ignore - Fabric.js needs custom class definition
  fabric.StatusTag = fabric.util.createClass(fabric.Group, {
    type: 'statusTag',
    initialize: function(objects, options) {
      this.callSuper('initialize', objects, options);
      this.set('selectable', false);
      this.set('evented', false);
    }
  });

  // Props
  export let analysisObjects: DetectedObject[] = [];
  export let strokes: Stroke[] = [];
  export let canvasWidth: number;
  export let canvasHeight: number;
  export let visible: boolean = true;
  export let waitingForInput: boolean = false;
  export let isAnalyzing: boolean = false;
  export let canvasZoom: number = 1;

  // Local state
  let canvasEl: HTMLCanvasElement;
  let canvas: fabric.Canvas;
  // @ts-ignore - Custom fabric class
  let statusTag: any;
  let previousAnalysisObjects: DetectedObject[] = [];
  let previousStrokes: Stroke[] = [];
  let wasAnalyzing = false;
  let renderDebounce: ReturnType<typeof debounce>;
  let skipFullRender = false;
  let rendered = false;
  let objectCount = 0;
  let lastRenderedObjectsHash = '';
  let renderTimeout;
  let statusTagVisible = false;
  let animateStatusTag = false;
  let statusTagText = '';
  let renderDebounceTimeout;

  const dispatch = createEventDispatcher();

  function hasAnalysisObjectsChanged(
    newObjs: DetectedObject[],
    oldObjs: DetectedObject[]
  ): boolean {
    // Quick length check first
    if (newObjs.length !== oldObjs.length) return true;

    // For each object, compare key properties including bounding box
    for (let i = 0; i < newObjs.length; i++) {
      const newObj = newObjs[i];
      const oldObj = oldObjs[i];

      // Compare essential properties
      if (
        newObj.id !== oldObj.id ||
        newObj.name !== oldObj.name ||
        newObj.confidence !== oldObj.confidence ||
        !deepEqual(newObj.boundingBox, oldObj.boundingBox, 0.05) // 5% threshold for bounding box changes
      ) {
        return true;
      }
    }

    return false;
  }

  // Define colors for objects based on source
  const getColorForObject = (obj: DetectedObject) => {
    const source = (obj.detectionSource || obj.source || '').toLowerCase();
    if (source === 'tensorflow') {
      // Standard TF model (COCO-SSD/BlazeFace)
      return '#FF9800'; // Orange
    } else if (source === 'cnn' || source.includes('sketch-cnn')) {
      // Custom CNN model
      return '#FFC107'; // Amber
    } else if (source === 'quickdraw') {
      // QuickDraw model (often TF-based but sketch-specific)
      return '#4CAF50'; // Green
    } else if (source === 'shape-recognition') {
      // Geometric analysis
      return '#2196F3'; // Blue
    } else if (source === 'openai') {
      // OpenAI Vision enhancement
      return '#9C27B0'; // Purple
    } else {
      return '#FFD54F'; // Yellow/amber light - fallback
    }
  };

  function initCanvas() {
    if (!canvasEl) return;

    // Initialize Fabric.js canvas
    canvas = new fabric.Canvas(canvasEl, {
      selection: false,
      renderOnAddRemove: true,
      width: canvasWidth,
      height: canvasHeight
    });

    // Initial render
    renderObjects();
  }

  function calculateProximity(stroke: Stroke, obj: DetectedObject): number {
    if (!stroke.points.length || !obj.boundingBox) return Infinity;

    // Calculate stroke center
    let strokeCenterX = 0;
    let strokeCenterY = 0;

    stroke.points.forEach(point => {
      strokeCenterX += point.x;
      strokeCenterY += point.y;
    });

    strokeCenterX /= stroke.points.length;
    strokeCenterY /= stroke.points.length;

    // Calculate object center
    const bb = obj.boundingBox;
    const objCenterX = bb.minX + bb.width / 2;
    const objCenterY = bb.minY + bb.height / 2;

    // Calculate Euclidean distance
    const distance = Math.sqrt(
      Math.pow(strokeCenterX - objCenterX, 2) +
      Math.pow(strokeCenterY - objCenterY, 2)
    );

    return distance;
  }

  function findRelatedStrokes(obj: DetectedObject): Stroke[] {
    if (!strokes || !obj.boundingBox) return [];

    // Find strokes that are likely part of this object
    // Calculate distances to determine which strokes are closest to object
    const proximities = strokes.map(stroke => ({
      stroke,
      proximity: calculateProximity(stroke, obj)
    }));

    // Sort by proximity - closest first
    proximities.sort((a, b) => a.proximity - b.proximity);

    // Get the closest strokes - 40% of the strokes or a max of 3
    const threshold = Math.max(Math.floor(strokes.length * 0.4), 3);
    return proximities.slice(0, threshold).map(p => p.stroke);
  }

  function calculateObjectStrokeAssociations() {
    return analysisObjects.map(obj => ({
      object: obj,
      relatedStrokes: findRelatedStrokes(obj)
    }));
  }

  function renderStatusTag() {
    if (!canvas) return;

    // Remove existing status tag if it exists
    if (statusTag) {
      canvas.remove(statusTag);
    }

    // Count all analysis objects received by this overlay
    const count = analysisObjects.length;

    let text = '';
    if (isAnalyzing) {
      text = 'AI analyzing drawing...';
    } else if (waitingForInput) {
      text = 'Waiting for input...';
    } else if (count === 0) {
      text = 'No objects recognized by AI analysis';
    } else {
      text = `${count} AI-recognized object${count !== 1 ? 's' : ''} found`;
    }

    // Create background
    const paddingX = 15;
    const paddingY = 8;

    const textObj = new fabric.Text(text, {
      fontSize: 14,
      fontFamily: 'Inter, system-ui, sans-serif',
      fill: '#1A1A1A',
      fontWeight: '500'
    });

    const width = textObj.width + paddingX * 2;
    const height = textObj.height + paddingY * 2;

    const rect = new fabric.Rect({
      width,
      height,
      rx: 8,
      ry: 8,
      fill: isAnalyzing ? '#E3F2FD' : waitingForInput ? '#F1F8E9' : '#FFF9C4',
      stroke: isAnalyzing ? '#90CAF9' : waitingForInput ? '#AED581' : '#FFF59D',
      strokeWidth: 1,
      shadow: '0 2px 4px rgba(0,0,0,0.1)'
    });

    // Position text in center of rectangle
    textObj.set({
      left: paddingX,
      top: paddingY
    });

    // Create icon
    let iconText;
    if (isAnalyzing) {
      iconText = '⟳';
    } else if (waitingForInput) {
      iconText = '✎';
    } else if (count === 0) {
      iconText = '⚠';
    } else {
      iconText = '✓';
    }

    const icon = new fabric.Text(iconText, {
      fontSize: 16,
      fontFamily: 'Arial, sans-serif',
      fill: isAnalyzing ? '#1565C0' : waitingForInput ? '#558B2F' : '#F57F17',
      left: 8,
      top: paddingY - 1,
      fontWeight: 'bold'
    });

    // Adjust text position for icon
    textObj.set({
      left: 30 // Adjust based on icon width
    });

    // Update rectange width for icon
    rect.set({
      width: width + 20
    });

    // Group the elements
    const objects = [rect, icon, textObj];
    // @ts-ignore - Fabric.js custom class
    statusTag = new fabric.StatusTag(objects, {
      left: 20,
      top: 20,
      selectable: false,
      originX: 'left',
      originY: 'top'
    });

    // Animate the status tag if analyzing
    if (isAnalyzing) {
      animateStatusTag = true;
      let angle = 0;
      function animate() {
        if (!canvas || !statusTag || !animateStatusTag) return;

        // Get the icon from the group
        const iconObj = statusTag.getObjects()[1];
        if (iconObj) {
          angle = (angle + 5) % 360;
          iconObj.set({
            angle: angle
          });
          canvas.renderAll();
          renderTimeout = requestAnimationFrame(animate);
        }
      }
      animate();
    } else {
      animateStatusTag = false;
    }

    canvas.add(statusTag);
    canvas.bringToFront(statusTag);

    // Update status tag text for future reference
    statusTagText = text;
  }

  function renderObjects() {
    if (!canvas || !visible) return;

    // Clear canvas
    canvas.clear();

    // If we're skipping a full render, just show the status tag
    if (skipFullRender) {
      if (waitingForInput || isAnalyzing || analysisObjects.length === 0) {
        renderStatusTag();
      }
      return;
    }

    // Calculate associations between objects and strokes
    const objStrokeAssociations = calculateObjectStrokeAssociations();

    // Count visible objects
    objectCount = analysisObjects.length;

    // First, render status tag to show info about objects
    renderStatusTag();

    // Then render objects and their bounding boxes
    objStrokeAssociations.forEach(({ object, relatedStrokes }) => {
      if (!object.boundingBox) return;

      const bb = object.boundingBox;

      // Calculate position and dimensions in canvas coordinates
      const left = bb.minX * canvasWidth;
      const top = bb.minY * canvasHeight;
      const boxWidth = bb.width * canvasWidth;
      const boxHeight = bb.height * canvasHeight;

      // Color based on source
      const color = getColorForObject(object);

      // Create bounding box with updated styling
      const rect = new fabric.Rect({
        left,
        top,
        width: boxWidth,
        height: boxHeight,
        stroke: color,
        strokeWidth: 2,
        fill: color + '1A',
        rx: 4,
        ry: 4,
        selectable: false,
        evented: false,
        objectCaching: false
      });

      // Create label
      const label = new fabric.Rect({
        left,
        top: top - 26,
        width: Math.min(Math.max(80, boxWidth * 0.7), 180),
        height: 24,
        fill: color,
        rx: 4,
        ry: 4,
        selectable: false,
        evented: false,
        shadow: '0 1px 3px rgba(0,0,0,0.2)'
      });

      // Create label text
      const labelText = new fabric.Text(object.name, {
        left: left + 8,
        top: top - 23,
        fontSize: 13,
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: '#FFFFFF',
        selectable: false,
        evented: false,
        fontWeight: '500'
      });

      // Add confidence if available
      if (object.confidence) {
        const confidenceText = new fabric.Text(`${Math.round(object.confidence * 100)}%`, {
          left: left + label.width - 25,
          top: top - 23,
          fontSize: 11,
          fontFamily: 'Inter, system-ui, sans-serif',
          fill: '#FFFFFF',
          selectable: false,
          evented: false,
          opacity: 0.85
        });
        canvas.add(confidenceText);
      }

      // Add a source label based on the object's source field
      const source = (object.detectionSource || object.source || 'AI').toUpperCase();
      const sourceLabel = new fabric.Text(source, {
        left: left + 5,
        top: top + 5,
        fontSize: 9,
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: '#FFFFFF',
        backgroundColor: color + 'B3',
        padding: 2,
        selectable: false,
        evented: false,
        opacity: 0.9
      });

      // Add elements to canvas
      canvas.add(rect, label, labelText, sourceLabel);
    });

    rendered = true;
  }

  // Handle resizing
  function updateCanvasDimensions() {
    if (!canvas) return;

    canvas.setDimensions({
      width: canvasWidth,
      height: canvasHeight
    });

    renderObjects();
  }

  // Initialize on component mount
  onMount(() => {
    initCanvas();

    // Initialize debounce function
    renderDebounce = debounce(() => {
      renderObjects();
    }, 100);

    // Set status tag visible
    statusTagVisible = true;
  });

  // Cleanup on component destroy
  onDestroy(() => {
    if (canvas) {
      canvas.dispose();
    }

    if (renderDebounce) {
      renderDebounce.cancel();
    }

    // Clear any pending timeouts
    if (renderDebounceTimeout) {
      clearTimeout(renderDebounceTimeout);
    }
  });

  // Watch for changes to props that should trigger a render
  $: {
    if (canvas) {
      // Track if things have changed enough to warrant a re-render
      const objChanged = hasAnalysisObjectsChanged(analysisObjects, previousAnalysisObjects);
      const strokesChanged = strokes.length !== previousStrokes.length;
      const analyzingChanged = isAnalyzing !== wasAnalyzing;

      // Show status tag without full render if waiting for input or analyzing
      skipFullRender = (waitingForInput || isAnalyzing) && !objChanged && !strokesChanged;

      // Always update status tag if analysis state changes
      if (analyzingChanged || waitingForInput) {
        renderStatusTag();
      }

      // Full render if objects/strokes changed, otherwise just refresh status
      if (objChanged || strokesChanged || analyzingChanged) {
        renderDebounce(skipFullRender);
      }

      // Update previous state
      previousAnalysisObjects = [...analysisObjects];
      previousStrokes = [...strokes];
      wasAnalyzing = isAnalyzing;
    }
  }

  // Watch for changes in canvas dimensions
  $: if (canvas && (canvasWidth || canvasHeight)) {
    updateCanvasDimensions();
  }

  // Watch for changes in visibility
  $: if (canvas) {
    canvas.getElement().style.display = visible ? 'block' : 'none';

    if (visible) {
      renderObjects();
    }
  }

  // Handle zoom changes
  $: if (canvas && canvasZoom) {
    canvas.setZoom(canvasZoom);
    canvas.renderAll();
  }

  // Run after the component updates
  afterUpdate(() => {
    if (canvas && statusTag && statusTagVisible) {
      renderStatusTag();
    }
  });
</script>

<div class="tf-overlay" class:hidden={!visible}>
  <canvas
    bind:this={canvasEl}
    width={canvasWidth}
    height={canvasHeight}
    class="tf-overlay-canvas"
  ></canvas>
</div>

<style>
  .tf-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
    z-index: 15;
  }

  .tf-overlay-canvas {
    position: absolute;
    top: 0;
    left: 0;
  }

  .hidden {
    display: none;
  }
</style>