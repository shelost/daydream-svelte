<script>

</script>

<header>

    <div id = 'mast'>
        <img src = '/wing.png' alt = 'Daydream Logo' />
        <h1>Daydream</h1>
    </div>

    <nav>
        <a href = '/'>
            <div class = 'navbtn'>
                <h2>Home</h2>
            </div>
        </a>
        <a href = '/about'>
            <div class = 'navbtn'>
                <h2>About</h2>
            </div>
        </a>
        <a href = '/contact'>
            <div class = 'navbtn'>
                <h2>Contact</h2>
            </div>
        </a>
    </nav>

</header>

<style lang="scss">


    header{
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: absolute;
        box-sizing: border-box;
        padding: 0 16px;
        top: 0;
        left: 0;
        height: 60px;
        width: 100vw;
        z-index: 2;
    }

    #mast{
        display: flex;
        align-items: center;
        gap: 4px;

        img{
            height: 28px;
        }

        h1{
            font-size: 18px;
            font-weight: 700;
        }
    }

    nav{
        display: flex;
        align-items: center;
        gap: 16px;

        .navbtn{

            h2{
                font-size: 14px;
                font-weight: 600;
            }
        }
    }

</style>