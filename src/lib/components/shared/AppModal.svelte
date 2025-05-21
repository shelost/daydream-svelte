<!-- /src/lib/components/shared/AppModal.svelte -->
<script>
  import { createEventDispatcher } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { onMount, onDestroy } from 'svelte';

  export let show = false;
  export let title = 'Modal Title';

  const dispatch = createEventDispatcher();

  function closeModal() {
    dispatch('close');
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && show) {
      closeModal();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

{#if show}
  <div
    class="modal-overlay"
    transition:fade={{ duration: 200 }}
    on:click={closeModal}
    role="dialog"
    aria-modal="true"
    aria-labelledby="modal-title"
  >
    <div
      class="modal-content"
      transition:fly={{ y: -30, duration: 250, opacity: 0 }}
      on:click|stopPropagation
    >
      <header class="modal-header">
        <h2 id="modal-title">{title}</h2>
        <button class="modal-close-button" on:click={closeModal} aria-label="Close modal">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </header>
      <div class="modal-body">
        <slot />
      </div>
    </div>
  </div>
{/if}

<style lang="scss">
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.6);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000; // Ensure it's on top
    backdrop-filter: blur(3px);
  }

  .modal-content {
    background-color: #2c2c2e; // Dark background
    color: #f2f2f7; // Light text
    padding: 20px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    width: 80%;
    max-width: 700px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden; // Prevent content from spilling before body scroll is set
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #48484a; // Subtle separator
    padding-bottom: 12px;
    margin-bottom: 15px;

    h2 {
      margin: 0;
      font-size: 1.4em;
      font-weight: 600;
      color: #f2f2f7;
    }
  }

  .modal-close-button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 5px;
    color: #a1a1a6; // Muted icon color
    transition: color 0.2s ease;

    svg {
      display: block;
    }

    &:hover {
      color: #f2f2f7; // Brighter on hover
    }
  }

  .modal-body {
    flex-grow: 1;
    overflow-y: auto; // Makes only the body scrollable
    padding-right: 10px; // Space for scrollbar

    // Custom scrollbar styling for WebKit browsers
    &::-webkit-scrollbar {
      width: 8px;
    }
    &::-webkit-scrollbar-track {
      background: #3a3a3c; // Darker track
      border-radius: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background-color: #636366; // Muted thumb
      border-radius: 4px;
      border: 2px solid #3a3a3c; // Creates padding around thumb
    }
    &::-webkit-scrollbar-thumb:hover {
      background-color: #8e8e93; // Lighter on hover
    }
  }
</style>