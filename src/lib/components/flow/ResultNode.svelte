<script lang="ts">
    import {
      Handle,
      Position,
      useNodeConnections,
      useNodesData,
      type NodeProps
    } from '@xyflow/svelte';
    import { Markdown } from 'svelte-rune-markdown';

    type $$Props = NodeProps;

    export let id: $$Props['id'];
    // export let data: $$Props['data']; // data prop is implicitly available

    const connections = useNodeConnections({
      id,
      handleType: 'target'
    });

    $: nodesData = useNodesData($connections.map((connection) => connection.source));
</script>


<div class="flow-node">
  <label> Result </label>
  <Handle type="target" position={Position.Left} />
  <div class="node">
    {#if $nodesData.length === 0}
      <p class="placeholder-text">no connected nodes</p>
    {:else}
      {#each $nodesData as nodeItem, i (nodeItem?.id || i)}
        {#if nodeItem?.data?.imageUrl}
          <div class="image-container">
            <img src={nodeItem.data.imageUrl as string} alt="Result Image" class="result-image-display" />
          </div>
        {:else if nodeItem?.data?.text}
          <div class="markdown-container">
            <Markdown content={String(nodeItem.data.text)} />
          </div>
        {:else}
          <p class="placeholder-text">Node <span class="node-id-tag">{nodeItem?.id || 'N/A'}</span> has no displayable text or image data.</p>
        {/if}
      {/each}
    {/if}
  </div>
</div>


<style lang="scss">

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

  .image-container {
    width: 100%;
    margin-bottom: 8px; /* Space below image if multiple items */
  }

  .result-image-display {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    background-color: rgba(0,0,0,0.2); /* Placeholder while loading or for transparent images */
  }

  .markdown-container {
    width: 100%;
    margin-bottom: 8px; /* Space below text if multiple items */
    /* max-height: 400px; /* Already handled by .node-content */
    /* overflow-y: auto; */

    :global(p), :global(ul), :global(ol), :global(h5), :global(h6) {
      font-size: 10px;
      font-weight: 450;
      line-height: 1.5;
      letter-spacing: -.2px;
      color: rgba(white, .75);
      margin: 12px 0;
    }
    :global(h1){
      font-family: "ivypresto-headline", serif;
      font-size: 24px;
      font-weight: 500;
      letter-spacing: 0px;
      line-height: 1.1;
    }
    :global(h2){
      font-family: "ivypresto-headline", serif;
      font-size: 16px;
      font-weight: 500;
      letter-spacing: 0.2px;
      line-height: 1.1;
    }
    :global(h3){
      font-size: 14px;
    }
    :global(h4){
      font-size: 12px;
    }

    :global(strong) {
      font-weight: bold;
      color: white;
    }
    :global(em) {
      font-style: italic;
    }
    :global(table) {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1em;
    }
    :global(th), :global(td) {
      border: 1px solid rgba(255, 255, 255, 0.3);
      padding: 6px 8px;
      text-align: left;
    }
    :global(th) {
      background-color: rgba(255, 255, 255, 0.1);
    }
    :global(code) {
      background-color: #333; /* Darker code block */
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: monospace;
      font-size: 10px;
    }
    :global(pre) {
      background-color: #333; /* Darker pre block */
      padding: 0.5em;
      border-radius: 3px;
      overflow-x: auto;
    }
    :global(pre code) {
      padding: 0;
      background-color: transparent;
    }
    :global(blockquote) {
      border-left: 3px solid rgba(255, 255, 255, 0.5);
      padding-left: 1em;
      margin-left: 0;
      color: rgba(255, 255, 255, 0.75);
    }
  }

  .placeholder-text {
      font-size: 11px;
      font-weight: 450;
      line-height: 1.4;
      letter-spacing: -.2px;
      color: rgba(255, 255, 255, .6);
      font-style: italic;
  }

  .node-id-tag {
    font-style: normal;
    background-color: rgba(255,255,255,0.1);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 10px;
  }

</style>