<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fly, scale } from 'svelte/transition';

  export let position = { x: 20, y: 60 };
  export let nodeTypes = [];

  const dispatch = createEventDispatcher();

  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;

  // Handle start of drag
  function handleMouseDown(event) {
    if (event.target.classList.contains('toolbar-drag-handle')) {
      isDragging = true;
      dragStartX = event.clientX - position.x;
      dragStartY = event.clientY - position.y;
      event.preventDefault();
    }
  }

  // Handle dragging
  function handleMouseMove(event) {
    if (isDragging) {
      position.x = event.clientX - dragStartX;
      position.y = event.clientY - dragStartY;
      event.preventDefault();
    }
  }

  // Handle end of drag
  function handleMouseUp() {
    isDragging = false;
  }

  // Add new node of specified type
  function addNode(type) {
    const nodeData = getNodeDataByType(type);
    dispatch('addNode', { type, data: nodeData });
  }

  // Get default data for each node type
  function getNodeDataByType(type) {
    switch (type) {
      case 'text':
        return { text: 'New Text' };
      case 'uppercase':
        return {};
      case 'result':
        return {};
      case 'drawing':
        return { fabricJson: null, label: 'New Drawing' };
      case 'image':
        return { imageUrl: '/paine.png', label: 'New Image' };
      case 'gpt':
        return { prompt: 'Enter your prompt here...' };
      default:
        return {};
    }
  }
</script>

<svelte:window on:mousemove={handleMouseMove} on:mouseup={handleMouseUp} />

<div
  class="flow-toolbar"
  in:scale={{ duration: 200, start: 0.9 }}
  style="left: {position.x}px; top: {position.y}px;"
  on:mousedown={handleMouseDown}
>
  <div class="toolbar-header">
    <div class="toolbar-drag-handle">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"></path>
        <path d="M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"></path>
        <path d="M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"></path>
      </svg>
    </div>
  </div>

  <div class="toolbar-buttons">
    <button on:click={() => addNode('text')} class="node-button text-node">
      <span class="node-icon">T</span>
      <span class="node-label">Text</span>
    </button>

    <button on:click={() => addNode('uppercase')} class="node-button uppercase-node">
      <span class="node-icon">A→B</span>
      <span class="node-label">Transform</span>
    </button>

    <button on:click={() => addNode('result')} class="node-button result-node">
      <span class="node-icon">R</span>
      <span class="node-label">Result</span>
    </button>

    <button on:click={() => addNode('drawing')} class="node-button drawing-node">
      <span class="node-icon">✏️</span>
      <span class="node-label">Drawing</span>
    </button>

    <button on:click={() => addNode('image')} class="node-button image-node">
      <span class="node-icon">🖼️</span>
      <span class="node-label">Image</span>
    </button>

    <button on:click={() => addNode('gpt')} class="node-button gpt-node">
      <span class="node-icon">AI</span>
      <span class="node-label">AI</span>
    </button>
  </div>
</div>

<style lang="scss">
  .flow-toolbar {
    position: absolute;
    background-color: rgba(10, 10, 12, 0.85);
    backdrop-filter: blur(12px);
    border-radius: 12px;
    box-shadow: 0px 8px 24px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 8px;
    width: 52px;
    z-index: 1000;
    color: white;
    user-select: none;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  }

  .toolbar-header {
    padding: 4px 0;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .toolbar-drag-handle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.7);
    cursor: grab;
    padding: 4px 8px;

    &:hover {
      color: white;
    }

    &:active {
      cursor: grabbing;
    }
  }

  .toolbar-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 0;
  }

  .node-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 6px;
    border-radius: 8px;
    background-color: rgba(50, 50, 60, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.05);
    color: white;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background-color: rgba(255, 255, 255, 0.1);
      transform: translateY(-2px);
    }

    &:active {
      transform: translateY(0px);
    }
  }

  .node-icon {
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 4px;
  }

  .node-label {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
    display: none;
  }

  // Node type-specific styling
  .text-node .node-icon {
    color: #58a6ff;
  }

  .uppercase-node .node-icon {
    color: #f97583;
  }

  .result-node .node-icon {
    color: #8ebd2c;
  }

  .drawing-node .node-icon {
    color: #e6c07b;
  }

  .image-node .node-icon {
    color: #b392f0;
  }

  .gpt-node .node-icon {
    color: #79c0ff;
  }
</style>