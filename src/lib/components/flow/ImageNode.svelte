<script lang="ts">
    import { Handle, Position, type NodeProps, NodeResizer } from '@xyflow/svelte';
    import { useSvelteFlow } from '@xyflow/svelte';
    import { writable } from 'svelte/store';
    import { onMount } from 'svelte';

    type $$Props = NodeProps;

    export let id: $$Props['id'];
    export let data: $$Props['data'] = { imageUrl: null, label: 'Image Node' };
    export let width: number | undefined = undefined; // Comes from Svelte Flow, updated by NodeResizer
    export let height: number | undefined = undefined; // Comes from Svelte Flow, updated by NodeResizer

    const { updateNodeData, updateNode } = useSvelteFlow();

    const localImageUrl = writable<string | null>( (typeof data.imageUrl === 'string' ? data.imageUrl : null) );
    const nodeLabel = writable<string>( (typeof data.label === 'string' && data.label ? data.label : `Image ${id}`) );
    const isDraggingOver = writable(false);
    const errorMsg = writable<string | null>(null);
    let fileInput: HTMLInputElement;

    const showUrlModal = writable(false);
    const modalInputUrl = writable<string>('');
    const isNodeHovered = writable(false); // For NodeResizer visibility

    const DEFAULT_NODE_WIDTH = 200;
    const DEFAULT_NODE_HEIGHT = 150;
    const MAX_DIMENSION = 200; // Increased max dimension for flexibility with resizing
    const MIN_DIMENSION = 50;
    const HOVER_BOUNDS_PADDING = 25; // Pixels for expanded hover area
    const NODE_BORDER_RADIUS = 6; // Pixels, to match SCSS .image-node-wrapper border-radius

    function calculateAndSetInitialNodeDimensions(imgSrc: string | null) {
        if (!imgSrc) {
            if (width === undefined && height === undefined) {
                updateNode(id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
            }
            errorMsg.set(null);
            return;
        }

        const img = new Image();
        img.onload = () => {
            const naturalWidth = img.naturalWidth;
            const naturalHeight = img.naturalHeight;

            if (naturalWidth === 0 || naturalHeight === 0) {
                if (width === undefined && height === undefined) {
                    updateNode(id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
                }
                errorMsg.set('Image has zero dimensions.');
                return;
            }

            if (width === undefined || height === undefined) {
                const aspectRatio = naturalWidth / naturalHeight;
                let newWidth = naturalWidth;
                let newHeight = naturalHeight;

                if (newWidth > MAX_DIMENSION || newHeight > MAX_DIMENSION) {
                    if (aspectRatio > 1) { // Landscape or square
                        newWidth = MAX_DIMENSION;
                        newHeight = MAX_DIMENSION / aspectRatio;
                    } else { // Portrait
                        newHeight = MAX_DIMENSION;
                        newWidth = MAX_DIMENSION * aspectRatio;
                    }
                }

                newWidth = Math.max(newWidth, MIN_DIMENSION);
                newHeight = Math.max(newHeight, MIN_DIMENSION);

                if (newWidth > MAX_DIMENSION) {
                    newWidth = MAX_DIMENSION;
                    newHeight = newWidth / aspectRatio;
                }
                if (newHeight > MAX_DIMENSION) {
                    newHeight = MAX_DIMENSION;
                    newWidth = newHeight * aspectRatio;
                }

                updateNode(id, { width: Math.round(newWidth), height: Math.round(newHeight) });
            }
            errorMsg.set(null);
        };
        img.onerror = () => {
            errorMsg.set('Failed to load image. Check URL or file.');
            if (width === undefined && height === undefined) {
                updateNode(id, { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT });
            }
        };
        img.src = imgSrc;
    }

    onMount(() => {
        calculateAndSetInitialNodeDimensions($localImageUrl);
    });

    $: if (data.imageUrl !== $localImageUrl) {
        const newImgUrl = typeof data.imageUrl === 'string' ? data.imageUrl : null;
        localImageUrl.set(newImgUrl);
    }
    $: if (data.label !== $nodeLabel) {
        nodeLabel.set( (typeof data.label === 'string' && data.label ? data.label : `Image ${id}`) );
    }

    $: {
        const currentUrl = $localImageUrl;
        calculateAndSetInitialNodeDimensions(currentUrl);
    }

    function handleFileSelect(files: FileList | null) {
        if (!files || files.length === 0) return;
        const file = files[0];
        if (!file.type.startsWith('image/')) {
            errorMsg.set('Please upload an image file.');
            return;
        }
        errorMsg.set(null);

        const reader = new FileReader();
        reader.onload = (e) => {
            if (e.target && typeof e.target.result === 'string') {
                const result: string = e.target.result;
                localImageUrl.set(result);
                updateNodeData(id, { ...data, imageUrl: result });
            } else {
                errorMsg.set('Failed to read file data.');
            }
        };
        reader.onerror = () => {
            errorMsg.set('Error reading file.');
        };
        reader.readAsDataURL(file);
    }

    function onDrop(event: DragEvent) {
        event.preventDefault();
        isDraggingOver.set(false);
        const files = event.dataTransfer?.files;
        if (files) handleFileSelect(files);
    }

    function onDragOver(event: DragEvent) {
        event.preventDefault();
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
        isDraggingOver.set(true);
    }

    function onDragEnter(event: DragEvent) {
        event.preventDefault();
        isDraggingOver.set(true);
    }

    function onDragLeave(event: DragEvent) {
        if (event.relatedTarget && !(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) {
            isDraggingOver.set(false);
        } else if (!event.relatedTarget) {
            isDraggingOver.set(false);
        }
    }

    function openFilePicker() {
        fileInput?.click();
    }

    function openUrlModal() {
        modalInputUrl.set($localImageUrl || '');
        showUrlModal.set(true);
    }

    function handleSaveUrlFromModal() {
        const newUrl = $modalInputUrl.trim();
        localImageUrl.set(newUrl || null);
        updateNodeData(id, { ...data, imageUrl: newUrl || null });
        showUrlModal.set(false);
    }

    function handleCancelModal() {
        showUrlModal.set(false);
    }

</script>

<div
    class="image-node-wrapper"
    style="width:{width || DEFAULT_NODE_WIDTH}px; height:{height || DEFAULT_NODE_HEIGHT}px; --hover-padding: {HOVER_BOUNDS_PADDING}px; --node-border-radius: {NODE_BORDER_RADIUS}px;"
    on:drop={onDrop}
    on:dragover={onDragOver}
    on:dragenter={onDragEnter}
    on:dragleave={onDragLeave}
    on:mouseenter={() => isNodeHovered.set(true)}
    on:mouseleave={() => isNodeHovered.set(false)}
    class:dragging-over={$isDraggingOver}
>
    <NodeResizer
        isVisible={$isNodeHovered}
        minWidth={MIN_DIMENSION}
        minHeight={MIN_DIMENSION}
        keepAspectRatio={true}
    />
    <Handle type="target" position={Position.Left} />

    <div class="node-header">
        <span class="label-text" title={$nodeLabel}>{$nodeLabel}</span>
        <button class="edit-source-button" on:click|stopPropagation={openUrlModal} title="Edit Image URL">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
    </div>

    <div class="image-container" on:click={openFilePicker} title={$localImageUrl ? '' : 'Click to upload, or drop an image here.'}>
        {#if $localImageUrl}
            <img src={$localImageUrl} alt={$nodeLabel || 'Uploaded image'} class="image-preview" />
        {:else}
            <div class="image-placeholder">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <span>Drop or Click</span>
            </div>
        {/if}
    </div>

    {#if $errorMsg}
        <div class="error-message">{$errorMsg}</div>
    {/if}

    <input
        type="file"
        accept="image/*"
        bind:this={fileInput}
        style="display: none;"
        on:change={(e) => handleFileSelect((e.target as HTMLInputElement).files)}
    />
    <Handle type="source" position={Position.Right} />

    {#if $showUrlModal}
        <div class="modal-backdrop" on:click={handleCancelModal}>
            <div class="modal-content" on:click|stopPropagation>
                <h3>Edit Image URL</h3>
                <input type="text" bind:value={$modalInputUrl} placeholder="https://example.com/image.png" />
                <div class="modal-actions">
                    <button on:click={handleCancelModal}>Cancel</button>
                    <button on:click={handleSaveUrlFromModal} class="primary">Save</button>
                </div>
            </div>
        </div>
    {/if}
</div>

<style lang="scss">
.image-node-wrapper {
    border-radius: var(--node-border-radius, 6px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transition: box-shadow 0.2s ease, border-color 0.2s ease; /* Removed width/height transition here as Svelte Flow handles it */
    position: relative;
    background-color: #2a2a2a;


    &::before {
        content: '';
        position: absolute;
        top: calc(-1 * var(--hover-padding, 15px));
        left: calc(-1 * var(--hover-padding, 15px));
        right: calc(-1 * var(--hover-padding, 15px));
        bottom: calc(-1 * var(--hover-padding, 15px));
        background-color: transparent;
        z-index: -1;
        border-radius: calc(var(--node-border-radius, 6px) + var(--hover-padding, 15px));
    }

    &.dragging-over {
        border-color: #6355FF;
        box-shadow: 0 0 0 2px #6355FF40;
    }
}

.node-header {
    position: absolute;
    top: -36px;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 36px;
    color: #eee;

    opacity: 0;
    visibility: hidden;
    transform: translateY(5px);
    transition: opacity 0.25s ease-in-out, visibility 0.25s ease-in-out, transform 0.25s ease-in-out;
    z-index: 10;
}

.image-node-wrapper:hover .node-header {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
}

.label-text {
    flex-grow: 1;
    text-align: left;
    font-size: 11px;
    font-weight: 400;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.edit-source-button {
    background: transparent;
    border: none;
    color: #ccc;
    cursor: pointer;
    padding: 3px;
    display: flex;
    align-items: center;
    border-radius: 4px;
    margin-left: 8px;
    &:hover {
        color: #fff;
        background-color: rgba(255, 255, 255, 0.1);
    }
    svg {
        stroke: currentColor;
    }
}

.image-container {
    width: 100%;
    height: 100%;

    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    overflow: hidden; /* This will clip the image/placeholder to the container's bounds/radius */
    border-radius: inherit; /* Inherit border-radius from wrapper for content clipping */
}

.image-preview {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
}

.image-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #777;
    font-size: 12px;
    text-align: center;
    padding: 10px;
    box-sizing: border-box;
    svg {
        margin-bottom: 8px;
        stroke: #777;
        width: 36px;
        height: 36px;
    }
    span {
        max-width: 80%;
    }
}

.error-message {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background-color: rgba(211, 47, 47, 0.85);
    backdrop-filter: blur(3px);
    color: white;
    padding: 5px 10px;
    font-size: 11px;
    text-align: center;
    width: 100%;
    box-sizing: border-box;

    opacity: 0;
    visibility: hidden;
    transform: translateY(100%);
    transition: opacity 0.25s ease-in-out, visibility 0.25s ease-in-out, transform 0.25s ease-in-out;
    z-index: 10;
    border-top: 1px solid rgba(255,255,255,0.2);
}

.image-node-wrapper:hover .error-message {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
}


.modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.modal-content {
    background: #2c2c2c;
    padding: 25px;
    border-radius: 10px;
    box-shadow: 0 8px 25px rgba(0,0,0,0.4);
    min-width: 320px;
    max-width: 90%;
    display: flex;
    flex-direction: column;
    gap: 18px;

    h3 {
        margin: 0 0 5px 0;
        font-size: 18px;
        font-weight: 600;
        color: #f0f0f0;
    }

    input[type="text"] {
        width: 100%;
        padding: 10px 12px;
        border-radius: 6px;
        border: 1px solid #4a4a4a;
        background-color: #1e1e1e;
        color: #e0e0e0;
        font-size: 14px;
        box-sizing: border-box;
        transition: border-color 0.2s, box-shadow 0.2s;
        &:focus {
            outline: none;
            border-color: #6355FF;
            box-shadow: 0 0 0 2px rgba(99, 85, 255, 0.3);
        }
    }
}

.modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 12px;

    button {
        padding: 9px 18px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: background-color 0.2s, transform 0.1s;

        &.primary {
            background-color: #6355FF;
            color: white;
            &:hover { background-color: #5345dd; }
            &:active { transform: scale(0.98); }
        }
        &:not(.primary) {
            background-color: #4a4a4a;
            color: #ddd;
            &:hover { background-color: #5a5a5a; }
            &:active { transform: scale(0.98); }
        }
    }
}

:global(.image-node-wrapper .svelte-flow__handle) {
    pointer-events: auto !important;
    z-index: 15;
}

:global(.image-node-wrapper .svelte-flow__node-resizer) {
    z-index: 20;
}

:global(.svelte-flow__resize-control.line){
    transition: .2s ease;
}

:global(.svelte-flow__resize-control.handle) {
  border: none;
  border-radius: 2px;
  width: 8px;
  height: 8px;
}

</style>