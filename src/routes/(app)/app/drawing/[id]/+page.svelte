<script lang="ts">
  // @ts-nocheck
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/appStore';
  import { getPage, updatePage } from '$lib/supabase/pages';
  import { TOOL_DRAW } from '$lib/types';
  import { afterNavigate, disableScrollHandling } from '$app/navigation';
  import { currentDrawingContent } from '$lib/stores/drawingContentStore';
  import { drawingSettings } from '$lib/stores/drawingStore';

  import Toolbar from '$lib/components/Toolbar.svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import Drawing from '$lib/components/Drawing.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import MiniMap from '$lib/components/MiniMap.svelte';

  let pageData = null;
  let loading = true;
  let error = '';
  let selectedTool = 'draw';
  let isDrawingMode = true; // Drawings are always in drawing mode
  let saving = false;
  let saveStatus = 'saved';
  let pageId = '';
  let unsubscribe;
  let drawingComponent; // Add reference to the drawing component
  let zoom = 1; // Add zoom state
  let drawingContent = null; // Add a variable to store the drawing content for export

  // Minimap state
  let showMiniMap = true;
  let canvasWidth = 0;
  let canvasHeight = 0;
  let canvasOffsetX = 0;
  let canvasOffsetY = 0;
  let viewportWidth = 0;
  let viewportHeight = 0;

  // Track minimap visibility from settings
  $: showMiniMap = $drawingSettings.showMiniMap;

  // Update canvas dimensions if they change in settings
  $: canvasWidth = $drawingSettings.canvasWidth;
  $: canvasHeight = $drawingSettings.canvasHeight;

  // This function loads the page data based on the current pageId
  async function loadPageData(id) {
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

  function handleSaving(isSaving) {
    saving = isSaving;
  }

  function handleSaveStatus(status) {
    saveStatus = status;
  }

  function handleToolChange(tool) {
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
  function handleZoomChange(newZoom) {
    zoom = newZoom;
  }

  // Ensure zoom always starts at 100% when page loads
  $: if (pageData && drawingComponent) {
    // Allow the drawing component to handle centering itself
    // This ensures a consistent behavior between initial load and reset
    if (typeof drawingComponent.resetZoom === 'function') {
      // Use a small timeout to ensure the component is fully initialized
      setTimeout(() => {
        drawingComponent.resetZoom();
      }, 100);
    }
  }

  // This function handles drawing content updates from the Drawing component
  function handleDrawingContentUpdate(event) {
    // Update our local content variable
    drawingContent = event.detail.content;

    // Update canvas dimensions from content if available
    if (drawingContent && drawingContent.bounds) {
      canvasWidth = drawingContent.bounds.width;
      canvasHeight = drawingContent.bounds.height;
    }

    // Only update the store if this is the current active drawing
    // This prevents interference when multiple drawing components might exist
    if (pageData && pageData.id === pageId) {
      currentDrawingContent.set(drawingContent);
    }
  }

  // Handle viewport updates for minimap
  function handleViewportUpdate(event) {
    if (event && event.detail) {
      canvasOffsetX = event.detail.offsetX;
      canvasOffsetY = event.detail.offsetY;
      viewportWidth = event.detail.viewportWidth;
      viewportHeight = event.detail.viewportHeight;
    }
  }

  // Handle minimap interactions
  function handleMoveViewport(event) {
    if (drawingComponent && drawingComponent.moveViewport) {
      drawingComponent.moveViewport(event.detail.deltaX, event.detail.deltaY);
    }
  }

  function handleCenterViewport(event) {
    if (drawingComponent && drawingComponent.setViewport) {
      drawingComponent.setViewport(event.detail.x, event.detail.y);
    }
  }

  // Handle canvas size changes from Panel
  function handleCanvasSizeChanged(event) {
    const { width, height, color, backgroundColor } = event.detail;

    if (drawingComponent && drawingComponent.updateCanvasSize) {
      drawingComponent.updateCanvasSize(width, height);
    }

    // Update local state
    canvasWidth = width;
    canvasHeight = height;

    // Update the drawing settings store
    drawingSettings.update(settings => ({
      ...settings,
      canvasWidth: width,
      canvasHeight: height,
      canvasColor: color,
      backgroundColor: backgroundColor
    }));
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
        <div class="drawing-area" style="background-color: {$drawingSettings.backgroundColor};">
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
            on:viewportUpdate={handleViewportUpdate}
          />
          {/key}

          {#if showMiniMap}
            <MiniMap
              width={200}
              height={150}
              canvasWidth={canvasWidth}
              canvasHeight={canvasHeight}
              viewportX={-canvasOffsetX}
              viewportY={-canvasOffsetY}
              viewportWidth={viewportWidth}
              viewportHeight={viewportHeight}
              zoom={zoom}
              drawingContent={drawingContent}
              canvasColor={$drawingSettings.canvasColor}
              backgroundColor={$drawingSettings.backgroundColor}
              on:moveViewport={handleMoveViewport}
              on:centerViewport={handleCenterViewport}
            />
          {/if}
        </div>

        <div class = 'toolbar'>
          <Toolbar
            bind:selectedTool={selectedTool}
            type="drawing"
            on:toolChange={(e) => handleToolChange(e.detail.tool)}
          />
        </div>

      </div>
    {/if}
  </div>
</div>

<style lang="scss">

.toolbar{
    position: absolute;
    z-index: 2;
    left: 0;
    bottom: 0;
    margin: 12px;
    width: 100%;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
  }


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
    background-color: var(--background-color);
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

  .panel-container {
    position: absolute;
    top: 0;
    right: 0;
    height: 100%;
    z-index: 10;
  }
</style>