<script lang="ts">
  import { drawingSettings } from '$lib/stores/drawingStore';
  import SliderControl from './SliderControl.svelte';

  // Function to handle eraser size changes
  function setEraserSize(size: number) {
    drawingSettings.update(settings => ({
      ...settings,
      strokeSize: size // Reuse the stroke size for eraser
    }));
  }
</script>

<section class="sidebar-section">
  <h3>Eraser</h3>

  <!-- Size slider -->
  <SliderControl
    label="Size"
    min={1}
    max={40}
    step={1}
    bind:value={$drawingSettings.strokeSize}
    unit="px"
  />

  <div class="eraser-info">
    <span class="material-icons">info</span>
    <p>Click on objects to erase them. For canvas mode, you can also click and drag to erase multiple objects.</p>
  </div>
</section>

<style lang="scss">
  .eraser-info {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-top: 16px;
    padding: 10px;
    background-color: var(--hover-bg);
    border-radius: $border-radius-md;

    .material-icons {
      font-size: 16px;
      color: var(--text-color);
      opacity: 0.7;
    }

    p {
      font-size: 12px;
      margin: 0;
      color: var(--text-color);
      opacity: 0.9;
      line-height: 1.4;
    }
  }
</style>