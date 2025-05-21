<script lang="ts">
  import { onMount } from 'svelte';
  import { gsap } from 'gsap';
  import { goto } from '$app/navigation';
  import { isLoggedIn } from '$lib/stores/appStore';
  import { fly, scale, fade } from 'svelte/transition';
  import Header from '$lib/components/public/Header.svelte';
  let mainHeading: HTMLElement;
  let subHeading: HTMLElement;
  let loginButton: HTMLElement;
  let signupButton: HTMLElement;
  let demoButton: HTMLElement;
  let buttonsVisible = false;


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

<main class="landing-page" in:scale={{start: 0.95, opacity: 0.5}}>

  <div class="hero-container">

    <img src="wing-square.png" id = 'wing' alt="Arachne Logo" class="logo" />

    <div class = 'mast'>
      <h1>
        AI More Naturally.
      </h1>
      <h2>
        Confused by AI? We are too.
      </h2>
      <p>
        Copyright &copy; 2025 ahw. All rights reserved.
      </p>
    </div>



    <div class = 'sec'>
      <div class = 'header'>
        <h1> Your Favorite Ways to Interact </h1>
        <p> We support all the popular models! </p>
      </div>

      <div class = 'features'>
        <div class = 'feature'>
          <div class = 'expo'>
            <h2> Draw </h2>
            <p> Sketch, paint, and draw with your imagination. </p>
          </div>
        </div>

        <div class = 'feature'>
          <div class = 'expo'>
            <h2> Diagram </h2>
            <p> Create diagrams, charts, and graphs with ease. </p>
          </div>
        </div>

        <div class = 'feature'>
          <div class = 'expo'>
            <h2> Flow </h2>
            <p> Build complex flowcharts and logic. </p>
          </div>
        </div>

        <div class = 'feature'>
          <div class = 'expo'>
            <h2> Chat </h2>
            <p> Don't worry — you can still chat normally! </p>
          </div>
        </div>
      </div>
    </div>


    <div class = 'sec'>
      <div class = 'header'>
        <h1> All Your Favorite Models </h1>
        <p> We support all the popular models! </p>
      </div>
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
      <!--
      <button
        bind:this={demoButton}
        class="demo-button"
        on:click={handleTryDemo}>
        <h2>
          Start Drawing
        </h2>
      </button>
      -->
    </div>
  </div>
</main>

<style lang="scss">

  .landing-page {
    height: 100%;
    overflow-y: scroll;
   // background-color: $background-color;
  }

  .hero-container {
    text-align: center;
    padding: 0;
    max-width: 800px;
    margin: 80px auto;


    display: flex;
    flex-direction: column;
    align-items: center;

    #wing{
      height: 120px;
      border-radius: 18px;
      border: 2px solid white;
      box-shadow: -4px 16px 32px rgba(black, 0.5);
    }

    #ahw{
      height: 20px;
      border-radius: 0;
      opacity: .2;
    }

    .mast{
      margin: 24px 0 32px 0;
      color: white;
      h1{
        font-family: "ivypresto-headline", serif;
        font-size: 84px;
        font-weight: 500;
        letter-spacing: -.5px;
        color: white;
        margin-bottom: 24px;
      }
      h2{
        font-size: 18px;
        font-weight: 400;
        letter-spacing: -.5px;
        color: rgba(white, .5);
      }
      p {
        font-size: 14px;
        font-weight: 400;
        letter-spacing: -0.25px;
        color: rgba(white, .7);
        margin: 12px 0;
        display: none;
      }
    }
  }

  .header{
    h1{
      font-family: "ivypresto-headline", serif;
      font-size: 32px;
      font-weight: 500;
      letter-spacing: -.5px;
      color: white;
      margin-bottom: 12px;
    }
   p{
      font-size: 14px;
      font-weight: 400;
      letter-spacing: -.1px;
      color: rgba(white, .5);
    }
  }

  .features{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
    margin: 40px 0;

    .feature{
      background: rgba(black, .5);
      border-radius: 12px;
      padding: 24px;
      box-shadow: -4px 16px 32px rgba(black, 0.3);

      .expo{
        text-align: left;

        h2{
          font-family: "ivypresto-headline", serif;
          font-size: 32px;
          font-weight: 500;
          letter-spacing: 0px;
          color: rgba(white, .6);
          margin-bottom: 8px;
        }

        p{
          font-size: 14px;
          font-weight: 400;
          letter-spacing: -.1px;
          color: rgba(white, .8);
        }

      }
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