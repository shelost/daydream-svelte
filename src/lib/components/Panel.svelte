<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { page } from '$app/stores';
  import { drawingSettings, activeDrawingId } from '$lib/stores/drawingStore';
  import { getStyleStoreForType } from '$lib/stores/styleStore';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { selectionStore } from '$lib/stores/selectionStore';

  // Import tool settings components
  import PenSettings from './settings/PenSettings.svelte';
  import TextSettings from './settings/TextSettings.svelte';
  import ShapeSettings from './settings/ShapeSettings.svelte';
  import SelectionSettings from './settings/SelectionSettings.svelte';
  import EraserSettings from './settings/EraserSettings.svelte';

  // For backward compatibility, we still accept props
  // But we prioritize the selectionStore values
  export let selectedObject: any = null;
  export let selectedObjectType: string | null = null;
  export let selectedObjects: any[] = [];
  export let currentPageId: string = '';
  export let directDrawingContent: any = null;

  // Create event dispatcher
  const dispatch = createEventDispatcher();

  // Track drawing content for export
  let drawingContent: any = null;
  let drawingTitle = 'drawing';

  // UI state
  let svgExportExpanded = false;
  let svgCustomTitle = '';
  let svgDecimalPrecision = 2;
  let svgOptimizeViewBox = true;
  let svgIncludeMetadata = true;

  // Export status message
  let svgExportStatus = {
    visible: false,
    message: '',
    type: 'info', // 'info', 'success', 'error', 'working'
    timeoutId: null as number | null
  };

  // Show status message
  function showStatus(message: string, type: 'info' | 'success' | 'error' | 'working' = 'info', duration = 0) {
    svgExportStatus = {
      visible: true,
      message,
      type,
      timeoutId: svgExportStatus.timeoutId
    };

    // Clear any existing timeout
    if (svgExportStatus.timeoutId) {
      clearTimeout(svgExportStatus.timeoutId);
    }

    // Set up a new timeout if duration > 0
    if (duration > 0) {
      const timeoutId = window.setTimeout(() => {
    svgExportStatus = {
          ...svgExportStatus,
          visible: false,
          timeoutId: null
        };
      }, duration);

      svgExportStatus = {
        ...svgExportStatus,
        timeoutId
      };
    }
  }

  // Hide status message
  function hideStatus() {
    svgExportStatus = {
      ...svgExportStatus,
      visible: false
    };
  }

  // Check if we're on a drawing page
  $: isDrawingPage = $page && $page.route && $page.route.id
    ? $page.route.id.includes('/drawing/')
    : false;

  // Sync store with props (for backward compatibility)
  $: {
    // Subscribe to selection store changes
    const unsubscribe = selectionStore.subscribe(state => {
      // Only update if the values have actually changed
      if (selectedObject !== state.selectedObject) {
        selectedObject = state.selectedObject;
      }

      if (selectedObjectType !== state.selectedObjectType) {
        selectedObjectType = state.selectedObjectType;
      }

      if (selectedObjects !== state.selectedObjects) {
        selectedObjects = state.selectedObjects;
      }

      if (currentPageId !== state.currentPageId && state.currentPageId) {
        currentPageId = state.currentPageId;
      }
    });

    // Clean up subscription on component unmount
    onMount(() => {
      return unsubscribe;
    });
  }

  // Update selection store from props (for backward compatibility)
  $: if (selectedObject !== undefined || selectedObjectType !== undefined ||
         selectedObjects !== undefined || currentPageId !== undefined) {
    selectionStore.update(state => ({
      ...state,
      selectedObject: selectedObject !== undefined ? selectedObject : state.selectedObject,
      selectedObjectType: selectedObjectType !== undefined ? selectedObjectType : state.selectedObjectType,
      selectedObjects: selectedObjects !== undefined ? selectedObjects : state.selectedObjects,
      currentPageId: currentPageId !== undefined ? currentPageId : state.currentPageId
    }));
  }

  // Function to download SVG
  async function downloadSvg() {
    console.log('Download SVG clicked, drawingContent:', drawingContent);
    console.log('Direct content:', directDrawingContent);

    // Use direct content if available, otherwise fall back to loaded content
    const contentToExport = directDrawingContent || drawingContent;

    if (!contentToExport) {
      console.error('No drawing content available for SVG download');
      showStatus('No drawing content available', 'error', 3000);
      return;
    }

    // If the drawing has no strokes, show an error
    if (!contentToExport.strokes || contentToExport.strokes.length === 0) {
      console.error('Drawing has no strokes for SVG download');
      showStatus('The drawing is empty', 'error', 3000);
      return;
    }

    console.log(`Generating SVG for download with ${contentToExport.strokes.length} strokes`);
    showStatus('Generating SVG...', 'working');

    try {
      // Get the custom title or use the drawing title
      const title = svgCustomTitle.trim() || drawingTitle;

      // Import the function dynamically to avoid issues
      const { svgFromStrokes } = await import('$lib/utils/drawingUtils');

      // Generate SVG content with optimization options
      const result = svgFromStrokes(
        contentToExport.strokes,
        contentToExport.bounds?.width || 800,
        contentToExport.bounds?.height || 600,
        'transparent',
        {
          optimizeViewBox: svgOptimizeViewBox,
          decimals: svgDecimalPrecision,
          metadata: svgIncludeMetadata,
          title
        }
      );

      // Check if there was an error
      if (result.error) {
        console.error('Error in SVG generation for download:', result.error);
        showStatus(`Error: ${result.error}`, 'error', 5000);
        return;
      }

      // Get the SVG string - at this point we know it exists since we checked for result.error
      const svgContent = result.svg!;  // Use non-null assertion
      console.log('SVG generated successfully for download, length:', svgContent.length);

      // Create a blob with the SVG content
      const blob = new Blob([svgContent], { type: 'image/svg+xml' });

      // Create a download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title.replace(/\s+/g, '-').toLowerCase()}.svg`;

      // Trigger download
      document.body.appendChild(link);
      link.click();

      // Clean up
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Show success message
      showStatus('SVG downloaded successfully', 'success', 3000);
    } catch (error) {
      console.error('Error generating SVG for download:', error);
      showStatus(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error', 5000);
    }
  }

  // Function to view SVG in a new tab
  async function viewSvg() {
    console.log('View SVG clicked, drawingContent:', drawingContent);
    console.log('Direct content:', directDrawingContent);

    // Use direct content if available, otherwise fall back to loaded content
    const contentToExport = directDrawingContent || drawingContent;

    if (!contentToExport) {
      console.error('No drawing content available for SVG export');
      showStatus('No drawing content available', 'error', 3000);
      return;
    }

    // If the drawing has no strokes, show an error
    if (!contentToExport.strokes || contentToExport.strokes.length === 0) {
      console.error('Drawing has no strokes for SVG export');
      showStatus('The drawing is empty', 'error', 3000);
      return;
    }

    console.log(`Generating SVG for ${contentToExport.strokes.length} strokes`);
    showStatus('Generating SVG...', 'working');

    try {
      // Get the custom title or use the drawing title
      const title = svgCustomTitle.trim() || drawingTitle;

      // Import the function dynamically to avoid issues
      const { svgFromStrokes } = await import('$lib/utils/drawingUtils');

      // Generate SVG content with optimization options
      const result = svgFromStrokes(
        contentToExport.strokes,
        contentToExport.bounds?.width || 800,
        contentToExport.bounds?.height || 600,
        'transparent',
        {
          optimizeViewBox: svgOptimizeViewBox,
          decimals: svgDecimalPrecision,
          metadata: svgIncludeMetadata,
          title
        }
      );

      // Check if there was an error
      if (result.error) {
        console.error('Error in SVG generation:', result.error);
        showStatus(`Error: ${result.error}`, 'error', 5000);
        return;
      }

      // Get the SVG string - at this point we know it exists since we checked for result.error
      const svgContent = result.svg!;  // Use non-null assertion
      console.log('SVG generated successfully, length:', svgContent.length);

      // Create a blob with the SVG content
      const blob = new Blob([svgContent], { type: 'image/svg+xml' });

      // Create a URL and open in a new tab
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');

      // We don't revoke the URL immediately as it would prevent the SVG from loading
      // The browser will clean it up when the tab is closed
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60000); // Clean up after 1 minute

      // Show success message
      showStatus('SVG opened in new tab', 'success', 3000);
    } catch (error) {
      console.error('Error generating SVG:', error);
      showStatus(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error', 5000);
    }
  }

  // Toggle SVG export options
  function toggleSvgExportOptions() {
    svgExportExpanded = !svgExportExpanded;
  }

  // Load drawing content when ID changes
  async function loadDrawingContent(id: string) {
    if (!id) return;

    console.log('Loading drawing content for ID:', id);

    try {
      // Import the getPage function
      const { getPage } = await import('$lib/supabase/pages');
      const { data, error } = await getPage(id);

      if (error) {
        console.error('Error loading drawing:', error);
        return;
      }

      if (!data) {
        console.error('No data found for drawing ID:', id);
        return;
      }

      if (data.type !== 'drawing') {
        console.error('Not a drawing page:', data);
        return;
      }

      console.log('Drawing content loaded:', data.content);
      drawingContent = data.content || { strokes: [] };
      drawingTitle = data.title || 'drawing';
    } catch (error) {
      console.error('Error loading drawing content:', error);
    }
  }

  // Load drawing content when component mounts or ID changes
  $: if (isDrawingPage && $activeDrawingId) {
    loadDrawingContent($activeDrawingId);
  }

  // Update activeDrawingId when the currentPageId changes
  $: if (isDrawingPage && currentPageId) {
    activeDrawingId.set(currentPageId);
  }

  // Handle events from tool setting components
  function handleObjectUpdate(event: CustomEvent) {
    console.log('Panel: Received object update:', event.detail);

    const { object, updates } = event.detail;

    if (!object || !updates) {
      console.warn('Panel: Missing object or updates in event');
      return;
    }

    // Forward the update event to the parent component
    dispatch('objectUpdate', {
      object: object, // Use the original object from the event
      updates: updates
    });
  }

  function handleClearSelection() {
    dispatch('clearSelection');
  }

  function handleGroupSelection() {
    dispatch('groupSelection');
  }

  function handleUngroupSelection() {
    dispatch('ungroupSelection');
  }

  function handleAlignSelection(event: CustomEvent) {
    dispatch('alignSelection', event.detail);
  }

  function handleDistributeSelection(event: CustomEvent) {
    dispatch('distributeSelection', event.detail);
  }

  // Add event listener for page changes
  onMount(() => {
    // Immediately load the content on mount if we have an activeDrawingId
    if (isDrawingPage && $activeDrawingId) {
      loadDrawingContent($activeDrawingId);
    }

    console.log('Panel mounted, activeDrawingId:', $activeDrawingId);
  });

  // Determine what settings panel to show based on mode and selection
  $: toolToShow = (() => {
    // Use selectionStore values for determining what to show
    const storeState = get(selectionStore);
    const currentObjectType = storeState.selectedObjectType;
    const hasSelectedObject = storeState.selectedObject !== null;
    const objectsCount = storeState.selectedObjects?.length || 0;

    // Add more detailed logging to understand the state
    console.log('Panel determining toolToShow:', {
      isDrawingPage,
      selectedObject: hasSelectedObject ? 'exists' : 'none',
      currentObjectType,
      selectedObjectsCount: objectsCount,
      currentDrawingTool: $drawingSettings.selectedTool
    });

    // ALWAYS prioritize selected objects first, regardless of page type
    if (hasSelectedObject && currentObjectType) {
      console.log('Object is selected, showing object-specific settings');
      if (currentObjectType === 'text' || currentObjectType?.includes('text')) {
        console.log('→ Showing TEXT settings');
        return 'text';
      }
      if (['rect', 'rectangle', 'circle', 'triangle', 'polygon'].includes(currentObjectType)) {
        console.log('→ Showing SHAPE settings');
        return 'shape';
      }
      if (['line', 'path'].includes(currentObjectType)) {
        console.log('→ Showing LINE settings');
        return 'line';
      }
      if (currentObjectType === 'image') {
        console.log('→ Showing IMAGE settings');
        return 'image';
      }
    }

    // Then check for multiple selected objects
    if (objectsCount > 0) {
      console.log('→ Showing SELECTION settings for multiple objects');
      return 'selection';
    }

    // Drawing page specific logic (only if no object is selected)
    if (isDrawingPage) {
      if ($drawingSettings.selectedTool === 'select' && $drawingSettings.selectedStrokes.length > 0) {
        console.log('→ Showing SELECTION settings for strokes');
        return 'selection';
      }
      console.log('→ Showing tool settings for:', $drawingSettings.selectedTool);
      return $drawingSettings.selectedTool; // 'pen', 'eraser', 'pan', etc.
    }

    // No object selected, show current tool settings
    console.log('→ No selection, showing tool settings for:', $drawingSettings.selectedTool);
    return $drawingSettings.selectedTool; // Tool being used but nothing selected
  })();

  // Determine shape type for shape settings
  $: shapeType = selectedObjectType === 'rect' || selectedObjectType === 'rectangle' ? 'rect' :
                  selectedObjectType === 'circle' ? 'circle' :
                  selectedObjectType === 'triangle' ? 'triangle' :
                  selectedObjectType === 'polygon' ? 'polygon' : 'rect';

  // Add explicit reactivity to log when selectedObjectType changes
  $: {
    if (selectedObjectType) {
      console.log('Panel: selectedObjectType changed to:', selectedObjectType);
    } else if (selectedObjectType === null) {
      console.log('Panel: selectedObjectType cleared');
    }
  }
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

<aside class="panel">
  <div class="panel-header">
    <h2>Tool Settings</h2>
  </div>

  <div class="panel-content">
    <!-- Debug info - only visible in development mode -->
    {#if import.meta.env.DEV}
      <section class="panel-section debug-info">
        <details>
          <summary>Debug Info</summary>
          <div class="debug-values">
            <p>Tool: <strong>{toolToShow}</strong></p>
            <p>Object Type: <strong>{selectedObjectType || 'none'}</strong></p>
            <p>Has Object: <strong>{selectedObject ? 'yes' : 'no'}</strong></p>
            <p>Objects Count: <strong>{selectedObjects?.length || 0}</strong></p>
        </div>
        </details>
      </section>
    {/if}

    <!-- Dynamic Tool Settings -->
    {#if selectedObjectType === 'pen'}
      <PenSettings />
    {:else if selectedObjectType === 'text'}
      <TextSettings selectedObject={selectedObject} on:update={handleObjectUpdate} />
    {:else if selectedObjectType === 'shape'}
      <ShapeSettings selectedObject={selectedObject} shapeType={shapeType} on:update={handleObjectUpdate} />
    {:else if selectedObjectType === 'selection'}
      <SelectionSettings
        selectedObjects={selectedObjects}
        selectionType={isDrawingPage ? 'drawing' : 'canvas'}
        on:clearSelection={handleClearSelection}
        on:groupSelection={handleGroupSelection}
        on:ungroupSelection={handleUngroupSelection}
        on:alignSelection={handleAlignSelection}
        on:distributeSelection={handleDistributeSelection}
        on:updateSelection={handleObjectUpdate}
      />
    {:else if selectedObjectType === 'eraser'}
      <EraserSettings />
    {:else if selectedObjectType === 'pan'}
      <section class="panel-section">
        <h3>Pan Tool</h3>
        <div class="info-text">
          <span class="material-icons">info</span>
          <p>Click and drag to pan the canvas. Use mouse wheel to zoom in and out.</p>
        </div>
      </section>
    {:else}
      <section class="panel-section">
        <h3>Tool Settings</h3>
        <div class="info-text">
          <span class="material-icons">info</span>
          <p>Select a tool or object to see its settings.</p>
        </div>
      </section>
    {/if}

    <!-- Keyboard Shortcuts -->
    <section class="panel-section keyboard-shortcuts">
      <details>
        <summary>Keyboard Shortcuts</summary>
        <div class="shortcuts-list">
          <div class="shortcut-item">
            <span class="key">P</span>
            <span class="description">Pen Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">S</span>
            <span class="description">Select Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">E</span>
            <span class="description">Eraser Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">T</span>
            <span class="description">Text Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">R</span>
            <span class="description">Rectangle Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">Space</span>
            <span class="description">Pan Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">Ctrl/⌘ + Z</span>
            <span class="description">Undo</span>
          </div>
          <div class="shortcut-item">
            <span class="key">Ctrl/⌘ + Shift + Z</span>
            <span class="description">Redo</span>
          </div>
          <div class="shortcut-item">
            <span class="key">+</span>
            <span class="description">Zoom In</span>
          </div>
          <div class="shortcut-item">
            <span class="key">-</span>
            <span class="description">Zoom Out</span>
          </div>
          <div class="shortcut-item">
            <span class="key">0</span>
            <span class="description">Reset Zoom</span>
          </div>
          <div class="shortcut-item">
            <span class="key">Delete</span>
            <span class="description">Delete Selected</span>
          </div>
        </div>
      </details>
    </section>

    <!-- Export Section (only for drawing pages) -->
    {#if isDrawingPage}
    <section class="panel-section export-section">
      <h3>Export</h3>

      <!-- Status message for SVG export -->
      {#if svgExportStatus.visible}
        <div class="status-message {svgExportStatus.type}">
          {#if svgExportStatus.type === 'working'}
            <span class="material-icons spinning">refresh</span>
          {:else if svgExportStatus.type === 'success'}
            <span class="material-icons">check_circle</span>
          {:else if svgExportStatus.type === 'error'}
            <span class="material-icons">error</span>
          {:else}
            <span class="material-icons">info</span>
          {/if}
          <span>{svgExportStatus.message}</span>
          <button class="close-status" on:click={hideStatus}>
            <span class="material-icons">close</span>
          </button>
        </div>
      {/if}

      <details class="svg-export-options" bind:open={svgExportExpanded}>
        <summary>Export Options</summary>
        <div class="options-container">
          <div class="option-row">
            <label for="svg-title">Custom title:</label>
            <input
              id="svg-title"
              type="text"
              placeholder={drawingTitle}
              bind:value={svgCustomTitle}
            />
          </div>

          <div class="option-row">
            <label for="svg-precision">Decimal precision:</label>
            <select id="svg-precision" bind:value={svgDecimalPrecision}>
              <option value={1}>1 decimal place</option>
              <option value={2}>2 decimal places</option>
              <option value={3}>3 decimal places</option>
              <option value={4}>4 decimal places</option>
            </select>
          </div>

          <div class="checkbox-row">
            <label>
              <input type="checkbox" bind:checked={svgOptimizeViewBox} />
              Optimize viewBox
            </label>
            <span class="info-tooltip" title="Calculates the minimal viewBox based on the drawing content">ⓘ</span>
          </div>

          <div class="checkbox-row">
            <label>
              <input type="checkbox" bind:checked={svgIncludeMetadata} />
              Include metadata
            </label>
            <span class="info-tooltip" title="Adds title and creation info to the SVG file">ⓘ</span>
          </div>
        </div>
      </details>

      <div class="export-buttons">
        <button
          class="export-btn download-svg-btn"
          on:click={downloadSvg}
          title="Download your drawing as an SVG file"
        >
          <span class="material-icons">download</span>
          <span>Download SVG</span>
        </button>

        <button
          class="export-btn view-svg-btn"
          on:click={viewSvg}
          title="View your drawing as an SVG in a new tab"
        >
          <span class="material-icons">visibility</span>
          <span>View SVG</span>
        </button>

        {#if import.meta.env.DEV}
        <button
          class="export-btn debug-btn"
          on:click={() => console.log('Drawing Content:', drawingContent)}
          title="Debug drawing content (DEV only)"
        >
          <span class="material-icons">bug_report</span>
          <span>Debug Content</span>
        </button>
        {/if}
      </div>
    </section>
    {/if}
  </div>
</aside>

<style lang="scss">
  .panel {
    border-radius: $border-radius-lg;
    box-sizing: border-box;
    width: 220px;
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    background-color: var(--sidebar-bg);
    border: 1px solid var(--border-color);
    //box-shadow: -8px 18px 32px rgba(black, 0.8), inset -2px -6px 12px rgba(black, 0.03);

    &::-webkit-scrollbar {
      width: 8px;
    }

    &::-webkit-scrollbar-thumb {
      background-color: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
    }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid var(--border-color);

    h2 {
      font-size: 1.2rem;
      font-weight: 600;
      margin: 0;
      color: var(--text-color);
    }
  }

  .panel-content {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .info-text {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    background-color: var(--hover-bg);
    border-radius: $border-radius-md;
    margin-top: 8px;

    .material-icons {
      font-size: 16px;
      color: var(--text-color);
      opacity: 0.7;
    }

    p {
      font-size: 12px;
      margin: 0;
      color: var(--text-color);
      opacity: 0.9;
      line-height: 1.4;
    }
  }

  // Keyboard shortcuts styles
  .shortcuts-list {
    padding: 8px;
    background-color: var(--hover-bg);
    border-radius: $border-radius-md;
    margin-top: 8px;
  }

  .shortcut-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 12px;
    color: var(--text-color);
    border-bottom: 1px solid rgba(var(--border-color), 0.5);

    &:last-child {
      border-bottom: none;
    }

    .key {
    font-family: monospace;
      background-color: var(--hover-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 11px;
    color: var(--text-color);
    }

    .description {
      color: var(--text-color);
    }
  }

  // Export section specific styles
  .export-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .export-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: var(--hover-bg);
    border: 1px solid var(--border-color);
    border-radius: $border-radius-md;
    padding: 10px 12px;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    color: var(--text-color);

    &:hover {
      background-color: var(--tool-hover-bg);
    }

    .material-icons {
      font-size: 18px;
    }
  }

  .download-svg-btn {
    background-color: var(--tool-active-bg);
    color: var(--tool-active-color);
    border-color: rgba(var(--primary-color), 0.2);

    &:hover {
      background-color: var(--tool-hover-bg);
    }
  }

  // Status message styles
  .status-message {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: $border-radius-md;
    margin-bottom: 8px;
    font-size: 12px;

    &.success {
      background-color: rgba(var(--success-color), 0.1);
      color: var(--success-color);
    }

    &.error {
      background-color: rgba(var(--error-color), 0.1);
      color: var(--error-color);
    }

    &.info, &.working {
      background-color: var(--hover-bg);
      color: var(--text-color);
    }

    .spinning {
      animation: spin 1s linear infinite;
    }

    .close-status {
      margin-left: auto;
      padding: 0;
      background: none;
      border: none;
      cursor: pointer;
      color: inherit;
      opacity: 0.6;

      &:hover {
        opacity: 1;
      }
    }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  // SVG Export options
  .svg-export-options {
    margin: 8px 0;
    background-color: var(--hover-bg);
    border-radius: $border-radius-md;

    summary {
      cursor: pointer;
      padding: 8px;
      color: var(--text-color);
      font-weight: 500;
    }
  }

  .options-container {
    padding: 8px;
  }

  .option-row {
    display: flex;
    align-items: center;
    margin: 8px 0;
    gap: 8px;

    label {
      min-width: 120px;
      color: var(--text-color);
    }

    input, select {
      flex: 1;
      background-color: var(--card-bg);
      color: var(--text-color);
      border: 1px solid var(--border-color);
    }
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    margin: 8px 0;

    label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-color);
    }
  }

  .info-tooltip {
    color: var(--text-color);
    opacity: 0.6;
    cursor: help;
    margin-left: 4px;
  }

  /* Add styles for debug info */
  .debug-info {
    padding: 0;
    margin-bottom: 16px;

    details {
      summary {
        font-size: 12px;
        padding: 8px;
        cursor: pointer;
        background-color: rgba(255, 235, 59, 0.1);
        border-radius: 4px;
      }

      .debug-values {
        margin-top: 8px;
        padding: 8px;
        background-color: rgba(0, 0, 0, 0.05);
        border-radius: 4px;
        font-size: 12px;

        p {
          margin: 4px 0;
        }
      }
    }
  }
</style>