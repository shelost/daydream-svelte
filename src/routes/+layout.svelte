<script>
  import '$lib/styles/global.scss';
  import { onMount } from 'svelte';
  import { injectAnalytics } from '@vercel/analytics/sveltekit'

  // Only use production mode when in actual production environment
  const isProd = import.meta.env.PROD;
  injectAnalytics({ mode: isProd ? 'production' : 'development' });

  // Removed disableScroll functionality that was preventing touch scrolling
  // If selective scroll prevention is needed for specific areas, it should be
  // implemented at the component level, not globally

</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="icon" href="opal.png" />
  <link href="https://fonts.googleapis.com/css2?family=Hedvig+Letters+Serif:opsz@12..24&display=swap" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400..700;1,400..700&family=Inter:wght@100..900&family=Newsreader:ital,wght@0,200..800;1,200..800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://use.typekit.net/kqx0rwr.css">
  <link rel="stylesheet" href="https://use.typekit.net/kqx0rwr.css">
  <script src="/fabric.js"></script>
</svelte:head>

<div class="layout">
  <slot />
</div>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 0;
    margin: 0;
  }
</style>
