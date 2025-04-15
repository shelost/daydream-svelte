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

  let pageData: any;
  let loading = true;
  let error = '';
  let selectedTool: Tool = 'select';
  let isDrawingMode = false;
  let saving = false;
  let saveStatus: 'saved' | 'saving' | 'error' = 'saved';
  let pageId: string;
  let unsubscribe: () => void;
  let canvasComponent: { setTool?: (tool: Tool) => void } | undefined;

  // Add variables for selected object information
  let selectedObjectType: string | null = null;
  let selectedObjectId: string | null = null;

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

  function handleSaving(status: boolean) {
    saving = status;
  }

  function handleSaveStatus(status: 'saved' | 'saving' | 'error') {
    saveStatus = status;
  }

  function handleToolChange(tool: Tool) {
    console.log('Parent: Tool selected:', tool);
    selectedTool = tool;
    isDrawingMode = tool === 'draw';
  }

  // Add a reactive statement to ensure tool changes propagate to the Canvas
  $: if (canvasComponent && canvasComponent.setTool && selectedTool) {
    console.log('Parent: Updating canvas tool to:', selectedTool);
    canvasComponent.setTool(selectedTool);
  }
</script>

<svelte:head>
  <title>{pageData ? pageData.title : 'Canvas'} - Daydream</title>
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
      />

      <div class="workspace">
        <Toolbar
          bind:selectedTool={selectedTool}
          type="canvas"
          on:toolChange={(e) => handleToolChange(e.detail.tool)}
        />

        {#key pageData.id}
        <Canvas
          pageId={pageData.id}
          content={pageData.content}
          bind:selectedTool={selectedTool}
          bind:isDrawingMode={isDrawingMode}
          bind:selectedObjectType={selectedObjectType}
          bind:selectedObjectId={selectedObjectId}
          onSaving={handleSaving}
          onSaveStatus={handleSaveStatus}
          bind:this={canvasComponent}
        />
        {/key}
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
</style>