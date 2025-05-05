<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';

  export let min: number = 0;
  export let max: number = 100;
  export let step: number = 1;
  export let value: number;
  export let disabled: boolean = false;
  export let label: string = '';
  export let showValue: boolean = false;
  export let color: string = '#9c27b0';
  export let height: string = '240px';
  export let width: string = '40px';
  export let onChange: ((value: number) => void) | null = null;

  const dispatch = createEventDispatcher();
  let track: HTMLDivElement;
  let rangeInput: HTMLInputElement;
  let isDragging = false;

  // Calculate percentage for positioning the thumb and fill
  $: percentage = ((value - min) / (max - min)) * 100;
  $: invertedPercentage = 100 - percentage;

  // Function to handle slider interaction
  function updateSliderValue(clientY: number) {
    if (!track || disabled) return;

    const rect = track.getBoundingClientRect();
    const trackHeight = rect.height;

    // Calculate position relative to the track (0 at bottom, 1 at top)
    // Invert the calculation for vertical slider
    const relativeY = rect.bottom - clientY;
    const normalizedY = Math.max(0, Math.min(relativeY, trackHeight)) / trackHeight;

    // Convert position to value
    let newValue = min + normalizedY * (max - min);

    // Quantize to step
    if (step > 0) {
      newValue = Math.round(newValue / step) * step;
    }

    // Ensure value is within bounds
    newValue = Math.max(min, Math.min(max, newValue));

    // Update value
    value = newValue;

    // Update the hidden range input
    if (rangeInput) {
      rangeInput.value = String(newValue);
    }

    // Dispatch change event
    dispatch('change', { value });

    // Call onChange callback if provided
    if (onChange) {
      onChange(value);
    }
  }

  // Handle mouse/touch events
  function handlePointerDown(event: MouseEvent | TouchEvent) {
    if (disabled) return;

    event.preventDefault();
    isDragging = true;

    // Get initial position
    const clientY = 'touches' in event
      ? event.touches[0].clientY
      : (event as MouseEvent).clientY;

    // Set initial value
    updateSliderValue(clientY);

    // Setup event listeners for dragging
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchend', handlePointerUp);
  }

  function handlePointerMove(event: MouseEvent | TouchEvent) {
    if (!isDragging) return;

    event.preventDefault();

    const clientY = 'touches' in event
      ? event.touches[0].clientY
      : (event as MouseEvent).clientY;

    updateSliderValue(clientY);
  }

  function handlePointerUp() {
    isDragging = false;
    window.removeEventListener('mousemove', handlePointerMove);
    window.removeEventListener('touchmove', handlePointerMove);
    window.removeEventListener('mouseup', handlePointerUp);
    window.removeEventListener('touchend', handlePointerUp);
  }

  // Handle input from the hidden range input (for accessibility)
  function handleInputChange(event: Event) {
    const inputElement = event.target as HTMLInputElement;
    value = parseFloat(inputElement.value);

    // Dispatch change event
    dispatch('change', { value });

    // Call onChange callback if provided
    if (onChange) {
      onChange(value);
    }
  }

  onMount(() => {
    // Clean up event listeners on component destruction
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchend', handlePointerUp);
    };
  });
</script>

<div class="vertical-slider-container" style="height: {height}; width: {width};">
  {#if label}
    <div class="slider-label">{label}</div>
  {/if}

  <!-- Hidden range input for accessibility and form submission -->
  <input
    type="range"
    bind:this={rangeInput}
    bind:value={value}
    {min}
    {max}
    {step}
    {disabled}
    class="hidden-range-input"
    on:change={handleInputChange}
    aria-label={label || "Vertical slider"}
  />

  <!-- Custom visual slider implementation -->

  <div
    class="vertical-slider-track"
    class:disabled
    bind:this={track}
    on:mousedown={handlePointerDown}
    on:touchstart={handlePointerDown}
  >
    <div
      class="vertical-slider-fill"
      style="height: calc({percentage}% + 12px); background-color: {color};"
    ></div>

    <div
      class="vertical-slider-thumb"
      style="bottom: {percentage}%; border-color: {color};"
      class:active={isDragging}
    >
      <div class="thumb-highlight"></div>
    </div>
  </div>

  {#if showValue}
    <div class="slider-value">
      <h3>
      {typeof value === 'number' ? value.toFixed(step < 1 ? 1 : 0) : value}
    </h3>
    </div>
  {/if}
</div>

<style lang="scss">
  .vertical-slider-container {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px 0;
    width: 40px;
    gap: 6px;
  }

  .slider-label {
    margin-bottom: 8px;
    font-size: 0.8rem;
    color: white;
    text-align: center;
  }

  .hidden-range-input {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .vertical-slider-track {
    position: relative;
    height: 100%;
    width: 32px;
    background-color: rgba(white, .08);
    cursor: pointer;

    &::before{
      content: '';
      position: absolute;
      top: -6px;
      left: 0;
      width: 100%;
      height: 6px;
      border-radius: 6px 6px 0 0;
      background-color: rgba(white, .08);
    }

    &::after{
      content: '';
      position: absolute;
      bottom: -6px;
      left: 0;
      width: 100%;
      height: 6px;
      border-radius: 0 0 6px 6px;
      background-color: rgba(white, .08);
    }

    &.disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .vertical-slider-fill {
    position: absolute;
    bottom: -6px;
    left: 0;
    width: 100%;
    border-radius: 6px;
    z-index: 2;
    box-shadow: inset -1px -2px 4px rgba(black, .15);
    background-color: rgba(white, .2) !important;
  }

  .vertical-slider-thumb {
    position: absolute;
    left: 50%;
    transform: translate(-50%, 50%);
    width: 32px;
    height: 12px;
    background-color: rgba(white, 1);
    //border: 2px solid white !important;
    border-radius: 20px;
    box-shadow: 0 4px 8px rgba(black, 0.15), inset -1px -2px 2px rgba(black, .25);
    transition: transform 0.15s ease;
    z-index: 2;

    .thumb-highlight {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: white;
      opacity: 0;
      transition: opacity 0.2s ease;
    }

    &:hover {
      //transform: translate(-50%, 50%) scale(1.15);

      .thumb-highlight {
        opacity: 0.15;
      }
    }

    &.active {
      transform: translate(-50%, 50%) scale(1.05);
      box-shadow: 0 4px 8px rgba(black, 0.25), inset -1px -2px 2px rgba(black, .25);

      .thumb-highlight {
        opacity: 0.2;
      }
    }
  }

  .slider-value {
    margin-top: 8px;
    font-variant-numeric: tabular-nums;

    h3{
      color: white;
      font-size: 13px;
      font-weight: 600;
      text-align: center;
    }
  }
</style>