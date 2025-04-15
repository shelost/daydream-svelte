<script lang="ts">
  import { fly } from 'svelte/transition';
  import { createEventDispatcher } from 'svelte';

  // Define props
  export let selectedTool: 'pen' | 'highlighter' | 'eraser' | 'pan' = 'pen';
  export let strokeColor: string = '#000000';
  export let strokeSize: number = 3;
  export let opacity: number = 1;
  export let thinning: number = 0.5;
  export let smoothing: number = 0.5;
  export let streamline: number = 0.5;
  export let showPressure: boolean = true;
  export let capStart: boolean = true;
  export let capEnd: boolean = true;
  export let taperStart: number = 0;
  export let taperEnd: number = 0;

  // Set up event dispatcher
  const dispatch = createEventDispatcher();

  // Available colors
  const colors = [
    '#000000', // Black
    '#FFFFFF', // White
    '#FF0000', // Red
    '#00FF00', // Green
    '#0000FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Magenta
    '#00FFFF', // Cyan
    '#FFA500', // Orange
    '#800080', // Purple
    '#008080', // Teal
    '#FF4500', // Orange Red
    '#4B0082', // Indigo
    '#228B22', // Forest Green
    '#B22222', // Firebrick
    '#4682B4', // Steel Blue
  ];

  // Function to handle tool changes
  function setTool(tool: 'pen' | 'highlighter' | 'eraser' | 'pan') {
    selectedTool = tool;
    dispatch('toolChange', { tool });
  }

  // Function to handle color changes
  function setColor(color: string) {
    strokeColor = color;
    dispatch('colorChange', { color });
  }

  // Function to handle size changes
  function setSize(size: number) {
    strokeSize = size;
    dispatch('sizeChange', { size });
  }

  // Function to handle opacity changes
  function setOpacity(value: number) {
    opacity = value;
    dispatch('opacityChange', { opacity: value });
  }

  // Function to handle thinning changes
  function setThinning(value: number) {
    thinning = value;
    dispatch('thinningChange', { thinning: value });
  }

  // Function to handle smoothing changes
  function setSmoothing(value: number) {
    smoothing = value;
    dispatch('smoothingChange', { smoothing: value });
  }

  // Function to handle streamline changes
  function setStreamline(value: number) {
    streamline = value;
    dispatch('streamlineChange', { streamline: value });
  }

  // Function to toggle pressure sensitivity
  function togglePressure() {
    showPressure = !showPressure;
    dispatch('pressureChange', { showPressure });
  }

  // Function to toggle cap start
  function toggleCapStart() {
    capStart = !capStart;
    dispatch('capStartChange', { capStart });
  }

  // Function to toggle cap end
  function toggleCapEnd() {
    capEnd = !capEnd;
    dispatch('capEndChange', { capEnd });
  }

  // Function to handle taper start changes
  function setTaperStart(value: number) {
    taperStart = value;
    dispatch('taperStartChange', { taperStart: value });
  }

  // Function to handle taper end changes
  function setTaperEnd(value: number) {
    taperEnd = value;
    dispatch('taperEndChange', { taperEnd: value });
  }
</script>

