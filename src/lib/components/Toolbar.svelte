<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Tool } from '$lib/types';

  export let selectedTool: Tool = 'select';
  export let type: 'canvas' | 'drawing' = 'canvas';

  const dispatch = createEventDispatcher();

  const canvasTools: Array<{id: Tool, label: string, icon: string}> = [
    { id: 'select', label: 'Select', icon: '👆' },
    { id: 'pan', label: 'Pan', icon: '✋' },
    { id: 'text', label: 'Text', icon: 'T' },
    { id: 'draw', label: 'Draw', icon: '✏️' },
    { id: 'rectangle', label: 'Shape', icon: '⬡' },
    { id: 'eraser', label: 'Eraser', icon: '🧹' }
  ];

  const drawingTools: Array<{id: Tool, label: string, icon: string}> = [
    { id: 'pan', label: 'Pan', icon: '✋' },
    { id: 'draw', label: 'Draw', icon: '✏️' },
    { id: 'eraser', label: 'Eraser', icon: '🧹' }
  ];

  $: tools = type === 'canvas' ? canvasTools : drawingTools;

  function selectTool(tool: Tool) {
    selectedTool = tool;
    dispatch('toolChange', { tool });
  }
</script>

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
        <span class="tool-icon">{tool.icon}</span>
        <span class="tool-label">{tool.label}</span>
      </button>
    {/each}
  </div>
</div>

<style lang="scss">
  .toolbar {
    background-color: #ffffff;
    border-right: 1px solid #e0e0e0;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 60px;
    height: 100%;
    overflow-y: auto;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    z-index: 10;
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
    font-size: 1.2rem;
    margin-bottom: 0.25rem;
  }

  .tool-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>