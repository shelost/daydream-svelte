<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/appStore';
  import { getPage, updatePage } from '$lib/supabase/pages';
  import type { Tool } from '$lib/types';
  import { afterNavigate, disableScrollHandling } from '$app/navigation';
  import { currentDrawingContent } from '$lib/stores/drawingContentStore';

  import Toolbar from '$lib/components/Toolbar.svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import Drawing from '$lib/components/Drawing.svelte';
  import Panel from '$lib/components/Panel.svelte';

  let pageData: any = null;
  let loading = true;
  let error = '';
  let selectedTool: Tool = 'draw';
  let isDrawingMode = true; // Drawings are always in drawing mode
  let saving = false;
  let saveStatus: 'saved' | 'saving' | 'error' = 'saved';
  let pageId = '';
  let unsubscribe: () => void;
  let drawingComponent: Drawing; // Add reference to the drawing component
  let zoom = 1; // Add zoom state
  let drawingContent: any = null; // Add a variable to store the drawing content for export

  // This function loads the page data based on the current pageId
  async function loadPageData(id: string) {
    if (!id) return;

    loading = true;
    error = '';

    try {
      const { data, error: pageError } = await getPage(id);

      if (pageError) {
        console.error('Error loading page:', pageError);
        error = pageError.message;
        return;
      }

      if (!data) {
        error = 'Page not found';
        return;
      }

      // Verify this is a drawing page
      if (data.type !== 'drawing') {
        error = 'This is not a drawing page';
        return;
      }

      // Initialize default content if needed
      if (!data.content) {
        data.content = { strokes: [] };
      }

      pageData = data;

      // Important: Update the drawing content store immediately when page data loads
      // This ensures the store always has the correct content for the current page
      currentDrawingContent.set(data.content);

      // Generate a thumbnail if one doesn't exist yet
      setTimeout(() => {
        if (drawingComponent && (!pageData.thumbnail_url || pageData.thumbnail_url === '')) {
          console.log('Generating initial thumbnail for drawing');
          drawingComponent.generateThumbnail();
        }
      }, 5000); // Wait 5 seconds for drawing to fully load

    } catch (err) {
      console.error('Unexpected error loading page:', err);
      error = err instanceof Error ? err.message : 'Failed to load page';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (!$user) {
      goto('/auth/login');
      return;
    }

    // Subscribe to page store changes
    unsubscribe = page.subscribe(($page) => {
      const newPageId = $page.params.id;
      if (newPageId && newPageId !== pageId) {
        pageId = newPageId;
        loadPageData(pageId);
      }
    });

    // Disable scroll handling to prevent jumping
    disableScrollHandling();

    // Pass drawing content to Panel in the parent layout
    const parentLayout = document.querySelector('div.app-layout');
    if (parentLayout) {
      const panelElements = parentLayout.querySelectorAll('aside.panel');
      if (panelElements.length > 0) {
        const panel = panelElements[0].__svelte_component__;
        if (panel) {
          // Update the Panel component with drawing content
          panel.$set({
            directDrawingContent: drawingContent
          });
        }
      }
    }
  });

  onDestroy(() => {
    if (unsubscribe) unsubscribe();
  });

  // This runs after navigation, including when params change but component stays the same
  afterNavigate(({ from, to }) => {
    if (from && to && from.route.id === to.route.id && from.params?.id !== to.params?.id) {
      const newPageId = to.params?.id;
      if (newPageId && newPageId !== pageId) {
        // Reset the drawing content store before loading new data
        // This prevents the old drawing from showing while the new one loads
        currentDrawingContent.set(null);

        pageId = newPageId;
        loadPageData(pageId);
      }
    }

    // Disable scroll handling to prevent jumping
    disableScrollHandling();
  });

  function handleSaving(isSaving: boolean) {
    saving = isSaving;
  }

  function handleSaveStatus(status: 'saved' | 'saving' | 'error') {
    saveStatus = status;
  }

  function handleToolChange(tool: Tool) {
    selectedTool = tool;
    isDrawingMode = true; // Drawings are always in drawing mode
  }

  function handleGenerateThumbnail() {
    if (drawingComponent && drawingComponent.generateThumbnail) {
      console.log('Manually generating thumbnail');
      drawingComponent.generateThumbnail();
    }
  }

  // Handle zoom events from TitleBar
  function handleZoomIn() {
    if (drawingComponent && drawingComponent.zoomIn) {
      drawingComponent.zoomIn();
      // Update local zoom state to reflect change in Drawing component
      zoom = drawingComponent.zoom;
    }
  }

  function handleZoomOut() {
    if (drawingComponent && drawingComponent.zoomOut) {
      drawingComponent.zoomOut();
      // Update local zoom state to reflect change in Drawing component
      zoom = drawingComponent.zoom;
    }
  }

  function handleResetZoom() {
    if (drawingComponent && drawingComponent.resetZoom) {
      drawingComponent.resetZoom();
      // Update local zoom state to reflect change in Drawing component
      zoom = drawingComponent.zoom;
    }
  }

  // Function to sync zoom from drawing component to local state
  function handleZoomChange(newZoom: number) {
    zoom = newZoom;
  }

  // Ensure zoom always starts at 100% when page loads
  $: if (pageData && drawingComponent) {
    if (!zoom) zoom = 1;
    drawingComponent.zoom = zoom;
    drawingComponent.offsetX = 0;
    drawingComponent.offsetY = 0;
    if (typeof drawingComponent.renderStrokes === 'function') {
      drawingComponent.renderStrokes();
    }
  }

  // This function handles drawing content updates from the Drawing component
  function handleDrawingContentUpdate(event: CustomEvent) {
    // Update our local content variable
    drawingContent = event.detail.content;

    // Only update the store if this is the current active drawing
    // This prevents interference when multiple drawing components might exist
    if (pageData && pageData.id === pageId) {
      currentDrawingContent.set(drawingContent);
    }
  }
