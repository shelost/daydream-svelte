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

    import { fly, scale, fade } from 'svelte/transition';
    import { onMount, onDestroy } from 'svelte';
    import { beforeNavigate } from '$app/navigation';

    import TextNode from '$lib/components/flow/TextNode.svelte';
    import UppercaseNode from '$lib/components/flow/UppercaseNode.svelte';
    import ResultNode from '$lib/components/flow/ResultNode.svelte';
    import DrawingNode from '$lib/components/flow/DrawingNode.svelte';
    import ImageNode from '$lib/components/flow/ImageNode.svelte';
    import GradientEdge from '$lib/components/flow/GradientEdge.svelte';
    import GPTNode from '$lib/components/flow/GPTNode.svelte';
    import FlowToolbar from '$lib/components/flow/FlowToolbar.svelte';
    import AppModal from '$lib/components/shared/AppModal.svelte';

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
    } as any;  // Type casting is needed due to TypeScript edge component compatibility

    const FLOW_NODES_STORAGE_KEY = 'flowPageNodesData_v1';
    const FLOW_EDGES_STORAGE_KEY = 'flowPageEdgesData_v1';

    // Save status indicator
    const saveStatus = writable('idle'); // 'idle', 'saving', 'saved', 'error'
    let saveDebounceTimeout: ReturnType<typeof setTimeout>;
    const SAVE_DEBOUNCE_MS = 1000; // Debounce time in milliseconds

    let enableSnapToGrid = false;
    const gridSnapValues: [number, number] = [15, 15];

    // Toolbar position state
    let toolbarPosition = { x: 10, y: 60 };

    // Flow instance - will be set when the component is mounted
    let flowInstance;

    // Modal state
    let showSourceModal = false;
    let flowSourceData = '';

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

    // Set up reactivity for autosaving when nodes or edges change
    $: {
        if (typeof window !== 'undefined' && ($nodes || $edges)) {
            triggerAutoSave();
        }
    }

    function triggerAutoSave() {
        // Cancel any pending save operations
        if (saveDebounceTimeout) {
            clearTimeout(saveDebounceTimeout);
        }

        // Set status to saving
        $saveStatus = 'saving';

        // Debounce the save operation to prevent excessive saves during rapid changes
        saveDebounceTimeout = setTimeout(() => {
            saveFlowState();
        }, SAVE_DEBOUNCE_MS);
    }

    const isSpacebarPressed = writable(false);

    function handleKeyDown(event: KeyboardEvent) {
        // Don't handle spacebar if a textarea is focused
        if (event.code === 'Space' && !(event.target instanceof HTMLTextAreaElement)) {
            event.preventDefault();
            isSpacebarPressed.set(true);
        }

        // Handle Delete key for selected edges
        if ((event.key === 'Backspace' || event.key === 'Delete') && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) {
            // Find any edges with the 'selected' class
            const selectedEdgeIds = $edges
                .filter(edge => edge.class && edge.class.includes('selected'))
                .map(edge => edge.id);

            if (selectedEdgeIds.length > 0) {
                // Remove the selected edges
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

    // Flow wheel event handling - check if we should let the scroll event go through
    function handleFlowWheel(e: CustomEvent<WheelEvent>) {
        // Extract the original wheel event
        const event = e.detail as WheelEvent;

        // Check if we're over a scrollable container that should handle the event
        const scrollableSelectors = ['.markdown-container', '.result-text'];
        const target = event.target as HTMLElement;

        // See if the event target is or is inside a scrollable component
        for (const selector of scrollableSelectors) {
            const scrollContainer = target.closest(selector);
            if (scrollContainer) {
                // The wheel event is happening over a scrollable container
                // Individual nodes should handle stopping propagation as needed
                return;
            }
        }

        // Default flow behavior (zoom) can proceed for non-scrollable areas
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

    // Function to add a new node from the toolbar
    function handleAddNode(event) {
        const { type, data } = event.detail;
        const id = `${type}-${Date.now()}`;

        // Default position for new nodes
        let position = { x: 0, y: 0 };

        // If flowInstance is available, use the viewport center
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

        // Add the new node
        $nodes = [...$nodes, newNode];

        console.log(`Added new ${type} node with id: ${id}`);
    }

    // Handle edge selection changes
    function handleSelectionChange({ detail }) {
        // This is called when node or edge selection changes
        const { edges: selectedEdges, nodes: selectedNodes } = detail;

        // Update the edges with the selected state
        if (selectedEdges && selectedEdges.length > 0) {
            $edges = $edges.map(edge => {
                const isSelected = selectedEdges.some(selectedEdge => selectedEdge.id === edge.id);
                return {
                    ...edge,
                    class: isSelected ? 'flow-edge selected' : 'flow-edge'
                };
            });
        } else {
            // Reset selection if nothing is selected
            $edges = $edges.map(edge => ({
                ...edge,
                class: 'flow-edge'
            }));
        }
    }

    // Handle edge connections
    function handleConnect(event) {
        const { source, target } = event.detail;
        const id = `e${source}-${target}`;

        // Check if this connection already exists
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
        const currentNodes = $nodes; // Get the current state from the store
        const currentEdges = $edges; // Get the current state from the store

        const combinedData = {
            nodes: currentNodes,
            edges: currentEdges.map(edge => ({ // Ensure edges are in the format they are saved
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: 'gradient',
                animated: true,
                selectable: true,
                class: edge.class || 'flow-edge' // Preserve class if it exists
            }))
        };

        flowSourceData = JSON.stringify(combinedData, null, 2); // Pretty print with 2 spaces
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

        // Clear any pending timeouts
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
        <svg style="width:0;height:0;position:absolute;">
            <defs>
                <linearGradient id="edge-flow-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" style="stop-color:#505050;stop-opacity:1" />
                    <stop offset="50%" style="stop-color:#5c5c5c;stop-opacity:1" />
                    <stop offset="100%" style="stop-color:#ffffff;stop-opacity:1" />
                </linearGradient>
            </defs>
        </svg>

      <Background variant={BackgroundVariant.Dots} />
      <MiniMap />
      <Controls />

      <!-- Reset button -->
      <button class="reset-flow-button" on:click={resetFlowCanvas} title="Reset Flow Canvas">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          <span>Reset</span>
      </button>

      <!-- UI Elements Container -->
      <div class="ui-elements-container">
          <!-- Save status indicator -->
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
          <!-- View Source button -->
          <button class="view-source-button" on:click={openSourceModal} title="View Flow Source Data">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline><line x1="12" y1="4" x2="12" y2="20"></line></svg>
              <span>View Source</span>
          </button>
      </div>

      <!-- Add the floating toolbar -->
      <FlowToolbar
          position={toolbarPosition}
          on:addNode={handleAddNode}
      />
    </SvelteFlow>

    <!-- Source Data Modal -->
    <AppModal title="Svelte Flow State" show={showSourceModal} on:close={() => showSourceModal = false}>
        <div class="source-data-container">
            <pre><code>{flowSourceData}</code></pre>
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
        cursor: default; /* Default arrow for the main container in selection mode */
        :global(.svelte-flow__pane) {
          cursor: default; /* Default arrow for the flow pane itself */
        }
        :global(.svelte-flow__node) {
          cursor: default; /* Default arrow for nodes */
        }
        /* Allow specific drag handles to still show a grab cursor */
        :global(.svelte-flow__node[data-drag-handle]) {
            cursor: grab;
        }
        :global(.svelte-flow__handle) {
            cursor: crosshair; /* Or whatever is appropriate for handles */
        }
      }

      &.panning-active {
        cursor: grab; /* Grab cursor for the main container in panning mode */
        :global(.svelte-flow__pane) {
          cursor: grab; /* Grab cursor for the flow pane */
        }
      }
    }

    .reset-flow-button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        font-size: 12px;
        font-weight: 500;
        background-color: hsla(0, 0%, 100%, 0.8);
        border: 1px solid #e0e0e0;
        border-radius: 6px;
        color: #333;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        transition: background-color 0.2s, box-shadow 0.2s;
        z-index: 10 !important;

        width: fit-content;
        height: fit-content;

        position: absolute;
        top: 8px;
        left: 8px;

        svg {
            stroke: #555;
        }

        &:hover {
            background-color: white;
            border-color: #ccc;
            box-shadow: 0 2px 5px rgba(0,0,0,0.15);
        }

        &:active {
            background-color: #f5f5f5;
            box-shadow: inset 0 1px 2px rgba(0,0,0,0.1);
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

    /* Save status indicator styling */
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
        background-color: hsla(210, 8%, 35%, 0.7); // Slightly different background for distinction
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

    /* Enhancing styles for scrollable areas */
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

    /* Fix for node dragging lag */
    :global(.svelte-flow__node) {
        transition: none !important;
    }

    .source-data-container {
        pre {
            background-color: #1e1e1e; // Darker background for code
            color: #d4d4d4; // Light text for code
            padding: 15px;
            border-radius: 8px;
            overflow-x: auto; // Horizontal scroll for long lines
            font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace;
            font-size: 0.85em;
            line-height: 1.6;
            white-space: pre; // Keep whitespace as is
        }

        code {
            font-family: inherit;
        }
    }
 </style>