<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let label: string;
  export let min: number;
  export let max: number;
  export let step: number = 1;
  export let value: number;
  export let unit: string = '';
  export let decimals: number = 0;

  const dispatch = createEventDispatcher();

  // Format the display value based on decimals
  $: displayValue = decimals > 0
    ? value.toFixed(decimals)
    : Math.round(value).toString();

  // Handle input and change events
  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const newValue = parseFloat(target.value);
    value = newValue;

    // Dispatch change event to parent
    dispatch('change', { value: newValue });
  }
</script>

<div class="slider-row">
  <label for={label.toLowerCase().replace(/\s+/g, '-')}>{label}</label>
  <input
    id={label.toLowerCase().replace(/\s+/g, '-')}
    type="range"
    {min}
    {max}
    {step}
    {value}
    on:input={handleInput}
  />
  <span class="value">{displayValue}{unit}</span>
</div>

<style lang="scss">
  .slider-row {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    width: 100%;

    label {
      width: 40px;
      font-size: 12px;
      color: var(--text-color);
    }

    input[type="range"] {
      flex: 1;
      margin: 0 8px;
    }

    .value {
      min-width: 30px;
      text-align: right;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: var(--text-color);
    }
  }
</style>