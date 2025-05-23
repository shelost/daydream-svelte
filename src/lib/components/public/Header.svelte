<script>
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';

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
            <img src = '/wing.png' alt = 'Daydream Logo' />
        </a>
    </div>

    <nav bind:this={navElement}>
        <div class="nav-pill" bind:this={pillElement}></div>
        <a href = '/'>
            <div class = 'navbtn' class:active={$page.url.pathname === '/'}>
                <span class='material-icons'>
                    home
                </span>
            </div>
        </a>
        <a href = '/draw'>
            <div class = 'navbtn' class:active={$page.url.pathname === '/draw'} >
                <span class='material-icons'>
                    draw
                </span>
            </div>
        </a>
        <a href = '/canvas'>
            <div class = 'navbtn' class:active={$page.url.pathname === '/canvas'} >
                <span class='material-icons'>
                    web_stories
                </span>
            </div>
        </a>
        <a href = '/flow'>
            <div class = 'navbtn' class:active={$page.url.pathname === '/flow'} >
                <span class='material-symbols-outlined'>
                    automation
                </span>
            </div>
        </a>
        <a href = '/image'>
            <div class = 'navbtn' class:active={$page.url.pathname === '/image'} >
                <span class='material-icons'>
                    image
                </span>
            </div>
        </a>
    </nav>

    <div id = 'menu' class = 'corner'>
        <h2> Hello </h2>
    </div>

</header>

<style lang="scss">

    header{
        display: flex;
        justify-content: space-between;
        align-items: center;
        position: fixed;
        box-sizing: border-box;
        padding: 0 16px;
        bottom: 12px;
        left: 0;
        height: 44px;
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
        position: relative; // For pill positioning context
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(#e0e0e0, .7);
        border: 1px solid rgba(white, .2);
        backdrop-filter: blur(8px);
        padding: 6px;
        border-radius: 22px;
        box-shadow: 0 24px 48px rgba(black, .8);

        .nav-pill {
            position: absolute;
            left: 0;
            top: 0%;
            background-color: white;
            border-radius: 14px; // Half of height for perfect pill
            box-shadow: -2px 4px 8px rgba(black, .2);
            border: none;
            //transform: translateY(-50%); // Vertically center
            z-index: 0; // Behind nav items
            opacity: 0; // Start hidden
            transition: 0.2s cubic-bezier(0.65, 0, 0.35, 1);
        }

        a {
            text-decoration: none;
            color: inherit; // Inherit color from parent or set specific
            position: relative; // To ensure z-index stacking works
            z-index: 1; // Above the pill

            .navbtn{
                width: 48px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: .2s ease;
                border: none;
                h2{
                    font-size: 14px;
                    font-weight: 600;
                }
                span{
                    font-size: 22px;
                    font-weight: 700;
                    line-height: 100%;
                    color: rgba(#030025, 1);
                    text-align: center;
                    filter: drop-shadow(0 4px 8px rgba(black, .1));
                }
                &:hover{
                    background: rgba(black, .12);
                    border-radius: 12px;
                }
                &.active{
                    //background: rgba(#e0e0e0, .8);
                    span{
                        color: #030025;
                        filter: none;
                    }
                    &:hover{
                        background: none;
                    }
                }
            }
        }
    }

    .corner{
        width: 200px;
        opacity: 0;
    }

    #menu{
        display: flex;
        align-items: center;
        justify-content: right;
    }

</style>