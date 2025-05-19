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
      type DefaultEdgeOptions
    } from '@xyflow/svelte';
    import '@xyflow/svelte/dist/style.css';

    import { fly, scale } from 'svelte/transition';
    import { onMount, onDestroy } from 'svelte';
    import { beforeNavigate } from '$app/navigation';

    import TextNode from '$lib/components/flow/TextNode.svelte';
    import UppercaseNode from '$lib/components/flow/UppercaseNode.svelte';
    import ResultNode from '$lib/components/flow/ResultNode.svelte';
    import DrawingNode from '$lib/components/flow/DrawingNode.svelte';
    import ImageNode from '$lib/components/flow/ImageNode.svelte';
    import GradientEdge from '$lib/components/flow/GradientEdge.svelte';
    import GPTNode from '$lib/components/flow/GPTNode.svelte';

    const nodeTypes: NodeTypes = {
      text: TextNode,
      uppercase: UppercaseNode,
      result: ResultNode,
      drawing: DrawingNode,
      image: ImageNode,
      gpt: GPTNode
    };

    const edgeTypes = {
        gradient: GradientEdge,
    };

    const FLOW_NODES_STORAGE_KEY = 'flowPageNodesData_v1';
    const FLOW_EDGES_STORAGE_KEY = 'flowPageEdgesData_v1';

    let enableSnapToGrid = false;
    const gridSnapValues: [number, number] = [15, 15];

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
        type: 'gradient'
      },
      {
        id: 'e1a-3',
        source: '1a',
        target: '3',
        animated: true,
        type: 'gradient'
      },
      {
        id: 'e2-3',
        source: '2',
        target: '3',
        animated: true,
        type: 'gradient'
      },
      {
        id: 'e-img-gpt',
        source: 'image-1',
        target: 'gpt-1',
        animated: true,
        type: 'gradient'
      },
      {
        id: 'e-bo-gpt',
        source: 'bo-text',
        target: 'gpt-1',
        animated: true,
        type: 'gradient'
      },
      {
        id: 'e-gpt-result',
        source: 'gpt-1',
        target: 'result-poem',
        animated: true,
        type: 'gradient'
      }
    ];

    const defaultEdgeOptions: DefaultEdgeOptions = {
        animated: true,
        type: 'gradient'
    };

    let initialNodes = defaultNodes;
    let initialEdges = defaultEdges.map(edge => ({ ...edge, type: 'gradient', animated: true, markerEnd: undefined }));

    if (typeof window !== 'undefined') {
        try {
            const savedNodesJSON = sessionStorage.getItem(FLOW_NODES_STORAGE_KEY);
            if (savedNodesJSON) {
                const parsedNodes = JSON.parse(savedNodesJSON);
                if (Array.isArray(parsedNodes)) {
                    initialNodes = parsedNodes;
                }
            }
        } catch (e) {
            console.error("Error loading nodes from session storage:", e);
        }

        try {
            const savedEdgesJSON = sessionStorage.getItem(FLOW_EDGES_STORAGE_KEY);
            if (savedEdgesJSON) {
                const parsedEdges = JSON.parse(savedEdgesJSON);
                if (Array.isArray(parsedEdges)) {
                    initialEdges = parsedEdges.map(edge => ({
                        ...edge,
                        type: 'gradient',
                        animated: true,
                        markerEnd: undefined
                    }));
                } else {
                    initialEdges = defaultEdges.map(edge => ({ ...edge, type: 'gradient', animated: true, markerEnd: undefined }));
                }
            } else {
                 // initialEdges already set to styled defaultEdges if no saved data
            }
        } catch (e) {
            console.error("Error loading edges from session storage:", e);
            initialEdges = defaultEdges.map(edge => ({ ...edge, type: 'gradient', animated: true, markerEnd: undefined }));
        }
    } else {
         initialEdges = defaultEdges.map(edge => ({ ...edge, type: 'gradient', animated: true, markerEnd: undefined }));
    }

    const nodes = writable<Node[]>(initialNodes);
    const edges = writable<Edge[]>(initialEdges);

    const isSpacebarPressed = writable(false);

    function handleKeyDown(event: KeyboardEvent) {
        // Don't handle spacebar if a textarea is focused
        if (event.code === 'Space' && !(event.target instanceof HTMLTextAreaElement)) {
            event.preventDefault();
            isSpacebarPressed.set(true);
        }
    }

    function handleKeyUp(event: KeyboardEvent) {
        if (event.code === 'Space') {
            isSpacebarPressed.set(false);
        }
    }

    function saveFlowState() {
        if (typeof window !== 'undefined') {
            try {
                sessionStorage.setItem(FLOW_NODES_STORAGE_KEY, JSON.stringify($nodes));
                const edgesToSave = $edges.map(edge => ({
                    ...edge,
                    type: 'gradient',
                    animated: true,
                    markerEnd: undefined
                }));
                sessionStorage.setItem(FLOW_EDGES_STORAGE_KEY, JSON.stringify(edgesToSave));
            } catch (e) {
                console.error("Error saving Svelte Flow state to session storage:", e);
            }
        }
    }

    function resetFlowCanvas() {
        if (typeof window !== 'undefined') {
            sessionStorage.removeItem(FLOW_NODES_STORAGE_KEY);
            sessionStorage.removeItem(FLOW_EDGES_STORAGE_KEY);
            $nodes = JSON.parse(JSON.stringify(defaultNodes));
            $edges = JSON.parse(JSON.stringify(defaultEdges.map(edge => ({
                ...edge,
                type: 'gradient',
                animated: true,
                markerEnd: undefined
            }))));
        }
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
    });

    beforeNavigate(() => {
        saveFlowState();
    });

  </script>

<main in:scale={{start: .97, opacity: .8}} style="cursor: {$isSpacebarPressed ? 'grab' : 'default'};">
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
      <div class="flow-controls-wrapper">
        <Controls />
        <button class="reset-flow-button" on:click={resetFlowCanvas} title="Reset Flow Canvas">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            <span>Reset</span>
        </button>
      </div>
      <Background variant={BackgroundVariant.Dots} />
      <MiniMap />
    </SvelteFlow>
</main>

<style lang="scss">
    main {
      height: 100%;
      display: flex;
      flex-direction: column-reverse;
      z-index: 1;
      border-radius: 12px;
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
        z-index: 3;

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
            background: rgba(black, .6);
            color: white;
        }
    }

    :global(.svelte-flow__pane.grabbing) {
        cursor: grabbing !important;
    }
 </style>