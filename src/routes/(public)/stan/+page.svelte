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
    processedContent?: string; // Content with animation markup
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
  const SESSION_STORAGE_KEY = 'stanChatMessages';

  const generateUniqueId = () => `_${Math.random().toString(36).substring(2, 11)}`;

  let markdownContainers = new Map();

  // Word animation configuration for staggered fade-in
  const WORD_FADE_DURATION = 800; // Duration for each word to fade in (ms)
  const WORD_STAGGER_DELAY = 100; // Delay between each word starting to fade in (ms)

  // Function to wrap new words with animation spans
  function processStreamingContent(previousContent: string, currentContent: string, startTime: number): string {
    if (!currentContent || currentContent === previousContent) return currentContent;

    const previousLength = previousContent ? previousContent.length : 0;
    const newContentLength = currentContent.length - previousLength;

    if (newContentLength <= 0) return currentContent;

    // Get the new text that was added
    const newText = currentContent.substring(previousLength);

    // Split new text into words, preserving whitespace
    const words = newText.split(/(\s+)/);
    let wordIndex = 0;

    // Process each word and wrap it with animation markup
    const processedNewText = words.map(word => {
      if (word.trim().length === 0) {
        // Preserve whitespace as-is
        return word;
      }

      // Calculate animation delay for this word
      const delay = wordIndex * WORD_STAGGER_DELAY;
      const uniqueId = `word-${startTime}-${wordIndex}`;
      wordIndex++;

      // Wrap the word in a span with CSS animation
      return `<span class="animated-word" style="animation-delay: ${delay}ms;" data-word-id="${uniqueId}">${word}</span>`;
    }).join('');

    // Return previous content plus the processed new text
    return previousContent + processedNewText;
  }

  // Function to apply syntax highlighting to code blocks
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

  let messageObservers = new Map();

  function setupStreamingCodeHighlighter(container, messageId) {
    if (messageObservers.has(messageId)) {
      messageObservers.get(messageId).disconnect();
    }

    if (!container) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          const codeBlocks = container.querySelectorAll('pre code:not(.highlighted)');
          if (codeBlocks.length > 0) {
            codeBlocks.forEach(codeBlock => {
              addHeaderAndHighlight(codeBlock);
            });
          }
        }
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });

    messageObservers.set(messageId, observer);
    return observer;
  }

  function copyMessage(content, button) {
    copyWithFeedback(button, content || '');
  }

  async function scrollToBottom() {
    await tick();
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  }

  function handleClearChat() {
    if (isOverallLoading) return;

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
    currentFollowUpQuestions = [];
  }

  function clearChatAndStorage() {
    if (isOverallLoading) return;
    handleClearChat();
    const browser = typeof window !== 'undefined';
    if (browser) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      console.log('Stan chat history cleared from sessionStorage.');
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
          processedContent: undefined,
          error: undefined
        };
      }
      return msg;
    });
  }

  function parseFollowUpQuestions(content: string): { mainContent: string, followUpQuestions: string[] } {
    const followUpMatch = content.match(/⟪---FOLLOWUP---(.*?)---ENDFOLLOWUP---/s);

    if (followUpMatch) {
      const mainContent = content.replace(/⟪---FOLLOWUP---(.*?)---ENDFOLLOWUP---/s, '').trim();
      const followUpSection = followUpMatch[1].trim();

      const questions = followUpSection
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => {
          if (line.match(/^\d+\.\s*\[(.*)\]$/)) {
            return line.replace(/^\d+\.\s*\[(.*)\]$/, '$1');
          } else if (line.match(/^\d+\.\s*(.+)$/)) {
            return line.replace(/^\d+\.\s*(.+)$/, '$1');
          } else if (line.match(/^[-*]\s*(.+)$/)) {
            return line.replace(/^[-*]\s*(.+)$/, '$1');
          } else if (line.length > 5) {
            return line;
          }
          return null;
        })
        .filter(q => q && q.length > 0);

      return {
        mainContent,
        followUpQuestions: questions.slice(0, 3)
      };
    }

    return {
      mainContent: content,
      followUpQuestions: []
    };
  }

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
    const streamStartTime = Date.now();

    messages = [
      ...messages,
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        processedContent: '',
        isLoading: true,
        isStreaming: true,
        modelUsed: currentSelectedTextModel
      }
    ];

    try {
      let endpoint = '/api/ai/chat';
      let requestBody: any = {};

      const messagesHistory = messages
        .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.isLoading && !m.isStreaming && !m.error))
        .map(m => ({ role: m.role, content: m.content }));

      if (currentSelectedTextModel.startsWith('claude')) {
        endpoint = '/api/ai/anthropic';

        let formattedPrompt = '';
        if (messagesHistory && messagesHistory.length > 0) {
          formattedPrompt = messagesHistory
            .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
            .join('\n\n');

          if (currentPrompt && !messagesHistory.some(m =>
              m.role === 'user' && m.content.trim() === currentPrompt.trim())) {
            formattedPrompt += `\n\nHuman: ${currentPrompt}`;
          }
        } else {
          formattedPrompt = currentPrompt;
        }

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
      } else if (currentSelectedTextModel.startsWith('gemini')) {
        endpoint = '/api/ai/google';

        let formattedPrompt = '';
        if (messagesHistory && messagesHistory.length > 0) {
          formattedPrompt = messagesHistory
            .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
            .join('\n\n');

          if (currentPrompt && !messagesHistory.some(m =>
              m.role === 'user' && m.content.trim() === currentPrompt.trim())) {
            formattedPrompt += `\n\nHuman: ${currentPrompt}`;
          }
        } else {
          formattedPrompt = currentPrompt;
        }

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
      } else {
        endpoint = '/api/ai/chat';

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
      let followUpContent = '';
      let inFollowUpSection = false;

      messages = messages.map(msg =>
        msg.id === assistantMessageId ? { ...msg, isLoading: false, isStreaming: true, _previousContent: '' } : msg
      );

      const setupObserver = () => {
        if (markdownContainers[assistantMessageId]) {
          setupStreamingCodeHighlighter(markdownContainers[assistantMessageId], assistantMessageId);
        } else {
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

          if (chunk.includes('"apiLogEntry"')) {
            try {
              const logMatch = chunk.match(/\{[\s\n]*"apiLogEntry"[\s\n]*:[\s\n]*(\{.*\})[\s\n]*\}/s);
              if (logMatch && logMatch[1]) {
                console.log('Received API log entry');
                continue;
              }
            } catch (e) {
              console.log('Failed to parse API log entry', e);
            }
          }

          if (currentSelectedTextModel.startsWith('gemini')) {
            try {
              if (chunk.trim().startsWith('{') && chunk.trim().endsWith('}')) {
                const jsonResponse = JSON.parse(chunk);

                if (jsonResponse.message && typeof jsonResponse.message === 'object' && jsonResponse.message.content) {
                  processedChunk = jsonResponse.message.content;
                } else if (jsonResponse.message && typeof jsonResponse.message === 'string') {
                  processedChunk = jsonResponse.message;
                } else if (jsonResponse.content) {
                  processedChunk = jsonResponse.content;
                } else if (jsonResponse.text) {
                  processedChunk = jsonResponse.text;
                }

                if (processedChunk === chunk && typeof jsonResponse === 'object') {
                  const metadataKeys = ['usage', 'input_chars', 'output_chars', 'cost', 'durationMs', 'total_tokens'];
                  const hasMetadataKeys = metadataKeys.some(key => key in jsonResponse);

                  if (hasMetadataKeys) {
                    const filtered = { ...jsonResponse };
                    metadataKeys.forEach(key => delete filtered[key]);
                    processedChunk = JSON.stringify(filtered);
                  }
                }

                if (jsonResponse.error) {
                  console.error('Error in Gemini response:', jsonResponse.error);
                }
              }
            } catch (e) {
              console.log('Could not parse Gemini response as JSON:', e);
            }
          }

          if (!inFollowUpSection && processedChunk.includes('⟪')) {
            const delimiterIndex = processedChunk.indexOf('⟪');
            const beforeDelimiter = processedChunk.substring(0, delimiterIndex);
            const afterDelimiter = processedChunk.substring(delimiterIndex);

            if (beforeDelimiter) {
              assistantContent += beforeDelimiter;
              messages = messages.map(msg => {
                if (msg.id === assistantMessageId && msg.isStreaming) {
                  const previousContent = msg._previousContent || '';
                  let currentContent = msg.content || '';
                  currentContent += beforeDelimiter;

                  const processedContent = processStreamingContent(previousContent, currentContent, streamStartTime);

                  return {
                    ...msg,
                    content: currentContent,
                    processedContent: processedContent,
                    _previousContent: previousContent
                  };
                }
                return msg;
              });
            }

            inFollowUpSection = true;
            followUpContent = afterDelimiter;

            const tempFollowUpResult = parseFollowUpQuestions('⟪' + followUpContent);
            if (tempFollowUpResult.followUpQuestions.length > 0) {
              currentFollowUpQuestions = tempFollowUpResult.followUpQuestions;
            }

            continue;
          }

          if (inFollowUpSection) {
            followUpContent += processedChunk;

            const tempFollowUpResult = parseFollowUpQuestions('⟪' + followUpContent);
            if (tempFollowUpResult.followUpQuestions.length > 0) {
              currentFollowUpQuestions = tempFollowUpResult.followUpQuestions;
            }

            continue;
          }

          assistantContent += processedChunk;
          messages = messages.map(msg => {
            if (msg.id === assistantMessageId && msg.isStreaming) {
              const previousContent = msg._previousContent || '';
              let currentContent = msg.content || '';
              currentContent += processedChunk;

              const processedContent = processStreamingContent(previousContent, currentContent, streamStartTime);

              return {
                ...msg,
                content: currentContent,
                processedContent: processedContent,
                _previousContent: previousContent
              };
            }
            return msg;
          });
        }
      }

      messages = messages.map(msg => {
        if (msg.id === assistantMessageId) {
          const finalContent = (msg.content || "Sorry, I couldn't generate a response.").trim();
          return {
            ...msg,
            isStreaming: false,
            content: finalContent,
            processedContent: undefined,
            _previousContent: ''
          };
        }
        return msg;
      });

      const finalMessage = messages.find(msg => msg.id === assistantMessageId);
      if (finalMessage && finalMessage.content) {
        if (currentFollowUpQuestions.length === 0) {
          const parsedResult = parseFollowUpQuestions(finalMessage.content);

          messages = messages.map(msg =>
            msg.id === assistantMessageId
              ? { ...msg, content: parsedResult.mainContent }
              : msg
          );

          currentFollowUpQuestions = parsedResult.followUpQuestions;
        } else {
          const cleanedContent = finalMessage.content.replace(/⟪---FOLLOWUP---(.*?)---ENDFOLLOWUP---/s, '').trim();
          if (cleanedContent !== finalMessage.content) {
            messages = messages.map(msg =>
              msg.id === assistantMessageId
                ? { ...msg, content: cleanedContent }
                : msg
            );
          }
        }
      }

    } catch (error: any) {
      console.error(`Error with ${currentSelectedTextModel}:`, error);

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
              processedContent: undefined,
              _previousContent: ''
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

  onMount(() => {
    const browser = typeof window !== 'undefined';
    if (browser) {
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
                Prism = prismInstance;
                PrismLoaded = true;

                if (!document.querySelector('link[href*="prism-okaidia"]')) {
                  const link = document.createElement('link');
                  link.rel = 'stylesheet';
                  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-okaidia.min.css';
                  document.head.appendChild(link);
                }
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
                        isLoading: false,
                        isStreaming: false,
                        processedContent: undefined,
                        _previousContent: ''
                    }));
                    isStartState = !parsedMessages.some(msg => msg.role === 'user');
                    loadedSuccessfully = true;
                }
            } catch (e) {
                console.error('Failed to parse Stan chat history from sessionStorage:', e);
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
                const { isLoading, isStreaming, processedContent, ...rest } = msg;
                return rest;
            });
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(messagesToSave));
            scrollToBottom();
        } catch (e) {
            console.error('Failed to save Stan chat history to sessionStorage:', e);
        }
    }

    for (const message of messages) {
      if (message.role === 'assistant') {
        if (message.isStreaming) {
          if (markdownContainers[message.id] && !messageObservers.has(message.id)) {
            setupStreamingCodeHighlighter(markdownContainers[message.id], message.id);
          }
        } else if (!message.isStreaming && messageObservers.has(message.id)) {
          const observer = messageObservers.get(message.id);
          observer.disconnect();
          messageObservers.delete(message.id);

          if (markdownContainers[message.id]) {
            highlightCodeBlocks(markdownContainers[message.id]);
          }
        }
      }
    }
  }

  function handleExamplePrompt(promptText: string) {
    if (isOverallLoading) return;

    omnibarPrompt = promptText;
    handleOmnibarSubmit();
  }
</script>

<svelte:head>
  <title>Stanley</title>
  <link href = 'stan-avatar.png' rel = 'icon'>
</svelte:head>

