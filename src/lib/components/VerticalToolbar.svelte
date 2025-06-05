<!-- src/lib/components/VerticalToolbar.svelte -->
<script>
  import { selectedTool, strokeOptions } from '$lib/stores/canvasStore';
  import VerticalSlider from '$lib/components/VerticalSlider.svelte';
  import RefreshButton from '$lib/components/shared/RefreshButton.svelte';

  // Props passed from parent component
  export let activeFabricObject = null;
  export let strokeColor = '#000000';
  export let strokeSize = 4;
  export let strokeOpacity = 1;
  export let eraserSize = 20;
  export let canvasBackgroundColor = '#ffffff';
  export let shapeFillColor = '#cccccc';
  export let shapeStrokeColor = '#000000';
  export let shapeStrokeWidth = 2;
  export let textColor = '#000000';
  export let fontSize = 32;
  export let selectedShapeFillProxy = '#cccccc';
  export let selectedShapeStrokeProxy = '#000000';
  export let selectedShapeStrokeWidthProxy = 0;

  // Event handlers passed from parent
  export let onStrokeColorChange = () => {};
  export let onStrokeSizeChange = () => {};
  export let onStrokeOpacityChange = () => {};
  export let onEraserSizeChange = () => {};
  export let onCanvasBackgroundColorChange = (color) => {};
  export let onSelectedObjectPropertyChange = (property, value) => {};
  export let onClearCanvas = () => {};

  // Handle stroke color change
  function handleStrokeColorChange() {
    strokeOptions.update(opts => ({...opts, color: strokeColor}));
    onStrokeColorChange();
  }

  // Handle stroke size change
  function handleStrokeSizeChange() {
    strokeOptions.update(opts => ({...opts, size: strokeSize}));
    if ($selectedTool === 'eraser') eraserSize = strokeSize;
    onStrokeSizeChange();
  }

  // Handle stroke opacity change
  function handleStrokeOpacityChange() {
    strokeOptions.update(opts => ({...opts, opacity: strokeOpacity}));
    onStrokeOpacityChange();
  }

  // Handle selected object property updates
  function updateSelectedObjectProperty(property, value) {
    if (activeFabricObject) {
      onSelectedObjectPropertyChange(property, value);
    }
  }
</script>

<div class="vertical-toolbar options-toolbar">
  <div class="tools-group">
    {#if $selectedTool === 'pen' || $selectedTool === 'eraser'}
      <!-- PEN/ERASER Tool Options -->
      <div class="tool-group">
        <input
          type="color"
          bind:value={strokeColor}
          on:input={handleStrokeColorChange}
        />
      </div>
      <div class="tool-group">
        <VerticalSlider
          min={1}
          max={30}
          step={0.5}
          bind:value={strokeSize}
          color="#6355FF"
          height="120px"
          onChange={handleStrokeSizeChange}
          showValue={true}
        />
      </div>
      <div class="tool-group">
        <VerticalSlider
          min={0.1}
          max={1}
          step={0.1}
          bind:value={strokeOpacity}
          color="#6355FF"
          height="120px"
          onChange={handleStrokeOpacityChange}
          showValue={true}
        />
      </div>

    {:else if $selectedTool === 'select'}
      {#if activeFabricObject && (activeFabricObject.type === 'rect' || activeFabricObject.type === 'circle' || activeFabricObject.type === 'triangle' || activeFabricObject.type === 'ellipse')}
        <!-- SELECTED SHAPE Object Options -->
        <div class="tool-group">
          <input type="color" value={selectedShapeFillProxy}
            on:input={(e) => {
              selectedShapeFillProxy = e.currentTarget.value;
              updateSelectedObjectProperty('fill', selectedShapeFillProxy);
            }} />
        </div>
        <div class="tool-group">
          <input type="color" value={selectedShapeStrokeProxy}
            on:input={(e) => {
              selectedShapeStrokeProxy = e.currentTarget.value;
              updateSelectedObjectProperty('stroke', selectedShapeStrokeProxy);
            }} />
        </div>
        <div class="tool-group">
          <VerticalSlider
            min={0}
            max={30}
            step={1}
            bind:value={selectedShapeStrokeWidthProxy}
            color="#6355FF"
            height="120px"
            onChange={() => {
              if (activeFabricObject && activeFabricObject.strokeWidth !== selectedShapeStrokeWidthProxy) {
                updateSelectedObjectProperty('strokeWidth', selectedShapeStrokeWidthProxy);
              }
            }}
            showValue={true}
          />
        </div>
      {:else}
        <!-- CANVAS BACKGROUND COLOR when no shape is selected -->
        <div class="tool-group">
          <input
            type="color"
            value={canvasBackgroundColor}
            on:input={(e) => onCanvasBackgroundColorChange(e.currentTarget.value)}
          />
        </div>
      {/if}
    {:else if $selectedTool === 'shape'}
      <!-- SHAPE Tool (for new shape) Options -->
      <div class="tool-group">
        <input type="color" bind:value={shapeFillColor} />
      </div>
      <div class="tool-group">
        <input type="color" bind:value={shapeStrokeColor} />
      </div>

      <div class="tool-group">
        <VerticalSlider min={0} max={30} step={1} bind:value={shapeStrokeWidth} color="#6355FF" height="120px" showValue={true} />
      </div>
    {:else if $selectedTool === 'text'}

      <div class="tool-group">
        <input type="color" bind:value={textColor} />
      </div>
      <!-- Future: Font Size (Slider/Input), Font Family (Dropdown) -->

      <div class="tool-group">
          <VerticalSlider min={8} max={128} step={1} bind:value={fontSize} color="#6355FF" height="100px" showValue={true} />
      </div>
      <!-- Placeholder for font family dropdown -->

    {:else}
      <!-- Default: Could be empty or show global options if any -->
      <!-- Or just the clear button which is outside this if/else block -->
    {/if}

    <RefreshButton
      title="Clear Canvas"
      on:click={onClearCanvas}
    >
    </RefreshButton>

  </div>
</div>

<style lang="scss">
  .vertical-toolbar {
    background: $card-bg;
    border-radius: $border-radius-lg;
    box-shadow: $shadow-lg;
    padding: 8px 4px;
    box-sizing: border-box;
    width: 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;

    &.options-toolbar {
      gap: 20px;
      flex: 1;
    }

    .tools-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      width: 100%;

      .tool-group {
        input[type="color"] {
          -webkit-appearance: none;
          border: none;
          outline: none;
          width: 28px;
          height: 28px;
          padding: 0;
          border-radius: 20px;
          cursor: pointer;
          overflow: hidden;
          margin-bottom: 4px;
          position: relative;
          box-shadow: $shadow-md;

          &::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: none;
            border-radius: 20px;
            border: 0px solid rgba(white, 0);
            box-shadow: inset 1px 2px 3px rgba(white, .25), inset -1px -2px 3px rgba(black, .25);
          }

          &::-webkit-color-swatch-wrapper {
            padding: 0;
          }

          &::-webkit-color-swatch {
            border: none;
            border-radius: 20px;
          }
        }

        .tool-label {
          display: block;
          text-align: center;
          color: $text-color;
          font-size: $font-size-sm;
          margin-bottom: 4px;
          font-weight: 500;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          opacity: 0.7;
        }
      }
    }
  }
</style>