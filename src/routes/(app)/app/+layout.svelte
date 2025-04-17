<script lang="ts">
  import { onMount } from 'svelte';
  import { pages, user } from '$lib/stores/appStore';
  import { getPages } from '$lib/supabase/pages';
  import { supabase } from '$lib/supabase/client';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import SidebarRight from '$lib/components/SidebarRight.svelte';
  import { page } from '$app/stores';

  let loadingPages = true;

  onMount(async () => {
    // Load all pages for the current user
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (currentUser) {
        // Load all pages for the sidebar
        const { data, error } = await getPages(currentUser.id);

        if (error) {
          console.error('Error loading pages:', error);
        } else if (data) {
          // Update the pages store
          pages.set(data);
        }
      }
    } catch (err) {
      console.error('Unexpected error loading pages:', err);
    } finally {
      loadingPages = false;
    }
  });

  // Extract the current page ID from the URL if available
  $: currentPageId = $page.params.id || '';
</script>

<div class="app-layout">
  <Sidebar currentPageId={currentPageId} />
  <div class="main-content">
    <slot />
  </div>
  <SidebarRight currentPageId={currentPageId} />
</div>

<style lang="scss">
  .app-layout {
    width: 100%;
    height: calc(100vh);
    padding: 12px;
    gap: 12px;
    display: flex;
    overflow: hidden;
  }

  .main-content {
    flex: 1;
    box-shadow: -2px 24px 48px rgba(#030025, 0.16);
    overflow: hidden;
    border-radius: $border-radius-lg;
  }
</style>