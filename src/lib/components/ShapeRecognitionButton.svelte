<script>
  import { createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';

  export let position = { right: '20px', bottom: '20px' };
  export let active = false;
  export let objectCount = 0;
  export let isAnalyzing = false;

  const dispatch = createEventDispatcher();

  function toggleDialog() {
    dispatch('toggle');
  }
</script>

<button
  class="shape-recognition-button {active ? 'active' : ''}"
  style="right: {position.right}; bottom: {position.bottom};"
  on:click={toggleDialog}
  transition:fly={{ y: 20, duration: 200 }}
  aria-label="Toggle shape recognition"
>
  <div class="icon-container">
    <span class="material-icons">category</span>
    {#if isAnalyzing}
      <div class="analyzing-indicator"></div>
    {:else if objectCount > 0}
      <div class="object-count">{objectCount}</div>
    {/if}
  </div>
  <span class="button-text">AI Shape Recognition</span>
  <div class="technology-label">TensorFlow | CNN | Stroke Analysis</div>
</button>

<style>
  .shape-recognition-button {
    position: fixed;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 10px 16px;
    background: white;
    border: none;
    border-radius: 50px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
    cursor: pointer;
    z-index: 1000;
    color: #333;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
    overflow: hidden;
  }

  .shape-recognition-button:hover {
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
    transform: translateY(-2px);
  }

  .shape-recognition-button.active {
    background: #9C27B0;
    color: white;
  }

  .icon-container {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .material-icons {
    font-size: 20px;
  }

  .object-count {
    position: absolute;
    top: -6px;
    right: -8px;
    background: #4CAF50;
    color: white;
    width: 16px;
    height: 16px;
    font-size: 10px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
  }

  .analyzing-indicator {
    position: absolute;
    top: -6px;
    right: -8px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #2196F3;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0% { opacity: 0.6; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
    100% { opacity: 0.6; transform: scale(0.8); }
  }

  .button-text {
    margin-right: 4px;
    white-space: nowrap;
    font-weight: bold;
  }

  .technology-label {
    font-size: 9px;
    opacity: 0.7;
    white-space: nowrap;
  }

  @media (max-width: 768px) {
    .shape-recognition-button {
      padding: 10px;
    }

    .button-text {
      display: none;
    }

    .technology-label {
      display: none;
    }
  }
</style>