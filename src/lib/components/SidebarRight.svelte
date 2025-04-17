<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { page } from '$app/stores';
  import { drawingSettings, activeDrawingId } from '$lib/stores/drawingStore';
  import ColorPickerPopup from './ColorPickerPopup.svelte';
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';

  // Define props
  export let currentPageId: string;
  export let directDrawingContent: any = null; // Add a prop to receive direct drawing content

  // Set up event dispatcher
  const dispatch = createEventDispatcher();

  // Use the store values instead of props
  $: isDrawingPage = $page.route.id?.includes('/drawing/');

  // Variables to store drawing content
  let drawingContent: any = null;
  let drawingTitle = 'drawing';

  // SVG export options
  let svgOptimizeViewBox = true;
  let svgDecimalPrecision = 2;
  let svgIncludeMetadata = true;
  let svgCustomTitle = '';
  let svgExportExpanded = false;

  // Status message for SVG export
  let svgExportStatus: {
    visible: boolean;
    type: 'info' | 'success' | 'error' | 'working';
    message: string;
    timeout?: number;
  } = {
    visible: false,
    type: 'info',
    message: ''
  };

  // Use direct content if available, fallback to loaded content
  $: {
    if (directDrawingContent) {
      console.log('Using direct drawing content');
      drawingContent = directDrawingContent;
    }
  }

  // Show a status message with optional timeout
  function showStatus(message: string, type: 'info' | 'success' | 'error' | 'working', timeout?: number) {
    // Clear any existing timeout
    if (svgExportStatus.timeout) {
      clearTimeout(svgExportStatus.timeout);
    }

    // Set the status
    svgExportStatus = {
      visible: true,
      type,
      message,
      timeout: timeout ? setTimeout(() => {
        svgExportStatus.visible = false;
      }, timeout) : undefined
    };
  }

  // Hide the status message
  function hideStatus() {
    if (svgExportStatus.timeout) {
      clearTimeout(svgExportStatus.timeout);
    }
    svgExportStatus.visible = false;
  }

  // Function to download SVG
  async function downloadSvg() {
    console.log('Download SVG clicked, drawingContent:', drawingContent);
    console.log('Direct content:', directDrawingContent);

    // Use direct content if available, otherwise fall back to loaded content
    const contentToExport = directDrawingContent || drawingContent;

    if (!contentToExport) {
      console.error('No drawing content available for SVG download');
      showStatus('No drawing content available', 'error', 3000);
      return;
    }

    // If the drawing has no strokes, show an error
    if (!contentToExport.strokes || contentToExport.strokes.length === 0) {
      console.error('Drawing has no strokes for SVG download');
      showStatus('The drawing is empty', 'error', 3000);
      return;
    }

    console.log(`Generating SVG for download with ${contentToExport.strokes.length} strokes`);
    showStatus('Generating SVG...', 'working');

    try {
      // Get the custom title or use the drawing title
      const title = svgCustomTitle.trim() || drawingTitle;

      // Import the function dynamically to avoid issues
      const { svgFromStrokes } = await import('$lib/utils/drawingUtils');

      // Generate SVG content with optimization options
      const result = svgFromStrokes(
        contentToExport.strokes,
        contentToExport.bounds?.width || 800,
        contentToExport.bounds?.height || 600,
        'transparent',
        {
          optimizeViewBox: svgOptimizeViewBox,
          decimals: svgDecimalPrecision,
          metadata: svgIncludeMetadata,
          title
        }
      );

      // Check if there was an error
      if (result.error) {
        console.error('Error in SVG generation for download:', result.error);
        showStatus(`Error: ${result.error}`, 'error', 5000);
        return;
      }

      // Get the SVG string - at this point we know it exists since we checked for result.error
      const svgContent = result.svg!;  // Use non-null assertion
      console.log('SVG generated successfully for download, length:', svgContent.length);

      // Create a blob with the SVG content
      const blob = new Blob([svgContent], { type: 'image/svg+xml' });

      // Create a download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title.replace(/\s+/g, '-').toLowerCase()}.svg`;

      // Trigger download
      document.body.appendChild(link);
      link.click();

      // Clean up
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Show success message
      showStatus('SVG downloaded successfully', 'success', 3000);
    } catch (error) {
      console.error('Error generating SVG for download:', error);
      showStatus(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error', 5000);
    }
  }

  // Function to view SVG in a new tab
  async function viewSvg() {
    console.log('View SVG clicked, drawingContent:', drawingContent);
    console.log('Direct content:', directDrawingContent);

    // Use direct content if available, otherwise fall back to loaded content
    const contentToExport = directDrawingContent || drawingContent;

    if (!contentToExport) {
      console.error('No drawing content available for SVG export');
      showStatus('No drawing content available', 'error', 3000);
      return;
    }

    // If the drawing has no strokes, show an error
    if (!contentToExport.strokes || contentToExport.strokes.length === 0) {
      console.error('Drawing has no strokes for SVG export');
      showStatus('The drawing is empty', 'error', 3000);
      return;
    }

    console.log(`Generating SVG for ${contentToExport.strokes.length} strokes`);
    showStatus('Generating SVG...', 'working');

    try {
      // Get the custom title or use the drawing title
      const title = svgCustomTitle.trim() || drawingTitle;

      // Import the function dynamically to avoid issues
      const { svgFromStrokes } = await import('$lib/utils/drawingUtils');

      // Generate SVG content with optimization options
      const result = svgFromStrokes(
        contentToExport.strokes,
        contentToExport.bounds?.width || 800,
        contentToExport.bounds?.height || 600,
        'transparent',
        {
          optimizeViewBox: svgOptimizeViewBox,
          decimals: svgDecimalPrecision,
          metadata: svgIncludeMetadata,
          title
        }
      );

      // Check if there was an error
      if (result.error) {
        console.error('Error in SVG generation:', result.error);
        showStatus(`Error: ${result.error}`, 'error', 5000);
        return;
      }

      // Get the SVG string - at this point we know it exists since we checked for result.error
      const svgContent = result.svg!;  // Use non-null assertion
      console.log('SVG generated successfully, length:', svgContent.length);

      // Create a blob with the SVG content
      const blob = new Blob([svgContent], { type: 'image/svg+xml' });

      // Create a URL and open in a new tab
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');

      // We don't revoke the URL immediately as it would prevent the SVG from loading
      // The browser will clean it up when the tab is closed
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60000); // Clean up after 1 minute

      // Show success message
      showStatus('SVG opened in new tab', 'success', 3000);
    } catch (error) {
      console.error('Error generating SVG:', error);
      showStatus(`Error: ${error instanceof Error ? error.message : String(error)}`, 'error', 5000);
    }
  }

  // Toggle SVG export options
  function toggleSvgExportOptions() {
    svgExportExpanded = !svgExportExpanded;
  }

  // Load drawing content when ID changes
  async function loadDrawingContent(id: string) {
    if (!id) return;

    console.log('Loading drawing content for ID:', id);

    try {
      // Import the getPage function
      const { getPage } = await import('$lib/supabase/pages');
      const { data, error } = await getPage(id);

      if (error) {
        console.error('Error loading drawing:', error);
        return;
      }

      if (!data) {
        console.error('No data found for drawing ID:', id);
        return;
      }

      if (data.type !== 'drawing') {
        console.error('Not a drawing page:', data);
        return;
      }

      console.log('Drawing content loaded:', data.content);
      drawingContent = data.content || { strokes: [] };
      drawingTitle = data.title || 'drawing';
    } catch (error) {
      console.error('Error loading drawing content:', error);
    }
  }

  // Load drawing content when component mounts or ID changes
  $: if (isDrawingPage && $activeDrawingId) {
    loadDrawingContent($activeDrawingId);
  }

  // Update activeDrawingId when the currentPageId changes
  $: if (isDrawingPage && currentPageId) {
    activeDrawingId.set(currentPageId);
  }

  // Add event listener for page changes
  onMount(() => {
    // Immediately load the content on mount if we have an activeDrawingId
    if (isDrawingPage && $activeDrawingId) {
      loadDrawingContent($activeDrawingId);
    }

    console.log('SidebarRight mounted, activeDrawingId:', $activeDrawingId);
  });

  // Color picker state
  let selectedColorHex = $drawingSettings.strokeColor;
  let hue = 0;
  let saturation = 100;
  let lightness = 50;
  let alpha = 1;
  let rgbValues = { r: 0, g: 0, b: 0 };
  let hslValues = { h: 0, s: 100, l: 50 };
  let colorPickerOpen = false;
  let colorDisplayElement: HTMLElement | null = null;

  // Initialize RGB and HSL from current color
  $: {
    if (selectedColorHex) {
      updateColorValues(selectedColorHex);
    }
  }

  // Update RGB and HSL values from hex
  function updateColorValues(hex: string) {
    // Convert hex to RGB
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    rgbValues = { r, g, b };

    // Convert RGB to HSL
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;

    let h = 0;
    let s = 0;
    let l = (max + min) / 2;

    if (delta !== 0) {
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

      if (max === rNorm) {
        h = (gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0);
      } else if (max === gNorm) {
        h = (bNorm - rNorm) / delta + 2;
      } else {
        h = (rNorm - gNorm) / delta + 4;
      }

      h = Math.round(h * 60);
    }

    s = Math.round(s * 100);
    l = Math.round(l * 100);

    hslValues = { h, s, l };
    hue = h;
    saturation = s;
    lightness = l;
  }

  // Toggle color picker
  function toggleColorPicker() {
    colorPickerOpen = !colorPickerOpen;
  }

  // Convert HSL to hex
  function hslToHex(h: number, s: number, l: number): string {
    h /= 360;
    s /= 100;
    l /= 100;

    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;

      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    const toHex = (x: number) => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Convert RGB to hex
  function rgbToHex(r: number, g: number, b: number): string {
    const toHex = (x: number) => {
      const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Update color from hex input
  function updateFromHex() {
    // Validate hex format
    const isValidHex = /^#[0-9A-Fa-f]{6}$/.test(selectedColorHex);

    if (isValidHex) {
      updateColorValues(selectedColorHex);
      setColor(selectedColorHex);
    }
  }

  // Update color from HSL values
  function updateFromHSL() {
    const newHex = hslToHex(hslValues.h, hslValues.s, hslValues.l);
    selectedColorHex = newHex;
    rgbValues = {
      r: parseInt(newHex.slice(1, 3), 16),
      g: parseInt(newHex.slice(3, 5), 16),
      b: parseInt(newHex.slice(5, 7), 16)
    };
    setColor(newHex);
  }

  // Update color from RGB values
  function updateFromRGB() {
    const newHex = rgbToHex(rgbValues.r, rgbValues.g, rgbValues.b);
    selectedColorHex = newHex;
    updateColorValues(newHex);
    setColor(newHex);
  }

  // Update from color square
  function handleColorSquareClick(e: MouseEvent) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const s = Math.round((x / rect.width) * 100);
    const l = Math.round(100 - (y / rect.height) * 100);

    hslValues.s = Math.max(0, Math.min(100, s));
    hslValues.l = Math.max(0, Math.min(100, l));
    saturation = hslValues.s;
    lightness = hslValues.l;

    updateFromHSL();
  }

  // Update from hue slider
  function updateHue(h: number) {
    hslValues.h = h;
    updateFromHSL();
  }

  // Available preset colors
  const presetColors = [
    '#000000', // Black
    '#FFFFFF', // White
    '#FF0000', // Red
    '#00FF00', // Green
    '#0000FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Magenta
    '#00FFFF', // Cyan
  ];

  // Function to handle tool changes
  function setTool(tool: 'pen' | 'select' | 'eraser' | 'pan') {
    drawingSettings.update(settings => ({
      ...settings,
      selectedTool: tool,
      // Clear selection when switching away from select tool
      ...(tool !== 'select' && { selectedStrokes: [] })
    }));
  }

  // Function to handle color changes
  function setColor(color: string) {
    selectedColorHex = color;
    drawingSettings.update(settings => ({
      ...settings,
      strokeColor: color
    }));
  }

  // Function to handle size changes
  function setSize(size: number) {
    drawingSettings.update(settings => ({
      ...settings,
      strokeSize: size
    }));
  }

  // Function to handle opacity changes
  function setOpacity(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      opacity: value
    }));
  }

  // Function to handle thinning changes
  function setThinning(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      thinning: value
    }));
  }

  // Function to handle smoothing changes
  function setSmoothing(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      smoothing: value
    }));
  }

  // Function to handle streamline changes
  function setStreamline(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      streamline: value
    }));
  }

  // Function to toggle pressure sensitivity
  function togglePressure() {
    drawingSettings.update(settings => ({
      ...settings,
      showPressure: !settings.showPressure
    }));
  }

  // Function to toggle cap start
  function toggleCapStart() {
    drawingSettings.update(settings => ({
      ...settings,
      capStart: !settings.capStart
    }));
  }

  // Function to toggle cap end
  function toggleCapEnd() {
    drawingSettings.update(settings => ({
      ...settings,
      capEnd: !settings.capEnd
    }));
  }

  // Function to handle taper start changes
  function setTaperStart(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      taperStart: value
    }));
  }

  // Function to handle taper end changes
  function setTaperEnd(value: number) {
    drawingSettings.update(settings => ({
      ...settings,
      taperEnd: value
    }));
  }

  // Function to clear selection
  function clearSelection() {
    drawingSettings.update(settings => ({
      ...settings,
      selectedStrokes: []
    }));
  }
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

