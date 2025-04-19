<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { textStyles } from '$lib/stores/styleStore';
  import type { TextStyles } from '$lib/types';
  import SliderControl from './SliderControl.svelte';
  import SelectControl from './SelectControl.svelte';
  import ToggleControl from './ToggleControl.svelte';
  import ColorPickerPopup from '../ColorPickerPopup.svelte';

  export let selectedObject: any = null;

  const dispatch = createEventDispatcher();

  // Font families
  const fontFamilies = [
    { value: 'Inter', label: 'Inter' },
    { value: 'DM Sans', label: 'DM Sans' },
    { value: 'Newsreader', label: 'Newsreader' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Helvetica', label: 'Helvetica' },
    { value: 'Georgia', label: 'Georgia' },
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'Courier New', label: 'Courier New' },
    { value: 'Verdana', label: 'Verdana' }
  ];

  // Font sizes
  const fontSizes = [
    { value: 8, label: '8px' },
    { value: 10, label: '10px' },
    { value: 12, label: '12px' },
    { value: 14, label: '14px' },
    { value: 16, label: '16px' },
    { value: 18, label: '18px' },
    { value: 20, label: '20px' },
    { value: 24, label: '24px' },
    { value: 32, label: '32px' },
    { value: 48, label: '48px' },
    { value: 64, label: '64px' },
    { value: 72, label: '72px' }
  ];

  // Text alignment options
  const alignOptions = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
    { value: 'justify', label: 'Justify' }
  ];

  // Font style options
  const fontStyles = [
    { value: 'normal', label: 'Normal' },
    { value: 'italic', label: 'Italic' }
  ];

  // Font weight options
  const fontWeights = [
    { value: 'normal', label: 'Normal' },
    { value: 'bold', label: 'Bold' }
  ];

  // Color picker state
  let selectedColorHex = $textStyles.color;
  let colorPickerOpen = false;
  let colorDisplayElement: HTMLElement | null = null;

  // Color picker values
  let hue = 0;
  let saturation = 100;
  let lightness = 50;
  let rgbValues = { r: 0, g: 0, b: 0 };
  let hslValues = { h: 0, s: 100, l: 50 };

  // Preset colors
  const presetColors = [
    '#000000', '#FFFFFF', '#FF0000', '#00FF00',
    '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
    '#FFA500', '#800080', '#008000', '#800000',
    '#808080', '#C0C0C0', '#A52A2A', '#1E90FF'
  ];

  // Initialize HSL and RGB values from hex color
  function initializeColorValues(hexColor: string) {
    // Parse hex color to RGB
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);

    rgbValues = { r, g, b };

    // Convert RGB to HSL
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;

    // Calculate lightness
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;

    if (delta !== 0) {
      // Calculate saturation
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

      // Calculate hue
      if (max === rNorm) {
        h = ((gNorm - bNorm) / delta) + (gNorm < bNorm ? 6 : 0);
      } else if (max === gNorm) {
        h = ((bNorm - rNorm) / delta) + 2;
      } else {
        h = ((rNorm - gNorm) / delta) + 4;
      }

      h = Math.round(h * 60);
    }

    hue = h;
    saturation = Math.round(s * 100);
    lightness = Math.round(l * 100);
    hslValues = { h, s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  // Convert HSL to hex color
  function hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let r = 0, g = 0, b = 0;

    if (h >= 0 && h < 60) {
      r = c; g = x; b = 0;
    } else if (h >= 60 && h < 120) {
      r = x; g = c; b = 0;
    } else if (h >= 120 && h < 180) {
      r = 0; g = c; b = x;
    } else if (h >= 180 && h < 240) {
      r = 0; g = x; b = c;
    } else if (h >= 240 && h < 300) {
      r = x; g = 0; b = c;
    } else {
      r = c; g = 0; b = x;
    }

    const rHex = Math.round((r + m) * 255).toString(16).padStart(2, '0');
    const gHex = Math.round((g + m) * 255).toString(16).padStart(2, '0');
    const bHex = Math.round((b + m) * 255).toString(16).padStart(2, '0');

    return `#${rHex}${gHex}${bHex}`.toUpperCase();
  }

  // Initialize style from selected object if available
  $: if (selectedObject) {
    // Ensure font size has a default value if it's not set
    const defaultFontSize = 16; // Standard default font size

    textStyles.update((styles: TextStyles) => ({
      ...styles,
      fontFamily: selectedObject.fontFamily || styles.fontFamily,
      fontSize: selectedObject.fontSize || defaultFontSize,
      color: selectedObject.fill || styles.color,
      fontWeight: selectedObject.fontWeight || styles.fontWeight,
      fontStyle: selectedObject.fontStyle || styles.fontStyle,
      textAlign: selectedObject.textAlign || styles.textAlign,
      lineHeight: selectedObject.lineHeight || styles.lineHeight,
      letterSpacing: selectedObject.charSpacing !== undefined ? selectedObject.charSpacing / 10 : styles.letterSpacing,
      underline: selectedObject.underline || styles.underline,
      opacity: selectedObject.opacity !== undefined ? selectedObject.opacity : styles.opacity
    }));
    selectedColorHex = selectedObject.fill || $textStyles.color;
    initializeColorValues(selectedColorHex);
  }

  // Update selected object when styles change
  $: if (selectedObject) {
    updateSelectedObject();
  }

  // Define a type for text updates
  type TextUpdate = Partial<{
    fontFamily: string;
    fontSize: number;
    fill: string;
    color: string;
    fontWeight: string;
    fontStyle: string;
    textAlign: string;
    lineHeight: number;
    charSpacing: number;
    underline: boolean;
    opacity: number;
  }>;

  function updateSelectedObject(partialUpdates: TextUpdate | null = null) {
    if (!selectedObject) return;

    // Default values for essential properties
    const defaultFontSize = 16;

    // Create an updates object with all the properties to change
    let updates: TextUpdate = {
      fontFamily: $textStyles.fontFamily,
      fontSize: $textStyles.fontSize || defaultFontSize,
      fill: $textStyles.color,
      color: $textStyles.color, // Include both fill and color for compatibility
      fontWeight: $textStyles.fontWeight,
      fontStyle: $textStyles.fontStyle,
      textAlign: $textStyles.textAlign,
      lineHeight: $textStyles.lineHeight,
      charSpacing: $textStyles.letterSpacing * 10, // Convert to fabric.js format
      underline: $textStyles.underline,
      opacity: $textStyles.opacity
    };

    // If partial updates are provided, merge them with the full updates
    if (partialUpdates) {
      updates = { ...updates, ...partialUpdates };
    }

    console.log('TextSettings: Dispatching update with changes:', updates);

    // Dispatch the update event with the object and updates
    dispatch('update', { object: selectedObject, updates });
  }

  // Toggle color picker
  function toggleColorPicker() {
    // Initialize color picker values if picker is being opened
    if (!colorPickerOpen) {
      initializeColorValues(selectedColorHex);
    }
    colorPickerOpen = !colorPickerOpen;
  }

  // Set color (from picker)
  function setColor(color: string) {
    selectedColorHex = color;
    textStyles.update((styles: TextStyles) => ({
      ...styles,
      color
    }));
    initializeColorValues(color);
    updateSelectedObject();
  }

  // Handle hue change
  function handleHueChange(h: number) {
    hue = h;
    hslValues.h = h;
    updateHexFromHsl();
  }

  // Handle color square click for saturation/lightness
  function handleColorSquareClick(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

    // Calculate saturation and lightness based on click position
    saturation = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    lightness = Math.max(0, Math.min(100, 100 - ((e.clientY - rect.top) / rect.height) * 100));

    hslValues.s = Math.round(saturation);
    hslValues.l = Math.round(lightness);

    updateHexFromHsl();
  }

  // Handle RGB value change
  function handleRgbChange() {
    // Convert RGB to hex
    const rHex = rgbValues.r.toString(16).padStart(2, '0');
    const gHex = rgbValues.g.toString(16).padStart(2, '0');
    const bHex = rgbValues.b.toString(16).padStart(2, '0');

    selectedColorHex = `#${rHex}${gHex}${bHex}`.toUpperCase();

    // Update HSL values based on the new RGB values
    initializeColorValues(selectedColorHex);

    // Update text style
    setColor(selectedColorHex);
  }

  // Handle HSL value change
  function handleHslChange() {
    hue = hslValues.h;
    saturation = hslValues.s;
    lightness = hslValues.l;

    updateHexFromHsl();
  }

  // Update hex color from HSL values
  function updateHexFromHsl() {
    selectedColorHex = hslToHex(hue, saturation, lightness);

    // Update RGB values based on new hex
    initializeColorValues(selectedColorHex);

    // Update text style
    setColor(selectedColorHex);
  }

  // Update font family
  function setFontFamily(value: string) {
    textStyles.update((styles: TextStyles) => ({
      ...styles,
      fontFamily: value
    }));
    updateSelectedObject();
  }

  // Toggle bold
  function toggleBold() {
    const newWeight = $textStyles.fontWeight === 'bold' ? 'normal' : 'bold';
    textStyles.update((styles: TextStyles) => ({...styles, fontWeight: newWeight}));

    // Update the selected object with the new font weight
    updateSelectedObject();
  }

  // Toggle italic
  function toggleItalic() {
    const newStyle = $textStyles.fontStyle === 'italic' ? 'normal' : 'italic';
    textStyles.update((styles: TextStyles) => ({...styles, fontStyle: newStyle}));

    // Update the selected object with the new font style
    updateSelectedObject();
  }

  // Toggle underline
  function toggleUnderline() {
    const newUnderline = !$textStyles.underline;
    textStyles.update((styles: TextStyles) => ({...styles, underline: newUnderline}));

    // Update the selected object with the new underline state
    updateSelectedObject();
  }
