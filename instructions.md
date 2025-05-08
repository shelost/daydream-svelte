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

## Add Sliding Pill Background to Header Navigation

**Problem:** The main site header navigation lacks a visual indicator for the currently active navigation item.

**Goal:** Implement a sliding "pill" background that smoothly animates to highlight the active navigation tab, similar to the style seen on krea.ai.

**Plan:**

1.  **Modify `src/lib/components/public/Header.svelte`:**
    *   **HTML Structure:**
        *   Add a `div` element with class `nav-pill` inside the `<nav>` container. This div will serve as the sliding background.
        *   Use `bind:this` to get references to the `<nav>` element itself (`navElement`) and the new pill `div` (`pillElement`).
    *   **JavaScript Logic (within `<script>` tags):**
        *   Import `page` from `$app/stores` to access the current URL.
        *   Import `onMount` and `afterNavigate` from Svelte and `$app/navigation` respectively.
        *   In `onMount`:
            *   Query all navigation links (`<a>` tags within the `<nav>`) and store them in an array (`navButtons`).
            *   Call a function `updatePill()` to set the initial position of the pill.
        *   Use `afterNavigate`:
            *   Call `updatePill()` to ensure the pill moves correctly after client-side navigations.
        *   Implement `updatePill()` function:
            *   This function will find the active navigation link by comparing its `href` attribute with the current `$page.url.pathname`.
            *   If an active link is found:
                *   Calculate its position and width relative to the `nav` container using `getBoundingClientRect()` for accuracy.
                *   Update the `nav-pill`'s `style.transform` to `translateX(...) translateY(-50%)` and `style.width` to match the active link.
                *   Ensure the pill is visible (e.g., `opacity: 1`).
            *   If no active link matches the current path, hide the pill (e.g., `opacity: 0`, `width: 0px`).
    *   **SCSS Styling (within `<style lang="scss">` tags):**
        *   **`nav` element:**
            *   Set `position: relative;` to act as the positioning context for the absolutely positioned pill.
        *   **`.nav-pill` element:**
            *   `position: absolute;`
            *   `left: 0;`
            *   `top: 50%;`
            *   `height: 32px;`
            *   `border-radius: 16px;` (for the pill shape)
            *   `background-color: white;`
            *   `transform: translateY(-50%);` (initial Y transform for vertical centering)
            *   `z-index: 0;` (to be behind the navigation link text/icons).
            *   `transition: transform 0.35s cubic-bezier(0.65, 0, 0.35, 1), width 0.35s cubic-bezier(0.65, 0, 0.35, 1), opacity 0.35s ease;` for smooth animation.
            *   `opacity: 0;` (initially hidden, fades in when active).
        *   **`nav a` elements (navigation links):**
            *   `position: relative; z-index: 1;` to ensure their content (icons, text) is rendered above the pill.
            *   Ensure `text-decoration: none;`.

2.  **Testing:**
    *   Verify the pill appears correctly on initial page load for all navigation routes (`/`, `/draw`, `/image`).
    *   Verify the pill smoothly slides to the correct navigation item when navigating between these pages.
    *   Verify the pill is hidden or appropriately handled if navigating to a URL not represented in the header navigation.

## Correct afterNavigate Import for Header Pill

**Problem:** The `Header.svelte` component was importing `afterNavigate` from `'svelte'` instead of `'$app/navigation'`, leading to a `TypeError` during runtime.

**Goal:** Fix the import path for `afterNavigate` to resolve the runtime error and ensure the sliding pill navigation works correctly after page navigations.

**Plan:**

1.  **Modify `src/lib/components/public/Header.svelte`:**
    *   **JavaScript Logic (within `<script>` tags):
        *   Change the import: `import { onMount, afterNavigate } from 'svelte';`
        *   To: `import { onMount } from 'svelte';` and `import { afterNavigate } from '$app/navigation';`

2.  **Testing:**
    *   Verify the application loads without the `TypeError`.
    *   Confirm the sliding pill navigates correctly when changing routes.

