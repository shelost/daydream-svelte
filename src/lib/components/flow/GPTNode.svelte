<!-- src/lib/components/flow/GPTNode.svelte -->
<script lang="ts">
    import {
        Handle,
        Position,
        useSvelteFlow,
        useNodeConnections,
        useNodesData,
        type NodeProps
    } from '@xyflow/svelte';
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { addApiCallToStore } from '$lib/stores/apiLogStore.js';

    type $$Props = NodeProps;

    // loosen types to avoid strict TS complaints in this JavaScript-leaning project
    export let id: any;
    export let data: any;

    const { updateNodeData, updateNode, getNodes } = useSvelteFlow();
    // helper to bypass type complaints when calling updateNodeData
    const setData = (payload: Record<string, any>) => updateNodeData(id as any, payload);

    /* --------------------------------------------------
       Image to Data URL Helper
    -------------------------------------------------- */
    async function imageToDataURL(url: string): Promise<string> {
        if (url.startsWith('data:') || url.startsWith('http')) {
            return url; // Already a data URL or an absolute URL
        }
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
            }
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (error) {
            console.error("Error converting image to Data URL:", error);
            throw error; // Re-throw to be caught by the caller
        }
    }

    /* --------------------------------------------------
       Connections & incoming node data
    -------------------------------------------------- */
    const connections = useNodeConnections({ id, handleType: 'target' });
    let incomingNodesDataStore;
    $: incomingNodesDataStore = useNodesData($connections.map((c) => c.source));

    /* --------------------------------------------------
       UI / State refs
    -------------------------------------------------- */
    let textarea: HTMLTextAreaElement | null = null;
    let isEditing = false;
    let isLoading = false;
    let generationSeconds = 0;
    let generationTimer: ReturnType<typeof setInterval>;

    /* --------------------------------------------------
       Model capability table & selection
    -------------------------------------------------- */
    const models = [
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini', visionIn: true, imageOut: false, apiProvider: 'OpenAI' },
        { id: 'gpt-4o', label: 'GPT-4o', visionIn: true, imageOut: false, apiProvider: 'OpenAI' },
        { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', visionIn: false, imageOut: false, apiProvider: 'OpenAI' },
        { id: 'gpt-image-1', label: 'GPT-Image-1', visionIn: true, imageOut: true, apiProvider: 'OpenAI' },
        { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet', visionIn: true, imageOut: false, apiProvider: 'Anthropic' },
        { id: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro', visionIn: true, imageOut: false, apiProvider: 'Google' },
        { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini 2.5 Flash', visionIn: true, imageOut: false, apiProvider: 'Google' }
    ];

    if (!data.selectedModel) {
        setData({ selectedModel: 'gpt-4o-mini' });
    }

    $: selectedModelId = data.selectedModel ?? 'gpt-4o-mini';
    $: modelInfo = models.find((m) => m.id === selectedModelId) || models[0];

    function handleModelChange(event: Event) {
        const value = (event.currentTarget as HTMLSelectElement).value || '';
        setData({ selectedModel: value });
    }

    /* --------------------------------------------------
       Modality detection helpers
    -------------------------------------------------- */
    let hasImageInput = false;
    let incomingTexts: string[] = [];
    let incomingImageUrls: string[] = [];

    $: {
        const rawNodesData = get(incomingNodesDataStore);
        const currentTexts: string[] = [];
        const currentImageUrls: string[] = [];

        if (Array.isArray(rawNodesData)) {
            for (const node of rawNodesData) {
                if (node?.data?.text) currentTexts.push(node.data.text);
                if (node?.data?.resultText) currentTexts.push(node.data.resultText);
                if (node?.data?.imageUrl && typeof node.data.imageUrl === 'string') {
                    currentImageUrls.push(node.data.imageUrl);
                }
                if (node?.data?.resultImageUrl && typeof node.data.resultImageUrl === 'string') {
                    currentImageUrls.push(node.data.resultImageUrl);
                }
            }
        }
        incomingTexts = currentTexts;
        incomingImageUrls = currentImageUrls;
        hasImageInput = incomingImageUrls.length > 0;
    }

    // Function to get fresh data from connected nodes
    function getFreshInputData() {
        const allNodes = getNodes();
        const connectedSources = $connections.map(c => c.source);
        const currentTexts: string[] = [];
        const currentImageUrls: string[] = [];

        // Get latest data from connected nodes
        for (const sourceId of connectedSources) {
            const sourceNode = allNodes.find(node => node.id === sourceId);
            if (sourceNode?.data) {
                if (sourceNode.data.text) currentTexts.push(sourceNode.data.text);
                if (sourceNode.data.resultText) currentTexts.push(sourceNode.data.resultText);
                if (sourceNode.data.imageUrl && typeof sourceNode.data.imageUrl === 'string') {
                    currentImageUrls.push(sourceNode.data.imageUrl);
                }
                if (sourceNode.data.resultImageUrl && typeof sourceNode.data.resultImageUrl === 'string') {
                    currentImageUrls.push(sourceNode.data.resultImageUrl);
                }
            }
        }

        return { texts: currentTexts, images: currentImageUrls };
    }

    function promptWantsImageOutput(text: string) {
        if (!text) return false;
        const lower = text.toLowerCase();
        return /(generate|create|draw|render|make).*image/.test(lower);
    }

    $: requiresImageOutput = promptWantsImageOutput(data.prompt ?? '');

    $: incompatible =
        (hasImageInput && !modelInfo.visionIn) ||
        (requiresImageOutput && !modelInfo.imageOut);

    $: warningMessage = (() => {
        if (!incompatible) return '';
        if (hasImageInput && !modelInfo.visionIn) {
            return 'Selected model cannot accept image inputs.';
        }
        if (requiresImageOutput && !modelInfo.imageOut) {
            return 'Selected model cannot generate images.';
        }
        return '';
    })();

    /* --------------------------------------------------
       Textarea helpers (borrowed from previous version)
    -------------------------------------------------- */
    function autoResize() {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.overflow = 'hidden';
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

    function handleWheel(event: WheelEvent) {
        if (!textarea) return;
        const isScrollable = textarea.scrollHeight > textarea.clientHeight;
        if (isScrollable && isEditing) {
            event.stopPropagation();
        }
    }

    // Handle wheel events for result text
    function handleResultWheel(event: WheelEvent) {
        const target = event.target as HTMLElement;
        const scrollableContainer = target.closest('.result-text') as HTMLElement;

        if (!scrollableContainer) return;

        const { scrollHeight, clientHeight, scrollTop } = scrollableContainer;
        const isScrollable = scrollHeight > clientHeight;

        // Only prevent default and stop propagation if the container is scrollable
        if (isScrollable) {
            // Check if we're at the top and scrolling up, or at the bottom and scrolling down
            if (!((scrollTop <= 0 && event.deltaY < 0) ||
                (scrollTop + clientHeight >= scrollHeight && event.deltaY > 0))) {
                event.stopPropagation();
            }
        }
    }

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
        autoResize();
    });

    onDestroy(() => {
        if (generationTimer) {
            clearInterval(generationTimer);
        }
    });

    /* --------------------------------------------------
       Generate helper
    -------------------------------------------------- */
    async function generateFromGPT() {
        if (isLoading || incompatible) return;
        isLoading = true;
        setData({ text: undefined, imageUrl: undefined });

        generationSeconds = 0;
        generationTimer = setInterval(() => {
            generationSeconds = parseFloat((generationSeconds + 0.1).toFixed(1));
        }, 100);

        const startTime = Date.now();
        let endpointUsed = '';
        let currentApiProvider = modelInfo.apiProvider;
        let statusCode = 0;
        let apiCost = 0;
        let errorMsg = '';

        try {
            // Get fresh data from connected nodes at the moment of generation
            const freshData = getFreshInputData();
            const freshTexts = freshData.texts;
            const freshImageUrls = freshData.images;

            // Update the UI to show latest inputs for transparency
            incomingTexts = freshTexts;
            incomingImageUrls = freshImageUrls;
            hasImageInput = freshImageUrls.length > 0;

            const basePrompt = typeof data.prompt === 'string' ? data.prompt : '';
            const promptPieces = [basePrompt.trim(), ...freshTexts.filter(Boolean)];
            const currentPrompt = promptPieces.join('\n');

            let fetchResponse: Response;
            let requestBody: any;

            if (currentApiProvider === 'OpenAI') {
                if (modelInfo.id === 'gpt-image-1') {
                    if (freshImageUrls.length > 0) {
                        const imageDataForApi = await imageToDataURL(freshImageUrls[0]);
                        requestBody = { prompt: currentPrompt, imageData: imageDataForApi, drawingContent: {}, aspectRatio: '1:1' };
                        endpointUsed = '/api/ai/edit-image';
                    } else {
                        requestBody = { prompt: currentPrompt };
                        endpointUsed = '/api/ai/generate-image';
                    }
                } else {
                    const imagesForApi = await Promise.all(freshImageUrls.map(url => imageToDataURL(url)));
                    requestBody = { prompt: currentPrompt, model: modelInfo.id, images: imagesForApi };
                    endpointUsed = '/api/ai/gpt';
                }
            } else if (currentApiProvider === 'Anthropic') {
                const imagesForApi = await Promise.all(freshImageUrls.map(url => imageToDataURL(url)));
                requestBody = { prompt: currentPrompt, model: modelInfo.id, images: imagesForApi };
                endpointUsed = '/api/ai/anthropic';
            } else if (currentApiProvider === 'Google') {
                const imagesForApi = await Promise.all(freshImageUrls.map(url => imageToDataURL(url)));
                requestBody = { prompt: currentPrompt, model: modelInfo.id, images: imagesForApi };
                endpointUsed = '/api/ai/google';
            } else {
                throw new Error(`Unsupported API provider: ${currentApiProvider}`);
            }

            fetchResponse = await fetch(endpointUsed, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            statusCode = fetchResponse.status;
            const responseText = await fetchResponse.text();
            let resultJson: any = null;

            if (!fetchResponse.ok) {
                // Try to parse error from responseText if possible
                try {
                    resultJson = JSON.parse(responseText);
                    errorMsg = resultJson.error?.message || resultJson.error || resultJson.message || responseText || 'Unknown API error (non-JSON)';
                } catch (e) {
                    errorMsg = responseText || 'Unknown API error (non-JSON)';
                }
                console.error('GPT error', errorMsg);
                setData({ text: `Error: ${errorMsg}` });
            } else {
                try {
                    resultJson = JSON.parse(responseText);
                    // Successfully parsed JSON
                    if (resultJson.cost) {
                        apiCost = resultJson.cost;
                    } else if (resultJson.usage) {
                        const costPerToken = modelInfo.id.includes('gpt-4') || modelInfo.id.includes('claude-3') || modelInfo.id.includes('gemini-2.5') ? 0.00005 : 0.000001;
                        const totalTokens = resultJson.usage.total_tokens || (resultJson.usage.input_tokens || 0) + (resultJson.usage.output_tokens || 0);
                        apiCost = totalTokens * costPerToken;
                    }

                    if (resultJson.imageUrl) {
                        setData({ imageUrl: String(resultJson.imageUrl), text: undefined });
                    } else {
                        setData({ text: String(resultJson.message ?? resultJson.response ?? resultJson.text ?? 'No text content in JSON response'), imageUrl: undefined });
                    }
                } catch (e) {
                    // Failed to parse JSON, assume responseText is the direct content
                    console.log('Response was not JSON, treating as text/markdown.');
                    setData({ text: responseText, imageUrl: undefined });
                    // apiCost might not be available here unless sent in headers or determined otherwise
                }
            }
        } catch (err) {
            console.error('GPT request failed', err);
            const caughtErrorMsg = err instanceof Error ? err.message : String(err);
            setData({ text: `Error: ${caughtErrorMsg}` });
            errorMsg = caughtErrorMsg;
            statusCode = statusCode === 0 ? 500 : statusCode; // If fetch itself failed, use 500, else keep original status
        } finally {
            const endTime = Date.now();
            const durationMs = endTime - startTime;

            addApiCallToStore({
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                apiProvider: currentApiProvider,
                model: modelInfo.id,
                endpoint: endpointUsed,
                durationMs,
                status: statusCode,
                cost: apiCost,
                error: errorMsg || null
            });

            if (generationTimer) {
                clearInterval(generationTimer);
                generationTimer = undefined;
            }
            isLoading = false;
        }
    }
</script>


<div class="flow-node">
    <label>
        <img src="/openai.svg" alt="GPT" /> GPT
    </label>
    <div class="node" class:generating={isLoading}>
        <textarea
            bind:this={textarea}
            bind:value={data.prompt}
            style="width:100%; max-height:500px; resize:none;"
            rows="2"
            placeholder="Enter prompt..."
            on:input={(evt) => {
                autoResize();
                setData({ prompt: String((evt.currentTarget as HTMLTextAreaElement).value) });
            }}
            on:focus={handleFocus}
            on:blur={handleBlur}
            on:wheel={handleWheel}
            on:keydown={handleKeyDown}
            on:mousedown={handleMouseDown}
        ></textarea>

        <div class="controls-row">
            <select on:change={handleModelChange} bind:value={selectedModelId}>
                {#each models as m}
                    <option
                        value={m.id}
                        disabled={(hasImageInput && !m.visionIn) || (requiresImageOutput && !m.imageOut)}
                    >
                        {m.label}
                    </option>
                {/each}
            </select>
            <button class="generate-btn" on:click={generateFromGPT} disabled={isLoading || incompatible}>
                {#if isLoading}
                    <div class="loading-container">
                        <div class="loading-spinner"></div>
                    </div>
                {:else}
                    <span class='material-symbols-outlined'>arrow_upward</span>
                {/if}
            </button>
        </div>

        {#if warningMessage}
            <div class="warning">⚠️ {warningMessage}</div>
        {/if}

        {#if incomingTexts.length > 0 || incomingImageUrls.length > 0}
            <div class="input-summary">
                {#if incomingTexts.length > 0}
                    <div class="input-text">
                        <span class="material-symbols-outlined text-icon">text_format</span>
                    </div>
                {/if}
                {#if incomingImageUrls.length > 0}
                    <div class="input-image">
                        <span class="material-symbols-outlined image-icon">image</span>
                    </div>
                {/if}
            </div>
        {/if}

        {#if data.text}
            <div class="result-text" on:wheel={handleResultWheel}>{data.text}</div>
        {/if}
        {#if data.imageUrl}
            <img src={data.imageUrl} alt="Generated by GPT" class="result-img" />
        {/if}
    </div>

    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
</div>

<style lang="scss">

    @import '../../styles/global.scss';

    .flow-node { /* Added this class to the outer div for consistency with ResultNode */
        padding: 12px;
        border-radius: 6px;
        min-width: 244px; /* Adjusted to fit content */
        width: 300px; /* Fixed width for consistency */
        box-sizing: border-box;
    }

    label { /* Styling for the label */
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: bold;
        margin-bottom: 8px;
        font-size: 13px;
    }

    label img {
        width: 16px;
        height: 16px;
    }

    .node { /* Renamed from .node-body for clarity, this is the main content area */
        width: 100%;
        //padding: 8px;


        &.generating{
            animation: glow .7s infinite alternate-reverse ease-in-out;
        }
    }

    @keyframes glow {
        0%{
            box-shadow: 0px 0px 24px var(--highlight);
        }

        100%{
            box-shadow: 0px 0px 12px var(--highlight);
        }
    }

    .controls-row {
        display: flex;
        gap: 8px; /* Increased gap */
        align-items: center;
        padding: 0 4px;
        width: 100%; /* Make controls row full width */
        margin: 8px 0;
    }

    select {
        font-size: 11px;
        padding: 6px 8px; /* Adjusted padding */
        border-radius: 24px;
        border: none;
        background: rgba(white, .03);
        color: white;
        flex: 1; /* Allow select to take available space */

    }

    .generate-btn {
        font-size: 11px;
        font-weight: 600;
        padding: 4px 5px;
        border-radius: 16px;
        width: fit-content;
        background: var(--highlight);
        color: white;
        cursor: pointer;
        transition: background-color 0.2s;
        white-space: nowrap;
        transition: .2s ease;

        span{
            font-size: 16px;
        }

        &:hover:not([disabled]) {
            opacity: .8;
        }

        &:disabled {
            opacity: 0.6;
            cursor: default;
        }
    }


    .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
    }

    .loading-spinner {
        width: 12px;
        height: 12px;
        border: 2px solid rgba(255, 255, 255, 0.3);
        border-radius: 50%;
        border-top-color: white;
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .warning {
        font-size: 10px;
        color: #ffcc00; /* Brighter yellow for warning */
        max-width: 100%; /* Full width */
        background-color: rgba(255, 204, 0, 0.1);
        padding: 4px 6px;
        border-radius: 3px;
        margin: 8px 0;
    }

    .result-text {
        display: none;
        width: 100%; /* Full width */
        max-height: 200px; /* Add max-height constraint */
        overflow-y: auto; /* Enable scrolling */
        overscroll-behavior: contain; /* Prevent scroll chaining */
        white-space: pre-wrap;
        font-size: 11px;
        background: rgba(0,0,0,0.3); /* Slightly darker background for text result */
        padding: 6px 8px; /* Adjusted padding */
        border-radius: 4px;
        word-break: break-word;
        margin: 8px 0;
        box-sizing: border-box;

        height: 40px;
    }

    .result-img {
        max-width: 100%; /* Full width, will scale down */
        height: auto; /* Maintain aspect ratio */
        border-radius: 4px;
        display: block; /* Ensure it takes block space */
        margin-top: 4px; /* Add some space if text is also present */

        height: 40px;
    }

    .input-summary {
        display: none;
        align-items: center;
        gap: 4px;
        background-color: rgba(0, 0, 0, 0.2);
        border-radius: 4px;
        padding: 8px;
        margin: 8px 0;
        font-size: 10px;
        color: rgba(255, 255, 255, 0.8);
    }

    .input-label {
        display: block;
        font-size: 9px;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 4px;
    }

    .input-text, .input-image {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
    }

    .text-icon {
        color: #58a6ff;
        font-size: 14px;
    }

    .image-icon {
        color: #b392f0;
        font-size: 14px;
    }
</style>