</script>

<section class="sidebar-section">
  <h3>Text</h3>

  <!-- Font Family -->
  <SelectControl
    label="Font"
    bind:value={$textStyles.fontFamily}
    options={fontFamilies}
    on:change={() => updateSelectedObject()}
  />

  <!-- Font Size -->
  <SelectControl
    label="Size"
    bind:value={$textStyles.fontSize}
    options={fontSizes}
    on:change={() => updateSelectedObject()}
  />

  <!-- Text Formatting Controls -->
  <div class="formatting-controls">
    <button
      class="format-btn"
      class:active={$textStyles.fontWeight === 'bold'}
      on:click={toggleBold}
      title="Bold"
    >
      <span class="material-icons">format_bold</span>
    </button>
    <button
      class="format-btn"
      class:active={$textStyles.fontStyle === 'italic'}
      on:click={toggleItalic}
      title="Italic"
    >
      <span class="material-icons">format_italic</span>
    </button>
    <button
      class="format-btn"
      class:active={$textStyles.underline}
      on:click={toggleUnderline}
      title="Underline"
    >
      <span class="material-icons">format_underlined</span>
    </button>

    <div class="divider"></div>

    <!-- Text Alignment -->
    {#each alignOptions as option}
      <button
        class="format-btn"
        class:active={$textStyles.textAlign === option.value}
        on:click={() => {
          textStyles.update((styles: TextStyles) => ({...styles, textAlign: option.value}));
          updateSelectedObject();
        }}
        title={option.label}
      >
        <span class="material-icons">format_align_{option.value}</span>
      </button>
    {/each}
  </div>

  <!-- Text Color -->
  <div class="color-section">
    <div class="color-label">Color</div>
    <div class="color-control">
      <div
        class="current-color-display"
        bind:this={colorDisplayElement}
        style="background-color: {selectedColorHex};"
        on:click={toggleColorPicker}
        title="Click to open color picker"
      ></div>
      <input
        type="text"
        class="hex-input"
        bind:value={selectedColorHex}
        on:input={() => setColor(selectedColorHex)}
      />
    </div>
  </div>

  <!-- Line Height -->
  <SliderControl
    label="Line Height"
    min={0.8}
    max={2.5}
    step={0.1}
    bind:value={$textStyles.lineHeight}
    decimals={1}
    on:change={() => updateSelectedObject()}
  />

  <!-- Letter Spacing -->
  <SliderControl
    label="Spacing"
    min={-5}
    max={20}
    step={0.5}
    bind:value={$textStyles.letterSpacing}
    decimals={1}
    on:change={() => updateSelectedObject()}
  />

  <!-- Opacity -->
  <SliderControl
    label="Opacity"
    min={0.1}
    max={1}
    step={0.05}
    bind:value={$textStyles.opacity}
    decimals={2}
    unit="%"
    on:change={() => updateSelectedObject()}
  />

  <!-- Advanced options -->
  <details class="advanced-section">
    <summary>Text Shadow</summary>
    <div class="shadow-controls">
      <ToggleControl
        label="Enable Shadow"
        bind:checked={$textStyles.shadow.enabled}
        on:change={() => updateSelectedObject()}
      />

      {#if $textStyles.shadow.enabled}
        <SliderControl
          label="Blur"
          min={0}
          max={20}
          step={1}
          bind:value={$textStyles.shadow.blur}
          on:change={() => updateSelectedObject()}
        />

        <SliderControl
          label="Offset X"
          min={-20}
          max={20}
          step={1}
          bind:value={$textStyles.shadow.offsetX}
          on:change={() => updateSelectedObject()}
        />

        <SliderControl
          label="Offset Y"
          min={-20}
          max={20}
          step={1}
          bind:value={$textStyles.shadow.offsetY}
          on:change={() => updateSelectedObject()}
        />
      {/if}
    </div>
  </details>

  <!-- Color picker popup -->
  <ColorPickerPopup
    open={colorPickerOpen}
    anchor={colorDisplayElement}
    hue={hue}
    saturation={saturation}
    lightness={lightness}
    rgbValues={rgbValues}
    hslValues={hslValues}
    presetColors={presetColors}
    selectedColorHex={selectedColorHex}
    onHueChange={handleHueChange}
    onColorSquareClick={handleColorSquareClick}
    onRgbChange={handleRgbChange}
    onHslChange={handleHslChange}
    onColorSelect={setColor}
  />
</section>

<style lang="scss">
  .formatting-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 12px;
  }

  .format-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: $border-radius-sm;
    background-color: var(--card-bg);
    border: 1px solid var(--border-color);
    cursor: pointer;

    &:hover {
      background-color: var(--hover-bg);
    }

    &.active {
      background-color: var(--primary-color);
      color: white;
    }

    .material-icons {
      font-size: 16px;
    }
  }

  .divider {
    width: 1px;
    height: 28px;
    background-color: var(--border-color);
    margin: 0 4px;
  }

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