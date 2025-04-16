<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { user } from '$lib/stores/appStore';
  import { getPage, updatePage } from '$lib/supabase/pages';
  import type { Tool } from '$lib/types';
  import { afterNavigate, disableScrollHandling } from '$app/navigation';

  import Toolbar from '$lib/components/Toolbar.svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import Drawing from '$lib/components/Drawing.svelte';

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
    selectedTool = tool;
    isDrawingMode = true; // Drawings are always in drawing mode
  }

  function handleGenerateThumbnail() {
    if (drawingComponent && drawingComponent.generateThumbnail) {
      console.log('Manually generating thumbnail');
      drawingComponent.generateThumbnail();
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
        on:generateThumbnail={handleGenerateThumbnail}
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
    height: 100vh;
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