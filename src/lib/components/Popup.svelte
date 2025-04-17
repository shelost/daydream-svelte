<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { browser } from '$app/environment';

  // Props
  export let open = false;
  export let anchor: HTMLElement | null = null;
  export let placement: 'left' | 'right' | 'top' | 'bottom' = 'left';
  export let offset = 12;
  export let closeOnClickOutside = true;
  export let closeOnEsc = true;
  export let zIndex = 999;

  // Internal state
  let popupElement: HTMLElement;
  let position = { x: 0, y: 0 };

  // Click handler for closing on outside click
  function handleClickOutside(event: MouseEvent) {
    if (!popupElement || !open) return;

    // If clicking the anchor element, don't close
    if (anchor && anchor.contains(event.target as Node)) return;

    // If clicking inside the popup, don't close
    if (popupElement.contains(event.target as Node)) return;

    // Otherwise, close the popup
    open = false;
  }

  // Handle escape key press
  function handleKeydown(event: KeyboardEvent) {
    if (closeOnEsc && open && event.key === 'Escape') {
      open = false;
    }
  }

  // Update position based on anchor
  async function updatePosition() {
    if (!anchor || !popupElement || !browser) return;

    await tick(); // Wait for the DOM to update

    const anchorRect = anchor.getBoundingClientRect();
    const popupRect = popupElement.getBoundingClientRect();

    // Calculate position based on placement
    switch (placement) {
      case 'left':
        position = {
          x: anchorRect.left - popupRect.width - offset,
          y: anchorRect.top + (anchorRect.height / 2) - (popupRect.height / 2)
        };
        break;
      case 'right':
        position = {
          x: anchorRect.right + offset,
          y: anchorRect.top + (anchorRect.height / 2) - (popupRect.height / 2)
        };
        break;
      case 'top':
        position = {
          x: anchorRect.left + (anchorRect.width / 2) - (popupRect.width / 2),
          y: anchorRect.top - popupRect.height - offset
        };
        break;
      case 'bottom':
        position = {
          x: anchorRect.left + (anchorRect.width / 2) - (popupRect.width / 2),
          y: anchorRect.bottom + offset
        };
        break;
    }

    // Adjust position to keep within viewport
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    // Prevent going off left edge
    if (position.x < 10) {
      position.x = 10;
    }

    // Prevent going off right edge
    if (position.x + popupRect.width > viewport.width - 10) {
      position.x = viewport.width - popupRect.width - 10;
    }

    // Prevent going off top edge
    if (position.y < 10) {
      position.y = 10;
    }

    // Prevent going off bottom edge
    if (position.y + popupRect.height > viewport.height - 10) {
      position.y = viewport.height - popupRect.height - 10;
    }
  }

  // Update position when anchor or open state changes
  $: if (open && anchor) {
    // Use setTimeout to ensure DOM is updated
    setTimeout(updatePosition, 10);
  }

  // Set up event listeners
  onMount(() => {
    if (browser) {
      if (closeOnClickOutside) {
        document.addEventListener('mousedown', handleClickOutside);
      }
      if (closeOnEsc) {
        document.addEventListener('keydown', handleKeydown);
      }
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
    }
  });

  // Clean up event listeners
  onDestroy(() => {
    if (browser) {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    }
  });
</script>

{#if open}
  <div
    class="popup"
    bind:this={popupElement}
    style="
      position: fixed;
      left: {position.x}px;
      top: {position.y}px;
      z-index: {zIndex};
    "
  >
    <slot></slot>
  </div>
{/if}

<style>
  .popup {
    animation: popup-fade-in 0.15s ease-out;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15));
  }

  @keyframes popup-fade-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>