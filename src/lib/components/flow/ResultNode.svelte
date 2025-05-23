<script lang="ts">
    // @ts-nocheck
    import {
      Handle,
      Position,
      useNodeConnections,
      useNodesData,
      useSvelteFlow,
      type NodeProps
    } from '@xyflow/svelte';
    import { Markdown } from 'svelte-rune-markdown';
    import { onMount } from 'svelte';

    import TextNode from './TextNode.svelte';
    import ImageNode from './ImageNode.svelte';

    type $$Props = NodeProps;

    export let id: $$Props['id'];
    export let data: $$Props['data'] = {}; // Explicitly import data with default

    const { updateNodeData } = useSvelteFlow();

    // Track input connections
    const incomingConnections = useNodeConnections({
      id,
      handleType: 'target'
    });

    // Track output connections
    const outgoingConnections = useNodeConnections({
      id,
      handleType: 'source'
    });

    $: hasOutgoingConnections = $outgoingConnections && $outgoingConnections.length > 0;
    $: nodesData = useNodesData($incomingConnections.map((connection) => connection.source));

    // Process incoming data and make it available for output and child nodes
    $: {
      if ($nodesData.length > 0) {
        let combinedText = '';
        let imageUrl = '';

        // Process incoming node data
        $nodesData.forEach(nodeItem => {
          if (nodeItem?.data?.imageUrl) {
            imageUrl = nodeItem.data.imageUrl as string;
          }
          if (nodeItem?.data?.text) {
            combinedText += String(nodeItem.data.text) + "\n\n";
          }
        });

        // Update this node's data for downstream nodes
        if (combinedText.trim() || imageUrl) {
          updateNodeData(id, {
            resultText: combinedText.trim() || undefined,
            resultImageUrl: imageUrl || undefined
          });
        }
      }
    }

    // Prepare child items list
    $: childItems = $nodesData.map((nodeItem) => {
      if (nodeItem?.data?.imageUrl) {
        return {
          type: 'image',
          src: nodeItem.data.imageUrl as string,
          label: nodeItem.data.label || 'Image'
        } as const;
      }
      if (nodeItem?.data?.text) {
        return {
          type: 'text',
          content: String(nodeItem.data.text)
        } as const;
      }
      return null;
    }).filter(Boolean);

    $: hasContent = childItems.length > 0;

    // Helper to generate stable ids for child nodes based on parent id and index
    function childId(index: number, kind: string) {
      return `${id}-${kind}-${index}`;
    }
</script>


<div class="flow-node">
  <label> Result </label>
  <Handle type="target" position={Position.Left} id="input" />
  <Handle type="source" position={Position.Right} id="output" />
  <div class="result">
    {#if childItems.length === 0}
      <p class="placeholder-text">no connected nodes</p>
    {:else}
      <div class="child-container">
        {#each childItems as item, i (i)}
          {#if item.type === 'image'}
            <ImageNode id={childId(i, 'img')} data={{ imageUrl: item.src, label: item.label }} />
          {:else if item.type === 'text'}
            <TextNode id={childId(i, 'txt')} data={{ text: item.content }} />
          {/if}
        {/each}
      </div>
    {/if}

    {#if hasContent}
      <div class="output-indicator">
        <span class="material-symbols-outlined">east</span>
        <span class="indicator-text">
          {#if hasOutgoingConnections}
            Feeding data to {$outgoingConnections.length} node{$outgoingConnections.length !== 1 ? 's' : ''}
          {:else}
            Output available
          {/if}
        </span>
      </div>
    {/if}
  </div>
</div>


<style lang="scss">
  .flow-node {
    position: relative;
    min-width: 200px;
    width: 400px; /* Fixed width for consistency */
    padding: 20px;
  }

  .node{
    max-width: 500px;
    padding: 20px;
  }

  label { /* Consistent label styling */
    display: block;
    margin-bottom: 8px;
    font-weight: bold;
    font-size: 13px;
    color: #eee;
  }

  .result{
    //border: 1px solid rgba(white, .5);
    background: rgba(white, .02);
    box-shadow: -8px 24px 36px rgba(black, .1);
    backdrop-filter: blur(20px);
    padding: 24px;
    border-radius: 12px;
  }

  .child-container{
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 4px;
  }

  .placeholder-text {
      font-size: 11px;
      font-weight: 450;
      line-height: 1.4;
      letter-spacing: -.2px;
      color: rgba(255, 255, 255, .6);
      font-style: italic;
  }

  .output-indicator {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 10px;
    padding: 4px 8px;
    background-color: rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    width: fit-content;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.7);
    border-right: 2px solid rgba(255, 255, 255, 0.2);
  }

  .indicator-text {
    font-size: 9px;
    letter-spacing: 0.2px;
  }
</style>