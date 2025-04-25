<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { pages, isSidebarOpen, profile, userInitials } from '$lib/stores/appStore';
  import { supabase } from '$lib/supabase/client';
  import { gsap } from 'gsap';

  export let currentPageId: string;

  // Helper function to get the appropriate Material Icon based on page type
  function getPageIcon(type: 'canvas' | 'drawing', icon?: string): string {
    if (icon) return icon;
    return type === 'canvas' ? 'dashboard' : 'edit';
  }

  function toggleSidebar() {
    isSidebarOpen.update(value => !value);
  }

  function navigateToPage(pageId: string) {
    if (pageId === currentPageId) return;

    const selectedPage = $pages.find(p => p.id === pageId);
    if (selectedPage) {
      goto(`/app/${selectedPage.type}/${selectedPage.id}`);
    }
  }

  function navigateToProfile() {
    goto('/app/profile');
  }

  function createNewPage(type: 'canvas' | 'drawing') {
    goto(`/app?create=${type}`);
  }

  // Animation for the profile section
  function animateProfileHover(element: HTMLElement, isEntering: boolean) {
    if (isEntering) {
      gsap.to(element, {
        scale: 1.05,
        duration: 0.2,
        ease: "power1.out"
      });
    } else {
      gsap.to(element, {
        scale: 1,
        duration: 0.2,
        ease: "power1.in"
      });
    }
  }
</script>

<svelte:head>
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

<aside class:collapsed={!$isSidebarOpen} class="sidebar">
  <div class="sidebar-header">



    <img src="/arachne-icon.png" alt="Arachne" class="sidebar-logo" />
    <h2>Daydream</h2>
    <button on:click={toggleSidebar} class="toggle-button">
      <span class="material-icons">
        {$isSidebarOpen ? 'chevron_left' : 'chevron_right'}
      </span>
    </button>
  </div>

  <nav class="sidebar-nav">
    <a href="/app" class="nav-home">
      <span class="material-icons">home</span>
      {#if $isSidebarOpen}<span class="text">Home</span>{/if}
    </a>

    {#if $isSidebarOpen}
      <div class="sidebar-section">
        <h3>Pages</h3>
        <div class="create-buttons">
          <button on:click={() => createNewPage('canvas')} class="create-button">
            <span class="material-icons">add</span> Canvas
          </button>
          <button on:click={() => createNewPage('drawing')} class="create-button">
            <span class="material-icons">add</span> Drawing
          </button>
        </div>
      </div>
    {/if}

    <ul class="pages-list">
      {#each $pages as page}
        <li
          class:active={page.id === currentPageId}
          on:click={() => navigateToPage(page.id)}
          on:keydown={(e) => e.key === 'Enter' && navigateToPage(page.id)}
          tabindex="0"
        >
          <span class="material-icons">{getPageIcon(page.type, page.icon)}</span>
          {#if $isSidebarOpen}<span class="text">{page.title}</span>{/if}
        </li>
      {/each}
    </ul>
  </nav>

  <div class="sidebar-footer">
    <button
      class="profile-button"
      on:click={navigateToProfile}
      on:mouseenter={(e) => animateProfileHover(e.currentTarget, true)}
      on:mouseleave={(e) => animateProfileHover(e.currentTarget, false)}
    >
      {#if $profile?.avatar_url}
        <img src={$profile.avatar_url} alt="Profile" class="profile-avatar" />
      {:else}
        <div class="profile-initials">
          {$userInitials}
        </div>
      {/if}
      {#if $isSidebarOpen}
        <div class="profile-info">
          <span class="profile-name">{$profile?.full_name || 'User'}</span>
          <button class="sign-out-button" on:click|stopPropagation={() => supabase.auth.signOut()}>
            <span class="material-icons" style="font-size: 16px; margin-right: 4px;">logout</span>
            Sign out
          </button>
        </div>
      {/if}
    </button>
  </div>
</aside>

<style lang="scss">


  .sidebar {
    height: 100%;
    box-sizing: border-box;
    width: 200px;
    transition: $transition-normal;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    background: var(--sidebar-bg);
    border: none;
    box-shadow: none;

    &.collapsed {
      width: 60px !important;
    }
  }

  .collapsed{
    width: 60px !important;
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    border-bottom: 1px solid $border-color;

    img{
      height: 26px;
      border-radius: 6px;
    }

    h2 {
      font-size: 18px;
      font-weight: 700;
      margin: 0;
      margin-left: 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;

      flex: 1;
    }
  }

  .toggle-button {
    background: none;
    border: none;
    color: $text-color;
    cursor: pointer;
    font-size: 1rem;
    padding: 0.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;

    &:hover {
      background-color: rgba($text-color, 0.05);
    }
  }

  .sidebar-nav {
    padding: 1rem 0;
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
  }

  .nav-home {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    text-decoration: none;
    color: $text-color;
    border-radius: $border-radius-sm;
    margin-bottom: 1rem;

    &:hover {
      background-color: rgba($text-color, 0.05);
    }
  }

  .sidebar-section {
    padding: 0 1rem;
    margin-bottom: 0.5rem;

    h3 {
      font-size: 0.9rem;
      font-weight: 500;
      color: rgba($text-color, 0.7);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
  }

  .create-buttons {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .create-button {
    font-size: 0.8rem;
    padding: 0.3rem 0.6rem;
    background-color: transparent;
    border: 1px solid $border-color;
    border-radius: $border-radius-sm;
    color: $text-color;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    transition: all $transition-fast;

    &:hover {
      background-color: rgba($text-color, 0.05);
      border-color: rgba($text-color, 0.2);
    }

    .plus {
      font-weight: bold;
      font-size: 1rem;
    }
  }

  .pages-list {
    list-style-type: none;
    padding: 0;
    margin: 0;

    .material-icons {
      font-size: 16px;
    }

    li {
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 8px;
      margin: 2px 12px;
      cursor: pointer;
      border-radius: $border-radius-md;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: .2s ease;

      &:hover {
        background-color: rgba(black, 0.05);
      }

      &.active {
        background-color: var(--card-shadow);
        color: var(--text-color);
        font-weight: 600;
      }
    }
  }

  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sidebar-footer {
    border-top: 1px solid $border-color;
    padding: 0.75rem;
    margin-top: auto;
  }

  .profile-button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: none;
    border: none;
    padding: 0.5rem;
    border-radius: $border-radius-md;
    cursor: pointer;
    text-align: left;
    color: $text-color;
    transition: background-color $transition-fast;

    &:hover {
      background-color: rgba($text-color, 0.05);
    }
  }

  .profile-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    object-fit: cover;
  }

  .profile-initials {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background-color: $primary-color;
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 14px;
  }

  .profile-info {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .profile-name {
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sign-out-button {
    font-size: 12px;
    color: rgba($text-color, 0.6);
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;

    &:hover {
      color: $primary-color;
      text-decoration: underline;
    }
  }
</style>