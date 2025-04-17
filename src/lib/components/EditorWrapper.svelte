<script lang="ts">
  import { theme } from '$lib/stores/themeStore';

  // Props
  export let type: 'canvas' | 'drawing';
</script>

<div class="editor-wrapper {type}-editor">
  <slot />
</div>

<style lang="scss">
  .editor-wrapper {
    width: 100%;
    height: 100%;

    // The actual canvas/drawing area will always be white
    // regardless of theme setting
    :global(.canvas-area),
    :global(.drawing-area) {
      background-color: #ffffff !important;
      color: #000000 !important;
    }

    // Controls and UI can still reflect the theme
    :global(.editor-controls) {
      background-color: var(--toolbar-bg);
      color: var(--text-color);
      border-color: var(--border-color);
    }

    // Toolbar
    :global(.editor-toolbar) {
      background-color: var(--toolbar-bg);
      color: var(--text-color);
      border-color: var(--border-color);
    }
  }
</style>