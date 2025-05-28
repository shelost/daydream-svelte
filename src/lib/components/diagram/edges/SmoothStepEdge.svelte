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
    borderRadius: 10,
  });
</script>

<div class:selected>
  <BaseEdge
    {id}
    {edgePath}
    class="smooth-step-edge"
  />
</div>

<style>
  :global(.smooth-step-edge) {
    stroke: #555;
    stroke-width: 2;
  }

  :global(.selected .smooth-step-edge) {
    stroke: #ff4d88;
    stroke-width: 3;
  }

  /* Keep the original styling as a fallback */
  :global(.smooth-step-edge.selected) {
    stroke: #ff4d88;
    stroke-width: 3;
  }
</style>