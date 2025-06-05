<script lang="ts">
  export let connectionStatus: 'Connecting' | 'Connected' | 'Disconnected' = 'Disconnected';
  export let imagesReceived: number = 0;

  $: statusColor = (() => {
    switch (connectionStatus) {
      case 'Connected':
        return '#4CAF50'; // Green
      case 'Connecting':
        return '#FFC107'; // Amber
      case 'Disconnected':
      default:
        return '#F44336'; // Red
    }
  })();
</script>

<div class="status-indicator" style="--status-color: {statusColor};">
  <div class="light"></div>
  <span class="status-text">
    RT: {connectionStatus}
  </span>
  <span class="images-count">
    Images: {imagesReceived}
  </span>
</div>

<style lang="scss">
  .status-indicator {
    position: fixed;
    top: 20px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    background-color: rgba(30, 30, 30, 0.85);
    backdrop-filter: blur(8px);
    color: white;
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 12px;
    font-weight: 500;
    z-index: 1000;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-family: 'Inter', sans-serif;

    .light {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background-color: var(--status-color);
      box-shadow: 0 0 5px var(--status-color);
      transition: background-color 0.3s ease;
    }

    .status-text {
      opacity: 0.9;
    }

    .images-count {
      opacity: 0.7;
      margin-left: 4px;
      padding-left: 8px;
      border-left: 1px solid rgba(255, 255, 255, 0.2);
    }
  }
</style>