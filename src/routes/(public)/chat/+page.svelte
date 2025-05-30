<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { scale, fly, fade } from 'svelte/transition';
  import { cubicOut, elasticOut } from 'svelte/easing';
  import Omnibar from '$lib/components/Omnibar.svelte';
  import { Markdown } from 'svelte-rune-markdown';
  import { fetchAndLog } from '$lib/utils/fetchAndLog';
  import Browserbase from '$lib/components/Browserbase.svelte';

  // Import Prism.js for syntax highlighting - make it conditional for production builds
  let Prism: any = null;
  let PrismLoaded: boolean = false;

  interface AnimatedWord {
    id: string;
    text: string;
    addedTime: number;
    currentOpacity: number;
  }

  // Unified event log entry
  interface EventLogEntry {
    id: string; // Unique ID for Svelte #each key
    type: 'reasoning' | 'action' | 'summary';
    description: string;
    fullDetails: any; // Store the original action/reasoning object
  }

  interface Message {
    id:string;
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
    eventLog?: EventLogEntry[]; // Unified log for reasoning and actions
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
  let isCleaningUpStaleSession: boolean = false; // New flag

  // Reactive statement to ensure loader hides once liveViewUrl is available
  $: if (browserLiveViewUrl && isBrowserLoading) {
    isBrowserLoading = false;
  }

  // Browser auto-initialization function - now split to allow waiting for cleanup
  async function initializeNewStagehandSession() {
    if (browserSessionId || isCleaningUpStaleSession) return; // Don't init if already exists or cleaning up

    console.log("🚀 Initiating new Stagehand session (e.g., navigating to linkedin.com)...");
    isBrowserLoading = !browserLiveViewUrl;
    showBrowserViewport = true;

    try {
      const response = await fetch('/api/stagehand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          initUrl: 'https://www.linkedin.com', // Direct bootstrap URL
          chatId: 'init-' + generateUniqueId(),
          stream: false
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Initial Stagehand session established:', result);
        if (result.sessionId) browserSessionId = result.sessionId;
        if (result.liveViewUrl) browserLiveViewUrl = result.liveViewUrl;
        if (result.screenshot) browserScreenshot = result.screenshot;
        showBrowserViewport = true;
      } else {
        console.warn('⚠️ Failed to establish initial Stagehand session:', response.status, await response.text());
      }
    } catch (error) {
      console.warn('⚠️ Error establishing initial Stagehand session:', error);
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
        }),
        keepalive: true // ensure request is attempted even during unload
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
      // Clean from storage so next load doesn't try to close again
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('browserSessionId');
      }
    }
  }

  // Helper to persist sessionId to sessionStorage when set
  $: if (browserSessionId) {
    const browser = typeof window !== 'undefined';
    if (browser) {
      sessionStorage.setItem('browserSessionId', browserSessionId);
    }
  }

  function handleClearChat() {
    if (isOverallLoading) return;

    messages = [
      {
        id: generateUniqueId(),
        role: 'assistant',
        content: "Hi there! I'm your AI-powered browser automation assistant. I can understand natural language commands and translate them into precise browser actions.\\n\\n**Try natural commands like:**\\n• 'find Vitalii Dodonov\'s LinkedIn profile' - I'll navigate to LinkedIn and search for the person\\n• 'go to OpenAI\'s website' - I'll understand you want openai.com\\n• 'search for AI news' - I\'ll search on the current page or find a search engine\\n• 'read the latest posts' - I\'ll extract content from the page\\n• 'take a screenshot' - I\'ll capture the current page\\n\\nI use advanced AI to understand your intent, then execute precise browser actions. The live browser window shows real-time results!"
      }
    ];
    isStartState = true;
    omnibarPrompt = '';
    isOverallLoading = false;
    currentFollowUpQuestions = [];

    // Reset browser session state
    browserSessionId = null;
    browserLiveViewUrl = null;
    browserScreenshot = null;
    showBrowserViewport = false;
    isBrowserLoading = false;

    // Remove stored session id reference as chat is cleared
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('browserSessionId');
    }
  }

  async function clearChatAndStorage() {
    if (isOverallLoading) return;

    // Close Stagehand session first
    if (browserSessionId) {
      try {
        console.log('🔄 Cleaning up Stagehand session before clearing chat...');
        const response = await fetch('/api/stagehand', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: browserSessionId }),
          keepalive: true
        });

        if (response.ok) {
          console.log('✅ Stagehand session cleaned up successfully');
        } else {
          console.warn('⚠️ Failed to clean up Stagehand session:', await response.text());
        }
      } catch (error) {
        console.warn('⚠️ Error cleaning up Stagehand session:', error);
      }
    }

    handleClearChat();
    const browser = typeof window !== 'undefined';
    if (browser) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      sessionStorage.removeItem('browserSessionId');
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

  // Utility to stream event log entries to the UI one-by-one for a simulated real-time effect
  function streamEvents(
    messageId: string,
    eventEntries: EventLogEntry[]
  ) {
    const DELAY = 700; // ms between pills
    (async () => {
      for (const event of eventEntries) {
        await new Promise((res) => setTimeout(res, DELAY));
        messages = messages.map((m) =>
          m.id === messageId
            ? { ...m, eventLog: [...(m.eventLog || []), event] }
            : m
        );
        await tick(); // Ensure Svelte updates the DOM
        scrollToBottom(); // Keep chat scrolled to the bottom
      }
    })();
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
    // Refined logic for isBrowserLoading:
    // Only set isBrowserLoading to true if we don't have a liveViewUrl.
    // Otherwise, the browser component isn't "loading", it's already live or should be.
    if (!browserLiveViewUrl) {
      isBrowserLoading = true;
    } else {
      isBrowserLoading = false;
    }
    showBrowserViewport = true; // Always attempt to show viewport when a command is submitted


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
        eventLog: [],
      isLoading: true,
        isStreaming: true,
        modelUsed: 'Stagehand AI Browser'
      }
    ];

    try {
      console.log('🚀 Starting streaming request to Stagehand API:', currentPrompt);

      // Use streaming approach with Server-Sent Events
      const response = await fetch('/api/stagehand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command: currentPrompt,
          chatId: userMessageId,
          stream: true // Enable streaming
        }),
          signal: currentAbortController?.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log('📡 Streaming response initiated');

      // Process streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      let buffer = '';
      let finalData: any = null;
      let currentEventType = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
          } else if (line.startsWith('data: ') && line.trim() !== 'data: ') {
            try {
              const data = JSON.parse(line.slice(6));

              if (currentEventType === 'pill') {
                // Real-time pill update
                console.log('🔴 Received real-time pill:', data);
                messages = messages.map((m) =>
                  m.id === assistantMessageId
                    ? { ...m, eventLog: [...(m.eventLog || []), data] }
                    : m
                );
                await tick();
                scrollToBottom();
              } else if (currentEventType === 'start') {
                console.log('🟢 Stream started:', data.message);
                messages = messages.map((m) =>
                  m.id === assistantMessageId
                    ? { ...m, content: data.message || 'Starting execution...' }
                    : m
                );
              } else if (currentEventType === 'session') {
                console.log('🔗 Session info received:', data);
                if (data.sessionId) browserSessionId = data.sessionId;
                if (data.liveViewUrl) browserLiveViewUrl = data.liveViewUrl;
                showBrowserViewport = true;
              } else if (currentEventType === 'complete') {
                console.log('✅ Stream completed:', data);
                finalData = data;

                // Debug the message structure immediately
                console.log('🔍 Debug - finalData.message type:', typeof data.message);
                console.log('🔍 Debug - finalData.message value:', data.message);
              } else if (currentEventType === 'error') {
                console.error('❌ Stream error:', data);
                throw new Error(data.error || 'Streaming error occurred');
              }

              // Reset event type after processing
              currentEventType = '';
            } catch (parseError) {
              console.warn('⚠️ Failed to parse SSE data:', parseError, 'Line:', line);
            }
          }
        }
      }

      // Process final completion data
      if (finalData) {
        console.log('🎯 Processing final completion data:', finalData);

        // Extract the main message content
        let responseContent = '';
        if (typeof finalData.message === 'string') {
          responseContent = finalData.message;
        } else if (finalData.message && typeof finalData.message === 'object') {
          responseContent = JSON.stringify(finalData.message, null, 2);
        } else {
          responseContent = "Stagehand processed the command.";
        }

        // Instead of generating individual action pills, create a single collapsible summary pill
        const summaryPill: EventLogEntry = {
          id: generateUniqueId() + '-summary',
          type: 'summary', // New pill type for collapsible summaries
          description: `Stagehand completed ${finalData.actionsPerformed?.length || 0} actions`,
          fullDetails: {
            actionsPerformed: finalData.actionsPerformed || [],
            data: finalData.data,
            success: finalData.success,
            modelUsed: finalData.modelUsed,
            sessionReused: finalData.sessionReused
          }
        };

        // Add the summary pill
        messages = messages.map(msg =>
          msg.id === assistantMessageId
            ? {
            ...msg,
                content: responseContent,
                isLoading: false,
            isStreaming: false,
                modelUsed: finalData.modelUsed || 'Stagehand AI Browser',
                eventLog: [...(msg.eventLog || []), summaryPill]
              }
            : msg
        );

        if (finalData.screenshot) {
          browserScreenshot = finalData.screenshot;
        }
        if (finalData.liveViewUrl) {
          browserLiveViewUrl = finalData.liveViewUrl;
        }
        if (finalData.sessionId) {
          browserSessionId = finalData.sessionId;
        }

        showBrowserViewport = true;

        // Stream the action pills if any were generated
        if (finalData.actionsPerformed && Array.isArray(finalData.actionsPerformed)) {
          console.log('🎭 Streaming action pills:', finalData.actionsPerformed);
          streamEvents(assistantMessageId, finalData.actionsPerformed.map(action => ({
            id: generateUniqueId() + `-action-${action.index}`,
            type: 'action',
            description: `Navigate to ${action.parameters || 'page'}`,
            fullDetails: action
          })));
        }

        console.log('🎉 Streaming execution completed successfully');
      } else {
        // Fallback if no completion data received
          messages = messages.map(msg =>
            msg.id === assistantMessageId
            ? {
                ...msg,
                content: "Stagehand execution completed.",
                isLoading: false,
                isStreaming: false
              }
              : msg
          );
      }

    } catch (error: any) {
      console.error('Error during Stagehand streaming:', error);
      if (error.name === 'AbortError') {
        console.log('Request was aborted by user');
            messages = messages.map(msg =>
          msg.id === assistantMessageId && msg.isLoading
            ? { ...msg, content: "Operation aborted.", isLoading: false, isStreaming: false }
                : msg
            );
        return;
      }

      // Fallback to non-streaming request if streaming fails
      console.log('🔄 Streaming failed, trying non-streaming fallback...');
      try {
        const fallbackResponse = await fetch('/api/stagehand', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command: currentPrompt,
            chatId: userMessageId,
            stream: false // Disable streaming for fallback
          }),
          signal: currentAbortController?.signal
        });

        if (fallbackResponse.ok) {
          const fallbackResult = await fallbackResponse.json();
          console.log('🔄 Fallback request succeeded:', fallbackResult);

          // Extract the main message content consistently
          let responseContent = '';
          if (typeof fallbackResult.message === 'string') {
            responseContent = fallbackResult.message;
          } else if (fallbackResult.message && typeof fallbackResult.message === 'object') {
            responseContent = JSON.stringify(fallbackResult.message, null, 2);
      } else {
            responseContent = "Stagehand processed the command.";
          }

          // Create a summary pill instead of individual action pills
          const summaryPill: EventLogEntry = {
            id: generateUniqueId() + '-fallback-summary',
            type: 'summary',
            description: `Stagehand completed ${fallbackResult.actionsPerformed?.length || 0} actions (fallback mode)`,
            fullDetails: {
              actionsPerformed: fallbackResult.actionsPerformed || [],
              data: fallbackResult.data,
              success: fallbackResult.success,
              modelUsed: fallbackResult.modelUsed,
              fallbackMode: true
            }
          };

          if (fallbackResult.screenshot) browserScreenshot = fallbackResult.screenshot;
          if (fallbackResult.liveViewUrl) browserLiveViewUrl = fallbackResult.liveViewUrl;
          if (fallbackResult.sessionId) browserSessionId = fallbackResult.sessionId;
          showBrowserViewport = true;

          messages = messages.map(msg =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: responseContent,
                  isLoading: false,
                  isStreaming: false,
                  modelUsed: fallbackResult.modelUsed || 'Stagehand AI Browser',
                  eventLog: [...(msg.eventLog || []), summaryPill]
                }
              : msg
          );

          if (fallbackResult.actionsPerformed && Array.isArray(fallbackResult.actionsPerformed)) {
            console.log('🎭 Streaming action pills:', fallbackResult.actionsPerformed);
            streamEvents(assistantMessageId, fallbackResult.actionsPerformed.map(action => ({
              id: generateUniqueId() + `-action-${action.index}`,
              type: 'action',
              description: `Navigate to ${action.parameters || 'page'}`,
              fullDetails: action
            })));
          }

          console.log('🎉 Streaming execution completed successfully');
        } else {
          throw new Error('Both streaming and fallback requests failed');
        }
      } catch (fallbackError) {
        console.error('❌ Fallback request also failed:', fallbackError);
      messages = messages.map(msg =>
        msg.id === assistantMessageId
          ? {
              ...msg,
              isLoading: false,
              isStreaming: false,
                error: fallbackError.message || 'Failed to get response from Stagehand.',
                content: `Error: ${fallbackError.message || 'Failed to get response from Stagehand.'}`,
            }
          : msg
      );
      }
    } finally {
        isOverallLoading = false;
      isBrowserLoading = false;
      if (currentAbortController && !currentAbortController.signal.aborted) {
        currentAbortController = null;
      }
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
      const handleBrowserbaseMessage = (event) => {
        console.log('🔌 Received message from iframe:', event.data, 'Origin:', event.origin);

        if (event.data === "browserbase-disconnected") {
          console.log('🔌 Browserbase connection lost:', event.data);
          browserLiveViewUrl = null;
          showBrowserViewport = false;
        }
      };

      (async () => {
        isCleaningUpStaleSession = true;
        const staleSessionId = sessionStorage.getItem('browserSessionId');

        if (staleSessionId) {
          console.log('🧹 Found stale session ID in storage:', staleSessionId, "Attempting to close immediately.");
          try {
            // IMPORTANT: Call DELETE on BOTH Stagehand and Browserbase
            const stagehandDelete = fetch('/api/stagehand', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: staleSessionId }),
              // keepalive: true, // Not strictly needed for onMount, but doesn't hurt
            });
            const browserbaseDelete = fetch('/api/browserbase', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: staleSessionId }),
              // keepalive: true,
            });

            await Promise.all([stagehandDelete, browserbaseDelete]);
            console.log('✅ Stale session cleanup requests sent for:', staleSessionId);

          } catch (err) {
            console.warn('⚠️ Error during stale session cleanup fetch:', err);
          } finally {
            sessionStorage.removeItem('browserSessionId'); // Remove regardless of API success
            console.log('🧹 Stale session ID removed from sessionStorage.');
          }
        }
        isCleaningUpStaleSession = false;

        // Now that cleanup is done (or if there was nothing to clean), proceed with new session init
        await initializeNewStagehandSession();


            messages = [
                {
                    id: generateUniqueId(),
                    role: 'assistant',
                content: "Hi there! I'm now powered by Stagehand for advanced browser automation. I can understand complex natural language commands.\n\n**Try commands like:**\n• 'Navigate to LinkedIn and find Vitalii Dodonov\\'s profile.'\n• 'Search Google for recent AI news and open the first two articles.'\n• 'Go to OpenAI\\'s website and summarize the GPT-4o page.'\n• 'Take a screenshot.'\n\nThe live browser window will show real-time results driven by Stagehand!"
                }
            ];
            isStartState = true;
        isInitialized = true;
        scrollToBottom();
        window.addEventListener("message", handleBrowserbaseMessage);
      })();

      const cleanupSessions = async (isUnloading = false) => {
        if (browserSessionId) {
          console.log(`🧹 Cleaning up sessions (unload: ${isUnloading}):`, browserSessionId);
          const headers = { 'Content-Type': 'application/json' };
          const body = JSON.stringify({ sessionId: browserSessionId });

          try {
            if (isUnloading && navigator.sendBeacon) {
              navigator.sendBeacon('/api/stagehand', body);
              navigator.sendBeacon('/api/browserbase', body);
              console.log('🚀 Session cleanup initiated via sendBeacon');
            } else {
              await Promise.all([
                fetch('/api/stagehand', { method: 'DELETE', headers, body, keepalive: true }),
                fetch('/api/browserbase', { method: 'DELETE', headers, body, keepalive: true })
              ]);
              console.log('🚀 Session cleanup initiated via fetch keepalive');
            }
          } catch (error) {
            console.warn('⚠️ Error during session cleanup:', error);
          }
          // Clear current session ID from state, but let sessionStorage be handled by the next load or explicit clear
          // browserSessionId = null;
        }
        // Always remove from sessionStorage on unload to ensure next load attempts cleanup if beacon fails
        if (isUnloading && typeof window !== 'undefined') {
            sessionStorage.removeItem('browserSessionId');
        }
      };

      const handleBeforeUnload = (event) => {
        cleanupSessions(true);
      };

      const handleUnload = () => {
        cleanupSessions(true); // ensure it runs, sendBeacon is preferred here
      };

      window.addEventListener('beforeunload', handleBeforeUnload);
      window.addEventListener('unload', handleUnload);

      return () => {
        window.removeEventListener('beforeunload', handleBeforeUnload);
        window.removeEventListener('unload', handleUnload);
        window.removeEventListener('message', handleBrowserbaseMessage);
        // Optional: Call cleanup if component is unmounted mid-session without page close
        // This might be redundant if beforeunload/unload always fire, but can be a safeguard.
        // cleanupSessions(false);
      };
    }
  });

  function parseLog(log: string) {

    if (log.includes('Processing block')){
      const json = JSON.parse(log.substring(18))
      switch (json.type){
        case 'text':
          return `text: ${json.text}`
        case 'tool_use':
          return `tool_use: ${json.input?.action}`
        default:
          break
      }
    }

    return log
  }

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
              on:click={() => handleExamplePrompt("find Vitalii Dodonov's LinkedIn profile")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">find Vitalii Dodonov's LinkedIn profile</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("search for AI news")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">search for AI news</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("go to OpenAI's website")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">go to OpenAI's website</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("take a screenshot")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">take a screenshot</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("read the latest posts")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">read the latest posts</span>
          </button>

            <!-- Duplicates for seamless loop -->
          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("find Vitalii Dodonov's LinkedIn profile")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">find Vitalii Dodonov's LinkedIn profile</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("search for AI news")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">search for AI news</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("go to OpenAI's website")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">go to OpenAI's website</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("take a screenshot")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">take a screenshot</span>
          </button>

          <button
            class="prompt-card"
              on:click={() => handleExamplePrompt("read the latest posts")}
            disabled={isOverallLoading}
          >
              <span class="prompt-text">read the latest posts</span>
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
                      </span>
                    {/if}
                </div>

                {#if message.eventLog && message.eventLog.length > 0}
                  <div class="event-log-container">
                    {#each message.eventLog as event, i (event.id)}
                      {#if event.type === 'reasoning'}
                        <div class="reasoning-pill" in:fly={{ y: 10, duration: 300, delay: 50, easing: cubicOut }}>
                           <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00AEEF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="reasoning-pill-icon"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                          <span class="reasoning-pill-text">{event.description}</span>
                        </div>
                      {:else if event.type === 'action'}
                        <div class="action-pill" in:fly={{ y: 10, duration: 300, delay: 50, easing: cubicOut }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="action-pill-icon"><polyline points="20 6 9 17 4 12"></polyline></svg>
                          <span class="action-pill-text">
                            { parseLog(event.description)  }
                          </span>
                        </div>
                      {:else if event.type === 'summary'}
                        <details class="summary-pill" in:fly={{ y: 10, duration: 300, delay: 50, easing: cubicOut }}>
                          <summary class="summary-pill-header">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="summary-pill-icon">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                              <polyline points="14,2 14,8 20,8"></polyline>
                              <line x1="16" y1="13" x2="8" y2="13"></line>
                              <line x1="16" y1="17" x2="8" y2="17"></line>
                              <polyline points="10,9 9,9 8,9"></polyline>
                            </svg>
                            <span class="summary-pill-text">{event.description}</span>
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="summary-chevron">
                              <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                          </summary>
                          <div class="summary-pill-content">
                            <div class="summary-actions">
                              <h4>Actions Performed ({event.fullDetails.actionsPerformed?.length || 0})</h4>
                              {#if event.fullDetails.actionsPerformed && event.fullDetails.actionsPerformed.length > 0}
                                <div class="action-list">
                                  {#each event.fullDetails.actionsPerformed as action, i}
                                    <div class="action-item">
                                      <div class="action-number">{i + 1}</div>
                                      <div class="action-details">
                                        <div class="action-description">
                                          {#if action.description}
                                            {action.description}
                                          {:else if action.type}
                                            {action.type}: {action.parameters || 'No parameters'}
                                          {:else}
                                            Unknown action
                                          {/if}
                                        </div>
                                        {#if action.reasoning}
                                          <div class="action-reasoning">💭 {action.reasoning}</div>
                                        {/if}
                                        {#if action.taskCompleted !== undefined}
                                          <div class="action-status {action.taskCompleted ? 'completed' : 'pending'}">
                                            {action.taskCompleted ? '✓ Completed' : '⏳ Pending'}
                                          </div>
                                        {/if}
                                      </div>
                                    </div>
                                  {/each}
                                </div>
                              {:else}
                                <p class="no-actions">No actions recorded</p>
                              {/if}
                            </div>
                            {#if event.fullDetails.data}
                              <div class="summary-data">
                                <h4>Extracted Data</h4>
                                <pre><code>{JSON.stringify(event.fullDetails.data, null, 2)}</code></pre>
                              </div>
                            {/if}
                          </div>
                        </details>
                      {/if}
                    {/each}
                  </div>
                {/if}

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

  <!-- Live Browser Viewport (refactored) -->
  <Browserbase
    show={showBrowserViewport && (Boolean(browserLiveViewUrl) || Boolean(browserScreenshot) || isBrowserLoading || Boolean(browserSessionId))}
    liveViewUrl={browserLiveViewUrl}
    screenshot={browserScreenshot}
    sessionId={browserSessionId}
    loading={isBrowserLoading}
    on:close={async () => {
      await closeBrowserSession();
      showBrowserViewport = false;
    }}
  />

</div>

<style lang="scss">
  .loader {
    width: 17px;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--highlight);
    display: grid;
    box-shadow: inset -2px -2px 4px rgba(black, .2);
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
      flex-wrap: wrap;
      gap: 16px;
      padding: 4px 0;
      width: fit-content;
      animation-duration: 40s;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
      will-change: transform;
      touch-action: pan-y;

      &.carousel-left-to-right {
        //animation-name: scrollLeftToRight;
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
       // background: linear-gradient(to right, rgba(white, 1) 0%, rgba(white, 0.8) 50%, rgba(white, 0) 100%);
      }

      &.carousel-gradient-right {
        right: 0;
       // background: linear-gradient(to left, rgba(white, 1) 0%, rgba(white, 0.8) 50%, rgba(white, 0) 100%);
      }
    }


    .prompt-card {
      background: rgba(#030025, .05);
      border-radius: 12px;
      padding: 10px 18px;
      cursor: pointer;
      width: fit-content;
      min-width: 100px; // Ensure consistent card sizes
      transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
      flex-shrink: 0; // Prevent cards from shrinking
      border: 1px solid rgba(#00106D, .1);


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
        letter-spacing: .4px;
        color: #003025;
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
    padding: 16px 24px 180px 24px;


    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
    transform: translateZ(0);
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
    width: 1000px;
    box-sizing: border-box;
    flex-grow: 0;
    margin: 0 auto;


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
    border-radius: 18px;
    line-height: 1.6;
    font-size: 15px;


    p {
        margin: 0;
        white-space: pre-wrap;
        word-wrap: break-word;


        span {
          display: inline-block;
          animation: blink 1s step-end infinite;
        }
    }


    &.user-bubble {
      background-color: rgba(black, .05);
      font-family: "ivypresto-headline", 'Newsreader', serif;
      text-shadow: -.4px 0 0 #030025;
      font-size: 16px;
      font-weight: 500;
      letter-spacing: .5px;
      position: relative;
      padding: 12px 18px 14px 18px;
      color: #030025;
    }


    &.assistant-bubble {
      font-family: "Inter", sans-serif;
      font-size: 16px;
      font-weight: 450;
      color: #e0e0e0;
      width: 100%;
      margin: 10px 0 0 0;
      flex: 1;


      .markdown-container {
        margin-bottom: 0;
        padding: 0;


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


  .main-loading-spinner {
    display: flex;
    align-items: center;
      padding: 5px 0;
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
      width: 14px;
      height: 14px;
      border-width: 2px;
    }
  }


  @keyframes spin {
    to { transform: rotate(360deg); }
  }


  .chat-input-area {
    display: flex;
    align-items: center;
    flex-direction: column;
    gap: 0;
    position: fixed;
    bottom: 24px;
    z-index: 3;
  }

  .refresh-button-standalone {
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




  .markdown-container {
    width: 100%;
    margin-bottom: 8px;
    color: rgba(#030025,1);


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
      background-color: rgba(#030025, 1);
      padding: 38px 24px 20px 24px;
      border-radius: 12px;
      margin: 32px 0 40px 0;
      box-shadow: -8px 16px 32px rgba(#030025, .3);
      overflow-x: auto;
      position: relative;
    }


    :global(code) {
      background-color: rgba(black, .5);
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
      overflow-y: auto !important;
      -webkit-overflow-scrolling: touch !important;
      touch-action: pan-y !important;
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
    }


    .chat-messages-container{
      padding: 16px 12px 180px 12px !important;
      margin: 0 auto !important;
      height: calc(100vh - 32px) !important;
      max-height: calc(100vh - 32px) !important;
      overflow-y: auto !important;
      -webkit-overflow-scrolling: touch !important;
      touch-action: pan-y !important;
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
      position: relative;
    }


    .message-wrapper{
      margin: 12px auto !important;
      padding: 0;
      max-width: 100%;
      width: 95% !important;
      touch-action: pan-y;
    }


    .carousel-container{
      height: 90px;
      touch-action: pan-y !important;
    }


    .carousel-track {
      animation-duration: 25s;
      height: 100%;
      touch-action: pan-y !important;
    }


    .prompt-card {
      width: 200px;
      padding: 12px 16px;
      margin: 0;


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
   flex-shrink: 0;
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
   height: calc(100% - 49px);
   overflow: hidden;
   background: transparent;
 }

 .browser-iframe {
   width: 100%;
   height: 100%;
   border: none;
   background: white;
   display: block;
   margin: 0;
   padding: 0;
   position: absolute;
   top: 0;
   left: 0;
   right: 0;
   bottom: 0;
 }

 :global(.screencast-viewport) {
   padding: 0 !important;
   margin: 0 !important;
   border: none !important;
   border-radius: 0 !important;
   width: 100% !important;
   height: 100% !important;
   background: transparent !important;
 }

 :global(.screencast-navigation) {
   display: none !important;
 }

 :global(.screencast-toolbar) {
   display: none !important;
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
   width: 100%;
 }

 .browser-screenshot {
   width: 100%;
   height: 100%;
   object-fit: cover;
   display: block;
   margin: 0;
   padding: 0;
 }

 :global(.screencast-viewport){
  padding: 0 !important;
  border-radius: 0 !important;
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
     overflow-y: auto !important;
     -webkit-overflow-scrolling: touch !important;
     touch-action: pan-y !important;
     transform: translateZ(0);
     -webkit-transform: translateZ(0);
   }


   .chat-messages-container{
     padding: 16px 12px 180px 12px !important;
     margin: 0 auto !important;
     height: calc(100vh - 32px) !important;
     max-height: calc(100vh - 32px) !important;
     overflow-y: auto !important;
     -webkit-overflow-scrolling: touch !important;
     touch-action: pan-y !important;
     transform: translateZ(0);
     -webkit-transform: translateZ(0);
     position: relative;
   }


   .message-wrapper{
     margin: 12px auto !important;
     padding: 0;
     max-width: 100%;
     width: 95% !important;
     touch-action: pan-y;
   }


   .carousel-container{
     height: 90px;
     touch-action: pan-y !important;
   }


   .carousel-track {
     animation-duration: 25s;
     height: 100%;
     touch-action: pan-y !important;
   }


   .prompt-card {
     width: 200px;
     padding: 12px 16px;
     margin: 0;


     touch-action: pan-y;


     .prompt-text {
       width: 100%;
       text-wrap: wrap;
       vertical-align: top;
       line-height: 120%;
     }
   }
 }

  .event-log-container {
    margin-top: 16px;
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .action-pill, .reasoning-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    width: fit-content;
    color: #030025;
    font-family: "Inter", sans-serif;
    line-height: 1.4;

    svg {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
    }
    span {
      flex-grow: 1;
      font-weight: 550;
      word-break: break-word;
    }
  }

  .action-pill {
    background-color: white;
    box-shadow: -4px 8px 8px rgba(#030025, 0.05);
    border-radius: 18px;
    .action-pill-icon {
      color: #6355FF;
      stroke-width: 2.5;
    }
  }

  .reasoning-pill {
    background-color: rgba(#00AEEF, 0.08);
    .reasoning-pill-icon {
      color: #00AEEF;
      stroke-width: 2.5;
    }
  }

  .summary-pill {
    background-color: rgba(#FF6B35, 0.08);
    border-radius: 12px;
    border: 1px solid rgba(#FF6B35, 0.15);
    font-family: "Inter", sans-serif;
    color: #030025;
    width: 100%;
    margin: 8px 0;

    summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      cursor: pointer;
      list-style: none;
      user-select: none;
      font-weight: 550;
      font-size: 13px;
      border-radius: 12px;
      transition: background-color 0.2s ease;

      &:hover {
        background-color: rgba(#FF6B35, 0.12);
      }

      .summary-pill-icon {
        color: #FF6B35;
        flex-shrink: 0;
      }

      .summary-pill-text {
        flex-grow: 1;
      }

      .summary-chevron {
        color: #FF6B35;
        flex-shrink: 0;
        transition: transform 0.2s ease;
      }
    }

    &[open] summary .summary-chevron {
      transform: rotate(180deg);
    }

    .summary-pill-content {
      padding: 0 16px 16px 16px;
      border-top: 1px solid rgba(#FF6B35, 0.1);
      margin-top: 8px;

      h4 {
        font-size: 12px;
        font-weight: 600;
        color: #FF6B35;
        margin: 12px 0 8px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .action-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .action-item {
        display: flex;
        gap: 12px;
        padding: 10px;
        background: rgba(white, 0.5);
        border-radius: 8px;
        border: 1px solid rgba(#FF6B35, 0.1);

        .action-number {
          background: #FF6B35;
          color: white;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .action-details {
          flex-grow: 1;

          .action-description {
            font-size: 12px;
            font-weight: 500;
            line-height: 1.4;
            margin-bottom: 4px;
          }

          .action-reasoning {
            font-size: 11px;
            color: #666;
            font-style: italic;
            margin-bottom: 4px;
          }

          .action-status {
            font-size: 10px;
            font-weight: 600;
            padding: 2px 6px;
            border-radius: 4px;
            display: inline-block;

            &.completed {
              background: rgba(#28a745, 0.1);
              color: #28a745;
            }

            &.pending {
              background: rgba(#ffc107, 0.1);
              color: #ffc107;
            }
          }
        }
      }

      .no-actions {
        font-size: 12px;
        color: #666;
        font-style: italic;
        margin: 8px 0;
      }

      .summary-data {
        margin-top: 16px;

        pre {
          background: rgba(#030025, 0.05);
          border-radius: 6px;
          padding: 8px;
          font-size: 10px;
          overflow-x: auto;
          border: 1px solid rgba(#030025, 0.1);

          code {
            font-family: 'Fira Code', 'Consolas', monospace;
            color: #030025;
          }
        }
      }
    }
  }

</style>


