<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import { selectedTool } from '$lib/stores/canvasStore';

  // Props for the component
  export let activateImageUpload: () => void; // Function to trigger file input for image upload
  export let shapeType: string = 'rectangle'; // Default shape, can be bound from parent

  // Shape selection logic
  let showShapeDropdown: boolean = false;
  let shapeDropdownElement: HTMLElement;
  let shapeToolButtonElement: HTMLElement; // This is the group <div>
  let mainShapeButtonElement: HTMLElement; // Reference to the main shape button
  let shapeDropdownTopPosition = '0px'; // For dynamic positioning
  let shapeDropdownLeftPosition = '0px'; // For horizontal positioning

  // For shape selection dropdown
  const shapeOptionsList = [
    { type: 'rectangle', icon: 'check_box_outline_blank' },
    { type: 'circle',    icon: 'circle' },
    { type: 'triangle',  icon: 'change_history' }
  ];

  $: currentShapeIcon = shapeOptionsList.find(s => s.type === shapeType)?.icon || 'check_box_outline_blank';

  // Reactive update for dropdown position
  $: if (showShapeDropdown && mainShapeButtonElement) {
    const rect = mainShapeButtonElement.getBoundingClientRect();
    if (rect) {
      // Position the dropdown directly above the main shape button
      const buttonCenter = rect.left + (rect.width / 2);
      shapeDropdownLeftPosition = `${buttonCenter - 24}px`; // Center the 48px dropdown over the button
      shapeDropdownTopPosition = `${rect.top - 8}px`; // Position above the button with a small gap
    }
  }

  // Click outside to close shape dropdown
  function handleClickOutside(event: MouseEvent) {
    if (showShapeDropdown && shapeDropdownElement && !shapeDropdownElement.contains(event.target as Node) && shapeToolButtonElement && !shapeToolButtonElement.contains(event.target as Node)) {
      showShapeDropdown = false;
    }
  }

  onMount(() => {
    window.addEventListener('click', handleClickOutside);
  });

  onDestroy(() => {
    window.removeEventListener('click', handleClickOutside);
  });
</script>

<div class="toolbar tool-selector-toolbar">
  <button
    class="tool-button"
    class:active={$selectedTool === 'select'}
    on:click={() => selectedTool.set('select')}
    title="Select Tool"
  >
    <span class="material-symbols-outlined">
      arrow_selector_tool
    </span>
  </button>
  <button
    class="tool-button"
    class:active={$selectedTool === 'pen'}
    on:click={() => selectedTool.set('pen')}
    title="Pen Tool"
  >
    <span class="material-symbols-outlined">
      edit
    </span>
  </button>
  <button
    class="tool-button"
    class:active={$selectedTool === 'eraser'}
    on:click={() => selectedTool.set('eraser')}
    title="Eraser Tool"
  >
    <span class="material-symbols-outlined">
      ink_eraser
    </span>
  </button>
  <button
    class="tool-button"
    class:active={$selectedTool === 'text'}
    on:click={() => selectedTool.set('text')}
    title="Text Tool"
  >
    <span class="material-symbols-outlined">
      title
    </span>
  </button>

  <!-- SHAPE TOOL BUTTON -->
  <div class="tool-button-group" bind:this={shapeToolButtonElement}>
    <button
      class="tool-button main-shape-button"
      class:active={$selectedTool === 'shape'}
      on:click={() => {
        selectedTool.set('shape');
        showShapeDropdown = false; // Close dropdown if open
      }}
      title="Shape Tool ({shapeType})"
      bind:this={mainShapeButtonElement}
    >
      <span class="material-symbols-outlined">
        {currentShapeIcon}
      </span>
    </button>
    <button
      class="tool-button shape-dropdown-trigger"
      on:click|stopPropagation={() => showShapeDropdown = !showShapeDropdown}
      title="Select Shape"
    >
      <span class="material-symbols-outlined">
        {showShapeDropdown ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
      </span>
    </button>
  </div>

  {#if showShapeDropdown}
    <div
      class="shape-select-dropdown"
      bind:this={shapeDropdownElement}
      style="position: fixed; left: {shapeDropdownLeftPosition}; top: {shapeDropdownTopPosition}; transform: translateY(-100%);"
      transition:fade={{duration: 150}}
    >
      {#each shapeOptionsList as shapeOpt}
        <button
          class="tool-button dropdown-item"
          class:active={shapeType === shapeOpt.type && $selectedTool === 'shape'}
          on:click={() => {
            shapeType = shapeOpt.type;
            selectedTool.set('shape');
            showShapeDropdown = false;
          }}
          title="{shapeOpt.type.charAt(0).toUpperCase() + shapeOpt.type.slice(1)}"
        >
          <span class="material-symbols-outlined">{shapeOpt.icon}</span>
        </button>
      {/each}
    </div>
  {/if}

  <button
    class="tool-button"
    class:active={$selectedTool === 'image'}
    on:click={() => {
      selectedTool.set('image');
      activateImageUpload();
    }}
    title="Image Upload Tool"
  >
    <span class="material-symbols-outlined">
      upload
    </span>
  </button>
</div>

<style lang="scss">
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: fit-content;
    height: 48px;
    padding: 0 8px;
    gap: 8px;
    margin: 0;
    margin-top: 12px;
    background: white;
    border-radius: 12px;

    position: fixed;
    left: 24px;
    bottom: 24px;
    user-select: none;
  }

  .tool-button {
    padding: 6px;
    background: none;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 6px;

    span {
      font-size: 20px;
      font-weight: 400;
      color: #ccc; // Lighter icon color
      transition: color 0.2s, background-color 0.2s;
    }

    &:hover {
      background: rgba(white, 0.1);

      span {
        color: var(--highlight);
      }
    }

    &:active{
      transform: none;
    }

    // Active state for tool buttons
    &.active {
      background: rgba(black, .1);

      span {
        color: white;
      }
    }
  }

  .tool-button-group {
    display: flex;
    align-items: center;
    border-radius: 6px; // Match tool-button
    overflow: hidden; // Clip corners if needed
    width: fit-content; // Take full width of the slot in vertical toolbar

    .main-shape-button {
      flex-grow: 1; // Main button takes available space
      border-radius: 6px 0 0 6px; // Rounded left corners
      padding: 6px 0 6px 6px;
    }
    .shape-dropdown-trigger {
      padding: 8px 4px 8px 0;
      border-radius: 0 6px 6px 0; // Rounded right corners
      border-left: 1px solid rgba(white, 0.05); // Separator
      span {
        text-align: left;
        width: 12px;
        font-size: 16px; // Smaller arrow
      }
    }
    // Hover/active states for the group
    &:hover {
      .main-shape-button, .shape-dropdown-trigger {
       background: none;
         span {
          color: var(--highlight);
        }
      }
    }
    .main-shape-button.active, .main-shape-button.active + .shape-dropdown-trigger {
       background: var(--highlight);
        span {
          color: black;
        }
    }
     .main-shape-button.active:hover, .main-shape-button.active + .shape-dropdown-trigger {
        span {
          color: black;
        }
    }
  }

  .shape-select-dropdown {
    background: rgba(black, .45);
    backdrop-filter: blur(12px);
    border-radius: 8px;
    box-shadow: 0 -4px 12px rgba(black, 0.3);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 10; // Above other elements
    width: 48px; // Same width as toolbar buttons for consistency
    height: fit-content;

    .dropdown-item {
      width: 100%;
      box-sizing: border-box;
    }
  }
</style>
