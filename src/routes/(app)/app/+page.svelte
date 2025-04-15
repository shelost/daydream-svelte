<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gsap } from 'gsap';
  import { pages, pagesByType, user } from '$lib/stores/appStore';
  import { getPages, createPage } from '$lib/supabase/pages';
  import { supabase } from '$lib/supabase/client';
  import type { Page } from '$lib/types';

  let loading = true;
  let error = '';
  let creatingPage = false;

  onMount(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        goto('/');
        return;
      }

      // Only load pages if they're not already loaded (in the layout)
      if ($pages.length === 0) {
        const { data, error: pagesError } = await getPages(user.id);

        if (pagesError) {
          error = pagesError.message;
          return;
        }

        if (data) {
          pages.set(data);
        }
      }

      // Animate the content
      gsap.from('.page-item', {
        y: 20,
        opacity: 0,
        stagger: 0.1,
        duration: 0.5,
        ease: "power2.out"
      });

    } catch (err) {
      if (err instanceof Error) {
        error = err.message;
      }
    } finally {
      loading = false;
    }
  });

  async function handleCreate(type: 'canvas' | 'drawing') {
    if (creatingPage || !$user) return;

    try {
      creatingPage = true;
      // Create page in database
      const { data, error: createError } = await createPage(
        $user.id,
        type
      );

      if (createError) {
        console.error('Error creating page:', createError);
        error = createError.message;
        return;
      }

      if (!data) {
        error = 'Failed to create page';
        return;
      }

      // Add the new page to our store
      pages.update(currentPages => [...currentPages, data]);

      // Navigate directly to the new page
      goto(`/app/${type}/${data.id}`);
    } catch (err) {
      console.error('Unexpected error creating page:', err);
      error = err instanceof Error ? err.message : 'Failed to create page';
    } finally {
      creatingPage = false;
    }
  }

  function handlePageClick(page: Page) {
    // Navigate to the appropriate editor based on page type
    goto(`/app/${page.type}/${page.id}`);
  }
</script>

<svelte:head>
  <title>Daydream - My Pages</title>
</svelte:head>

<div class="app-content">
  <div class="app-home">
    <div class="app-header">
      <h1>My Pages</h1>
      <div class="action-buttons">
        <button on:click={() => handleCreate('canvas')} class="create-button" disabled={creatingPage}>
          <span>+</span> New Canvas
        </button>
        <button on:click={() => handleCreate('drawing')} class="create-button secondary" disabled={creatingPage}>
          <span>+</span> New Drawing
        </button>
      </div>
    </div>

    {#if loading || creatingPage}
      <div class="loading">{creatingPage ? 'Creating new page...' : 'Loading...'}</div>
    {:else if error}
      <div class="error">{error}</div>
    {:else if $pages.length === 0}
      <div class="empty-state">
        <p>You don't have any pages yet.</p>
        <p>Create your first canvas or drawing to get started!</p>
      </div>
    {:else}
      <div class="pages-container">
        {#if $pagesByType.canvasPages.length > 0}
          <div class="pages-section">
            <h2>Canvas Pages</h2>
            <div class="pages-grid">
              {#each $pagesByType.canvasPages as page}
                <div class="page-item" on:click={() => handlePageClick(page)}>
                  <div class="page-card">
                    <div class="page-icon">{page.icon || '📄'}</div>
                    <div class="page-title">{page.title}</div>
                    <div class="page-updated">
                      Updated {new Date(page.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        {#if $pagesByType.drawingPages.length > 0}
          <div class="pages-section">
            <h2>Drawing Pages</h2>
            <div class="pages-grid">
              {#each $pagesByType.drawingPages as page}
                <div class="page-item" on:click={() => handlePageClick(page)}>
                  <div class="page-card">
                    <div class="page-icon">{page.icon || '✏️'}</div>
                    <div class="page-title">{page.title}</div>
                    <div class="page-updated">
                      Updated {new Date(page.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .app-content {
    flex: 1;
    overflow: auto;
  }

  .app-home {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
  }

  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;

    h1 {
      font-size: 2rem;
      font-weight: 600;
      color: $text-color;
    }
  }

  .action-buttons {
    display: flex;
    gap: 1rem;
  }

  .create-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    font-size: 1rem;
    border-radius: $border-radius-md;
    transition: all $transition-fast;
    background-color: $primary-color;
    color: white;
    border: none;
    cursor: pointer;

    &:hover:not(:disabled) {
      opacity: 0.9;
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    &.secondary {
      background-color: transparent;
      border: 1px solid $primary-color;
      color: $primary-color;

      &:hover:not(:disabled) {
        background-color: rgba($primary-color, 0.05);
      }
    }

    span {
      font-size: 1.2rem;
      font-weight: 600;
    }
  }

  .pages-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .pages-section {
    h2 {
      font-size: 1.4rem;
      font-weight: 500;
      margin-bottom: 1rem;
      color: $text-color;
    }
  }

  .pages-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 1.5rem;
  }

  .page-item {
    cursor: pointer;
  }

  .page-card {
    background-color: white;
    border-radius: $border-radius-md;
    padding: 1.5rem;
    border: 1px solid $border-color;
    transition: all $transition-fast;
    box-shadow: -8px 8px 16px rgba(black, 0.1);

    &:hover {
      transform: translateY(-3px);
      box-shadow: $shadow-md;
      border-color: rgba($primary-color, 0.3);
    }
  }

  .page-icon {
    font-size: 2rem;
    margin-bottom: 1rem;
  }

  .page-title {
    font-size: 1.1rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
    color: $text-color;
  }

  .page-updated {
    font-size: 0.8rem;
    color: rgba($text-color, 0.6);
  }

  .loading, .error, .empty-state {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 3rem 0;
    text-align: center;
    color: $text-color;

    p {
      margin-bottom: 0.5rem;
    }
  }

  .error {
    color: $error-color;
  }

  .empty-state {
    background-color: rgba($text-color, 0.03);
    border-radius: $border-radius-lg;
    padding: 3rem;

    p:first-child {
      font-size: 1.2rem;
      font-weight: 500;
    }
  }
</style>