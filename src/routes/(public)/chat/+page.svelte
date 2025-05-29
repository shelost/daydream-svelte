<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { scale, fly, fade } from 'svelte/transition';
  import { cubicOut, elasticOut } from 'svelte/easing';
  import Omnibar from '$lib/components/Omnibar.svelte';
  import { Markdown } from 'svelte-rune-markdown';
  import { fetchAndLog } from '$lib/utils/fetchAndLog';

  // Import Prism.js for syntax highlighting - make it conditional for production builds
  let Prism: any = null;
  let PrismLoaded: boolean = false;

  interface AnimatedWord {
    id: string;
    text: string;
    addedTime: number;
    currentOpacity: number;
  }

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    rawContent?: string;
    isLoading?: boolean;
    isStreaming?: boolean;
    modelUsed?: string;
    error?: string;
    animatedWords?: AnimatedWord[];
    _lastProcessedContentLength?: number;
    _previousContent?: string;
  }

  let messages: Message[] = [];
  let omnibarPrompt: string = '';
  let isOverallLoading: boolean = false;
  let currentSelectedTextModel: string = 'claude-3-7-sonnet-20250219';
  let currentAbortController: AbortController | null = null;
  let currentFollowUpQuestions: string[] = [];

  // Browser automation state with live view URL
  let browserSessionId: string | null = null;
  let browserScreenshot: string | null = null;
  let browserLiveViewUrl: string | null = null; // Live view URL for real-time browser display
  let isBrowserLoading: boolean = false;
  let browserUrl: string = 'https://google.com';
  let showBrowserViewport: boolean = true;

  // Browser auto-initialization function
  async function initializeBrowser() {
    if (browserSessionId) return;

    console.log('🚀 Auto-initializing browser session and navigating to LinkedIn...');
    isBrowserLoading = true;
    showBrowserViewport = true; // Show viewport during loading

    try {
      const response = await fetch('/api/browserbase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'go to https://linkedin.com',
          chatId: 'auto-init-' + generateUniqueId()
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Browser auto-initialized and navigated to LinkedIn:', result);

        // Extract session ID and live view URL
        if (result.sessionId) {
          browserSessionId = result.sessionId;
        }

        if (result.liveViewUrl) {
          browserLiveViewUrl = result.liveViewUrl;
          console.log('🔗 Browser live view URL obtained:', browserLiveViewUrl);
        }

        // Extract screenshot if available from results
        if (result.results && result.results.length > 0) {
          const screenshotResult = result.results.find(r => r.data && r.data.screenshot);
          if (screenshotResult) {
            browserScreenshot = screenshotResult.data.screenshot;
            console.log('📸 Browser screenshot obtained');
          }
        }

        console.log('🎉 Browser viewport should now be visible with LinkedIn loaded');
      } else {
        console.error('❌ Browser initialization failed:', await response.text());
      }
    } catch (error) {
      console.error('❌ Browser auto-initialization failed:', error);
    } finally {
      isBrowserLoading = false;
    }
  }

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
  let isInitialized = false;
  let isStartState = true;
  const SESSION_STORAGE_KEY = 'textChatMessages';

  const generateUniqueId = () => `_${Math.random().toString(36).substring(2, 11)}`;

  let lastUserEditTime = 0;
  let pendingAnalysis = false;
  let markdownContainers = new Map();

  // Animation constants
  const WORD_FADE_DURATION = 800;
  const WORD_STAGGER_DELAY = 100;
  const INITIAL_WORD_OPACITY = 0.0;
  const FINAL_WORD_OPACITY = 1.0;

  // Functions for syntax highlighting and other utilities
  async function highlightCodeBlocks(element) {
    if (!element) return;

    const codeBlocks = element.querySelectorAll('pre code:not(.highlighted)');
    if (codeBlocks.length > 0) {
      await tick();
      codeBlocks.forEach(codeBlock => {
        addHeaderAndHighlight(codeBlock);
      });
    }
  }

  function addHeaderAndHighlight(codeBlock) {
    if (!codeBlock || codeBlock.classList.contains('highlighted')) return;

    codeBlock.classList.add('highlighted');

    let language = 'markup';
    const langClass = Array.from(codeBlock.classList).find(cls => typeof cls === 'string' && cls.startsWith('language-'));
    if (langClass && typeof langClass === 'string') {
      language = langClass.substring(9);
    } else {
      codeBlock.classList.add('language-markup');
    }

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
        copyWithFeedback(copyBtn, codeBlock.textContent || '');
      });
      header.appendChild(copyBtn);

      pre.insertBefore(header, codeBlock);
      pre.style.position = 'relative';
    }

    if (PrismLoaded && Prism && typeof Prism.highlightElement === 'function') {
      Prism.highlightElement(codeBlock);
    }
  }

  function copyWithFeedback(button, content) {
    navigator.clipboard.writeText(content);
    const originalHTML = button.innerHTML;
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';
    setTimeout(() => {
      button.innerHTML = originalHTML;
    }, 2000);
  }

  // Simplified chat functions
  function copyMessage(content, button) {
    copyWithFeedback(button, content || '');
  }

  async function scrollToBottom() {
    await tick();
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  // Browser session cleanup function
  async function closeBrowserSession() {
    if (!browserSessionId) return;

    console.log('🔄 Closing browser session:', browserSessionId);

    try {
      const response = await fetch('/api/browserbase', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: browserSessionId
        })
      });

      if (response.ok) {
        console.log('✅ Browser session closed successfully');
      } else {
        console.warn('⚠️ Failed to close browser session:', await response.text());
      }
    } catch (error) {
      console.warn('⚠️ Error closing browser session:', error);
    } finally {
      // Reset browser state regardless of API success
      browserSessionId = null;
      browserLiveViewUrl = null;
      browserScreenshot = null;
      showBrowserViewport = false;
    }
  }

  function handleClearChat() {
    if (isOverallLoading) return;

    messages = [
      {
        id: generateUniqueId(),
        role: 'assistant',
        content: "Hi there! I'm your friendly chat assistant with browser automation capabilities. The live browser window is loading LinkedIn automatically. You can interact directly with the browser or try commands like 'take a screenshot', 'go to google.com', or ask me anything!"
      }
    ];
    isStartState = true;
    omnibarPrompt = '';
    isOverallLoading = false;
    currentFollowUpQuestions = [];
  }

  async function clearChatAndStorage() {
    if (isOverallLoading) return;

    // Close browser session first
    await closeBrowserSession();

    handleClearChat();
    const browser = typeof window !== 'undefined';
    if (browser) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      console.log('Chat history cleared from sessionStorage.');
    }
  }

  function handleStop() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    isOverallLoading = false;

    messages = messages.map(msg => {
      if (msg.isStreaming || msg.isLoading) {
        return {
          ...msg,
          isLoading: false,
          isStreaming: false,
          content: msg.content || "Generation stopped by user.",
          error: undefined
        };
      }
      return msg;
    });
  }

  // Main omnibar submit function with browser automation
  async function handleOmnibarSubmit() {
    const currentPrompt = omnibarPrompt.trim();
    if (!currentPrompt || isOverallLoading) return;

    currentAbortController = new AbortController();

    if (isStartState) {
      isStartState = false;
    }

    isOverallLoading = true;
    const userMessageId = generateUniqueId();
    messages = [...messages, { id: userMessageId, role: 'user', content: currentPrompt }];
    omnibarPrompt = '';

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

    try {
      // First, check if this is a browser automation command
      console.log('🔍 Checking browser command for:', currentPrompt);
      const browserResponse = await fetch('/api/browserbase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentPrompt,
          chatId: userMessageId
        }),
          signal: currentAbortController?.signal
      });

      console.log('🌐 Browser response status:', browserResponse.status);
      if (browserResponse.ok) {
        const browserResult = await browserResponse.json();
        console.log('🤖 Browser result:', browserResult);

        if (browserResult.isBrowserCommand) {
          let responseContent = `${browserResult.message}\n\n`;

          if (browserResult.results && browserResult.results.length > 0) {
            responseContent += `**Actions performed:**\n`;
            browserResult.results.forEach((result, index) => {
              if (result.success) {
                responseContent += `✅ ${browserResult.actions[index]}\n`;
        } else {
                responseContent += `❌ ${browserResult.actions[index]}: ${result.error}\n`;
              }
            });

            // Update floating browser viewport with latest screenshot/live view
            const screenshotResult = browserResult.results.find(r => r.data && r.data.screenshot);
            if (screenshotResult) {
              browserScreenshot = screenshotResult.data.screenshot;
              responseContent += `\n**Current page:**\n![Screenshot](data:image/png;base64,${screenshotResult.data.screenshot})`;
            }

            // Extract live view URL if available
            if (browserResult.liveViewUrl) {
              browserLiveViewUrl = browserResult.liveViewUrl;
              console.log('🔗 Browser live view URL updated:', browserLiveViewUrl);
            }
          }

          messages = messages.map(msg =>
            msg.id === assistantMessageId
              ? {
                ...msg,
                  content: responseContent,
                  isLoading: false,
            isStreaming: false,
                  modelUsed: 'Browser Automation'
                }
              : msg
          );

          isOverallLoading = false;
          currentAbortController = null;
          return;
        }
      }

      // Not a browser command, proceed with normal AI chat (simplified for brevity)
      let responseContent = `I can help with both chat and browser automation. Try commands like:
- "open linkedin"
- "go to google.com"
- "take a screenshot"
- "click on login button"

The live browser window will show real-time updates!`;

          messages = messages.map(msg =>
            msg.id === assistantMessageId
          ? {
              ...msg,
              content: responseContent,
              isLoading: false,
              isStreaming: false,
              modelUsed: 'Assistant'
            }
              : msg
          );

    } catch (error: any) {
      console.error('Error:', error);

      if (error.name === 'AbortError') {
        console.log('Request was aborted by user');
        return;
      }

      messages = messages.map(msg =>
        msg.id === assistantMessageId
          ? {
              ...msg,
              isLoading: false,
              isStreaming: false,
              error: error.message || 'Unknown error',
              content: `Error: ${error.message || 'Failed to get response.'}`,
            }
          : msg
      );
    } finally {
        isOverallLoading = false;
        currentAbortController = null;
    }
  }

  function handleFollowUpClick(question: string) {
    if (isOverallLoading) return;
    omnibarPrompt = question;
    currentFollowUpQuestions = [];
    handleOmnibarSubmit();
  }

  function handleExamplePrompt(promptText: string) {
    if (isOverallLoading) return;
    omnibarPrompt = promptText;
    handleOmnibarSubmit();
  }

  onMount(() => {
    const browser = typeof window !== 'undefined';
    if (browser) {
      // Auto-initialize browser session
      initializeBrowser();

      // Initialize with default message
            messages = [
                {
                    id: generateUniqueId(),
                    role: 'assistant',
          content: "Hi there! I'm your friendly chat assistant with browser automation capabilities. The live browser window is loading LinkedIn automatically. You can interact directly with the browser or try commands like 'take a screenshot', 'go to google.com', or ask me anything!"
                }
            ];
            isStartState = true;
        isInitialized = true;
        scrollToBottom();

      // Add event listeners for session cleanup
      const handleBeforeUnload = (event) => {
        // Attempt to close the session - this might be blocked by browser
        if (browserSessionId) {
          console.log('🔄 Page unloading - attempting to close browser session');
          closeBrowserSession();
        }
      };

      const handleUnload = () => {
        // Final attempt to close session using sendBeacon with DELETE method
        if (browserSessionId) {
          console.log('🔄 Page unloaded - final cleanup attempt');
          // Use fetch with keepalive for more reliable cleanup on page unload
          try {
            fetch('/api/browserbase', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: browserSessionId }),
              keepalive: true
            }).catch(() => {
              // Ignore errors in unload handler
              console.log('🔄 Cleanup request sent (best effort)');
            });
          } catch (error) {
            console.log('🔄 Cleanup attempt failed, session may timeout naturally');
          }
        }
      };

      // Add event listeners (visibilitychange removed to prevent premature cleanup)
      window.addEventListener('beforeunload', handleBeforeUnload);
      window.addEventListener('unload', handleUnload);

      // Cleanup function
      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        window.removeEventListener('unload', handleUnload);

        // Final cleanup
        if (browserSessionId) {
          closeBrowserSession();
        }
      };
    }
  });

  // Reactive statement for saving messages
  $: {
    const browser = typeof window !== 'undefined';
    if (browser && isInitialized && messages) {
        try {
            const messagesToSave = messages.map(msg => {
                const { isLoading, isStreaming, ...rest } = msg;
                    return rest;
            });
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(messagesToSave));
            scrollToBottom();
        } catch (e) {
        console.error('Failed to save chat history to sessionStorage:', e);
      }
    }
  }
