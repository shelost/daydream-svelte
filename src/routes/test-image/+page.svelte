<script lang="ts">
  import { onMount } from 'svelte';

  let isLoading = false;
  let errorMessage: string | null = null;
  let imageUrl: string | null = null;
  let responseDetails: string | null = null;

  async function testDirectEndpoint() {
    isLoading = true;
    errorMessage = null;
    imageUrl = null;
    responseDetails = null;

    try {
      const response = await fetch('/api/ai/test-image-generation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}) // Empty request since our test endpoint doesn't need input
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to test image generation');
      }

      const result = await response.json();
      console.log('Test response:', result);

      if (result.success) {
        // Display the image and response details
        imageUrl = result.imageUrl || result.url;
        responseDetails = JSON.stringify(result.responseStructure, null, 2);
      } else {
        errorMessage = result.error || 'Unknown error';
      }
    } catch (error) {
      console.error('Error testing image generation:', error);
      errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    } finally {
      isLoading = false;
    }
  }

  async function testMainEndpoint() {
    isLoading = true;
    errorMessage = null;
    imageUrl = null;
    responseDetails = null;

    try {
      // Create a simple drawing data object
      const drawingContent = {
        strokes: [],
        width: 512,
        height: 512
      };

      // Generate a simple blank image data URL (white square)
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 512, 512);

        // Draw a simple house
        ctx.fillStyle = 'red';
        ctx.beginPath();
        ctx.moveTo(200, 300);
        ctx.lineTo(300, 200);
        ctx.lineTo(400, 300);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'brown';
        ctx.fillRect(230, 300, 140, 100);

        // Draw a sun
        ctx.fillStyle = 'yellow';
        ctx.beginPath();
        ctx.arc(100, 100, 40, 0, Math.PI * 2);
        ctx.fill();
      }

      const imageData = canvas.toDataURL('image/png');

      const response = await fetch('/api/ai/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          drawingContent,
          imageData,
          textAnalysis: "A simple drawing of a house with a sun.",
          additionalContext: "Simple test drawing",
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate image');
      }

      const result = await response.json();
      console.log('Main endpoint response:', result);

      // Check for either imageUrl or url property
      if (result.imageUrl || result.url) {
        imageUrl = result.imageUrl || result.url;
        responseDetails = JSON.stringify(result, null, 2);
      } else {
        errorMessage = 'No image URL in response: ' + JSON.stringify(result);
      }
    } catch (error) {
      console.error('Error using main image generation endpoint:', error);
      errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    } finally {
      isLoading = false;
    }
  }
</script>

<main class="container">
  <h1>Image Generation API Test</h1>

  <div class="button-group">
    <button on:click={testDirectEndpoint} disabled={isLoading}>
      {isLoading ? 'Testing...' : 'Test Direct Endpoint'}
    </button>

    <button on:click={testMainEndpoint} disabled={isLoading}>
      {isLoading ? 'Testing...' : 'Test Main Endpoint'}
    </button>
  </div>

  {#if errorMessage}
    <div class="error">
      <h3>Error:</h3>
      <p>{errorMessage}</p>
    </div>
  {/if}

  {#if imageUrl}
    <div class="result">
      <h3>Generated Image:</h3>
      <img src={imageUrl} alt="Generated test image" width="512" height="512" />
    </div>
  {/if}

  {#if responseDetails}
    <div class="details">
      <h3>Response Details:</h3>
      <pre>{responseDetails}</pre>
    </div>
  {/if}
</main>

<style>
  .container {
    max-width: 1000px;
    margin: 0 auto;
    padding: 2rem;
  }

  .button-group {
    display: flex;
    gap: 1rem;
    margin: 2rem 0;
  }

  button {
    padding: 0.75rem 1.5rem;
    background-color: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 1rem;
  }

  button:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
  }

  .error {
    margin: 2rem 0;
    padding: 1rem;
    background-color: #ffebee;
    border-left: 4px solid #f44336;
  }

  .result {
    margin: 2rem 0;
  }

  .details {
    margin: 2rem 0;
  }

  pre {
    background-color: #f5f5f5;
    padding: 1rem;
    overflow-x: auto;
    border-radius: 4px;
  }
</style>