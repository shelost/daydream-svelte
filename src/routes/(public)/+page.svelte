<script lang="ts">
  import { onMount } from 'svelte';
  import { gsap } from 'gsap';
  import { goto } from '$app/navigation';
  import { isLoggedIn } from '$lib/stores/appStore';

  let mainHeading: HTMLElement;
  let subHeading: HTMLElement;
  let loginButton: HTMLElement;
  let signupButton: HTMLElement;
  let buttonsVisible = false;

  onMount(() => {
    console.log("Component mounted, buttons:", loginButton, signupButton);

    // Make buttons immediately visible (fallback if GSAP fails)
    buttonsVisible = true;

    // If user is already logged in, redirect to app
    if ($isLoggedIn) {
      goto('/app');
      return;
    }

    // Animation with GSAP
    try {
      const tl = gsap.timeline();

      tl.from(mainHeading, {
        y: -50,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out"
      })
      .from(subHeading, {
        y: -30,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out"
      }, "-=0.5")
      .from([loginButton, signupButton], {
        y: 20,
        opacity: 0,
        duration: 0.5,
        stagger: 0.2,
        ease: "power3.out",
        onStart: () => {
          // Ensure buttons are visible when animation starts
          buttonsVisible = true;
        }
      }, "-=0.3");
    } catch (error) {
      console.error("GSAP animation error:", error);
      // Ensure buttons are visible even if GSAP fails
      buttonsVisible = true;
    }
  });

  const handleLogin = () => {
    goto('/auth/login');
  };

  const handleSignup = () => {
    goto('/auth/signup');
  };
</script>

<svelte:head>
  <title>Daydream - A Powerful Canvas Drawing App</title>
  <meta name="description" content="Create beautiful drawings and canvas compositions with Daydream" />
</svelte:head>

<main class="landing-page">
  <div class="hero-container">
    <h1 bind:this={mainHeading}>Daydream</h1>
    <p bind:this={subHeading}>
      A powerful canvas app for your creative ideas
    </p>

    <div class="button-container">
      <!-- Use inline style for immediate visibility -->
      <button
        bind:this={loginButton}
        class="login-button"
        on:click={handleLogin}
        style="opacity: 1; visibility: visible;">
        Log In
      </button>
      <button
        bind:this={signupButton}
        class="signup-button"
        on:click={handleSignup}
        style="opacity: 1; visibility: visible;">
        Sign Up
      </button>
    </div>
  </div>
</main>

<style lang="scss">
  .landing-page {
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: $background-color;
  }

  .hero-container {
    text-align: center;
    padding: 2rem;
    max-width: 800px;
  }

  h1 {
    font-size: 60px;
    letter-spacing: -3.2px;
    margin-bottom: 1rem;
    font-weight: 600;
    color: $text-color;
  }

  p {
    font-size: 18px;
    letter-spacing: -0.5px;
    margin-bottom: 2.5rem;
    color: rgba($text-color, 0.8);
  }

  .button-container {
    display: flex;
    justify-content: center;
    gap: 1rem;
  }

  .login-button, .signup-button {
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    border-radius: $border-radius-md;
    transition: all $transition-fast;
    /* Ensure buttons are visible even before animation */
    opacity: 1 !important;
    visibility: visible !important;
  }

  .login-button {
    background-color: transparent;
    color: $primary-color;
    border: 1px solid $primary-color;

    &:hover {
      background-color: rgba($primary-color, 0.05);
    }
  }

  .signup-button {
    background-color: $primary-color;
    color: white;
    border: none;

    &:hover {
      opacity: 0.9;
    }
  }
</style>