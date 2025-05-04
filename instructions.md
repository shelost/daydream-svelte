# Instructions

## All AI-generated code instructions go here.

## Implement correct GPT-Image-1 edit endpoint

### Problem
The current server endpoint `src/routes/api/ai/edit-image/+server.ts` calls `openai.images.generate` which creates a brand-new image instead of modifying the user supplied canvas snapshot. We must switch to the `openai.images.edit` endpoint and feed the snapshot as an actual file stream (not a base64 string) because GPT-Image-1 expects a file upload.

### Solution Outline
1. Decode the incoming base64 data URL into a `Buffer`.
2. Convert this buffer into a `File` object that the OpenAI SDK accepts (use `openai.toFile(buffer, "drawing.png")`).
3. Replace the `openai.images.generate` call with `openai.images.edit`, passing:
   * `model: "gpt-image-1"`
   * `prompt: clientPrompt` (received from the frontend)
   * `image: file` (the `File` created in step 2)
   * `n` & `size` kept as before
4. Preserve existing safety-filter handling and response shape (`url` or `b64_json`).
5. Remove unused imports (`DrawingContent`, `svgFromStrokes`) to keep code clean.
6. Return the edited image URL/base64 back to the client just like before.

This change ensures that we truly edit the user's drawing instead of generating an unrelated image, satisfying the OpenAI documentation requirements.

# Instructions / Plan

## Fabric.js Integration for `/canvas` Route

**Goal:** Replace the basic HTML Canvas 2D implementation in `src/routes/(public)/canvas/+page.svelte` with Fabric.js to enable true vector erasing and better object management, while retaining Perfect Freehand for stroke generation aesthetics.

**Steps:**

1.  **Initialize Fabric Canvas:**
    *   Add `id="fabric-canvas"` to the `<canvas>` element.
    *   In `onMount`, initialize `new fabric.Canvas('fabric-canvas')`.
    *   Remove `CanvasRenderingContext2D` usage (`inputCtx`).
2.  **Integrate Perfect Freehand & Fabric Paths:**
    *   Keep `drawingContent: EnhancedDrawingContent` state to store original point data for the `analyze-strokes` API.
    *   In `endPenStroke`:
        *   Continue adding stroke data to `drawingContent.strokes`.
        *   Generate SVG path data using Perfect Freehand (`getStroke`, `getSvgPathFromStroke`).
        *   Create `new fabric.Path(pathData, { ... })` with fill, opacity, etc.
        *   Add a custom property `originalStrokeIndex` to the Fabric path.
        *   Add the `fabric.Path` to the `fabricCanvas`.
3.  **Implement Fabric Eraser:**
    *   In `startEraserStroke`, set `fabricCanvas.isDrawingMode = true` and `fabricCanvas.freeDrawingBrush = new fabric.EraserBrush(...)` with appropriate width.
    *   Remove logic creating background-colored strokes.
    *   In `endEraserStroke`, set `fabricCanvas.isDrawingMode = false`.
4.  **Implement Fabric Selection:**
    *   Remove manual selection box drawing code.
    *   Set `fabricCanvas.isDrawingMode = false` for the 'select' tool.
    *   Listen to Fabric selection events (`selection:created`, `selection:updated`, `selection:cleared`).
    *   Update `selectedStrokeIndices` based on the `originalStrokeIndex` of selected Fabric objects (`fabricCanvas.getActiveObjects()`).
5.  **Refactor Rendering & Canvas Management:**
    *   Replace `renderStrokes()` calls with `fabricCanvas.requestRenderAll()`. Remove `renderStrokes`'s internal logic.
    *   Update `clearCanvas` to use `fabricCanvas.clear()` and clear `drawingContent.strokes`.
    *   Update `resizeCanvas` to use `fabricCanvas.setDimensions()`, `fabricCanvas.renderAll()`.
    *   Update `getPointerPosition` to use `fabricCanvas.getPointer(e)`.
    *   Update `captureCanvasSnapshot` to use `fabricCanvas.toDataURL()`.
6.  **Adapt Tool Switching & Options:**
    *   Modify tool selection logic to manage `fabricCanvas.isDrawingMode` and `fabricCanvas.freeDrawingBrush`.
    *   Apply stroke options (color, opacity) to `fabric.Path` on creation.
    *   Apply eraser width to `EraserBrush`.
7.  **Maintain AI Integration (Compromise):**
    *   Keep AI analysis functions and UI components.
    *   `analyzeSketch` uses Fabric canvas snapshot.
    *   `recognizeStrokes` uses the (unerased) data from `drawingContent.strokes`. Overlays may have slight inaccuracies.
8.  **Preserve Styles & Layout:** No changes to CSS or HTML structure (except canvas ID).

