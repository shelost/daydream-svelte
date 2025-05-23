<script lang="ts">
    import { Handle, Position, type NodeProps, useSvelteFlow } from '@xyflow/svelte';
    import { onMount } from 'svelte';

    type $$Props = NodeProps;

    export let id: $$Props['id'];
    export let data: $$Props['data'];

    const { updateNodeData, updateNode } = useSvelteFlow();

    let textarea: HTMLTextAreaElement | null = null;
    let isEditing = false;

    /**
     * Adjust the textarea height based on its scrollHeight, capping at 1000px.
     * Enable scrolling only when content exceeds the maximum height.
     */
    function autoResize() {
        if (!textarea) return;

        // Reset height and overflow to get accurate scrollHeight
        textarea.style.height = 'auto';
        textarea.style.overflow = 'hidden';

        // Get the scroll height and determine if we need scrolling
        const scrollHeight = textarea.scrollHeight;
        const maxHeight = 500;

        if (scrollHeight > maxHeight) {
            textarea.style.height = `${maxHeight}px`;
            textarea.style.overflow = 'auto';
        } else {
            textarea.style.height = `${scrollHeight}px`;
            textarea.style.overflow = 'hidden';
        }
    }

    function handleFocus() {
        isEditing = true;
        // Disable node dragging when the textarea is focused
        updateNode(id, { draggable: false });
    }

    function handleBlur() {
        isEditing = false;
        // Re-enable node dragging when the textarea loses focus
        updateNode(id, { draggable: true });
    }

    // Prevent wheel events from bubbling when scrolling textarea
    function handleWheel(event: WheelEvent) {
        if (!textarea) return;

        const isScrollable = textarea.scrollHeight > textarea.clientHeight;
        if (isScrollable && isEditing) {
            event.stopPropagation();
        }
    }

    // Prevent space key from triggering pan when editing
    function handleKeyDown(event: KeyboardEvent) {
        if (event.code === 'Space' && isEditing) {
            event.stopPropagation();
        }
    }

    // Handle mousedown on textarea to prevent drag events from starting
    function handleMouseDown(event: MouseEvent) {
        // Stop propagation to prevent node dragging when clicking on the textarea
        event.stopPropagation();
    }

    onMount(() => {
        // Ensure correct height on initial mount
        autoResize();
    });
</script>

<div class="flow-node">
    <label>Text</label>
    <div class="node">
        <textarea
            bind:this={textarea}
            bind:value={data.text}
            style="width:400px; max-height:500px; resize:none;"
            rows="1"
            on:input={(evt) => {
                autoResize();
                updateNodeData(id, { text: (evt.currentTarget as HTMLTextAreaElement).value });
            }}
            on:focus={handleFocus}
            on:blur={handleBlur}
            on:wheel={handleWheel}
            on:keydown={handleKeyDown}
            on:mousedown={handleMouseDown}
        ></textarea>
        <Handle type="source" position={Position.Right} />
    </div>
</div>

<style>
    .node {
        display: flex;
        gap: 8px;
        width: 300px;
        max-width: 100%;
    }

    textarea {
        font: inherit;
        padding: 6px 6px;
        border-radius: 4px;
        width: 100%;
        border: none;
        background: none;
        box-sizing: border-box;
        resize: none; /* prevent manual resize */

        font-size: 12px;
        font-weight: 500;
        letter-spacing: -.3px;
        color: white;
    }


</style>