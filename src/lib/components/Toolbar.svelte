<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Tool } from '$lib/types';

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

  const drawingTools: Array<{id: Tool, label: string, icon: string}> = [
    { id: 'pan', label: 'Pan', icon: 'pan_tool' },
    { id: 'draw', label: 'Draw', icon: 'brush' },
    { id: 'eraser', label: 'Eraser', icon: 'cleaning_services' }
  ];

  $: tools = type === 'canvas' ? canvasTools : drawingTools;

  function selectTool(tool: Tool) {
    selectedTool = tool;
    dispatch('toolChange', { tool });
  }
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

<div class="toolbar">
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
  .toolbar {
    background-color: #ffffff;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 60px;
    height: 100%;
    overflow-y: auto;
    z-index: 10;

    border-radius: 12px;
    box-shadow: -8px 8px 32px rgba(black, 0.1);
    margin: 12px;
  }

  .tools-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tool-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    border: none;
    background-color: transparent;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
      background-color: rgba(0, 0, 0, 0.05);
    }

    &.active {
      background-color: rgba(66, 133, 244, 0.1);
      color: #4285f4;
    }
  }

  .tool-icon {
    font-size: 1.5rem;
    margin-bottom: 0.25rem;
    color: black;
  }

  .tool-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: -.25px;
    color: black;
    text-transform: uppercase;
    display: none;
  }
</style>