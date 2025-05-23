<script lang="ts">
    import { Handle, Position, type NodeProps } from '@xyflow/svelte';
    import { useSvelteFlow } from '@xyflow/svelte';
    import { onMount, onDestroy } from 'svelte';
    import { writable } from 'svelte/store';
    import { getStroke } from 'perfect-freehand';
    import { getSvgPathFromStroke, calculatePressureFromVelocity } from '$lib/utils/drawingUtils.js';
    import { strokeOptions, selectedTool } from '$lib/stores/canvasStore.js';
    import { activeDrawingNodeId } from '$lib/stores/flowStores.js';

    type $$Props = NodeProps;

    export let id: $$Props['id'];
    export let data: $$Props['data'] = {};

    const { updateNodeData, updateNode, viewport } = useSvelteFlow();

    // Fabric.js instance
    let fabric: any = null;
    let nodeFabricCanvasHTML: HTMLCanvasElement;
    let nodeFabricInstance: any = null;

    // Perfect-freehand canvas
    let nodeInputCanvas: HTMLCanvasElement;
    let nodeInputCtx: CanvasRenderingContext2D | null = null;

    // Drawing state
    const isNodeDrawingMode = writable(false);
    let isDrawingPerfectFreehand = false;
    let currentPerfectFreehandStroke: any | null = null;
    let pointTimes: number[] = [];

    // Canvas dimensions (fixed for now, can be from props/data later)
    const canvasWidth = 240;
    const canvasHeight = 240;

    // Shared loaded state for Fabric.js script
    let fabricScriptLoaded = false;
    let fabricLoadPromise: Promise<void> | null = null;

    function loadFabricScriptOnce(): Promise<void> {
        if (fabricScriptLoaded && window.fabric) {
            fabric = window.fabric;
            return Promise.resolve();
        }
        if (fabricLoadPromise) {
            return fabricLoadPromise;
        }

        fabricLoadPromise = new Promise((resolve, reject) => {
            if (window.fabric) {
                fabric = window.fabric;
                fabricScriptLoaded = true;
                console.log('Fabric.js already available for node', id);
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = '/js/fabric.js'; // Ensure this path is correct in your public folder
            script.async = true;
            script.onload = () => {
                fabric = window.fabric;
                fabricScriptLoaded = true;
                console.log('Fabric.js loaded for node', id);
                resolve();
            };
            script.onerror = (err) => {
                console.error('Failed to load Fabric.js for node', id, err);
                fabricLoadPromise = null; // Allow retry
                reject(err);
            };
            document.head.appendChild(script);
        });
        return fabricLoadPromise;
    }

    async function initializeNodeCanvas() {
        if (!nodeFabricCanvasHTML || !nodeInputCanvas) {
            console.error('Node canvas elements not ready for node', id);
            return;
        }

        try {
            await loadFabricScriptOnce();
            if (!fabric) {
                console.error("Fabric library not loaded after promise resolution for node", id);
                return;
            }

            // Initialize Fabric.js canvas for this node
            nodeFabricInstance = new fabric.Canvas(nodeFabricCanvasHTML, {
                width: canvasWidth,
                height: canvasHeight,
                backgroundColor: '#f0f0f0',
                selection: false, // Initially not selectable
                skipTargetFind: true, // Initially don't find targets
                renderOnAddRemove: true,
            });

            // Set Fabric object defaults (optional, but good for consistency)
            fabric.Object.prototype.set({
                cornerStyle: 'circle',
                cornerColor: 'blue',
                transparentCorners: false,
                borderColor: 'blue',
                borderScaleFactor: 1.5,
            });

            // Load existing data if any
            if (data.fabricJson) {
                nodeFabricInstance.loadFromJSON(data.fabricJson, () => {
                    nodeFabricInstance.renderAll();
                    console.log('Fabric data loaded for node', id);
                });
            }

            // Initialize perfect-freehand canvas context
            nodeInputCtx = nodeInputCanvas.getContext('2d');
            if (nodeInputCtx) {
                nodeInputCtx.lineCap = 'round';
                nodeInputCtx.lineJoin = 'round';
            }

            console.log('Node canvas initialized for node', id);

        } catch (error) {
            console.error('Error initializing node canvas for node', id, ':', error);
        }
    }

    function handleToggleDrawModeButton() {
        const currentDrawingMode = $isNodeDrawingMode;

        if (!currentDrawingMode) {
            activeDrawingNodeId.set(id);
            isNodeDrawingMode.set(true);
            updateNode(id, { draggable: false });
            if (nodeFabricInstance) {
                nodeFabricInstance.selection = true;
                nodeFabricInstance.skipTargetFind = false;
            }
        } else {
            isNodeDrawingMode.set(false);
            if ($activeDrawingNodeId === id) {
                activeDrawingNodeId.set(null);
            }
            updateNode(id, { draggable: true });
            if (nodeFabricInstance) {
                nodeFabricInstance.selection = false;
                nodeFabricInstance.skipTargetFind = true;
                nodeFabricInstance.discardActiveObject()?.renderAll();
            }
        }
    }

    onMount(() => {
        initializeNodeCanvas();
        updateNode(id, { draggable: !$isNodeDrawingMode });
    });

    onDestroy(() => {
        if (nodeFabricInstance) {
            nodeFabricInstance.dispose();
            console.log('Fabric instance disposed for node', id);
        }
        if ($activeDrawingNodeId === id) {
            activeDrawingNodeId.set(null);
        }
    });

    $: if (activeDrawingNodeId && nodeFabricInstance) {
        if ($activeDrawingNodeId !== id && $isNodeDrawingMode) {
            isNodeDrawingMode.set(false);
            updateNode(id, { draggable: true });
            nodeFabricInstance.selection = false;
            nodeFabricInstance.skipTargetFind = true;
            nodeFabricInstance.discardActiveObject()?.renderAll();
            console.log(`Node ${id} automatically exited draw mode because node ${$activeDrawingNodeId} became active.`);
        }
    }

    function getPointerPosition(e: PointerEvent, canvasEl: HTMLCanvasElement): { x: number, y: number, pressure: number } {
        if (!canvasEl || !$viewport) return { x: 0, y: 0, pressure: 0.5 };

        const currentZoom = $viewport.zoom;
        const rect = canvasEl.getBoundingClientRect();

        const x = (e.clientX - rect.left) / currentZoom;
        const y = (e.clientY - rect.top) / currentZoom;

        return {
            x: x,
            y: y,
            pressure: e.pressure === 0.5 && e.pointerType !== 'pen' ? 0.5 : e.pressure
        };
    }

    function startPenStroke(e: PointerEvent) {
        if (!$isNodeDrawingMode || $selectedTool !== 'pen' || !nodeInputCtx) return;
        e.stopPropagation();

        isDrawingPerfectFreehand = true;
        const point = getPointerPosition(e, nodeInputCanvas);
        pointTimes = [Date.now()];

        const currentStrokeOpts = $strokeOptions;
        currentPerfectFreehandStroke = {
            tool: 'pen',
            points: [point],
            color: currentStrokeOpts.color,
            size: currentStrokeOpts.size,
            opacity: currentStrokeOpts.opacity,
            hasHardwarePressure: e.pointerType === 'pen' && e.pressure > 0 && e.pressure !== 0.5,
        };
    }

    function continuePenStroke(e: PointerEvent) {
        if (!$isNodeDrawingMode || !isDrawingPerfectFreehand || !currentPerfectFreehandStroke || !nodeInputCtx) return;
        e.stopPropagation();

        const point = getPointerPosition(e, nodeInputCanvas);
        pointTimes.push(Date.now());

        if (!currentPerfectFreehandStroke.hasHardwarePressure) {
            if (currentPerfectFreehandStroke.points.length > 1) {
                const calculatedPressure = calculatePressureFromVelocity(
                    currentPerfectFreehandStroke.points,
                    currentPerfectFreehandStroke.points.length - 1,
                    0.2,
                    true,
                    pointTimes
                );
                point.pressure = calculatedPressure;
            } else {
                point.pressure = 0.5;
            }
        }
        currentPerfectFreehandStroke.points.push(point);
        renderNodeStrokes();
    }

    function endPenStroke(e: PointerEvent) {
        if (!$isNodeDrawingMode || !isDrawingPerfectFreehand || !currentPerfectFreehandStroke || !nodeFabricInstance) return;
        e.stopPropagation();
        isDrawingPerfectFreehand = false;

        if (currentPerfectFreehandStroke.points.length > 1) {
            const currentStrokeOpts = $strokeOptions;
            const freehandStrokeOptions = {
                size: currentPerfectFreehandStroke.size,
                thinning: currentStrokeOpts.thinning,
                smoothing: currentStrokeOpts.smoothing,
                streamline: currentStrokeOpts.streamline,
                easing: currentStrokeOpts.easing,
                simulatePressure: !currentPerfectFreehandStroke.hasHardwarePressure,
                last: true,
                start: currentStrokeOpts.start,
                end: currentStrokeOpts.end,
            };

            const enhancedPoints = currentPerfectFreehandStroke.points.map((p: any) => [p.x, p.y, p.pressure || 0.5]);
            const strokePathOutline = getStroke(enhancedPoints, freehandStrokeOptions);
            const svgPathData = getSvgPathFromStroke(strokePathOutline);

            if (svgPathData && fabric) {
                const fabricPath = new fabric.Path(svgPathData, {
                    fill: currentPerfectFreehandStroke.color,
                    strokeWidth: 0,
                    opacity: currentPerfectFreehandStroke.opacity,
                    selectable: true,
                    evented: true,
                });
                nodeFabricInstance.add(fabricPath);
                nodeFabricInstance.requestRenderAll();

                const fabricJson = nodeFabricInstance.toJSON();
                updateNodeData(id, { ...data, fabricJson });
                console.log("Node data updated with new stroke for node", id);
            }
        }

        currentPerfectFreehandStroke = null;
        renderNodeStrokes();
    }

    function renderNodeStrokes() {
        if (!nodeInputCtx || !nodeInputCanvas) return;
        nodeInputCtx.clearRect(0, 0, nodeInputCanvas.width, nodeInputCanvas.height);

        if (currentPerfectFreehandStroke && currentPerfectFreehandStroke.points.length > 1 && $selectedTool === 'pen') {
            const currentStrokeOpts = $strokeOptions;
            const options = {
                size: currentPerfectFreehandStroke.size,
                thinning: currentStrokeOpts.thinning,
                smoothing: currentStrokeOpts.smoothing,
                streamline: currentStrokeOpts.streamline,
                easing: currentStrokeOpts.easing,
                simulatePressure: !currentPerfectFreehandStroke.hasHardwarePressure,
                last: false,
                start: currentStrokeOpts.start,
                end: currentStrokeOpts.end,
            };

            const enhancedPoints = currentPerfectFreehandStroke.points.map((p: any) => [p.x, p.y, p.pressure || 0.5]);
            const freehandStroke = getStroke(enhancedPoints, options);
            const pathData = getSvgPathFromStroke(freehandStroke);

            if (pathData) {
                const path2D = new Path2D(pathData);
                nodeInputCtx.fillStyle = currentPerfectFreehandStroke.color;
                nodeInputCtx.globalAlpha = currentPerfectFreehandStroke.opacity;
                nodeInputCtx.fill(path2D);
                nodeInputCtx.globalAlpha = 1;
            }
        }
    }

    $: if (nodeFabricInstance && fabric) {
        if ($isNodeDrawingMode) {
            if ($selectedTool === 'pen') {
                nodeFabricInstance.isDrawingMode = false;
                if (nodeInputCanvas) nodeInputCanvas.style.pointerEvents = 'auto';
                if (nodeFabricCanvasHTML) nodeFabricCanvasHTML.style.pointerEvents = 'none';
            } else if ($selectedTool === 'eraser') {
                nodeFabricInstance.isDrawingMode = true;
                if (!nodeFabricInstance.freeDrawingBrush || !(nodeFabricInstance.freeDrawingBrush instanceof fabric.EraserBrush)) {
                    if (fabric.EraserBrush) {
                        nodeFabricInstance.freeDrawingBrush = new fabric.EraserBrush(nodeFabricInstance);
                    } else {
                        console.error("fabric.EraserBrush is not available in DrawingNode.");
                    }
                }
                if (nodeFabricInstance.freeDrawingBrush) {
                    nodeFabricInstance.freeDrawingBrush.width = $strokeOptions.size;
                }
                if (nodeInputCanvas) nodeInputCanvas.style.pointerEvents = 'none';
                if (nodeFabricCanvasHTML) nodeFabricCanvasHTML.style.pointerEvents = 'auto';
            } else if ($selectedTool === 'select') {
                nodeFabricInstance.isDrawingMode = false;
                nodeFabricInstance.selection = true;
                nodeFabricInstance.skipTargetFind = false;
                if (nodeInputCanvas) nodeInputCanvas.style.pointerEvents = 'none';
                if (nodeFabricCanvasHTML) nodeFabricCanvasHTML.style.pointerEvents = 'auto';
            }
        } else {
            nodeFabricInstance.isDrawingMode = false;
            nodeFabricInstance.selection = false;
            nodeFabricInstance.skipTargetFind = true;
            if (nodeInputCanvas) nodeInputCanvas.style.pointerEvents = 'none';
            if (nodeFabricCanvasHTML) nodeFabricCanvasHTML.style.pointerEvents = 'none';
        }
    }

    $: if (nodeFabricInstance && data.fabricJson && nodeFabricInstance.toJSON() !== data.fabricJson) {
        // Basic check for external changes, might need more robust handling
    }

  </script>

<div
    class="flow-node-wrapper"
    class:drawing={$isNodeDrawingMode}
>
    <Handle type="target" position={Position.Left} />
    <div class="node-header">
        <div class="node-label">
            {$isNodeDrawingMode ? `Drawing on ${data.label || `Node ${id}`}` : (data.label || `Node ${id}`)}
        </div>
        <button class="edit-done-button" class:active={$isNodeDrawingMode} on:click={handleToggleDrawModeButton}>
            {$isNodeDrawingMode ? 'Done' : 'Edit'}
        </button>
    </div>

    <div
        class="canvas-internal-container node"
        style:width="{canvasWidth}px"
        style:height="{canvasHeight}px"
        style:position="relative"
        style:pointer-events={$isNodeDrawingMode ? 'auto' : 'none'}
        style:border={$isNodeDrawingMode ? '1px dashed #6355FF' : '1px solid #eee'}
    >
        <canvas
            bind:this={nodeFabricCanvasHTML}
            width={canvasWidth}
            height={canvasHeight}
            style:position="absolute"
            style:top="0"
            style:left="0"
            style:z-index="0"
            style:border-radius="3px"
        ></canvas>
        <canvas
            bind:this={nodeInputCanvas}
            width={canvasWidth}
            height={canvasHeight}
            on:pointerdown|self={startPenStroke}
            on:pointermove={continuePenStroke}
            on:pointerup={endPenStroke}
            on:pointerleave={endPenStroke}
            on:pointercancel={endPenStroke}
            style:position="absolute"
            style:top="0"
            style:left="0"
            style:z-index="1"
            style:touch-action="none"
            style:cursor={$isNodeDrawingMode && $selectedTool === 'pen' ? 'crosshair' : ($isNodeDrawingMode && $selectedTool === 'eraser' ? 'cell' : 'default')}
            style:border-radius="3px"
        ></canvas>
    </div>
    <Handle type="source" position={Position.Right} />
</div>

<style lang="scss">
.flow-node-wrapper {
    padding: 8px;
    border-radius: 6px;
    min-width: calc(240px + 16px); /* Canvas width + padding */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transition: border 0.2s ease, box-shadow 0.2s ease;
}

.node-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    margin-bottom: 4px;
}

