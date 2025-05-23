<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { scale, fly, fade } from 'svelte/transition';
  import { cubicOut, elasticOut } from 'svelte/easing';
  import Omnibar from '$lib/components/Omnibar.svelte'; // Import Omnibar
  import { Markdown } from 'svelte-rune-markdown'; // Add this line to import the Markdown component
  import { fetchAndLog } from '$lib/utils/fetchAndLog'; // Import fetchAndLog for API logging

  // Import Prism.js for syntax highlighting - make it conditional for production builds
  let Prism: any = null; // Keep at top-level, initialize to null
  let PrismLoaded: boolean = false; // Keep at top-level

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
  let currentSelectedTextModel: string = 'claude-3-7-sonnet-20250219'; // Updated default text model

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

  let lastUserEditTime = 0;
  let pendingAnalysis = false;

  let markdownContainers = new Map();

  // Function to apply syntax highlighting to code blocks
  async function highlightCodeBlocks(element) {
    if (!element) return;

    const codeBlocks = element.querySelectorAll('pre code:not(.highlighted)');
    if (codeBlocks.length > 0) {
      // Wait for DOM update
      await tick();
      codeBlocks.forEach(codeBlock => {
        addHeaderAndHighlight(codeBlock);
      });
    }
  }

  // Separated function to add header and highlight a single code block
  function addHeaderAndHighlight(codeBlock) {
    if (!codeBlock || codeBlock.classList.contains('highlighted')) return;

    // Mark this code block as processed
    codeBlock.classList.add('highlighted');

    // If the language class is not set, default to markup
    let language = 'markup';
    const langClass = Array.from(codeBlock.classList).find(cls => typeof cls === 'string' && cls.startsWith('language-'));
    if (langClass && typeof langClass === 'string') {
      language = langClass.substring(9); // Remove 'language-' prefix
    } else {
      codeBlock.classList.add('language-markup');
    }

    // Add a header with language label and copy button if not already present
    const pre = codeBlock.parentElement;
    if (pre && !pre.querySelector('.code-header')) {
      const header = document.createElement('div');
      header.className = 'code-header';

      const langLabel = document.createElement('span');
      langLabel.className = 'code-language';
      langLabel.textContent = language;
      header.appendChild(langLabel);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
      copyBtn.title = 'Copy code';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(codeBlock.textContent || '');
        copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';
        setTimeout(() => {
          copyBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        }, 2000);
      });
      header.appendChild(copyBtn);

      pre.insertBefore(header, codeBlock);

      // Add position relative to pre element to position the header
      pre.style.position = 'relative';
    }

    // Apply syntax highlighting only if Prism is loaded
    if (PrismLoaded && Prism && typeof Prism.highlightElement === 'function') {
      Prism.highlightElement(codeBlock);
    }
  }

  // Create a mutation observer to detect new code blocks during streaming
  let messageObservers = new Map();

  function setupStreamingCodeHighlighter(container, messageId) {
    // Disconnect existing observer for this message if it exists
    if (messageObservers.has(messageId)) {
      messageObservers.get(messageId).disconnect();
    }

    if (!container) return;

    // Create a new mutation observer to watch for code blocks being added during streaming
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          // Check if any new pre/code elements were added or modified
          const codeBlocks = container.querySelectorAll('pre code:not(.highlighted)');
          if (codeBlocks.length > 0) {
            codeBlocks.forEach(codeBlock => {
              addHeaderAndHighlight(codeBlock);
            });
          }
        }
      }
    });

    // Start observing the container for changes
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Store the observer for cleanup later
    messageObservers.set(messageId, observer);

    return observer;
  }

  // Function to copy message content
  function copyMessage(content) {
    navigator.clipboard.writeText(content || '');
  }

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

  function clearChatAndStorage() {
    if (isOverallLoading) return;
    handleClearChat(); // Resets UI and in-memory messages
    const browser = typeof window !== 'undefined';
    if (browser) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      console.log('Text chat history cleared from sessionStorage.');
    }
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

      const response = await fetchAndLog(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
      }, {
        page: 'Chat',
        model: currentSelectedTextModel,
        apiProvider: currentSelectedTextModel.startsWith('claude') ? 'Anthropic' :
                    currentSelectedTextModel.startsWith('gemini') ? 'Google' : 'OpenAI'
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

      // Set up a mutation observer for the streaming content
      const setupObserver = () => {
        if (markdownContainers[assistantMessageId]) {
          setupStreamingCodeHighlighter(markdownContainers[assistantMessageId], assistantMessageId);
        } else {
          // If container isn't available yet, retry after a short delay
          setTimeout(setupObserver, 100);
        }
      };
      setupObserver();

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });

          // Handle different API response formats
          let processedChunk = chunk;

          // Check if this is an API log entry chunk (will be at the end)
          if (chunk.includes('"apiLogEntry"')) {
            try {
              // Try to extract just the API log entry as JSON
              const logMatch = chunk.match(/\{[\s\n]*"apiLogEntry"[\s\n]*:[\s\n]*(\{.*\})[\s\n]*\}/s);
              if (logMatch && logMatch[1]) {
                // This is just an API log entry, don't add to the response content
                console.log('Received API log entry');
                continue;
              }
            } catch (e) {
              console.log('Failed to parse API log entry', e);
            }
          }

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
        // Dynamically import Prism.js to avoid SSR issues
        const loadPrism = async () => {
          try {
            if (typeof window !== 'undefined') {
              const prismModule = await import('prismjs');
              await import('prismjs/components/prism-markup.js');
              await import('prismjs/components/prism-javascript.js');
              await import('prismjs/components/prism-typescript.js');
              await import('prismjs/components/prism-css.js');
              await import('prismjs/components/prism-scss.js');
              await import('prismjs/components/prism-python.js');
              await import('prismjs/components/prism-json.js');
              await import('prismjs/components/prism-bash.js');
              await import('prismjs/components/prism-markdown.js');

              const prismInstance = prismModule.default || prismModule;

              if (prismInstance && typeof prismInstance.highlightElement === 'function') {
                Prism = prismInstance; // Assign to top-level Prism
                PrismLoaded = true;    // Assign to top-level PrismLoaded
                console.log('Prism.js loaded successfully for chat page.');

                // Load CSS dynamically
                if (!document.querySelector('link[href*="prism-okaidia"]')) {
                  const link = document.createElement('link');
                  link.rel = 'stylesheet';
                  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-okaidia.min.css';
                  document.head.appendChild(link);
                }
              } else {
                console.warn('Prism.js loaded but highlightElement method not available.');
              }
            }
          } catch (error) {
            console.error('Failed to load Prism.js:', error);
          }
        };

        loadPrism();

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

        // Initialize Prism.js for any code blocks that might already be in the DOM
        setTimeout(() => {
          document.querySelectorAll('.markdown-container').forEach(container => {
            highlightCodeBlocks(container);
          });
        }, 100);
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

    // When a message starts or stops streaming, setup or cleanup observers
    for (const message of messages) {
      if (message.role === 'assistant') {
        if (message.isStreaming) {
          // Ensure observer is set up if streaming starts/continues
          if (markdownContainers[message.id] && !messageObservers.has(message.id)) {
            setupStreamingCodeHighlighter(markdownContainers[message.id], message.id);
          }
        } else if (!message.isStreaming && messageObservers.has(message.id)) {
          // Clean up observer when streaming ends
          const observer = messageObservers.get(message.id);
          observer.disconnect();
          messageObservers.delete(message.id);

          // Final highlighting pass
          if (markdownContainers[message.id]) {
            highlightCodeBlocks(markdownContainers[message.id]);
          }
        }
      }
    }
  }

  // --- Animated cursor SVG ---
  // We'll use a pulsing purple dot for the AI streaming cursor
  const AnimatedCursor = () => `
    <span class="animated-cursor">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="9" cy="9" r="6" fill="#6355FF">
          <animate attributeName="r" values="6;8;6" dur="1s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.7;1" dur="1s" repeatCount="indefinite" />
        </circle>
      </svg>
    </span>
  `;

  // Handle example prompt clicks
  function handleExamplePrompt(promptText: string) {
    if (isOverallLoading) return;

    omnibarPrompt = promptText;
    // Auto-submit the prompt
    handleOmnibarSubmit();
  }
