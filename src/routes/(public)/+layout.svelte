<script>
    import Header from '$lib/components/public/Header.svelte';
</script>

<svelte:head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

<div class="layout">
    <Header />
    <slot />
</div>

<style>
    .layout {
        display: flex;
        flex-direction: column;
    }
</style>