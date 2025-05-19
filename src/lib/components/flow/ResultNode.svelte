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
      {#each $nodesData as nodeData}
        {#if nodeData?.data?.text}
          <div class="markdown-container">
            <Markdown content={nodeData.data.text as string} />
          </div>
        {:else}
          <p class="placeholder-text">Node has no text data</p>
        {/if}
      {/each}
    {/if}
  </div>
</div>


<style lang="scss">

  .label {
    display: block;
    margin-bottom: 5px;
    font-weight: bold;
  }

  .flow-node{
    padding: 12px;
    border-radius: 6px;
    min-width: 150px;
    max-width: 500px;
  }

  .node{
    padding: 12px;
  }

  .markdown-container {

    max-height: 400px;
    overflow-y: scroll;

    :global(p), :global(ul), :global(ol), :global(h1), :global(h2), :global(h3), :global(h4), :global(h5), :global(h6) {
      font-size: 11px;
      font-weight: 450;
      line-height: 1.4;
      letter-spacing: -.2px;
      color: rgba(255, 255, 255, .85);
      margin-bottom: 0.5em;
    }
    :global(strong) {
      font-weight: bold;
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
      background-color: #444;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: monospace;
    }
    :global(pre) {
      background-color: #444;
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
      color: rgba(255, 255, 255, 0.7);
    }

  }

  .placeholder-text {
      font-size: 11px;
      font-weight: 450;
      line-height: 1.4;
      letter-spacing: -.2px;
      color: rgba(255, 255, 255, .5);
      font-style: italic;
  }

</style>