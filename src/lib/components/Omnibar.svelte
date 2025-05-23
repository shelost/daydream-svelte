<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onMount } from 'svelte';

  import {fly, scale, fade} from 'svelte/transition';
  export let settingType = 'image'; // 'image', 'text', etc.
  export let additionalContext = '';
  export let selectedFormat = 'png';
  export let currentSelectedModel = 'gpt-image-1';
  export let isGenerating = false;
  export let onSubmit = () => {};
  export let onStop = () => {}; // New prop for stopping generation
  export let parentDisabled = false; // External conditions for disabling
  export let followUpQuestions: string[] = []; // Follow-up questions to display
  export let onFollowUpClick = (question: string) => {}; // Callback for follow-up clicks

  // Define model lists based on settingType - these would be passed as props in a real scenario
  // For now, we'll define a default for image.
  export let imageModels = [];
  // Optional override; if empty, internal defaults are used for text setting
  export let textModels: Array<{ value: string; label: string }> = [];

  // Internal default model lists
  const defaultTextModels = [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
    { value: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
    { value: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash' }
  ];

  // Choose which list to render in the dropdown
  $: effectiveTextModels = textModels && textModels.length > 0 ? textModels : defaultTextModels;

  const dispatch = createEventDispatcher();

  // Svelte action for auto-resizing textarea
  function autoResize(node) {
    const MAX_HEIGHT = 160; // Max height in pixels
    const computedStyle = getComputedStyle(node);

    let singleLineContentHeight;
    const fs = parseFloat(computedStyle.fontSize);
    const lhStyle = computedStyle.lineHeight;

    if (lhStyle === 'normal') {
      singleLineContentHeight = Math.ceil(fs * 1.2);
    } else if (lhStyle.endsWith('px')) {
      singleLineContentHeight = parseFloat(lhStyle);
    } else if (lhStyle.endsWith('em')) {
      singleLineContentHeight = parseFloat(lhStyle) * fs;
    } else if (!isNaN(parseFloat(lhStyle))) {
      singleLineContentHeight = parseFloat(lhStyle) * fs;
    } else {
      singleLineContentHeight = Math.ceil(fs * 1.2);
    }

    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
    const cssMinContentHeight = parseFloat(computedStyle.minHeight) || 0;
    const effectiveSingleLineContentHeight = Math.max(singleLineContentHeight, cssMinContentHeight);
    const minTargetHeightForOneLine = effectiveSingleLineContentHeight + paddingTop + paddingBottom;

    function resize() {
      if (node.value === '') {
        node.style.height = minTargetHeightForOneLine + 'px';
        node.style.overflowY = 'hidden';
      } else {
        const prevHeightStyle = node.style.height;
        node.style.height = '1px';
        let currentContentScrollHeight = node.scrollHeight;
        node.style.height = prevHeightStyle;

        let targetHeight;
        const epsilon = 2;

        if (currentContentScrollHeight <= minTargetHeightForOneLine + epsilon) {
          targetHeight = minTargetHeightForOneLine;
        } else {
          targetHeight = currentContentScrollHeight;
        }

        if (targetHeight <= MAX_HEIGHT) {
          node.style.height = targetHeight + 'px';
          node.style.overflowY = 'hidden';
        } else {
          node.style.height = MAX_HEIGHT + 'px';
          node.style.overflowY = 'auto';
        }
      }
    }

    node.addEventListener('input', resize);
    setTimeout(resize, 0);

    return {
      destroy() {
        node.removeEventListener('input', resize);
      }
    };
  }

  function handleKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isGenerating && !parentDisabled) {
        onSubmit();
      }
    }
  }

  function handleButtonClick() {
    if (isGenerating) {
      onStop();
    } else if (!parentDisabled) {
      onSubmit();
    }
  }

  // Only disable when not generating and parentDisabled is true
  $: isDisabled = !isGenerating && parentDisabled;

  // Debug follow-up questions
  $: {
    console.log('🎭 Omnibar received followUpQuestions:', followUpQuestions);
    console.log('🎭 followUpQuestions length:', followUpQuestions?.length);
    console.log('🎭 followUpQuestions type:', typeof followUpQuestions);
  }

  let followUpContainer;

  // Function to handle follow-up question alignment based on content overflow
  function updateFollowUpAlignment() {
    if (followUpContainer) {
      // Force a layout calculation
      followUpContainer.offsetHeight;

      const containerWidth = followUpContainer.clientWidth;
      const contentWidth = followUpContainer.scrollWidth;
      const hasOverflow = contentWidth > containerWidth;

      console.log('🔍 Overflow check:', {
        containerWidth,
        contentWidth,
        hasOverflow,
        currentClasses: followUpContainer.className
      });

      if (hasOverflow) {
        followUpContainer.classList.add('has-overflow');
        console.log('✅ Added has-overflow class');
      } else {
        followUpContainer.classList.remove('has-overflow');
        console.log('❌ Removed has-overflow class');
      }
    }
  }

  // Update alignment when follow-up questions change with better timing
  $: if (followUpQuestions && followUpQuestions.length > 0) {
    // Use multiple timeouts to ensure DOM is fully rendered
    setTimeout(() => updateFollowUpAlignment(), 10);
    setTimeout(() => updateFollowUpAlignment(), 100);
    setTimeout(() => updateFollowUpAlignment(), 300);
  }

  // Set up resize observer to handle window resize
  onMount(() => {
    const resizeObserver = new ResizeObserver(() => {
      setTimeout(updateFollowUpAlignment, 50);
    });

    // Also listen for window resize events
    const handleResize = () => {
      setTimeout(updateFollowUpAlignment, 50);
    };

    window.addEventListener('resize', handleResize);

    if (followUpContainer) {
      resizeObserver.observe(followUpContainer);
    }

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  });