<div class="floating-toolbar" transition:fly={{ y: 20, duration: 200 }}>
  <div class="toolbar-section tools">
    <button
      class="tool-btn"
      class:active={selectedTool === 'pen'}
      on:click={() => setTool('pen')}
      title="Pen Tool (P)"
    >
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
      </svg>
    </button>

    <button
      class="tool-btn"
      class:active={selectedTool === 'highlighter'}
      on:click={() => setTool('highlighter')}
      title="Highlighter Tool (H)"
    >
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path fill="currentColor" d="M18.5,1.15C17.97,1.15 17.46,1.34 17.07,1.73L11.26,7.55L16.91,13.2L22.73,7.39C23.5,6.61 23.5,5.35 22.73,4.56L19.89,1.73C19.5,1.34 19,1.15 18.5,1.15M10.3,8.5L4.34,14.46C3.56,15.24 3.56,16.5 4.36,17.31C3.14,18.54 1.9,19.77 0.67,21H6.33L7.19,20.14C7.97,20.9 9.22,20.89 10,20.12L15.95,14.16" />
      </svg>
    </button>

    <button
      class="tool-btn"
      class:active={selectedTool === 'eraser'}
      on:click={() => setTool('eraser')}
      title="Eraser Tool (E)"
    >
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path fill="currentColor" d="M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.41,3.56C14.2,2.78 15.46,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.12,15.58L9.17,10.63L4.22,15.58Z" />
      </svg>
    </button>

    <button
      class="tool-btn"
      class:active={selectedTool === 'pan'}
      on:click={() => setTool('pan')}
      title="Pan Tool (Space)"
    >
      <svg viewBox="0 0 24 24" width="24" height="24">
        <path fill="currentColor" d="M9,2V8H11V11H5C3.89,11 3,11.89 3,13V16H1V22H7V20H9V22H15V20H17V22H23V16H21V13C21,11.89 20.11,11 19,11H13V8H15V2H9Z" />
      </svg>
    </button>
  </div>

  <div class="toolbar-divider"></div>

  <div class="toolbar-section colors">
    <div class="color-grid">
      {#each colors as color}
        <button
          class="color-btn"
          class:active={strokeColor === color}
          style="background-color: {color}; border: 1px solid {color === '#FFFFFF' ? '#ddd' : color};"
          on:click={() => setColor(color)}
          title="Select color"
        >
          {#if strokeColor === color}
            <span class="check" style="color: {color === '#FFFFFF' || color === '#FFFF00' ? '#000' : '#fff'}">✓</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <div class="toolbar-divider"></div>

  <div class="toolbar-section sliders">
    <div class="slider-row">
      <label for="stroke-size">Size</label>
      <input
        id="stroke-size"
        type="range"
        min="1"
        max="20"
        step="1"
        bind:value={strokeSize}
        on:input={() => setSize(strokeSize)}
      />
      <span class="value">{strokeSize}px</span>
    </div>

    <div class="slider-row">
      <label for="opacity">Opacity</label>
      <input
        id="opacity"
        type="range"
        min="0.1"
        max="1"
        step="0.05"
        bind:value={opacity}
        on:input={() => setOpacity(opacity)}
      />
      <span class="value">{Math.round(opacity * 100)}%</span>
    </div>
  </div>

  <div class="toolbar-divider"></div>

  <div class="toolbar-section advanced-controls">
    <details>
      <summary>Stroke Settings</summary>
      <div class="advanced-options">
        <div class="slider-row">
          <label for="thinning">Thinning</label>
          <input
            id="thinning"
            type="range"
            min="-1"
            max="1"
            step="0.1"
            bind:value={thinning}
            on:input={() => setThinning(thinning)}
          />
          <span class="value">{thinning.toFixed(1)}</span>
        </div>

        <div class="slider-row">
          <label for="smoothing">Smoothing</label>
          <input
            id="smoothing"
            type="range"
            min="0"
            max="1"
            step="0.1"
            bind:value={smoothing}
            on:input={() => setSmoothing(smoothing)}
          />
          <span class="value">{smoothing.toFixed(1)}</span>
        </div>

        <div class="slider-row">
          <label for="streamline">Streamline</label>
          <input
            id="streamline"
            type="range"
            min="0"
            max="1"
            step="0.1"
            bind:value={streamline}
            on:input={() => setStreamline(streamline)}
          />
          <span class="value">{streamline.toFixed(1)}</span>
        </div>

        <div class="checkbox-row">
          <label>
            <input type="checkbox" bind:checked={showPressure} on:change={togglePressure} />
            Pressure Sensitivity
          </label>
        </div>

        <div class="checkbox-row">
          <label>
            <input type="checkbox" bind:checked={capStart} on:change={toggleCapStart} />
            Cap Start
          </label>
        </div>

        <div class="checkbox-row">
          <label>
            <input type="checkbox" bind:checked={capEnd} on:change={toggleCapEnd} />
            Cap End
          </label>
        </div>

        <div class="slider-row">
          <label for="taper-start">Taper Start</label>
          <input
            id="taper-start"
            type="range"
            min="0"
            max="100"
            step="5"
            bind:value={taperStart}
            on:input={() => setTaperStart(taperStart)}
          />
          <span class="value">{taperStart}</span>
        </div>

        <div class="slider-row">
          <label for="taper-end">Taper End</label>
          <input
            id="taper-end"
            type="range"
            min="0"
            max="100"
            step="5"
            bind:value={taperEnd}
            on:input={() => setTaperEnd(taperEnd)}
          />
          <span class="value">{taperEnd}</span>
        </div>
      </div>
    </details>
  </div>
</div>

<style lang="scss">
  .floating-toolbar {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background-color: white;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    padding: 8px;
    display: flex;
    z-index: 1000;
    max-width: 95vw;
    overflow-x: auto;

    &::-webkit-scrollbar {
      height: 4px;
    }

    &::-webkit-scrollbar-thumb {
      background-color: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
    }
  }

  .toolbar-section {
    display: flex;
    flex-direction: column;
    padding: 0 8px;
  }

  .toolbar-divider {
    width: 1px;
    background-color: #e0e0e0;
    margin: 0 8px;
  }

  .tools {
    display: flex;
    flex-direction: row;
    gap: 4px;
  }

  .tool-btn {
    width: 40px;
    height: 40px;
    border-radius: 4px;
    border: none;
    background: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #555;
    transition: all 0.2s;

    &:hover {
      background-color: #f0f0f0;
    }

    &.active {
      background-color: #e0e0ff;
      color: #4040ff;
    }

    svg {
      width: 24px;
      height: 24px;
    }
  }

  .color-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    margin-top: 4px;
  }

  .color-btn {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    border: 1px solid #ddd;
    cursor: pointer;
    position: relative;

    &.active {
      box-shadow: 0 0 0 2px #4040ff;
    }

    .check {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 12px;
      font-weight: bold;
    }
  }

  .sliders {
    min-width: 200px;
  }

  .slider-row {
    display: flex;
    align-items: center;
    margin: 6px 0;
    font-size: 12px;

    label {
      width: 80px;
      font-weight: 500;
    }

    input[type="range"] {
      flex: 1;
      margin: 0 8px;
    }

    .value {
      width: 40px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    margin: 6px 0;
    font-size: 12px;

    label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }

    input[type="checkbox"] {
      width: 16px;
      height: 16px;
    }
  }

  .advanced-controls {
    summary {
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      padding: 4px 0;

      &:hover {
        color: #4040ff;
      }
    }

    .advanced-options {
      padding: 8px;
      background-color: #f9f9f9;
      border-radius: 4px;
      margin-top: 4px;
      min-width: 240px;
    }
  }

  @media (max-width: 768px) {
    .floating-toolbar {
      flex-wrap: nowrap;
      overflow-x: auto;
      bottom: 10px;
      padding: 6px;
    }

    .sliders {
      min-width: 180px;
    }
  }
</style>