<!-- src/lib/components/Browserbase.svelte -->
<script lang="ts">
  /**
   * Clean Browserbase component that uses only the native Browserbase UI
   * without any custom browser chrome to avoid gutter issues.
   */
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';

  export let show: boolean = false;           // master visibility toggle
  export let liveViewUrl: string | null = null; // remote live view URL
  export let screenshot: string | null = null;  // fallback screenshot (base64)
  export let sessionId: string | null = null;   // current session id – for display only
  export let loading: boolean = false;          // show spinner while establishing session

  // Emits a "close" event so parent can clean up session
  const dispatch = createEventDispatcher();

  // Use Browserbase's default live view URL without modifications
  $: iframeUrl = liveViewUrl || null;
</script>

{#if show}
  <div class="browser-viewport" in:fade={{ duration: 250 }}>
    <!-- Close button floating over content -->
    <button class="browser-close" title="Close browser viewport" on:click={() => dispatch('close')}>
      ×
    </button>

    <!-- Content area without custom header -->
    <div class="browser-content">
      {#if loading}
        <div class="browser-loading">
          <div class="loader"></div>
          <p>Connecting to browser session…</p>
        </div>
      {:else if iframeUrl}
        <iframe
          src={iframeUrl}
          class="browser-iframe"
          title="Live Browser Session"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation"
          allow="clipboard-read; clipboard-write; camera; microphone"
          on:load={() => console.log('✅ Browser iframe loaded', iframeUrl)}
          on:error={() => console.error('❌ Browser iframe failed to load', iframeUrl)}
        />
        <div class="live-indicator"><div class="live-dot"></div><span>LIVE</span></div>
      {:else if screenshot}
        <div class="screenshot-container">
          <img src={`data:image/png;base64,${screenshot}`} alt="Browser screenshot" class="browser-screenshot" />
          <div class="screenshot-overlay">
            <p>Screenshot View</p>
            <small>Live view not available</small>
          </div>
        </div>
      {:else}
        <div class="browser-placeholder">
          <p>Browser session ready</p>
          <small>Send a browser command to interact</small>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style lang="scss">
  /* Loader for connection state */
  .loader {
    width: 17px;
    aspect-ratio: 1;
    border-radius: 50%;
    background: var(--highlight, #6355FF);
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
  .loader:after { animation-delay: -.5s }
  @keyframes l22-0 { to { transform: rotate(1turn) } }
  @keyframes l22   { to { transform: rotate(1turn) translate(150%) } }

  /* Clean viewport container without custom chrome */
  .browser-viewport {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 420px;
    height: 320px;
    background: #fff;
    border-radius: 8px;
    box-shadow: -8px 16px 48px rgba(#030025, .1);
    overflow: hidden;
    z-index: 1000;

    @media (max-width: 1200px) {
      width: 350px;
      height: 260px;
    }
    @media (max-width: 800px) {
      position: relative;
      top: auto;
      right: auto;
      width: 100%;
      height: 280px;
      margin: 16px auto;
      max-width: 95vw;
    }
  }

  /* Floating close button */
  .browser-close {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 20;
    background: rgba(0,0,0,0.8);
    border: none;
    color: white;
    cursor: pointer;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: bold;
    backdrop-filter: blur(4px);
    transition: background-color 0.2s;
  }
  .browser-close:hover {
    background: rgba(0,0,0,0.9);
  }

  /* Content fills entire viewport */
  .browser-content {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: transparent;
  }

  /* Iframe takes full space with Browserbase's native UI */
  .browser-iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: #fff;
    display: block;
  }

  /* Live indicator */
  .live-indicator {
    position: absolute;
    top: 8px;
    left: 8px;
    display: flex;
    align-items: center;
    gap: 4px;
    background: rgba(0,0,0,0.8);
    color: #fff;
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    backdrop-filter: blur(4px);
    z-index: 10;
  }
  .live-dot {
    width: 6px;
    height: 6px;
    background: #ff4444;
    border-radius: 50%;
    animation: pulse 2s infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* Loading state */
  .browser-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    gap: 12px;
  }
  .browser-loading p {
    margin: 0;
    font-size: 14px;
  }

  /* Screenshot fallback */
  .screenshot-container {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  .browser-screenshot {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .screenshot-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(transparent, rgba(0,0,0,0.8));
    color: #fff;
    padding: 16px 12px 8px;
  }
  .screenshot-overlay p {
    margin: 0 0 2px;
    font-size: 12px;
    font-weight: 600;
  }
  .screenshot-overlay small {
    font-size: 10px;
    opacity: 0.8;
  }

  /* Placeholder state */
  .browser-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
    text-align: center;
    gap: 4px;
  }
  .browser-placeholder p {
    margin: 0;
    font-size: 14px;
    font-weight: 500;
  }
  .browser-placeholder small {
    font-size: 12px;
    opacity: 0.7;
  }
</style>