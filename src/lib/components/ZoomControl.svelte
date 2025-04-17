<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  // Props
  export let zoom: number = 1;

  // Set up event dispatcher for reset zoom event
  const dispatch = createEventDispatcher();

  // Function to reset zoom and position
  function resetZoomAndPosition() {
    dispatch('resetZoom');
  }

  // Function to zoom in
  function zoomIn() {
    dispatch('zoomIn');
  }

  // Function to zoom out
  function zoomOut() {
    dispatch('zoomOut');
  }
</script>

<div class="zoom-control">
  <button
    class="zoom-button"
    on:click={zoomOut}
    title="Zoom out (Ctrl+-)"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
    </svg>
  </button>

  <div class="zoom-display">{Math.round(zoom * 100)}%</div>

  <button
    class="zoom-button"
    on:click={zoomIn}
    title="Zoom in (Ctrl++)"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      <line x1="11" y1="8" x2="11" y2="14"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
    </svg>
  </button>

  <button
    class="reset-button"
    on:click={resetZoomAndPosition}
    title="Reset view (Ctrl+0)"
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="16"></line>
      <line x1="8" y1="12" x2="16" y2="12"></line>
    </svg>
  </button>
</div>

<style lang="scss">
  .zoom-control {
    display: flex;
    align-items: center;
    background: transparent;
    border-radius: 4px;
    padding: 2px 5px;
    z-index: 10;
    font-size: 14px;
    user-select: none;
  }

  .zoom-display {
    margin: 0 8px;
    font-weight: 500;
    color: #333;
    min-width: 40px;
    text-align: center;
  }

  .zoom-button,
  .reset-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #555;

    &:hover {
      background: #f5f5f5;
      color: #000;
    }

    &:active {
      background: #e9e9e9;
    }
  }

  .reset-button {
    margin-left: 4px;
    border-left: 1px solid #eee;
    padding-left: 8px;
  }
</style>