.node-label {
    font-size: 11px;
    color: white;
    text-align: left;
    flex-grow: 1;
    user-select: none;
}

.edit-done-button {
    font-size: 10px;
    padding: 4px 6px;
    border-radius: 4px;
    background-color: #f8f8f8;
    color: black;
    cursor: pointer;
    transition: background-color 0.2s, border-color 0.2s;
    min-width: 20px; /* Ensure button has a minimum width */
    text-align: center;

    &.active{
        background: #6355FF;
        color: white;
        &:hover{
            background: #5345dd;
        }
    }

    &:hover {
        background-color: #eee;
        border-color: #bbb;
    }
}




/* Specific style when in drawing mode for the button */
:global(.flow-node-wrapper[style*="2px solid rgb(99, 85, 255)"] .edit-done-button) {
    background-color: #6355FF;
    color: white;
}
:global(.flow-node-wrapper[style*="2px solid rgb(99, 85, 255)"] .edit-done-button:hover) {
    background-color: #5345dd;
}


.canvas-internal-container {
    border-radius: 4px;
    width: 240px; /* Fixed canvas width */
    height: 240px; /* Fixed canvas height */
    overflow: hidden; /* Ensure content doesn't spill */
}

:global(.flow-node-wrapper .svelte-flow__handle) {
    pointer-events: auto !important;
    z-index: 10;
}

</style>