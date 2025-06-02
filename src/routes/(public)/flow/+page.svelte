<script lang="ts">
    import { writable } from 'svelte/store';
    import {
      SvelteFlow,
      Controls,
      Background,
      BackgroundVariant,
      MiniMap,
      type Node,
      type NodeTypes,
      type Edge,
      type DefaultEdgeOptions,
      ConnectionMode,
      MarkerType
    } from '@xyflow/svelte';
    import '@xyflow/svelte/dist/style.css';
    import 'prismjs/themes/prism-okaidia.css';

    import { fly, scale, fade } from 'svelte/transition';
    import { onMount, onDestroy, tick } from 'svelte';
    import { beforeNavigate } from '$app/navigation';

    import Prism from 'prismjs';
    import 'prismjs/components/prism-json';

    import TextNode from '$lib/components/flow/TextNode.svelte';
    import UppercaseNode from '$lib/components/flow/UppercaseNode.svelte';
    import ResultNode from '$lib/components/flow/ResultNode.svelte';
    import DrawingNode from '$lib/components/flow/DrawingNode.svelte';
    import ImageNode from '$lib/components/flow/ImageNode.svelte';
    import GradientEdge from '$lib/components/flow/GradientEdge.svelte';
    import GPTNode from '$lib/components/flow/GPTNode.svelte';
    import FlowToolbar from '$lib/components/flow/FlowToolbar.svelte';
    import AppModal from '$lib/components/shared/AppModal.svelte';
    import RefreshButton from '$lib/components/shared/RefreshButton.svelte';

    const nodeTypes: NodeTypes = {
      text: TextNode,
      uppercase: UppercaseNode,
      result: ResultNode,
      drawing: DrawingNode,
      image: ImageNode,
      gpt: GPTNode
    };

    const edgeTypes = {
        gradient: GradientEdge
    } as any;

    const FLOW_NODES_STORAGE_KEY = 'flowPageNodesData_v1';
    const FLOW_EDGES_STORAGE_KEY = 'flowPageEdgesData_v1';

    const saveStatus = writable('idle');
    let saveDebounceTimeout: ReturnType<typeof setTimeout>;
    const SAVE_DEBOUNCE_MS = 1000;

    let enableSnapToGrid = false;
    const gridSnapValues: [number, number] = [15, 15];
    let toolbarPosition = { x: 10, y: 60 };
    let flowInstance;

    let showSourceModal = false;
    let flowSourceData = '';
    let sourceCodeElement: HTMLElement;

    $: if (showSourceModal && flowSourceData && sourceCodeElement) {
      tick().then(() => {
        Prism.highlightElement(sourceCodeElement);
      });
    }

    const defaultNodes: Node[] = [
      {
        id: '1',
        type: 'text',
        data: {
          text: 'hello'
        },
        position: { x: -200, y: -50 }
      },
      {
        id: '1a',
        type: 'uppercase',
        data: {},
        position: { x: 100, y: 0 }
      },
      {
        id: '2',
        type: 'text',
        data: {
          text: 'world'
        },
        position: { x: 0, y: 100 }
      },
      {
        id: '3',
        type: 'result',
        data: {},
        position: { x: 400, y: 50 }
      },
      {
        id: '4',
        type: 'drawing',
        data: { fabricJson: null, label: 'Drawing A' },
        position: { x: -500, y: -400 }
      },
      {
        id: '5',
        type: 'drawing',
        data: { fabricJson: null, label: 'Drawing B' },
        position: { x: -200, y: -400 }
      },
      {
        id: '6',
        type: 'drawing',
        data: { fabricJson: null, label: 'Drawing C' },
        position: { x: 100, y: -400 }
      },
      {
        id: '7',
        type: 'drawing',
        data: { fabricJson: null, label: 'Drawing D' },
        position: { x: 400, y: -400 }
      },
      {
        id: 'image-1',
        type: 'image',
        data: { imageUrl: '/paine.png', label: 'Thomas Paine' },
        position: { x: -500, y: 0 }
      },
      {
        id: 'bo-text',
        type: 'text',
        data: { text: 'Bo Burnham' },
        position: { x: -500, y: 200 }
      },
      {
        id: 'gpt-1',
        type: 'gpt',
        data: { prompt: 'Write a poem based on this style and inspiration' },
        position: { x: -200, y: 250 }
      },
      {
        id: 'result-poem',
        type: 'result',
        data: {},
        position: { x: 150, y: 300 }
      }
    ];

    const defaultEdges: Edge[] = [
      {
        id: 'e1-1a',
        source: '1',
        target: '1a',
        animated: true,
        type: 'gradient',
        class: 'flow-edge'
      },
      {
        id: 'e1a-3',
        source: '1a',
        target: '3',
        animated: true,
        type: 'gradient',
        class: 'flow-edge'
      },
      {
        id: 'e2-3',
        source: '2',
        target: '3',
        animated: true,
        type: 'gradient',
        class: 'flow-edge'
      },
      {
        id: 'e-img-gpt',
        source: 'image-1',
        target: 'gpt-1',
        animated: true,
        type: 'gradient',
        class: 'flow-edge'
      },
      {
        id: 'e-bo-gpt',
        source: 'bo-text',
        target: 'gpt-1',
        animated: true,
        type: 'gradient',
        class: 'flow-edge'
      },
      {
        id: 'e-gpt-result',
        source: 'gpt-1',
        target: 'result-poem',
        animated: true,
        type: 'gradient',
        class: 'flow-edge'
      }
    ];

    const defaultEdgeOptions: DefaultEdgeOptions = {
        animated: true,
        type: 'gradient',
        selectable: true
    };

    let initialNodes = defaultNodes;
    let initialEdges = defaultEdges.map(edge => ({
        ...edge,
        type: 'gradient',
        animated: true,
        selectable: true,
        class: 'flow-edge'
    }));

    if (typeof window !== 'undefined') {
        try {
            const savedNodesJSON = localStorage.getItem(FLOW_NODES_STORAGE_KEY);
            if (savedNodesJSON) {
                const parsedNodes = JSON.parse(savedNodesJSON);
                if (Array.isArray(parsedNodes)) {
                    initialNodes = parsedNodes;
                }
            }
        } catch (e) {
            console.error("Error loading nodes from local storage:", e);
        }

        try {
            const savedEdgesJSON = localStorage.getItem(FLOW_EDGES_STORAGE_KEY);
            if (savedEdgesJSON) {
                const parsedEdges = JSON.parse(savedEdgesJSON);
                if (Array.isArray(parsedEdges)) {
                    initialEdges = parsedEdges.map(edge => ({
                        ...edge,
                        type: 'gradient',
                        animated: true,
                        selectable: true,
                        class: 'flow-edge'
                    }));
                } else {
                    initialEdges = defaultEdges.map(edge => ({
                        ...edge,
                        type: 'gradient',
                        animated: true,
                        selectable: true,
                        class: 'flow-edge'
                    }));
                }
            } else {
                 // initialEdges already set to styled defaultEdges if no saved data
            }
        } catch (e) {
            console.error("Error loading edges from local storage:", e);
            initialEdges = defaultEdges.map(edge => ({
                ...edge,
                type: 'gradient',
                animated: true,
                selectable: true,
                class: 'flow-edge'
            }));
        }
    } else {
        initialEdges = defaultEdges.map(edge => ({
            ...edge,
            type: 'gradient',
            animated: true,
            selectable: true,
            class: 'flow-edge'
        }));
    }

    const nodes = writable<Node[]>(initialNodes);
    const edges = writable<Edge[]>(initialEdges);

    $: {
        if (typeof window !== 'undefined' && ($nodes || $edges)) {
            triggerAutoSave();
        }
    }

    function triggerAutoSave() {
        if (saveDebounceTimeout) {
            clearTimeout(saveDebounceTimeout);
        }
        $saveStatus = 'saving';
        saveDebounceTimeout = setTimeout(() => {
            saveFlowState();
        }, SAVE_DEBOUNCE_MS);
    }

    const isSpacebarPressed = writable(false);

    function handleKeyDown(event: KeyboardEvent) {
        if (event.code === 'Space' && !(event.target instanceof HTMLTextAreaElement)) {
            event.preventDefault();
            isSpacebarPressed.set(true);
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) {
            const selectedEdgeIds = $edges
                .filter(edge => edge.class && edge.class.includes('selected'))
                .map(edge => edge.id);
            if (selectedEdgeIds.length > 0) {
                $edges = $edges.filter(edge => !selectedEdgeIds.includes(edge.id));
                console.log(`Deleted ${selectedEdgeIds.length} edge(s):`, selectedEdgeIds);
            }
        }
    }

    function handleKeyUp(event: KeyboardEvent) {
        if (event.code === 'Space') {
            isSpacebarPressed.set(false);
        }
    }

    function handleFlowWheel(e: CustomEvent<WheelEvent>) {
        const event = e.detail as WheelEvent;
        const scrollableSelectors = ['.markdown-container', '.result-text'];
        const target = event.target as HTMLElement;
        for (const selector of scrollableSelectors) {
            const scrollContainer = target.closest(selector);
            if (scrollContainer) {
                return;
            }
        }
    }

    function saveFlowState() {
        if (typeof window !== 'undefined') {
            try {
                localStorage.setItem(FLOW_NODES_STORAGE_KEY, JSON.stringify($nodes));
                const edgesToSave = $edges.map(edge => ({
                    ...edge,
                    type: 'gradient',
                    animated: true,
                    selectable: true,
                    class: 'flow-edge'
                }));
                localStorage.setItem(FLOW_EDGES_STORAGE_KEY, JSON.stringify(edgesToSave));
                $saveStatus = 'saved';
            } catch (e) {
                console.error("Error saving Svelte Flow state to local storage:", e);
                $saveStatus = 'error';
            }
        }
    }

    function resetFlowCanvas() {
        if (typeof window !== 'undefined') {
            localStorage.removeItem(FLOW_NODES_STORAGE_KEY);
            localStorage.removeItem(FLOW_EDGES_STORAGE_KEY);
            $nodes = JSON.parse(JSON.stringify(defaultNodes));
            $edges = JSON.parse(JSON.stringify(defaultEdges.map(edge => ({
                ...edge,
                type: 'gradient',
                animated: true,
                selectable: true,
                class: 'flow-edge'
            }))));
            $saveStatus = 'saved';
        }
    }

    function handleAddNode(event) {
        const { type, data } = event.detail;
        const id = `${type}-${Date.now()}`;
        let position = { x: 0, y: 0 };
        if (flowInstance && typeof flowInstance.getViewport === 'function') {
            try {
                const { x, y, zoom } = flowInstance.getViewport();
                position = {
                    x: -x / zoom + window.innerWidth / (2 * zoom),
                    y: -y / zoom + window.innerHeight / (2 * zoom)
                };
            } catch (error) {
                console.error("Error getting viewport:", error);
            }
        }
        const newNode = {
            id,
            type,
            data,
            position
        };
        $nodes = [...$nodes, newNode];
        console.log(`Added new ${type} node with id: ${id}`);
    }

    function handleSelectionChange({ detail }) {
        const { edges: selectedEdges, nodes: selectedNodes } = detail;
        if (selectedEdges && selectedEdges.length > 0) {
            $edges = $edges.map(edge => {
                const isSelected = selectedEdges.some(selectedEdge => selectedEdge.id === edge.id);
                return {
                    ...edge,
                    class: isSelected ? 'flow-edge selected' : 'flow-edge'
                };
            });
        } else {
            $edges = $edges.map(edge => ({
                ...edge,
                class: 'flow-edge'
            }));
        }
    }

    function handleConnect(event) {
        const { source, target } = event.detail;
        const id = `e${source}-${target}`;
        const connectionExists = $edges.some(edge =>
            edge.source === source && edge.target === target);
        if (!connectionExists && source !== target) {
            const newEdge: Edge = {
                id,
                source,
                target,
                type: 'gradient',
                animated: true,
                selectable: true,
                class: 'flow-edge'
            };
            $edges = [...$edges, newEdge];
        }
    }

    function openSourceModal() {
        const currentNodes = $nodes;
        const currentEdges = $edges;
        const combinedData = {
            nodes: currentNodes,
            edges: currentEdges.map(edge => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: 'gradient',
                animated: true,
                selectable: true,
                class: edge.class || 'flow-edge'
            }))
        };
        flowSourceData = JSON.stringify(combinedData, null, 2);
        showSourceModal = true;
    }

    onMount(() => {
        if (typeof window !== 'undefined') {
            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);
            window.addEventListener('beforeunload', saveFlowState);
        }
    });

    onDestroy(() => {
        saveFlowState();
        if (typeof window !== 'undefined') {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('beforeunload', saveFlowState);
        }
        if (saveDebounceTimeout) {
            clearTimeout(saveDebounceTimeout);
        }
    });

    beforeNavigate(() => {
        saveFlowState();
    });

  </script>

