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
  <title>Opal</title>
  <meta name="description" content="Create beautiful drawings and canvas compositions with Daydream" />
</svelte:head>

<main id = 'main' in:scale={{start: 0.95, opacity: 0.5}}>


  <div class="hero-container">

    <video id = 'video' autoplay loop muted playsinline src = 'walls_4.mp4'></video>


    <img in:fly={{y: 20, opacity: 0, duration: 600, delay: 100}} src="wing.png" id = 'wing' alt="Arachne Logo" class="logo" />

    <div class = 'mast'>

      <img in:fly={{y: 20, opacity: 0, duration: 600, delay: 100}} src="opal-text.svg" id = 'wordmark' alt="Arachne Logo" class="logo" />

      <h1 in:fly={{y: 20, opacity: 0, duration: 600, delay: 150}}>
        Your AI <i> Studio </i>
      </h1>
      <h2 in:fly={{y: 20, opacity: 0, duration: 600, delay: 200}}>
        Do What You Love, and Nothing More.
      </h2>

      <button
      bind:this={demoButton}
      class="demo-button"
      on:click={handleTryDemo}
      in:fly={{y: 20, opacity: 0, duration: 600, delay: 250}}
      >
      Start Drawing
    </button>

    </div>


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
</main>

<style lang="scss">

  #main {
    height: 100%;
    overflow-y: hidden;
    position: relative;
   // background-color: $background-color;
  }

  #video{
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      z-index: 0;
      opacity: .34;
      mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
      -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%);
    }


  .hero-container {
    text-align: center;
    padding: 0;
    max-width: 1000px;
    margin: 0 auto;

    background: none;
    height: 100%;

    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;

    z-index: 2;


    #wing{
      height: 180px;
      border-radius: 18px;
      filter: drop-shadow(-12px 36px 16px rgba(#030025, 0.05));
      display: none;
    }

    #wordmark{
      height: 36px;
      border-radius: 0;
     //opacity: .3;
    }

    .mast{
      margin: 12px 0 48px 0;
      color: white;
      text-align: center;
      z-index: 10;
      h4{
        font-family: "ivypresto-headline", serif;
        font-size: 300px;
        font-weight: 600;
        letter-spacing: -8px;
        color: #030020;
        margin: -4px 16px 28px 0;
        line-height: 85%;
        z-index: 10;


        text-shadow: -6px 12px 24px rgba(#030025, .1);
      }
      h1{
        font-family: "ivypresto-headline", serif;
        font-size: 130px;
        font-weight: 600;
        letter-spacing: -5px;
        color: #030025;
        margin: 8px 0 28px 0;
        line-height: 85%;
        z-index: 2;

        text-shadow: -6px 16px 16px rgba(#030025, .08);

        i{
          font-weight: 700;;
        }

        span{
          position: relative;
          &::before{
            content: '';
            width: 100px;
            height: 70px;
            background: rgba(yellow, .4);;
            position: absolute;
            top: 0;
            left: 0;
            z-index: 1;
            display: none;
          }
          //background: yellow;
          //font-weight: 600;
        }
      }
      h2{
       //display: none;
        //margin: -40px 0 0 360px;

        margin: 0 0 24px 0;

        font-family: "ivypresto-text", serif;
        font-size: 24px;
        font-weight: 600;
        letter-spacing: -1.1px;
        color: rgba(black, .8);

      }
      p {
        font-size: 14px;
        font-weight: 400;
        letter-spacing: -0.25px;
        color: rgba(black,.7);
        margin: 12px 0;
        //display: none;
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
    margin: 40px auto;
    width: 800px;

    .feature{
      background: rgba(#030020, 1);
      border-radius: 12px;
      padding: 24px;
      height: 320px;
      box-shadow: -12px 24px 32px rgba(#030025, 0.35);

      .expo{
        text-align: left;

        h2{
          font-family: "ivypresto-text", serif;
          font-size: 32px;
          font-weight: 600;
          letter-spacing: -1.5px;
          color: rgba(white, .9);
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

  .sec{
    z-index: 2;
   //s display: none;
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
    background-color: var(--highlight);
    color: white;
    border: none;
    position: relative;
    overflow: hidden;
    transition: .2s ease;
    border-radius: $border-radius-lg;

    padding: 10px 18px 12px 18px;

    box-shadow: -4px 16px 18px rgba(black,0.1), inset 1px 2px 2px rgba(white,0.5), inset -1px -2px 4px rgba(black,0.2);

    font-weight: 600;

    h2{
      font-size: 16px;
      font-weight: 500;
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
      transform: scale(1.03);
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