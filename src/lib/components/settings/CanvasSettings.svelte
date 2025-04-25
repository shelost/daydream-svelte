<script lang="ts">
  import { drawingSettings, PAPER_SIZES, MAX_CANVAS_WIDTH, MAX_CANVAS_HEIGHT } from '$lib/stores/drawingStore';
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher();

  // Local state for custom dimensions (for validation)
  let customWidth = $drawingSettings.canvasWidth;
  let customHeight = $drawingSettings.canvasHeight;
  let showCustomDimensions = $drawingSettings.paperSize === 'CUSTOM';

  // Paper size options
  const paperSizeOptions = Object.entries(PAPER_SIZES).map(([key, value]) => ({
    value: key,
    label: value.name
  }));

  // Update canvas settings
  function updateCanvasSize() {
    if ($drawingSettings.paperSize === 'CUSTOM') {
      // Validate custom dimensions
      const validWidth = Math.max(100, Math.min(MAX_CANVAS_WIDTH, customWidth));
      const validHeight = Math.max(100, Math.min(MAX_CANVAS_HEIGHT, customHeight));

      if (validWidth !== customWidth || validHeight !== customHeight) {
        customWidth = validWidth;
        customHeight = validHeight;
      }

      drawingSettings.update(settings => ({
        ...settings,
        canvasWidth: validWidth,
        canvasHeight: validHeight
      }));
    } else {
      // Use predefined paper size
      const selectedSize = PAPER_SIZES[$drawingSettings.paperSize];
      drawingSettings.update(settings => ({
        ...settings,
        canvasWidth: selectedSize.width,
        canvasHeight: selectedSize.height
      }));

      // Update local custom values for consistency
      customWidth = selectedSize.width;
      customHeight = selectedSize.height;
    }

    // Dispatch event to notify parent components
    dispatch('canvasSizeChanged', {
      width: $drawingSettings.canvasWidth,
      height: $drawingSettings.canvasHeight
    });
  }

  function handlePaperSizeChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const newPaperSize = target.value as keyof typeof PAPER_SIZES | 'CUSTOM';

    drawingSettings.update(settings => ({
      ...settings,
      paperSize: newPaperSize
    }));

    showCustomDimensions = newPaperSize === 'CUSTOM';
    updateCanvasSize();
  }

  function handleCustomWidthChange(e: Event) {
    const target = e.target as HTMLInputElement;
    customWidth = parseInt(target.value, 10) || $drawingSettings.canvasWidth;
    if ($drawingSettings.paperSize === 'CUSTOM') {
      updateCanvasSize();
    }
  }

  function handleCustomHeightChange(e: Event) {
    const target = e.target as HTMLInputElement;
    customHeight = parseInt(target.value, 10) || $drawingSettings.canvasHeight;
    if ($drawingSettings.paperSize === 'CUSTOM') {
      updateCanvasSize();
    }
  }

  function handleCanvasColorChange(e: Event) {
    const target = e.target as HTMLInputElement;
    drawingSettings.update(settings => ({
      ...settings,
      canvasColor: target.value
    }));
  }

  function handleBackgroundColorChange(e: Event) {
    const target = e.target as HTMLInputElement;
    drawingSettings.update(settings => ({
      ...settings,
      backgroundColor: target.value
    }));
  }

  function toggleMiniMap() {
    drawingSettings.update(settings => ({
      ...settings,
      showMiniMap: !settings.showMiniMap
    }));
  }

  // Update local variables when store changes
  $: if ($drawingSettings) {
    customWidth = $drawingSettings.canvasWidth;
    customHeight = $drawingSettings.canvasHeight;
    showCustomDimensions = $drawingSettings.paperSize === 'CUSTOM';
  }
</script>

<section class="panel-section canvas-settings">
  <h3>Canvas Settings</h3>

  <div class="setting-row">
    <label for="paper-size">Paper Size:</label>
    <select
      id="paper-size"
      value={$drawingSettings.paperSize}
      on:change={handlePaperSizeChange}
    >
      {#each paperSizeOptions as option}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>

  {#if showCustomDimensions}
    <div class="custom-dimensions">
      <div class="setting-row">
        <label for="canvas-width">Width (px):</label>
        <input
          id="canvas-width"
          type="number"
          min="100"
          max={MAX_CANVAS_WIDTH}
          bind:value={customWidth}
          on:change={handleCustomWidthChange}
        />
      </div>

      <div class="setting-row">
        <label for="canvas-height">Height (px):</label>
        <input
          id="canvas-height"
          type="number"
          min="100"
          max={MAX_CANVAS_HEIGHT}
          bind:value={customHeight}
          on:change={handleCustomHeightChange}
        />
      </div>
    </div>
  {/if}

  <div class="setting-row colors">
    <div class="color-setting">
      <label for="canvas-color">Canvas:</label>
      <input
        id="canvas-color"
        type="color"
        value={$drawingSettings.canvasColor}
        on:input={handleCanvasColorChange}
      />
    </div>

    <div class="color-setting">
      <label for="background-color">Background:</label>
      <input
        id="background-color"
        type="color"
        value={$drawingSettings.backgroundColor}
        on:input={handleBackgroundColorChange}
      />
    </div>
  </div>

  <div class="setting-row toggle">
    <label for="show-minimap">Show Mini Map:</label>
    <label class="switch">
      <input
        id="show-minimap"
        type="checkbox"
        checked={$drawingSettings.showMiniMap}
        on:change={toggleMiniMap}
      />
      <span class="slider"></span>
    </label>
  </div>

  <div class="info-text">
    <span class="material-icons">info</span>
    <p>Canvas size changes will apply to newly created drawings and may require reopening existing drawings.</p>
  </div>
</section>

<style lang="scss">
  .canvas-settings {
    margin-bottom: 1rem;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;

    label {
      font-size: 0.875rem;
      color: var(--text-color);
    }

    select, input[type="number"] {
      flex: 1;
      margin-left: 0.5rem;
      padding: 0.25rem;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background-color: var(--input-bg);
      color: var(--text-color);
    }

    &.colors {
      justify-content: space-between;
    }

    &.toggle {
      margin-top: 0.5rem;
    }
  }

  .color-setting {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    input[type="color"] {
      width: 24px;
      height: 24px;
      border: 1px solid var(--border-color);
      padding: 0;
      background: none;
      cursor: pointer;
    }
  }

  .custom-dimensions {
    background-color: var(--hover-bg);
    padding: 0.5rem;
    border-radius: 4px;
    margin-bottom: 0.75rem;
  }

  .info-text {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin-top: 1rem;
    padding: 0.5rem;
    background-color: var(--hover-bg);
    border-radius: 4px;
    font-size: 0.75rem;

    .material-icons {
      font-size: 1rem;
      color: var(--text-color);
    }

    p {
      margin: 0;
      line-height: 1.2;
      color: var(--text-color);
    }
  }

  /* Toggle switch styles */
  .switch {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--border-color);
    border-radius: 34px;
    transition: 0.2s;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 16px;
    width: 16px;
    left: 2px;
    bottom: 2px;
    background-color: white;
    border-radius: 50%;
    transition: 0.2s;
  }

  input:checked + .slider {
    background-color: var(--primary-color);
  }

  input:checked + .slider:before {
    transform: translateX(16px);
  }
</style>