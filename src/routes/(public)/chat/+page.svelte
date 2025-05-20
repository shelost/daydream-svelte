<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { scale, fly, fade } from 'svelte/transition';
  import { cubicOut, elasticOut } from 'svelte/easing';
  import Omnibar from '$lib/components/Omnibar.svelte'; // Import Omnibar
  import { Markdown } from 'svelte-rune-markdown'; // Add this line to import the Markdown component

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string; // Content is now always a string
    isLoading?: boolean; // For assistant message, indicates waiting for response
    isStreaming?: boolean; // For assistant message, indicates text is streaming
    modelUsed?: string; // For assistant message, which model generated the response
    error?: string; // For assistant message, if an error occurred
  }

  let messages: Message[] = [];
  let omnibarPrompt: string = ''; // Bound to Omnibar's additionalContext
  let isOverallLoading: boolean = false; // Tracks if a response is being generated
  let currentSelectedTextModel: string = 'gpt-4o-mini'; // Updated default text model

  // Map of model IDs to human-friendly labels for display
  const modelLabels: Record<string, string> = {
    'gpt-4o-mini': 'GPT-4o Mini',
    'gpt-4o': 'GPT-4o',
    'gpt-3.5-turbo': 'GPT-3.5 Turbo',
    'claude-3-7-sonnet-20250219': 'Claude 3.7 Sonnet',
    'gemini-2.5-pro-preview-05-06': 'Gemini 2.5 Pro',
    'gemini-2.5-flash-preview-05-20': 'Gemini 2.5 Flash'
  };

  const getModelLabel = (id: string) => modelLabels[id] || id;

  let chatContainer: HTMLElement;
  let isInitialized = false; // Flag to prevent saving before loading
  let isStartState = true; // Track if we're in the initial centered state
  const SESSION_STORAGE_KEY = 'textChatMessages'; // Changed key for text chat

  const generateUniqueId = () => `_${Math.random().toString(36).substring(2, 11)}`;

  async function scrollToBottom() {
    await tick(); // Wait for DOM updates
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  function handleClearChat() {
    if (isOverallLoading) return; // Don't clear during loading

    messages = [
      {
        id: generateUniqueId(),
        role: 'assistant',
        content: "Hi there! I'm your friendly chat assistant. How can I help you today?"
      }
    ];
    isStartState = true;
    omnibarPrompt = '';
    isOverallLoading = false;
  }

  async function handleOmnibarSubmit() {
    const currentPrompt = omnibarPrompt.trim();
    if (!currentPrompt || isOverallLoading) return;

    if (isStartState) {
      isStartState = false;
    }

    isOverallLoading = true;
    const userMessageId = generateUniqueId();
    messages = [...messages, { id: userMessageId, role: 'user', content: currentPrompt }];
    omnibarPrompt = ''; // Clear Omnibar input

    const assistantMessageId = generateUniqueId();
    messages = [
      ...messages,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
      isLoading: true,
        isStreaming: true,
        modelUsed: currentSelectedTextModel
      }
    ];
    // scrollToBottom(); // Will be handled by reactive messages update

    try {
      // Determine appropriate endpoint based on model prefix/provider
      let endpoint = '/api/ai/chat';
      let requestBody: any = {};

      const messagesHistory = messages
        .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.isLoading && !m.isStreaming && !m.error))
        .map(m => ({ role: m.role, content: m.content }));

      if (currentSelectedTextModel.startsWith('claude')) {
        // Anthropic Claude models expect a plain prompt plus optional images
        endpoint = '/api/ai/anthropic';

        // Format conversation history for Claude
        let formattedPrompt = '';
        if (messagesHistory && messagesHistory.length > 0) {
          formattedPrompt = messagesHistory
            .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
            .join('\n\n');

          // Add the current prompt if not already included
          if (currentPrompt && !messagesHistory.some(m =>
              m.role === 'user' && m.content.trim() === currentPrompt.trim())) {
            formattedPrompt += `\n\nHuman: ${currentPrompt}`;
          }
        } else {
          formattedPrompt = currentPrompt;
        }

        // Add a reminder of the model's identity
        const modelIdentityGuide = `You are ${getModelLabel(currentSelectedTextModel)}, a helpful AI assistant created by Anthropic.`;

        requestBody = {
          prompt: `${modelIdentityGuide}\n\n${formattedPrompt}`,
          model: currentSelectedTextModel,
          images: []
        };
        console.log('Using Anthropic endpoint with model:', currentSelectedTextModel);
      } else if (currentSelectedTextModel.startsWith('gemini')) {
        // Google Gemini models
        endpoint = '/api/ai/google';

        // Better conversation formatting for Gemini
        // Format more like a chat conversation rather than raw history
        let formattedPrompt = '';
        if (messagesHistory && messagesHistory.length > 0) {
          formattedPrompt = messagesHistory
            .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
            .join('\n\n');

          // Add the current prompt if not included in history
          if (currentPrompt && !messagesHistory.some(m =>
              m.role === 'user' && m.content.trim() === currentPrompt.trim())) {
            formattedPrompt += `\n\nHuman: ${currentPrompt}`;
          }
        } else {
          formattedPrompt = currentPrompt;
        }

        // Add a reminder of the model's identity at the beginning
        const modelIdentityGuide = `You are ${getModelLabel(currentSelectedTextModel)}, a helpful AI assistant created by Google.`;
        requestBody = {
          prompt: `${modelIdentityGuide}\n\n${formattedPrompt}`,
          model: currentSelectedTextModel,
          images: []
        };
        console.log('Using Google endpoint with model:', currentSelectedTextModel);
      } else {
        // Default to OpenAI chat endpoint with full messages history
        endpoint = '/api/ai/chat';

        // Add a system message about model identity if not already present
        let systemMessageAdded = false;
        const processedMessages = messagesHistory.map((msg, index) => {
          if (index === 0 && msg.role === 'system') {
            systemMessageAdded = true;
            return {
              ...msg,
              content: `You are ${getModelLabel(currentSelectedTextModel)}, a helpful AI assistant created by OpenAI. ${msg.content}`
            };
          }
          return msg;
        });

        // Add a system message if none exists
        if (!systemMessageAdded && processedMessages.length > 0) {
          processedMessages.unshift({
            role: 'system',
            content: `You are ${getModelLabel(currentSelectedTextModel)}, a helpful AI assistant created by OpenAI.`
          });
        }

        requestBody = {
          messagesHistory: processedMessages,
          model: currentSelectedTextModel
        };
        console.log('Using OpenAI endpoint with model:', currentSelectedTextModel);
      }

      const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok || !response.body) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error ${response.status}` }));
        throw new Error(errorData.message || `Failed to get response from ${currentSelectedTextModel}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let assistantContent = '';

      messages = messages.map(msg =>
        msg.id === assistantMessageId ? { ...msg, isLoading: false, isStreaming: true } : msg
      );

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });

          // Handle different API response formats
          let processedChunk = chunk;

          if (currentSelectedTextModel.startsWith('gemini')) {
            try {
              // Try to parse JSON if it's a complete JSON object
              if (chunk.trim().startsWith('{') && chunk.trim().endsWith('}')) {
                const jsonResponse = JSON.parse(chunk);

                // Extract the actual message content from Gemini's response format
                if (jsonResponse.message && typeof jsonResponse.message === 'object' && jsonResponse.message.content) {
                  processedChunk = jsonResponse.message.content;
                } else if (jsonResponse.message && typeof jsonResponse.message === 'string') {
                  processedChunk = jsonResponse.message;
                } else if (jsonResponse.content) {
                  processedChunk = jsonResponse.content;
                } else if (jsonResponse.text) {
                  processedChunk = jsonResponse.text;
                }

                // Filter out metadata properties that shouldn't be shown to the user
                if (processedChunk === chunk && typeof jsonResponse === 'object') {
                  // If we couldn't extract a specific content field, try removing metadata
                  const metadataKeys = ['usage', 'input_chars', 'output_chars', 'cost', 'durationMs', 'total_tokens'];
                  const hasMetadataKeys = metadataKeys.some(key => key in jsonResponse);

                  if (hasMetadataKeys) {
                    // Create a filtered copy without metadata
                    const filtered = { ...jsonResponse };
                    metadataKeys.forEach(key => delete filtered[key]);
                    processedChunk = JSON.stringify(filtered);
                  }
                }

                // Log any errors in the JSON response
                if (jsonResponse.error) {
                  console.error('Error in Gemini response:', jsonResponse.error);
                }
              }
            } catch (e) {
              // If JSON parsing fails, use the chunk as is
              console.log('Could not parse Gemini response as JSON:', e);
            }
          }

          assistantContent += processedChunk;
          messages = messages.map(msg =>
            msg.id === assistantMessageId ? { ...msg, content: assistantContent } : msg
          );
        }
      }
      messages = messages.map(msg =>
        msg.id === assistantMessageId ? { ...msg, isStreaming: false, content: assistantContent.trim() || "Sorry, I couldn't generate a response." } : msg
      );

      // Final cleanup pass - check if the content might still be JSON
      messages = messages.map(msg => {
        if (msg.id === assistantMessageId && msg.content) {
          const content = msg.content.trim();
          // Try to clean up any remaining JSON objects
          if (content.startsWith('{') && content.endsWith('}')) {
            try {
              const jsonObj = JSON.parse(content);

              // Extract the message if possible
              if (jsonObj.message && typeof jsonObj.message === 'string') {
                return { ...msg, content: jsonObj.message };
              } else if (jsonObj.content && typeof jsonObj.content === 'string') {
                return { ...msg, content: jsonObj.content };
              } else if (jsonObj.text && typeof jsonObj.text === 'string') {
                return { ...msg, content: jsonObj.text };
      } else {
                // Remove metadata fields
                const filtered = { ...jsonObj };
                ['usage', 'input_chars', 'output_chars', 'cost', 'durationMs', 'total_tokens'].forEach(key => {
                  delete filtered[key];
                });

                // Only use the filtered JSON if it's different
                if (Object.keys(filtered).length < Object.keys(jsonObj).length) {
                  return { ...msg, content: JSON.stringify(filtered, null, 2) };
                }
              }
            } catch (e) {
              // Not valid JSON, leave as is
            }
          }
        }
        return msg;
      });

    } catch (error: any) {
      console.error(`Error with ${currentSelectedTextModel}:`, error);
      messages = messages.map(msg =>
        msg.id === assistantMessageId
          ? { ...msg, isLoading: false, isStreaming: false, error: error.message || 'Unknown error', content: `Error: ${error.message || 'Failed to get response.'}` }
          : msg
      );
    } finally {
        isOverallLoading = false;
      // scrollToBottom(); // Will be handled by reactive messages update
    }
  }

  onMount(() => {
    const browser = typeof window !== 'undefined';
    if (browser) {
        const storedMessages = sessionStorage.getItem(SESSION_STORAGE_KEY);
        let loadedSuccessfully = false;
        if (storedMessages) {
            try {
                const parsedMessages: Message[] = JSON.parse(storedMessages);
                if (Array.isArray(parsedMessages) && (parsedMessages.length === 0 || (parsedMessages[0].id && typeof parsedMessages[0].content === 'string'))) {
                    messages = parsedMessages.map(msg => ({
                        ...msg,
                        // Reset transient states for loaded messages
                        isLoading: false,
                        isStreaming: false,
                    }));
                    isStartState = !parsedMessages.some(msg => msg.role === 'user');
                    loadedSuccessfully = true;
                    console.log('Text chat history loaded from sessionStorage.');
                } else {
                    console.warn('Invalid text chat data found in sessionStorage.');
                    sessionStorage.removeItem(SESSION_STORAGE_KEY);
                }
            } catch (e) {
                console.error('Failed to parse text chat history from sessionStorage:', e);
                sessionStorage.removeItem(SESSION_STORAGE_KEY);
            }
        }

        if (!loadedSuccessfully) {
            messages = [
                {
                    id: generateUniqueId(),
                    role: 'assistant',
                    content: "Hi there! I'm your friendly chat assistant. How can I help you today?"
                }
            ];
            isStartState = true;
        }
        isInitialized = true;
        scrollToBottom();
    }
  });

  $: {
    const browser = typeof window !== 'undefined';
    if (browser && isInitialized && messages) {
        try {
            const messagesToSave = messages.map(msg => {
                // Ensure we don't save active loading/streaming states permanently
                const { isLoading, isStreaming, ...rest } = msg;
                    return rest;
            });
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(messagesToSave));
            scrollToBottom();
        } catch (e) {
            console.error('Failed to save text chat history to sessionStorage:', e);
        }
    }
  }

