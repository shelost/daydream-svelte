<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { goto } from '$app/navigation';
  import PageThumbnail from './PageThumbnail.svelte';
  import type { Page } from '$lib/types';
  import { theme } from '$lib/stores/themeStore';

  export let page: Page;

  const dispatch = createEventDispatcher();

  function formatUpdatedAt(dateString: string): string {
    try {
      const now = new Date();
      const updated = new Date(dateString);

      const diffMs = now.getTime() - updated.getTime();

      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHour = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHour / 24);
      const diffMonth = Math.floor(diffDay / 30);
      const diffYear = Math.floor(diffDay / 365);

      if (diffYear > 0) {
        return diffYear === 1 ? 'about 1 year ago' : `about ${diffYear} years ago`;
      } else if (diffMonth > 0) {
        return diffMonth === 1 ? 'about 1 month ago' : `about ${diffMonth} months ago`;
      } else if (diffDay > 0) {
        return diffDay === 1 ? 'yesterday' : `${diffDay} days ago`;
      } else if (diffHour > 0) {
        return diffHour === 1 ? 'about 1 hour ago' : `about ${diffHour} hours ago`;
      } else if (diffMin > 0) {
        return diffMin === 1 ? 'about 1 minute ago' : `about ${diffMin} minutes ago`;
      } else {
        return 'just now';
      }
    } catch (error) {
      return 'Recently';
    }
  }

  function handleClick() {
    goto(`/app/${page.type}/${page.id}`);
  }

  function handleOptionsClick(event: MouseEvent) {
    event.stopPropagation();
    dispatch('options', { page });
  }

  function getPageIcon(type: 'canvas' | 'drawing'): string {
    return type === 'canvas' ? 'dashboard' : 'edit';
  }
</script>

<div class="page-card" on:click={handleClick} data-testid="page-card">
  <div class="page-thumbnail">
    <PageThumbnail {page} size="large" />
  </div>
  <div class = 'expo'>
    <div class="page-title">{page.title || 'Untitled'}</div>
    <div class="page-updated">Updated {formatUpdatedAt(page.updated_at)}</div>
  </div>

</div>

<style lang="scss">
  .page-card {
    //background-color: var(--card-bg);
    border-radius: 8px;
    overflow: hidden;
    //border: 1px solid var(--border-color);
    transition: all 150ms ease;
    box-shadow: 0 4px 12px var(--card-shadow);
    cursor: pointer;

    &:hover {
      transform: translateY(-3px);
      box-shadow: 0 4px 6px var(--card-shadow), 0 1px 3px var(--card-shadow);
      border-color: var(--primary-color);
    }
  }

  .page-thumbnail {
    width: 100%;
    height: 200px;
    border-radius: 8px;
    overflow: hidden;
    //border: 1px solid var(--border-color);
    background-color: var(--card-bg);
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .expo{
    padding: 16px;
  }

  .page-title {
    font-size: 1rem;
    font-weight: 500;
    margin-bottom: 4px;
    color: var(--text-color);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .page-updated {
    font-size: 0.8rem;
    color: var(--text-color);
    opacity: 0.6;
  }
</style>