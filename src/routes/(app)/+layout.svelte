<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { user, profile, isLoggedIn } from '$lib/stores/appStore';
  import { supabase } from '$lib/supabase/client';
  import { browser } from '$app/environment';
  import { theme, initTheme } from '$lib/stores/themeStore';
  import '$lib/styles/global.scss';

  let isLoading = true;

  onMount(async () => {
    // Initialize theme immediately
    if (browser) {
      initTheme();
    }

    // Set up auth state listener
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session ? 'session exists' : 'no session');

      if (event === 'SIGNED_IN' && session) {
        user.set(session.user);
        loadProfile(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        user.set(null);
        profile.set(null);
        goto('/');
      }
    });

    try {
      // Get initial session
      console.log('Checking initial session...');
      const { data: { session } } = await supabase.auth.getSession();
      console.log('Session check result:', session ? 'session exists' : 'no session');

      if (session) {
        user.set(session.user);
        await loadProfile(session.user.id);
        isLoading = false;
      } else {
        // Redirect to login if not authenticated
        console.log('No session found, redirecting to login');
        goto('/');
        return;
      }
    } catch (error) {
      console.error('Error checking auth state:', error);
      goto('/');
    } finally {
      isLoading = false;
    }

    return () => {
      data.subscription.unsubscribe();
    };
  });

  async function loadProfile(userId: string) {
    try {
      // Try to get existing profile
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error loading profile:', error);

        // If the error is because no profile exists, create one
        if (error.code === 'PGRST116') {
          console.log('No profile found, creating a new profile');

          // Create a new profile
          const { data: newProfile, error: createError } = await supabase
            .from('profiles')
            .insert([
              {
                id: userId,
                full_name: $user?.user_metadata?.full_name || 'New User',
                avatar_url: $user?.user_metadata?.avatar_url || null,
                updated_at: new Date().toISOString()
              }
            ])
            .select()
            .single();

          if (createError) {
            console.error('Error creating profile:', createError);
            return;
          }

          if (newProfile) {
            console.log('Profile created successfully');
            profile.set(newProfile);
          }
        }

        return;
      }

      if (data) {
        console.log('Profile loaded successfully');
        profile.set(data);
      }
    } catch (error) {
      console.error('Unexpected error loading profile:', error);
    }
  }
</script>

<div class="app-container" class:theme-dark={$theme === 'dark'} class:theme-light={$theme === 'light'}>
  {#if isLoading}
    <div class="loading-container">
      <p>Loading app...</p>
    </div>
  {:else if $isLoggedIn}
    <slot />
  {:else}
    <div class="loading-container">
      <p>Authentication required. Redirecting...</p>
    </div>
  {/if}
</div>

<style lang="scss">
  .app-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: var(--background-color);
    background: rgb(145, 150, 185);
    color: var(--text-color);
    transition: background-color 0.3s ease, color 0.3s ease;
  }

  .loading-container {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 1.2rem;
    color: var(--text-color);
  }
</style>