</script>

<div class="omnibar" in:fly={{ y: 50, duration: 400 }}>
  {#if followUpQuestions && followUpQuestions.length > 0}
    <div
      class="follow-up-questions"
      bind:this={followUpContainer}
      in:fly={{ y: 10, duration: 300, delay: 200 }}
      out:fade={{ duration: 150 }}
    >
      {#each followUpQuestions as question, index (question)}
        <button
          class="follow-up-pill"
          on:click={() => onFollowUpClick(question)}
          disabled={isGenerating}
          in:fly={{ y: 15, duration: 250, delay: index * 100 }}
        >
          {question}
        </button>
      {/each}
    </div>
  {/if}


  <div class = 'omnibar-container'>
  <form on:submit|preventDefault={handleButtonClick} class="input-form">
    <textarea
      class="text-input-area-omnibar"
      bind:value={additionalContext}
      placeholder={settingType === 'image' ? "What are you drawing?" : "Enter your prompt..."}
      use:autoResize
      on:keydown={handleKeydown}
      on:input={() => dispatch('update:additionalContext', additionalContext)}
    ></textarea>
    <div class="input-controls-row">
      <div class="select-row">
        {#if settingType === 'image'}
          <div class="select-wrapper format-select-wrapper-omnibar">
            <select
              id="format-selector-omnibar"
              bind:value={selectedFormat}
              on:change={() => dispatch('update:selectedFormat', selectedFormat)}
            >
              <option value="png">PNG</option>,
              <option value="svg">SVG</option>
            </select>
            <span class="material-icons custom-caret">expand_more</span>
          </div>
        {/if}

        <div class="select-wrapper model-select-wrapper-omnibar">
          <select
            id="model-selector-omnibar"
            bind:value={currentSelectedModel}
            disabled={settingType === 'image' && selectedFormat === 'svg'}
            on:change={() => dispatch('update:currentSelectedModel', currentSelectedModel)}
          >
            {#if settingType === 'image'}
              {#each imageModels as model (model.value)}
                <option value={model.value}>{model.label}</option>
              {/each}
            {:else if settingType === 'text'}
              {#each effectiveTextModels as model (model.value)}
                <option value={model.value}>{model.label}</option>
              {/each}
              <!-- <option value="gpt-4">GPT-4 (Text)</option> --> <!-- Placeholder -->
            {/if}
          </select>
          <span class="material-icons custom-caret">expand_more</span>
        </div>
      </div>
      <button
        type="submit"
        class="submit-button-omnibar {isGenerating ? 'stop-mode' : ''}"
        disabled={isDisabled}
        title={isGenerating ? 'Stop Generation' : (settingType === 'image' ? 'Generate Image' : 'Generate Text')}
        on:click={handleButtonClick}
      >
        {#if isGenerating}
          <span class="material-symbols-outlined stop-icon">stop</span>
        {:else}
          <span class="material-symbols-outlined">arrow_upward</span>
        {/if}
      </button>
    </div>
  </form>
</div>
</div>

<style lang="scss">
  .follow-up-questions {
    display: flex;
    gap: 8px;
    margin-bottom: -16px;
    max-width: 100%;
    width: 720px;
    padding: 24px;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* Internet Explorer 10+ */
    justify-content: center; /* Center by default */
    transition: justify-content 0.2s ease;

    @media screen and (max-width: 800px) {
      margin-bottom: -8px;
    }

    /* Apply gradient fade mask to create scroll shadows */
    mask: linear-gradient(
      to right,
      transparent 0,
      black 32px,
      black calc(100% - 32px),
      transparent 100%
    );
    -webkit-mask: linear-gradient(
      to right,
      transparent 0,
      black 32px,
      black calc(100% - 32px),
      transparent 100%
    );

    /* Hide scrollbar for Chrome/Safari */
    &::-webkit-scrollbar {
      display: none;
    }

    /* When content overflows, switch to left-aligned for better scrolling */
    &.has-overflow {
      justify-content: flex-start;
      padding: 0 32px;

      /* Adjust mask for scrolling content */
      mask: linear-gradient(
        to right,
        transparent 0,
        black 48px,
        black calc(100% - 48px),
        transparent 100%
      );
      -webkit-mask: linear-gradient(
        to right,
        transparent 0,
        black 48px,
        black calc(100% - 48px),
        transparent 100%
      );
    }

    @media screen and (max-width: 800px) {
      justify-content: flex-start;
      width: 100%;
      max-width: 90vw;
      padding: 16px;

      /* Adjust mask for smaller screens */
      mask: linear-gradient(
        to right,
        transparent 0,
        black 20px,
        black calc(100% - 20px),
        transparent 100%
      );
      -webkit-mask: linear-gradient(
        to right,
        transparent 0,
        black 20px,
        black calc(100% - 20px),
        transparent 100%
      );

      &.has-overflow {
        padding: 0 24px;

        /* Adjust mask for scrolling on mobile */
        mask: linear-gradient(
          to right,
          transparent 0,
          black 32px,
          black calc(100% - 32px),
          transparent 100%
        );
        -webkit-mask: linear-gradient(
          to right,
          transparent 0,
          black 32px,
          black calc(100% - 32px),
          transparent 100%
        );
      }
    }
  }

  .follow-up-pill {
    background: #6355FF;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 20px;
    padding: 8px 14px;
    color: rgba(255, 255, 255, 0.9);
    font-family: "Inter", sans-serif;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    text-align: center;
    line-height: 1.3;
    backdrop-filter: blur(10px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    white-space: nowrap;
    flex-shrink: 0;

    font-family: "ivypresto-headline", serif;

    font-size: 16px;
    font-weight: 500;
    letter-spacing: .4px;

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.25);
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    }

    &:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
  }

  .omnibar {
    width: 550px;
    max-width: 90vw;
    padding: 0;
    position: absolute; /* This might need to be relative if Omnibar is placed by parent */
    bottom: 12px;   /* Or controlled by parent's layout */
    left: calc(50% - 275px); /* Or controlled by parent's layout */
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 10; /* Ensure it's above other content if fixed */
    box-sizing: border-box;

    .omnibar-container{
      padding: 2px;
      width: 100%;
      align-self: stretch;
    }

    .input-form {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      width: 100%;
      background: rgba(20, 20, 22, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 8px;
      box-shadow: 0 16px 32px 8px rgba(black, 0.3);
      backdrop-filter: blur(20px);
      gap: 0px;
    }

    .text-input-area-omnibar {
      width: 100%;
      flex-grow: 1;
      background: transparent;
      border: none;
      color: white;
      font-family: "ivypresto-headline", serif;
      font-size: 20px;
      font-weight: 500;
      line-height: 130%;
      letter-spacing: .4px;
      padding: 10px 12px;
      border-radius: 12px;
      resize: none;
      overflow-y: auto;
      min-height: 20px; /* Should be dynamically set by autoResize for one line */
      max-height: 160px;
      transition: background-color 0.2s ease, box-shadow 0.2s ease;
      text-shadow: -.25px 0px 0px rgba(white, 0.9);
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.2) transparent;

      &::placeholder {
        color: #999;
        text-shadow: -.2px 0px 0px #999;
      }

      &:focus {
        outline: none;
      }
    }

    .input-controls-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 4px;
      width: 100%;

      .select-row {
        display: flex;
        align-items: center;
        justify-content: space-between; /* Changed from flex-start to space-between for better spacing */
        gap: 8px;
        flex-grow: 1; /* Allow select row to take available space */
      }
    }

    .model-select-wrapper-omnibar, .format-select-wrapper-omnibar {
      position: relative;

      select {
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        font-weight: 500;
        padding: 8px 32px 8px 10px;
        border-radius: 24px;
        color: #e0e0e0;
        background: rgba(white, .03);
        border: none;
        cursor: pointer;
        transition: background-color 0.2s ease, border-color 0.2s ease;
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;

        option {
          background-color: #333; /* Ensure dropdown options have a background */
          color: #e0e0e0;
        }

        &:hover {
          background: rgba(white, .05);
        }

        &:focus {
          outline: none;
          border-color: rgba(255, 255, 255, 0.2);
        }

        &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            background: rgba(black, 0.1);
        }
      }

      .custom-caret {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        color: rgba(255, 255, 255, 0.5);
        font-size: 18px;
        pointer-events: none;
      }
    }

    .submit-button-omnibar {
      width: 30px;
      height: 30px;
      padding: 0;
      border-radius: 24px;
      background: var(--highlight, #FF3D7F); /* Added fallback for --highlight */
      color: white;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: background-color 0.2s ease, opacity 0.2s ease;

      .material-symbols-outlined {
        font-size: 18px;
        font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      }

      &:hover:not(:disabled) {
        background: #ff3974; /* Specific hover color */
      }

      &:disabled {
        background: #4a4a50;
        cursor: not-allowed;
        opacity: 0.7;
      }

      &.stop-mode {
       background: #ff4444; /* Red background for stop button */
       background: #00106D;

        &:hover:not(:disabled) {
       //   background: #cd1111 !important;
       background: #1b2c8e !important;
        }

        .stop-icon {
          font-size: 16px;
          font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24;
        }
      }
    }
  }

  @media screen and (max-width: 800px) {
    .omnibar{
      width: 92vw;
      max-width: 100vw;
      left: calc(4vw - 12px);
      bottom: 6px;
    }


  }


</style>