<main
  in:scale={{start: .97, opacity: .8}}
  class:panning-active={$isSpacebarPressed}
  class:selection-active={!$isSpacebarPressed}
>
    <SvelteFlow
        {nodes}
        {edges}
        {nodeTypes}
        {edgeTypes}
        {defaultEdgeOptions}
        fitView
        snapGrid={enableSnapToGrid ? gridSnapValues : undefined}
        panOnDrag={$isSpacebarPressed}
        selectionOnDrag={!$isSpacebarPressed}
        deleteKey="Backspace"
        multiSelectionKey={['Meta', 'Control']}
        connectionMode={ConnectionMode.Loose}
        on:selectionchange={handleSelectionChange}
        on:connect={handleConnect}
        on:wheel={handleFlowWheel}
        bind:this={flowInstance}
    >
      <Background
        variant={BackgroundVariant.Dots}
        bgColor="var(--flow-background-color)"
        patternColor="var(--flow-pattern-color)"
      />
      <MiniMap />
      <Controls />



      <div class="ui-elements-container">
          <div class="save-status" class:idle={$saveStatus === 'idle'} class:saving={$saveStatus === 'saving'} class:saved={$saveStatus === 'saved'} class:error={$saveStatus === 'error'}>
              {#if $saveStatus === 'saving'}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="spinner"><circle cx="12" cy="12" r="10"></circle></svg>
                  <span>Saving...</span>
              {:else if $saveStatus === 'saved'}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>
                  <span>Saved</span>
              {:else if $saveStatus === 'error'}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"></path><path d="M11 7h2v7h-2z"></path><path d="M11 15h2v2h-2z"></path></svg>
                  <span>Save Error</span>
              {:else}
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  <span>Auto-saved</span>
              {/if}
          </div>
          <button class="view-source-button" on:click={openSourceModal} title="View Flow Source Data">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline><line x1="12" y1="4" x2="12" y2="20"></line></svg>
              <span>View Source</span>
          </button>
      </div>

      <FlowToolbar
          position={toolbarPosition}
          on:addNode={handleAddNode}
      />
    </SvelteFlow>

    <RefreshButton
    className="reset-flow-button"
    title="Reset Flow Canvas"
    on:click={resetFlowCanvas}
>
</RefreshButton>

    <AppModal title="Svelte Flow State" show={showSourceModal} on:close={() => showSourceModal = false}>
        <div class="source-data-container">
            <pre><code class="language-json" bind:this={sourceCodeElement}>{flowSourceData}</code></pre>
        </div>
    </AppModal>
</main>

<style lang="scss">
    main {
      height: 100%;
      display: flex;
      flex-direction: column-reverse;
      z-index: 1;
      border-radius: 12px;

      &.selection-active {
        cursor: default;
        :global(.svelte-flow__pane) {
          cursor: default;
        }
        :global(.svelte-flow__node) {
          cursor: default;
        }
        :global(.svelte-flow__node[data-drag-handle]) {
            cursor: grab;
        }
        :global(.svelte-flow__handle) {
            cursor: crosshair;
        }
      }

      &.panning-active {
        cursor: grab;
        :global(.svelte-flow__pane) {
          cursor: grab;
        }
      }
    }

    .ui-elements-container {
        position: absolute;
        top: 16px;
        right: 16px;
        display: flex;
        align-items: center;
        gap: 10px;
        z-index: 1000;
    }

    .save-status {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 500;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        backdrop-filter: blur(4px);
        transition: background-color 0.3s ease, opacity 0.3s ease;
        span {
            line-height: 1;
        }
        &.idle {
            background: rgba(0, 0, 0, 0.5);
            opacity: 0.8;
        }
        &.saving {
            background: rgba(0, 0, 0, 0.7);
            .spinner {
                animation: spin 1s linear infinite;
            }
        }
        &.saved {
            background: rgba(40, 167, 69, 0.8);
        }
        &.error {
            background: rgba(220, 53, 69, 0.8);
        }
    }

    .view-source-button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 500;
        background-color: hsla(210, 8%, 35%, 0.7);
        border: 1px solid hsla(210, 8%, 45%, 0.5);
        border-radius: 8px;
        color: #e0e0e0;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0,0,0,0.15);
        backdrop-filter: blur(4px);
        transition: background-color 0.2s, box-shadow 0.2s, color 0.2s;
        svg {
            stroke: #c0c0c0;
            transition: stroke 0.2s;
        }
        &:hover {
            background-color: hsla(210, 8%, 40%, 0.8);
            color: white;
            svg {
                stroke: white;
            }
        }
        &:active {
            background-color: hsla(210, 8%, 30%, 0.8);
            box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
        }
    }

    @keyframes spin {
        100% { transform: rotate(360deg); }
    }

    :global(.svelte-flow__pane){
      border-radius: 12px;
    }

    :global(.svelte-flow__controls){
      gap: 6px;
      position: absolute;
      bottom: 0;
      left: 0;
      padding: 4px 4px 8px 0px;
    }

    :global(.svelte-flow__controls-button) {
        background-color: hsla(0, 0%, 100%, 0.8);
        border: 1px solid rgba(white, .1);
        border-radius: 8px;
        background: rgba(black, .5);
        color: white;
        width: 32px;
        height: 32px;
        backdrop-filter: blur(12px);
        box-shadow: 0px 6px 12px rgba(black, .3);
        transition: background-color 0.2s, border-color 0.2s;
        z-index: 1;
        path {
            fill: white;
        }
        &:active{
          transform: none;
        }
        &:hover {
            background: rgba(black, .2);
            color: white;
        }
    }

    :global(.svelte-flow__pane.grabbing) {
        cursor: grabbing !important;
    }

    :global(.flow-edge) {
        &.selected .svelte-flow__edge-path {
            stroke: #ff3d7f !important;
            stroke-width: 3 !important;
            animation: pulse-edge 2s infinite;
        }
        &:hover .svelte-flow__edge-path {
            stroke-width: 2.5 !important;
            stroke: #ff3d7f !important;
            cursor: pointer;
        }
    }

    :global(.svelte-flow__edge.selectable) {
        cursor: pointer;
    }

    :global(.markdown-container), :global(.result-text) {
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.3) rgba(0, 0, 0, 0.2);
        &::-webkit-scrollbar {
            width: 6px;
        }
        &::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 3px;
        }
        &::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.3);
            border-radius: 3px;
        }
        &:hover::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.4);
        }
    }

    @keyframes pulse-edge {
        0% {
            stroke-opacity: 1;
        }
        50% {
            stroke-opacity: 0.6;
        }
        100% {
            stroke-opacity: 1;
        }
    }

    :global(.svelte-flow__node) {
        transition: none !important;
    }

    .source-data-container {
        pre {
            background-color: transparent !important;
            color: inherit !important;
            padding: 15px;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
            font-size: 0.85em;
            line-height: 1.6;
            white-space: pre;
            margin: 0;
        }

        code {
            font-family: inherit;
            background-color: transparent !important;
            color: inherit !important;
            padding: 0 !important;
            text-shadow: none !important;
        }
    }

    :global(:root) {
        --flow-background-color: white;
        --flow-pattern-color: #dee2e6; // A light grey for the dot pattern
    }
 </style>