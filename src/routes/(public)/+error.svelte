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
            font-size: 72px;
        }
        h2{
            font-size: 18px;
            font-weight: 500;
        }
    }
</style>

