<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  import {fly, scale, fade} from 'svelte/transition';
  export let settingType = 'image'; // 'image', 'text', etc.
  export let additionalContext = '';
  export let selectedFormat = 'png';
  export let currentSelectedModel = 'gpt-image-1';
  export let isGenerating = false;
  export let onSubmit = () => {};
  export let parentDisabled = false; // External conditions for disabling

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

  // Reactive combined disabled state
  $: isDisabled = isGenerating || parentDisabled;

</script>

<div class="omnibar" in:fly={{ y: 50, duration: 400 }}>
  <form on:submit|preventDefault={onSubmit} class="input-form">
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
        class="submit-button-omnibar"
        disabled={isDisabled}
        title={isGenerating ? 'Generating...' : (settingType === 'image' ? 'Generate Image' : 'Generate Text')}
      >
        {#if isGenerating}
          <div class="mini-spinner-omnibar"></div>
        {:else}
          <span class="material-symbols-outlined">arrow_upward</span>
        {/if}
      </button>
    </div>
  </form>
</div>

<style lang="scss">
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
    }

    .mini-spinner-omnibar {
      width: 20px; /* Increased size slightly for visibility */
      height: 20px; /* Increased size slightly for visibility */
      border: 3px solid rgba(255, 255, 255, 0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spinner-kf 0.8s linear infinite;
    }

    @keyframes spinner-kf {
      to {
        transform: rotate(360deg);
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