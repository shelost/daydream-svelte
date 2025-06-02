<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let title = '';
  export let disabled = false;
  // Custom class name(s) to apply to the underlying <button>
  export let className = '';

  const dispatch = createEventDispatcher();

  function handleClick(event) {
    if (disabled) return;
    // Re-emit so parent components can listen with on:click
    dispatch('click', event);
  }
</script>

<button
  class={className}
  {title}
  {disabled}
  on:click={handleClick}
>
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>

  <slot />
</button>

<style>
  /* Button styling is provided by the parent page via className */
  button{
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 1000;
    padding: 8px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background-color: var(--highlight);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: .2s ease;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
    touch-action: manipulation;
  }

</style>