<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Tool } from '$lib/types';
  import { drawingSettings } from '$lib/stores/drawingStore';

  export let selectedTool: Tool = 'select';
  export let type: 'canvas' | 'drawing' = 'canvas';

  const dispatch = createEventDispatcher();

  const canvasTools: Array<{id: Tool, label: string, icon: string}> = [
    { id: 'select', label: 'Select', icon: 'touch_app' },
    { id: 'pan', label: 'Pan', icon: 'pan_tool' },
    { id: 'text', label: 'Text', icon: 'text_fields' },
    { id: 'draw', label: 'Draw', icon: 'brush' },
    { id: 'rectangle', label: 'Shape', icon: 'crop_square' },
    { id: 'eraser', label: 'Eraser', icon: 'cleaning_services' }
  ];

  // Mirror the exact tools from SidebarRight for consistency
  const drawingTools: Array<{id: Tool, label: string, icon: string}> = [
    { id: 'select', label: 'Select', icon: 'select_all' },
    { id: 'draw', label: 'Pen', icon: 'edit' },
    { id: 'eraser', label: 'Eraser', icon: 'cleaning_services' },
    { id: 'pan', label: 'Pan', icon: 'pan_tool' }
  ];

  $: tools = type === 'canvas' ? canvasTools : drawingTools;

  function selectTool(tool: Tool) {
    selectedTool = tool;

    // Update the drawingSettings store
    const sidebarTool = tool === 'draw' ? 'pen' as const :
                         tool === 'eraser' ? 'eraser' as const :
                         tool === 'pan' ? 'pan' as const :
                         tool === 'select' ? 'select' as const : 'pen' as const;

    drawingSettings.update(settings => ({
      ...settings,
      selectedTool: sidebarTool,
      // Clear selection when switching away from select tool
      ...(sidebarTool !== 'select' && { selectedStrokes: [] })
    }));

    dispatch('toolChange', { tool });
  }
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

<div class="toolbar-container">
  <div class="tools-container">
    {#each tools as tool}
      <button
        class="tool-button"
        class:active={selectedTool === tool.id}
        on:click={() => selectTool(tool.id)}
        aria-label={tool.label}
        title={tool.label}
      >
        <span class="tool-icon material-icons">{tool.icon}</span>
        <span class="tool-label">{tool.label}</span>
      </button>
    {/each}
  </div>
</div>

<style lang="scss">
  .tools-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  // Hide tool labels by default, can be shown in larger viewports if needed
  :global(.tool-button .tool-label) {
    display: none;
  }
</style>