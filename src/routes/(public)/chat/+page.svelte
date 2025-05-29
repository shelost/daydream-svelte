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

  interface AnimatedWord {
    id: string;
    text: string;
    addedTime: number;
    currentOpacity: number;
  }

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string; // Content displayed to user (with animations)
    rawContent?: string; // Raw streaming content (not displayed directly)
    isLoading?: boolean; // For assistant message, indicates waiting for response
    isStreaming?: boolean; // For assistant message, indicates text streaming
    modelUsed?: string; // For assistant message, which model generated the response
    error?: string; // For assistant message, if an error occurred
    animatedWords?: AnimatedWord[];
    _lastProcessedContentLength?: number;
    _previousContent?: string; // Track previous content for DOM diffing
  }

  let messages: Message[] = [];
  let omnibarPrompt: string = ''; // Bound to Omnibar's additionalContext
  let isOverallLoading: boolean = false; // Tracks if a response is being generated
  let currentSelectedTextModel: string = 'claude-3-7-sonnet-20250219'; // Updated default text model
  let currentAbortController: AbortController | null = null; // For stopping generation
  let currentFollowUpQuestions: string[] = []; // For follow-up prompts to show above Omnibar

  // Browser automation state
  let browserSessionId: string | null = null;
  let browserScreenshot: string | null = null;
  let isBrowserLoading: boolean = false;
  let browserUrl: string = 'https://google.com';
  let showBrowserViewport: boolean = true;

  // Browser auto-initialization function
  async function initializeBrowser() {
    if (browserSessionId) return; // Already initialized

    console.log('🚀 Auto-initializing browser session...');
    isBrowserLoading = true;

    try {
      const response = await fetch('/api/browserbase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'go to https://google.com',
          chatId: 'auto-init-' + generateUniqueId()
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('✅ Browser auto-initialized:', result);

        if (result.results && result.results.length > 0) {
          const screenshotResult = result.results.find(r => r.data && r.data.screenshot);
          if (screenshotResult) {
            browserScreenshot = screenshotResult.data.screenshot;
            browserSessionId = result.sessionId || 'auto-session';
            console.log('📸 Browser screenshot captured, viewport should show');
          }
        }
      }
    } catch (error) {
      console.error('❌ Browser auto-initialization failed:', error);
    } finally {
      isBrowserLoading = false;
    }
  }

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

  // Animation constants for staggered word fade-in
  const WORD_FADE_DURATION = 800; // Duration for each word fade-in animation
  const WORD_STAGGER_DELAY = 100; // Delay between each word animation
  const INITIAL_WORD_OPACITY = 0.0; // Starting opacity for new words
  const FINAL_WORD_OPACITY = 1.0; // Final opacity for words

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

  // Function to animate new words with staggered fade-in effect
  function animateNewWords(container, previousContent, currentContent) {
    if (!container || !currentContent || currentContent === previousContent) return;

    requestAnimationFrame(() => {
      try {
        // Calculate the length of new content
        const previousLength = previousContent ? previousContent.length : 0;
        const newContentLength = currentContent.length - previousLength;

        if (newContentLength <= 0) return;

        // Find all text nodes in the container
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_TEXT,
          null
        );

        const textNodes = [];
        let node;
        while (node = walker.nextNode()) {
          textNodes.push(node);
        }

        // Process text nodes to find and animate new content
        let totalProcessedLength = 0;
        let wordCount = 0;

        for (const textNode of textNodes) {
          const nodeText = textNode.textContent || '';
          const nodeStartPos = totalProcessedLength;
          const nodeEndPos = totalProcessedLength + nodeText.length;

          // Check if this text node contains new content
          if (nodeEndPos > previousLength) {
            const newContentStart = Math.max(0, previousLength - nodeStartPos);

            if (newContentStart < nodeText.length) {
              // Split the text node to isolate new content
              const existingText = nodeText.substring(0, newContentStart);
              const newText = nodeText.substring(newContentStart);

              if (newText.trim()) {
                // Split new text into words
                const words = newText.split(/(\s+)/);

                // Replace the text node with existing text + animated words
                const parent = textNode.parentNode;
                if (parent) {
                  // Create existing text node
                  if (existingText) {
                    const existingTextNode = document.createTextNode(existingText);
                    parent.insertBefore(existingTextNode, textNode);
                  }

                  // Create animated spans for new words
                  words.forEach((word, index) => {
                    if (word.trim()) {
                      const span = document.createElement('span');
                      span.textContent = word;
                      span.className = 'animated-word';
                      span.style.opacity = INITIAL_WORD_OPACITY.toString();
                      span.style.transition = `opacity ${WORD_FADE_DURATION}ms ease-out`;

                      parent.insertBefore(span, textNode);

                      // Animate with staggered delay
                      setTimeout(() => {
                        span.style.opacity = FINAL_WORD_OPACITY.toString();
                      }, wordCount * WORD_STAGGER_DELAY);

                      wordCount++;
                    } else if (word) {
                      // Preserve whitespace
                      const whitespaceNode = document.createTextNode(word);
                      parent.insertBefore(whitespaceNode, textNode);
                    }
                  });

                  // Remove the original text node
                  parent.removeChild(textNode);
                }
              }
            }
          }

          totalProcessedLength += nodeText.length;
        }
      } catch (error) {
        console.warn('Error in animateNewWords:', error);
      }
    });
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
  function copyMessage(content, button) {
    copyWithFeedback(button, content || '');
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

    // Create new AbortController for this request
    currentAbortController = new AbortController();

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

    try {
      // First, check if this is a browser automation command
      console.log('🔍 Checking browser command for:', currentPrompt);
      const browserResponse = await fetch('/api/browserbase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentPrompt,
          chatId: userMessageId // Use user message ID as chat session ID
        }),
        signal: currentAbortController?.signal
      });

      console.log('🌐 Browser response status:', browserResponse.status);
      if (browserResponse.ok) {
        const browserResult = await browserResponse.json();
        console.log('🤖 Browser result:', browserResult);

        if (browserResult.isBrowserCommand) {
          // This is a browser command, handle the result
          let responseContent = `${browserResult.message}\n\n`;

          // Display action results
          if (browserResult.results && browserResult.results.length > 0) {
            responseContent += `**Actions performed:**\n`;
            browserResult.results.forEach((result, index) => {
              if (result.success) {
                responseContent += `✅ ${browserResult.actions[index]}\n`;
              } else {
                responseContent += `❌ ${browserResult.actions[index]}: ${result.error}\n`;
              }
            });

            // Update floating browser viewport with latest screenshot
            const screenshotResult = browserResult.results.find(r => r.data && r.data.screenshot);
            if (screenshotResult) {
              browserScreenshot = screenshotResult.data.screenshot;
              responseContent += `\n**Current page:**\n![Screenshot](data:image/png;base64,${screenshotResult.data.screenshot})`;
            }
          }

          // Update the assistant message with browser automation result
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
          return; // Exit early, don't send to AI
        }
      }

      // Not a browser command, proceed with normal AI chat
      // Update the message to show it's going to AI
      messages = messages.map(msg =>
        msg.id === assistantMessageId
          ? {
              ...msg,
              isStreaming: true,
              modelUsed: currentSelectedTextModel
            }
          : msg
      );

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
        const modelIdentityGuide = `You are ${getModelLabel(currentSelectedTextModel)}, a helpful AI assistant created by Anthropic.

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

      const apiProvider = currentSelectedTextModel.startsWith('claude') ? 'Anthropic' :
                         currentSelectedTextModel.startsWith('gemini') ? 'Google' : 'OpenAI';

      const response = await fetchAndLog(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: currentAbortController?.signal
      }, {
        page: 'Chat',
        model: currentSelectedTextModel,
        apiProvider: apiProvider
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

              // Apply word animation to the new content
              const container = markdownContainers[assistantMessageId];
              if (container) {
                const message = messages.find(msg => msg.id === assistantMessageId);
                if (message) {
                  animateNewWords(container, message._previousContent || '', message.content || '');
                }
              }
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
              const previousContent = msg._previousContent || '';
              let currentContent = msg.content || '';
              currentContent += processedChunk;

              return {
                ...msg,
                content: currentContent,
                _previousContent: previousContent
              };
            }
            return msg;
          });

          // Apply word animation to new content immediately
          const container = markdownContainers[assistantMessageId];
          if (container) {
            const message = messages.find(msg => msg.id === assistantMessageId);
            if (message) {
              // Call animation with correct previous/current content tracking
              animateNewWords(container, message._previousContent || '', message.content || '');
              // Update the previous content tracker after animation
              message._previousContent = message.content || '';
            }
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
            _previousContent: ''
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


   omnibarPrompt = question;
   currentFollowUpQuestions = []; // Clear follow-up prompts


   // Auto-submit the follow-up question
   handleOmnibarSubmit();
 }


 onMount(() => {
   const browser = typeof window !== 'undefined';
   if (browser) {
       // Auto-initialize browser session
       initializeBrowser();

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






<svelte:head>
 <title> Chat </title>
</svelte:head>




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
     <img src="/opal.png" alt="Stanley" class="stan-avatar">
     <h2> Chat </h2>
   </div>


   <!-- Example Prompts Section -->
   <div class="example-prompts" in:fade={{ delay: 500, duration: 500 }}>
     <!-- First carousel row - scrolls left to right -->
     <div class="carousel-container">
       <div class="carousel-track carousel-left-to-right">
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


         <!-- Duplicate for seamless loop -->
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
     <div class="carousel-container second">
       <div class="carousel-track carousel-right-to-left">
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


         <!-- Duplicate for seamless loop -->
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
                 <Markdown content={message.content} on:rendered={() => {
                   highlightCodeBlocks(markdownContainers[message.id]);
                   if (message.isStreaming) {
                     setupStreamingCodeHighlighter(markdownContainers[message.id], message.id);
                   }
                 }} />
                 <!-- Cursor and thinking text container -->
                 <span class="cursor-and-thinking-container">
                   <!-- Always render a cursor placeholder to prevent layout shift -->
                   <span class="cursor-placeholder">
                     {#if message.isStreaming}
                       <span class="animated-cursor cursor-fade" style="opacity:1;">
                         <!--
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                           <circle cx="9" cy="9" r="6" fill="#6355FF">
                             <animate attributeName="r" values="7;9;7" dur="1s" repeatCount="indefinite" />
                             <animate attributeName="opacity" values="1;1;1" dur="1s" repeatCount="indefinite" />
                           </circle>
                         </svg>
                        -->
                         <div class="loader"></div>
                       </span>
                     {:else}
                       <span class="animated-cursor cursor-fade" style="opacity:0; pointer-events:none;">
                         <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                           <circle cx="9" cy="9" r="6" fill="#6355FF" opacity="0" />
                         </svg>

                          <div class="loader"></div>

                       </span>
                     {/if}
                   </span>
                   <!-- Thinking text next to cursor -->
                   {#if message.isLoading}
                     <span class="thinking-text">
                       <span>Thinking...</span>
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
   />


 </div>
{/if}

<!-- Floating Browser Viewport -->
{#if showBrowserViewport && (browserScreenshot || isBrowserLoading)}
  <div class="browser-viewport" in:fade={{ duration: 300 }}>
    <div class="browser-header">
      <div class="browser-controls">
        <div class="browser-dot red"></div>
        <div class="browser-dot yellow"></div>
        <div class="browser-dot green"></div>
      </div>
      <div class="browser-title">Google</div>
      <button
        class="browser-close"
        on:click={() => showBrowserViewport = false}
        title="Close browser viewport"
      >
        ×
      </button>
    </div>
    <div class="browser-content">
      {#if isBrowserLoading}
        <div class="browser-loading">
          <div class="loader"></div>
          <p>Initializing browser...</p>
        </div>
      {:else if browserScreenshot}
        <img
          src="data:image/png;base64,{browserScreenshot}"
          alt="Browser screenshot"
          class="browser-screenshot"
        />
      {/if}
    </div>
  </div>
{/if}
</div>


<style lang="scss">
 // Global styles from original file are kept, assuming they are desired.
 // Minimal changes below, mostly to adapt or slightly adjust for text chat.


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




 #main{
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
   // Ensure button doesn't interfere with touch scrolling
   touch-action: manipulation;


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
   // Enable touch scrolling for start state on mobile
   overflow-y: auto;
   -webkit-overflow-scrolling: touch;
   touch-action: pan-y;
 }


 .welcome-header {
   text-align: center;
   margin-bottom: 20px; // Reduced margin
   img{
     height: 140px;
     filter: drop-shadow(-8px 16px 24px rgba(#030025, 0.1));
   }
   h2 {
     font-family: "ivypresto-headline", 'Newsreader', serif;
     font-size: 64px; // Slightly smaller
     font-weight: 500;
     letter-spacing: -.4px;
     margin: 4px 0 8px 0;
     color: #030025;
   }
   p {
     font-size: 15px;
     color: rgba(white, .4);
     margin: 0;
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


   @media screen and (max-width: 800px) {
     gap: 8px;
   }


   .prompts-label {
     text-align: center;
     font-size: 16px;
     color: rgba(#00106D, .6);
     margin-bottom: 16px;
     font-weight: 500;
   }


   .carousel-container {
     position: relative;
     width: 100%;
     overflow: hidden;
     height: 60px; // Fixed height for consistent layout
     // Ensure carousel doesn't interfere with page scrolling
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
     // Allow vertical scrolling on carousel
     touch-action: pan-y;


     &.carousel-left-to-right {
       animation-name: scrollLeftToRight;
     }


     &.carousel-right-to-left {
       animation-name: scrollRightToLeft;
     }


     // Pause animation on hover for better UX
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

 // Floating Browser Viewport Styles
 .browser-viewport {
   position: fixed;
   bottom: 24px;
   right: 24px;
   width: 400px;
   height: 300px;
   background: white;
   border-radius: 12px;
   box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
   z-index: 1001;
   overflow: hidden;
   border: 1px solid rgba(0, 0, 0, 0.1);

   @media (max-width: 768px) {
     width: 320px;
     height: 240px;
     bottom: 16px;
     right: 16px;
   }
 }

 .browser-header {
   display: flex;
   align-items: center;
   justify-content: space-between;
   height: 32px;
   background: #f6f6f6;
   border-bottom: 1px solid #e0e0e0;
   padding: 0 12px;
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

   &.red {
     background: #ff5f57;
   }

   &.yellow {
     background: #ffbd2e;
   }

   &.green {
     background: #28ca42;
   }
 }

 .browser-title {
   font-size: 12px;
   font-weight: 500;
   color: #333;
   text-align: center;
   flex: 1;
 }

 .browser-close {
   background: none;
   border: none;
   font-size: 16px;
   color: #666;
   cursor: pointer;
   width: 20px;
   height: 20px;
   display: flex;
   align-items: center;
   justify-content: center;
   border-radius: 4px;
   transition: background-color 0.2s;

   &:hover {
     background: rgba(0, 0, 0, 0.1);
   }
 }

 .browser-content {
   height: calc(100% - 32px);
   display: flex;
   align-items: center;
   justify-content: center;
   background: white;
 }

 .browser-loading {
   display: flex;
   flex-direction: column;
   align-items: center;
   gap: 12px;
   color: #666;

   p {
     margin: 0;
     font-size: 14px;
   }
 }

 .browser-screenshot {
   width: 100%;
   height: 100%;
   object-fit: cover;
   border: none;
 }




</style>
