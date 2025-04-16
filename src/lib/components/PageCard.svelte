<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { goto } from '$app/navigation';
  import PageThumbnail from './PageThumbnail.svelte';
  import { formatDate } from '$lib/utils/drawingUtils';
  import type { Page } from '$lib/types';

  export let page: Page;

  const dispatch = createEventDispatcher();

  function handleClick() {
    // Navigate to the page based on its type
    goto(`/app/${page.type}/${page.id}`);
  }

  function handleOptionsClick(event: MouseEvent) {
    event.stopPropagation(); // Prevent card click
    dispatch('options', { page });
  }
</script>

<div class="page-card" on:click={handleClick}>
  <div class="thumbnail">
    <PageThumbnail {page} size="medium" />
  </div>

  <div class="card-content">
    <div class="card-header">
      <h3 class="page-title">{page.title || 'Untitled'}</h3>

      <button
        class="options-button"
        on:click={handleOptionsClick}
        aria-label="Page options"
      >
        <span class="material-icons">more_vert</span>
      </button>
    </div>

    <div class="page-meta">
      <div class="meta-item">
        <span class="material-icons">{page.type === 'canvas' ? 'dashboard' : 'edit'}</span>
        <span>{page.type}</span>
      </div>

      {#if page.updated_at}
        <div class="meta-item">
          <span class="material-icons">schedule</span>
          <span>{formatDate(page.updated_at)}</span>
        </div>
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  .page-card {
    display: flex;
    flex-direction: column;
    background-color: var(--card-bg-color, white);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    cursor: pointer;
    height: 100%;

    &:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 20px rgba(0, 0, 0, 0.1);
    }

    .thumbnail {
      width: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .card-content {
      padding: 12px;
      display: flex;
      flex-direction: column;
      flex: 1;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }

    .page-title {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-color, #333);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .options-button {
      background: none;
      border: none;
      cursor: pointer;
      opacity: 0.6;
      padding: 4px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;

      &:hover {
        background-color: rgba(0, 0, 0, 0.05);
        opacity: 1;
      }

      .material-icons {
        font-size: 18px;
        color: var(--text-color, #333);
      }
    }

    .page-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: auto;
      font-size: 0.75rem;
      color: var(--text-secondary, #666);

      .meta-item {
        display: flex;
        align-items: center;
        gap: 4px;

        .material-icons {
          font-size: 14px;
        }

        span {
          text-transform: capitalize;
        }
      }
    }
  }
</style>