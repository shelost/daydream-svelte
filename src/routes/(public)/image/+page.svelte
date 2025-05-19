<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { scale, fly, fade } from 'svelte/transition';
  import { cubicOut, elasticOut } from 'svelte/easing';

  interface Message {
    id: string;
    role: 'user' | 'assistant';
    content?: string; // For user messages or text parts of assistant messages
    images?: Array<ImageResult>;
    isLoading?: boolean; // Indicates if this assistant message is waiting for images
  }

  interface ImageResult {
    model: string;
    url?: string;
    error?: string;
    revised_prompt?: string;
    promptUsed?: string;
    isLoading: boolean;
    estimatedDuration?: number;
    progress?: number;
    animationFrameId?: number;
    startTime?: number; // To store when the generation for this specific image started
    aspectRatioUsed?: string; // Added to store aspect ratio at time of request
  }

  let messages: Message[] = [];
  let userInput: string = '';
  let isOverallLoading: boolean = false; // Tracks if any generation is in progress
  let selectedAspectRatio: '1:1' | 'portrait' | 'landscape' = '1:1';
  let chatContainer: HTMLElement;
  let isInitialized = false; // Flag to prevent saving before loading
  let isStartState = true; // Track if we're in the initial centered state
  const SESSION_STORAGE_KEY = 'imageChatMessages';

  const generateUniqueId = () => `_${Math.random().toString(36).substring(2, 11)}`;

  // Predefined models to query
  const modelsToQuery = [
    { name: 'gpt-image-1', displayName: 'GPT Image-1', endpoint: '/api/ai/generate-image', estimatedDuration: 12000 },
    { name: 'sdxl-lightning', displayName: 'SDXL Lightning', endpoint: '/api/ai/generate-replicate', estimatedDuration: 5000 },
    // { name: 'playground-v2', displayName: 'Playground v2', endpoint: '/api/ai/generate-replicate', estimatedDuration: 15000 }, // Commented out as per backend changes
    { name: 'lcm', displayName: 'Latent Consistency', endpoint: '/api/ai/generate-replicate', estimatedDuration: 8000 },
    { name: 'sdxl', displayName: 'SDXL', endpoint: '/api/ai/generate-replicate', estimatedDuration: 20000 }
  ];

  // Helper function to get model icon
  function getModelIcon(modelDisplayName: string): string {
    const lowerModelName = modelDisplayName.toLowerCase();
    if (lowerModelName.includes('gpt') || lowerModelName.includes('openai')) {
      return '/openai.svg';
    } else if (lowerModelName.includes('sdxl lightning')) {
      return '/bytedance.svg';
    } else if (lowerModelName.includes('latent consistency') || lowerModelName.includes('lcm')) {
      return '/replicate.svg';
    } else if (lowerModelName.includes('sdxl')) {
      return '/replicate.svg'; // Assuming SDXL via Replicate uses replicate icon
    }
    // Fallback for other Replicate models (like Playground v2 if re-added) or any other unmapped model
    return '/replicate.svg';
  }

  // Helper function to get CSS aspect-ratio value string
  function getAspectRatioValue(aspectRatioKey: string | undefined): string {
    if (!aspectRatioKey) return '1 / 1'; // Default
    switch (aspectRatioKey) {
      case '1:1':
        return '1 / 1';
      case 'portrait':
        return '512 / 896'; // Approx 4:7
      case 'landscape':
        return '896 / 512'; // Approx 7:4
      default:
        return '1 / 1';
    }
  }

  function cancelProgressAnimation(imageResult: ImageResult | undefined) {
    if (imageResult && imageResult.animationFrameId) {
      cancelAnimationFrame(imageResult.animationFrameId);
      imageResult.animationFrameId = undefined;
    }
  }

  function startProgressAnimation(assistantMsgId: string, modelName: string) {
    const messageIndex = messages.findIndex(msg => msg.id === assistantMsgId);
    if (messageIndex === -1) return;

    const imageIndex = messages[messageIndex].images?.findIndex(img => img.model === modelName);
    if (imageIndex === -1 || !messages[messageIndex].images) return;

    // Ensure we have a reference to the live object in the messages array
    // Important: Don't pass messages[messageIndex].images[imageIndex] directly to requestAnimationFrame
    // as its reference might become stale if the messages array is reconstructed.
    // Instead, always look it up by IDs/names within the animation frame.

    const animate = () => {
      const currentMsg = messages.find(msg => msg.id === assistantMsgId);
      if (!currentMsg || !currentMsg.images) {
        return; // Message or images array disappeared
      }
      const currentImgResult = currentMsg.images.find(img => img.model === modelName);

      if (!currentImgResult || !currentImgResult.isLoading || !currentImgResult.startTime || !currentImgResult.estimatedDuration) {
        cancelProgressAnimation(currentImgResult);
        return; // Stop if no longer loading or essential data missing
      }

      const elapsed = Date.now() - currentImgResult.startTime;
      const newProgress = Math.min(100, (elapsed / currentImgResult.estimatedDuration) * 100);

      // Directly mutate the progress on the object within the messages array
      // Svelte's reactivity will pick this up IF the object reference itself is stable
      // or if the array is reassigned (which happens on other updates).
      // To be absolutely sure, we can trigger a reassignment, but let's see if direct mutation works.
      currentImgResult.progress = newProgress;
      messages = [...messages]; // Trigger Svelte reactivity for the progress update

      if (elapsed < currentImgResult.estimatedDuration) {
        currentImgResult.animationFrameId = requestAnimationFrame(animate);
      } else {
        currentImgResult.progress = 100; // Ensure it hits 100 if duration exceeded
        cancelProgressAnimation(currentImgResult);
      }
    };
    // Kick off the animation
    const initialImgResult = messages[messageIndex].images![imageIndex!];
    initialImgResult.animationFrameId = requestAnimationFrame(animate);
  }

  async function scrollToBottom() {
    await tick(); // Wait for DOM updates
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  function handleClearChat() {
    if (isOverallLoading) return; // Don't clear during loading

    // Reset to initial greeting
    messages = [
      {
        id: generateUniqueId(),
        role: 'assistant',
        content: 'Hi there! Type a prompt to generate images from multiple AI models.'
      }
    ];

    // Return to start state
    isStartState = true;

    // Make sure to reset any other state if needed
    userInput = '';
    isOverallLoading = false;
  }

  async function handleSubmit() {
    const currentPrompt = userInput.trim();
    if (!currentPrompt || isOverallLoading) return;

    // If this is the first user input, change from start state to chat state
    if (isStartState) {
      isStartState = false;
    }

    isOverallLoading = true;
    userInput = ''; // Clear input

    // Add user message
    messages = [...messages, { id: generateUniqueId(), role: 'user', content: currentPrompt }];
    // scrollToBottom(); // Save triggers scroll

    // Prepare assistant message with loading placeholders
    const assistantMessageId = generateUniqueId();
    const currentAspectRatioSetting = selectedAspectRatio; // Capture current aspect ratio for this batch
    const initialImageResults: ImageResult[] = modelsToQuery.map(model => ({
      model: model.displayName,
      isLoading: true,
      estimatedDuration: model.estimatedDuration,
      progress: 0,
      startTime: Date.now(),
      aspectRatioUsed: currentAspectRatioSetting // Store the AR used for this request
    }));
    messages = [...messages, { id: assistantMessageId, role: 'assistant', images: initialImageResults, isLoading: true }];
    // scrollToBottom(); // Save triggers scroll

    // Start animations for all loading images in the new assistant message
    initialImageResults.forEach(imgRes => {
        if (imgRes.isLoading) {
            startProgressAnimation(assistantMessageId, imgRes.model);
        }
    });

    // List of potentially copyrighted character terms that might cause issues with OpenAI's content policy
    const copyrightedTerms = [
      'goku', 'naruto', 'vegeta', 'batman', 'superman', 'spider-man', 'spider man', 'spiderman',
      'mario', 'luigi', 'pikachu', 'saiyan', 'super saiyan', 'dragonball', 'dragon ball'
    ];

    // Check if the prompt contains any copyrighted terms (case insensitive)
    const lowerPrompt = currentPrompt.toLowerCase();
    const hasCopyrightedTerms = copyrightedTerms.some(term => lowerPrompt.includes(term.toLowerCase()));

    // Call APIs for each model
    const generationPromises = modelsToQuery.map(async (modelConfig) => {
      try {
        let promptToUse = currentPrompt;

        // If this is the OpenAI model and we detected potential copyright issues
        if (modelConfig.endpoint === '/api/ai/generate-image' && hasCopyrightedTerms) {
          // Create a more generic prompt that avoids copyright issues but preserves intent
          const genericTerms = {
            'goku': 'a powerful warrior with spiky hair',
            'super saiyan': 'warrior with glowing blonde hair',
            'saiyan': 'powerful warrior',
            'naruto': 'ninja with blonde hair',
            'dragon ball': 'martial arts fantasy',
            'dragonball': 'martial arts fantasy'
            // Add more mappings as needed
          };

          // Replace copyrighted terms with generic descriptions
          promptToUse = lowerPrompt;
          Object.entries(genericTerms).forEach(([term, replacement]) => {
            promptToUse = promptToUse.replace(new RegExp(term, 'gi'), replacement);
          });

          // Add a style guide to help achieve a similar look
          promptToUse += ', anime style, vibrant colors, dynamic pose, high energy';
        }

        const payload: any = {
          prompt: promptToUse,
          aspectRatio: currentAspectRatioSetting,
          originalPrompt: currentPrompt // Pass the original prompt for reference
        };

        if (modelConfig.endpoint === '/api/ai/generate-replicate') {
          payload.model = modelConfig.name; // Specific model name for replicate endpoint
        }

        const response = await fetch(modelConfig.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: `HTTP error ${response.status}` }));
          throw new Error(errorData.error || `Failed to generate image with ${modelConfig.displayName}`);
        }
        const result = await response.json();
        return {
          model: modelConfig.displayName,
          url: result.imageUrl,
          revised_prompt: result.revised_prompt,
          promptUsed: result.prompt,
          isLoading: false,
          aspectRatioUsed: currentAspectRatioSetting // Persist AR with result
        };
      } catch (error: any) {
        console.error(`Error generating image with ${modelConfig.displayName}:`, error);
        return {
          model: modelConfig.displayName,
          error: error.message || 'Unknown error',
          isLoading: false,
          aspectRatioUsed: currentAspectRatioSetting // Persist AR with error result
        };
      }
    });

    // Update assistant message as each promise resolves
    for (const promise of generationPromises) {
        promise.then(result => {
            messages = messages.map(msg => {
                if (msg.id === assistantMessageId) {
                    const updatedImages = msg.images?.map(img => {
                        if (img.model === result.model) {
                            cancelProgressAnimation(img); // Stop animation for this specific image
                            return result; // Replace with final result
                        }
                        return img;
                    });
                    return { ...msg, images: updatedImages };
                }
                return msg;
            });
            // scrollToBottom(); // Save triggers scroll
        });
    }

    // Wait for all to settle to turn off overall loading and the message loading state
    Promise.allSettled(generationPromises).then(() => {
        messages = messages.map(msg => {
            if (msg.id === assistantMessageId) {
                // Ensure all animations are stopped for this message if any are still running
                msg.images?.forEach(img => {
                    if (img.isLoading) { // Should ideally be false by now, but as a safeguard
                        img.isLoading = false;
                        cancelProgressAnimation(img);
                    }
                });
                return { ...msg, isLoading: false }; // Mark the assistant message as fully loaded
            }
            return msg;
        });
        isOverallLoading = false;
       // scrollToBottom(); // Save triggers scroll
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  }

  function autoResize(node: HTMLTextAreaElement) {
    const MAX_HEIGHT = 240;
    // Ensure min-height from CSS is respected as the very floor
    const computedStyle = getComputedStyle(node);
    // Use parseFloat to get number from '40px' etc.
    const minHeight = parseFloat(computedStyle.minHeight) || 40;

    function resize() {
      node.style.height = 'auto'; // Reset height to correctly calculate scrollHeight
      let scrollHeight = node.scrollHeight;

      if (scrollHeight <= MAX_HEIGHT) {
        // Grow up to MAX_HEIGHT. Ensure it doesn't go below minHeight.
        node.style.height = Math.max(minHeight, scrollHeight) + 'px';
        node.style.overflowY = 'hidden';
      } else {
        // Content is taller than MAX_HEIGHT, so fix height and allow scroll.
        node.style.height = MAX_HEIGHT + 'px';
        node.style.overflowY = 'auto';
      }
    }

    node.addEventListener('input', resize);

    // Initial resize on mount
    // Use a timeout to ensure the node is fully rendered and styles applied
    setTimeout(resize, 0);

    return {
      destroy() {
        node.removeEventListener('input', resize);
      }
    };
  }

  onMount(() => {
    const browser = typeof window !== 'undefined';
    if (browser) {
        const storedMessages = sessionStorage.getItem(SESSION_STORAGE_KEY);
        let loadedSuccessfully = false;
        if (storedMessages) {
            try {
                const parsedMessages: Message[] = JSON.parse(storedMessages);
                // Basic validation
                if (Array.isArray(parsedMessages) && (parsedMessages.length === 0 || parsedMessages[0].id)) {
                    messages = parsedMessages.map(msg => ({
                        ...msg,
                        images: msg.images?.map(img => ({
                            ...img,
                            // Reset transient state for loaded images
                            isLoading: img.isLoading && false, // If it was saved mid-load, mark as not loading
                            progress: img.isLoading ? 0 : img.progress,
                            animationFrameId: undefined,
                            // startTime can be left as is, or reset if needed
                        }))
                    }));
                    // If we have user messages, we're no longer in start state
                    isStartState = !parsedMessages.some(msg => msg.role === 'user');
                    loadedSuccessfully = true;
                    console.log('Chat history loaded from sessionStorage.');
                } else {
                    console.warn('Invalid chat data found in sessionStorage.');
                    sessionStorage.removeItem(SESSION_STORAGE_KEY);
                }
            } catch (e) {
                console.error('Failed to parse chat history from sessionStorage:', e);
                sessionStorage.removeItem(SESSION_STORAGE_KEY); // Clear corrupted data
            }
        }

        if (!loadedSuccessfully) {
             // Add initial greeting only if nothing was loaded
            messages = [
                {
                    id: generateUniqueId(),
                    role: 'assistant',
                    content: 'Hi there! Type a prompt to generate images from multiple AI models.'
                }
            ];
            isStartState = true;
        }
        isInitialized = true; // Mark initialization complete
        scrollToBottom(); // Scroll after loading/initializing
    }
  });

  // Reactive statement to save messages to sessionStorage
  $: {
    const browser = typeof window !== 'undefined';
    if (browser && isInitialized && messages) {
        try {
            // Before saving, clear transient animation states
            const messagesToSave = messages.map(msg => ({
                ...msg,
                images: msg.images?.map(img => {
                    const { animationFrameId, startTime, ...rest } = img; // Omit animationFrameId and startTime
                    return rest;
                })
            }));
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(messagesToSave));
            // Optional: log saving
            // console.log('Chat history saved to sessionStorage.');
            scrollToBottom(); // Scroll whenever messages change after init
        } catch (e) {
            console.error('Failed to save chat history to sessionStorage:', e);
        }
    }
  }

