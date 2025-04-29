<script>
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';

  // Store test results
  const testResults = writable([]);
  const testRunning = writable(false);
  const error = writable(null);

  // Run the shape recognition test
  async function runTest() {
    testRunning.set(true);
    error.set(null);

    try {
      const response = await fetch('/api/debug/test-shape-recognition');
      if (!response.ok) {
        throw new Error(`Error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      testResults.set(data.results);
    } catch (err) {
      error.set(err.message);
      console.error('Test error:', err);
    } finally {
      testRunning.set(false);
    }
  }

  // Render a shape on a canvas
  function renderShape(canvas, shape) {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all strokes in the shape
    for (const stroke of shape.strokes) {
      const { points, color } = stroke;

      if (!points || points.length < 2) continue;

      ctx.strokeStyle = color || '#000000';
      ctx.lineWidth = stroke.width || 2;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);

      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }

      ctx.stroke();
    }

    // If there's a result, show bounding box
    if (shape.result && shape.result.shapes && shape.result.shapes.length > 0) {
      const boundingBox = shape.result.shapes[0].boundingBox;

      if (boundingBox) {
        ctx.strokeStyle = '#FF0000';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(
          boundingBox.x,
          boundingBox.y,
          boundingBox.width,
          boundingBox.height
        );
        ctx.setLineDash([]);

        // Draw shape type label
        ctx.font = '14px Arial';
        ctx.fillStyle = '#FF0000';
        ctx.fillText(
          shape.result.shapes[0].type,
          boundingBox.x,
          boundingBox.y - 5
        );
      }
    }
  }

  // Setup canvas rendering when results arrive
  $: if ($testResults.length > 0) {
    // Use setTimeout to ensure the DOM has updated
    setTimeout(() => {
      $testResults.forEach((result, index) => {
        const canvas = document.getElementById(`canvas-${index}`);
        if (canvas && result) {
          const testShape = createTestShape(result.name);
          testShape.result = result.result;
          renderShape(canvas, testShape);
        }
      });
    }, 100);
  }

  // Create test shapes for rendering
  function createTestShape(type) {
    switch (type) {
      case 'circle':
        return {
          name: 'circle',
          strokes: [{
            id: 'test-circle',
            points: Array.from({ length: 40 }, (_, i) => {
              const angle = (i / 40) * Math.PI * 2;
              return {
                x: 100 + Math.cos(angle) * 50,
                y: 100 + Math.sin(angle) * 50
              };
            }),
            color: '#000000',
            width: 2
          }]
        };

      case 'rectangle':
        return {
          name: 'rectangle',
          strokes: [{
            id: 'test-rectangle',
            points: [
              { x: 50, y: 200 },
              { x: 150, y: 200 },
              { x: 150, y: 260 },
              { x: 50, y: 260 },
              { x: 50, y: 200 }
            ],
            color: '#000000',
            width: 2
          }]
        };

      case 'triangle':
        return {
          name: 'triangle',
          strokes: [{
            id: 'test-triangle',
            points: [
              { x: 200, y: 50 },
              { x: 150, y: 125 },
              { x: 250, y: 125 },
              { x: 200, y: 50 }
            ],
            color: '#000000',
            width: 2
          }]
        };

      case 'line':
        return {
          name: 'line',
          strokes: [{
            id: 'test-line',
            points: Array.from({ length: 10 }, (_, i) => {
              const t = i / 9;
              return {
                x: 300 + t * 100,
                y: 100 + t * 50
              };
            }),
            color: '#000000',
            width: 2
          }]
        };

      case 'arrow':
        return {
          name: 'arrow',
          strokes: [{
            id: 'test-arrow',
            points: [
              ...Array.from({ length: 10 }, (_, i) => {
                const t = i / 9;
                return { x: 300 + t * 100, y: 200 };
              }),
              { x: 400, y: 200 },
              { x: 380, y: 190 },
              { x: 400, y: 200 },
              { x: 380, y: 210 }
            ],
            color: '#000000',
            width: 2
          }]
        };

      default:
        return { name: 'unknown', strokes: [] };
    }
  }

  // Run the test on page load
  onMount(() => {
    runTest();
  });
</script>

<div class="container">
  <h1>Shape Recognition Test</h1>

  <div class="controls">
    <button on:click={runTest} disabled={$testRunning}>
      {$testRunning ? 'Running Test...' : 'Run Test'}
    </button>
  </div>

  {#if $error}
    <div class="error">
      Error: {$error}
    </div>
  {/if}

  <div class="results">
    {#if $testResults.length > 0}
      {#each $testResults as result, i}
        <div class="result-item">
          <h3>{result.name}</h3>
          <div class="canvas-container">
            <canvas id={`canvas-${i}`} width="500" height="300"></canvas>
          </div>
          <div class="result-info">
            <p>Match: {result.match}</p>
            {#if result.result && result.result.shapes && result.result.shapes.length > 0}
              <p>Confidence: {(result.result.shapes[0].confidence * 100).toFixed(1)}%</p>
            {/if}
          </div>
        </div>
      {/each}
    {:else if $testRunning}
      <p>Running shape recognition tests...</p>
    {:else}
      <p>No test results available. Click "Run Test" to begin.</p>
    {/if}
  </div>
</div>

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
    font-family: Arial, sans-serif;
  }

  h1 {
    color: #333;
    text-align: center;
  }

  .controls {
    margin: 20px 0;
    text-align: center;
  }

  button {
    background-color: #4CAF50;
    color: white;
    padding: 10px 20px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 16px;
  }

  button:disabled {
    background-color: #cccccc;
    cursor: not-allowed;
  }

  .error {
    background-color: #ffebee;
    color: #c62828;
    padding: 10px;
    border-radius: 4px;
    margin: 20px 0;
    text-align: center;
  }

  .results {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 20px;
  }

  .result-item {
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 15px;
    width: 550px;
    background-color: #f9f9f9;
  }

  .result-item h3 {
    text-transform: capitalize;
    margin-top: 0;
    color: #333;
    text-align: center;
  }

  .canvas-container {
    background-color: white;
    border: 1px solid #ddd;
    border-radius: 4px;
    overflow: hidden;
  }

  canvas {
    display: block;
    max-width: 100%;
  }

  .result-info {
    margin-top: 10px;
    font-size: 14px;
  }

  .result-info p {
    margin: 5px 0;
  }
</style>