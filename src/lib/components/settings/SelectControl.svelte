<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let label: string;
  export let value: string | number;
  export let options: Array<{value: string | number, label: string}>;
  export let selectId: string = label.toLowerCase().replace(/\s+/g, '-');

  const dispatch = createEventDispatcher();

  function handleChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const newValue = options.find(option => option.value.toString() === target.value)?.value || value;
    value = newValue;

    // Dispatch change event to parent
    dispatch('change', { value: newValue });
  }
</script>

<div class="select-row">
  <label for={selectId}>{label}</label>
  <select id={selectId} on:change={handleChange} value={value.toString()}>
    {#each options as option}
      <option value={option.value.toString()}>{option.label}</option>
    {/each}
  </select>
</div>

<style lang="scss">
  .select-row {
    display: flex;
    align-items: center;
    margin-bottom: 8px;

    label {
      width: 90px;
      font-size: 12px;
      color: var(--text-color);
    }

    select {
      flex: 1;
      padding: 4px 8px;
      border-radius: $border-radius-sm;
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      color: var(--text-color);
      font-size: 12px;

      &:focus {
        outline: none;
        border-color: var(--primary-color);
      }
    }
  }
</style>