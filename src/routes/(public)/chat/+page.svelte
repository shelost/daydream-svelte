<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { scale, fly, fade } from 'svelte/transition';
  import { cubicOut, elasticOut } from 'svelte/easing';
  import { writable } from 'svelte/store';
  import Omnibar from '$lib/components/Omnibar.svelte'; // Import Omnibar
  import { Markdown } from 'svelte-rune-markdown'; // Add this line to import the Markdown component
  import { fetchAndLog } from '$lib/utils/fetchAndLog'; // Import fetchAndLog for API logging

  // Import Prism.js for syntax highlighting - make it conditional for production builds
  let Prism: any = null; // Keep at top-level, initialize to null
  let PrismLoaded: boolean = false; // Keep at top-level

  // Word animation configuration
  const WORD_ANIMATION_DURATION_MS = 500; // Duration for each word to fade in (milliseconds)

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
    animatedWords?: AnimatedWord[]; // Track animated words
    _lastProcessedContentLength?: number;
    _previousContent?: string;
    wasUserAtBottom?: boolean; // Add this flag
  }

  let messages: Message[] = [];
  let omnibarPrompt: string = ''; // Bound to Omnibar's additionalContext
  let isOverallLoading: boolean = false; // Tracks if a response is being generated
  let currentSelectedTextModel: string = 'claude-3-7-sonnet-20250219'; // Updated default text model
  let currentAbortController: AbortController | null = null; // For stopping generation
  let currentFollowUpQuestions: string[] = []; // For follow-up prompts to show above Omnibar

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
  let isInitialized = false;
  let isStartState = true;
  let showScrollButton = false;
  const shouldAutoScroll = writable(true); // Convert to writable store
  let lastScrollTop = 0;
  const SESSION_STORAGE_KEY = 'textChatMessages';

  const generateUniqueId = () => `_${Math.random().toString(36).substring(2, 11)}`;

  let lastUserEditTime = 0;
  let pendingAnalysis = false;

  let markdownContainers = new Map();
  let messageObservers: Map<string, MutationObserver> = new Map();

  const ANIMATION_DURATION = 3000; // 3 seconds for opacity transition
  const INITIAL_OPACITY = 0.5;
  const FINAL_OPACITY = 1.0;

  // Animation constants
  const WORD_FADE_DURATION = 800;
  const WORD_STAGGER_DELAY = 100;
  const INITIAL_WORD_OPACITY = 0.0;
  const FINAL_WORD_OPACITY = 1.0;

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
        copyWithFeedback(copyBtn, codeBlock.textContent || '');
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

  // Universal copy function with checkmark feedback
  function copyWithFeedback(button, content) {
    navigator.clipboard.writeText(content);

    // Store original innerHTML
    const originalHTML = button.innerHTML;

    // Show checkmark
    button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>';

    // Restore original after 2 seconds
    setTimeout(() => {
      button.innerHTML = originalHTML;
    }, 2000);
  }

  // Track animated words for each message
  let animatedWordsMap = new Map();

  // Apply fade animation to new words in real-time
  function applyRealtimeWordAnimation(container: HTMLElement, messageId: string) {
    if (!container) return;

    // Find the message by id
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex === -1) return;
    const message = messages[messageIndex];

    if (!message.animatedWords) message.animatedWords = [];

    const existingCount = message.animatedWords.length; // words already tracked
    let globalIndex = 0; // will increment for every word encountered in DOM traversal

    const newNodesToReplace = new Map<Node, DocumentFragment>();
    const now = Date.now();
    let newWordAdded = false; // track if we actually add new words

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (parent && (parent.classList.contains('animated-word') || parent.closest('pre code'))) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!node.textContent || !node.textContent.trim()) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node: Node | null;
    while ((node = walker.nextNode())) {
      const textContent = node.textContent || '';
      const segments = textContent.split(/(\s+)/);
      const fragment = document.createDocumentFragment();

      segments.forEach((segment) => {
        if (segment.trim().length === 0) {
          // whitespace
          fragment.appendChild(document.createTextNode(segment));
          return;
        }

        globalIndex++;

        let animatedWord = message.animatedWords[globalIndex - 1];
        if (!animatedWord) {
          // New word
          animatedWord = {
            id: `word-${messageId}-${globalIndex}`,
            text: segment,
            addedTime: now,
            currentOpacity: 0,
          };
          message.animatedWords.push(animatedWord);
          newWordAdded = true;
        }

        // Use existing span if it already exists to avoid flicker
        let span = document.getElementById(animatedWord.id) as HTMLSpanElement | null;
        if (!span) {
          span = document.createElement('span');
          span.id = animatedWord.id;
          span.className = 'animated-word';
        }
        span.textContent = segment;
        span.style.opacity = animatedWord.currentOpacity.toString();
        fragment.appendChild(span);
      });

      // Only mark this text node for replacement if we actually added a new word
      if (newWordAdded) {
        newNodesToReplace.set(node, fragment);
      }
    }

    // If no new words were added, skip DOM replacement to prevent flicker
    if (!newWordAdded) return;

    newNodesToReplace.forEach((frag, original) => {
      original.parentNode?.replaceChild(frag, original);
    });

    // kick off animation loop if needed
    if (message.isStreaming) {
      animateWords(messageId);
    }
  }

  function animateWords(messageId: string) {
    const message = messages.find(m => m.id === messageId);
    if (!message || !message.animatedWords || !message.isStreaming) return;

    const now = Date.now();
    let needsUpdate = false;

    message.animatedWords.forEach(word => {
      const age = now - word.addedTime;
      if (age < WORD_ANIMATION_DURATION_MS) {
        // Calculate new opacity based on age
        word.currentOpacity = age / WORD_ANIMATION_DURATION_MS;
        needsUpdate = true;

        // Update DOM element
        const element = document.getElementById(word.id);
        if (element) {
          element.style.opacity = word.currentOpacity.toString();
        }
      } else if (word.currentOpacity < 1) {
        word.currentOpacity = 1;
        needsUpdate = true;

        const element = document.getElementById(word.id);
        if (element) {
          element.style.opacity = '1';
        }
      }
    });

    if (needsUpdate && message.isStreaming) {
      requestAnimationFrame(() => animateWords(messageId));
    }
  }

  function setupStreamingContentObserver(container, messageId) {
    // Disconnect existing observer for this message if it exists
    if (messageObservers.has(messageId)) {
      messageObservers.get(messageId).disconnect();
    }

    if (!container) return;

    // Create a new mutation observer to watch for content changes
    const observer = new MutationObserver((mutations) => {
      let hasTextChanges = false;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          hasTextChanges = true;

          // Check if any new pre/code elements were added or modified
          const codeBlocks = container.querySelectorAll('pre code:not(.highlighted)');
          if (codeBlocks.length > 0) {
            codeBlocks.forEach(codeBlock => {
              addHeaderAndHighlight(codeBlock);
            });
          }
        }
      }

      // Apply animation to new words without forcing scroll
      if (hasTextChanges) {
        highlightCodeBlocks(container); // Highlight first
        applyRealtimeWordAnimation(container, messageId); // Then animate

        // Auto-scroll ONLY if enabled - this is critical
        if ($shouldAutoScroll && chatContainer) {
          // Use requestAnimationFrame for smoother scrolling
          requestAnimationFrame(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
          });
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
  function copyMessage(content, button) {
    copyWithFeedback(button, content || '');
  }

  // Update scrollToBottom to use shouldAutoScroll state
  async function scrollToBottom() {
    await tick(); // Ensure DOM is updated before scrolling
    if (chatContainer && $shouldAutoScroll) {
      // Use requestAnimationFrame for smoother scrolling
      requestAnimationFrame(() => {
        // Use instant scroll during streaming for smoothness
        if (messages.some(m => m.isStreaming)) {
          //chatContainer.scrollTop = chatContainer.scrollHeight;
          chatContainer.scrollTo({
            //top: chatContainer.scrollHeight,
           // behavior: 'smooth'
          });
        } else {
          // Use smooth scroll for non-streaming updates (like initial load or manual button click)
          chatContainer.scrollTo({
            top: chatContainer.scrollHeight,
            behavior: 'smooth'
          });
        }
      });
    }
  }

  // Add scroll handler function
  function handleScroll(event: Event) {
    const target = event.target as HTMLElement;
    const currentScrollTop = target.scrollTop;
    const isScrollable = target.scrollHeight > target.clientHeight;
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

    // Only detect manual scrolling during streaming to avoid disabling auto-scroll unnecessarily
    if (messages.some(m => m.isStreaming)) {
      // Check if user has manually scrolled by comparing with the last position
      if (Math.abs(currentScrollTop - lastScrollTop) > 1) {
        // Only disable auto-scroll if user is actually scrolling away from bottom
        // This prevents auto-scroll from being disabled during normal content updates
        if (scrollBottom > 20) {
          console.log('User manually scrolled - disabling auto-scroll');
          $shouldAutoScroll = false;
        }
      }
    }

    lastScrollTop = currentScrollTop;
    showScrollButton = isScrollable && scrollBottom > 500;
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
    currentFollowUpQuestions = []; // Clear follow-up prompts
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

  function handleStop() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    isOverallLoading = false;

    // Update the last message to show it was stopped
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

  function parseFollowUpQuestions(content: string): { mainContent: string, followUpQuestions: string[] } {
    console.log('🔍 Parsing follow-up prompts from content length:', content.length);
    console.log('🔍 Content sample:', content.slice(-500)); // Show more content to see the follow-up section

    const followUpMatch = content.match(/⟪---FOLLOWUP---(.*?)---ENDFOLLOWUP---/s);

    if (followUpMatch) {
      console.log('✅ Found follow-up section:', followUpMatch[1]);
      const mainContent = content.replace(/⟪---FOLLOWUP---(.*?)---ENDFOLLOWUP---/s, '').trim();
      const followUpSection = followUpMatch[1].trim();

      // Extract questions from numbered list - make more flexible
      const questions = followUpSection
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0) // Any non-empty line
        .map(line => {
          // Try different patterns for numbered questions
          if (line.match(/^\d+\.\s*\[(.*)\]$/)) {
            return line.replace(/^\d+\.\s*\[(.*)\]$/, '$1');
          } else if (line.match(/^\d+\.\s*(.+)$/)) {
            return line.replace(/^\d+\.\s*(.+)$/, '$1');
          } else if (line.match(/^[-*]\s*(.+)$/)) {
            return line.replace(/^[-*]\s*(.+)$/, '$1');
          } else if (line.length > 5) { // Any substantial line
            return line;
          }
          return null;
        })
        .filter(q => q && q.length > 0);

      console.log('🎯 Extracted questions:', questions);

      return {
        mainContent,
        followUpQuestions: questions.slice(0, 3) // Ensure max 3 questions
      };
    }

    console.log('❌ No follow-up section found in content');
    return {
      mainContent: content,
      followUpQuestions: []
    };
  }

  async function handleOmnibarSubmit() {
    const currentPrompt = omnibarPrompt.trim();
    if (!currentPrompt || isOverallLoading) return;

    // Reset auto-scroll state for new API call
    $shouldAutoScroll = true;

    // Create new AbortController for this request
    currentAbortController = new AbortController();

    if (isStartState) {
      isStartState = false;
    }

    isOverallLoading = true;
    const userMessageId = generateUniqueId();
    messages = [...messages, { id: userMessageId, role: 'user', content: currentPrompt }];
    omnibarPrompt = '';

    // Initial scroll to bottom when starting new response - ensure it's smooth
    await scrollToBottom();

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

    // Initialize/reset processedWords count for the new assistant message
    animatedWordsMap.set(assistantMessageId, { processedWords: 0 });

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
        const modelIdentityGuide = `You are Stanley, a helpful AI Creator Asistant created by Stan. Stan is the All-in-one store for Creators, enabling individuals to build businesses online. You are extremely friendly and cute and helpful, so keep that in mind when responding.

IMPORTANT: After your response, provide exactly 3 SHORT, relevant follow-up prompts that the USER might want to ask YOU to continue the conversation. Keep each question under 6 words when possible.

Use this EXACT format at the very end, with the special delimiter ⟪ to signal the start:

⟪---FOLLOWUP---
1. [Short question]
2. [Short question]
3. [Short question]
---ENDFOLLOWUP---`;

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
        const modelIdentityGuide = `You are ${getModelLabel(currentSelectedTextModel)}, a helpful AI assistant created by Google.

IMPORTANT: After your response, provide exactly 3 SHORT, relevant follow-up prompts or questions that the USER might want to prompt YOU to continue the conversation. Keep each question under 6 words when possible.

Use this EXACT format at the very end, with the special delimiter ⟪ to signal the start:

⟪---FOLLOWUP---
1. [Short prompt]
2. [Short prompt]
3. [Short prompt]
---ENDFOLLOWUP---`;
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
            content: `You are ${getModelLabel(currentSelectedTextModel)}, a helpful AI assistant created by OpenAI.

IMPORTANT: After your response, provide exactly 3 SHORT, relevant follow-up prompts that the USER might want to prompt or ask YOU to continue the conversation. Keep each prompt under 6 words when possible.

Use this EXACT format at the very end, with the special delimiter ⟪ to signal the start:

⟪---FOLLOWUP---
1. [Short prompt]
2. [Short prompt]
3. [Short prompt]
---ENDFOLLOWUP---`
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
          body: JSON.stringify(requestBody),
          signal: currentAbortController?.signal
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
      let followUpContent = ''; // Track follow-up content separately
      let inFollowUpSection = false; // Track if we're in the follow-up section

      messages = messages.map(msg =>
        msg.id === assistantMessageId ? { ...msg, isLoading: false, isStreaming: true, _previousContent: '' } : msg
      );

      // Set up a mutation observer for the streaming content
      const setupObserver = () => {
        if (markdownContainers[assistantMessageId]) {
          setupStreamingContentObserver(markdownContainers[assistantMessageId], assistantMessageId);
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

          // Check for the special delimiter to stop main content streaming
          if (!inFollowUpSection && processedChunk.includes('⟪')) {
            console.log('🛑 Detected follow-up delimiter, stopping main content stream');

            // Split the chunk at the delimiter
            const delimiterIndex = processedChunk.indexOf('⟪');
            const beforeDelimiter = processedChunk.substring(0, delimiterIndex);
            const afterDelimiter = processedChunk.substring(delimiterIndex);

            // Add the content before delimiter to main content
            if (beforeDelimiter) {
              assistantContent += beforeDelimiter;
              messages = messages.map(msg => {
                if (msg.id === assistantMessageId && msg.isStreaming) {
                  const previousContent = msg._previousContent || '';
                  let currentContent = msg.content || '';
                  currentContent += beforeDelimiter;

                  return {
                    ...msg,
                    content: currentContent,
                    _previousContent: previousContent
                  };
                }
                return msg;
              });
            }

            // Switch to follow-up mode
            inFollowUpSection = true;
            followUpContent = afterDelimiter;

            // Immediately try to parse and set follow-up prompts
            const tempFollowUpResult = parseFollowUpQuestions('⟪' + followUpContent);
            if (tempFollowUpResult.followUpQuestions.length > 0) {
              currentFollowUpQuestions = tempFollowUpResult.followUpQuestions;
              console.log('🎯 Immediately set follow-up prompts:', currentFollowUpQuestions);
            }

            continue; // Skip the normal processing for this chunk
          }

          if (inFollowUpSection) {
            // We're in follow-up section, collect content but don't display in main response
            followUpContent += processedChunk;

            // Try to parse follow-up prompts as we get more content
            const tempFollowUpResult = parseFollowUpQuestions('⟪' + followUpContent);
            if (tempFollowUpResult.followUpQuestions.length > 0) {
              currentFollowUpQuestions = tempFollowUpResult.followUpQuestions;
              console.log('🔄 Updated follow-up prompts:', currentFollowUpQuestions);
            }

            continue; // Don't add follow-up content to main response
          }

          assistantContent += processedChunk;
          messages = messages.map(msg => {
            if (msg.id === assistantMessageId && msg.isStreaming) {
              let currentContent = msg.content || '';
              currentContent += processedChunk;

              return {
                ...msg,
                content: currentContent
              };
            }
            return msg;
          });

          // Auto-scroll during streaming if enabled
          if ($shouldAutoScroll) {
             await tick();
             // Use instant scroll during streaming for smoothness
             chatContainer.scrollTop = chatContainer.scrollHeight;
           }
        }
      }
      messages = messages.map(msg => {
        if (msg.id === assistantMessageId) {
          // Clean up animation properties and ensure final content is trimmed
          const finalContent = (msg.content || "Sorry, I couldn't generate a response.").trim();
          return {
            ...msg,
            isStreaming: false,
            content: finalContent,
            _previousContent: '' // Clear previous content tracking
          };
        }
        return msg;
      });

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
              }
            } catch (e) {
              // If parsing or extraction fails, try to remove metadata if it looks like a structured object
              // This part of the catch block is a bit of a heuristic
              try {
                const jsonObjForFiltering = JSON.parse(content); // Re-parse for filtering attempt
                 // Remove metadata fields
                const filtered = { ...jsonObjForFiltering };
                ['usage', 'input_chars', 'output_chars', 'cost', 'durationMs', 'total_tokens'].forEach(key => {
                  delete filtered[key];
                });

                // Only use the filtered JSON if it's different and not empty
                if (Object.keys(filtered).length < Object.keys(jsonObjForFiltering).length && Object.keys(filtered).length > 0) {
                  return { ...msg, content: JSON.stringify(filtered, null, 2) };
                } else if (Object.keys(filtered).length === 0 && Object.keys(jsonObjForFiltering).length > 0) {
                  // If filtering results in an empty object but original was not, perhaps it was all metadata
                  return { ...msg, content: "Received a structured response, but it contained only metadata after filtering." };
                }
              } catch (filterError) {
                // Not valid JSON even for filtering, leave as is
              }
            }
          }
        }
        return msg;
      });

      // Parse follow-up prompts from the final content
      const finalMessage = messages.find(msg => msg.id === assistantMessageId);
      if (finalMessage && finalMessage.content) {
        console.log('🔄 Processing final message for follow-ups...');

        // Only parse if we haven't already set follow-up prompts during streaming
        if (currentFollowUpQuestions.length === 0) {
          const parsedResult = parseFollowUpQuestions(finalMessage.content);

          console.log('📝 Parsed main content length:', parsedResult.mainContent.length);
          console.log('❓ Parsed follow-up prompts:', parsedResult.followUpQuestions);

          // Update the message content to exclude follow-up prompts
          messages = messages.map(msg =>
            msg.id === assistantMessageId
              ? { ...msg, content: parsedResult.mainContent }
              : msg
          );

          // Set follow-up prompts for the Omnibar
          currentFollowUpQuestions = parsedResult.followUpQuestions;
          console.log('✨ Set currentFollowUpQuestions to:', currentFollowUpQuestions);
        } else {
          console.log('✅ Follow-up questions already set during streaming:', currentFollowUpQuestions);

          // Clean the main content of any follow-up remnants just in case
          const cleanedContent = finalMessage.content.replace(/⟪---FOLLOWUP---(.*?)---ENDFOLLOWUP---/s, '').trim();
          if (cleanedContent !== finalMessage.content) {
            messages = messages.map(msg =>
              msg.id === assistantMessageId
                ? { ...msg, content: cleanedContent }
                : msg
            );
          }
        }
      } else {
        console.log('❌ No final message found or content is empty');
      }

    } catch (error: any) {
      console.error(`Error with ${currentSelectedTextModel}:`, error);

      // Don't update messages if the request was aborted
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
              _previousContent: ''
            }
          : msg
      );
    } finally {
        isOverallLoading = false;
        currentAbortController = null;
      // scrollToBottom(); // Will be handled by reactive messages update
    }
  }

  function handleFollowUpClick(question: string) {
    if (isOverallLoading) return;

    // Reset auto-scroll state for follow-up questions
    $shouldAutoScroll = true;

    omnibarPrompt = question;
    currentFollowUpQuestions = []; // Clear follow-up prompts

    // Auto-submit the follow-up question
    handleOmnibarSubmit();
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
                        _previousContent: ''
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
                    content: "Hi there! I'm your friendly chat assistant. How can I help you today?",
                    _previousContent: ''
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

        // Add scroll event listener and do initial check
        if (chatContainer) {
          chatContainer.addEventListener('scroll', handleScroll);
          // Initial check for scroll button visibility
          const isScrollable = chatContainer.scrollHeight > chatContainer.clientHeight;
          const scrollBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
          showScrollButton = isScrollable && scrollBottom > 500;
        }
    }

    return () => {
      // Clean up scroll listener
      if (chatContainer) {
        chatContainer.removeEventListener('scroll', handleScroll);
      }
    };
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

            // Check if any message is currently streaming and auto-scroll is enabled
            if ($shouldAutoScroll && messages.some(m => m.isStreaming)) {
              // Use requestAnimationFrame for smoother scrolling and to avoid conflicting with other scroll operations
              if (chatContainer) {
                requestAnimationFrame(() => {
                  chatContainer.scrollTop = chatContainer.scrollHeight;
                });
              }
            }
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
            setupStreamingContentObserver(markdownContainers[message.id], message.id);
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

  // Handle example prompt clicks
  function handleExamplePrompt(promptText: string) {
    if (isOverallLoading) return;

    // Reset auto-scroll state for example prompts
    $shouldAutoScroll = true;

    omnibarPrompt = promptText;
    // Auto-submit the prompt
    handleOmnibarSubmit();
  }