</script>

<svelte:head>
  <title>Chat</title>
</svelte:head>

<div id="main" class="stan" in:scale={{ duration: 300, start: 0.95, opacity: 0, easing: cubicOut }}>
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
    <div id="start-state-container">
    <div class="welcome-header" in:fade={{ delay: 300, duration: 500 }}>
        <img src="/opal.png" alt="Chat" class="stan-avatar">
        <h2>Chat with Browser</h2>
    </div>

    <!-- Example Prompts Section -->
    <div class="example-prompts" in:fade={{ delay: 500, duration: 500 }}>
      <div class="carousel-container">
        <div class="carousel-track carousel-left-to-right">
          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("open linkedin")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">open linkedin</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("go to google.com")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">go to google.com</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("take a screenshot")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">take a screenshot</span>
          </button>

            <!-- Duplicates for seamless loop -->
          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("open linkedin")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">open linkedin</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("go to google.com")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">go to google.com</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("take a screenshot")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">take a screenshot</span>
          </button>
        </div>

        <div class="carousel-gradient carousel-gradient-left"></div>
        <div class="carousel-gradient carousel-gradient-right"></div>
      </div>
    </div>

     <Omnibar
        settingType="text"
        bind:additionalContext={omnibarPrompt}
        bind:currentSelectedModel={currentSelectedTextModel}
        imageModels={[]}
        isGenerating={isOverallLoading}
        onSubmit={handleOmnibarSubmit}
        onStop={handleStop}
        followUpQuestions={currentFollowUpQuestions}
        onFollowUpClick={handleFollowUpClick}
        parentDisabled={false}
      />
  </div>
{:else}
    <div id="chat-page" in:fade={{ duration: 300 }}>
    <div class="chat-messages-container" bind:this={chatContainer} in:fade={{ duration: 250, delay: 100 }}>
      {#each messages as message (message.id)}
          <div class="message-wrapper {message.role}" in:fly={{ y: message.role === 'user' ? 10 : -10, duration: 300, delay: 150 }}>
          {#if message.role === 'user'}
            <div class="message-content-area">
              <div class="message-bubble user-bubble">
                <p>{message.content}</p>
              </div>
              <button
                class="message-copy-btn"
                title="Copy message"
                on:click={(event) => copyMessage(message.content, event.currentTarget)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          {:else if message.role === 'assistant'}
            <div class="message-content-area">
              <div class="message-bubble assistant-bubble" style={message.isStreaming ? `min-height: 32px; transition: min-height 0.3s;` : ''}>
                <div class="markdown-container animated-text-container" bind:this={markdownContainers[message.id]}>
                    <Markdown content={message.content} />
                    {#if message.isLoading}
                      <span class="thinking-text">
                        <div class="loader"></div>
                        <span>Thinking...</span>
                      </span>
                    {/if}
                </div>
                <div class="assistant-message-footer">
                  {#if message.modelUsed && !message.isStreaming && !message.isLoading}
                    <div class="assistant-model-info">
                      Sent by {getModelLabel(message.modelUsed)}
                    </div>
                  {/if}
                  {#if message.error}
                    <div class="error-placeholder" style="min-height: auto; padding: 5px 0; text-align: left;">
                      <span style="font-size: 0.9em; color: #ff8a8a;">Error: {message.error}</span>
                    </div>
                  {/if}
                </div>
              </div>
              <button
                class="message-copy-btn"
                title="Copy response"
                style="opacity: {message.isLoading || message.isStreaming || message.error ? '0' : '1'}; transition: opacity 0.3s ease;"
                on:click={(event) => copyMessage(message.content, event.currentTarget)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
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
      onStop={handleStop}
      followUpQuestions={currentFollowUpQuestions}
      onFollowUpClick={handleFollowUpClick}
      parentDisabled={false}
    />
    </div>
  {/if}

  <!-- Live Browser Viewport -->
  {#if showBrowserViewport && (browserLiveViewUrl || browserScreenshot || isBrowserLoading)}
    <div class="browser-viewport" in:fade={{ duration: 300 }}>
      <div class="browser-header">
        <div class="browser-controls">
          <div class="browser-dot red"></div>
          <div class="browser-dot yellow"></div>
          <div class="browser-dot green"></div>
        </div>
        <div class="browser-title">
          {#if browserLiveViewUrl}
            Live Browser Session
          {:else if browserScreenshot}
            Browser Screenshot
          {:else}
            Browser Loading...
          {/if}
        </div>
        <button
          class="browser-close"
          on:click={async () => {
            await closeBrowserSession();
            showBrowserViewport = false;
          }}
          title="Close browser viewport"
        >
          ×
        </button>
      </div>
      <div class="browser-content">
        {#if isBrowserLoading}
          <div class="browser-loading">
            <div class="loader"></div>
            <p>Initializing browser session...</p>
          </div>
        {:else if browserLiveViewUrl}
          <!-- Live browser view using iframe with proper Browserbase configuration -->
          <iframe
            src={browserLiveViewUrl}
            class="browser-iframe"
            title="Live Browser Session"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"
            allow="clipboard-read; clipboard-write; camera; microphone"
            loading="lazy"
          ></iframe>
          <div class="live-indicator">
            <div class="live-dot"></div>
            <span>LIVE</span>
          </div>
        {:else if browserScreenshot}
          <!-- Fallback to screenshot if live view not available -->
          <div class="screenshot-container">
            <img
              src="data:image/png;base64,{browserScreenshot}"
              alt="Browser screenshot"
              class="browser-screenshot"
            />
            <div class="screenshot-overlay">
              <p>Screenshot View</p>
              <small>Live view not available</small>
            </div>
          </div>
        {:else}
          <div class="browser-placeholder">
            <p>No browser session active</p>
            <small>Send a browser command to start</small>
          </div>
        {/if}
      </div>
  </div>
{/if}
</div>

<style lang="scss">
  .loader {
    width: 17px;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--highlight);
    display: grid;
    animation: l22-0 2s infinite linear;
  }
  .loader:before,
  .loader:after {
    content: "";
    grid-area: 1/1;
    margin: 15%;
    border-radius: 50%;
    background: inherit;
    transform: rotate(0deg) translate(150%);
    animation: l22 1s infinite;
  }
  .loader:after {
    animation-delay: -.5s
  }
  @keyframes l22-0 {
    100% {transform: rotate(1turn)}
  }
  @keyframes l22 {
    100% {transform: rotate(1turn) translate(150%)}
  }

  #main {
    height: 100%;
    max-height: 100vh;
    overflow: auto;
    position: relative;
    touch-action: pan-y pan-x;
    -webkit-overflow-scrolling: touch;
  }

  .global-refresh-button {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 1000;
    padding: 8px;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background-color: rgba(#6355FF, 1);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: .2s ease;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
    touch-action: manipulation;

    svg {
      height: 16px;
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

  #start-state-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px;
    width: 100%;
    height: 90vh;
    max-width: 100vw;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    touch-action: pan-y;
  }

  .welcome-header {
    text-align: center;
    margin-bottom: 20px;

    img {
      height: 140px;
      filter: drop-shadow(-8px 16px 24px rgba(#030025, 0.1));
    }

    h2 {
      font-family: "ivypresto-headline", 'Newsreader', serif;
      font-size: 64px;
      font-weight: 500;
      letter-spacing: -.4px;
      margin: 4px 0 8px 0;
      color: #030025;
    }
  }

  .example-prompts {
    margin-bottom: 32px;
    margin-top: 16px;
    width: 100%;
    max-width: 720px;
    display: flex;
    flex-direction: column;
    gap: 0px;

    .carousel-container {
      position: relative;
      width: 100%;
      overflow: hidden;
      height: 60px;
      touch-action: pan-y;
    }

    .carousel-track {
      display: flex;
      gap: 16px;
      padding: 4px 0;
      width: fit-content;
      animation-duration: 40s;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
      will-change: transform;
      touch-action: pan-y;

      &.carousel-left-to-right {
        animation-name: scrollLeftToRight;
      }

      &:hover {
        animation-play-state: paused;
      }
    }

    @keyframes scrollLeftToRight {
      0% {
        transform: translateX(-50%);
      }
      100% {
        transform: translateX(0%);
      }
    }

    .carousel-gradient {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 80px;
      pointer-events: none;
      z-index: 2;

      &.carousel-gradient-left {
        left: 0;
        background: linear-gradient(to right, rgba(white, 1) 0%, rgba(white, 0.8) 50%, rgba(white, 0) 100%);
      }

      &.carousel-gradient-right {
        right: 0;
        background: linear-gradient(to left, rgba(white, 1) 0%, rgba(white, 0.8) 50%, rgba(white, 0) 100%);
      }
    }


    .prompt-card {
      background: #f1f5ff;
      border-radius: 12px;
      padding: 10px 18px;
      cursor: pointer;
      width: fit-content;
      min-width: 100px; // Ensure consistent card sizes
      transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
      flex-shrink: 0; // Prevent cards from shrinking
      border: 1.5px solid transparent;


      &:hover{
        background: rgba(#4a6bfd, .15);
        //border-color: rgba(#6355FF, .2);
        transform: translateY(-1px);
      }


      &:active {
        transform: translateY(0);
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
        color: #3f4d9c;
        text-shadow: -.5px 0 0 #00106D;
        line-height: 140%;
        display: block;
        text-align: left;
      }


    }


    @media (max-width: 800px) {
      .carousel-track {
        animation-duration: 25s;
        height: 100%;
      }


      .carousel-container{
        height: 90px;
      }


      .carousel-gradient {
        width: 60px; // Smaller gradients on mobile
      }


      .prompt-card {
        width: 160px;
        padding: 12px 16px;
        margin: 0;


        .prompt-text {
          width: 100%;
          text-wrap: wrap;
          line-height: 120%;
        }
      }
    }


    // Hide second row of prompts when screen height is less than 500px
    @media (max-height: 720px) {
      .carousel-container{
        margin-bottom: 24px;
      }
      .second {
        display: none;
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
    padding: 16px 24px 180px 24px; // 80px omnibar + 24px bottom offset + 20px buffer


    // Critical mobile scrolling properties
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
    // Prevent scrolling issues on some devices
    transform: translateZ(0);
    // Enable hardware acceleration
    will-change: scroll-position;


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
        justify-content: flex-start;
        align-items: center;
        gap: 12px;
      }
    }


    &.assistant {
      margin-right: auto;
      .message-content-area{
        flex-direction: column;
      }
      .message-copy-btn{
        margin-top: -48px !important;
        margin-left: 12px;
      }
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
      background-color: rgba(black, .05);
     // box-shadow: inset 1px 1px 2px rgba(white, .02), -4px 8px 16px rgba(black,0.2);
      font-family: "ivypresto-headline", 'Newsreader', serif;
      text-shadow: -.4px 0 0 #030025;
      font-size: 16px; // User prompt slightly larger
      font-weight: 500;
      letter-spacing: .5px;
      position: relative; // For absolute positioning of copy button
      padding: 12px 18px 14px 18px;
      color: #030025;
    }


    &.assistant-bubble {
      font-family: "Inter", sans-serif;
      font-size: 16px;
      font-weight: 450;
      color: #e0e0e0;
      width: 100%;
      margin: 10px 0 0 0; // Adjusted margin
      flex: 1;


      // Adjust for markdown container
      .markdown-container {
        margin-bottom: 0; // No margin needed within bubble
        padding: 0;


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


      &:hover {
      color: white;
      background-color: rgba(255, 255, 255, 0.1);
    }


    svg {
      width: 14px;
      height: 14px;
    }
  }


 @keyframes fadeIn {
   from { opacity: 0; }
   to   { opacity: 1; }
 }




  // Add markdown container styling from ResultNode.svelte
  .markdown-container {
    width: 100%;
    margin-bottom: 8px; /* Space below text if multiple items */
    color: rgba(#030025,1);


    // Add this to ensure the container has a block layout even when only spans are inside
    &.animated-text-container {
      display: block;
    }


    :global(p), :global(ul), :global(ol), :global(h5), :global(h6) {
      font-size: 14px;
      font-weight: 500;
      line-height: 1.5;
      letter-spacing: -.25px;
      color: rgba(#030025, 1);
      margin: 12px 0;
      font-family: "Hedvig Letters Serif", serif;
    }


    :global(h1){
      font-family: "ivypresto-headline", serif;
      font-size: 28px;
      font-weight: 500;
      letter-spacing: .3px;
      line-height: 1.1;
      text-shadow: -.5px 0 0 #030025;
      margin: 32px 0 18px 0;
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
      color: #030025;
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


    :global(pre) {
      width: 100%;
      background-color: rgba(#030025, 1); /* Darker pre block */
      padding: 38px 24px 20px 24px; /* Added top padding for header */
      border-radius: 12px;
      margin: 32px 0 40px 0;
      box-shadow: -8px 16px 32px rgba(#030025, .3);
      overflow-x: auto;
      position: relative; /* Ensure position relative for absolute positioning of header */
    }


    :global(code) {
      background-color: rgba(black, .5); /* Darker code block */
      padding: 24px;
      border-radius: 3px;
      font-family: monospace;
      font-size: 12px;
      line-height: .8 !important;
      background: none;
      width: 100%;
    }


    :global(ol), :global(ul){
      margin: 18px 0;
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
      letter-spacing: .25px;
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






    @keyframes contentPulse {
      0% {
        opacity: 0.8;
        transform: translateY(1px) scale(0.999);
        text-shadow: 0 0 12px rgba(99, 85, 255, 0.2);
      }
      50% {
        opacity: 0.9;
        transform: translateY(0.5px) scale(1.001);
        text-shadow: 0 0 6px rgba(99, 85, 255, 0.15);
      }
      100% {
        opacity: 1;
        transform: translateY(0) scale(1);
        text-shadow: none;
      }
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


    transition: opacity 0.25s cubic-bezier(0.4,0,0.2,1);
  }


  .cursor-and-thinking-container {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    vertical-align: middle;
  }


  .thinking-text {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9em;
    color: #030025;


    span {
       color: #030025;
    }
  }




  @media screen and (max-width: 800px) {
    #main{
      border-radius: 0;
      // Ensure touch scrolling works properly on mobile
      overflow-y: auto !important;
      -webkit-overflow-scrolling: touch !important;
      touch-action: pan-y !important;
      // Force hardware acceleration for smooth scrolling
      transform: translateZ(0);
      // Prevent scrolling issues
      -webkit-transform: translateZ(0);
    }


    .chat-messages-container{
      padding: 16px 12px 180px 12px !important; // Reduced side padding for mobile
      margin: 0 auto !important; // Remove top margin
      height: calc(100vh - 32px) !important; // Ensure proper height calculation
      max-height: calc(100vh - 32px) !important;
      // Force scrolling to work on mobile
      overflow-y: auto !important;
      -webkit-overflow-scrolling: touch !important;
      touch-action: pan-y !important;
      // Additional mobile fixes
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
      // Prevent any potential scrolling blocks
      position: relative;
    }


    .message-wrapper{
      margin: 12px auto !important; // Restore some margin between messages
      padding: 0;
      max-width: 100%;
      width: 95% !important; // Slightly wider for better mobile experience
      // Ensure messages don't block scrolling
      touch-action: pan-y;
    }


    // Ensure carousels work properly on mobile
    .carousel-container{
      height: 90px;
      // Keep vertical scrolling enabled
      touch-action: pan-y !important;
    }


    .carousel-track {
      animation-duration: 25s;
      height: 100%;
      // Keep vertical scrolling enabled
      touch-action: pan-y !important;
    }


    // Ensure prompt cards don't interfere with scrolling
    .prompt-card {
      width: 200px;
      padding: 12px 16px;
      margin: 0;


      // Allow parent scrolling to work
      touch-action: pan-y;


      .prompt-text {
        width: 100%;
        text-wrap: wrap;
        vertical-align: top;
        line-height: 120%;
      }
    }
  }

 /* Browser Viewport Styles */
 .browser-viewport {
   position: fixed;
   top: 20px;
   right: 20px;
   width: 400px;
   height: 300px;
   background: white;
   border-radius: 12px;
   box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
   overflow: hidden;
   z-index: 1000;

   @media screen and (max-width: 1200px) {
     width: 320px;
     height: 240px;
   }

   @media screen and (max-width: 800px) {
     position: relative;
     top: auto;
     right: auto;
     width: 100%;
     height: 250px;
     margin: 16px auto;
     max-width: 95vw;
   }
 }

 .browser-header {
   display: flex;
   align-items: center;
   justify-content: space-between;
   padding: 8px 12px;
   background: #f5f5f5;
   border-bottom: 1px solid #e0e0e0;
   height: 32px;
 }

 .browser-controls {
   display: flex;
   gap: 6px;
   align-items: center;
 }

 .browser-dot {
   width: 12px;
   height: 12px;
   border-radius: 50%;

   &.red { background: #ff5f57; }
   &.yellow { background: #ffbd2e; }
   &.green { background: #28ca42; }
 }

 .browser-title {
   flex: 1;
   text-align: center;
   font-size: 13px;
   font-weight: 500;
   color: #333;
   margin: 0 12px;
 }

 .browser-close {
   background: none;
   border: none;
   font-size: 18px;
   color: #666;
   cursor: pointer;
   width: 20px;
   height: 20px;
   display: flex;
   align-items: center;
   justify-content: center;
   border-radius: 4px;

   &:hover {
     background: #e0e0e0;
     color: #333;
   }
 }

 .browser-content {
   position: relative;
   height: calc(100% - 48px);
   overflow: hidden;
   background: #f9f9f9;
 }

 .browser-iframe {
   width: 100%;
   height: 100%;
   border: none;
   background: white;
 }

 .live-indicator {
   position: absolute;
   top: 8px;
   left: 8px;
   display: flex;
   align-items: center;
   gap: 4px;
   background: rgba(0, 0, 0, 0.8);
   color: white;
   padding: 4px 8px;
   border-radius: 12px;
   font-size: 11px;
   font-weight: 600;
   backdrop-filter: blur(4px);
   z-index: 10;
 }

 .live-dot {
   width: 6px;
   height: 6px;
   background: #ff4444;
   border-radius: 50%;
   animation: pulse 2s infinite;
 }

 @keyframes pulse {
   0%, 100% { opacity: 1; }
   50% { opacity: 0.3; }
 }

 .browser-loading {
   display: flex;
   flex-direction: column;
   align-items: center;
   justify-content: center;
   height: 100%;
   color: #666;

   p {
     margin: 8px 0 0 0;
     font-size: 14px;
   }
 }

 .screenshot-container {
   position: relative;
   height: 100%;
   overflow: hidden;
 }

 .browser-screenshot {
   width: 100%;
   height: 100%;
   object-fit: cover;
 }

 .screenshot-overlay {
   position: absolute;
   bottom: 0;
   left: 0;
   right: 0;
   background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
   color: white;
   padding: 16px 12px 8px 12px;

   p {
     margin: 0 0 2px 0;
     font-size: 12px;
     font-weight: 600;
   }

   small {
     font-size: 10px;
     opacity: 0.8;
   }
 }

 .browser-placeholder {
   display: flex;
   flex-direction: column;
   align-items: center;
   justify-content: center;
   height: 100%;
   color: #666;
   text-align: center;

   p {
     margin: 0 0 4px 0;
     font-size: 14px;
     font-weight: 500;
   }

   small {
     font-size: 12px;
     opacity: 0.7;
   }
 }

 @media screen and (max-width: 800px) {
   #main{
     border-radius: 0;
     // Ensure touch scrolling works properly on mobile
     overflow-y: auto !important;
     -webkit-overflow-scrolling: touch !important;
     touch-action: pan-y !important;
     // Force hardware acceleration for smooth scrolling
     transform: translateZ(0);
     // Prevent scrolling issues
     -webkit-transform: translateZ(0);
   }


   .chat-messages-container{
     padding: 16px 12px 180px 12px !important; // Reduced side padding for mobile
     margin: 0 auto !important; // Remove top margin
     height: calc(100vh - 32px) !important; // Ensure proper height calculation
     max-height: calc(100vh - 32px) !important;
     // Force scrolling to work on mobile
     overflow-y: auto !important;
     -webkit-overflow-scrolling: touch !important;
     touch-action: pan-y !important;
     // Additional mobile fixes
     transform: translateZ(0);
     -webkit-transform: translateZ(0);
     // Prevent any potential scrolling blocks
     position: relative;
   }


   .message-wrapper{
     margin: 12px auto !important; // Restore some margin between messages
     padding: 0;
     max-width: 100%;
     width: 95% !important; // Slightly wider for better mobile experience
     // Ensure messages don't block scrolling
     touch-action: pan-y;
   }


   // Ensure carousels work properly on mobile
   .carousel-container{
     height: 90px;
     // Keep vertical scrolling enabled
     touch-action: pan-y !important;
   }


   .carousel-track {
     animation-duration: 25s;
     height: 100%;
     // Keep vertical scrolling enabled
     touch-action: pan-y !important;
   }


   // Ensure prompt cards don't interfere with scrolling
   .prompt-card {
     width: 200px;
     padding: 12px 16px;
     margin: 0;


     // Allow parent scrolling to work
     touch-action: pan-y;


     .prompt-text {
       width: 100%;
       text-wrap: wrap;
       vertical-align: top;
       line-height: 120%;
     }
   }
 }




</style>


