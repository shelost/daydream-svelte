<script lang="ts">
  // @ts-nocheck
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/appStore';
  import { getPage } from '$lib/supabase/pages';
  import { afterNavigate, disableScrollHandling } from '$app/navigation';

  import Toolbar from '$lib/components/Toolbar.svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import Diagram from '$lib/components/Diagram.svelte';
  import Panel from '$lib/components/Panel.svelte';

  let pageData = null;
  let loading = true;
  let error = '';
  let selectedTool = 'select';
  let isDrawingMode = false;
  let saving = false;
  let saveStatus = 'saved';
  let pageId = '';
  let unsubscribe;
  let diagramComponent;
  let zoom = 1;

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

      // Verify this is a diagram page
      if (data.type !== 'diagram') {
        error = 'This is not a diagram page';
        return;
      }

      // Initialize default content if needed
      if (!data.content) {
        data.content = { nodes: [], edges: [] };
      }

      pageData = data;

      // Generate a thumbnail if one doesn't exist yet
      setTimeout(() => {
        if (diagramComponent && diagramComponent.generateThumbnail &&
           (!pageData.thumbnail_url || pageData.thumbnail_url === '')) {
          console.log('Generating initial thumbnail for diagram');
          diagramComponent.generateThumbnail();
        }
      }, 5000); // Wait 5 seconds for diagram to fully load

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

  function handleSaving(isSaving) {
    saving = isSaving;
  }

  function handleSaveStatus(status) {
    saveStatus = status;
  }

  function handleToolChange(tool) {
    console.log('Parent: Tool selected:', tool);
    selectedTool = tool;

    // Add debug log to verify the tool change was applied
    setTimeout(() => {
      console.log('Current tool after change:', selectedTool);

      // Check if diagram component has updated
      if (diagramComponent) {
        console.log('Diagram component selectedTool:', diagramComponent.selectedTool);
      }
    }, 100);
  }

  function handleGenerateThumbnail() {
    if (diagramComponent && typeof diagramComponent.generateThumbnail === 'function') {
      console.log('Manually generating thumbnail');
      diagramComponent.generateThumbnail();
    }
  }

  // Handle zoom events from TitleBar
  function handleZoomIn() {
    if (diagramComponent && diagramComponent.zoomIn) {
      diagramComponent.zoomIn();
      zoom = diagramComponent.zoom;
    }
  }

  function handleZoomOut() {
    if (diagramComponent && diagramComponent.zoomOut) {
      diagramComponent.zoomOut();
      zoom = diagramComponent.zoom;
    }
  }

  function handleResetZoom() {
    if (diagramComponent && diagramComponent.resetZoom) {
      diagramComponent.resetZoom();
      zoom = diagramComponent.zoom;
    }
  }

  // Ensure zoom always starts at 100% when page loads
  $: if (pageData && diagramComponent) {
    setTimeout(() => {
      if (!diagramComponent?.resetZoom) return;

      try {
        // Set initial zoom and center view
        zoom = 1;
        diagramComponent.resetZoom();
      } catch (err) {
        console.warn('Error resetting zoom, diagram might not be ready yet:', err);
      }
    }, 800);
  }

  // Handle selection change from the diagram component
  function handleSelectionChange(event) {
    const { type, objects, objectsCount } = event.detail;
    console.log('Diagram selection changed:', { type, objectsCount });

    // Update the panel if needed
    updatePanelProps(objects, type);
  }

  // Update Panel props
  function updatePanelProps(selectedObjects, objectType) {
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

    panel.$set({
      selectedObjects,
      selectedObjectType: objectType,
      currentPageId: pageId,
      pageName: pageData?.title || 'Diagram'
    });
  }
</script>

<svelte:head>
  <title>{pageData ? pageData.title : 'Diagram'} - Daydream</title>
  <link rel="icon" href="/square.png" />
</svelte:head>

<div class="editor-layout">
  <div class="editor-main">
    {#if loading}
      <div class="loading-container">
        <p>Loading diagram...</p>
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
        <div class="diagram-area">
          {#key pageData.id}
          <Diagram
            pageId={pageData.id}
            content={pageData.content}
            bind:selectedTool={selectedTool}
            bind:isDrawingMode={isDrawingMode}
            bind:zoom={zoom}
            onSaving={handleSaving}
            onSaveStatus={handleSaveStatus}
            bind:this={diagramComponent}
            on:selectionChange={handleSelectionChange}
          />
          {/key}
        </div>

        <div class="toolbar">
          <Toolbar
            bind:selectedTool={selectedTool}
            type="diagram"
            on:toolChange={(e) => handleToolChange(e.detail.tool)}
          />
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

  .toolbar {
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

  .diagram-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }
</style>