{#if isDrawingPage}
<aside class="sidebar-right">
  <div class="sidebar-header">
    <h2>Tool Settings</h2>
  </div>

  <div class="sidebar-content">
    <section class="tools-section">
      <h3>Tools</h3>
      <div class="tools-container">
        <button
          class="tool-btn"
          class:active={$drawingSettings.selectedTool === 'pen'}
          on:click={() => setTool('pen')}
          title="Pen Tool (P)"
        >
          <span class="material-icons">edit</span>
          <span class="tool-label">Pen</span>
        </button>

        <button
          class="tool-btn"
          class:active={$drawingSettings.selectedTool === 'select'}
          on:click={() => setTool('select')}
          title="Select Tool (S)"
        >
          <span class="material-icons">select_all</span>
          <span class="tool-label">Select</span>
        </button>

        <button
          class="tool-btn"
          class:active={$drawingSettings.selectedTool === 'eraser'}
          on:click={() => setTool('eraser')}
          title="Eraser Tool (E)"
        >
          <span class="material-icons">cleaning_services</span>
          <span class="tool-label">Eraser</span>
        </button>

        <button
          class="tool-btn"
          class:active={$drawingSettings.selectedTool === 'pan'}
          on:click={() => setTool('pan')}
          title="Pan Tool (Space)"
        >
          <span class="material-icons">pan_tool</span>
          <span class="tool-label">Pan</span>
        </button>
      </div>
    </section>

    {#if $drawingSettings.selectedTool === 'select' && $drawingSettings.selectedStrokes.length > 0}
      <section class="selection-section">
        <h3>Selection</h3>
        <div class="selection-info">
          <p>{$drawingSettings.selectedStrokes.length} stroke{$drawingSettings.selectedStrokes.length > 1 ? 's' : ''} selected</p>
          <button class="clear-selection-btn" on:click={clearSelection}>
            <span class="material-icons">clear</span>
            Clear selection
          </button>
        </div>
      </section>
    {/if}

    {#if $drawingSettings.selectedTool === 'pen'}
      <section class="colors-section">
        <h3>Colors</h3>
        <div class="color-picker-container">
          <!-- Current color display and hex input - always visible -->
          <div class="current-color-row">
            <div
              class="current-color-display"
              bind:this={colorDisplayElement}
              style="background-color: {selectedColorHex}; border: 1px solid {selectedColorHex === '#FFFFFF' ? '#ddd' : 'transparent'};"
              on:click={toggleColorPicker}
              title="Click to open color picker"
            ></div>
            <div class="color-input-container">
              <input
                type="text"
                class="hex-input"
                bind:value={selectedColorHex}
                on:blur={updateFromHex}
                on:keydown={(e) => e.key === 'Enter' && updateFromHex()}
              />
            </div>
          </div>

          <!-- Color picker popup -->
          <ColorPickerPopup
            open={colorPickerOpen}
            anchor={colorDisplayElement}
            hue={hue}
            saturation={saturation}
            lightness={lightness}
            rgbValues={rgbValues}
            hslValues={hslValues}
            presetColors={presetColors}
            selectedColorHex={selectedColorHex}
            onHueChange={updateHue}
            onColorSquareClick={handleColorSquareClick}
            onRgbChange={updateFromRGB}
            onHslChange={updateFromHSL}
            onColorSelect={setColor}
          />
        </div>
      </section>

      <section class="sliders-section">
        <h3>Size & Opacity</h3>
        <div class="slider-row">
          <label for="stroke-size">Size</label>
          <input
            id="stroke-size"
            type="range"
            min="1"
            max="20"
            step="1"
            bind:value={$drawingSettings.strokeSize}
            on:input={() => setSize($drawingSettings.strokeSize)}
          />
          <span class="value">{$drawingSettings.strokeSize}px</span>
        </div>

        <div class="slider-row">
          <label for="opacity">Opacity</label>
          <input
            id="opacity"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            bind:value={$drawingSettings.opacity}
            on:input={() => setOpacity($drawingSettings.opacity)}
          />
          <span class="value">{Math.round($drawingSettings.opacity * 100)}%</span>
        </div>
      </section>

      <section class="advanced-section">
        <details>
          <summary>Advanced Stroke Settings</summary>
          <div class="advanced-options">
            <div class="slider-row">
              <label for="thinning">Thinning</label>
              <input
                id="thinning"
                type="range"
                min="-1"
                max="1"
                step="0.1"
                bind:value={$drawingSettings.thinning}
                on:input={() => setThinning($drawingSettings.thinning)}
              />
              <span class="value">{$drawingSettings.thinning.toFixed(1)}</span>
            </div>

            <div class="slider-row">
              <label for="smoothing">Smoothing</label>
              <input
                id="smoothing"
                type="range"
                min="0"
                max="1"
                step="0.1"
                bind:value={$drawingSettings.smoothing}
                on:input={() => setSmoothing($drawingSettings.smoothing)}
              />
              <span class="value">{$drawingSettings.smoothing.toFixed(1)}</span>
            </div>

            <div class="slider-row">
              <label for="streamline">Streamline</label>
              <input
                id="streamline"
                type="range"
                min="0"
                max="1"
                step="0.1"
                bind:value={$drawingSettings.streamline}
                on:input={() => setStreamline($drawingSettings.streamline)}
              />
              <span class="value">{$drawingSettings.streamline.toFixed(1)}</span>
            </div>

            <div class="checkbox-row">
              <label>
                <input type="checkbox" bind:checked={$drawingSettings.showPressure} on:change={togglePressure} />
                Pressure Sensitivity
              </label>
            </div>

            <div class="checkbox-row">
              <label>
                <input type="checkbox" bind:checked={$drawingSettings.capStart} on:change={toggleCapStart} />
                Cap Start
              </label>
            </div>

            <div class="checkbox-row">
              <label>
                <input type="checkbox" bind:checked={$drawingSettings.capEnd} on:change={toggleCapEnd} />
                Cap End
              </label>
            </div>

            <div class="slider-row">
              <label for="taper-start">Taper Start</label>
              <input
                id="taper-start"
                type="range"
                min="0"
                max="100"
                step="5"
                bind:value={$drawingSettings.taperStart}
                on:input={() => setTaperStart($drawingSettings.taperStart)}
              />
              <span class="value">{$drawingSettings.taperStart}</span>
            </div>

            <div class="slider-row">
              <label for="taper-end">Taper End</label>
              <input
                id="taper-end"
                type="range"
                min="0"
                max="100"
                step="5"
                bind:value={$drawingSettings.taperEnd}
                on:input={() => setTaperEnd($drawingSettings.taperEnd)}
              />
              <span class="value">{$drawingSettings.taperEnd}</span>
            </div>
          </div>
        </details>
      </section>
    {/if}

    <section class="keyboard-shortcuts">
      <details>
        <summary>Keyboard Shortcuts</summary>
        <div class="shortcuts-list">
          <div class="shortcut-item">
            <span class="key">P</span>
            <span class="description">Pen Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">S</span>
            <span class="description">Select Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">E</span>
            <span class="description">Eraser Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">Space</span>
            <span class="description">Pan Tool</span>
          </div>
          <div class="shortcut-item">
            <span class="key">Ctrl/⌘ + Z</span>
            <span class="description">Undo</span>
          </div>
          <div class="shortcut-item">
            <span class="key">Ctrl/⌘ + Shift + Z</span>
            <span class="description">Redo</span>
          </div>
          <div class="shortcut-item">
            <span class="key">+</span>
            <span class="description">Zoom In</span>
          </div>
          <div class="shortcut-item">
            <span class="key">-</span>
            <span class="description">Zoom Out</span>
          </div>
          <div class="shortcut-item">
            <span class="key">0</span>
            <span class="description">Reset Zoom</span>
          </div>
          <div class="shortcut-item">
            <span class="key">Delete</span>
            <span class="description">Delete Selected</span>
          </div>
        </div>
      </details>
    </section>

    <!-- New Export Section -->
    <section class="export-section">
      <h3>Export</h3>

      <!-- Status message for SVG export -->
      {#if svgExportStatus.visible}
        <div class="status-message {svgExportStatus.type}">
          {#if svgExportStatus.type === 'working'}
            <span class="material-icons spinning">refresh</span>
          {:else if svgExportStatus.type === 'success'}
            <span class="material-icons">check_circle</span>
          {:else if svgExportStatus.type === 'error'}
            <span class="material-icons">error</span>
          {:else}
            <span class="material-icons">info</span>
          {/if}
          <span>{svgExportStatus.message}</span>
          <button class="close-status" on:click={hideStatus}>
            <span class="material-icons">close</span>
          </button>
        </div>
      {/if}

      <details class="svg-export-options" bind:open={svgExportExpanded}>
        <summary>Export Options</summary>
        <div class="options-container">
          <div class="option-row">
            <label for="svg-title">Custom title:</label>
            <input
              id="svg-title"
              type="text"
              placeholder={drawingTitle}
              bind:value={svgCustomTitle}
            />
          </div>

          <div class="option-row">
            <label for="svg-precision">Decimal precision:</label>
            <select id="svg-precision" bind:value={svgDecimalPrecision}>
              <option value={1}>1 decimal place</option>
              <option value={2}>2 decimal places</option>
              <option value={3}>3 decimal places</option>
              <option value={4}>4 decimal places</option>
            </select>
          </div>

          <div class="checkbox-row">
            <label>
              <input type="checkbox" bind:checked={svgOptimizeViewBox} />
              Optimize viewBox
            </label>
            <span class="info-tooltip" title="Calculates the minimal viewBox based on the drawing content">ⓘ</span>
          </div>

          <div class="checkbox-row">
            <label>
              <input type="checkbox" bind:checked={svgIncludeMetadata} />
              Include metadata
            </label>
            <span class="info-tooltip" title="Adds title and creation info to the SVG file">ⓘ</span>
          </div>
        </div>
      </details>

      <div class="export-buttons">
        <button
          class="export-btn download-svg-btn"
          on:click={downloadSvg}
          title="Download your drawing as an SVG file"
        >
          <span class="material-icons">download</span>
          <span>Download SVG</span>
        </button>

        <button
          class="export-btn view-svg-btn"
          on:click={viewSvg}
          title="View your drawing as an SVG in a new tab"
        >
          <span class="material-icons">visibility</span>
          <span>View SVG</span>
        </button>

        {#if import.meta.env.DEV}
        <button
          class="export-btn debug-btn"
          on:click={() => console.log('Drawing Content:', drawingContent)}
          title="Debug drawing content (DEV only)"
        >
          <span class="material-icons">bug_report</span>
          <span>Debug Content</span>
        </button>
        {/if}
      </div>
    </section>
  </div>
</aside>
{:else}
<!-- Empty sidebar or placeholder message when not in drawing mode -->
<aside class="sidebar-right sidebar-right-empty">
  <div class="sidebar-placeholder">
    <span class="material-icons">info</span>
    <p>Select a drawing to see tool options</p>
  </div>
</aside>
{/if}

<style lang="scss">
  .sidebar-right {
    background-color: rgba(white, .05);
    border-radius: $border-radius-lg;
    box-sizing: border-box;
    width: 220px;
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    border: 1px solid rgba(white, .1);
    box-shadow: -8px 18px 32px rgba(black, 0.8), inset -2px -6px 12px rgba(black, 0.03);

    &::-webkit-scrollbar {
      width: 8px;
    }

    &::-webkit-scrollbar-thumb {
      background-color: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
    }
  }

  .sidebar-right-empty {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .sidebar-placeholder {
    text-align: center;
    color: var(--text-color);
    padding: 1rem;

    .material-icons {
      font-size: 48px;
      margin-bottom: 1rem;
    }

    p {
      font-size: 14px;
    }
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid $border-color;

    h2 {
      font-size: 1.2rem;
      font-weight: 600;
      margin: 0;
      color: var(--text-color);
    }
  }

  .sidebar-content {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  section {
    h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-color);
      margin-top: 0;
      margin-bottom: 12px;
    }

    h4 {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-color);
      margin-top: 0;
      margin-bottom: 8px;
    }
  }

  .selection-section {
    p {
      color: var(--text-color);
      margin: 0 0 8px 0;
    }

    .selection-info {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .clear-selection-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      background-color: #f0f0f0;
      border: 1px solid $border-color;
      border-radius: $border-radius-md;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
      color: var(--text-color);

      &:hover {
        background-color: #e0e0e0;
      }

      .material-icons {
        font-size: 16px;
      }
    }
  }

  .tools-container {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .tool-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 12px 8px;
    background: none;
    border: 1px solid $border-color;
    border-radius: $border-radius-md;
    cursor: pointer;
    transition: all 0.2s;
    color: var(--text-color);

    &:hover {
      background-color: rgba(0, 0, 0, 0.05);
    }

    &.active {
      background-color: rgba($primary-color, 0.08);
      color: $primary-color;
      border-color: $primary-color;
    }

    .material-icons {
      font-size: 24px;
    }

    .tool-label {
      font-size: 12px;
      font-weight: 500;
    }
  }

  .color-picker-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .current-color-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .current-color-display {
    width: 40px;
    height: 40px;
    border-radius: $border-radius-sm;
    border: 1px solid #ddd;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .color-input-container {
    flex: 1;
  }

  .hex-input {
    width: 100%;
    padding: 8px;
    border: 1px solid #ddd;
    border-radius: $border-radius-sm;
    font-family: monospace;
    font-size: 14px;
    text-transform: uppercase;

    &:focus {
      outline: none;
      border-color: $primary-color;
      box-shadow: 0 0 0 2px rgba($primary-color, 0.2);
    }
  }

  .color-picker-details {
    margin-top: 8px;

    summary {
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      padding: 4px 8px;
      color: var(--text-color);
      border-radius: $border-radius-sm;
      background-color: rgba(0, 0, 0, 0.03);
      transition: all 0.2s;

      &:hover {
        background-color: rgba(0, 0, 0, 0.05);
        color: $primary-color;
      }

      &:focus {
        outline: none;
      }
    }
  }

  .color-picker-expanded {
    padding: 16px 8px 8px;
    margin-top: 8px;
    background-color: #f9f9f9;
    border-radius: $border-radius-md;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .color-pickers-row {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .color-square {
    width: 100%;
    height: 120px;
    border-radius: $border-radius-sm;
    border: 1px solid #ddd;
    position: relative;
    cursor: crosshair;
  }

  .color-cursor {
    width: 12px;
    height: 12px;
    border: 2px solid white;
    border-radius: 50%;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
  }

  .hue-slider-container {
    width: 100%;
    padding: 0 2px;
  }

  .hue-slider {
    width: 100%;
    height: 16px;
    -webkit-appearance: none;
    appearance: none;
    border-radius: 8px;
    background: linear-gradient(to right,
      rgb(255, 0, 0),
      rgb(255, 255, 0),
      rgb(0, 255, 0),
      rgb(0, 255, 255),
      rgb(0, 0, 255),
      rgb(255, 0, 255),
      rgb(255, 0, 0)
    );
    outline: none;

    &::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      border: 1px solid rgba(0, 0, 0, 0.3);
      cursor: pointer;
    }

    &::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: white;
      border: 1px solid rgba(0, 0, 0, 0.3);
      cursor: pointer;
    }
  }

  .color-inputs-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }

  .color-inputs-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .color-input-group {
    display: flex;
    align-items: center;
    gap: 4px;
    position: relative;

    label {
      width: 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-color);
    }

    input[type="number"] {
      width: 45px;
      padding: 4px;
      border: 1px solid #ddd;
      border-radius: $border-radius-sm;
      font-size: 12px;
      text-align: center;
      -moz-appearance: textfield;

      &::-webkit-outer-spin-button,
      &::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }

      &:focus {
        outline: none;
        border-color: $primary-color;
      }
    }

    .unit {
      font-size: 12px;
      color: #888;
    }
  }

  .preset-colors {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }

  .preset-colors-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .color-btn {
    width: 32px;
    height: 32px;
    border-radius: $border-radius-sm;
    border: 1px solid #ddd;
    cursor: pointer;
    position: relative;

    &.active {
      box-shadow: 0 0 0 2px $primary-color;
    }

    &.preset-color-btn {
      width: 100%;
      height: 24px;
    }

    .check {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 16px;
      font-weight: bold;
    }
  }

  .slider-row {
    display: flex;
    align-items: center;
    margin: 12px 0;
    font-size: 14px;
    color: var(--text-color);

    label {
      width: 80px;
      font-weight: 500;
    }

    .value {
      width: 48px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-size: 12px;
    }
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    margin: 12px 0;
    font-size: 14px;
    color: var(--text-color);

    label {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-weight: 500;
    }

    input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
    }
  }

  .advanced-section {
    summary {
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      padding: 4px 0;
      color: var(--text-color);

      &:hover {
        color: $primary-color;
      }
    }

    .advanced-options {
      padding: 8px;
      background-color: #f9f9f9;
      border-radius: $border-radius-md;
      margin-top: 8px;
    }
  }

  .keyboard-shortcuts {
    summary {
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      padding: 4px 0;
      color: var(--text-color);

      &:hover {
        color: $primary-color;
      }
    }

    .shortcuts-list {
      padding: 8px;
      background-color: #f9f9f9;
      border-radius: $border-radius-md;
      margin-top: 8px;
    }

    .shortcut-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      font-size: 12px;
      color: var(--text-color);
      border-bottom: 1px solid rgba($border-color, 0.5);

      &:last-child {
        border-bottom: none;
      }
    }

    .key {
      font-family: monospace;
      background-color: #eee;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 11px;
      color: var(--text-color);
    }

    .description {
      color: var(--text-color);
    }
  }

  /* Export section styles */
  .export-section {
    margin-top: 8px;
  }

  .export-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .export-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: #f0f0f0;
    border: 1px solid $border-color;
    border-radius: $border-radius-md;
    padding: 10px 12px;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.2s;
    color: var(--text-color);

    &:hover {
      background-color: #e0e0e0;
    }

    .material-icons {
      font-size: 18px;
    }
  }

  .download-svg-btn {
    background-color: rgba($primary-color, 0.08);
    color: $primary-color;
    border-color: rgba($primary-color, 0.2);

    &:hover {
      background-color: rgba($primary-color, 0.15);
    }
  }

  .view-svg-btn {
    &:hover {
      background-color: #e0e0e0;
    }
  }

  /* SVG Export options */
  .svg-export-options {
    margin: 8px 0;
    background-color: #f9f9f9;
    border-radius: $border-radius-md;
  }

  .svg-export-options summary {
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    padding: 8px 12px;
    color: var(--text-color);
  }

  .svg-export-options summary:hover {
    color: $primary-color;
  }

  .options-container {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .option-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .option-row label {
    font-size: 12px;
    color: var(--text-color);
  }

  .option-row input,
  .option-row select {
    padding: 6px 8px;
    border: 1px solid #ddd;
    border-radius: $border-radius-sm;
    font-size: 12px;
  }

  .option-row input:focus,
  .option-row select:focus {
    outline: none;
    border-color: $primary-color;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: var(--text-color);
  }

  .checkbox-row label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .info-tooltip {
    margin-left: 4px;
    cursor: help;
    color: #999;
    font-size: 12px;
  }

  /* Status message */
  .status-message {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    padding: 8px 12px;
    border-radius: $border-radius-md;
    font-size: 12px;
  }

  .status-message.info {
    background-color: rgba(0, 120, 212, 0.1);
    color: #0078d4;
  }

  .status-message.success {
    background-color: rgba(16, 124, 16, 0.1);
    color: #107c10;
  }

  .status-message.error {
    background-color: rgba(232, 17, 35, 0.1);
    color: #e81123;
  }

  .status-message.working {
    background-color: rgba(0, 120, 212, 0.1);
    color: #0078d4;
  }

  .status-message .material-icons {
    font-size: 16px;
  }

  .spinning {
    animation: spin 1.5s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .close-status {
    margin-left: auto;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
  }

  .close-status:hover {
    opacity: 1;
  }

  .close-status .material-icons {
    font-size: 14px;
  }
</style>