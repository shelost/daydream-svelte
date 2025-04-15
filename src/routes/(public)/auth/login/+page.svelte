<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { gsap } from 'gsap';
  import { signInWithEmail, signInWithGoogle } from '$lib/supabase/auth';
  import { isLoggedIn, user } from '$lib/stores/appStore';
  import { supabase } from '$lib/supabase/client';

  let email = '';
  let password = '';
  let loading = false;
  let error = '';
  let formContainer: HTMLElement;

  onMount(() => {
    // If user is already logged in, redirect to app
    if ($isLoggedIn) {
      console.log('User already logged in, redirecting to app');
      goto('/app');
      return;
    }

    // Check if the URL contains an access token in the hash fragment
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    if (hashParams.has('access_token')) {
      console.log('Found access token in URL hash, processing OAuth response');
      handleHashBasedAuth(hashParams);
      return;
    }

    // Check for error in URL query params
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('error')) {
      error = `Authentication error: ${urlParams.get('error')}`;
      console.error(error);
    }

    // Animation with GSAP
    gsap.from(formContainer, {
      y: 20,
      opacity: 0,
      duration: 0.6,
      ease: "power2.out"
    });
  });

  // Handle OAuth response with hash-based tokens
  async function handleHashBasedAuth(hashParams) {
    try {
      loading = true;
      error = '';
      console.log('Processing hash-based authentication');

      // Extract tokens from hash
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');
      const expiresIn = hashParams.get('expires_in');
      const tokenType = hashParams.get('token_type') || 'bearer';

      if (!accessToken) {
        error = 'No access token found in URL';
        console.error(error);
        return;
      }

      // Set the session in Supabase
      const { data, error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken || ''
      });

      if (sessionError) {
        error = sessionError.message;
        console.error('Error setting session:', sessionError);
        return;
      }

      if (data?.user) {
        console.log('User authenticated successfully via hash params');
        user.set(data.user);

        // Clear the hash fragment from the URL
        window.history.replaceState(null, '', window.location.pathname);

        // Redirect to app with delay to allow state update
        setTimeout(() => {
          console.log('Redirecting to app...');
          goto('/app');
        }, 300);
      }
    } catch (err) {
      console.error('Error processing hash-based auth:', err);
      error = err instanceof Error ? err.message : 'Authentication failed';
    } finally {
      loading = false;
    }
  }

  const handleEmailLogin = async () => {
    if (!email || !password) {
      error = 'Please enter both email and password';
      return;
    }

    try {
      loading = true;
      error = '';
      console.log('Attempting email login...');

      const { data, error: signInError } = await signInWithEmail(email, password);

      if (signInError) {
        console.error('Login error:', signInError);
        error = signInError.message;
        return;
      }

      if (data && data.user) {
        console.log('Login successful, updating user state');
        user.set(data.user);

        // Redirect to app with a slight delay to allow state to update
        setTimeout(() => {
          console.log('Redirecting to app...');
          goto('/app');
        }, 300);
      } else {
        error = 'Login successful but user data not received';
        console.error(error);
      }
    } catch (err) {
      console.error('Unexpected login error:', err);
      if (err instanceof Error) {
        error = err.message;
      } else {
        error = 'An error occurred during login';
      }
    } finally {
      loading = false;
    }
  };

  const handleGoogleLogin = async () => {
    try {
      loading = true;
      error = '';
      console.log('Initiating Google login...');

      const { data, error: signInError } = await signInWithGoogle();

      if (signInError) {
        console.error('Google login error:', signInError);
        error = signInError.message;
      } else {
        console.log('Google login flow initiated');
      }
    } catch (err) {
      console.error('Unexpected Google login error:', err);
      if (err instanceof Error) {
        error = err.message;
      } else {
        error = 'An error occurred during login';
      }
    } finally {
      loading = false;
    }
  };
</script>

<svelte:head>
  <title>Log In - Daydream</title>
</svelte:head>

<div class="auth-page">
  <div class="auth-container" bind:this={formContainer}>
    <h1>Log In</h1>

    {#if error}
      <div class="error-message">
        {error}
      </div>
    {/if}

    {#if loading}
      <div class="loading-message">
        <p>Processing authentication...</p>
      </div>
    {:else}
      <form on:submit|preventDefault={handleEmailLogin} class="auth-form">
        <div class="form-group">
          <label for="email">Email</label>
          <input
            id="email"
            type="email"
            placeholder="Enter your email"
            bind:value={email}
            disabled={loading}
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Enter your password"
            bind:value={password}
            disabled={loading}
          />
        </div>

        <button type="submit" class="auth-button" disabled={loading}>
          {loading ? 'Loading...' : 'Log In'}
        </button>
      </form>

      <div class="divider">
        <span>or</span>
      </div>

      <button
        class="google-button"
        on:click={handleGoogleLogin}
        disabled={loading}
      >
        <span class="google-icon">G</span>
        Continue with Google
      </button>

      <div class="auth-footer">
        <p>
          Don't have an account? <a href="/auth/signup">Sign Up</a>
        </p>
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
  .auth-page {
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: $background-color;
  }

  .auth-container {
    width: 100%;
    max-width: 400px;
    padding: 2rem;
    background-color: white;
    border-radius: $border-radius-lg;
    box-shadow: $shadow-md;
  }

  h1 {
    margin-bottom: 1.5rem;
    font-size: 1.8rem;
    font-weight: 600;
    text-align: center;
    color: $text-color;
  }

  .error-message {
    background-color: rgba($error-color, 0.1);
    color: $error-color;
    padding: 0.75rem;
    border-radius: $border-radius-sm;
    margin-bottom: 1.5rem;
    text-align: center;
    font-size: 0.9rem;
  }

  .loading-message {
    text-align: center;
    padding: 1.5rem 0;
    color: $text-color;
  }

  .auth-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    label {
      font-size: 0.9rem;
      font-weight: 500;
    }

    input {
      padding: 0.75rem 1rem;
      font-size: 1rem;
      border-radius: $border-radius-sm;
      border: 1px solid $border-color;

      &:focus {
        border-color: $primary-color;
        outline: none;
      }
    }
  }

  .auth-button {
    padding: 0.75rem 1rem;
    font-size: 1rem;
    background-color: $primary-color;
    color: white;
    border: none;
    border-radius: $border-radius-sm;
    cursor: pointer;
    transition: background-color $transition-fast;

    &:hover {
      opacity: 0.9;
    }

    &:disabled {
      background-color: lighten($primary-color, 20%);
      cursor: not-allowed;
    }
  }

  .divider {
    display: flex;
    align-items: center;
    margin: 1.5rem 0;

    &::before,
    &::after {
      content: '';
      flex: 1;
      height: 1px;
      background-color: $border-color;
    }

    span {
      padding: 0 1rem;
      color: rgba($text-color, 0.6);
      font-size: 0.9rem;
    }
  }

  .google-button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem 1rem;
    background-color: white;
    color: $text-color;
    border: 1px solid $border-color;
    border-radius: $border-radius-sm;
    cursor: pointer;
    transition: all $transition-fast;

    &:hover {
      background-color: rgba($text-color, 0.03);
    }

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  }

  .google-icon {
    font-weight: 600;
    color: $primary-color;
  }

  .auth-footer {
    margin-top: 2rem;
    text-align: center;
    font-size: 0.9rem;

    a {
      color: $primary-color;
      font-weight: 500;
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }
</style>