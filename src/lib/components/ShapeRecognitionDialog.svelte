<script>
  import { fade, fly } from 'svelte/transition';
  import { createEventDispatcher } from 'svelte';

  // Props declaration
  export let show = false;
  export let detectedObjects = [];
  export let isAnalyzing = false;
  export let position = { right: '20px', top: '80px' }; // Default position
  export let debugMode = false;

  const dispatch = createEventDispatcher();

  // Close the dialog
  function close() {
    dispatch('close');
  }

  // Toggle debug mode
  function toggleDebug() {
    debugMode = !debugMode;
    dispatch('toggleDebug');
  }

  // Determine the source of enhancement for display
  function getEnhancementSource(obj) {
    // Create an array of technologies used
    const technologies = [];

    if (obj.enhancedByCNN) technologies.push('CNN');
    if (obj.enhancedByStrokes) technologies.push('Stroke Analysis');
    if (obj.enhancedBySemanticAnalysis) technologies.push('Semantic');
    if (obj.source === 'tensorflow' || obj.detectionSource === 'tensorflow') technologies.push('TensorFlow');
    if (obj.source === 'openai' || obj.detectionSource === 'openai') technologies.push('GPT-4V');
    if (obj.source === 'shape-recognition' || obj.detectionSource === 'shape-recognition') technologies.push('Shape Recognition');

    // If we have technologies, join them
    if (technologies.length > 0) {
      return technologies.join(' + ');
    }

    // Fallback to original source or basic
    return obj.source || obj.detectionSource || 'Basic';
  }

  // Get appropriate color based on confidence
  function getConfidenceColor(confidence) {
    if (confidence >= 0.8) return '#4CAF50'; // Green
    if (confidence >= 0.6) return '#FFC107'; // Amber
    return '#F44336'; // Red
  }
</script>

{#if show}
  <div
    class="dialog-container"
    style="right: {position.right}; top: {position.top};"
    transition:fly={{ y: -20, duration: 200 }}
  >
    <div class="dialog-header">
      <h3>Shape Recognition</h3>
      <div class="header-actions">
        <button class="debug-button" on:click={toggleDebug} title="Toggle debug mode">
          {debugMode ? '🐞' : '👁️'}
        </button>
        <button class="close-button" on:click={close}>×</button>
      </div>
    </div>

    <div class="dialog-content">
      {#if isAnalyzing}
        <div class="analyzing-indicator">
          <div class="spinner"></div>
          <span>Analyzing shapes...</span>
        </div>
      {:else if detectedObjects.length === 0}
        <div class="empty-state">
          <p>No shapes detected. Try drawing more clearly defined shapes.</p>
        </div>
      {:else}
        <div class="objects-list">
          {#each detectedObjects as obj, i}
            <div class="object-card" style="border-left-color: {obj.color || '#9C27B0'}">
              <div class="object-header">
                <div class="object-name">{obj.name}</div>
                <div
                  class="object-confidence"
                  style="color: {getConfidenceColor(obj.confidence)}"
                >
                  {Math.round(obj.confidence * 100)}%
                </div>
              </div>

              {#if obj.snapshot && debugMode}
                <div class="object-snapshot">
                  <img src={obj.snapshot} alt="{obj.name} snapshot" />
                </div>
              {/if}

              {#if obj.category}
                <div class="object-category">Category: {obj.category}</div>
              {/if}

              {#if obj.boundingBox}
                <div class="object-bbox-visualization">
                  <!-- Visual representation of the object's position -->
                  <div class="object-indicator"
                       style="left: {obj.boundingBox.centerX * 100}%;
                              top: {obj.boundingBox.centerY * 100}%;
                              background-color: {obj.color || '#9C27B0'};">
                  </div>
                  <!-- Visual representation of the bounding box -->
                  <div class="object-bbox"
                       style="left: {obj.boundingBox.minX * 100}%;
                              top: {obj.boundingBox.minY * 100}%;
                              width: {obj.boundingBox.width * 100}%;
                              height: {obj.boundingBox.height * 100}%;
                              border-color: {obj.color || '#9C27B0'};">
                  </div>
                </div>

                <div class="object-details">
                  <div class="object-position">
                    Position: ({Math.round(obj.boundingBox.centerX * 100)}%,
                    {Math.round(obj.boundingBox.centerY * 100)}%)
                  </div>
                  <div class="object-size">
                    Size: {Math.round(obj.boundingBox.width * 100)}% ×
                    {Math.round(obj.boundingBox.height * 100)}%
                  </div>
                </div>
              {/if}

              <div class="object-source">
                <span class="source-label">Technology:</span>
                <span class="source-value">{getEnhancementSource(obj)}</span>
              </div>

              {#if obj.isChild || obj.parentId}
                <div class="object-relation">
                  <span class="relation-label">Part of:</span>
                  <span class="relation-value">{obj.parentId || 'parent object'}</span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dialog-container {
    position: fixed;
    width: 320px;
    max-height: 500px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    overflow: hidden;
    z-index: 1000;
    display: flex;
    flex-direction: column;
  }

  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: #f5f5f5;
    border-bottom: 1px solid #eee;
  }

  .dialog-header h3 {
    margin: 0;
    font-size: 16px;
    color: #333;
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  .close-button, .debug-button {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    color: #777;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }

  .close-button:hover, .debug-button:hover {
    background: #eaeaea;
    color: #333;
  }

  .dialog-content {
    padding: 16px;
    overflow-y: auto;
    max-height: calc(500px - 52px); /* 52px is header height */
  }

  .analyzing-indicator {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 0;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 3px solid #f3f3f3;
    border-top: 3px solid #9C27B0;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .empty-state {
    text-align: center;
    padding: 24px 0;
    color: #777;
  }

  .objects-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .object-card {
    border: 1px solid #eee;
    border-left: 4px solid #9C27B0;
    border-radius: 6px;
    padding: 12px;
    background: #fafafa;
  }

  .object-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .object-name {
    font-weight: 600;
    font-size: 14px;
    text-transform: capitalize;
  }

  .object-confidence {
    font-size: 12px;
    font-weight: 500;
  }

  .object-snapshot {
    margin: 8px 0;
    border: 1px solid #eee;
    border-radius: 4px;
    overflow: hidden;

    img {
      width: 100%;
      height: auto;
      display: block;
    }
  }

  .object-bbox-visualization {
    position: relative;
    width: 100%;
    height: 60px;
    background-color: #f0f0f0;
    margin: 8px 0;
    border-radius: 4px;
  }

  .object-indicator {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    z-index: 2;
  }

  .object-bbox {
    position: absolute;
    border: 1px dashed;
    z-index: 1;
  }

  .object-details {
    font-size: 12px;
    color: #666;
    margin-bottom: 8px;
  }

  .object-source {
    font-size: 11px;
    color: #888;
    margin-top: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .source-label, .relation-label {
    font-weight: 500;
    color: #666;
  }

  .source-value, .relation-value {
    color: #9C27B0;
    font-weight: 500;
    padding: 2px 6px;
    background-color: #f3e5f5;
    border-radius: 4px;
    font-size: 10px;
  }

  .object-relation {
    font-size: 11px;
    color: #888;
    margin-top: 4px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .object-category {
    font-size: 12px;
    color: #666;
    margin: 4px 0;
    font-style: italic;
  }
</style>