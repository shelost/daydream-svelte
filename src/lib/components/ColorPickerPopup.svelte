<script lang="ts">
  import Popup from './Popup.svelte';

  // Props
  export let open = false;
  export let anchor: HTMLElement | null = null;
  export let hue: number;
  export let saturation: number;
  export let lightness: number;
  export let rgbValues: { r: number, g: number, b: number };
  export let hslValues: { h: number, s: number, l: number };
  export let presetColors: string[] = [];
  export let selectedColorHex: string;

  // Event handlers
  export let onHueChange: (h: number) => void;
  export let onColorSquareClick: (e: MouseEvent) => void;
  export let onRgbChange: () => void;
  export let onHslChange: () => void;
  export let onColorSelect: (color: string) => void;
</script>

<Popup
  {open}
  {anchor}
  placement="left"
  offset={16}
  zIndex={1000}
>
  <div class="color-picker-popup">
    <!-- Color square -->
    <div class="color-pickers-row">
      <div
        class="color-square"
        style="background: linear-gradient(to top, #000, transparent),
               linear-gradient(to right, #fff, hsl({hue}, 100%, 50%));"
        on:mousedown|preventDefault={onColorSquareClick}
        on:mousemove={(e) => e.buttons === 1 && onColorSquareClick(e)}
      >
        <div
          class="color-cursor"
          style="left: {saturation}%; top: {100 - lightness}%; border-color: {lightness > 70 || (saturation < 30 && lightness > 30) ? '#000' : '#fff'};"
        ></div>
      </div>

      <!-- Hue slider -->
      <div class="hue-slider-container">
        <input
          type="range"
          class="hue-slider"
          min="0"
          max="359"
          bind:value={hue}
          on:input={() => onHueChange(hue)}
        />
      </div>
    </div>

    <!-- RGB inputs -->
    <div class="color-inputs-container">
      <h4>RGB</h4>
      <div class="color-inputs-row">
        <div class="color-input-group">
          <label for="rgb-r">R</label>
          <input
            id="rgb-r"
            type="number"
            min="0"
            max="255"
            bind:value={rgbValues.r}
            on:change={onRgbChange}
          />
        </div>
        <div class="color-input-group">
          <label for="rgb-g">G</label>
          <input
            id="rgb-g"
            type="number"
            min="0"
            max="255"
            bind:value={rgbValues.g}
            on:change={onRgbChange}
          />
        </div>
        <div class="color-input-group">
          <label for="rgb-b">B</label>
          <input
            id="rgb-b"
            type="number"
            min="0"
            max="255"
            bind:value={rgbValues.b}
            on:change={onRgbChange}
          />
        </div>
      </div>
    </div>

    <!-- HSL inputs -->
    <div class="color-inputs-container">
      <h4>HSL</h4>
      <div class="color-inputs-row">
        <div class="color-input-group">
          <label for="hsl-h">H</label>
          <input
            id="hsl-h"
            type="number"
            min="0"
            max="359"
            bind:value={hslValues.h}
            on:change={onHslChange}
          />
        </div>
        <div class="color-input-group">
          <label for="hsl-s">S</label>
          <input
            id="hsl-s"
            type="number"
            min="0"
            max="100"
            bind:value={hslValues.s}
            on:change={onHslChange}
          />
          <span class="unit">%</span>
        </div>
        <div class="color-input-group">
          <label for="hsl-l">L</label>
          <input
            id="hsl-l"
            type="number"
            min="0"
            max="100"
            bind:value={hslValues.l}
            on:change={onHslChange}
          />
          <span class="unit">%</span>
        </div>
      </div>
    </div>

    <!-- Preset colors -->
    <div class="preset-colors">
      <h4>Presets</h4>
      <div class="preset-colors-grid">
        {#each presetColors as color}
          <button
            class="color-btn preset-color-btn"
            class:active={selectedColorHex === color}
            style="background-color: {color}; border: 1px solid {color === '#FFFFFF' ? '#ddd' : color};"
            on:click={() => onColorSelect(color)}
            title="Select color"
          >
            {#if selectedColorHex === color}
              <span class="check" style="color: {color === '#FFFFFF' || color === '#FFFF00' ? '#000' : '#fff'}">✓</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  </div>
</Popup>

<style lang="scss">
  .color-picker-popup {
    background-color: white;
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 240px;
    max-width: 320px;
    border: 1px solid rgba(0, 0, 0, 0.1);
  }

  h4 {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-color);
    margin: 0 0 8px 0;
  }

  .color-pickers-row {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .color-square {
    width: 100%;
    height: 180px;
    border-radius: 6px;
    border: 1px solid #ddd;
    position: relative;
    cursor: crosshair;
  }

  .color-cursor {
    width: 16px;
    height: 16px;
    border: 2px solid white;
    border-radius: 50%;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }

  .hue-slider-container {
    width: 100%;
    padding: 0 2px;
  }

  .hue-slider {
    width: 100%;
    height: 16px;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 8px;
    background: linear-gradient(to right,
      rgb(255, 0, 0),
      rgb(255, 255, 0),
      rgb(0, 255, 0),
      rgb(0, 255, 255),
      rgb(0, 0, 255),
      rgb(255, 0, 255),
      rgb(255, 0, 0)
    );
    outline: none;

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      border: 1px solid rgba(0, 0, 0, 0.3);
      cursor: pointer;
    }

    &::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      border: 1px solid rgba(0, 0, 0, 0.3);
      cursor: pointer;
    }
  }

  .color-inputs-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .color-inputs-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-input-group {
    display: flex;
    align-items: center;
    gap: 4px;
    position: relative;

    label {
      width: 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-color);
    }

    input[type="number"] {
      width: 48px;
      padding: 6px;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-size: 12px;
      text-align: center;
      -moz-appearance: textfield;

      &::-webkit-outer-spin-button,
      &::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      &:focus {
        outline: none;
        border-color: var(--primary-color, #3b82f6);
      }
    }

    .unit {
      font-size: 12px;
      color: #888;
    }
  }

  .preset-colors {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .preset-colors-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .color-btn {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    border: 1px solid #ddd;
    cursor: pointer;
    position: relative;

    &.active {
      box-shadow: 0 0 0 2px var(--primary-color, #3b82f6);
    }

    &.preset-color-btn {
      width: 100%;
      height: 32px;
    }

    .check {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 16px;
      font-weight: bold;
    }
  }
</style>