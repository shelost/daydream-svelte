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
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';

    type $$Props = NodeProps;

    // loosen types to avoid strict TS complaints in this JavaScript-leaning project
    export let id: any;
    export let data: any;

    const { updateNodeData } = useSvelteFlow();
    // helper to bypass type complaints when calling updateNodeData
    const setData = (payload: Record<string, any>) => updateNodeData(id as any, payload);

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

    /* --------------------------------------------------
       Model capability table & selection
    -------------------------------------------------- */
    const models = [
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini', visionIn: true, imageOut: false },
        { id: 'gpt-4o', label: 'GPT-4o', visionIn: true, imageOut: false },
        { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo', visionIn: false, imageOut: false },
        { id: 'gpt-image-1', label: 'GPT-Image-1', visionIn: true, imageOut: true }
    ];

    if (!data.selectedModel) {
        setData({ selectedModel: 'gpt-4o-mini' });
    }

    $: selectedModel = data.selectedModel ?? 'gpt-4o-mini';
    $: modelInfo = models.find((m) => m.id === selectedModel) || models[0];

    function handleModelChange(event: Event) {
        const value = (event.currentTarget as HTMLSelectElement).value || '';
        setData({ selectedModel: value });
    }

    /* --------------------------------------------------
       Modality detection helpers
    -------------------------------------------------- */
    $: hasImageInput = (() => {
        const rawNodesData = get(incomingNodesDataStore);
        if (!Array.isArray(rawNodesData)) return false;
        return rawNodesData.some((node: any) => Boolean(node?.data?.imageUrl));
    })();

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
    }

    function handleBlur() {
        isEditing = false;
    }

    function handleWheel(event: WheelEvent) {
        if (!textarea) return;
        const isScrollable = textarea.scrollHeight > textarea.clientHeight;
        if (isScrollable && isEditing) {
            event.stopPropagation();
        }
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (event.code === 'Space' && isEditing) {
            event.stopPropagation();
        }
    }

    onMount(() => {
        autoResize();
    });

    /* --------------------------------------------------
       Generate helper
    -------------------------------------------------- */
    async function generateFromGPT() {
        if (isLoading || incompatible) return;
        isLoading = true;
        try {
            /* gather upstream data */
            const rawNodesData = get(incomingNodesDataStore);
            let incomingTexts: string[] = [];
            let incomingImageUrls: string[] = [];
            if (Array.isArray(rawNodesData)) {
                rawNodesData.forEach((node: any) => {
                    if (node?.data?.text) incomingTexts.push(node.data.text);
                    if (node?.data?.imageUrl) incomingImageUrls.push(node.data.imageUrl);
                });
            }
            const basePrompt = typeof data.prompt === 'string' ? data.prompt : '';
            const promptPieces = [basePrompt.trim(), ...incomingTexts.filter(Boolean)];
            const prompt = promptPieces.join('\n');

            let response: Response;

            if (selectedModel === 'gpt-image-1') {
                /* ----------------------------------------------
                   GPT-Image-1 branch: choose generate vs edit
                ---------------------------------------------- */
                if (incomingImageUrls.length > 0) {
                    // EDIT mode – we send first image + prompt
                    response = await fetch('/api/ai/edit-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            prompt,
                            imageData: incomingImageUrls[0],
                            drawingContent: {}, // minimal payload to satisfy endpoint requirements
                            aspectRatio: '1:1'
                        })
                    });
                } else {
                    // GENERATE mode – text-to-image
                    response = await fetch('/api/ai/generate-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt })
                    });
                }
            } else {
                /* ----------------------------------------------
                   Standard text or vision models
                ---------------------------------------------- */
                response = await fetch('/api/ai/gpt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt, model: selectedModel, images: incomingImageUrls })
                });
            }

            const result = await response.json();

            if (!response.ok) {
                console.error('GPT error', result.error);
                setData({ text: `Error: ${result.error ?? 'Unknown error'}` });
            } else if (result.imageUrl) {
                setData({ imageUrl: String(result.imageUrl), text: undefined });
            } else {
                setData({ text: String(result.message ?? result.response ?? 'No response'), imageUrl: undefined });
            }
        } catch (err) {
            console.error('GPT request failed', err);
            setData({ text: `Error: ${err instanceof Error ? err.message : String(err)}` });
        } finally {
            isLoading = false;
        }
    }
</script>

<div class="flow-node">
    <label>
        <img src="/openai.svg" alt="GPT" /> GPT
    </label>
    <div class="node">
        <textarea
            bind:this={textarea}
            bind:value={data.prompt}
            style="width:220px; max-height:500px; resize:none;"
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
        ></textarea>

        <div class="controls-row">
            <select on:change={handleModelChange} bind:value={selectedModel}>
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
                {isLoading ? 'Generating…' : 'Generate'}
            </button>
        </div>

        {#if warningMessage}
            <div class="warning">⚠️ {warningMessage}</div>
        {/if}

    </div>

    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
</div>

<style>
    .node-body {
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: flex-start;
    }

    textarea {
        font: inherit;
        padding: 6px;
        border-radius: 4px;
        border: none;
        background: none;
        color: white;
        font-size: 12px;
        font-weight: 500;
        letter-spacing: -0.3px;
        width: 220px;
        box-sizing: border-box;
    }

    .controls-row {
        display: flex;
        gap: 6px;
        align-items: center;
    }

    select {
        font-size: 11px;
        padding: 4px 6px;
        border-radius: 4px;
        border: 1px solid #e0e0e0;
        background: hsla(0,0%,100%,0.85);
        color: #333;
    }

    .generate-btn {
        font-size: 11px;
        font-weight: 600;
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid #e0e0e0;
        background-color: hsla(0, 0%, 100%, 0.85);
        color: #333;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .generate-btn:hover:not([disabled]) {
        background-color: #ffffff;
    }

    .generate-btn:disabled {
        opacity: 0.6;
        cursor: default;
    }

    .warning {
        font-size: 10px;
        color: #ffb300;
        max-width: 220px;
    }

    .result-text {
        max-width: 220px;
        white-space: pre-wrap;
        font-size: 11px;
        background: rgba(0,0,0,0.2);
        padding: 4px;
        border-radius: 4px;
    }

    .result-img {
        max-width: 220px;
        border-radius: 4px;
    }
</style>