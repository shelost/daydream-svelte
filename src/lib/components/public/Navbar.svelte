<script>
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
    import { goto } from '$app/navigation';

	let navElement; // bind:this to <nav>
	let pillElement; // bind:this to the pill div
	let navButtons = []; // Will be populated with <a> elements

	// Function to update pill position and size
	const updatePill = () => {
		if (!navElement || !pillElement || navButtons.length === 0) {
			if (pillElement) {
				pillElement.style.opacity = '0';
				pillElement.style.width = '0px';
			}
			return;
		}

		const currentPath = $page.url.pathname;
		let activeButton = null;

		for (const btn of navButtons) {
			if (btn.getAttribute('href') === currentPath) {
				activeButton = btn;
				break;
			}
		}

		if (activeButton) {
			const navRect = navElement.getBoundingClientRect();
			const buttonRect = activeButton.getBoundingClientRect();

			const offsetLeftInNav = buttonRect.left - navRect.left;
            const offsetTopInNav = buttonRect.top - navRect.top;
			const buttonWidth = buttonRect.width;

			//pillElement.style.transform = `translateX(${offsetLeftInNav}px) translateY(-50%)`;
            pillElement.style.left = `${offsetLeftInNav}px`;
            pillElement.style.top = `${offsetTopInNav}px`;
			pillElement.style.width = `${buttonWidth}px`;
            pillElement.style.height = `${buttonRect.height}px`;
			pillElement.style.opacity = '1';
		} else {
			// No active button found, hide the pill
			pillElement.style.opacity = '0';
			pillElement.style.width = '0px';
		}
	};

	onMount(() => {
		if (navElement) {
			navButtons = Array.from(navElement.querySelectorAll('a'));
		}
		// Timeout to allow DOM to fully render and bind:this to complete
		setTimeout(updatePill, 0);
	});

	afterNavigate(() => {
		// Timeout might also be good here if there are complex DOM changes triggering navigation
		setTimeout(updatePill, 0);
	});
</script>
<header>
    <div id = 'mast' class = 'corner'>
        <a href = '/'>
            <img src = 'wing-square.png' alt = 'Daydream Logo' />
        </a>
    </div>

    <nav bind:this={navElement}>
        <div class="nav-pill" bind:this={pillElement}></div>

        <div class = 'navbtn' class:active={$page.url.pathname === '/'} on:click={() => {goto('/')}} >
            <span class='material-icons'>
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
            <span class='material-icons'>
                web_stories
            </span>
        </div>

        <div class = 'navbtn disabled' class:active={$page.url.pathname === '/flow'} on:click={() => {goto('/flow')}} >
            <span class='material-symbols-outlined'>
                automation
            </span>
        </div>

        <div class = 'navbtn' class:active={$page.url.pathname === '/chat'} on:click={() => {goto('/chat')}} >
            <span class='material-symbols-outlined'>
                chat_bubble
            </span>
        </div>

        <div class = 'navbtn disabled' class:active={$page.url.pathname === '/profile'} on:click={() => {goto('/profile')}} >
            <span class='material-symbols-outlined'>
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



    </div>

</header>

<style lang="scss">

    header{
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        align-items: center;
        //position: fixed;
        box-sizing: border-box;
        flex-shrink: 0;
        flex-grow: 0;
        padding: 12px 0;
        top: 0;
        left: 0;
        height: 100vh;
        width: 52px;
        z-index: 2;
       // border-left: 1px solid rgba(white, .2);
    }

    #mast{
        display: flex;
        align-items: center;
        gap: 4px;

        img{
            height: 28px;
            border: 1px solid white;
            border-radius: 6px;
        }

        h1{
            font-size: 18px;
            font-weight: 700;
        }
    }

    nav{
        position: relative; // For pill positioning context
        display: flex;
        flex-direction: column;
        align-items: center;
        box-sizing: border-box;
        gap: 8px;
        background: none;

       // border: 1px solid rgba(white, .2);
        box-shadow: 0 24px 48px rgba(black, .3);
        padding: 6px;
        border-radius: 0 16px 16px 0;


        .nav-pill {
            position: absolute;
            left: 0;
            top: 0%;
            background-color: rgba(white, .1);
            border-radius: 10px; // Half of height for perfect pill
            box-shadow: -2px 4px 8px rgba(black, .2);
            border: none;
            //transform: translateY(-50%); // Vertically center
            z-index: 0; // Behind nav items
            opacity: 0; // Start hidden
            transition: 0.2s cubic-bezier(0.65, 0, 0.35, 1);
        }

        .navbtn{
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
                    color: rgba(white, .3);
                    text-align: center;
                    filter: drop-shadow(0 4px 8px rgba(black, .1));
                }
                &:hover{
                    background: rgba(white, .1);
                    border-radius: 12px;
                }
                &.disabled{
                    display: none;
                }
                &.active{
                    //background: rgba(#e0e0e0, .8);
                    span{
                        color: rgba(white, 1);
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
            flex-direction: row;
            height: 60px;
            width: 100vw;
            box-sizing: border-box;
            padding: 0 16px;

            nav{
                flex-direction: row;
            }
        }
    }




</style>