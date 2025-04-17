<script lang="ts">
  import { theme, toggleTheme } from '$lib/stores/themeStore';
</script>

<button
  class="theme-toggle"
  on:click={toggleTheme}
  aria-label="Toggle dark/light theme"
>
  <div class="toggle-track">
    <div class="toggle-indicator" class:dark={$theme === 'dark'}>
      {#if $theme === 'light'}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon">
          <path d="M12 2.25a.75.75 0 01.75.75v2.25a.75.75 0 01-1.5 0V3a.75.75 0 01.75-.75zM7.5 12a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM18.894 6.166a.75.75 0 00-1.06-1.06l-1.591 1.59a.75.75 0 101.06 1.061l1.591-1.59zM21.75 12a.75.75 0 01-.75.75h-2.25a.75.75 0 010-1.5H21a.75.75 0 01.75.75zM17.834 18.894a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 10-1.061 1.06l1.59 1.591zM12 18a.75.75 0 01.75.75V21a.75.75 0 01-1.5 0v-2.25A.75.75 0 0112 18zM7.758 17.303a.75.75 0 00-1.061-1.06l-1.591 1.59a.75.75 0 001.06 1.061l1.591-1.59zM6 12a.75.75 0 01-.75.75H3a.75.75 0 010-1.5h2.25A.75.75 0 016 12zM6.697 7.757a.75.75 0 001.06-1.06l-1.59-1.591a.75.75 0 00-1.061 1.06l1.59 1.591z" />
        </svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="icon">
          <path fill-rule="evenodd" d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z" clip-rule="evenodd" />
        </svg>
      {/if}
    </div>
  </div>
</button>

<style lang="scss">
  .theme-toggle {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    position: relative;

    &:focus {
      outline: 2px solid var(--primary-color);
      border-radius: 16px;
    }
  }

  .toggle-track {
    width: 50px;
    height: 24px;
    background-color: var(--border-color, #e5e5e5);
    border-radius: 12px;
    position: relative;
    transition: all 0.3s ease;
    border: 1px solid var(--border-color, #ccc);
  }

  .toggle-indicator {
    position: absolute;
    width: 22px;
    height: 22px;
    background-color: var(--card-bg, white);
    border-radius: 50%;
    top: 0.5px;
    left: 0.5px;
    transform: translateY(0);
    transition: transform 0.3s ease, background-color 0.3s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);

    &.dark {
      transform: translateX(26px);
      background-color: var(--background-color, #222);
    }

    .icon {
      width: 16px;
      height: 16px;
      color: #f8b84e;

      :global(.toggle-indicator.dark) & {
        color: #f8d84e;
      }
    }
  }
</style>