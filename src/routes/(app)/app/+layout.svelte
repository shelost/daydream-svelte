<script lang="ts">
  import { onMount } from 'svelte';
  import { pages, user } from '$lib/stores/appStore';
  import { getPages } from '$lib/supabase/pages';
  import { supabase } from '$lib/supabase/client';
  import Sidebar from '$lib/components/Sidebar.svelte';
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
  <slot />
</div>

<style lang="scss">
  .app-layout {
    width: 100%;
    height: 100vh;
    display: flex;
    overflow: hidden;
  }
</style>