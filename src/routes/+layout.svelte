<script>
  import '$lib/styles/global.scss';
</script>

<svelte:head>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="icon" href="/arachne-icon.png" />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400..700;1,400..700&family=Inter:wght@100..900&family=Newsreader:ital,wght@0,200..800;1,200..800&display=swap" rel="stylesheet">
</svelte:head>

<div class="layout">
  <slot />
</div>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }
</style>
