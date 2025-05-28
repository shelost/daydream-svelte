<script lang="ts">
  import { drawingSettings } from '$lib/stores/drawingStore';
  import SliderControl from './SliderControl.svelte';
  import ToggleControl from './ToggleControl.svelte';
  import ColorPickerPopup from '../ColorPickerPopup.svelte';

  // Color picker state
  let selectedColorHex = $drawingSettings.strokeColor;
  let colorPickerOpen = false;
  let colorDisplayElement: HTMLElement | null = null;

  // Function to handle color changes
  function setColor(color: string) {
    selectedColorHex = color;
    drawingSettings.update(settings => ({
      ...settings,
      strokeColor: color
    }));
  }

  // Update from hex input
  function updateFromHex() {
    // Validate hex format
    const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(selectedColorHex);

    if (isValidHex) {
      setColor(selectedColorHex);
    }
  }

  // Function to handle size changes
  function setSize(size: number) {
    drawingSettings.update(settings => ({
      ...settings,
      strokeSize: size
    }));
  }

  // Function to handle opacity changes
  function setOpacity(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      opacity: value
    }));
  }

  // Function to handle thinning changes
  function setThinning(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      thinning: value
    }));
  }

  // Function to handle smoothing changes
  function setSmoothing(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      smoothing: value
    }));
  }

  // Function to handle streamline changes
  function setStreamline(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      streamline: value
    }));
  }

  // Function to toggle pressure sensitivity
  function togglePressure() {
    drawingSettings.update(settings => ({
      ...settings,
      showPressure: !settings.showPressure
    }));
  }

  // Function to toggle cap start
  function toggleCapStart() {
    drawingSettings.update(settings => ({
      ...settings,
      capStart: !settings.capStart
    }));
  }

  // Function to toggle cap end
  function toggleCapEnd() {
    drawingSettings.update(settings => ({
      ...settings,
      capEnd: !settings.capEnd
    }));
  }

  // Function to handle taper start changes
  function setTaperStart(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      taperStart: value
    }));
  }

  // Function to handle taper end changes
  function setTaperEnd(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      taperEnd: value
    }));
  }

  // Toggle color picker
  function toggleColorPicker() {
    colorPickerOpen = !colorPickerOpen;
  }
</script>

<section class="sidebar-section">
  <h3>Pen</h3>

  <!-- Colors -->
  <div class="colors-section">
    <div class="color-picker-container">
      <!-- Current color display and hex input -->
      <div class="current-color-row">
        <div
          class="current-color-display"
          bind:this={colorDisplayElement}
          style="background-color: {selectedColorHex}; border: 1px solid {selectedColorHex === '#FFFFFF' ? '#ddd' : 'transparent'};"
          on:click={toggleColorPicker}
          title="Click to open color picker"
        ></div>
        <div class="color-input-container">
          <input
            type="text"
            class="hex-input"
            bind:value={selectedColorHex}
            on:blur={updateFromHex}
            on:keydown={(e) => e.key === 'Enter' && updateFromHex()}
          />
        </div>
      </div>
    </div>
  </div>

  <!-- Basic Settings -->
  <div class="sliders-section">
    <SliderControl
      label="Size"
      min={1}
      max={20}
      step={1}
      bind:value={$drawingSettings.strokeSize}
      unit="px"
    />

    <SliderControl
      label="Opacity"
      min={0.1}
      max={1}
      step={0.05}
      bind:value={$drawingSettings.opacity}
      decimals={2}
      unit="%"
    />
  </div>

  <!-- Advanced Settings -->
  <details class="advanced-section">
    <summary>Advanced Stroke Settings</summary>
    <div class="advanced-options">
      <SliderControl
        label="Thinning"
        min={-1}
        max={1}
        step={0.1}
        bind:value={$drawingSettings.thinning}
        decimals={1}
      />

      <SliderControl
        label="Smoothing"
        min={0}
        max={1}
        step={0.1}
        bind:value={$drawingSettings.smoothing}
        decimals={1}
      />

      <SliderControl
        label="Streamline"
        min={0}
        max={1}
        step={0.1}
        bind:value={$drawingSettings.streamline}
        decimals={1}
      />

      <ToggleControl
        label="Pressure Sensitivity"
        bind:checked={$drawingSettings.showPressure}
      />

      <ToggleControl
        label="Cap Start"
        bind:checked={$drawingSettings.capStart}
      />

      <ToggleControl
        label="Cap End"
        bind:checked={$drawingSettings.capEnd}
      />

      <SliderControl
        label="Taper Start"
        min={0}
        max={100}
        step={5}
        bind:value={$drawingSettings.taperStart}
      />

      <SliderControl
        label="Taper End"
        min={0}
        max={100}
        step={5}
        bind:value={$drawingSettings.taperEnd}
      />
    </div>
  </details>

  <!-- Color picker popup -->
  <ColorPickerPopup
    open={colorPickerOpen}
    anchor={colorDisplayElement}
    selectedColorHex={selectedColorHex}
    onColorSelect={setColor}
  />
</section>

<style lang="scss">
  .current-color-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  }

  .current-color-display {
    width: 40px;
    height: 40px;
    border-radius: $border-radius-sm;
    border: 1px solid var(--border-color);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    cursor: pointer;
  }

  .color-input-container {
    flex: 1;
  }

  .hex-input {
    width: 100%;
    padding: 8px;
    border: 1px solid var(--border-color);
    border-radius: $border-radius-sm;
    font-family: monospace;
    font-size: 14px;
    text-transform: uppercase;
    background-color: var(--card-bg);
    color: var(--text-color);

    &:focus {
      outline: none;
      border-color: var(--primary-color);
      box-shadow: 0 0 0 2px rgba(var(--primary-color), 0.2);
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

    .advanced-options {
      padding: 8px 0 4px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
  }
</style>