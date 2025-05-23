<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Tool } from '$lib/types';
  import { drawingSettings } from '$lib/stores/drawingStore';

  export let selectedTool: Tool = 'select';
  export let type: 'canvas' | 'drawing' | 'diagram' = 'canvas';

  const dispatch = createEventDispatcher();

  const canvasTools: Array<{id: Tool, label: string, icon: string}> = [
    { id: 'select', label: 'Select', icon: 'select_all' },
    { id: 'pan', label: 'Pan', icon: 'pan_tool' },
    { id: 'text', label: 'Text', icon: 'text_fields' },
    { id: 'draw', label: 'Draw', icon: 'brush' },
    { id: 'rectangle', label: 'Shape', icon: 'crop_square' },
    { id: 'eraser', label: 'Eraser', icon: 'cleaning_services' }
  ];

  // Mirror the exact tools from Panel for consistency
  const drawingTools: Array<{id: Tool, label: string, icon: string}> = [
    { id: 'select', label: 'Select', icon: 'select_all' },
    { id: 'draw', label: 'Pen', icon: 'edit' },
    { id: 'eraser', label: 'Eraser', icon: 'cleaning_services' },
    { id: 'pan', label: 'Pan', icon: 'pan_tool' }
  ];

  // Add diagram-specific tools
  const diagramTools: Array<{id: Tool, label: string, icon: string}> = [
    { id: 'select', label: 'Select', icon: 'select_all' },
    { id: 'pan', label: 'Pan', icon: 'pan_tool' },
    { id: 'node', label: 'Add Node', icon: 'add_box' },
    { id: 'input', label: 'Input Node', icon: 'input' },
    { id: 'output', label: 'Output Node', icon: 'output' },
    { id: 'edge', label: 'Connect', icon: 'linear_scale' },
    { id: 'delete', label: 'Delete', icon: 'delete' }
  ];

  $: tools = type === 'canvas' ? canvasTools :
            type === 'drawing' ? drawingTools :
            diagramTools;

  function selectTool(tool: Tool) {
    selectedTool = tool;

    // Update the drawingSettings store if we're in a drawing
    if (type === 'drawing') {
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
    }

    dispatch('toolChange', { tool });
  }
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

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

<style lang="scss">
  .tools-container {
    display: flex;
    align-items: center;
    width: fit-content;
    height: fit-content;
    background: white;
    border-radius: 12px;
    padding: 8px 8px;
    box-shadow: -4px 24px 32px rgba(#030025, 0.1), -2px 4px 8px rgba(black, 0.05), inset -2px -4px 8px rgba(black, 0.02),  inset 1px 2px 6px rgba(white, 0.5);
    gap: 4px;
  }

  .tool-button{
    background: rgba(white, 0);
    border-radius: 6px;
    width: 40px;
    height: 40px;
    padding: 0;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-color);
    span{
      font-size: 22px;
    }
    &.active{
      background: rgba(#030025, .05);
    }

    &:hover:not(.active) {
      background: rgba(#030025, .02);
    }
  }

  // Hide tool labels by default, can be shown in larger viewports if needed
  :global(.tool-button .tool-label) {
    display: none;
  }

  // For diagram toolbar, we can make it a bit larger to fit all tools
  :global([data-toolbar-type="diagram"] .tools-container) {
    padding: 8px 12px;
    gap: 6px;
  }
</style>