</script>

<div id = 'main' class = 'stan' in:scale={{ duration: 300, start: 0.95, opacity: 0, easing: cubicOut }}>
  <button
    class="global-refresh-button"
    title="Clear Chat and History"
    on:click={clearChatAndStorage}
    disabled={isOverallLoading}
  >
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"></polyline>
      <polyline points="1 20 1 14 7 14"></polyline>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
    </svg>
  </button>

{#if isStartState}
  <div id="start-state-container" >
    <div class="welcome-header" in:fade={{ delay: 300, duration: 500 }}>
      <img src="/stan-avatar.png" alt="Stanley" class="stan-avatar">
      <h2> Stanley </h2>
    </div>

    <!-- Example Prompts Section -->
    <div class="example-prompts" in:fade={{ delay: 500, duration: 500 }}>

      <div class="prompts-grid">
        <button
          class="prompt-card"
          on:click={() => handleExamplePrompt("What is a Stan Store?")}
          disabled={isOverallLoading}
        >
          <span class="prompt-text">What is a Stan Store?</span>
        </button>

        <button
          class="prompt-card"
          on:click={() => handleExamplePrompt("Give me a list of content ideas")}
          disabled={isOverallLoading}
        >
          <span class="prompt-text">Give me a list of content ideas</span>
        </button>

        <button
          class="prompt-card"
          on:click={() => handleExamplePrompt("Create an outline for a 4-module course on UGC")}
          disabled={isOverallLoading}
        >
          <span class="prompt-text">Create an outline for a 4-module course on UGC</span>
        </button>

        <button
          class="prompt-card"
          on:click={() => handleExamplePrompt("How do I get started making money online?")}
          disabled={isOverallLoading}
        >
          <span class="prompt-text">How do I get started making money online?</span>
        </button>
      </div>
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
  <div id="image-chat-page"  in:fade={{ duration: 300 }}> <!-- Re-evaluate if this ID should be more generic -->


    <div class="chat-messages-container" bind:this={chatContainer} in:fade={{ duration: 250, delay: 100 }}>
      {#each messages as message (message.id)}
        <div class="message-wrapper {message.role}" in:fly={{ y: message.role === 'user' ? 10 : -10, duration: 300, delay:150 }}>
          {#if message.role === 'user'}
            <div class="message-content-area">
            <div class="message-bubble user-bubble">
              <p>{message.content}</p>
              </div>

              <button
                class="message-copy-btn"
                title="Copy message"
                on:click={() => copyMessage(message.content)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          {:else if message.role === 'assistant'}
            <div class="message-content-area">
              <div class="message-bubble assistant-bubble" style={message.isStreaming ? `min-height: ${message.content ? '48px' : '32px'}; transition: min-height 0.3s;` : ''}>
                <div class="markdown-container" bind:this={markdownContainers[message.id]}>
                  <Markdown content={message.content} on:rendered={() => {
                    highlightCodeBlocks(markdownContainers[message.id]);
                    if (message.isStreaming) {
                      setupStreamingCodeHighlighter(markdownContainers[message.id], message.id);
                    }
                  }} />
                  <!-- Always render a cursor placeholder to prevent layout shift -->
                  <span class="cursor-placeholder">
                    {#if message.isStreaming}
                      <span class="animated-cursor cursor-fade" style="opacity:1;">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="9" cy="9" r="6" fill="#6355FF">
                            <animate attributeName="r" values="6;8;6" dur="1s" repeatCount="indefinite" />
                            <animate attributeName="opacity" values="1;0.7;1" dur="1s" repeatCount="indefinite" />
                          </circle>
                        </svg>
                      </span>
                    {:else}
                      <span class="animated-cursor cursor-fade" style="opacity:0; pointer-events:none;">
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="9" cy="9" r="6" fill="#6355FF" opacity="0" />
                        </svg>
                      </span>
                    {/if}
                  </span>
                </div>
                <div class="assistant-message-footer">
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
              </div>
              {#if !message.isLoading && message.content && !message.error}
                <button
                  class="message-copy-btn"
                  title="Copy response"
                  on:click={() => copyMessage(message.content)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </button>
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



  #main{
    height: 100%;
    max-height: 100vh;
    overflow: hidden;
    position: relative; // Added for positioning the refresh button
  }

  .global-refresh-button {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 1000; // Ensure it's above other content
    padding: 8px;
    width: 36px;
    height: 36px;
    border-radius: 50%; // Make it circular
    border: none;
    background-color: rgba(#6355FF, 1); // Darker, semi-transparent
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: .2s ease;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);

    svg {
      height: 16px; // Slightly larger icon
      width: 16px;
    }

    &:hover {
      background-color: #4938fb;
      transform: scale(1.03);
    }
    &:disabled {
      background-color: rgba(50, 50, 50, 0.5);
      cursor: not-allowed;
      transform: scale(1);
    }
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
    img{
      height: 160px;
    }
    h2 {
      font-family: "ivypresto-headline", 'Newsreader', serif;
      font-size: 64px; // Slightly smaller
      font-weight: 500;
      letter-spacing: -.4px;
      margin: -8px 0 8px 0;
      color: #fff;
    }
    p {
      font-size: 15px;
      color: rgba(white, .4);
      margin: 0;
    }
  }

  .example-prompts {
    margin-bottom: 32px;
    width: 100%;
    max-width: 720px;

    .prompts-label {
      text-align: center;
      font-size: 16px;
      color: rgba(#00106D, .6);
      margin-bottom: 16px;
      font-weight: 500;
    }

    .prompts-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;

      @media (max-width: 768px) {
        grid-template-columns: 1fr;
        gap: 10px;
      }
    }

    .prompt-card {
      background: rgba(white, .95);
      background: rgba(#6355FF, .08);
      border-radius: 12px;
      padding: 12px 16px;
      cursor: pointer;
      width: fit-content;
      transition: all 0.2s cubic-bezier(0.4,0,0.2,1);

      &:hover{
        background: rgba(#6355FF, .12);
      }


      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }

      .prompt-text {
        font-family: "ivypresto-headline", sans-serif;
        font-size: 15px;
        font-weight: 500;
        letter-spacing: .5px;
        color: #00106D;
        text-shadow: -.4px 0 0 #00106D;
        line-height: 140%;
        display: block;
        text-align: left;
      }
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

  .row{
    display: flex;
    justify-content: space-between;
    align-items: center;
  }


  /* Regular chat styles */
  #image-chat-page { // Consider renaming ID to #text-chat-page if it causes confusion
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: 100vh;
    width: 100%;
    max-width: 100vw;
    margin: auto;
    overflow: hidden;
    color: #f0f0f0;
    box-sizing: border-box;
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
    height: 100%;
    max-height: 100vh;
    // Adjusted padding: top, sides, bottom (to clear fixed Omnibar)
    padding: 16px 24px calc(80px + 24px + 20px) 24px; // 80px omnibar + 24px bottom offset + 20px buffer

    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
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
    flex-grow: 0;
    margin: 0 auto; // Centers the content column

    &.user {
      margin: 12px auto;
      .message-content-area{
        justify-content: flex-end;
      }
    }

    &.assistant {
      margin-right: auto;
    }
  }

  .message-content-area {
    display: flex;
    align-items: flex-start;
    width: 100%;
    gap: 8px;
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
      background-color: rgba(black, .5);
      box-shadow: inset 1px 1px 2px rgba(white, .02), -4px 8px 16px rgba(black,0.2);
      color: rgba(white, .9);
      font-family: "ivypresto-headline", 'Newsreader', serif;
      font-size: 16px; // User prompt slightly larger
      font-weight: 500;
      letter-spacing: .4px;
      position: relative; // For absolute positioning of copy button
      padding: 12px 18px 14px 18px;

      color: #ddd;
      text-shadow: -.25px 0px 0px #ddd;
    }

    &.assistant-bubble {
      font-family: "Inter", sans-serif;
      font-size: 16px;
      font-weight: 450;
      color: #e0e0e0;
      width: fit-content; // Bubble fits content
      max-width: 100%;
      margin: 10px 0 0 0; // Adjusted margin
      filter: drop-shadow(-1px 4px 8px rgba(black, .6));
      flex: 1;

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

  .assistant-message-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
  }

  .assistant-model-info {
    font-size: 0.75em;
    color: rgba(white, 0.4);
    margin-top: 0;
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

  .message-copy-btn {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: color 0.2s, background-color 0.2s;
    margin-left: 8px;
    align-self: flex-start;
    margin-top: 10px;

      &:hover {
      color: white;
      background-color: rgba(255, 255, 255, 0.1);
    }

    svg {
      width: 14px;
      height: 14px;
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
      margin: 12px 0;
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
      background-color: rgba(black, .5); /* Darker code block */
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: monospace;
      font-size: 13px;
    }
    :global(pre) {
      background-color: rgba(black, .25); /* Darker pre block */
      padding: 38px 24px 20px 24px; /* Added top padding for header */
      border-radius: 12px;
      margin: 24px 0;
      box-shadow: -8px 16px 32px rgba(black, .1);
      overflow-x: auto;
      position: relative; /* Ensure position relative for absolute positioning of header */
    }
    :global(pre code) {
      padding: 0;
      background-color: transparent;
      font-size: 13px;
    line-height: 1.5;
    }

    /* Prism.js token styling overrides to match our theme better */
    :global(.token.comment),
    :global(.token.prolog),
    :global(.token.doctype),
    :global(.token.cdata) {
      color: #6a9955;
    }

    :global(.token.punctuation) {
      color: #d4d4d4;
    }

    :global(.token.property),
    :global(.token.tag),
    :global(.token.boolean),
    :global(.token.number),
    :global(.token.constant),
    :global(.token.symbol) {
      color: #b5cea8;
    }

    :global(.token.selector),
    :global(.token.string),
    :global(.token.char),
    :global(.token.builtin) {
      color: #ce9178;
    }

    :global(.token.inserted) {
      background-color: rgba(156, 204, 101, 0.1);
    }

    :global(.token.deleted) {
      background-color: rgba(255, 0, 0, 0.1);
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

    :global(.code-header) {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
    display: flex;
    justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      background-color: rgba(0, 0, 0, 0.4);
      border-top-left-radius: 12px;
      border-top-right-radius: 12px;
      font-family: 'Inter', sans-serif;
      font-size: 12px;
    }

    :global(.code-language) {
      color: rgba(255, 255, 255, 0.7);
      text-transform: uppercase;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    :global(.code-copy-btn) {
      background: transparent;
    border: none;
      color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
      padding: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
      transition: color 0.2s, background-color 0.2s;
      border-radius: 4px;
    }

    :global(.code-copy-btn:hover) {
      color: white;
      background-color: rgba(255, 255, 255, 0.1);
    }

    :global(.code-copy-btn svg) {
      width: 16px;
      height: 16px;
    }
  }

  .streaming-cursor {
    display: inline-block;
    animation: blink 1s step-end infinite;
    vertical-align: middle;
    line-height: 1;
    margin-left: 1px;
    height: 1em;
    position: relative;
    top: 0;
  }

  .cursor-placeholder {
    display: inline-block;
    width: 18px;
    height: 18px;
    vertical-align: middle;
    margin-left: 2px;
    margin-bottom: 2px;
    transition: opacity 0.25s cubic-bezier(0.4,0,0.2,1);
  }
  .animated-cursor.cursor-fade {
    display: inline-block;
    width: 18px;
    height: 18px;
    vertical-align: middle;
    transition: opacity 0.25s cubic-bezier(0.4,0,0.2,1);
  }

  .stan{
    background: rgba(white, 1);
    color: #00106D;
    border-radius: 8px;

    position: fixed !important;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1000;


    :global(p), :global(h1), :global(h2), :global(h3), :global(h4), :global(h5), :global(h6), :global(li), :global(ol), :global(ul), :global(strong), :global(em){
      color: #081249;
    }

    .message-bubble{

    :global(p){
      font-weight: 500;
      font-size: 15px;
      line-height: 150%;
      text-shadow: -.15px 0 0 #081249;
    }

    :global(h1){
      font-size: 32px;
      text-shadow: -1px 0 0 #081249;
      letter-spacing: .5px;
      margin: 24px 0;
    }

    :global(h2){
      font-size: 24px;
      text-shadow: -.5px 0 0 #081249;
      letter-spacing: .25px;
      margin: 18px 0;
    }

    :global(h3){
      font-family: "ivypresto-headline", serif;
      font-size: 20px;
      text-shadow: -.5px 0 0 #081249;
      letter-spacing: .25px;
      margin: 16px 0 10px 0;
    }

    :global(h4), :global(h5), :global(h6){
      font-family: "Hedvig Letters Serif", serif;
      font-size: 15px;
      text-shadow: -.25px 0 0 #081249;
      letter-spacing: -.4px;
      margin: 8px 0;
    }
  }

    :global(::selection){
      background: #ffee7d;
      color: black;
    }

    .message-wrapper{
      margin: 0 auto;
    }

    .message-bubble{
      filter: none;
      box-shadow: none;
      &.user-bubble{
        box-shadow: none;
        background: linear-gradient(to bottom, #6355FF 50%, #5040ff);
        padding: 11px 18px 12px 18px;
        border-radius: 18px 18px 4px 18px;
        box-shadow: inset -1px -2px 8px rgba(black, .15), inset 1px 2px 8px rgba(white, .15), -2px 4px 12px rgba(#00106D, .2);
        p{
          color: white;
          font-size: 16px;
          text-shadow: -.5px 0 0 white;
          letter-spacing: .6px;
          filter: drop-shadow(-4px 4px 4px rgba(black, .25));
        }

      }
      &.assistant-bubble{
        filter: none;
        font-family: "Hedvig Letters Serif", serif;

        color: #00106D !important;
      }
    }

    .assistant-model-info{
      color: rgba(black, .4);
      padding: 4px 10px;
      border-radius: 24px;
      margin-top: 12px;
      background: rgba(white, .5);
      display: none;
    }

    :global(.omnibar){
      width: 720px !important;
      left: calc(50% - 360px) !important;

      @media screen and (max-width: 800px) {
        width: calc(100vw - 24px) !important;
        left: 12px !important;
        bottom: 12px;
      }
    }

    :global(.input-form){
      background: rgba(white, .95);
      box-shadow: -12px 24px 48px rgba(#00106D, .25);
      border: 1.5px solid #6355FF;

    }
    :global(textarea){
      color: #00106D !important;
      text-shadow: -.5px 0 0 #00106D !important;
    }
    :global(.submit-button-omnibar){
      background: #6355FF;
      color: white;
      border-radius: 24px;
      padding: 8px 12px;
      box-shadow: inset -1px -2px 4px rgba(black, .08), inset 1px 2px 4px rgba(white, .15), -2px 4px 8px rgba(#030025, .1);
    }
    :global(.submit-button-omnibar:hover){
      background: #4e41dd !important;
    }
    :global(select){
      background: rgba(#6355FF, .1) !important;
      color: black !important;
    }

  }



  @media screen and (max-width: 800px) {
    #main{
      border-radius: 0;
    }

    .chat-messages-container{
      padding: 0 !important;
      margin: 0 auto !important;
    }

    .message-wrapper{
      margin: 0 !important;
      padding: 0;
      width: 100% !important;
      border: 1px solid red;
    }
  }


</style>