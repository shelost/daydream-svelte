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
    // We don't use data, selected, source, target, sourceHandleId, targetHandleId, markerStart, markerEnd props here
    // but they might be passed by Svelte Flow, so we can list them if needed to avoid warnings, or ignore.

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
            <stop offset="0%" style="stop-color:#505050;" />
            <stop offset="50%" style="stop-color:#5c5c5c;" />
            <stop offset="100%" style="stop-color:#ffffff;" />
        </linearGradient>
    </defs>
    <path
        id={id}
        class={edgeClasses}
        d={pathData}
        style="stroke: url(#{gradientId}); {style}"
        fill="none"
    />
</g>