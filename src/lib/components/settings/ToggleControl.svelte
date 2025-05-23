<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let label: string;
  export let checked: boolean;
  export let description: string = '';

  const dispatch = createEventDispatcher();

  function handleChange(event: Event) {
    const target = event.target as HTMLInputElement;
    checked = target.checked;

    // Dispatch change event
    dispatch('change', { checked });
  }
</script>

<div class="checkbox-row">
  <label title={description}>
    <input type="checkbox" bind:checked on:change={handleChange} />
    {label}
  </label>
  {#if description}
    <span class="info-tooltip" title={description}>ⓘ</span>
  {/if}
</div>

<style lang="scss">
  .checkbox-row {
    display: flex;
    align-items: center;
    margin-bottom: 8px;

    label {
      display: flex;
      align-items: center;
      font-size: 12px;
      color: var(--text-color);
      cursor: pointer;

      input {
        margin-right: 8px;
      }
    }

    .info-tooltip {
      color: var(--text-color);
      opacity: 0.6;
      cursor: help;
      margin-left: 4px;
      font-size: 12px;
    }
  }
</style>