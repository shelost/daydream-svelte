<script lang="ts">
  // @ts-nocheck
  import { BaseEdge } from '@xyflow/svelte';
  import { getStraightPath } from '$lib/utils/edgePaths';

  export let id;
  export let sourceX;
  export let sourceY;
  export let targetX;
  export let targetY;
  export let sourcePosition;
  export let targetPosition;
  export let data = {};
  export let selected = false;

  $: [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });
</script>

<!-- Option 1: Fix by using a wrapping div element -->
<div class:selected>
  <BaseEdge
    {id}
    {edgePath}
    class="straight-edge"
  />
</div>

<!-- Option 2: If BaseEdge supports a selected prop directly -->
<!--
<BaseEdge
  {id}
  {edgePath}
  class="straight-edge"
  selected={selected}
/>
-->

<style>
  :global(.straight-edge) {
    stroke: #555;
    stroke-width: 2;
  }

  :global(.selected .straight-edge) {
    stroke: #ff4d88;
    stroke-width: 3;
  }

  /* Keep the original styling as a fallback */
  :global(.straight-edge.selected) {
    stroke: #ff4d88;
    stroke-width: 3;
  }
</style>