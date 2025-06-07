<script>
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
    import { goto } from '$app/navigation';

	let navElement; // bind:this to <nav>
	let pillElement; // bind:this to the pill div

	// Function to update pill position and size
	const updatePill = () => {
		if (!navElement || !pillElement) {
			if (pillElement) {
				pillElement.style.opacity = '0';
				pillElement.style.width = '0px';
			}
			return;
		}

		const activeButton = navElement.querySelector('.navbtn.active');

		if (activeButton) {
			const navRect = navElement.getBoundingClientRect();
			const buttonRect = activeButton.getBoundingClientRect();

			const offsetLeftInNav = buttonRect.left - navRect.left;
            const offsetTopInNav = buttonRect.top - navRect.top;
			const buttonWidth = buttonRect.width;

			//pillElement.style.transform = `translateX(${offsetLeftInNav}px) translateY(-50%)`;
            pillElement.style.left = `${offsetLeftInNav}px`;
            pillElement.style.top = `${offsetTopInNav}px`;
			pillElement.style.width = `${buttonWidth-2}px`;
            pillElement.style.height = `${buttonRect.height-2}px`;
			pillElement.style.opacity = '1';
		} else {
			// No active button found, hide the pill
			pillElement.style.opacity = '0';
			pillElement.style.width = '0px';
		}
	};

	onMount(() => {
		// Timeout to allow DOM to fully render and bind:this to complete
		setTimeout(updatePill, 10);
	});

	// Reactive effect - update pill whenever the current page changes
	$effect(() => {
		// This will run whenever $page.url.pathname changes
		const currentPath = $page.url.pathname;

		// Timeout to ensure reactive class bindings have updated the DOM
		setTimeout(updatePill, 20);
	});

	afterNavigate(() => {
		// Backup timeout for edge cases
		setTimeout(updatePill, 20);
	});
</script>
<header>
    <div id = 'mast' class = 'corner'>
        <a href = '/'>
            <img src = 'opal.png' alt = 'Daydream Logo' />
        </a>
    </div>

    <nav bind:this={navElement}>
        <div class="nav-pill" bind:this={pillElement}></div>

        <div class = 'navbtn' class:active={$page.url.pathname === '/'} on:click={() => {goto('/')}} >
            <span class='material-symbols-rounded'>
                home
            </span>
        </div>

        <!--
        <div class = 'navbtn' class:active={$page.url.pathname === '/draw'} on:click={() => {goto('/draw')}} >
            <span class='material-icons'>
                draw
            </span>
        </div>
        -->

        <div class = 'navbtn' class:active={$page.url.pathname === '/canvas'} on:click={() => {goto('/canvas')}} >
            <span class='material-symbols-rounded'>
               edit_square
            </span>
        </div>

        <div class = 'navbtn disable' class:active={$page.url.pathname === '/flow'} on:click={() => {goto('/flow')}} >
            <span class='material-symbols-rounded'>
                near_me
            </span>
        </div>

        <div class = 'navbtn' class:active={$page.url.pathname === '/chat'} on:click={() => {goto('/chat')}} >
            <span class='material-symbols-rounded'>
               maps_ugc
            </span>
        </div>

        <div class = 'navbtn disabled' class:active={$page.url.pathname === '/profile'} on:click={() => {goto('/profile')}} >
            <span class='material-symbols-rounded'>
                person
            </span>
        </div>


        <!--
        <div class = 'navbtn' class:active={$page.url.pathname === '/image'} on:click={() => {goto('/image')}} >
            <span class='material-icons'>
                image
            </span>
         </div>
         -->
    </nav>

    <div id = 'menu' class = 'corner'>


        <div id = 'pfp'  class:active={$page.url.pathname === '/profile'} on:click={() => {goto('/profile')}}>
            <h2>CA</h2>
        </div>

    </div>

</header>

<style lang="scss">

    #pfp{
        width: 36px;
        height: 36px;
        background: #e0e0e0;
        border-radius: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: .2s ease;

        h2{
            font-size: 16px;
            font-weight: 600;
            color: #030025;
        }
        &:hover{
            background: #d0d0d0;
        }
    }

    header{
        position: fixed;

        padding: 12px 0;
        top: 0;
        right: 12px;


        height: 100vh;
        width: 44px;

        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        //position: fixed;
        box-sizing: border-box;
        flex-shrink: 0;
        flex-grow: 0;

        z-index: 2;
       // border-left: 1px solid rgba(white, .2);


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
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-sizing: border-box;
        gap: 6px;
        background: none;
        padding: 4px;
        border-radius: 0 16px 16px 0;
        background: rgba(#c0c0c0, .3);
        backdrop-filter: blur(2px);
        border-radius: 16px;
        border: 1px solid rgba(white, .2);
        //box-shadow: 6px 12px 24px rgba(black, .15);
        width: 100%;


        .nav-pill {
            position: absolute;
            left: 0;
            top: 0%;
            background: white;
            border-radius: 12px; // Half of height for perfect pill
            //box-shadow: -2px 4px 8px rgba(black, .2);
            border: none;
            //transform: translateY(-50%); // Vertically center
            z-index: 0; // Behind nav items
            box-shadow: -2px 6px 18px rgba(#030025, .15);
            transition: 0.2s cubic-bezier(0.65, 0, 0.35, 1);
        }

        .navbtn{
                position: relative;
                z-index: 1;
                cursor: pointer;
                width: 36px;
                height: 36px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: .2s ease;
                border: none;
                transition: .2s ease;
                h2{
                    font-size: 14px;
                    font-weight: 600;
                }
                span{
                    font-size: 20px;
                    font-weight: 700;
                    line-height: 100%;
                    color: rgba(#030025, .2);
                    text-align: center;
                    user-select: none;
                    filter: drop-shadow(0 4px 8px rgba(black, .1));
                    transition: .2s ease;
                }
                &:hover{
                   // background: rgba(#030025, .1);
                    border-radius: 12px;
                    span{
                        color: rgba(#030025, .4);
                        filter: none;
                    }
                }
                &.disabled{
                    display: none;

                }
                &.active{
                    //background: rgba(#e0e0e0, .8);
                    span{
                        color: rgba(#030025, 1);
                        filter: none;
                    }
                    &:hover{
                        background: none;
                    }
                }
            }
    }


    @media screen and (max-width: 800px) {
        header{
            position: fixed;
            top: auto;
            flex-direction: row;
            bottom: 0px;
            left: 0;
            height: 60px;
            width: 100vw;
            z-index: 10;
            padding: 0 12px;
            box-sizing: border-box;
            background: white;

            nav{
                flex-direction: row;
                width: fit-content;

                .navbtn{
                    width: 44px;
                    height: 44px;

                    span{
                        font-size: 24px;
                    }
                }
            }
        }
    }






</style>