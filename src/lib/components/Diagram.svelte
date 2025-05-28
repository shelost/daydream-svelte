<script lang="ts">
  // @ts-nocheck
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
  import { writable, get } from 'svelte/store';
  import { SvelteFlow, Background, Controls, MiniMap } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import {
    NODE_TYPE_DEFAULT,
    NODE_TYPE_INPUT,
    NODE_TYPE_OUTPUT,
    NODE_TYPE_DRAWING,
    EDGE_TYPE_DEFAULT,
    EDGE_TYPE_SMOOTH,
    EDGE_TYPE_STEP,
    EDGE_TYPE_STRAIGHT
  } from '$lib/types';
  import { updatePageContent, uploadThumbnail } from '$lib/supabase/pages';

  // Custom node components
  import DefaultNode from './diagram/nodes/DefaultNode.svelte';
  import InputNode from './diagram/nodes/InputNode.svelte';
  import OutputNode from './diagram/nodes/OutputNode.svelte';
  import DrawingNode from './diagram/nodes/DrawingNode.svelte';

  // Custom edge components
  import DefaultEdge from './diagram/edges/DefaultEdge.svelte';
  import SmoothEdge from './diagram/edges/SmoothEdge.svelte';
  import StepEdge from './diagram/edges/StepEdge.svelte';
  import StraightEdge from './diagram/edges/StraightEdge.svelte';

  export let pageId;
  export let content = { nodes: [], edges: [] };
  export let selectedTool = 'select';
  export let onSaving = (isSaving) => {};
  export let onSaveStatus = (status) => {};
  export let isDrawingMode = false;
  export let zoom = 1;

  // Create Svelte stores for nodes and edges
  const nodes = writable(content.nodes || []);
  const edges = writable(content.edges || []);

  const dispatch = createEventDispatcher();

  // Node and edge type mappings
  const nodeTypes = {
    [NODE_TYPE_DEFAULT]: DefaultNode,
    [NODE_TYPE_INPUT]: InputNode,
    [NODE_TYPE_OUTPUT]: OutputNode,
    [NODE_TYPE_DRAWING]: DrawingNode
  };

  const edgeTypes = {
    [EDGE_TYPE_DEFAULT]: DefaultEdge,
    [EDGE_TYPE_SMOOTH]: SmoothEdge,
    [EDGE_TYPE_STEP]: StepEdge,
    [EDGE_TYPE_STRAIGHT]: StraightEdge
  };

  // Flow instance reference
  let flowInstance;

  // Save timeout for debouncing
  let saveTimeout;
  let autoSaveInterval;
  let showControls = true;
  let showMinimap = true;

  // Check edge creation
  let connectionStatus = {
    message: '',
    success: false,
    visible: false
  };

  function showConnectionStatus(success, message) {
    connectionStatus = {
      message,
      success,
      visible: true
    };

    // Auto-hide after 3 seconds
    setTimeout(() => {
      connectionStatus = {
        ...connectionStatus,
        visible: false
      };
    }, 3000);
  }

  // Autosave functionality
  function debounceAutosave() {
    onSaving(true);
    onSaveStatus('saving');

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      try {
        await saveToDatabase();
        onSaveStatus('saved');
      } catch (error) {
        console.error('Error saving diagram:', error);
        onSaveStatus('error');
      } finally {
        onSaving(false);
      }
    }, 1000); // 1 second debounce
  }

  async function saveToDatabase() {
    const currentNodes = get(nodes);
    const currentEdges = get(edges);

    const diagramContent = {
      nodes: currentNodes,
      edges: currentEdges
    };

    // Save to database
    await updatePageContent(pageId, diagramContent);

    // Update local content reference
    content = diagramContent;

    // Generate thumbnail if flowInstance exists
    if (flowInstance && typeof flowInstance.toObject === 'function') {
      generateThumbnail();
    }

    // Update stores if needed
    if (JSON.stringify(diagramContent.nodes) !== JSON.stringify(get(nodes))) {
      nodes.set(diagramContent.nodes);
    }

    if (JSON.stringify(diagramContent.edges) !== JSON.stringify(get(edges))) {
      edges.set(diagramContent.edges);
    }
  }

  // Generate a thumbnail of the current diagram
  export async function generateThumbnail() {
    try {
      if (!flowInstance) return;

      // Wait for any pending renders
      await tick();

      // Get the flow wrapper element
      const flowWrapper = document.querySelector('.svelte-flow');
      if (!flowWrapper) return;

      // Create a temporary canvas
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Set dimensions and scale
      const bounds = flowWrapper.getBoundingClientRect();
      canvas.width = bounds.width;
      canvas.height = bounds.height;

      // Draw diagram content
      // This uses html2canvas-like approach
      const data = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}">
          <foreignObject width="100%" height="100%">
            <div xmlns="http://www.w3.org/1999/xhtml">
              ${flowWrapper.innerHTML}
            </div>
          </foreignObject>
        </svg>
      `;

      // Create an image from the SVG data
      const img = new Image();
      const blob = new Blob([data], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);

      // Draw the image to canvas when loaded
      img.onload = async () => {
        ctx.drawImage(img, 0, 0);

        // Convert canvas to blob and upload
        canvas.toBlob(async (blob) => {
          await uploadThumbnail(pageId, blob);
          URL.revokeObjectURL(url);
        }, 'image/png');
      };

      img.src = url;

    } catch (error) {
      console.error('Error generating thumbnail:', error);
    }
  }

  // Initialize nodes and edges from content
  onMount(() => {
    console.log('Diagram component mounted. Initializing with:', {
      pageId,
      contentNodes: content.nodes?.length || 0,
      contentEdges: content.edges?.length || 0,
      selectedTool
    });

    if (content) {
      if (content.nodes) {
        nodes.set(content.nodes);
        console.log('Initialized nodes store with', content.nodes.length, 'nodes');
      }

      if (content.edges) {
        edges.set(content.edges);
        console.log('Initialized edges store with', content.edges.length, 'edges');
      }
    }

    // Set up autosave interval
    autoSaveInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        debounceAutosave();
      }
    }, 60000); // Save every minute

    // Initial save status
    onSaveStatus('saved');

    // Check if SvelteFlow is properly imported
    console.log('SvelteFlow imported:', typeof SvelteFlow);

    // Check DOM for SvelteFlow container after initial render
    setTimeout(() => {
      const flowContainer = document.querySelector('.svelte-flow');
      console.log('Found SvelteFlow container:', !!flowContainer);

      if (!flowContainer) {
        console.error('SvelteFlow container not found in DOM. Check the component mounting.');
      } else {
        // Add a fallback click handler directly to the container
        // in case the SvelteFlow onPaneClick isn't working
        flowContainer.addEventListener('click', (event) => {
          // Only handle direct clicks on the pane, not on nodes
          if (event.target.closest('.svelte-flow__node')) {
            return;
          }

          console.log('Direct DOM click on flow container', {
            selectedTool,
            clientX: event.clientX,
            clientY: event.clientY
          });

          // Only process if we're in a node creation mode
          if (['node', 'input', 'output', 'drawing'].includes(selectedTool)) {
            // Get the flow wrapper's position
            const rect = flowContainer.getBoundingClientRect();
            const position = {
              x: event.clientX - rect.left,
              y: event.clientY - rect.top
            };

            console.log('Creating node via DOM event at position:', position);

            if (selectedTool === 'node') {
              addNode(NODE_TYPE_DEFAULT, position);
            } else if (selectedTool === 'input') {
              addNode(NODE_TYPE_INPUT, position);
            } else if (selectedTool === 'output') {
              addNode(NODE_TYPE_OUTPUT, position);
            } else if (selectedTool === 'drawing') {
              addNode(NODE_TYPE_DRAWING, position);
            }

            // Switch back to select tool
            selectedTool = 'select';
            dispatch('toolChange', { tool: 'select' });
          }
        });
      }
    }, 500);
  });

  onDestroy(() => {
    clearTimeout(saveTimeout);
    clearInterval(autoSaveInterval);
  });

  // Node operations
  function addNode(type, position) {
    const id = `node_${Date.now()}`;
    console.log('Creating new node:', { id, type, position });

    let newNode = {
      id,
      type: type || NODE_TYPE_DEFAULT,
      position,
      data: { label: 'New Node' }
    };

    // Add specific properties for drawing nodes
    if (type === NODE_TYPE_DRAWING) {
      newNode.data = {
        ...newNode.data,
        label: 'Drawing Node',
        width: 300,
        height: 200,
        strokes: []
      };
    }

    // Create a new array to ensure reactivity
    const currentNodes = get(nodes);
    const updatedNodes = [...currentNodes, newNode];

    console.log('Current nodes count:', currentNodes.length);
    console.log('New nodes count:', updatedNodes.length);

    // Update the store
    nodes.set(updatedNodes);

    // Verify the update happened correctly
    setTimeout(() => {
      const afterNodes = get(nodes);
      console.log('Nodes after update:', afterNodes.length);
      const found = afterNodes.find(n => n.id === id);
      console.log('Found new node in store:', !!found);
    }, 0);

    debounceAutosave();
    return newNode;
  }

  function updateNode(id, updates) {
    nodes.update(currentNodes => {
      return currentNodes.map(node => {
        if (node.id === id) {
          return { ...node, ...updates };
        }
        return node;
      });
    });
    debounceAutosave();
  }

  function deleteNode(id) {
    nodes.update(currentNodes => currentNodes.filter(node => node.id !== id));

    // Also delete connected edges
    edges.update(currentEdges =>
      currentEdges.filter(edge => edge.source !== id && edge.target !== id)
    );

    debounceAutosave();
  }

  // Edge operations
  function addEdge(source, target, type = EDGE_TYPE_DEFAULT) {
    const id = `edge_${Date.now()}`;
    const newEdge = {
      id,
      source,
      target,
      type,
      data: {}
    };

    edges.update(currentEdges => [...currentEdges, newEdge]);
    debounceAutosave();
    return newEdge;
  }

  function updateEdge(id, updates) {
    edges.update(currentEdges => {
      return currentEdges.map(edge => {
        if (edge.id === id) {
          return { ...edge, ...updates };
        }
        return edge;
      });
    });
    debounceAutosave();
  }

  function deleteEdge(id) {
    edges.update(currentEdges => currentEdges.filter(edge => edge.id !== id));
    debounceAutosave();
  }

  // Handle node drag
  function handleNodeDragStop(event) {
    const { node } = event.detail;
    updateNode(node.id, { position: node.position });
    debounceAutosave();
  }

  // Handle tool selection
  $: {
    // Update cursor based on selected tool
    if (flowInstance) {
      const container = document.querySelector('.svelte-flow');
      if (container) {
        // Reset cursor
        container.style.cursor = 'default';

        // Set cursor based on tool
        if (selectedTool === 'pan') {
          container.style.cursor = 'grab';
        } else if (selectedTool === 'node' || selectedTool === 'input' || selectedTool === 'output' || selectedTool === 'drawing') {
          container.style.cursor = 'crosshair';
        } else if (selectedTool === 'delete') {
          container.style.cursor = 'no-drop';
        }
      }
    }
  }

  // Handle mouse click for node creation
  function handlePaneClick(event) {
    // Debug logging to check if the function is being called
    console.log('handlePaneClick called', {
      selectedTool,
      eventDetail: event.detail,
      position: event.detail?.position
    });

    // Only handle clicks if we're in node creation mode
    if (selectedTool === 'node') {
      const { position } = event.detail;
      if (!position) {
        console.error('No position information in click event', event);
        return;
      }
      console.log('Adding node at position', position);
      addNode(NODE_TYPE_DEFAULT, position);
      // Switch back to select tool after placing a node
      selectedTool = 'select';
      dispatch('toolChange', { tool: 'select' });
    } else if (selectedTool === 'input') {
      const { position } = event.detail;
      if (!position) {
        console.error('No position information in click event', event);
        return;
      }
      console.log('Adding input node at position', position);
      addNode(NODE_TYPE_INPUT, position);
      // Switch back to select tool after placing a node
      selectedTool = 'select';
      dispatch('toolChange', { tool: 'select' });
    } else if (selectedTool === 'output') {
      const { position } = event.detail;
      if (!position) {
        console.error('No position information in click event', event);
        return;
      }
      console.log('Adding output node at position', position);
      addNode(NODE_TYPE_OUTPUT, position);
      // Switch back to select tool after placing a node
      selectedTool = 'select';
      dispatch('toolChange', { tool: 'select' });
    } else if (selectedTool === 'drawing') {
      const { position } = event.detail;
      if (!position) {
        console.error('No position information in click event', event);
        return;
      }
      console.log('Adding drawing node at position', position);
      addNode(NODE_TYPE_DRAWING, position);
      // Switch back to select tool after placing a node
      selectedTool = 'select';
      dispatch('toolChange', { tool: 'select' });
    }
  }

  function handleSelectionChange(event) {
    const { nodes: selectedNodes, edges: selectedEdges } = event.detail;

    // If delete tool is active and we have a selection, delete the selected elements
    if (selectedTool === 'delete' && (selectedNodes.length > 0 || selectedEdges.length > 0)) {
      // Delete selected nodes
      selectedNodes.forEach(node => {
        deleteNode(node.id);
      });

      // Delete selected edges
      selectedEdges.forEach(edge => {
        deleteEdge(edge.id);
      });

      // After deleting, switch back to select tool
      selectedTool = 'select';
      dispatch('toolChange', { tool: 'select' });
      return;
    }

    dispatch('selectionChange', {
      type: 'diagram',
      objects: [...selectedNodes, ...selectedEdges],
      objectsCount: selectedNodes.length + selectedEdges.length
    });
  }

  // Handle new edge connection
  function handleConnect(event) {
    console.log('Connection event received:', event.detail);

    const { source, target, sourceHandle, targetHandle } = event.detail.connection;

    if (source && target) {
      console.log('Creating edge from', source, 'to', target);

      // If the edge tool is active, use the selected edge type
      const edgeType = selectedTool === 'edge' ? EDGE_TYPE_STRAIGHT : EDGE_TYPE_DEFAULT;

      // Create the edge directly with explicit parameters
      const newEdge = {
        id: `edge_${Date.now()}`,
        source,
        target,
        sourceHandle,
        targetHandle,
        type: edgeType,
        data: {}
      };

      // Update the edges store with the new edge
      const currentEdges = get(edges);
      console.log('Current edges count:', currentEdges.length);

      edges.set([...currentEdges, newEdge]);

      // Log confirmation
      console.log('Edge created:', newEdge);
      console.log('New edges count:', get(edges).length);

      // Switch back to select tool after creating an edge
      if (selectedTool === 'edge') {
        selectedTool = 'select';
        dispatch('toolChange', { tool: 'select' });
      }

      // Trigger save
      debounceAutosave();

      // Show connection status
      showConnectionStatus(true, 'Edge created successfully');
    } else {
      console.error('Invalid connection - missing source or target:', event.detail);

      // Show connection status
      showConnectionStatus(false, 'Failed to create edge');
    }
  }

  // Handle flow initialized
  function handleInit(event) {
    console.log('SvelteFlow initialized:', event.detail);
    flowInstance = event.detail;

    // Verify the flowInstance has expected methods
    if (flowInstance) {
      console.log('Flow instance methods:', {
        hasZoomIn: typeof flowInstance.zoomIn === 'function',
        hasZoomOut: typeof flowInstance.zoomOut === 'function',
        hasFitView: typeof flowInstance.fitView === 'function',
        hasGetSelectedNodes: typeof flowInstance.getSelectedNodes === 'function'
      });
    }
  }

  // Handle keyboard shortcuts
  function handleKeyDown(event) {
    // Skip if used in an input field
    if (event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement) {
      return;
    }

    // Delete key (Delete or Backspace)
    if ((event.key === 'Delete' || event.key === 'Backspace') && flowInstance) {
      const { getSelectedNodes, getSelectedEdges } = flowInstance;

      if (typeof getSelectedNodes === 'function' && typeof getSelectedEdges === 'function') {
        const selectedNodes = getSelectedNodes();
        const selectedEdges = getSelectedEdges();

        // Delete selected nodes
        selectedNodes.forEach(node => {
          deleteNode(node.id);
        });

        // Delete selected edges
        selectedEdges.forEach(edge => {
          deleteEdge(edge.id);
        });

        // If anything was deleted, prevent default browser behavior
        if (selectedNodes.length > 0 || selectedEdges.length > 0) {
          event.preventDefault();
        }
      }
    }

    // Ctrl+A to select all
    if ((event.ctrlKey || event.metaKey) && event.key === 'a' && flowInstance) {
      const { selectAll } = flowInstance;

      if (typeof selectAll === 'function') {
        event.preventDefault();
        selectAll();
      }
    }

    // Undo/Redo (not implemented here but could be added)
    // if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
    //   event.preventDefault();
    //   // Implement undo
    // }

    // // Redo
    // if ((event.ctrlKey || event.metaKey) && (
    //     (event.shiftKey && event.key === 'z') ||
    //     (!event.shiftKey && event.key === 'y'))) {
    //   event.preventDefault();
    //   // Implement redo
    // }
  }

  // Zoom control functions
  export function zoomIn() {
    if (flowInstance) {
      flowInstance.zoomIn();
      zoom = flowInstance.getZoom();
    }
  }

  export function zoomOut() {
    if (flowInstance) {
      flowInstance.zoomOut();
      zoom = flowInstance.getZoom();
    }
  }

  export function resetZoom() {
    if (flowInstance) {
      flowInstance.fitView();
      zoom = flowInstance.getZoom();
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="diagram-container">
  <!-- Debug tool indicator -->
  <div class="debug-tool-indicator">
    Current tool: <strong>{selectedTool}</strong>
  </div>

  <!-- Connection status indicator -->
  {#if connectionStatus.visible}
    <div class="connection-status {connectionStatus.success ? 'success' : 'error'}">
      {connectionStatus.message}
    </div>
  {/if}

  <SvelteFlow
    {nodes}
    {edges}
    {nodeTypes}
    {edgeTypes}
    fitView
    snapToGrid
    selectionOnDrag
    panOnDrag={selectedTool === 'pan'}
    selectionMode={selectedTool === 'select' ? 'partial' : 'disabled'}
    deleteKeyCode={['Backspace', 'Delete']}
    multiSelectionKeyCode={['Control', 'Meta']}
    connectionLineStyle="stroke: #ff0072; stroke-width: 2;"
    connectionMode="loose"
    defaultEdgeOptions={{
      type: EDGE_TYPE_DEFAULT,
      style: 'stroke-width: 2;'
    }}
    onNodesChange={(e) => {
      console.log('Nodes changed:', e.detail);
      nodes.set(e.detail);
      debounceAutosave();
    }}
    onEdgesChange={(e) => {
      console.log('Edges changed:', e.detail);
      edges.set(e.detail);
      debounceAutosave();
    }}
    onNodeDragStop={handleNodeDragStop}
    onConnect={handleConnect}
    onInit={handleInit}
    onPaneClick={handlePaneClick}
    onSelectionChange={handleSelectionChange}
    bindInstance={true}
  >
    <Background />

    {#if showControls}
      <Controls />
    {/if}

    {#if showMinimap}
      <MiniMap
        width={200}
        height={120}
        nodeStrokeWidth={3}
        nodeColor="#d3d3d3"
      />
    {/if}
  </SvelteFlow>
</div>

<style lang="scss">
  :global(.svelte-flow .svelte-flow__node) {
    background: white;
    border-radius: 12px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    padding: 8px;
    border: none;
  }

  :global(.svelte-flow .svelte-flow__edge-path) {
    stroke: #555;
    stroke-width: 2;
  }

  :global(.input-node) {

    width: 100%;
  }

    :global(.svelte-flow .node){
        min-width: 20px;
    }


  :global(.svelte-flow .svelte-flow__handle) {
    width: 8px;
    height: 8px;
    background: #1a192b;
    border: 2px solid white;
  }

  :global(.svelte-flow .svelte-flow__handle:hover) {
    background-color: #ff0072;
    transform: scale(1.2);
  }

  :global(.svelte-flow .svelte-flow__handle.connecting) {
    background-color: #ff0072;
  }

  :global(.svelte-flow .svelte-flow__handle.connectingTarget) {
    background-color: #52c41a;
  }

  :global(.svelte-flow .svelte-flow__connection-path) {
    stroke: #ff0072;
    stroke-width: 2;
  }

  :global(.svelte-flow .svelte-flow__edge.selected .svelte-flow__edge-path) {
    stroke: #ff4d88;
    stroke-width: 3;
  }

  :global(.svelte-flow .svelte-flow__node.selected) {
    box-shadow: 0 0 0 2px #ff4d88;
  }

  .debug-tool-indicator {
    position: absolute;
    top: 10px;
    left: 10px;
    background-color: rgba(255, 255, 255, 0.8);
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 10;
    pointer-events: none;
  }

  .connection-status {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 500;
    z-index: 20;
    animation: fadeIn 0.3s ease-in-out;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  }

  .connection-status.success {
    background-color: #f6ffed;
    color: #52c41a;
    border: 1px solid #b7eb8f;
  }

  .connection-status.error {
    background-color: #fff2f0;
    color: #ff4d4f;
    border: 1px solid #ffccc7;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translate(-50%, 10px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  .diagram-container {
    width: 100%;
    height: 100%;
    position: relative;
  }
</style>