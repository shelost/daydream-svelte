<script lang="ts">
  // @ts-nocheck
  import { getSmoothStepPath, BaseEdge } from '@xyflow/svelte';

  export let id;
  export let sourceX;
  export let sourceY;
  export let targetX;
  export let targetY;
  export let sourcePosition;
  export let targetPosition;
  export let data = {};
  export let selected = false;

  $: [edgePath] = getSmoothStepPath({
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
    class="default-edge"
  />
</div>

<style>
  :global(.default-edge) {
    stroke: #555;
    stroke-width: 2;
  }

  :global(.selected .default-edge) {
    stroke: #ff4d88;
    stroke-width: 3;
  }

  /* Keep the original styling as a fallback */
  :global(.default-edge.selected) {
    stroke: #ff4d88;
    stroke-width: 3;
  }
</style>