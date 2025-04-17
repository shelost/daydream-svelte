<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gsap } from 'gsap';
  import { pages, pagesByType, user } from '$lib/stores/appStore';
  import { getPages, createPage, uploadThumbnail } from '$lib/supabase/pages';
  import { supabase } from '$lib/supabase/client';
  import { theme } from '$lib/stores/themeStore';
  import type { Page } from '$lib/types';
  import PageCard from '$lib/components/PageCard.svelte';
  import ThemeToggle from '$lib/components/ThemeToggle.svelte';

  let loading = true;
  let error = '';
  let creatingPage = false;

  // Helper function to get the appropriate Material Icon based on page type
  function getPageIcon(type: 'canvas' | 'drawing', icon?: string): string {
    if (icon) return icon;
    return type === 'canvas' ? 'dashboard' : 'edit';
  }

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
          // Check for pages without thumbnails
          let needsThumbnails = false;
          data.forEach(page => {
            if (!page.thumbnail_url) {
              console.log(`Page ${page.id} has no thumbnail`);
              needsThumbnails = true;
            }
          });

          if (needsThumbnails) {
            console.log('Some pages need thumbnails. Visit them to generate their thumbnails.');
          }

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

      // Create default thumbnail placeholder for new pages
      try {
        // Create canvas for thumbnail generation
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          // Draw a placeholder thumbnail
          // Background
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Light background pattern
          ctx.fillStyle = '#f5f5f5';
          ctx.fillRect(0, 0, canvas.width, canvas.height);

          // Add a simple icon based on page type
          ctx.fillStyle = '#cccccc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // Draw material design-like icon
          if (type === 'canvas') {
            // Draw dashboard icon
            const iconSize = 60;
            const x = canvas.width / 2;
            const y = canvas.height / 2 - 20;

            // Draw grid squares for dashboard icon
            const gridSize = iconSize / 3;

            // Draw icon frame
            ctx.strokeStyle = '#cccccc';
            ctx.lineWidth = 4;
            ctx.strokeRect(x - iconSize/2, y - iconSize/2, iconSize, iconSize);

            // Top-left square
            ctx.fillRect(x - iconSize/2 + 6, y - iconSize/2 + 6, gridSize - 6, gridSize - 6);

            // Top-right square
            ctx.fillRect(x - iconSize/2 + gridSize + 6, y - iconSize/2 + 6, gridSize - 6, gridSize - 6);

            // Bottom-left square
            ctx.fillRect(x - iconSize/2 + 6, y - iconSize/2 + gridSize + 6, gridSize - 6, gridSize - 6);

            // Bottom-right square
            ctx.fillRect(x - iconSize/2 + gridSize + 6, y - iconSize/2 + gridSize + 6, gridSize - 6, gridSize - 6);
          } else {
            // Draw edit icon
            const iconSize = 60;
            const x = canvas.width / 2;
            const y = canvas.height / 2 - 20;

            // Draw pencil icon
            // Pencil body
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(Math.PI / 4); // 45 degree rotation

            // Pencil body
            ctx.fillRect(-iconSize/8, -iconSize/2, iconSize/4, iconSize*0.7);

            // Pencil tip
            ctx.beginPath();
            ctx.moveTo(-iconSize/8, iconSize*0.2);
            ctx.lineTo(iconSize/8, iconSize*0.2);
            ctx.lineTo(0, iconSize*0.3);
            ctx.fill();

            // Eraser part
            ctx.fillStyle = '#e0e0e0';
            ctx.fillRect(-iconSize/8, -iconSize/2, iconSize/4, iconSize*0.15);

            ctx.restore();
          }

          // Add text
          ctx.fillStyle = '#999999';
          ctx.font = '16px sans-serif';
          ctx.fillText(`New ${type}`, canvas.width / 2, canvas.height / 2 + 40);

          // Convert to blob and upload
          canvas.toBlob(async (blob) => {
            if (blob && data.id) {
              await uploadThumbnail(data.id, blob);
            }
          }, 'image/png', 0.8);
        }
      } catch (err) {
        // Don't block page creation if thumbnail generation fails
        console.error('Error generating initial thumbnail:', err);
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
  <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

<div class="app-content">
  <div class="app-home">
    <div class="app-header">
      <div class="header-left">
        <h1>My Pages</h1>
        <div class="theme-container">
          <ThemeToggle />
          <span class="theme-label">{$theme === 'light' ? 'Light' : 'Dark'} Mode</span>
        </div>
      </div>
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
                <PageCard {page} />
              {/each}
            </div>
          </div>
        {/if}

        {#if $pagesByType.drawingPages.length > 0}
          <div class="pages-section">
            <h2>Drawing Pages</h2>
            <div class="pages-grid">
              {#each $pagesByType.drawingPages as page}
                <PageCard {page} />
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .header-left {
    display: flex;
    align-items: center;
    gap: 20px;
  }

  .theme-container {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: 10px;
  }

  .theme-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-color);
    opacity: 0.8;
  }

  h2{
    letter-spacing: -.9px;
  }

  .app-content {
    flex: 1;
    overflow: auto;
    height: 100%;
    background-color: var(--background-color);
    color: var(--text-color);
  }

  .app-home {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
    height: 100%;
    overflow-y: scroll;
  }

  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;

    h1 {
      font-size: 32px;
      font-weight: 600;
      letter-spacing: -1.5px;
      color: var(--text-color);
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
    background-color: var(--primary-color);
    color: var(--text-color, white);
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
      border: 1px solid var(--primary-color);
      color: var(--primary-color);

      &:hover:not(:disabled) {
        background-color: var(--hover-bg);
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
      color: var(--text-color);
    }
  }

  .pages-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
  }

  .page-item {
    cursor: pointer;
  }

  .page-card {
    background-color: var(--card-bg);
    border-radius: $border-radius-md;
    padding: 1rem;
    overflow: hidden;
    border: 1px solid var(--border-color);
    transition: all $transition-fast;
    box-shadow: 0 4px 12px var(--card-shadow);

    &:hover {
      transform: translateY(-3px);
      box-shadow: $shadow-md;
      border-color: var(--primary-color, rgba($primary-color, 0.3));
    }
  }

  .page-thumbnail {
    width: 100%;
    height: 140px;
    border-radius: $border-radius-sm;
    overflow: hidden;
    margin-bottom: 1rem;
    border: 1px solid var(--border-color);
    background-color: var(--card-bg);
    position: relative;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
  }

  .thumbnail-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background-color: var(--hover-bg);

    span {
      font-size: 2.5rem;
      opacity: 0.7;
      color: var(--text-color);
    }

    .placeholder-label {
      margin-top: 8px;
      font-size: 0.8rem;
      color: var(--text-color);
      opacity: 0.6;
      font-weight: 500;
    }
  }

  .page-title {
    font-size: 1rem;
    font-weight: 500;
    margin-bottom: 0.5rem;
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

  .loading, .error, .empty-state {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    padding: 3rem 0;
    text-align: center;
    color: var(--text-color);

    p {
      margin-bottom: 0.5rem;
    }
  }

  .error {
    color: var(--error-color);
  }

  .empty-state {
    background-color: var(--hover-bg);
    border-radius: $border-radius-lg;
    padding: 3rem;

    p:first-child {
      font-size: 1.2rem;
      font-weight: 500;
    }
  }
</style>