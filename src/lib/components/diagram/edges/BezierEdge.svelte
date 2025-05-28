<script lang="ts">
  // @ts-nocheck
  import { getBezierPath, BaseEdge } from '@xyflow/svelte';

  export let id;
  export let sourceX;
  export let sourceY;
  export let targetX;
  export let targetY;
  export let sourcePosition;
  export let targetPosition;
  export let data = {};
  export let selected = false;

  $: [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
</script>

<div class:selected>
  <BaseEdge
    {id}
    {edgePath}
    class="bezier-edge"
  />
</div>

<style>
  :global(.bezier-edge) {
    stroke: #555;
    stroke-width: 2;
  }

  :global(.selected .bezier-edge) {
    stroke: #ff4d88;
    stroke-width: 3;
  }

  /* Keep the original styling as a fallback */
  :global(.bezier-edge.selected) {
    stroke: #ff4d88;
    stroke-width: 3;
  }
</style>