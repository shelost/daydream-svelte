<script>
	import { page } from '$app/state';
</script>

<div id = 'main'>
    <h1>
        {page.status}
    </h1>
    <h2>
        {page.error.message}
    </h2>
</div>

<style lang="scss">
    #main {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 90vh;
        color: white;
        h1{
            font-family: 'Newsreader', sans-serif;
            font-size: 200px;
            font-weight: 600;
            line-height: 1;
            color: rgba(white, .6);
            margin: 0;
            margin-top: 24px;
            margin-bottom: -8px;
        }
        h2{
            font-size: 24px;
            font-weight: 500;
            letter-spacing: -0.5px;
            color: rgba(white, .3);
            margin: 0;
        }
    }
</style>

