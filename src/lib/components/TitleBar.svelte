<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { updatePage } from '$lib/supabase/pages';
  import { gsap } from 'gsap';

  export let page: any; // Page data
  export let saving: boolean = false;
  export let saveStatus: 'saved' | 'saving' | 'error' = 'saved';

  let editingTitle = false;
  let titleInput: HTMLInputElement;
  let newTitle = '';

  let editingIcon = false;
  let iconInput: HTMLInputElement;
  let newIcon = '';

  const commonIcons = ['📄', '✏️', '📝', '📑', '📋', '📌', '🗂️', '🗒️', '📚', '🎨', '🖌️', '💻', '📊', '📈', '🚀', '💡', '🔍'];

  function startEditingTitle() {
    editingTitle = true;
    newTitle = page.title;

    // Focus the input after the DOM updates
    setTimeout(() => {
      if (titleInput) {
        titleInput.focus();
        titleInput.select();
      }
    }, 0);
  }

  function startEditingIcon() {
    editingIcon = true;
    newIcon = page.icon || (page.type === 'canvas' ? '📄' : '✏️');

    // Focus the input after the DOM updates
    setTimeout(() => {
      if (iconInput) {
        iconInput.focus();
        iconInput.select();
      }
    }, 0);
  }

  async function saveTitle() {
    if (!newTitle.trim() || newTitle === page.title) {
      editingTitle = false;
      return;
    }

    saving = true;
    saveStatus = 'saving';

    try {
      const { error } = await updatePage(page.id, { title: newTitle });

      if (error) {
        console.error('Error updating title:', error);
        saveStatus = 'error';
      } else {
        // Update the local page object with the new title
        page.title = newTitle;
        saveStatus = 'saved';
      }
    } catch (err) {
      console.error('Unexpected error saving title:', err);
      saveStatus = 'error';
    } finally {
      saving = false;
      editingTitle = false;
    }
  }

  async function saveIcon() {
    if (newIcon === page.icon) {
      editingIcon = false;
      return;
    }

    saving = true;
    saveStatus = 'saving';

    try {
      const { error } = await updatePage(page.id, { icon: newIcon });

      if (error) {
        console.error('Error updating icon:', error);
        saveStatus = 'error';
      } else {
        // Update the local page object with the new icon
        page.icon = newIcon;
        saveStatus = 'saved';

        // Animate the icon update
        animateIconUpdate();
      }
    } catch (err) {
      console.error('Unexpected error saving icon:', err);
      saveStatus = 'error';
    } finally {
      saving = false;
      editingIcon = false;
    }
  }

  function animateIconUpdate() {
    const iconElement = document.querySelector('.page-icon');
    if (iconElement) {
      gsap.from(iconElement, {
        scale: 0.5,
        opacity: 0,
        duration: 0.3,
        ease: "back.out(1.7)"
      });
    }
  }

  function handleTitleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveTitle();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editingTitle = false;
    }
  }

  function handleIconKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveIcon();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editingIcon = false;
    }
  }

  function selectIcon(icon: string) {
    newIcon = icon;
    saveIcon();
  }

  function navigateToHome() {
    goto('/app');
  }
</script>

<div class="title-bar">
  <div class="breadcrumbs">
    <span class="breadcrumb-item" on:click={navigateToHome}>Home</span>
    <span class="breadcrumb-separator">›</span>
    <span class="breadcrumb-item current">{page.type === 'canvas' ? 'Canvas' : 'Drawing'}</span>
  </div>

  <div class="title-section">
    <div class="icon-section">
      {#if editingIcon}
        <div class="icon-editor">
          <input
            bind:this={iconInput}
            bind:value={newIcon}
            type="text"
            maxlength="2"
            on:blur={saveIcon}
            on:keydown={handleIconKeydown}
          />
          <div class="icon-picker">
            {#each commonIcons as icon}
              <button class="icon-option" on:click={() => selectIcon(icon)}>{icon}</button>
            {/each}
          </div>
        </div>
      {:else}
        <button on:click={startEditingIcon} class="page-icon">
          {page.icon || (page.type === 'canvas' ? '📄' : '✏️')}
        </button>
      {/if}
    </div>

    {#if editingTitle}
      <input
        bind:this={titleInput}
        bind:value={newTitle}
        type="text"
        on:blur={saveTitle}
        on:keydown={handleTitleKeydown}
      />
    {:else}
      <h1 on:click={startEditingTitle} class="page-title">
        {page.title || 'Untitled'}
      </h1>
    {/if}
  </div>

  <div class="status-section">
    {#if saveStatus === 'saving'}
      <span class="status-indicator saving">Saving...</span>
    {:else if saveStatus === 'error'}
      <span class="status-indicator error">Error saving</span>
    {:else}
      <span class="status-indicator saved">All changes saved</span>
    {/if}
  </div>
</div>

<style lang="scss">
  .title-bar {
    background-color: $titlebar-bg;
    border-bottom: 1px solid $border-color;
    padding: 8px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 52px;
    backdrop-filter: blur(10px);
  }

  .breadcrumbs {
    display: flex;
    align-items: center;
    font-size: 12px;
    color: rgba($text-color, 0.6);
    margin-right: 12px;
  }

  .breadcrumb-item {
    cursor: pointer;
    padding: 2px 4px;
    border-radius: $border-radius-sm;

    &:hover {
      background-color: rgba($text-color, 0.05);
    }

    &.current {
      color: rgba($text-color, 0.8);
      font-weight: 500;
    }
  }

  .breadcrumb-separator {
    margin: 0 4px;
  }

  .title-section {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;

    h1 {
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -.6px;
      margin: 0;
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: $border-radius-sm;

      &:hover {
        background-color: rgba($text-color, 0.05);
      }
    }

    input {
      font-size: 16px;
      font-weight: 600;
      letter-spacing: -.6px;
      padding: 0.25rem 0.5rem;
      border-radius: $border-radius-sm;
      border: 1px solid $primary-color;
      outline: none;
      width: 100%;
      max-width: 400px;
    }
  }

  .icon-section {
    position: relative;
  }

  .page-icon {
    font-size: 20px;
    background: none;
    border: none;
    padding: 4px;
    border-radius: $border-radius-sm;
    cursor: pointer;
    transition: all $transition-fast;

    &:hover {
      background-color: rgba($text-color, 0.05);
    }
  }

  .icon-editor {
    position: relative;

    input {
      width: 40px;
      font-size: 20px;
      text-align: center;
      padding: 4px;
      border-radius: $border-radius-sm;
      border: 1px solid $primary-color;
      outline: none;
    }

    .icon-picker {
      position: absolute;
      top: 100%;
      left: 0;
      margin-top: 4px;
      background-color: $card-bg;
      border: 1px solid $border-color;
      border-radius: $border-radius-md;
      padding: 8px;
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 4px;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .icon-option {
      font-size: 18px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      border-radius: $border-radius-sm;
      cursor: pointer;

      &:hover {
        background-color: rgba($text-color, 0.05);
      }
    }
  }

  .status-section {
    font-size: 0.85rem;
    margin-left: 1rem;
  }

  .status-indicator {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: $border-radius-sm;

    &.saving {
      color: $text-color;
    }

    &.error {
      color: $error-color;
    }

    &.saved {
      color: $success-color;
    }
  }
</style>