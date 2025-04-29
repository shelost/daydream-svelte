<script>
  import { fade, fly } from 'svelte/transition';
  import { createEventDispatcher } from 'svelte';

  // Props declaration
  export let show = false;
  export let detectedObjects = [];
  export let isAnalyzing = false;
  export let position = { right: '20px', top: '20px' }; // Default position
  export let debugMode = false;

  // New props for text analysis
  export let sketchAnalysis = ""; // GPT-4 Vision analysis
  export let strokeRecognition = ""; // Stroke recognition analysis
  export let isAnalyzingText = false; // If text analysis is in progress

  // New props for enhanced visualization
  export let canvasSnapshot = ""; // Data URL of the canvas image
  export let strokesAnalysisOutput = null; // Output from analyze-strokes endpoint
  export let sketchAnalysisOutput = null; // Output from analyze-sketch endpoint
  export let objectSnapshots = []; // Array of snapshots for each detected object

  // Computed properties to check if we have valid analysis text
  $: hasSketchAnalysis = sketchAnalysis &&
                         sketchAnalysis !== "Draw something to see AI's interpretation" &&
                         sketchAnalysis !== "Analyzing drawing..." &&
                         sketchAnalysis !== "No analysis available";

  $: hasStrokeRecognition = strokeRecognition &&
                           strokeRecognition !== "Draw something to see shapes recognized" &&
                           strokeRecognition !== "Analyzing drawing...";

  $: hasAnyTextAnalysis = hasSketchAnalysis || hasStrokeRecognition;

  $: hasCanvasSnapshot = canvasSnapshot && canvasSnapshot.startsWith('data:');

  $: hasStrokesAnalysis = strokesAnalysisOutput && strokesAnalysisOutput.detectedShapes && strokesAnalysisOutput.detectedShapes.length > 0;

  $: hasSketchAnalysisOutput = sketchAnalysisOutput &&
                            (sketchAnalysisOutput.analysis?.content ||
                             sketchAnalysisOutput.description ||
                             (sketchAnalysisOutput.detectedObjects && sketchAnalysisOutput.detectedObjects.length > 0));

  // State for tab management
  let activeTab = 'objects'; // Initial tab: 'objects', 'image', 'text', 'strokes', 'sketch'

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

  // Change active tab
  function setActiveTab(tab) {
    activeTab = tab;
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
    // Handle undefined, NaN or invalid confidence
    const validConfidence = typeof confidence === 'number' && !isNaN(confidence) ? confidence : 0.5;

    if (validConfidence >= 0.8) return '#4CAF50'; // Green
    if (validConfidence >= 0.6) return '#FFC107'; // Amber
    return '#F44336'; // Red
  }

  // Format confidence to percentage, avoiding NaN
  function formatConfidence(confidence) {
    if (typeof confidence !== 'number' || isNaN(confidence)) {
      return '50%'; // Default value if confidence is invalid
    }
    return Math.round(confidence * 100) + '%';
  }

  // Extract model name from analysis text (if present)
  function extractModelInfo(text) {
    if (!text) return { model: 'Unknown', text };

    const gpt4Pattern = /GPT-4(\s?Vision)?/i;
    const match = text.match(gpt4Pattern);

    if (match) {
      return {
        model: match[0],
        text: text
      };
    }

    return {
      model: 'AI Model',
      text
    };
  }

  // Get the snapshot for a specific object or return placeholder
  function getObjectSnapshot(obj) {
    if (!objectSnapshots || objectSnapshots.length === 0) return null;

    // Find snapshot by matching object id or name
    const snapshot = objectSnapshots.find(snap =>
      (obj.id && snap.id === obj.id) ||
      (snap.name === obj.name && Math.abs(snap.confidence - obj.confidence) < 0.1)
    );

    return snapshot ? snapshot.dataUrl : null;
  }

  // Format debug object for display
  function formatDebugObject(obj) {
    try {
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return 'Unable to stringify object';
    }
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

    <div class="tab-navigation">
      <button
        class="tab-button {activeTab === 'image' ? 'active' : ''}"
        on:click={() => setActiveTab('image')}
        class:has-data={hasCanvasSnapshot}
      >
        Image
      </button>
      <button
        class="tab-button {activeTab === 'text' ? 'active' : ''}"
        on:click={() => setActiveTab('text')}
        class:has-data={hasAnyTextAnalysis}
      >
        Text
      </button>
      <button
        class="tab-button {activeTab === 'strokes' ? 'active' : ''}"
        on:click={() => setActiveTab('strokes')}
        class:has-data={hasStrokesAnalysis}
      >
        Strokes
      </button>
      <button
        class="tab-button {activeTab === 'sketch' ? 'active' : ''}"
        on:click={() => setActiveTab('sketch')}
        class:has-data={hasSketchAnalysisOutput}
      >
        Sketch
      </button>
      <button
        class="tab-button {activeTab === 'objects' ? 'active' : ''}"
        on:click={() => setActiveTab('objects')}
        class:has-data={detectedObjects.length > 0}
      >
        Objects
      </button>
    </div>

    <div class="dialog-content">
      {#if activeTab === 'image'}
        <!-- Image Tab Content -->
        <div class="image-tab-content">
          {#if hasCanvasSnapshot}
            <div class="canvas-snapshot">
              <img src={canvasSnapshot} alt="Drawing canvas" />
            </div>
            <div class="snapshot-info">
              <p>This is the image sent to the AI for analysis.</p>
            </div>
          {:else}
            <div class="empty-state">
              <p>No canvas snapshot available. Draw something to see the image.</p>
            </div>
          {/if}
        </div>

      {:else if activeTab === 'text'}
        <!-- Text Analysis Tab Content -->
        {#if isAnalyzingText && !hasAnyTextAnalysis}
          <div class="analyzing-indicator">
            <div class="spinner"></div>
            <span>Analyzing drawing...</span>
          </div>
        {:else if !hasAnyTextAnalysis}
          <div class="empty-state">
            <p>No text analysis available. Draw something to analyze.</p>
          </div>
        {:else}
          <div class="text-analysis-container">
            {#if hasSketchAnalysis}
              <div class="analysis-card">
                <div class="analysis-header">
                  <h4>AI Sketch Interpretation</h4>
                  <div class="model-badge">GPT-4 Vision</div>
                </div>
                <div class="analysis-content">
                  <p>{sketchAnalysis}</p>
                </div>
              </div>
            {/if}

            {#if hasStrokeRecognition}
              <div class="analysis-card">
                <div class="analysis-header">
                  <h4>Shape Recognition</h4>
                  <div class="model-badge">TensorFlow + CNN + Stroke Analysis</div>
                </div>
                <div class="analysis-content">
                  <p>{strokeRecognition}</p>
                </div>
              </div>
            {/if}

            {#if debugMode}
              <div class="debug-section">
                <h4>Debug Information</h4>
                <div class="debug-item">
                  <div class="debug-label">Total Detected Objects:</div>
                  <div class="debug-value">{detectedObjects.length}</div>
                </div>
                <div class="debug-item">
                  <div class="debug-label">Object Sources:</div>
                  <div class="debug-value">
                    {Object.entries(detectedObjects.reduce((acc, obj) => {
                      const source = obj.source || obj.detectionSource || 'unknown';
                      acc[source] = (acc[source] || 0) + 1;
                      return acc;
                    }, {})).map(([source, count]) => `${source}: ${count}`).join(', ')}
                  </div>
                </div>
              </div>
            {/if}
          </div>
        {/if}

      {:else if activeTab === 'strokes'}
        <!-- Strokes Analysis Tab Content -->
        {#if isAnalyzing && !strokesAnalysisOutput}
          <div class="analyzing-indicator">
            <div class="spinner"></div>
            <span>Analyzing strokes...</span>
          </div>
        {:else if !strokesAnalysisOutput}
          <div class="empty-state">
            <p>No stroke analysis data available. Draw something to analyze.</p>
          </div>
        {:else}
        {strokesAnalysisOutput}
          <div class="strokes-analysis-container">
            <div class="analysis-summary">
              <h4>Stroke Analysis Output</h4>
              <p>
                {strokesAnalysisOutput.analysis?.content || 'No content analysis'}
                (Confidence: {formatConfidence(strokesAnalysisOutput.analysis?.confidence)})
              </p>
            </div>

            <div class="detected-shapes-list">
              <h4>Detected Shapes ({strokesAnalysisOutput.detectedShapes?.length || 0})</h4>
              {#if strokesAnalysisOutput.detectedShapes && strokesAnalysisOutput.detectedShapes.length > 0}
                <div class="shapes-grid">
                  {#each strokesAnalysisOutput.detectedShapes as shape}
                    <div class="shape-card">
                      <div class="shape-header">
                        <span class="shape-name">{shape.name}</span>
                        <span class="shape-confidence" style="color: {getConfidenceColor(shape.confidence)}">
                          {formatConfidence(shape.confidence)}
                        </span>
                      </div>
                      {#if shape.boundingBox}
                      <div class="shape-bbox-visualization">
                        <div class="shape-indicator"
                             style="left: {(shape.boundingBox.centerX !== undefined ? shape.boundingBox.centerX :
                                    (shape.boundingBox.minX + shape.boundingBox.width/2)) * 100}%;
                                    top: {(shape.boundingBox.centerY !== undefined ? shape.boundingBox.centerY :
                                    (shape.boundingBox.minY + shape.boundingBox.height/2)) * 100}%;
                                    background-color: {shape.color || '#9C27B0'};">
                        </div>
                        <div class="shape-bbox"
                             style="left: {shape.boundingBox.minX * 100}%;
                                    top: {shape.boundingBox.minY * 100}%;
                                    width: {shape.boundingBox.width * 100}%;
                                    height: {shape.boundingBox.height * 100}%;
                                    border-color: {shape.color || '#9C27B0'};">
                        </div>
                      </div>
                      {/if}
                      <div class="shape-source">
                        <span class="source-label">Source:</span>
                        <span class="source-value">{shape.source || 'Unknown'}</span>
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <p>No shapes detected from stroke analysis.</p>
              {/if}
            </div>

            {#if debugMode && strokesAnalysisOutput.debug}
              <div class="debug-section">
                <h4>Debug Information</h4>
                <pre class="debug-json">{formatDebugObject(strokesAnalysisOutput.debug)}</pre>
              </div>
            {/if}
          </div>
        {/if}

      {:else if activeTab === 'sketch'}
        <!-- Sketch Analysis Tab Content -->
        {#if isAnalyzing && !sketchAnalysisOutput}
          <div class="analyzing-indicator">
            <div class="spinner"></div>
            <span>Analyzing sketch with AI...</span>
          </div>
        {:else if !sketchAnalysisOutput}
          <div class="empty-state">
            <p>No sketch analysis data available. Draw something to analyze with GPT-4 Vision.</p>
          </div>
        {:else}
          <div class="sketch-analysis-container">
            <div class="analysis-summary">
              <h4>GPT-4 Vision Analysis</h4>
              <p>
                {sketchAnalysisOutput.analysis?.content || sketchAnalysisOutput.description || 'No content analysis'}
                (Confidence: {formatConfidence(sketchAnalysisOutput.analysis?.confidence)})
              </p>
            </div>

            <div class="detected-objects-list">
              <h4>Detected Objects ({sketchAnalysisOutput.detectedObjects?.length || 0})</h4>
              {#if sketchAnalysisOutput.detectedObjects && sketchAnalysisOutput.detectedObjects.length > 0}
                <div class="objects-grid">
                  {#each sketchAnalysisOutput.detectedObjects as object}
                    <div class="object-card">
                      <div class="object-header">
                        <span class="object-name">{object.name}</span>
                        <span class="object-confidence" style="color: {getConfidenceColor(object.confidence)}">
                          {formatConfidence(object.confidence)}
                        </span>
                      </div>
                      {#if object.boundingBox}
                      <div class="object-bbox-visualization">
                        <div class="object-indicator"
                             style="left: {(object.boundingBox.centerX !== undefined ? object.boundingBox.centerX :
                                    (object.boundingBox.minX + object.boundingBox.width/2)) * 100}%;
                                    top: {(object.boundingBox.centerY !== undefined ? object.boundingBox.centerY :
                                    (object.boundingBox.minY + object.boundingBox.height/2)) * 100}%;
                                    background-color: {object.color || '#9C27B0'};">
                        </div>
                        <div class="object-bbox"
                             style="left: {object.boundingBox.minX * 100}%;
                                    top: {object.boundingBox.minY * 100}%;
                                    width: {object.boundingBox.width * 100}%;
                                    height: {object.boundingBox.height * 100}%;
                                    border-color: {object.color || '#9C27B0'};">
                        </div>
                      </div>
                      {/if}
                      <!-- Show x/y coordinates if no bounding box but has position -->
                      {#if !object.boundingBox && typeof object.x === 'number' && typeof object.y === 'number'}
                        <div class="object-bbox-visualization">
                          <div class="object-indicator"
                              style="left: {object.x * 100}%;
                                    top: {object.y * 100}%;
                                    background-color: {object.color || '#9C27B0'};">
                          </div>
                        </div>
                        <div class="object-position">
                          Position: ({Math.round(object.x * 100)}%, {Math.round(object.y * 100)}%)
                        </div>
                      {/if}
                      <div class="object-properties">
                        {#if object.properties && Object.keys(object.properties).length > 0}
                          <div class="properties-list">
                            {#each Object.entries(object.properties) as [key, value]}
                              <div class="property-item">
                                <span class="property-key">{key}:</span>
                                <span class="property-value">{value}</span>
                              </div>
                            {/each}
                          </div>
                        {/if}
                        <!-- Display category if available -->
                        {#if object.category}
                          <div class="property-item">
                            <span class="property-key">Category:</span>
                            <span class="property-value">{object.category}</span>
                          </div>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {:else}
                <p>No objects detected from sketch analysis.</p>
              {/if}
            </div>

            {#if debugMode && sketchAnalysisOutput.debug}
              <div class="debug-section">
                <h4>Debug Information</h4>
                <pre class="debug-json">{formatDebugObject(sketchAnalysisOutput.debug)}</pre>
              </div>
            {/if}
          </div>
        {/if}

      {:else if activeTab === 'objects'}
        <!-- Objects Tab Content -->
        {#if isAnalyzing && !detectedObjects.length}
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
                    {formatConfidence(obj.confidence)}
                  </div>
                </div>

                <!-- Object snapshot - from canvas area -->
                {#if getObjectSnapshot(obj) || (obj.snapshot && debugMode)}
                  <div class="object-snapshot">
                    <img src={getObjectSnapshot(obj) || obj.snapshot} alt="{obj.name} snapshot" />
                  </div>
                {/if}

                {#if obj.category}
                  <div class="object-category">Category: {obj.category}</div>
                {/if}

                {#if obj.boundingBox}
                  <div class="object-bbox-visualization">
                    <!-- Visual representation of the object's position -->
                    <div class="object-indicator"
                         style="left: {obj.boundingBox.centerX !== undefined ? obj.boundingBox.centerX * 100 :
                                (obj.boundingBox.minX + obj.boundingBox.width/2) * 100}%;
                                top: {obj.boundingBox.centerY !== undefined ? obj.boundingBox.centerY * 100 :
                                (obj.boundingBox.minY + obj.boundingBox.height/2) * 100}%;
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
                      Position: ({Math.round((obj.boundingBox.centerX !== undefined ? obj.boundingBox.centerX :
                                 (obj.boundingBox.minX + obj.boundingBox.width/2)) * 100)}%,
                      {Math.round((obj.boundingBox.centerY !== undefined ? obj.boundingBox.centerY :
                                 (obj.boundingBox.minY + obj.boundingBox.height/2)) * 100)}%)
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
      {/if}
    </div>
  </div>
{/if}

<style>
  .dialog-container {
    position: fixed;
    width: 350px;
    max-height: 600px;
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

  .tab-navigation {
    display: flex;
    border-bottom: 1px solid #eee;
    overflow-x: auto;
  }

  .tab-button {
    flex: 1;
    padding: 10px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 14px;
    font-weight: 500;
    color: #777;
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    min-width: 60px;
    text-align: center;
    white-space: nowrap;
  }

  .tab-button:hover {
    background: #f5f5f5;
  }

  .tab-button.active {
    color: #9C27B0;
    border-bottom-color: #9C27B0;
  }

  .tab-button.has-data::after {
    content: '';
    position: absolute;
    top: 10px;
    right: 10px;
    width: 6px;
    height: 6px;
    background-color: #4CAF50;
    border-radius: 50%;
  }

  .dialog-content {
    padding: 16px;
    overflow-y: auto;
    max-height: calc(600px - 96px); /* Account for header + tabs */
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
  }

  .object-snapshot img {
    width: 100%;
    height: auto;
    display: block;
  }

  .object-bbox-visualization, .shape-bbox-visualization {
    position: relative;
    width: 100%;
    height: 60px;
    background-color: #f0f0f0;
    margin: 8px 0;
    border-radius: 4px;
  }

  .object-indicator, .shape-indicator {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    z-index: 2;
  }

  .object-bbox, .shape-bbox {
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

  .source-label, .relation-label, .property-key {
    font-weight: 500;
    color: #666;
  }

  .source-value, .relation-value, .property-value {
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

  /* Text Analysis Styles */
  .text-analysis-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .analysis-card {
    border: 1px solid #eee;
    border-radius: 6px;
    padding: 12px;
    background: #fafafa;
  }

  .analysis-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .analysis-header h4 {
    margin: 0;
    font-size: 14px;
    color: #333;
  }

  .model-badge {
    background: #f3e5f5;
    color: #9C27B0;
    font-size: 10px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .analysis-content {
    font-size: 13px;
    line-height: 1.4;
    color: #444;
    white-space: pre-wrap;
  }

  .debug-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px dashed #ddd;
  }

  .debug-section h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: #666;
  }

  .debug-item {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
    font-size: 12px;
  }

  .debug-label {
    font-weight: 500;
    color: #666;
  }

  .debug-value {
    font-family: monospace;
    color: #444;
  }

  /* Image Tab Styles */
  .image-tab-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .canvas-snapshot {
    border: 1px solid #eee;
    border-radius: 6px;
    overflow: hidden;
    background: #f5f5f5;
  }

  .canvas-snapshot img {
    width: 100%;
    height: auto;
    display: block;
  }

  .snapshot-info {
    font-size: 12px;
    color: #666;
    text-align: center;
  }

  /* Strokes and Sketch Analysis Styles */
  .strokes-analysis-container,
  .sketch-analysis-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .analysis-summary {
    background: #f5f5f5;
    border-radius: 6px;
    padding: 12px;
  }

  .analysis-summary h4 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: #333;
  }

  .analysis-summary p {
    margin: 0;
    font-size: 13px;
    color: #444;
  }

  .shapes-grid,
  .objects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }

  .shape-card,
  .object-card {
    border: 1px solid #eee;
    border-radius: 6px;
    padding: 10px;
    background: #fafafa;
  }

  .shape-header,
  .object-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .shape-name,
  .object-name {
    font-weight: 600;
    font-size: 14px;
    text-transform: capitalize;
  }

  .shape-confidence,
  .object-confidence {
    font-size: 12px;
    font-weight: 500;
  }

  .shape-source,
  .object-source {
    font-size: 11px;
    color: #888;
    margin-top: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .properties-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
    font-size: 11px;
  }

  .property-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .debug-json {
    font-family: monospace;
    font-size: 11px;
    line-height: 1.4;
    background: #f5f5f5;
    padding: 10px;
    border-radius: 4px;
    overflow-x: auto;
    white-space: pre-wrap;
    color: #444;
  }
</style>