<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { shapeStyles } from '$lib/stores/styleStore';
  import SliderControl from './SliderControl.svelte';
  import ToggleControl from './ToggleControl.svelte';
  import ColorPickerPopup from '../ColorPickerPopup.svelte';

  export let selectedObject: any = null;
  export let shapeType: string = 'rect'; // rect, circle, polygon, triangle

  const dispatch = createEventDispatcher();

  // Color picker state for fill and stroke
  let selectedFillHex = $shapeStyles.fill;
  let selectedStrokeHex = $shapeStyles.stroke;
  let fillPickerOpen = false;
  let strokePickerOpen = false;
  let fillDisplayElement: HTMLElement | null = null;
  let strokeDisplayElement: HTMLElement | null = null;

  // Initialize style from selected object if available
  $: if (selectedObject) {
    shapeStyles.update(styles => ({
      ...styles,
      fill: selectedObject.fill || styles.fill,
      stroke: selectedObject.stroke || styles.stroke,
      strokeWidth: selectedObject.strokeWidth || styles.strokeWidth,
      opacity: selectedObject.opacity !== undefined ? selectedObject.opacity : styles.opacity,
      cornerRadius: selectedObject.rx || styles.cornerRadius
    }));
    selectedFillHex = selectedObject.fill || $shapeStyles.fill;
    selectedStrokeHex = selectedObject.stroke || $shapeStyles.stroke;
  }

  // Update selected object when styles change
  $: if (selectedObject) {
    updateSelectedObject();
  }

  function updateSelectedObject() {
    if (!selectedObject) return;

    const updates: Record<string, any> = {
      fill: $shapeStyles.fill,
      stroke: $shapeStyles.stroke,
      strokeWidth: $shapeStyles.strokeWidth,
      opacity: $shapeStyles.opacity
    };

    // Add shape-specific properties
    if (shapeType === 'rect') {
      updates.rx = $shapeStyles.cornerRadius;
      updates.ry = $shapeStyles.cornerRadius;
    }

    // Add shadow if enabled
    if ($shapeStyles.shadow.enabled) {
      updates.shadow = {
        color: $shapeStyles.shadow.color,
        blur: $shapeStyles.shadow.blur,
        offsetX: $shapeStyles.shadow.offsetX,
        offsetY: $shapeStyles.shadow.offsetY
      };
    } else {
      updates.shadow = null;
    }

    dispatch('update', { object: selectedObject, updates });
  }

  // Toggle fill color picker
  function toggleFillPicker() {
    fillPickerOpen = !fillPickerOpen;
    if (fillPickerOpen) strokePickerOpen = false;
  }

  // Toggle stroke color picker
  function toggleStrokePicker() {
    strokePickerOpen = !strokePickerOpen;
    if (strokePickerOpen) fillPickerOpen = false;
  }

  // Set fill color
  function setFillColor(color: string) {
    selectedFillHex = color;
    shapeStyles.update(styles => ({
      ...styles,
      fill: color
    }));
  }

  // Set stroke color
  function setStrokeColor(color: string) {
    selectedStrokeHex = color;
    shapeStyles.update(styles => ({
      ...styles,
      stroke: color
    }));
  }
</script>

<section class="sidebar-section">
  <h3>Shape</h3>

  <!-- Fill Color -->
  <div class="color-section">
    <div class="color-label">Fill</div>
    <div class="color-control">
      <div
        class="current-color-display"
        bind:this={fillDisplayElement}
        style="background-color: {selectedFillHex}; border: 1px solid {selectedFillHex === '#FFFFFF' ? '#ddd' : 'transparent'};"
        on:click={toggleFillPicker}
        title="Click to open color picker"
      ></div>
      <input
        type="text"
        class="hex-input"
        bind:value={selectedFillHex}
        on:input={() => setFillColor(selectedFillHex)}
      />
    </div>
  </div>

  <!-- Stroke Color -->
  <div class="color-section">
    <div class="color-label">Stroke</div>
    <div class="color-control">
      <div
        class="current-color-display"
        bind:this={strokeDisplayElement}
        style="background-color: {selectedStrokeHex}; border: 1px solid {selectedStrokeHex === '#FFFFFF' ? '#ddd' : 'transparent'};"
        on:click={toggleStrokePicker}
        title="Click to open color picker"
      ></div>
      <input
        type="text"
        class="hex-input"
        bind:value={selectedStrokeHex}
        on:input={() => setStrokeColor(selectedStrokeHex)}
      />
    </div>
  </div>

  <!-- Stroke Width -->
  <SliderControl
    label="Stroke Width"
    min={0}
    max={20}
    step={0.5}
    bind:value={$shapeStyles.strokeWidth}
    decimals={1}
    unit="px"
  />

  <!-- Opacity -->
  <SliderControl
    label="Opacity"
    min={0.1}
    max={1}
    step={0.05}
    bind:value={$shapeStyles.opacity}
    decimals={2}
  />

  <!-- Corner Radius (for rectangles) -->
  {#if shapeType === 'rect'}
    <SliderControl
      label="Corner Radius"
      min={0}
      max={50}
      step={1}
      bind:value={$shapeStyles.cornerRadius}
      unit="px"
    />
  {/if}

  <!-- Shadow settings -->
  <details class="advanced-section">
    <summary>Shadow</summary>
    <div class="shadow-controls">
      <ToggleControl
        label="Enable Shadow"
        bind:checked={$shapeStyles.shadow.enabled}
      />

      {#if $shapeStyles.shadow.enabled}
        <SliderControl
          label="Blur"
          min={0}
          max={50}
          step={1}
          bind:value={$shapeStyles.shadow.blur}
        />

        <SliderControl
          label="Offset X"
          min={-50}
          max={50}
          step={1}
          bind:value={$shapeStyles.shadow.offsetX}
        />

        <SliderControl
          label="Offset Y"
          min={-50}
          max={50}
          step={1}
          bind:value={$shapeStyles.shadow.offsetY}
        />

        <ToggleControl
          label="Inner Shadow"
          bind:checked={$shapeStyles.shadow.inset}
          description="Apply shadow to the inside of the shape"
        />
      {/if}
    </div>
  </details>

  <!-- Color picker popups -->
  <ColorPickerPopup
    open={fillPickerOpen}
    anchor={fillDisplayElement}
    selectedColorHex={selectedFillHex}
    onColorSelect={setFillColor}
  />

  <ColorPickerPopup
    open={strokePickerOpen}
    anchor={strokeDisplayElement}
    selectedColorHex={selectedStrokeHex}
    onColorSelect={setStrokeColor}
  />
</section>

<style lang="scss">
  .color-section {
    display: flex;
    align-items: center;
    margin-bottom: 12px;

    .color-label {
      width: 90px;
      font-size: 12px;
      color: var(--text-color);
    }

    .color-control {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }

    .current-color-display {
      width: 24px;
      height: 24px;
      border-radius: $border-radius-sm;
      border: 1px solid var(--border-color);
      cursor: pointer;
    }

    .hex-input {
      width: 70px;
      padding: 2px 4px;
      border: 1px solid var(--border-color);
      border-radius: $border-radius-sm;
      font-family: monospace;
      font-size: 12px;
      color: var(--text-color);
      background-color: var(--card-bg);
    }
  }

  .advanced-section {
    margin-top: 12px;

    summary {
      cursor: pointer;
      padding: 4px 0;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-color);
    }

    .shadow-controls {
      padding: 8px 0 4px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
  }
</style>