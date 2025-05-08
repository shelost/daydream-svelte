<script lang="ts">
  import { onMount } from 'svelte';
  import { gsap } from 'gsap';
  import { goto } from '$app/navigation';
  import { isLoggedIn } from '$lib/stores/appStore';
  import Header from '$lib/components/public/Header.svelte';
  let mainHeading: HTMLElement;
  let subHeading: HTMLElement;
  let loginButton: HTMLElement;
  let signupButton: HTMLElement;
  let demoButton: HTMLElement;
  let buttonsVisible = false;

  import { fly } from 'svelte/transition';

  onMount(() => {
    console.log("Component mounted, buttons:", loginButton, signupButton, demoButton);

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
        y: 50,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out"
      })
      .from(subHeading, {
        y: 30,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out"
      }, "-=0.5")
      .from([loginButton, signupButton, demoButton], {
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

  const handleTryDemo = () => {
    goto('/draw');
  };
</script>

<svelte:head>
  <title>Daydream - A Powerful Canvas Drawing App</title>
  <meta name="description" content="Create beautiful drawings and canvas compositions with Daydream" />
</svelte:head>

<main class="landing-page">


  <div class="hero-container">
    <img src="wing-square.png" alt="Arachne Logo" class="logo" />

    <div class = 'expo'>
      <p>
        Welcome!
      </p>
      <p>
        This is a simple demo site, designed to experiment with AI-enhanced drawing.
      </p>
      <p>
        More updates to come!
      </p>


    </div>

    <div class="button-container">
      <!-- Use inline style for immediate visibility -->

      <!--
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
      -->
      <button
        bind:this={demoButton}
        class="demo-button"
        on:click={handleTryDemo}>
        <h2>
          Start Drawing
        </h2>
      </button>
    </div>
  </div>
</main>

<style lang="scss">

  .logo{
    height: 100px;
    border-radius: 16px;
    box-shadow: -4px 16px 24px rgba(black,0.3);
    //margin-bottom: 16px;
  }

  .landing-page {
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
   // background-color: $background-color;
  }

  .hero-container {
    text-align: center;
    padding: 0;
    max-width: 800px;
    margin-bottom: 60px;
  }

  h1 {
    font-size: 72px;
    letter-spacing: -3.6px;
    margin-bottom: 4px;
    font-weight: 700;
    color: $text-color;
    text-shadow: -4px 8px 12px rgba(black,0.05);
  }

  .expo{
    width: 360px;
    margin: 36px 0 48px 0;
    p {
      font-size: 15px;
      font-weight: 450;
      letter-spacing: -0.25px;
      color: white;
      margin: 12px 0;
    }
  }

  .button-container {
    display: flex;
    justify-content: center;
    gap: 1rem;
    flex-wrap: wrap;
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

  .demo-button {
    background-color: #6355FF;
    color: white;
    border: none;
    position: relative;
    overflow: hidden;
    transition: .2s ease;
    border-radius: $border-radius-lg;

    padding: 10px 18px 12px 18px;

    box-shadow: -4px 16px 18px rgba(black,0.1), inset 1px 2px 2px rgba(white,0.1), inset -1px -2px 4px rgba(black,0.1);


    h2{
      font-size: 16px;
    }


    &::after {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: linear-gradient(45deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0) 70%);
      transform: rotate(45deg);
      animation: shine 3s infinite;
    }

    &:hover {
      background-color: #5f3cf7;
     // opacity: 0.9;
      //transform: translateY(-2px);
      // /box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
  }

  @keyframes shine {
    0% {
      left: -100%;
      top: -100%;
    }
    100% {
      left: 100%;
      top: 100%;
    }
  }
</style>