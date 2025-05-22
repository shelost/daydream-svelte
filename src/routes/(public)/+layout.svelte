<script>
    import Header from '$lib/components/public/Header.svelte';
    import Navbar from '$lib/components/public/Navbar.svelte';
</script>

<svelte:head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
</svelte:head>

<div class="layout">
    <div class = 'app'>
        <slot />
    </div>
    <Navbar />
</div>

<style lang="scss">
    .layout {
        display: flex;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        gap: 0;
        flex-grow: 0;
        background: rgb(29, 29, 32);
    }
    .app{
        flex: 1;
        box-sizing: border-box;
        margin: 12px 4px 12px 12px;
        border-radius: 10px;
        box-shadow: 12px 24px 48px rgba(black, 0.5);
        position: relative;
        //overflow: hidden;

        background: var(--background-color);
    }

    @media screen and (max-width: 800px) {
        .layout{
            flex-direction: column;
            width: 100%;
            height: 100%;
            max-height: 100vh;
        }

        .app{
            margin: 12px 12px 4px 12px;
        }
    }


</style>