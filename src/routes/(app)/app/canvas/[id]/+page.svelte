<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/appStore';
  import { getPage } from '$lib/supabase/pages';
  import type { Tool } from '$lib/types';
  import { afterNavigate, disableScrollHandling } from '$app/navigation';

  import type { ComponentType } from 'svelte';

  import Toolbar from '$lib/components/Toolbar.svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import Canvas from '$lib/components/Canvas.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { selectionStore, updateSelection } from '$lib/stores/selectionStore';

  let pageData: any;
  let loading = true;
  let error = '';
  let selectedTool: Tool = 'select';
  let isDrawingMode = false;
  let saving = false;
  let saveStatus: 'saved' | 'saving' | 'error' = 'saved';
  let pageId: string;
  let unsubscribe: () => void = () => {};
  let canvasComponent: {
    setTool?: (tool: Tool) => void;
    generateThumbnail?: () => void;
    zoomIn?: () => void;
    zoomOut?: () => void;
    resetZoom?: () => void;
    zoom?: number;
  } | undefined;
  let zoom = 1; // Add zoom state

  // Add variables for selected object information
  let selectedObjectType: string | null = null;
  let selectedObjectId: string | null = null;

  // Add state for selected objects
  let selectedObject = null;
  let selectedObjects = [];

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

      // Verify this is a canvas page
      if (data.type !== 'canvas') {
        error = 'This is not a canvas page';
        return;
      }

      // Initialize default content if needed
      if (!data.content) {
        data.content = { objects: [], drawings: [] };
      }

      pageData = data;
    } catch (err) {
      console.error('Unexpected error loading page:', err);
      error = err instanceof Error ? err.message : 'Failed to load page';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    try {
      loading = true;
      error = '';

      if (!$user) {
        goto('/');
        return;
      }

      // Set the page ID from the URL parameter
      pageId = $page.params.id;

      // Get page data from database
      const { data, error: pageError } = await getPage($page.params.id);

      if (pageError) {
        error = pageError.message;
        return;
      }

      if (!data) {
        error = 'Page not found';
        return;
      }

      // Verify the page belongs to the current user
      if (data.user_id !== $user.id) {
        error = 'You do not have permission to view this page';
        return;
      }

      // Validate that this is a canvas page
      if (data.type !== 'canvas') {
        goto(`/app/${data.type}/${data.id}`);
        return;
      }

      // Update local page data
      pageData = data;

      // Generate a thumbnail if one doesn't exist yet
      setTimeout(() => {
        if (canvasComponent && canvasComponent.generateThumbnail &&
           (!pageData.thumbnail_url || pageData.thumbnail_url === '')) {
          console.log('Generating initial thumbnail for canvas');
          canvasComponent.generateThumbnail();
        }
      }, 5000); // Wait 5 seconds for canvas to fully load

      // Update Panel props
      updatePanelProps();

    } catch (err) {
      if (err instanceof Error) {
        error = err.message;
      }
    } finally {
      loading = false;
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
    console.log('Parent: Tool selected:', tool);
    selectedTool = tool;
    isDrawingMode = tool === 'draw';
  }

  function handleGenerateThumbnail() {
    if (canvasComponent && typeof canvasComponent.generateThumbnail === 'function') {
      console.log('Manually generating thumbnail');
      canvasComponent.generateThumbnail();
    }
  }

  // Add zoom control handlers
  function handleZoomIn() {
    if (canvasComponent && typeof canvasComponent.zoomIn === 'function') {
      console.log('Zooming in');
      canvasComponent.zoomIn();
      // Update local zoom state to reflect change in Canvas component
      if (canvasComponent.zoom) {
        zoom = canvasComponent.zoom;
      }
    }
  }

  function handleZoomOut() {
    if (canvasComponent && typeof canvasComponent.zoomOut === 'function') {
      console.log('Zooming out');
      canvasComponent.zoomOut();
      // Update local zoom state to reflect change in Canvas component
      if (canvasComponent.zoom) {
        zoom = canvasComponent.zoom;
      }
    }
  }

  function handleResetZoom() {
    if (canvasComponent && typeof canvasComponent.resetZoom === 'function') {
      console.log('Resetting zoom');
      canvasComponent.resetZoom();
      // Update local zoom state to reflect change in Canvas component
      zoom = 1;
    }
  }

  // Additional reactive statement to ensure canvasComponent is properly detected
  $: {
    if (canvasComponent) {
      console.log('Canvas component is ready');
    }
  }

  // Add a reactive statement to ensure tool changes propagate to the Canvas
  $: if (canvasComponent?.setTool && selectedTool) {
    console.log('Parent: Updating canvas tool to:', selectedTool);
    try {
      canvasComponent.setTool(selectedTool);
    } catch (err) {
      console.warn('Error setting tool:', err);
    }
  }

  // Ensure zoom always starts at 100% when page loads, but only after canvas is ready
  $: if (pageData && canvasComponent) {
    // Wait for the canvas component to be fully mounted
    setTimeout(() => {
      if (!canvasComponent?.resetZoom) return;

      try {
        // Set initial zoom and center view
        zoom = 1;
        canvasComponent.resetZoom();
      } catch (err) {
        console.warn('Error resetting zoom, canvas might not be ready yet:', err);
      }
    }, 800); // Increased delay to ensure canvas is mounted and initialized
  }

  // Add handler for selection changes
  function handleSelectionChange(event) {
    const { object, objects, type } = event.detail;
    console.log('Canvas page received selectionChange event:', { type, objectCount: objects?.length || 0 });

    // Update local state
    selectedObject = object;
    selectedObjectType = type;
    selectedObjects = objects || [];

    console.log('Updated selection state:', { selectedObjectType, objectsCount: selectedObjects.length });

    // Update selection store instead of directly updating Panel
    updateSelection({
      selectedObject: object,
      selectedObjectType: type,
      selectedObjects: objects || [],
      currentPageId: pageId
    });
  }

  // Function to update Panel props
  function updatePanelProps() {
    const parentLayout = document.querySelector('div.app-layout');
    if (!parentLayout) {
      console.warn('Cannot find app-layout to update Panel props');
      return;
    }

    const panelElements = parentLayout.querySelectorAll('aside.panel');
    if (panelElements.length === 0) {
      console.warn('Cannot find Panel element');
      return;
    }

    // Find the Svelte component
    const panel = panelElements[0].__svelte_component__;
    if (!panel) {
      console.warn('Panel Svelte component not found');
      return;
    }

    console.log('Updating Panel with:', {
      selectedObject,
      selectedObjectType,
      selectedObjects,
      currentPageId: $page.params.id
    });

    panel.$set({
      selectedObject,
      selectedObjectType,
      selectedObjects,
      currentPageId: $page.params.id
    });
  }
</script>

<svelte:head>
  <title>{pageData ? pageData.title : 'Canvas'} - Daydream</title>
  <link rel="icon" href="/square.png" />
</svelte:head>

<div class="editor-layout">
  <div class="editor-main">
    {#if loading}
      <div class="loading-container">
        <p>Loading canvas...</p>
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
        selectedObjectType={selectedObjectType}
        selectedObjectId={selectedObjectId}
        zoom={zoom}
        on:generateThumbnail={handleGenerateThumbnail}
        on:zoomIn={handleZoomIn}
        on:zoomOut={handleZoomOut}
        on:resetZoom={handleResetZoom}
      />

      <div class="workspace">
        <Toolbar
          bind:selectedTool={selectedTool}
          type="canvas"
          on:toolChange={(e) => handleToolChange(e.detail.tool)}
        />

        <div class="canvas-area">
          {#key pageData.id}
          <Canvas
            pageId={pageData.id}
            content={pageData.content}
            bind:selectedTool={selectedTool}
            bind:isDrawingMode={isDrawingMode}
            bind:selectedObjectType={selectedObjectType}
            bind:selectedObjectId={selectedObjectId}
            bind:zoom={zoom}
            onSaving={handleSaving}
            onSaveStatus={handleSaveStatus}
            bind:this={canvasComponent}
            on:selectionChange={handleSelectionChange}
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
    overflow: hidden;
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

  .canvas-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }
</style>