<!--
  DebugDrawer.svelte
  A retractable drawer that displays logs from TensorFlow and GPT analysis processes.
  Features tabs to toggle between log types, search functionality, and resizable width.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    tensorflowLogs,
    gptLogs,
    clearLogs,
    formatTimestamp,
    isDebugDrawerOpen,
    type DebugLogEntry
  } from '$lib/services/debugLoggingService';
  import { fade, slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  // Props
  export let position: 'left' | 'right' = 'right';
  export let width: number = 350;
  export let minWidth: number = 250;
  export let maxWidth: number = 600;

  // Reactive state
  let activeTab: 'tensorflow' | 'gpt' = 'tensorflow';
  let searchQuery: string = '';
  let isResizing: boolean = false;
  let startX: number = 0;
  let startWidth: number = width;
  let expandedLogs: Set<number> = new Set();
  let tfLogsContainer: HTMLElement;
  let gptLogsContainer: HTMLElement;
  let autoScroll: boolean = true;

  // Derived state
  $: filteredTfLogs = filterLogs($tensorflowLogs);
  $: filteredGptLogs = filterLogs($gptLogs);

  $: if (autoScroll && tfLogsContainer && activeTab === 'tensorflow' && $tensorflowLogs.length > 0) {
    setTimeout(() => {
      tfLogsContainer.scrollTop = tfLogsContainer.scrollHeight;
    }, 0);
  }

  $: if (autoScroll && gptLogsContainer && activeTab === 'gpt' && $gptLogs.length > 0) {
    setTimeout(() => {
      gptLogsContainer.scrollTop = gptLogsContainer.scrollHeight;
    }, 0);
  }

  // Methods
  function toggleTab(tab: 'tensorflow' | 'gpt') {
    activeTab = tab;
  }

  function toggleExpand(index: number) {
    if (expandedLogs.has(index)) {
      expandedLogs.delete(index);
    } else {
      expandedLogs.add(index);
    }
    expandedLogs = expandedLogs; // Trigger reactivity
  }

  function filterLogs(logs: DebugLogEntry[]): DebugLogEntry[] {
    if (!searchQuery.trim()) return logs;

    const query = searchQuery.toLowerCase().trim();
    return logs.filter(log =>
      log.message.toLowerCase().includes(query) ||
      log.source.toLowerCase().includes(query) ||
      (log.data && JSON.stringify(log.data).toLowerCase().includes(query))
    );
  }

  function clearCurrentLogs() {
    clearLogs(activeTab);
  }

  function startResize(e: MouseEvent) {
    isResizing = true;
    startX = e.clientX;
    startWidth = width;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  function handleResize(e: MouseEvent) {
    if (!isResizing) return;

    const deltaX = position === 'right' ? startX - e.clientX : e.clientX - startX;
    const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + deltaX));
    width = newWidth;
  }

  function endResize() {
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  function formatLogData(data: any): string {
    if (!data) return '';

    try {
      return JSON.stringify(data, null, 2);
    } catch (e) {
      return String(data);
    }
  }

  function truncateData(data: string, maxLength: number = 100): string {
    if (data.length <= maxLength) return data;
    return data.slice(0, maxLength) + '...';
  }

  onMount(() => {
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', endResize);
  });

  onDestroy(() => {
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', endResize);
  });
</script>

{#if $isDebugDrawerOpen}
<div
  class="debug-drawer {position}"
  style="width: {width}px; {position}: 0;"
  transition:slide={{ duration: 300, easing: quintOut, axis: 'x' }}
>
  <div class="resizer" on:mousedown={startResize}></div>

  <div class="header">
    <div class="tabs">
      <button
        class:active={activeTab === 'tensorflow'}
        on:click={() => toggleTab('tensorflow')}
      >
        TensorFlow ({$tensorflowLogs.length})
      </button>
      <button
        class:active={activeTab === 'gpt'}
        on:click={() => toggleTab('gpt')}
      >
        GPT ({$gptLogs.length})
      </button>
    </div>
    <div class="controls">
      <label>
        <input type="checkbox" bind:checked={autoScroll}>
        Auto-scroll
      </label>
      <button class="clear-btn" on:click={clearCurrentLogs}>Clear</button>
      <button class="close-btn" on:click={() => isDebugDrawerOpen.set(false)}>✕</button>
    </div>
  </div>

  <div class="search">
    <input
      type="text"
      placeholder="Search logs..."
      bind:value={searchQuery}
    />
  </div>

  <div class="logs-container">
    {#if activeTab === 'tensorflow'}
      <div class="logs" bind:this={tfLogsContainer}>
        {#if filteredTfLogs.length === 0}
          <div class="empty-state">No TensorFlow logs to display</div>
        {:else}
          {#each filteredTfLogs as log, index}
            <div class="log-entry" transition:fade={{ duration: 200 }}>
              <div class="log-header" on:click={() => toggleExpand(index)}>
                <span class="timestamp">{formatTimestamp(log.timestamp)}</span>
                <span class="source">[{log.source}]</span>
                <span class="message">{log.message}</span>
                <span class="expander">{expandedLogs.has(index) ? '▼' : '▶'}</span>
              </div>
              {#if expandedLogs.has(index) && log.data}
                <pre class="log-data">{formatLogData(log.data)}</pre>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {:else}
      <div class="logs" bind:this={gptLogsContainer}>
        {#if filteredGptLogs.length === 0}
          <div class="empty-state">No GPT logs to display</div>
        {:else}
          {#each filteredGptLogs as log, index}
            <div class="log-entry" transition:fade={{ duration: 200 }}>
              <div class="log-header" on:click={() => toggleExpand(index)}>
                <span class="timestamp">{formatTimestamp(log.timestamp)}</span>
                <span class="source">[{log.source}]</span>
                <span class="message">{log.message}</span>
                <span class="expander">{expandedLogs.has(index) ? '▼' : '▶'}</span>
              </div>
              {#if expandedLogs.has(index) && log.data}
                <pre class="log-data">{formatLogData(log.data)}</pre>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>
{/if}

<style>
  .debug-drawer {
    position: fixed;
    top: 0;
    bottom: 0;
    height: 100vh;
    background-color: #f8f9fa;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    z-index: 1000;
    font-family: monospace;
    overflow: hidden;
  }

  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 5px;
    cursor: ew-resize;
    z-index: 1001;
  }

  .debug-drawer.right .resizer {
    left: 0;
  }

  .debug-drawer.left .resizer {
    right: 0;
  }

  .header {
    display: flex;
    flex-direction: column;
    background-color: #343a40;
    color: white;
    padding: 8px;
  }

  .tabs {
    display: flex;
    margin-bottom: 8px;
  }

  .tabs button {
    flex: 1;
    background: none;
    border: none;
    color: #adb5bd;
    padding: 6px 12px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }

  .tabs button.active {
    color: white;
    border-bottom: 2px solid #0d6efd;
  }

  .controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .controls label {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: #adb5bd;
  }

  .controls input[type="checkbox"] {
    margin-right: 5px;
  }

  .clear-btn, .close-btn {
    background: none;
    border: none;
    color: #adb5bd;
    cursor: pointer;
    padding: 4px 8px;
  }

  .clear-btn:hover, .close-btn:hover {
    color: white;
  }

  .search {
    padding: 8px;
    background-color: #e9ecef;
  }

  .search input {
    width: 100%;
    padding: 6px;
    border: 1px solid #ced4da;
    border-radius: 4px;
  }

  .logs-container {
    flex: 1;
    overflow: hidden;
  }

  .logs {
    height: 100%;
    overflow-y: auto;
    padding: 8px;
  }

  .log-entry {
    margin-bottom: 8px;
    border: 1px solid #dee2e6;
    border-radius: 4px;
    overflow: hidden;
  }

  .log-header {
    display: flex;
    padding: 8px;
    background-color: #e9ecef;
    cursor: pointer;
    font-size: 12px;
    align-items: center;
  }

  .timestamp {
    color: #6c757d;
    margin-right: 6px;
    flex-shrink: 0;
  }

  .source {
    color: #0d6efd;
    margin-right: 6px;
    flex-shrink: 0;
  }

  .message {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .expander {
    margin-left: 6px;
    color: #6c757d;
    flex-shrink: 0;
  }

  .log-data {
    padding: 8px;
    margin: 0;
    background-color: #f8f9fa;
    overflow-x: auto;
    font-size: 12px;
    max-height: 300px;
    overflow-y: auto;
  }

  .empty-state {
    padding: 20px;
    text-align: center;
    color: #6c757d;
  }
</style>