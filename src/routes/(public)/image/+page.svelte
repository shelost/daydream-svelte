<script>

    import { fly, scale } from 'svelte/transition';

</script>


<div id = 'main' in:scale={{ start: .9, opacity: .4}}>
    <h1> Images</h1>
    <h2> Coming Soon </h2>
</div>

<style lang="scss">

    #main{
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 95vh;
        width: 100vw;
        color: white;
        gap: 4px;

        h1{
            font-size: 48px;
            font-weight: 600;
        }
        h2{
            font-size: 18px;
            font-weight: 500;
            color: rgba(white, .5);
        }
    }


</style>