</script>

<div id = 'main' in:scale={{ duration: 300, start: 0.95, opacity: 0, easing: cubicOut }}>
{#if isStartState}
  <div id="start-state-container" >
    <div class="welcome-header" in:fade={{ delay: 300, duration: 500 }}>
      <h2>Daydream Chat</h2>
      <p>Select a model and start a conversation</p>
    </div>

     <Omnibar
        settingType="text"
        bind:additionalContext={omnibarPrompt}
        bind:currentSelectedModel={currentSelectedTextModel}
        imageModels={[]}
        isGenerating={isOverallLoading}
        onSubmit={handleOmnibarSubmit}
        parentDisabled={false}
      />


  </div>
{:else}
  <div id="image-chat-page" in:fade={{ duration: 300 }}> <!-- Re-evaluate if this ID should be more generic -->
    <div class="chat-header" in:fade={{ duration: 250, delay: 50 }}>
      <img src="/wing-square.png" alt="Logo" class="logo" />
      <h3> Chat </h3>
      <!-- Optionally display current model: <p>with {getModelLabel(currentSelectedTextModel)}</p> -->
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
              {#if message.isStreaming || message.isLoading}
                <p>{message.content}{#if message.isStreaming && !message.content}&nbsp;{:else if message.isStreaming}<span>▍</span>{/if}</p>
              {:else}
                <div class="markdown-container">
                  <Markdown content={message.content} />
                </div>
              {/if}
              {#if message.modelUsed && !message.isStreaming && !message.isLoading}
                <div class="assistant-model-info">
                  Sent by {getModelLabel(message.modelUsed)}
                </div>
              {/if}
              {#if message.isLoading}
                 <div class="main-loading-spinner" style="justify-content: flex-start; padding: 5px 0;">
                    <div class="spinner small"></div>
                    <span>Thinking...</span>
                </div>
              {:else if message.error}
                <div class="error-placeholder" style="min-height: auto; padding: 5px 0; text-align: left;">
                  <span style="font-size: 0.9em; color: #ff8a8a;">Error: {message.error}</span>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>

       <Omnibar
        settingType="text"
        bind:additionalContext={omnibarPrompt}
        bind:currentSelectedModel={currentSelectedTextModel}
        imageModels={[]}
        isGenerating={isOverallLoading}
        onSubmit={handleOmnibarSubmit}
        parentDisabled={false}
      />

          </div>
{/if}
</div>

<style lang="scss">
  // Global styles from original file are kept, assuming they are desired.
  // Minimal changes below, mostly to adapt or slightly adjust for text chat.

  :global(html) {
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }
  :global(body) {
    height: 100%;
    color: #e0e0e0;
    margin: 0;
    overscroll-behavior: none;
    overflow: hidden;
  }

  #main{
    height: 100%;
    overflow: hidden;
  }

  /* Start state styles - slightly adjusted for Omnibar focus */
  #start-state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    width: 100%;
    height: 90vh; // Adjusted to give more space if Omnibar is taller
    max-width: 100vw;
  }

  .welcome-header {
    text-align: center;
    margin-bottom: 20px; // Reduced margin
    h2 {
      font-family: 'Newsreader', serif;
      font-size: 36px; // Slightly smaller
      font-weight: 600;
      margin: 0 0 8px 0;
      color: #fff;
    }
    p {
      font-size: 15px;
      color: rgba(white, .4);
      margin: 0;
    }
  }

  // start-chat-box is now just a wrapper for Omnibar, simplified
  .start-chat-box {
    width: 100%;
    max-width: 600px; // Match Omnibar width
    display: flex;
    flex-direction: column;
    gap: 15px; // Space if model badges were re-added below Omnibar
  }

  .model-badges { // Kept if you want to show text model badges
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    .model-badge {
      padding: 4px 12px;
      border-radius: 16px;
      background-color: rgba(255, 255, 255, 0.08);
      font-size: 0.8rem;
      color: #aaa;
    }
  }


  /* Regular chat styles */
  #image-chat-page { // Consider renaming ID to #text-chat-page if it causes confusion
    display: flex;
    flex-direction: column;
    height: calc(100vh - 10px);
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

    .logo{ height: 18px; }
    h3 { margin: 4px 0; font-size: 16px; font-weight: 600; color: #fff; }
    p { margin: 0; font-size: 12px; color: #aaa; }
  }

  .chat-messages-container {
    flex-grow: 1;
    overflow-y: auto;
    // Adjusted padding: top, sides, bottom (to clear fixed Omnibar)
    padding: 16px 24px calc(80px + 24px + 20px) 24px; // 80px omnibar + 24px bottom offset + 20px buffer

    display: flex;
    flex-direction: column;
    gap: 12px;
    scrollbar-width: thin;
    scrollbar-color: #444 #222;

    &::-webkit-scrollbar { width: 8px; }
    &::-webkit-scrollbar-track { background: #222; border-radius: 4px; }
    &::-webkit-scrollbar-thumb { background-color: #444; border-radius: 4px; border: 2px solid #222; }
  }

  .message-wrapper {
    display: flex;
    max-width: 85%;
    width: 1000px; // Max width of message content area
    box-sizing: border-box;
    margin: auto; // Centers the content column
    &.user { margin-left: auto; }
    &.assistant { margin-right: auto; }
  }

  .message-bubble {
    padding: 10px 15px;
    border-radius: 18px; // Slightly more rounded
    line-height: 1.6; // Improved readability
    font-size: 15px; // Standardized font size

    p {
        margin: 0;
        white-space: pre-wrap; // Preserve newlines and spaces from AI
        word-wrap: break-word; // Break long words

        // Blinking cursor for streaming
        span {
          display: inline-block;
          animation: blink 1s step-end infinite;
        }
    }

    &.user-bubble {
      background-color: rgba(black, .4);
      box-shadow: inset 1px 1px 2px rgba(white, .02), 0 1px 2px rgba(black,0.1);
      color: rgba(white, .9);
      font-family: "ivypresto-headline", 'Newsreader', serif;
      font-size: 18px; // User prompt slightly larger
      font-weight: 500;
      margin: 10px 0 0 0;
      letter-spacing: .1px;
    }
    &.assistant-bubble {
      font-family: "Inter", sans-serif;
      font-size: 14px;
      font-weight: 450;
      color: #e0e0e0;
      width: fit-content; // Bubble fits content
      max-width: 100%;
      margin: 10px 12px 0 0; // Adjusted margin

      // Adjust for markdown container
      .markdown-container {
        margin-bottom: 0; // No margin needed within bubble

        // Remove top margin from first element and bottom margin from last element
        :global(*:first-child) {
          margin-top: 0;
        }

        :global(*:last-child) {
          margin-bottom: 0;
        }
      }
    }
  }

  .assistant-model-info {
    font-size: 0.75em;
    color: rgba(white, 0.4);
    margin-top: 8px;
    text-align: left;
  }

  @keyframes blink {
    from, to { opacity: 1; }
    50% { opacity: 0; }
  }

  // Removed .images-grid, .image-display-item, .image-card, etc.
  // Removed .progress-bar-overlay, .progress-bar-fill, .progress-bar-wave-effect
  // Removed .generated-image, .revised-prompt
  // Kept .loading-placeholder, .error-placeholder for assistant messages
  // Spinner styles are general and can be reused

  .main-loading-spinner { // Used for initial "Thinking..."
        display: flex;
        align-items: center;
      // justify-content: center; // Adjusted by inline style
      padding: 5px 0; // Adjusted by inline style
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
      width: 14px; // Adjusted size
      height: 14px;
      border-width: 2px;
    }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  // Chat input area now houses Omnibar
  .chat-input-area {
    display: flex;
    align-items: center;
    flex-direction: column; // Omnibar is a block
    gap: 0; // No gap as Omnibar is the only child usually
    // Width, position, etc. set by inline styles to match Omnibar's typical placement
    position: fixed;
    bottom: 24px; // Consistent with Omnibar's original idea
    // backdrop-filter and box-shadow are now handled by Omnibar itself
    z-index: 3; // Ensure it's above chat messages
  }

  // Removed .aspect-ratio-selector
  // Removed .input-form (Omnibar has its own form)
  // Removed .text-input-area (Omnibar has its own textarea)
  // Removed .input-controls-row (Omnibar has its own controls)
  // Removed .submit-button, .refresh-button (Omnibar submit; separate refresh if needed)

  // The refresh button styles can be applied to a standalone button if re-added outside Omnibar
  .refresh-button-standalone { // Example class if you add a clear chat button outside omnibar
    padding: 0;
    width: 32px;
    height: 32px;
    border-radius: 12px;
    border: none;
    background-color: rgba(black, .5);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s;

    svg {
      height: 16px;
      width: 16px;
    }
    &:hover {
      background-color: rgba(black, .4);
    }
    &:disabled {
      background-color: rgba(black, .3);
      cursor: not-allowed;
    }
  }

  // Add markdown container styling from ResultNode.svelte
  .markdown-container {
    width: 100%;
    margin-bottom: 8px; /* Space below text if multiple items */

    :global(p), :global(ul), :global(ol), :global(h5), :global(h6) {
      font-size: 14px;
      font-weight: 450;
      line-height: 1.5;
      letter-spacing: -.2px;
      color: rgba(white, .75);
      margin: 12px 0;
    }
    :global(h1){
      font-family: "ivypresto-headline", serif;
      font-size: 24px;
      font-weight: 500;
      letter-spacing: 0px;
      line-height: 1.1;
    }
    :global(h2){
      font-family: "ivypresto-headline", serif;
      font-size: 20px;
      font-weight: 500;
      letter-spacing: 0.2px;
      line-height: 1.1;
    }
    :global(h3){
      font-size: 18px;
      font-weight: 500;
    }
    :global(h4){
      font-size: 16px;
      font-weight: 500;
    }

    :global(strong) {
      font-weight: bold;
      color: white;
    }
    :global(em) {
      font-style: italic;
    }
    :global(table) {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1em;
    }
    :global(th), :global(td) {
      border: 1px solid rgba(255, 255, 255, 0.3);
      padding: 6px 8px;
      text-align: left;
    }
    :global(th) {
      background-color: rgba(255, 255, 255, 0.1);
    }
    :global(code) {
      background-color: #333; /* Darker code block */
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: monospace;
      font-size: 13px;
    }
    :global(pre) {
      background-color: #333; /* Darker pre block */
      padding: 0.5em;
      border-radius: 3px;
      overflow-x: auto;
    }
    :global(pre code) {
      padding: 0;
      background-color: transparent;
    }
    :global(blockquote) {
      border-left: 3px solid rgba(255, 255, 255, 0.5);
      padding-left: 1em;
      margin-left: 0;
      color: rgba(255, 255, 255, 0.75);
    }

    :global(ul), :global(ol) {
      padding-left: 1.5em;
    }

    :global(li) {
      margin-bottom: 0.5em;
    }

    :global(a) {
      color: #58a6ff;
      text-decoration: none;
    }

    :global(a:hover) {
      text-decoration: underline;
    }
  }

</style>