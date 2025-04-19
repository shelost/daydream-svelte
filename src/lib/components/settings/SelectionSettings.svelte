<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { selectionStyles } from '$lib/stores/styleStore';
  import { drawingSettings } from '$lib/stores/drawingStore';
  import SliderControl from './SliderControl.svelte';
  import ToggleControl from './ToggleControl.svelte';

  export let selectedObjects: any[] = []; // Array of selected objects
  export let selectionType: 'canvas' | 'drawing' = 'canvas';

  const dispatch = createEventDispatcher();

  // Drawing-specific: clear selection
  function clearSelection() {
    if (selectionType === 'drawing') {
      drawingSettings.update(settings => ({
        ...settings,
        selectedStrokes: []
      }));
    } else {
      dispatch('clearSelection');
    }
  }

  // Function to handle opacity changes
  function setOpacity(value: number) {
    selectionStyles.update(styles => ({
      ...styles,
      opacity: value
    }));

    // Update selected objects
    updateSelectedObjects({opacity: value});
  }

  // Function to toggle lock state
  function toggleLock() {
    selectionStyles.update(styles => ({
      ...styles,
      locked: !styles.locked
    }));

    // Update selected objects
    updateSelectedObjects({selectable: !$selectionStyles.locked, lockMovementX: $selectionStyles.locked, lockMovementY: $selectionStyles.locked});
  }

  // Function to group selected objects
  function groupSelection() {
    selectionStyles.update(styles => ({
      ...styles,
      group: true
    }));

    dispatch('groupSelection');
  }

  // Function to ungroup selection
  function ungroupSelection() {
    selectionStyles.update(styles => ({
      ...styles,
      group: false
    }));

    dispatch('ungroupSelection');
  }

  // Function to align objects
  function alignSelection(alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    dispatch('alignSelection', { alignment });
  }

  // Function to distribute objects
  function distributeSelection(direction: 'horizontal' | 'vertical') {
    dispatch('distributeSelection', { direction });
  }

  // Function to update all selected objects
  function updateSelectedObjects(updates: Record<string, any>) {
    if (selectionType === 'canvas') {
      // For canvas, update through the parent component
      dispatch('updateSelection', { updates });
    }
    // For drawing, it's handled via the drawingSettings store
  }

  // Calculate selection info
  $: selectionCount = selectedObjects.length || (selectionType === 'drawing' ? $drawingSettings.selectedStrokes.length : 0);
  $: selectionLabel = selectionType === 'drawing' ? 'stroke' : 'object';
  $: isMultiSelection = selectionCount > 1;
  $: isGroup = $selectionStyles.group || (selectedObjects[0]?.type === 'group');
</script>

<section class="sidebar-section selection-section">
  <h3>Selection</h3>

  <div class="selection-info">
    <p>{selectionCount} {selectionLabel}{selectionCount !== 1 ? 's' : ''} selected</p>

    <button class="clear-selection-btn" on:click={clearSelection}>
      <span class="material-icons">clear</span>
      Clear selection
    </button>
  </div>

  {#if selectionType === 'canvas'}
    <!-- Canvas-specific selection controls -->
    <div class="selection-controls">
      <!-- Opacity -->
      <SliderControl
        label="Opacity"
        min={0.1}
        max={1}
        step={0.05}
        bind:value={$selectionStyles.opacity}
        decimals={2}
      />

      <!-- Lock/Unlock -->
      <ToggleControl
        label="Lock Position"
        bind:checked={$selectionStyles.locked}
        on:change={toggleLock}
      />

      {#if isMultiSelection}
        <div class="control-group">
          <h4>Arrange</h4>

          <!-- Group/Ungroup -->
          {#if isGroup}
            <button class="action-btn" on:click={ungroupSelection}>
              <span class="material-icons">scatter_plot</span>
              Ungroup
            </button>
          {:else}
            <button class="action-btn" on:click={groupSelection}>
              <span class="material-icons">crop_free</span>
              Group
            </button>
          {/if}

          <!-- Alignment -->
          <div class="align-buttons">
            <div class="align-row">
              <button class="align-btn" on:click={() => alignSelection('left')} title="Align Left">
                <span class="material-icons">format_align_left</span>
              </button>
              <button class="align-btn" on:click={() => alignSelection('center')} title="Align Center">
                <span class="material-icons">format_align_center</span>
              </button>
              <button class="align-btn" on:click={() => alignSelection('right')} title="Align Right">
                <span class="material-icons">format_align_right</span>
              </button>
            </div>
            <div class="align-row">
              <button class="align-btn" on:click={() => alignSelection('top')} title="Align Top">
                <span class="material-icons">vertical_align_top</span>
              </button>
              <button class="align-btn" on:click={() => alignSelection('middle')} title="Align Middle">
                <span class="material-icons">vertical_align_center</span>
              </button>
              <button class="align-btn" on:click={() => alignSelection('bottom')} title="Align Bottom">
                <span class="material-icons">vertical_align_bottom</span>
              </button>
            </div>
          </div>

          <!-- Distribution -->
          <div class="distribute-buttons">
            <button class="distribute-btn" on:click={() => distributeSelection('horizontal')} title="Distribute Horizontally">
              <span class="material-icons">space_bar</span>
              Horizontal
            </button>
            <button class="distribute-btn" on:click={() => distributeSelection('vertical')} title="Distribute Vertically">
              <span class="material-icons">more_vert</span>
              Vertical
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if selectionType === 'drawing'}
    <!-- Drawing-specific selection controls -->
    <div class="drawing-selection-controls">
      <!-- Here we could add stroke-specific controls like changing color, etc. -->
    </div>
  {/if}
</section>

<style lang="scss">
  .selection-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;

    p {
      margin: 0;
      font-size: 14px;
    }
  }

  .clear-selection-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background-color: var(--hover-bg);
    border: 1px solid var(--border-color);
    border-radius: $border-radius-md;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
    color: var(--text-color);

    &:hover {
      background-color: var(--tool-hover-bg);
    }

    .material-icons {
      font-size: 16px;
    }
  }

  .control-group {
    margin-top: 16px;

    h4 {
      font-size: 12px;
      font-weight: 600;
      margin: 0 0 8px;
      color: var(--text-color);
    }
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    background-color: var(--card-bg);
    border: 1px solid var(--border-color);
    border-radius: $border-radius-md;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
    margin-bottom: 10px;
    color: var(--text-color);

    &:hover {
      background-color: var(--hover-bg);
    }

    .material-icons {
      font-size: 14px;
    }
  }

  .align-buttons {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;

    .align-row {
      display: flex;
      gap: 4px;
    }

    .align-btn {
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: $border-radius-sm;
      cursor: pointer;
      flex: 1;

      &:hover {
        background-color: var(--hover-bg);
      }

      .material-icons {
        font-size: 16px;
      }
    }
  }

  .distribute-buttons {
    display: flex;
    gap: 4px;

    .distribute-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: $border-radius-sm;
      padding: 6px 8px;
      font-size: 12px;
      cursor: pointer;
      flex: 1;

      &:hover {
        background-color: var(--hover-bg);
      }

      .material-icons {
        font-size: 14px;
      }
    }
  }
</style>