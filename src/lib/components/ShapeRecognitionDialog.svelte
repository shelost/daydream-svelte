<script>
  import { fade, fly } from 'svelte/transition';
  import { createEventDispatcher, onMount } from 'svelte';
  import {
    gptImagePrompt,
    gptEditPrompt,
    generatedImageUrl,
    generatedByModel,
    isGenerating,
    editedImageUrl,
    editedByModel,
    isEditing,
    analysisOptions
  } from '$lib/stores/drawStore';

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

  // State for object image cropping
  let objectImages = {};
  let canvasImg = null;

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
  let activeTab = 'image'; // Initial tab: 'image', 'strokes', 'sketch', 'text', 'objects', 'generated'
  let generatedMode = 'both'; // Options: 'standard', 'edited', 'both'

  const dispatch = createEventDispatcher();

  // When canvas snapshot changes, generate cropped images for objects
  $: if (canvasSnapshot && detectedObjects.length > 0) {
    generateObjectImages();
  }

  // When component mounts, ensure we're ready to process images
  onMount(() => {
    if (canvasSnapshot && detectedObjects.length > 0) {
      generateObjectImages();
    }
  });

  // Function to generate cropped images for each object
  async function generateObjectImages() {
    if (!canvasSnapshot || !canvasSnapshot.startsWith('data:')) return;

    // Create an image from the snapshot
    if (!canvasImg) {
      canvasImg = new Image();
      canvasImg.src = canvasSnapshot;

      // Wait for image to load if it's not already
      if (!canvasImg.complete) {
        await new Promise(resolve => {
          canvasImg.onload = resolve;
        });
      }
    }

    // Create a temporary canvas for cropping
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d');

    // Process each object with a bounding box
    for (const obj of detectedObjects) {
      if (!obj.boundingBox) continue;

      try {
        // Extract bounding box coordinates - handle different possible formats
        const bb = obj.boundingBox;

        // Handle normalized bounding box format (values between 0-1)
        let x, y, width, height;

        // Handle different bounding box formats that might come from different sources
        if (bb.minX !== undefined && bb.width !== undefined) {
          // Format with minX, minY, width, height
          x = bb.minX;
          y = bb.minY;
          width = bb.width;
          height = bb.height;
        } else if (bb.x !== undefined && bb.width !== undefined) {
          // Format with x, y, width, height
          x = bb.x;
          y = bb.y;
          width = bb.width;
          height = bb.height;
        } else if (bb.x1 !== undefined && bb.x2 !== undefined) {
          // Format with x1, y1, x2, y2
          x = bb.x1;
          y = bb.y1;
          width = bb.x2 - bb.x1;
          height = bb.y2 - bb.y1;
        } else {
          // Unknown format, skip this object
          continue;
        }

        // Add padding to make the objects more visible (15% on each side)
        const padding = 0.15;
        const paddedX = Math.max(0, x - (width * padding));
        const paddedY = Math.max(0, y - (height * padding));
        const paddedWidth = Math.min(1 - paddedX, width * (1 + padding * 2));
        const paddedHeight = Math.min(1 - paddedY, height * (1 + padding * 2));

        // Ensure values are within normalized range
        x = paddedX;
        y = paddedY;
        width = paddedWidth;
        height = paddedHeight;

        // Skip if invalid dimensions
        if (width <= 0 || height <= 0) continue;

        // Apply to image dimensions
        const imgWidth = canvasImg.width;
        const imgHeight = canvasImg.height;

        // Calculate pixel values with proper rounding to avoid subpixel issues
        const scaledX = Math.floor(x * imgWidth);
        const scaledY = Math.floor(y * imgHeight);
        const scaledWidth = Math.ceil(width * imgWidth);
        const scaledHeight = Math.ceil(height * imgHeight);

        // Ensure we don't exceed image boundaries
        const cropWidth = Math.min(scaledWidth, imgWidth - scaledX);
        const cropHeight = Math.min(scaledHeight, imgHeight - scaledY);

        // Skip if resulting dimensions are too small
        if (cropWidth < 5 || cropHeight < 5) continue;

        // Resize temp canvas to the object dimensions
        tempCanvas.width = cropWidth;
        tempCanvas.height = cropHeight;

        // Clear canvas and draw the cropped portion
        ctx.clearRect(0, 0, cropWidth, cropHeight);
        ctx.drawImage(
          canvasImg,
          scaledX, scaledY, cropWidth, cropHeight,
          0, 0, cropWidth, cropHeight
        );

        // Convert to data URL and store - use object ID if available for unique key
        const objId = obj.id || `${obj.name}-${obj.confidence || 0}`;
        const objDataUrl = tempCanvas.toDataURL('image/png');
        objectImages[objId] = objDataUrl;
      } catch (err) {
        console.error('Error generating cropped image:', err);
      }
    }
  }

  // Function to get the cropped image for an object
  function getObjectImage(obj) {
    // Try to find the image using ID first, then name+confidence as fallback
    const idKey = obj.id;
    const nameConfidenceKey = obj.name + '-' + (obj.confidence || 0);

    return idKey && objectImages[idKey]
           ? objectImages[idKey]
           : objectImages[nameConfidenceKey] || null;
  }

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

  // Function to toggle an analysis option
  function toggleAnalysisOption(option) {
    analysisOptions.update(options => {
      options[option] = !options[option];
      return options;
    });

    // Notify parent component to re-run analysis
    dispatch('optionsChanged', { options: $analysisOptions });
  }

  // Set generated image display mode
  function setGeneratedMode(mode) {
    generatedMode = mode;
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
        text
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

<svelte:head>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" integrity="sha512-iecdLmaskl7CVkqkXNQ/ZH/XLlvWZOJyj7Yy7tcenmpD1ypASozpmT/E0iPtmFIB46ZmdtAc9eNBvH0H/ZpiBw==" crossorigin="anonymous" referrerpolicy="no-referrer" />
</svelte:head>

{#if show}
  <div
    class="dialog-container"
    style="right: {position.right}; top: {position.top};"
    transition:fly={{ y: 20, duration: 200 }}
  >
    <div class="dialog-header">
      <h3>Shape Recognition</h3>
      <div class="header-actions">
        <button class="refresh-button" on:click={() => dispatch('refreshAnalysis')} title="Refresh analysis">
          <span class="material-icons">refresh</span>
        </button>
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
        class="tab-button {activeTab === 'strokes' ? 'active' : ''}"
        on:click={() => setActiveTab('strokes')}
        class:has-data={hasStrokesAnalysis}
        class:disabled={!$analysisOptions.useStrokeAnalysis && !$analysisOptions.useCNN}
      >
        Strokes
      </button>
      <button
        class="tab-button {activeTab === 'sketch' ? 'active' : ''}"
        on:click={() => setActiveTab('sketch')}
        class:has-data={hasSketchAnalysisOutput}
        class:disabled={!$analysisOptions.useGPTVision}
      >
        Sketch
      </button>
      <button
        class="tab-button {activeTab === 'text' ? 'active' : ''}"
        on:click={() => setActiveTab('text')}
        class:has-data={hasAnyTextAnalysis}
      >
        Text
      </button>
      <button
        class="tab-button {activeTab === 'objects' ? 'active' : ''}"
        on:click={() => setActiveTab('objects')}
        class:has-data={detectedObjects.length > 0}
      >
        Objects
      </button>
      <button
        class="tab-button {activeTab === 'generated' ? 'active' : ''}"
        on:click={() => setActiveTab('generated')}
        class:has-data={$generatedImageUrl || $editedImageUrl || $isGenerating || $isEditing}
      >
        Generated
      </button>
    </div>

    <div class="dialog-content">
      {#if activeTab === 'image'}
        <!-- Image Tab Content -->
        <div class="image-tab-content">
          <div class="tech-badge-container">
            <div class="tech-badge">
              <span class="tech-icon">🖼️</span>
              <span class="tech-label">Canvas Snapshot</span>
            </div>
            <div class="status-indicator {hasCanvasSnapshot ? 'complete' : 'waiting'}">
              {hasCanvasSnapshot ? 'Complete' : 'Waiting for drawing'}
            </div>
          </div>

          <div class="tab-description">
            <p>This is the first step in the analysis process. Your drawing is captured as an image and sent to various AI services for analysis.</p>
          </div>

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

      {:else if activeTab === 'strokes'}
        <!-- Strokes Analysis Tab Content -->
        <div class="tech-badge-container">
          <div class="tech-option">
            <div class="tech-badge">
              <span class="tech-icon"><i class="fab fa-js"></i></span>
              <span class="tech-label">TensorFlow.js</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox"
                checked={$analysisOptions.useTensorFlow}
                on:change={() => toggleAnalysisOption('useTensorFlow')} />
              <span class="switch-slider"></span>
            </label>
          </div>

          <div class="tech-option">
            <div class="tech-badge">
              <span class="tech-icon">🧠</span>
              <span class="tech-label">CNN</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox"
                checked={$analysisOptions.useCNN}
                on:change={() => toggleAnalysisOption('useCNN')} />
              <span class="switch-slider"></span>
            </label>
          </div>

          <div class="tech-option">
            <div class="tech-badge">
              <span class="tech-icon">📏</span>
              <span class="tech-label">Shape Recognition</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox"
                checked={$analysisOptions.useShapeRecognition}
                on:change={() => toggleAnalysisOption('useShapeRecognition')} />
              <span class="switch-slider"></span>
            </label>
          </div>

          <div class="status-indicator {isAnalyzing ? 'running' : (hasStrokesAnalysis ? 'complete' : 'waiting')}">
            {isAnalyzing ? 'Running' : (hasStrokesAnalysis ? 'Complete' : 'Waiting for drawing')}
          </div>
        </div>

        <div class="tab-description">
          <p>This is the second step. Your drawing strokes are analyzed using machine learning models and geometric algorithms to detect shapes and objects. Toggle options to control which technologies are used in analysis.</p>
        </div>

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

                      <!-- Show cropped object image if available -->
                      {#if getObjectImage(shape)}
                        <div class="object-image-container">
                          <img src={getObjectImage(shape)} alt="{shape.name}" class="object-image" />
                        </div>
                      {/if}

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
        <div class="tech-badge-container">
          <div class="tech-option">
            <div class="tech-badge">
              <span class="tech-icon"><i class="fas fa-brain"></i></span>
              <span class="tech-label">GPT-4 Vision</span>
            </div>
            <label class="toggle-switch">
              <input type="checkbox"
                checked={$analysisOptions.useGPTVision}
                on:change={() => toggleAnalysisOption('useGPTVision')} />
              <span class="switch-slider"></span>
            </label>
          </div>

          <div class="status-indicator {isAnalyzing ? 'running' : (hasSketchAnalysisOutput ? 'complete' : 'waiting')}">
            {isAnalyzing ? 'Running' : (hasSketchAnalysisOutput ? 'Complete' : 'Waiting for drawing')}
          </div>
        </div>

        <div class="tab-description">
          <p>This is the third step. Your drawing image is analyzed by GPT-4 Vision to identify objects, context, and composition with more nuanced understanding. Toggle the option to enable/disable this technology.</p>
        </div>

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

                      <!-- Show cropped object image if available -->
                      {#if getObjectImage(object)}
                        <div class="object-image-container">
                          <img src={getObjectImage(object)} alt="{object.name}" class="object-image" />
                        </div>
                      {/if}

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

      {:else if activeTab === 'text'}
        <!-- Text Analysis Tab Content -->
        <div class="tech-badge-container">
          <div class="tech-badge">
            <span class="tech-icon">📝</span>
            <span class="tech-label">GPT-4 Vision Text Analysis</span>
          </div>
          <div class="tech-badge">
            <span class="tech-icon">🔤</span>
            <span class="tech-label">Multi-Model Analysis</span>
          </div>
          <div class="status-indicator {isAnalyzingText ? 'running' : (hasAnyTextAnalysis ? 'complete' : 'waiting')}">
            {isAnalyzingText ? 'Running' : (hasAnyTextAnalysis ? 'Complete' : 'Waiting for drawing')}
          </div>
        </div>

        <div class="tab-description">
          <p>This is the fourth step. Text summaries from both the stroke analysis and vision models are combined to provide comprehensive insights into your drawing.</p>
        </div>

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

      {:else if activeTab === 'objects'}
        <!-- Objects Tab Content -->
        <div class="tech-badge-container">
          <div class="tech-badge">
            <span class="tech-icon">🧩</span>
            <span class="tech-label">Multi-Model Fusion</span>
          </div>
          <div class="tech-badge">
            <span class="tech-icon">🔍</span>
            <span class="tech-label">Object Detection</span>
          </div>
          <div class="status-indicator {isAnalyzing ? 'running' : (detectedObjects.length > 0 ? 'complete' : 'waiting')}">
            {isAnalyzing ? 'Running' : (detectedObjects.length > 0 ? 'Complete' : 'Waiting for drawing')}
          </div>
        </div>

        <div class="tab-description">
          <p>This is the final step. Objects detected from all analysis methods are combined into a unified view with confidence scores and precise positioning.</p>
        </div>

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

                <!-- Object image from cropping (prioritize this) -->
                {#if getObjectImage(obj)}
                  <div class="object-cropped-image">
                    <img src={getObjectImage(obj)} alt="{obj.name}" />
                  </div>
                <!-- Fallback to existing snapshot logic if available -->
                {:else if getObjectSnapshot(obj) || (obj.snapshot && debugMode)}
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

      {:else if activeTab === 'generated'}
        <!-- Generated Tab Content -->
        <div class="generated-tab-content">
          <div class="tech-badge-container">
            <div class="tech-badge">
              <span class="tech-icon">🚀</span>
              <span class="tech-label">GPT-Image-1</span>
            </div>
            <div class="mode-selector">
              <button
                class="mode-button {generatedMode === 'standard' ? 'active' : ''}"
                on:click={() => setGeneratedMode('standard')}
              >
                Standard
              </button>
              <button
                class="mode-button {generatedMode === 'edited' ? 'active' : ''}"
                on:click={() => setGeneratedMode('edited')}
              >
                Edited
              </button>
              <button
                class="mode-button {generatedMode === 'both' ? 'active' : ''}"
                on:click={() => setGeneratedMode('both')}
              >
                Both
              </button>
            </div>
            <div class="status-indicator {$isGenerating || $isEditing ? 'running' : ($generatedImageUrl || $editedImageUrl ? 'complete' : 'waiting')}">
              {$isGenerating || $isEditing ? 'Generating...' : ($generatedImageUrl || $editedImageUrl ? 'Complete' : 'Ready')}
            </div>
          </div>

          <div class="tab-description">
            <p>This tab shows the final prompts and images generated by the AI image generator. Standard generation creates a new image from scratch, while edit modifies the existing drawing.</p>
          </div>

          <div class="prompt-display">
            <h4>Generation Prompt:</h4>
            <pre>{$gptImagePrompt || 'Prompt will appear here...'}</pre>
          </div>

          {#if generatedMode === 'standard' || generatedMode === 'both'}
          <div class="generated-image-display">
            <h4>Generated Image (Standard):</h4>
            {#if $isGenerating}
              <div class="image-loading-container">
                <div class="analyzing-indicator">
                  <div class="spinner"></div>
                  <span>Generating image...</span>
                </div>
                <div class="image-loading-animation">
                  <div class="scanning-beam"></div>
                </div>
              </div>
            {:else if $generatedImageUrl}
              <div class="image-result">
                <img src={$generatedImageUrl} alt="AI Generated Result" />
                {#if $generatedByModel}
                  <div class="model-badge">{$generatedByModel}</div>
                {/if}
              </div>
            {:else}
              <div class="empty-state">
                <p>Click "Generate Structure-Perfect Image" to create an image.</p>
              </div>
            {/if}
          </div>
          {/if}

          <div class="prompt-display">
            <h4>Edit Prompt:</h4>
            <pre>{$gptEditPrompt || 'Edit prompt will appear here...'}</pre>
          </div>

          {#if generatedMode === 'edited' || generatedMode === 'both'}
          <div class="generated-image-display">
            <h4>Generated Image (Edited):</h4>
            {#if $isEditing}
              <div class="image-loading-container">
                <div class="analyzing-indicator">
                  <div class="spinner"></div>
                  <span>Editing image...</span>
                </div>
                <div class="image-loading-animation">
                  <div class="scanning-beam"></div>
                </div>
              </div>
            {:else if $editedImageUrl}
              <div class="image-result">
                <img src={$editedImageUrl} alt="AI Edited Result" />
                {#if $editedByModel}
                  <div class="model-badge">{$editedByModel}</div>
                {/if}
              </div>
            {:else}
              <div class="empty-state">
                <p>Click "Generate Structure-Perfect Image" to create an edited image.</p>
              </div>
            {/if}
          </div>
          {/if}

          {#if generatedMode === 'both' && $generatedImageUrl && $editedImageUrl}
          <div class="comparison-section">
            <h4>Comparison:</h4>
            <div class="comparison-grid">
              <div class="comparison-item">
                <div class="comparison-label">Original Drawing</div>
                <div class="comparison-image">
                  <img src={canvasSnapshot} alt="Original Drawing" />
                </div>
              </div>
              <div class="comparison-item">
                <div class="comparison-label">Standard Generation</div>
                <div class="comparison-image">
                  <img src={$generatedImageUrl} alt="Standard Generation" />
                </div>
              </div>
              <div class="comparison-item">
                <div class="comparison-label">Edit Generation</div>
                <div class="comparison-image">
                  <img src={$editedImageUrl} alt="Edit Generation" />
                </div>
              </div>
            </div>
          </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style lang="scss">
  .dialog-container {
    position: fixed;
    width: 500px;
    max-height: 600px;
    background: rgba(rgb(19, 18, 24), .75);
    border-radius: 20px;
    box-shadow: 10px 30px 80px rgba(black, 0.5), inset 1px 1px 2px rgba(white, 0.25);
    background-image: linear-gradient(-60deg, rgba(white, 0) 25%, rgba(white, 0.05) 50%, rgba(white, 0) 75%);
    // /border: 1px solid rgba(white, 0.25);
    overflow: hidden;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    backdrop-filter: blur(20px);
    color: white;
    transition: .2s ease;
    box-sizing: border-box;
    padding: 8px;
  }

  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;

    h3 {
      margin: 0;
      font-size: 16px;
      color: white;
    }
  }

  .header-actions {
    display: flex;
    gap: 8px;
  }

  .close-button, .debug-button, .refresh-button {
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

    &:hover {
      background: #eaeaea;
      color: #333;
    }
  }

  .tab-navigation {
    display: flex;
    overflow-x: auto;
    padding: 12px 12px;
  }

  .tab-button {
    padding: 6px 10px;
    background: none;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    color: rgba(white, .5);
    cursor: pointer;
    transition: all 0.2s ease;
    position: relative;
    text-align: center;
    white-space: nowrap;

    &:hover {
      color: white;
    }

    &.active {
      background: #ffce00;
      color: black;
    }

    &.has-data::after {
      content: '';
      position: absolute;
      top: 10px;
      right: 10px;
      width: 6px;
      height: 6px;
      background-color: #4CAF50;
      border-radius: 50%;
    }

    &.disabled {
      opacity: 0.5;
      text-decoration: line-through;
    }
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
    gap: 16px;
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

    h4 {
      margin: 0;
      font-size: 14px;
      color: #333;
    }
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

    h4 {
      margin: 0 0 8px 0;
      font-size: 14px;
      color: #666;
    }
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

    img {
      width: 100%;
      height: auto;
      display: block;
    }
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

    h4 {
      margin: 0 0 8px 0;
      font-size: 14px;
      color: #333;
    }

    p {
      margin: 0;
      font-size: 13px;
      color: #444;
    }
  }

  .shapes-grid,
  .objects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }

  .shape-card,
  .object-card {
    border: none;
    border-radius: 6px;
    padding: 10px;
    background: rgba(white, .1);
    color: white;
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
    color: white;
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

  /* Add new styles for object images */
  .object-cropped-image,
  .object-image-container {
    margin: 10px 0;
    border: 1px solid #ddd;
    border-radius: 6px;
    overflow: hidden;
    background-color: #ffffff;
    display: flex;
    justify-content: center;
    align-items: center;
    max-height: 150px;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);

    img {
      max-width: 100%;
      max-height: 150px;
      object-fit: contain;
      display: block;
      padding: 5px;
    }
  }

  /* New styles for tech badges and status indicators */
  .tech-badge-container {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
    align-items: center;
  }

  .tech-badge {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 500;
    background-color: rgba(white, .1);
    padding: 4px 8px;
    border-radius: 8px;
  }

  .tech-icon {
    font-size: 16px;
  }

  .tech-label {
    white-space: nowrap;
  }

  .status-indicator {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    margin-left: auto;

    &.complete {
      background-color: #4CAF50;
      color: white;
    }

    &.running {
      background-color: #FFC107;
      color: #333;
    }

    &.waiting {
      background-color: #F44336;
      color: white;
    }
  }

  .tab-description {
    margin-bottom: 16px;
    font-size: 12px;
    color: white;
    background-color: rgba(white, .05);
    padding: 10px;
    border-radius: 4px;
    border-left: 3px solid #9C27B0;
  }

  /* Styles for the Generated Tab */
  .generated-tab-content {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .prompt-display,
  .generated-image-display {
    h4 {
      margin: 0 0 8px 0;
      font-size: 14px;
      color: white;
    }
  }

  .prompt-display {
    pre {
      background-color: rgba(white, .1);
      padding: 12px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 11px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 200px;
      overflow-y: auto;
    }
  }

  .generated-image-display {
    .image-result {
      position: relative;
      border: 1px solid #eee;
      border-radius: 6px;
      overflow: hidden;
      background: #f5f5f5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 150px;

      img {
        max-width: 100%;
        max-height: 300px;
        display: block;
      }

      .model-badge {
        position: absolute;
        bottom: 8px;
        right: 8px;
        background: rgba(0, 0, 0, 0.6);
        color: white;
        padding: 3px 6px;
        border-radius: 4px;
        font-size: 10px;
      }
    }
  }

  /* New Toggle Switch Style */
  .tech-option {
    display: flex;
    align-items: center;
    margin-bottom: 8px;
    justify-content: space-between;
  }

  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 40px;
    height: 22px;
    margin-left: 10px;

    input {
      opacity: 0;
      width: 0;
      height: 0;
    }
  }

  .switch-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #ccc;
    transition: .4s;
    border-radius: 34px;

    &:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 2px;
      bottom: 2px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }
  }

  input:checked + .switch-slider {
    background-color: #9C27B0;

    &:before {
      transform: translateX(18px);
    }
  }

  /* New styles for the generated image display modes */
  .mode-selector {
    display: flex;
    gap: 4px;
    margin: 0 auto;
  }

  .mode-button {
    padding: 4px 8px;
    font-size: 12px;
    border: 1px solid #ddd;
    background: #f5f5f5;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;

    &.active {
      background: #9C27B0;
      color: white;
      border-color: #9C27B0;
    }
  }

  .comparison-section {
    margin-top: 20px;
    border-top: 1px solid #eee;
    padding-top: 16px;
  }

  .comparison-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-top: 10px;
  }

  .comparison-item {
    border: 1px solid #eee;
    border-radius: 4px;
    overflow: hidden;
  }

  .comparison-label {
    font-size: 12px;
    font-weight: 500;
    padding: 4px 8px;
    background: #f5f5f5;
    text-align: center;
    border-bottom: 1px solid #eee;
  }

  .comparison-image {
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    background: white;

    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  }

  .ai-scanning-animation {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 200px;
    background-color: rgba(0, 0, 0, 0.1);
    overflow: hidden;
    border-radius: 6px;
  }

  .scanning-beam {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      to bottom,
      rgba(157, 39, 176, 0) 0%,
      rgba(157, 39, 176, 0.3) 50%,
      rgba(157, 39, 176, 0) 100%
    );
    animation: scanning-animation 1.5s ease-in-out infinite;
  }

  @keyframes scanning-animation {
    0% { transform: translateY(-100%); }
    100% { transform: translateY(200%); }
  }

  /* Add these styles at the appropriate place in the style section */
  .image-loading-container {
    min-height: 200px;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: rgba(0, 0, 0, 0.1);
    border-radius: 6px;
    overflow: hidden;
    margin-bottom: 16px;
  }

  .image-loading-animation {
    position: absolute;
    width: 100%;
    height: 100%;
    top: 0;
    left: 0;
    z-index: 0;

    .scanning-beam {
      position: absolute;
      width: 100%;
      height: 50px;
      background: linear-gradient(
        to bottom,
        rgba(157, 39, 176, 0) 0%,
        rgba(157, 39, 176, 0.2) 50%,
        rgba(157, 39, 176, 0) 100%
      );
      animation: scanning-animation 1.5s ease-in-out infinite;
    }
  }

  @keyframes scanning-animation {
    0% { transform: translateY(-100%); }
    50% { transform: translateY(100%); }
    100% { transform: translateY(300%); }
  }
</style>