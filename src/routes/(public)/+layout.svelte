<script>
    import Header from '$lib/components/public/Header.svelte';
    import Navbar from '$lib/components/public/Navbar.svelte';
    import { chatVisible } from '$lib/stores/chatStore.js';

    function toggleChat() {
        chatVisible.toggle();
    }
</script>

<svelte:head>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&e" />
    <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content">
</svelte:head>

<div class="layout">

    <!--
    <div id="chat" class:hidden={!$chatVisible}> </div>
    -->

    <div class="app">
        <slot />
    </div>
    <Navbar />
</div>

<!-- Floating toggle button -->
<button class="chat-toggle-btn" on:click={toggleChat} title={$chatVisible ? 'Hide chat' : 'Show chat'}>
    <span class="material-icons">
        {$chatVisible ? 'chat' : 'chat_bubble_outline'}
    </span>
</button>

<style lang="scss">

    #chat{
        width: 300px;
        background: rgb(15, 15, 18);
        box-shadow: -12px 24px 48px rgba(black, 0.5);
        border-radius: 4px;
        transition: width 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                   opacity 0.2s ease,
                   margin-right 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);

        &.hidden {
            width: 0;
            opacity: 0;
            margin-right: 0;
            overflow: hidden;
        }
    }

    .chat-toggle-btn {
        position: fixed;
        top: 20px;
        left: 20px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #909090;
        border: none;
        color: white;
        cursor: pointer;
        display: none;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        cursor: pointer;
        z-index: 1000;
        transition: all 0.2s ease;

        &:hover {
            background: #a0a0a0;
            //transform: scale(1.05);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
        }

        &:active {
            transform: scale(0.95);
        }

        .material-icons {
            font-size: 24px;
        }
    }

    .layout {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        display: flex;
        overflow: hidden;
        flex-grow: 0;
        overscroll-behavior: none;
        //background: rgb(29, 29, 32);
        //background: var(--background-color);
        gap: 8px;
        //padding: 12px 4px 12px 12px;
        transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    .app{
        flex: 1;
        box-sizing: border-box;
        border-radius: 8px;
        //box-shadow: -12px 36px 48px rgba(#030025, 0.4);
        position: relative;
        background: var(--background-color);
        transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
        min-width: 0; /* Allows flex item to shrink below its content size */
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

        #chat {
            &.hidden {
                height: 0;
                width: 300px; /* Maintain width on mobile, but collapse height */
                margin-bottom: 0;
                padding: 0;
            }
        }

        .chat-toggle-btn {
            bottom: 80px; /* Move above mobile navbar */
        }
    }

</style>