<!-- /src/lib/components/flow/GradientEdge.svelte -->
<script lang="ts">
    import { getBezierPath, type EdgeProps, Position } from '@xyflow/svelte';

    export let id: EdgeProps['id'];
    export let sourceX: EdgeProps['sourceX'];
    export let sourceY: EdgeProps['sourceY'];
    export let targetX: EdgeProps['targetX'];
    export let targetY: EdgeProps['targetY'];
    export let sourcePosition: EdgeProps['sourcePosition'] = Position.Right;
    export let targetPosition: EdgeProps['targetPosition'] = Position.Left;
    export let animated: EdgeProps['animated'] = false;
    export let style: EdgeProps['style'] = '';
    export let selected: EdgeProps['selected'] = false;
    export let data: EdgeProps['data'] = {};
    export let interactionWidth: number = 12; // Width around the path for interaction

    // We don't use source, target, sourceHandleId, targetHandleId, markerStart, markerEnd props here
    // but they might be passed by Svelte Flow

    let pathData = '';
    $: pathData = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition
    })[0];

    // Base Svelte Flow edge class for default styling (like stroke width, opacity) and animation detection
    const edgeClasses = 'svelte-flow__edge-path ' + (animated ? 'animated' : '');
    const gradientId = `grad-${id}`; // Unique ID for the gradient
</script>

<g>
    <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
            <stop offset="0%" style="stop-color:{selected ? '#ff3d7f' : '#505050'};" />
            <stop offset="50%" style="stop-color:{selected ? '#ff3d7f' : '#5c5c5c'};" />
            <stop offset="100%" style="stop-color:{selected ? '#ff3d7f' : '#ffffff'};" />
        </linearGradient>
    </defs>

    <!-- Wider invisible path for better click detection -->
    <path
        id={`${id}-interaction`}
        d={pathData}
        class="edge-interaction-path"
        fill="none"
        stroke-width={interactionWidth}
        stroke="transparent"
        style="pointer-events: all; cursor: pointer;"
    />

    <!-- Visible path -->
    <path
        id={id}
        class={edgeClasses}
        d={pathData}
        style="
            stroke: url(#{gradientId});
            stroke-width: {selected ? 3 : 2}px;
            {style}
        "
        fill="none"
        stroke-dasharray={selected ? '5,2' : '0'}
    />
</g>

<style>
    .edge-interaction-path:hover ~ path {
        stroke-width: 2.5px;
        /* We don't set color here as we're using the gradient */
    }
</style>