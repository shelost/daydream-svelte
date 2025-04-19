<script lang="ts">
  import { onMount } from 'svelte';
  import { pages, user } from '$lib/stores/appStore';
  import { getPages } from '$lib/supabase/pages';
  import { supabase } from '$lib/supabase/client';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import SidebarRight from '$lib/components/SidebarRight.svelte';
  import { page } from '$app/stores';
  import { selectionStore } from '$lib/stores/selectionStore';

  let loadingPages = true;

  // We no longer need to maintain these variables directly
  // since we're using the selection store
  // let selectedObject = null;
  // let selectedObjectType = '';
  // let selectedObjects = [];
  let directDrawingContent = null;

  // Extract the current page ID from the URL if available
  $: currentPageId = $page.params.id || '';

  // Update the selection store whenever the current page ID changes
  $: if (currentPageId) {
    selectionStore.update(state => ({
      ...state,
      currentPageId
    }));
  }

  onMount(async () => {
    // Load all pages for the current user
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (currentUser) {
        // Load all pages for the sidebar
        const { data, error } = await getPages(currentUser.id);

        if (error) {
          console.error('Error loading pages:', error);
        } else if (data) {
          // Update the pages store
          pages.set(data);
        }
      }
    } catch (err) {
      console.error('Unexpected error loading pages:', err);
    } finally {
      loadingPages = false;
    }
  });

  // Handle object updates from SidebarRight
  function handleObjectUpdate(event) {
    const { object, updates } = event.detail;
    console.log('App layout: Object update received:', { updates });

    if (!object || !updates) {
      console.warn('Missing object or updates in event');
      return;
    }

    try {
      // Find all canvases and try each one
      const canvasElements = document.querySelectorAll('canvas');
      let updated = false;

      // Try to find the Canvas component instance
      canvasElements.forEach(canvasEl => {
        try {
          // First, check if there's a Svelte component binding
          if (canvasEl.__svelte && canvasEl.__svelte.updateObject) {
            canvasEl.__svelte.updateObject(object, updates);
            updated = true;
            return;
          }

          // Next, try the Canvas instance if it's exposed globally
          if (window.canvasInstance && window.canvasInstance.updateObject) {
            window.canvasInstance.updateObject(object, updates);
            updated = true;
            return;
          }

          // Last resort: dispatch a custom event that the Canvas component can listen for
          const updateEvent = new CustomEvent('fabric:update-object', {
            detail: { object, updates },
            bubbles: true
          });
          canvasEl.dispatchEvent(updateEvent);
          updated = true;
        } catch (err) {
          console.warn('Error updating object on canvas element:', err);
        }
      });

      if (!updated) {
        console.warn('Could not find any canvas element to update');
      }
    } catch (error) {
      console.error('Error handling object update:', error);
    }
  }

  // Handle selection operations
  function handleClearSelection() {
    const canvasEl = document.querySelector('.canvas-area canvas');
    if (canvasEl && canvasEl.__svelte_component__) {
      canvasEl.__svelte_component__.clearSelection();
    }
  }

  function handleGroupSelection() {
    const canvasEl = document.querySelector('.canvas-area canvas');
    if (canvasEl && canvasEl.__svelte_component__) {
      canvasEl.__svelte_component__.groupSelection();
    }
  }

  function handleUngroupSelection() {
    const canvasEl = document.querySelector('.canvas-area canvas');
    if (canvasEl && canvasEl.__svelte_component__) {
      canvasEl.__svelte_component__.ungroupSelection();
    }
  }

  function handleAlignSelection(event) {
    const { alignment } = event.detail;
    const canvasEl = document.querySelector('.canvas-area canvas');
    if (canvasEl && canvasEl.__svelte_component__) {
      canvasEl.__svelte_component__.alignSelection(alignment);
    }
  }

  function handleDistributeSelection(event) {
    const { direction } = event.detail;
    const canvasEl = document.querySelector('.canvas-area canvas');
    if (canvasEl && canvasEl.__svelte_component__) {
      canvasEl.__svelte_component__.distributeSelection(direction);
    }
  }
</script>

<div class="app-layout">
  <Sidebar currentPageId={currentPageId} />
  <div class="main-content">
    <slot />
  </div>
  <SidebarRight
    directDrawingContent={directDrawingContent}
    on:objectUpdate={handleObjectUpdate}
    on:clearSelection={handleClearSelection}
    on:groupSelection={handleGroupSelection}
    on:ungroupSelection={handleUngroupSelection}
    on:alignSelection={handleAlignSelection}
    on:distributeSelection={handleDistributeSelection}
  />
</div>

<style lang="scss">
  .app-layout {
    width: 100%;
    height: calc(100vh);
    padding: 12px;
    gap: 12px;
    display: flex;
    overflow: hidden;
  }

  .main-content {
    flex: 1;
    box-shadow: -2px 24px 48px rgba(#030025, 0.16);
    overflow: hidden;
    border-radius: $border-radius-lg;
  }
</style>