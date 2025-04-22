<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { aiChatStore } from '$lib/stores/aiChatStore';
  import { activeDrawingId } from '$lib/stores/drawingStore';
  import { currentDrawingContent } from '$lib/stores/drawingContentStore';
  import { analyzeDrawing, modifyDrawing } from '$lib/openai/api';
  import type { ChatMessage } from '$lib/openai/api';
  import type { DrawingContent } from '$lib/types';

  // State for Vision API toggle
  let useVisionAPI = false;

  // Remove the local drawingContent variable and subscribe to the store instead
  // The drawingContent will now come from the store
  $: drawingContent = $currentDrawingContent;

  // For the input field
  let userInput = '';
  let inputElement: HTMLTextAreaElement;

  // Auto-scroll to the latest message
  let chatContainer: HTMLElement;
  let autoScroll = true;

  // Variable to store the drawing component reference
  let drawingComponent: any = null;

  // Function to get the drawing component instance
  function getDrawingComponent(): any {
    // If we already have a reference, return it
    if (drawingComponent) return drawingComponent;

    // Find the Drawing component by looking for the canvas
    const canvasElement = document.querySelector('.drawing-area canvas');
    if (canvasElement) {
      // Use type assertion for the Svelte component property
      const componentHolder = canvasElement as any;
      if (componentHolder.__svelte_component__) {
        drawingComponent = componentHolder.__svelte_component__;
        return drawingComponent;
      }
    }

    // Try a different approach - the component might be exposed differently
    const drawingElement = document.querySelector('.drawing-area > :first-child');
    if (drawingElement) {
      // Use type assertion for the Svelte component property
      const componentHolder = drawingElement as any;
      if (componentHolder.__svelte_component__) {
        drawingComponent = componentHolder.__svelte_component__;
        return drawingComponent;
      }
    }

    return null;
  }

  // Function to capture the canvas as an image
  function captureDrawingAsImage(): string | null {
    const component = getDrawingComponent();
    if (component && typeof component.captureCanvasImage === 'function') {
      return component.captureCanvasImage();
    }
    return null;
  }

  // Function to resize image data to reduce tokens
  function resizeImageForAPI(imageDataUrl: string, maxWidth = 800, maxHeight = 800): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!imageDataUrl || !imageDataUrl.startsWith('data:image/')) {
        return reject('Invalid image data');
      }

      // Create an image to load the data URL
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions while maintaining aspect ratio
        let newWidth = img.width;
        let newHeight = img.height;

        if (img.width > maxWidth) {
          newWidth = maxWidth;
          newHeight = (img.height * maxWidth) / img.width;
        }

        if (newHeight > maxHeight) {
          newHeight = maxHeight;
          newWidth = (img.width * maxHeight) / img.height;
        }

        // Create a canvas to draw the resized image
        const canvas = document.createElement('canvas');
        canvas.width = newWidth;
        canvas.height = newHeight;

        // Draw the image on the canvas
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, newWidth, newHeight);

        // Get the new data URL with reduced quality
        try {
          const resizedImageData = canvas.toDataURL('image/jpeg', 0.7); // Use JPEG with 70% quality
          resolve(resizedImageData);
        } catch (err) {
          reject(`Error creating resized image: ${err}`);
        }
      };

      img.onerror = () => reject('Error loading image');
      img.src = imageDataUrl;
    });
  }

  // Subscribe to the active drawing ID
  const unsubActiveDrawing = activeDrawingId.subscribe(id => {
    // When the active drawing changes, update the store
    aiChatStore.setCurrentDrawingId(id);

    // Reset chat when changing drawings
    if (id !== $aiChatStore.currentDrawingId) {
      aiChatStore.clearChat();
    }
  });

  // Clean up subscriptions on component destroy
  onDestroy(() => {
    unsubActiveDrawing();
  });

  // Scroll chat to bottom when messages change
  $: if (chatContainer && autoScroll && $aiChatStore.messages.length > 0) {
    setTimeout(() => {
      //chatContainer.scrollTop = chatContainer.scrollHeight;
    }, 100);
  }

  /**
   * Handle sending a user message
   */
  async function handleSendMessage() {
    if (!userInput.trim() || $aiChatStore.isLoading) return;

    // Check if we have an active drawing
    if (!$aiChatStore.currentDrawingId) {
      aiChatStore.setError('No drawing is currently active. Please open a drawing first.');
      return;
    }

    // Check if drawing content is loaded
    if (!drawingContent) {
      // First try setting a helpful error message
      aiChatStore.setError('Drawing content is not yet available. Please try making some strokes first or wait a moment for the drawing to load.');

      // Try to fetch the content one more time from the store
      const currentContent = $currentDrawingContent;
      if (!currentContent) {
        return; // Still no content, so exit
      }
    }

    // Add user message to the chat
    const userMessage: ChatMessage = {
      role: 'user',
      content: userInput
    };

    aiChatStore.addMessage(userMessage);
    userInput = ''; // Clear input field

    // Set loading state
    aiChatStore.setLoading(true);
    aiChatStore.setError(null);

    try {
      // Use the most up-to-date drawing content from the store
      const currentContent = drawingContent || $currentDrawingContent;

      // If still no content, show an error
      if (!currentContent) {
        throw new Error('Could not access drawing content. Try creating some strokes first.');
      }

      // Capture the current drawing as an image
      let imageData = captureDrawingAsImage();

      // Resize the image to reduce token usage if available
      if (imageData) {
        try {
          imageData = await resizeImageForAPI(imageData, 600, 600);
          console.log('Successfully resized image for API');
        } catch (resizeError) {
          console.warn('Failed to resize image:', resizeError);
          // Continue with original image or fall back to SVG if resize fails
        }
      } else {
        console.warn('Could not capture drawing as image, falling back to content data');
      }

      // Limit chat history to reduce token usage (include only last few messages)
      const recentMessages = $aiChatStore.messages
        .filter(msg => msg.role === 'user' || msg.role === 'assistant')
        .slice(-6); // Only include last 6 messages (3 exchanges)

      // Send to server for analysis or modification
      const isModificationRequest = isModifyingRequest(userMessage.content);

      if (isModificationRequest) {
        // Use the modify endpoint
        const response = await fetch('/api/ai/modify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            drawingContent: currentContent,
            instruction: userMessage.content,
            imageData: imageData,
            // Only send the most recent messages for context
            chatHistory: recentMessages,
            // Include Vision API flag
            useVision: useVisionAPI
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Failed to modify drawing');
        }

        const result = await response.json();

        if (result.success && result.modifiedStrokes) {
          // Apply the changes to the drawing
          applyModifications(result.modifiedStrokes);

          // Add AI response
          aiChatStore.addMessage({
            role: 'assistant',
            content: result.message
          });
        } else {
          // Add AI response with message
          aiChatStore.addMessage({
            role: 'assistant',
            content: result.message
          });
        }
      } else {
        // Use the analyze endpoint
        const response = await fetch('/api/ai/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            drawingContent: currentContent,
            userPrompt: userMessage.content,
            // Only send the most recent messages for context
            chatHistory: recentMessages,
            imageData: imageData,
            // Include Vision API flag
            useVision: useVisionAPI
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to analyze drawing');
        }

        const result = await response.json();

        // Add AI response
        aiChatStore.addMessage({
          role: 'assistant',
          content: result.message
        });

        // If vision analysis was included, add a special note about it
        if (useVisionAPI && result.visionAnalysis) {
          // Create a more detailed vision analysis message
          let visionMessage = `<span class="vision-analysis-header">Vision Analysis Results:</span>`;

          // Add identified labels
          if (result.visionAnalysis.labels && result.visionAnalysis.labels.length > 0) {
            visionMessage += `<br>• Detected elements: ${result.visionAnalysis.labels.slice(0, 8).join(', ')}`;
          }

          // Add identified objects if available
          if (result.visionAnalysis.objects && result.visionAnalysis.objects.length > 0) {
            visionMessage += `<br>• Identified objects: ${result.visionAnalysis.objects.map((obj: { name: string }) => obj.name).join(', ')}`;
          }

          // Add detected text if available
          if (result.visionAnalysis.text) {
            visionMessage += `<br>• Text detected: "${result.visionAnalysis.text}"`;
          }

          // Add faces if detected
          if (result.visionAnalysis.faces && result.visionAnalysis.faces.length > 0) {
            visionMessage += `<br>• ${result.visionAnalysis.faces.length} face(s) detected`;
          }

          aiChatStore.addMessage({
            role: 'system',
            content: visionMessage
          });
        }
      }
    } catch (error) {
      console.error('Error processing AI request:', error);
      aiChatStore.setError(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      aiChatStore.setLoading(false);
    }
  }

  /**
   * Determines if a message is requesting modifications or just analysis
   */
  function isModifyingRequest(message: string): boolean {
    const modificationKeywords = [
      'change', 'modify', 'update', 'edit', 'transform',
      'turn', 'make', 'convert', 'replace', 'color'
    ];

    const lowerMessage = message.toLowerCase();
    return modificationKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  /**
   * Apply modifications to the drawing
   */
  function applyModifications(modifiedStrokes: any[]) {
    // Get the latest drawing content from the store
    const latestDrawingContent = $currentDrawingContent;

    if (!latestDrawingContent) {
      console.error('Cannot apply modifications: No drawing content available');
      return;
    }

    // Update the drawing content with modified strokes
    latestDrawingContent.strokes = modifiedStrokes;

    // Update the store
    currentDrawingContent.set(latestDrawingContent);

    // Dispatch an event to notify the Drawing component to redraw
    const event = new CustomEvent('ai:drawing-modified', {
      detail: { strokes: modifiedStrokes },
      bubbles: true
    });

    document.dispatchEvent(event);
  }

  /**
   * Resize the textarea as content grows
   */
  function autoResizeTextarea() {
    if (!inputElement) return;

    // Reset height to auto to get the correct scrollHeight
    inputElement.style.height = 'auto';

    // Set height to scrollHeight to expand the textarea
    inputElement.style.height = `${inputElement.scrollHeight}px`;
  }

  /**
   * Handle keyboard events in the textarea
   */
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  }

  /**
   * Format message content with potential analysis and modification tags
   */
  function formatMessage(content: string): string {
    // Replace <analyze> tags with styled spans
    let formatted = content.replace(
      /<analyze>([\s\S]*?)<\/analyze>/g,
      '<span class="analysis">$1</span>'
    );

    // Replace <modify> tags with styled spans
    formatted = formatted.replace(
      /<modify>([\s\S]*?)<\/modify>/g,
      '<span class="modification">$1</span>'
    );

    return formatted;
  }
</script>

<div class="panel">
  <div class="panel-header">
    <h2>AI Assistant</h2>
    {#if $aiChatStore.currentDrawingId}
      <span class="status connected">Connected to drawing</span>
    {:else}
      <span class="status disconnected">Not connected</span>
    {/if}
  </div>

  <div class="chat-container" bind:this={chatContainer}>
    {#if $aiChatStore.messages.length === 0}
      <div class="empty-state" transition:fade>
        <div class="empty-icon">🎨</div>
        <p>Ask me questions about your drawing or request modifications.</p>
        <div class="example-prompts">
          <p>Examples:</p>
          <button on:click={() => userInput = "Describe what you see in this drawing"}>
            Describe this drawing
          </button>
          <button on:click={() => userInput = "How many strokes are in this drawing?"}>
            Count strokes
          </button>
          <button on:click={() => userInput = "Turn all black strokes red"}>
            Change colors
          </button>
        </div>
      </div>
    {:else}
      {#each $aiChatStore.messages as message, i (i)}
        <div class="message {message.role}" transition:slide>
          <div class="message-avatar">
            {message.role === 'user' ? '👤' : '🤖'}
          </div>
          <div class="message-content">
            {@html formatMessage(message.content)}
          </div>
        </div>
      {/each}

      {#if $aiChatStore.isLoading}
        <div class="message assistant loading" transition:slide>
          <div class="message-avatar">🤖</div>
          <div class="message-content">
            <span class="loading-dots">
              <span>.</span><span>.</span><span>.</span>
            </span>
          </div>
        </div>
      {/if}
    {/if}

    {#if $aiChatStore.error}
      <div class="error-message" transition:slide>
        {$aiChatStore.error}
      </div>
    {/if}
  </div>

  <div class="chat-input-container">
    {#if $aiChatStore.error}
      <div class="error-message">
        {$aiChatStore.error}
      </div>
    {/if}

    <div class="input-row">
      <textarea
        bind:this={inputElement}
        bind:value={userInput}
        on:input={autoResizeTextarea}
        on:keydown={handleKeydown}
        placeholder="Ask about your drawing..."
        disabled={$aiChatStore.isLoading || !$aiChatStore.currentDrawingId}
        rows="1"
      ></textarea>

      <div class="input-actions">
        <label class="vision-toggle">
          <input
            type="checkbox"
            bind:checked={useVisionAPI}
            disabled={$aiChatStore.isLoading || !$aiChatStore.currentDrawingId}
          />
          <span class="toggle-slider"></span>
          <span class="toggle-label">Enhanced Vision Analysis</span>
          <span class="tooltip">
            <span class="tooltip-icon">?</span>
            <span class="tooltip-text">Enables Google Cloud Vision API to help identify what's in your drawing before sending to AI</span>
          </span>
        </label>

        <button
          class="send-button"
          on:click={handleSendMessage}
          disabled={$aiChatStore.isLoading || !userInput.trim() || !$aiChatStore.currentDrawingId}
        >
          {#if $aiChatStore.isLoading}
            <span class="loader"></span>
          {:else}
            <span>Send</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style lang="scss">
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 300px;
    background-color: #fafafa;
    border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    overflow: hidden;
  }

  .panel-header {
    padding: 16px;
    background-color: #ffffff;
    border-bottom: 1px solid #eaeaea;
    display: flex;
    justify-content: space-between;
    align-items: center;

    h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: #333;
    }

    .status {
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 12px;

      &.connected {
        background-color: #e7f6e7;
        color: #2e7d32;
      }

      &.disconnected {
        background-color: #ffebee;
        color: #c62828;
      }
    }
  }

  .chat-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .message {
    display: flex;
    gap: 12px;
    max-width: 80%;

    &.user {
      align-self: flex-end;
      flex-direction: row-reverse;

      .message-content {
        background-color: #e7f0ff;
        border-radius: 16px 4px 16px 16px;
      }

      .message-avatar {
        background-color: #d1e3ff;
      }
    }

    &.assistant {
      align-self: flex-start;

      .message-content {
        background-color: #ffffff;
        border-radius: 4px 16px 16px 16px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .message-avatar {
        background-color: #f0f0f0;
      }
    }

    &.system {
      align-self: center;
      width: 100%;

      .message-content {
        width: 100%;
        background-color: #f8f9fa;
        border-radius: 8px;
        color: #666;
        font-size: 12px;
        text-align: center;
        padding: 8px 12px;
      }

      .message-avatar {
        display: none;
      }
    }
  }

  .message-avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    font-size: 16px;
  }

  .message-content {
    padding: 12px 16px;
    font-size: 14px;
    line-height: 1.5;

    .analysis {
      display: block;
      margin-top: 8px;
      padding: 8px;
      background-color: #f5f5f5;
      border-left: 3px solid #4285F4;
      border-radius: 4px;
    }

    .modification {
      display: block;
      margin-top: 8px;
      padding: 8px;
      background-color: #fff8e1;
      border-left: 3px solid #ffab00;
      border-radius: 4px;
    }
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #757575;
    text-align: center;
    padding: 20px;

    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }

    p {
      margin-bottom: 24px;
    }

    .example-prompts {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 300px;

      p {
        margin-bottom: 8px;
        font-weight: 600;
      }

      button {
        background-color: #f5f5f5;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        padding: 8px 12px;
        cursor: pointer;
        transition: background-color 0.2s;

        &:hover {
          background-color: #e9e9e9;
        }
      }
    }
  }

  .chat-input-container {
    padding: 12px 16px;
    background-color: #ffffff;
    border-top: 1px solid #eaeaea;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .input-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
  }

  .input-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  textarea {
    flex: 1;
    border: 1px solid #e0e0e0;
    border-radius: 12px;
    padding: 12px;
    resize: none;
    max-height: 120px;
    outline: none;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.5;

    &:focus {
      border-color: #4a6cf7;
      box-shadow: 0 0 0 2px rgba(74, 108, 247, 0.1);
    }

    &:disabled {
      background-color: #f9f9f9;
      cursor: not-allowed;
    }
  }

  .send-button {
    background-color: #4a6cf7;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s;

    &:hover:not(:disabled) {
      background-color: #3a5bd9;
    }

    &:disabled {
      background-color: #b0b0b0;
      cursor: not-allowed;
    }
  }

  .error-message {
    background-color: #ffebee;
    color: #c62828;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 14px;
    margin-bottom: 8px;
  }

  .loader {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-radius: 50%;
    border-top-color: white;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .vision-toggle {
    display: flex;
    align-items: center;
    cursor: pointer;
    margin-right: 10px;
    user-select: none;
  }

  .toggle-slider {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
    background-color: #ccc;
    border-radius: 20px;
    transition: all 0.3s;
    margin-right: 6px;
  }

  .toggle-slider:before {
    position: absolute;
    content: "";
    height: 16px;
    width: 16px;
    left: 2px;
    bottom: 2px;
    background-color: white;
    border-radius: 50%;
    transition: all 0.3s;
  }

  input:checked + .toggle-slider {
    background-color: #4285F4;
  }

  input:checked + .toggle-slider:before {
    transform: translateX(16px);
  }

  input:disabled + .toggle-slider {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-label {
    font-size: 12px;
    color: #666;
  }

  @media (min-width: 768px) {
    .input-row {
      flex-direction: row;
      align-items: flex-end;
    }

    textarea {
      flex: 1;
    }

    .input-actions {
      flex-direction: row;
    }
  }

  .tooltip {
    position: relative;
    display: inline-block;
    margin-left: 4px;
  }

  .tooltip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    background-color: #ccc;
    color: white;
    border-radius: 50%;
    font-size: 10px;
    cursor: help;
  }

  .tooltip-text {
    visibility: hidden;
    width: 200px;
    background-color: #555;
    color: #fff;
    text-align: center;
    border-radius: 6px;
    padding: 5px;
    position: absolute;
    z-index: 1;
    bottom: 125%;
    left: 50%;
    margin-left: -100px;
    opacity: 0;
    transition: opacity 0.3s;
    font-size: 11px;
    line-height: 1.3;
  }

  .tooltip:hover .tooltip-text {
    visibility: visible;
    opacity: 1;
  }

  .vision-analysis-header {
    font-weight: bold;
    color: #4285F4;
  }
</style>