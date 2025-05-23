<script lang="ts">
  // @ts-nocheck
  import { Handle, Position } from '@xyflow/svelte';

  export let id;
  export let data;
  export let selected = false;

  // Handle double click to edit label
  let isEditing = false;
  let inputElement;

  function handleDoubleClick() {
    isEditing = true;
    setTimeout(() => {
      if (inputElement) {
        inputElement.focus();
        inputElement.select();
      }
    }, 0);
  }

  function handleBlur() {
    isEditing = false;
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter') {
      isEditing = false;
    } else if (event.key === 'Escape') {
      isEditing = false;
    }
  }
</script>

<div class="node input-node" class:selected on:dblclick={handleDoubleClick}>
  {#if isEditing}
    <input
      bind:this={inputElement}
      bind:value={data.label}
      on:blur={handleBlur}
      on:keydown={handleKeyDown}
    />
  {:else}
    <div class="label">{data.label}</div>
  {/if}

  <Handle type="source" position={Position.Top} id="source-top" />
  <Handle type="source" position={Position.Left} id="source-left" />
  <Handle type="source" position={Position.Right} id="source-right" />
  <Handle type="source" position={Position.Bottom} id="source-bottom" />
</div>

<style>
  .node {
    min-width: 150px;
    border-radius: 5px;
    background: #e6f7ff;
    border: 1px solid #1890ff;
    padding: 10px;
    color: #222;
    font-size: 12px;
    text-align: center;
    transition: box-shadow 0.2s ease-in-out;
    position: relative;
  }

  .selected {
    border-color: #ff4d88;
    box-shadow: 0 0 0 #ff4d88;
  }

  .label {
    padding: 5px;
  }

  input {
    width: 100%;
    padding: 5px;
    border: none;
    border-radius: 3px;
    outline: none;
    text-align: center;
    font-size: 12px;
  }

  :global(.input-node .svelte-flow__handle) {
    width: 8px;
    height: 8px;
    background-color: #1890ff;
    border: 2px solid white;
  }

  :global(.input-node .svelte-flow__handle:hover) {
    background-color: #ff0072;
  }
</style>