</script>

<div id = 'main' in:scale={{ duration: 300, start: 0.95, opacity: 0, easing: cubicOut }}>
{#if isStartState}
  <div id="start-state-container" >
    <div class="welcome-header" in:fade={{ delay: 300, duration: 500 }}>
      <h2>Generate Images</h2>
      <p>Ask AI to create images in multiple styles</p>
    </div>

    <div class="start-chat-box" in:scale={{ delay: 200, duration: 500, start: 0.95, opacity: 0, easing: cubicOut }}>

      <form on:submit|preventDefault={handleSubmit} class="input-form">
        <textarea
          bind:value={userInput}
          placeholder="Describe the image you want to create..."
          disabled={isOverallLoading}
          class="text-input-area"
          rows="1"
          on:keydown={handleKeydown}
          use:autoResize
          autofocus
        ></textarea>
        <div class="input-controls-row">
          <button type="submit" class="submit-button" disabled={isOverallLoading || !userInput.trim()}>
            {#if isOverallLoading}
              <div class="spinner small"></div>
            {:else}
              <span>Generate</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/></svg>
            {/if}
          </button>
        </div>
      </form>

      <div class="model-badges" in:fade={{ delay: 400, duration: 300 }}>
        {#each modelsToQuery as model}
          <span class="model-badge">{model.displayName}</span>
        {/each}
      </div>
    </div>
  </div>
{:else}
  <div id="image-chat-page" in:fade={{ duration: 300 }}>
    <div class="chat-header" in:fade={{ duration: 250, delay: 50 }}>
      <img src="/wing-square.png" alt="Logo" class="logo" />
      <h3> Chat </h3>
    </div>

    <div class="chat-messages-container" bind:this={chatContainer} in:fade={{ duration: 250, delay: 100 }}>
      {#each messages as message (message.id)}
        <div class="message-wrapper {message.role}" in:fly={{ y: message.role === 'user' ? 10 : -10, duration: 300, delay:150 }}>
          {#if message.role === 'user'}
            <div class="message-bubble user-bubble">
              <p>{message.content}</p>
            </div>
          {:else if message.role === 'assistant'}
            <div class="message-bubble assistant-bubble">
              {#if message.content}
                <p>{message.content}</p>
              {/if}
              {#if message.images}
                <div class="images-grid">
                  {#each message.images as imageResult (imageResult.model)}
                    <div class="image-display-item">
                        <div class="image-card" style="--card-aspect-ratio: {getAspectRatioValue(imageResult.aspectRatioUsed)};">
                          <div class="image-content-wrapper">
                            {#if imageResult.isLoading}
                              <div class="progress-bar-overlay">
                                <div class="progress-bar-fill" style="height: {imageResult.progress || 0}%;">
                                  <div class="progress-bar-wave-effect"></div>
                                </div>
                              </div>
                              <div class="loading-placeholder">
                                <div class="spinner"></div>
                                <span>Generating...</span>
                              </div>
                            {:else if imageResult.url}
                              <img src={imageResult.url} alt="Generated by {imageResult.model}" class="generated-image"/>
                            {:else if imageResult.error}
                              <div class="error-placeholder">
                                <span class="error-icon">!</span>
                                <span>Error: {imageResult.error}</span>
                              </div>
                            {/if}
                          </div>
                        </div>
                        <div class="image-model-label">
                          <img src="{getModelIcon(imageResult.model)}" alt="{imageResult.model} icon" class="model-icon" />
                          <p>
                            {imageResult.model}
                          </p>

                        </div>
                    </div>
                  {/each}
                </div>
              {/if}
              {#if message.isLoading && !message.content} <!-- Show main spinner if assistant message is loading images -->
                   <div class="main-loading-spinner">
                      <span>Waiting for models...</span>
                      <div class="spinner"></div>
                  </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="chat-input-area" in:fly={{ y: 20, duration: 300, delay: 0, easing: cubicOut }}>


      <form on:submit|preventDefault={handleSubmit} class="input-form">
        <textarea
          bind:value={userInput}
          placeholder="Describe the image you want to create..."
          disabled={isOverallLoading}
          class="text-input-area"
          rows="1"
          on:keydown={handleKeydown}
          use:autoResize
        ></textarea>

        <div class="input-controls-row">

          <button
            type="button"
            class="refresh-button"
            on:click={handleClearChat}
            disabled={isOverallLoading}
            title="Clear chat and start over"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M5.463 4.433A9.961 9.961 0 0112 2c5.523 0 10 4.477 10 10 0 2.136-.67 4.116-1.81 5.74L17 12h3A8 8 0 006.46 6.228l-.997-1.795zm13.074 15.134A9.961 9.961 0 0112 22C6.477 22 2 17.523 2 12c0-2.136.67-4.116 1.81-5.74L7 12H4a8 8 0 0013.54 5.772l.997 1.795z"/></svg>
          </button>

          <div class="aspect-ratio-selector">
            <button class:active={selectedAspectRatio === '1:1'} on:click={() => selectedAspectRatio = '1:1'}>1:1</button>
            <button class:active={selectedAspectRatio === 'portrait'} on:click={() => selectedAspectRatio = 'portrait'}>Portrait</button>
            <button class:active={selectedAspectRatio === 'landscape'} on:click={() => selectedAspectRatio = 'landscape'}>Landscape</button>
          </div>


          <button type="submit" class="submit-button" disabled={isOverallLoading || !userInput.trim()}>
            {#if isOverallLoading}
              <div class="spinner small"></div>
            {:else}
              <span class='material-symbols-outlined'>arrow_upward</span>
            {/if}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}
</div>

<style lang="scss">
  :global(html) {
    height: 100vh; /* Ensure html takes full viewport height */
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  :global(body) {
    height: 100%; /* Occupy full height of html */
    color: #e0e0e0;
    margin: 0;
    overscroll-behavior: none;
    overflow: hidden; /* Prevent body scrollbars */
  }

  /* Start state styles */
  #start-state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    width: 100%;
    height: 90vh;
    max-width: 100vw;
  }

  #main{
    height: 100%; /* Occupy full height of body */
    overflow: hidden; /* Prevent scrollbars on main if content overflows due to error */
  }

  .welcome-header {
    text-align: center;
    margin-bottom: 30px;
    h2 {
      font-family: 'Newsreader', serif;
      font-size: 40px;
      font-weight: 600;
      margin: 0;
      color: #fff;
      margin-bottom: 8px;
    }
    p {
      font-size: 16px;
      color: rgba(white, .3);
      margin: 0;
    }
  }

  .start-chat-box {
    width: 100%;
    max-width: 650px;
    background-color: rgba(0, 0, 0, 0.2);
    border-radius: 24px;
    padding: 30px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .model-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 10px;

    .model-badge {
      padding: 4px 12px;
      border-radius: 16px;
      background-color: rgba(255, 255, 255, 0.08);
      font-size: 0.8rem;
      color: #aaa;
    }
  }

  /* Regular chat styles */
  #image-chat-page {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 10px); // This should be fine as it is, related to layout above fixed input
    width: 100%;
    max-width: 100vw;
    margin: auto;
    overflow: hidden;
    color: #f0f0f0;
  }

  .chat-header {
    padding: 8px 24px;
    background-color: rgba(black, 0);
    text-align: center;

    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;

    .logo{
      height: 18px;
    }

    h3 {
      margin: 4px 0;
      font-size: 16px;
      font-weight: 600;
      color: #fff;
    }
    p {
      margin: 0;
      font-size: 12px;
      color: #aaa;
    }
  }

  .chat-messages-container {
    flex-grow: 1;
    overflow-y: auto;
    padding: 16px 24px 240px 24px;

    display: flex;
    flex-direction: column;
    gap: 12px;
    scrollbar-width: thin;
    scrollbar-color: #444 #222;

    &::-webkit-scrollbar {
      width: 8px;
    }
    &::-webkit-scrollbar-track {
      background: #222;
      border-radius: 4px;
    }
    &::-webkit-scrollbar-thumb {
      background-color: #444;
      border-radius: 4px;
      border: 2px solid #222;
    }
  }

  .message-wrapper {
    display: flex;
    max-width: 85%;
    width: 1000px;
    box-sizing: border-box;
    margin: auto;
    &.user {
      margin-left: auto;
      //flex-direction: row-reverse;
    }
    &.assistant {
      margin-right: auto;
    }
  }

  .message-bubble {
    padding: 10px 15px;
    border-radius: 12px;
    line-height: 1.5;
    font-size: 14px;
    //box-shadow: 0 2px 5px rgba(0,0,0,0.2);

    p {
        margin: 0 0 5px 0;
        &:last-child { margin-bottom: 0; }
    }

    &.user-bubble {
      background-color: rgba(black, .2);
      box-shadow: inset 2px 2px 4px rgba(white, .02);
      color: rgba(white, .9);
      font-family: 'Newsreader', serif;
      font-size: 18px;
      font-weight: 600;
      margin: 18px 0 0 12px;
      letter-spacing: -.25px;
    }
    &.assistant-bubble {
      color: #e0e0e0;
      border-bottom-left-radius: 4px;
      width: 100%;
    }
  }

  .images-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 24px;
    margin-top: 10px;
  }

  .image-display-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .image-card {
    border-radius: 12px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: -10px 40px 30px rgba(black, 0.1);
    width: 100%;
    background-color: transparent;
    aspect-ratio: var(--card-aspect-ratio, 1 / 1);

    .image-content-wrapper {
        flex-grow: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        background-color: rgba(white, .05);
        border-radius: inherit;
        width: 100%;
        height: 100%;
    }
  }

  .image-model-label {
      padding: 4px 10px;
      color: #aaa;
      font-size: 0.8em;
      font-weight: 500;
      text-align: center;
      display: flex; // Added for icon alignment
      align-items: center; // Added for icon alignment
      justify-content: center; // Added for icon alignment
  }

  .model-icon { // Added new style for the icon
    width: 14px;
    height: 14px;
    margin-right: 6px;
    filter: invert(1) brightness(50);
    vertical-align: middle; // Keep for good measure, though flex alignment should handle it
  }

  .progress-bar-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0,0,0,0.4);
    z-index: 1;
    display: flex;
    flex-direction: column-reverse;
    border-radius: inherit;
    overflow: hidden;
  }

  .progress-bar-fill {
    width: 100%;
    background-color: rgba(var(--theme-color-rgb, 99, 85, 255), 0.65);
    transition: height 0.15s linear;
    position: relative;
    overflow: hidden;
  }

  .progress-bar-wave-effect {
    position: absolute;
    bottom: 0;
    left: -50%;
    width: 200%;
    height: 30px;
    background:
      radial-gradient(circle at 50% -10px, transparent 20px, rgba(var(--theme-color-rgb, 99, 85, 255), 0.85) 21px);
    background-size: 50px 30px;
    animation: waveAnimation 2s linear infinite;
    opacity: 0.7;
  }

  @keyframes waveAnimation {
    0% { transform: translateX(0); }
    100% { transform: translateX(50px); }
  }

  .generated-image {
    max-width: 100%;
    max-height: 100%;
    height: auto;
    display: block;
    object-fit: contain;
    z-index: 0;
  }

  .revised-prompt {
      font-size: 0.7em;
      color: #aaa;
      margin-top: 6px;
      font-style: italic;
      padding: 0 4px;
      max-height: 50px; /* Limit height */
      overflow-y: auto; /* Allow scrolling for long prompts */
  }

  .loading-placeholder, .error-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #888;
    font-size: 0.9em;
    text-align: center;
    width: 100%;
    height: 100%; // Ensure it fills the wrapper
    min-height: 150px;
    z-index: 2;
  }

  .error-placeholder {
      color: #ff6b6b;

      span{
        width: 80%;
        font-family: 'Newsreader', serif;
        font-size: 14px;
        font-weight: 600;
        line-height: 110%;
        letter-spacing: -.25px;
        margin-bottom: 12px;
      }
      .error-icon {
          font-size: 48px;
          margin-bottom: 8px;
      }
  }

  .main-loading-spinner {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px;
      gap: 8px;
      color: #aaa;
      font-size: 0.9em;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    &.small {
      width: 16px;
      height: 16px;
      border-width: 2px;
    }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .chat-input-area {
    display: flex;
    align-items: center; // Keep aspect ratio selector centered
    flex-direction: column;
    gap: 8px; // Gap between aspect ratio selector and the form
    width: 600px;
    position: fixed;
    bottom: 24px;
    left: calc(50vw - 300px);

    padding: 8px;

    border: 1px solid rgba(#fff, .1);
    border-radius: 28px;
    background-color: rgba(#666, .6);
    backdrop-filter: blur(40px);
    box-shadow: 0 40px 60px 10px rgba(black, .25);

    z-index: 3;
  }

  .aspect-ratio-selector {
    display: flex;
    gap: 8px;
    justify-content: center;
    button {
      padding: 6px 12px;
      font-size: 0.85em;
      border: 1px solid rgba(black, .1);
      background-color: rgba(black, .1);
      color: #ccc;
      border-radius: 16px;
      cursor: pointer;
      transition: background-color 0.2s, border-color 0.2s;
      &:hover {
        background-color: rgba(black, .15);
      }
      &:focus{
        transform: none;
      }
      &.active {
        background-color: #6355FF;
        color: white;
        border-color: #6355FF;
        font-weight: 500;
      }
    }
  }

  .input-form {
      display: flex;
      flex-direction: column; // Stack textarea and controls row
      gap: 8px; // Gap between textarea and controls row
      width: 100%; // Form takes full width of its container
  }

  .text-input-area { // New class for textarea
    flex-grow: 1;
    padding: 8px 12px;
    background: none;
    border: none;
    color: #f0f0f0;
    font-family: 'Newsreader', serif; // Apply Newsreader font
    font-size: 16px; // Slightly larger for readability
    font-weight: 550;
    text-shadow: 0 4px 8px rgba(black, .1);
    letter-spacing: -.25px; // Match user-bubble
    line-height: 1.5;
    outline: none;
    transition: border-color 0.2s, box-shadow 0.2s; // Removed height transition
    resize: none; // Disable manual resize handle
    overflow-y: hidden; // Initially hidden, JS will manage it
    min-height: 40px; // Approx height for 1 row with padding, acts as initial height
    max-height: 160px; // Maximum height before scrolling

    &:focus {
      //box-shadow: 0 0 0 2px rgba(0,122,255,0.3);
    }
    &::placeholder {
        color: rgba(white, .4);
    }
    &:disabled {
        cursor: not-allowed;
    }
  }

  .input-controls-row {
    display: flex;
    justify-content: space-between;
    gap: 10px; // Gap between buttons
    padding: 0 4px; // Small padding to align with textarea's internal padding feel
  }


  .submit-button, .refresh-button {
    padding: 0 15px;
    border-radius: 12px; // Slightly less rounded than textarea for distinction
    border: none;
    background-color: #6355FF;
    color: white;

    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 10px; // Ensure button has some width even with just spinner/icon
    transition: background-color 0.2s;
    padding: 0;
    width: 32px;
    height: 32px;

    span{
      font-size: 18px;
    }

    svg {
      height: 16px;
      width: 16px;
    }
    h3{
      font-size: 14px;
      font-weight: 500;
    }
    &:hover {
      background-color: #7366ff;
    }
    &:disabled {
      background-color: rgba(black, .5);
      cursor: not-allowed;
      .spinner.small {
          border-top-color: #bbb; /* Lighter spinner on disabled button */
      }
    }
  }

  .refresh-button {
    background-color: rgba(black, .5);
    // padding: 0 10px; // Adjusted by fixed height and min-width
    &:hover {
      background-color: rgba(black, .4);
    }
  }

</style>