</script>

<svelte:head>
  <title>Opal Chat</title>
</svelte:head>


<div id = 'main' class = 'stan' in:scale={{ duration: 300, start: 0.95, opacity: 0, easing: cubicOut }}>
  <!-- Auto-scroll status indicator -->
  <div class="auto-scroll-status" class:active={$shouldAutoScroll}>
    Auto-scroll: {$shouldAutoScroll ? 'ON' : 'OFF'}
  </div>

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
      <video
            muted
            loop
            preload="auto"
            autoPlay
            playsInline
            src='stanley-3.mp4'
         ></video>
      <h2> Opal </h2>
    </div>

    <!-- Example Prompts Section -->
    <div class="example-prompts" in:fade={{ delay: 500, duration: 500 }}>
      <!-- First carousel row - scrolls left to right -->
      <div class="carousel-container">
        <div class="carousel-track carousel-left-to-right">
          <!-- Original cards -->
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
            on:click={() => handleExamplePrompt("How do I create a successful TikTok strategy?")}
            disabled={isOverallLoading}
          >
            <span class="prompt-text">How do I create a successful TikTok strategy?</span>
          </button>

          <!-- Duplicate cards for seamless loop -->
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
            on:click={() => handleExamplePrompt("How do I create a successful TikTok strategy?")}
            disabled={isOverallLoading}
          >
            <span class="prompt-text">How do I create a successful TikTok strategy?</span>
          </button>
        </div>

        <!-- Gradient overlays -->
        <div class="carousel-gradient carousel-gradient-left"></div>
        <div class="carousel-gradient carousel-gradient-right"></div>
      </div>

      <!-- Second carousel row - scrolls right to left -->
      <div class="carousel-container">
        <div class="carousel-track carousel-right-to-left">
          <!-- Original cards -->
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

          <button
            class="prompt-card"
            on:click={() => handleExamplePrompt("What are the best practices for email marketing?")}
            disabled={isOverallLoading}
          >
            <span class="prompt-text">What are the best practices for email marketing?</span>
          </button>

          <!-- Duplicate cards for seamless loop -->
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

          <button
            class="prompt-card"
            on:click={() => handleExamplePrompt("What are the best practices for email marketing?")}
            disabled={isOverallLoading}
          >
            <span class="prompt-text">What are the best practices for email marketing?</span>
          </button>
        </div>

        <!-- Gradient overlays -->
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
  <div id="chat-page"  in:fade={{ duration: 300 }}> <!-- Re-evaluate if this ID should be more generic -->


    <div
      class="chat-messages-container"
      bind:this={chatContainer}
      on:scroll={handleScroll}
      in:fade={{ duration: 250, delay: 100 }}
    >
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
                  <Markdown
                    content={message.content}
                    on:rendered={() => {
                      highlightCodeBlocks(markdownContainers[message.id]);
                      if (message.isStreaming) {
                        setupStreamingContentObserver(markdownContainers[message.id], message.id);
                        applyRealtimeWordAnimation(markdownContainers[message.id], message.id);
                      }
                    }}
                  />
                  <!-- Cursor and thinking text container -->
                  <span class="cursor-and-thinking-container">
                    {#if message.isLoading || message.isStreaming}


                      <div class="spinner">
                        <div class="loader"></div>
                      </div>
                    {/if}


                  </span>
                </div>
                <div class="assistant-message-footer">
                  {#if message.error}
                    <div class="error-placeholder" style="min-height: auto; padding: 5px 0; text-align: left;">
                      <span style="font-size: 0.9em; color: #ff8a8a;">Error: {message.error}</span>
                    </div>
                  {/if}
                </div>
              </div>
              <!-- Always show copy button, but control opacity -->
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
      showScrollButton={!isStartState && showScrollButton}
      onScrollToBottom={() => { $shouldAutoScroll = true; scrollToBottom(); }}
    />

  </div>
{/if}
</div>

<style lang="scss">


  .spinner{
    filter: drop-shadow(-2px 4px 4px rgba(#030025, .15));
    margin: 20px 0;
    transform-origin: center center;
    width: fit-content;
    animation: bouncer .5s infinite alternate-reverse ease-in-out;
  }
  .loader {
    width: 17px;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--highlight);
    display: grid;
    box-shadow: inset -2px -2px 8px rgba(black, .1), inset 1px 1px 3px rgba(white, .5);
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
    100% {transform: rotate(1turn) scale(1)}
  }
  @keyframes l22 {
    100% {transform: rotate(1turn) translate(150%)}
  }
  @keyframes bouncer{
    0%{
      transform: scale(1);
    }
    100%{
      transform: scale(.8);
    }

  }

  #main {
    height: 100%;
    max-height: 100vh;
    position: relative;
    touch-action: pan-y pan-x;
    -webkit-overflow-scrolling: touch;
    display: flex;

    $highlight: var(--highlight);
  }



  #panel{
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 32px;
    gap: 16px;

    .log{
      background: rgba(black, .08);
      flex: 1;
      border-radius: 8px;
      padding: 12px;
    }
  }

  :global(.app){
    position: fixed;
    top: 0;
    left: 0;

  }

  .global-refresh-button {
    position: absolute;
    top: 16px;
    left: 16px;
    z-index: 1000;
    padding: 8px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: none;
    background-color: var(--highlight);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: .2s ease;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
    touch-action: manipulation;

    svg {
      height: 14px;
      width: 14px;
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
      // filter: drop-shadow(-8px 16px 24px rgba(#030025, 0.1));
    }

    video{
      height: 200px;
      filter: brightness(101%);
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
    gap: 8px;

    @media screen and (max-width: 800px) {
      gap: 20px;
    }

    .carousel-container {
      position: relative;
      width: 100%;
      overflow: hidden;
      height: 60px;
      touch-action: pan-y;
      margin: 0;
      padding: 0;

      &:nth-child(2) {
        margin-top: -8px;
      }
    }

    .carousel-track {
      display: flex;
      gap: 12px;
      padding: 0px 0;
      width: fit-content;
      animation-duration: 30s;
      animation-timing-function: linear;
      animation-iteration-count: infinite;
      will-change: transform;
      touch-action: pan-y;

      &.carousel-left-to-right {
        animation-name: scrollLeftToRight;
      }

      &.carousel-right-to-left {
        animation-name: scrollRightToLeft;
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

    @keyframes scrollRightToLeft {
      0% {
        transform: translateX(0%);
      }
      100% {
        transform: translateX(-50%);
      }
    }

    .carousel-gradient {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 120px;
      pointer-events: none;
      z-index: 2;

      &.carousel-gradient-left {
        left: 0;
        background: linear-gradient(to right, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.8) 50%, rgba(255, 255, 255, 0) 100%);
      }

      &.carousel-gradient-right {
        right: 0;
        background: linear-gradient(to left, rgba(255, 255, 255, 1) 0%, rgba(255, 255, 255, 0.8) 50%, rgba(255, 255, 255, 0) 100%);
      }
    }


    .prompt-card {
      background: rgba(red, .08);
      border-radius: 10px;
      padding: 10px 18px;
      cursor: pointer;
      width: fit-content;
      min-width: 180px; // Ensure consistent card sizes
      transition: all 0.2s cubic-bezier(0.4,0,0.2,1);
      flex-shrink: 0; // Prevent cards from shrinking
      //border: 1px solid rgba(#00106D, .1);
      margin: 0;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background: rgba(red, .12);
        //transform: translateY(-1px);
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
        font-family: "Inter", "ivypresto-headline", sans-serif;
        font-size: 14px;
        font-weight: 400;
        letter-spacing: -.25px;
        color: #003025;
        text-shadow: -.5px 0 0 #00106D;
        line-height: 140%;
        display: block;
        text-align: center;
        white-space: nowrap;
      }
    }

    @media (max-width: 800px) {
      .carousel-track {
        animation-duration: 25s;
        height: 100%;
      }

      .carousel-container {
        height: 90px;
      }

      .carousel-gradient {
        width: 60px; // Smaller gradients on mobile
      }

      .prompt-card {
        width: 120px;
        padding: 12px 16px;
        margin: 0;
        height: auto;

        .prompt-text {
          width: 100%;
          text-wrap: wrap;
          white-space: normal;
          text-align: left;
          line-height: 120%;
        }
      }
    }

    // Hide second row of prompts when screen height is less than 720px
    @media (max-height: 720px) {
      .carousel-container {
        &:nth-child(2) {
          display: none;
        }
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

  #chat-page{
    width: 100%;
    max-width: 100%;
    padding: 0;
    box-sizing: border-box;
  }

  .chat-messages-container {
    overflow-y: auto;
    height: 100%;
    max-height: 100vh;
    padding: 16px 24px 200px 24px;

    max-width: 100%;

    margin: auto;


    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
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
    width: 85%;
    max-width: 900px;
    box-sizing: border-box;
    flex-grow: 0;
    margin: 0 auto;


    &.user {
      margin: 32px auto 12px auto;
      .message-content-area{
        justify-content: flex-start;
        align-items: center;
        gap: 12px;
      }

      .message-copy-btn{
       opacity: 0;
      }

      &:hover{
        .message-copy-btn{
          opacity: 1;
        }
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
      background: white;
      font-family: "ivypresto-headline", 'Newsreader', serif;
      text-shadow: -.4px 0 0 #030025;
      font-size: 16px;
      font-weight: 500;
      letter-spacing: .5px;
      position: relative;
      padding: 10px 16px 12px 16px;
      border-radius: 14px;
      color: #030025;
      margin-left: 12px;

      box-shadow: -4px 12px 18px rgba(#030025, .03);
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
    color: rgba(#030025, 0.25);
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: .2s ease;

    &:hover {
      color: rgba(#030025, 0.9);
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


    :global(p), :global(ul), :global(ol), :global(h5), :global(h6), :global(td) {
      font-size: 14px;
      font-weight: 500;
      line-height: 1.5;
      letter-spacing: -.25px;
      color: rgba(#030025, 1);
      margin: 12px 0;

      font-family: "Hedvig Letters Serif", serif;

      font-family:  'Inter', sans-serif;
      letter-spacing: -.5px;
      font-weight: 450;

    }

    :global(th){
      padding-top: 20px !important;
    }

    :global(th:first-child){
      padding-left: 24px !important;
    }

    :global(th:last-child){
      padding-right: 24px !important;
    }

    :global(tr td:first-child){
      padding-left: 24px !important;
    }

    :global(tr td:last-child){
      padding-right: 24px !important;
    }

    :global(tr:last-child td){
      padding-bottom: 24px !important;
    }


    :global(table){
      background: white;
      box-shadow: -12px 18px 48px rgba(#030025, 0.1);
      border-radius: 12px;
      margin: 24px 0 36px 0 !important;
     // margin-bottom: 24px !important;
    }


    :global(h1){
      font-family: "ivypresto-headline", serif;
      font-size: 24px;
      font-weight: 500;
      letter-spacing: .3px;
      line-height: 1.1;
      text-shadow: -.5px 0 0 #030025;
      margin: 32px 0 18px 0;

      font-family: 'Hedvig Letters Serif', 'DM Serif Display', serif;
      font-family: 'Inter', sans-serif;
      letter-spacing: -.5px;
      font-weight: 650;
    }
    :global(h2){
      font-family: "ivypresto-headline", serif;
      font-size: 18px;
      font-weight: 500;
      letter-spacing: 0.2px;
      line-height: 1.1;

      font-family: 'Hedvig Letters Serif', 'DM Serif Display', serif;
      font-family: 'Inter', sans-serif;
      letter-spacing: -.6px;
      font-weight: 650;
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
      background-color: rgba(#030020, 1);
      padding: 38px 24px 20px 24px;
      border-radius: 12px;
      margin: 32px 0 40px 0;
      box-shadow: -8px 12px 48px rgba(#030025, .36);
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
      margin: 12px 0;
      padding-left: 18px;
    }

    :global(li) {
      margin: 8px 0;
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
    box-shadow: -4px 8px 8px rgba(#030025, 0.5);
    border-radius: 18px;
    .action-pill-icon {
      color: #6355FF;
      stroke-width: 2.5;
    }
  }

  .reasoning-pill {
    background-color: rgba(white, 0.8);
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

  /* Word animation styles */
  :global(.animated-word) {
    display: inline;
    /* transition: opacity 50ms linear; */ /* REMOVE THIS LINE */
  }

  :global(.word-animated) {
    display: inline;
    opacity: 1;
    transform: translateY(0);
  }

  /* Remove the old streaming-word-fade-in class since we're not using it anymore */

  .scroll-to-bottom-btn {
    /* Styles moved to Omnibar component */
  }

  .auto-scroll-status {
    display: none;
    position: fixed;
    top: 16px;
    right: 16px;
    background-color: rgba(0, 0, 0, 0.6);
    color: white;
    padding: 6px 12px;
    border-radius: 16px;
    font-size: 12px;
    font-weight: 500;
    z-index: 1000;
    pointer-events: none; // Don't interfere with clicks
    transition: all 0.3s ease;

    &.active {
      background-color: var(--highlight);
      box-shadow: 0 0 8px rgba(99, 85, 255, 0.5);
    }
  }
</style>