</script>

<svelte:head>
  <title>{pageData ? pageData.title : 'Drawing'} - Daydream</title>
</svelte:head>

<div class="editor-layout">
  <div class="editor-main">
    {#if loading}
      <div class="loading-container">
        <p>Loading drawing...</p>
      </div>
    {:else if error}
      <div class="error-container">
        <p>Error: {error}</p>
        <button on:click={() => goto('/app')}>Back to Home</button>
      </div>
    {:else}
      <TitleBar
        page={pageData}
        saving={saving}
        saveStatus={saveStatus}
        selectedTool={selectedTool}
        isDrawingMode={isDrawingMode}
        zoom={zoom}
        on:generateThumbnail={handleGenerateThumbnail}
        on:zoomIn={handleZoomIn}
        on:zoomOut={handleZoomOut}
        on:resetZoom={handleResetZoom}
      />

      <div class="workspace">
        <Toolbar
          bind:selectedTool={selectedTool}
          type="drawing"
          on:toolChange={(e) => handleToolChange(e.detail.tool)}
        />

        <div class="drawing-area">
          {#key pageData?.id}
          <Drawing
            pageId={pageData.id}
            content={pageData.content}
            selectedTool={selectedTool}
            onSaving={handleSaving}
            onSaveStatus={handleSaveStatus}
            bind:this={drawingComponent}
            bind:zoom={zoom}
            on:zoomChange={(e) => handleZoomChange(e.detail.zoom)}
            on:contentUpdate={handleDrawingContentUpdate}
          />
          {/key}
        </div>
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .editor-layout {
    flex: 1;
    height: 100%;
    width: 100%;
    overflow: hidden;
    display: flex;
  }

  .editor-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .workspace {
    flex: 1;
    display: flex;
    overflow: visible;
    position: relative;
  }

  .loading-container,
  .error-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 2rem;
    text-align: center;

    p {
      margin-bottom: 1rem;
      font-size: 1.1rem;
    }

    button {
      padding: 0.5rem 1rem;
      background-color: $primary-color;
      color: white;
      border: none;
      border-radius: $border-radius-sm;
      cursor: pointer;
    }
  }

  .error-container {
    p {
      color: $error-color;
    }
  }

  .drawing-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }
</style>