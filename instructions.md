# Instructions

## All AI-generated code instructions go here.

## Real-Time Diffusion Generation for Canvas with Socket.io + Flux Schnell

### Problem
User wants to add real-time diffusion generation that updates as the user draws, providing immediate visual feedback with AI-generated images that refresh continuously. This feature should be activated when the user selects "Flux Schnell" from the model dropdown in the /canvas page.

### Solution Implemented
1. **Socket.io Integration**:
   - Added Socket.io client and server packages
   - Created `/src/lib/server/socket.ts` for WebSocket server handling
   - Modified `src/hooks.server.ts` to initialize Socket.io server on app start
   - Integrated Socket.io client in canvas component

2. **Model Integration**:
   - Added "Flux Schnell (Realtime)" to the model dropdown
   - Implemented conditional Socket.io connection based on model selection
   - Added support for Flux Schnell and Flux Pro models via Replicate API

3. **Debouncing Strategy**:
   - 300ms initial delay after drawing stops (configurable)
   - Progressive quality improvements: Flux Schnell first, then Flux Pro after 2s
   - Cancellable generation via AbortController
   - Smart canvas update tracking with debounced emission

4. **Real-time Features**:
   - Automatic WebSocket connection when Flux Schnell is selected
   - Real-time progress updates during generation
   - Automatic disconnection when switching to other models
   - Error handling with user-friendly messages

5. **Technical Implementation**:
   - Server: TypeScript Socket.io server with Replicate integration
   - Client: Reactive Svelte integration with auto-connect/disconnect
   - Uses existing SSE infrastructure alongside new WebSocket support
   - Preserves all existing model functionality

### How It Works
1. User selects "Flux Schnell (Realtime)" from the model dropdown
2. Socket.io connection is automatically established
3. As user draws, canvas updates are debounced and sent to server
4. Server generates preview with Flux Schnell (4 steps, ~1-3s)
5. If user remains idle for 2s, server upgrades to Flux Pro for quality
6. Generated images stream back in real-time
7. Connection automatically closes when switching models

### Key Files Modified
- `src/routes/(public)/canvas/+page.svelte` - Added Socket.io client integration
- `src/lib/server/socket.ts` - New Socket.io server implementation
- `src/hooks.server.ts` - Socket.io server initialization
- `package.json` - Added socket.io and socket.io-client dependencies

## Chat Interface UX Improvements

### Problem
The chat interface in `src/routes/(public)/stan/+page.svelte` had several UX issues:
1. The "Thinking..." text was positioned below the blinking purple cursor instead of inline with it
2. The copy button for assistant messages was overlapping with the blinking cursor during generation
3. Copy buttons lacked consistent visual feedback (checkmark animation) across the interface

### Solution Outline
1. **Inline "Thinking..." Text:**
   - Created a new container `cursor-and-thinking-container` to hold both the cursor and thinking text
   - Moved the "Thinking..." spinner from `assistant-message-footer` to be inline with the cursor
   - Used `display: inline-flex` with proper gap spacing

2. **Copy Button Opacity Control:**
   - Copy buttons are always present but start with `opacity: 0` during generation
   - Transition to `opacity: 1` when generation completes
   - This prevents layout shift while avoiding overlap with the cursor

3. **Universal Checkmark Feedback:**
   - Updated `copyMessage` function to use `copyWithFeedback`
   - Changed event handler to pass `event.currentTarget` instead of `this`
   - All copy buttons now show a checkmark for 2 seconds after copying

### Implementation Details
- **File:** `src/routes/(public)/stan/+page.svelte`
- **Functions modified:** `copyMessage`, `copyWithFeedback`
- **Template changes:** Restructured cursor and thinking text positioning
- **CSS additions:** Added styles for cursor containers and thinking text

### Testing
- Verify "Thinking..." appears next to the blinking cursor during generation
- Confirm copy buttons fade in only after generation completes
- Test that all copy buttons show checkmark feedback when clicked

## Waterfall Opacity Animation for Streaming Text

### Problem
User requested a "waterfall" effect where newly generated words start at low opacity (0.5) and gradually fade to full opacity (1.0) over 3 seconds, while maintaining live markdown formatting during generation.

### Solution Outline
1. **Always Use Markdown Rendering:**
   - Maintain consistent formatting throughout generation by always using the Markdown component
   - Remove the dual rendering system (plain text during streaming, markdown after completion)

2. **DOM-Based Animation:**
   - Implemented `animateNewContent()` function that detects newly added text in rendered markdown
   - Applies opacity animations to new text nodes using DOM manipulation
   - Creates spans with `animated-new-text` class for smooth opacity transitions

3. **Content Tracking:**
   - Added `_previousContent` property to message interface to track content changes
   - Compare previous and current content to identify new text sections
   - Apply animations only to newly added content portions

### Implementation Details
- **File:** `src/routes/(public)/stan/+page.svelte`
- **New Function:** `animateNewContent(container, previousContent, currentContent)`
- **Modified Interface:** Added `_previousContent` property to Message interface
- **Animation Logic:** Text nodes are split and wrapped in animated spans with 3-second opacity transition
- **CSS:** Added `.animated-new-text` class with transition properties

### Technical Approach
1. During streaming, update message content and track previous content
2. After each content update, call `animateNewContent()` with a 50ms delay
3. Function uses `TreeWalker` to find all text nodes in the rendered markdown
4. Calculates which portions are new based on character count comparison
5. Splits text nodes and wraps new content in animated spans
6. New spans start at opacity 0.5 and transition to 1.0 over 3 seconds

### Benefits
- Maintains live markdown formatting (code blocks, headings, etc.) during generation
- Creates smooth "waterfall" effect for newly added content
- No sudden style changes when generation completes
- Preserves syntax highlighting and other markdown features throughout the process

## Staggered Word Fade-In Animation for Stan Chat Interface

### Problem
The current Stan chat interface displays new words/tokens instantly as they stream in from the AI response. The user wants each new word to start at opacity 0 and gradually fade in to opacity 1, creating a smooth "waterfall" effect where words appear to flow in naturally one after another.

### Solution Outline
1. **Configurable Animation Speed:**
   - Add a `WORD_FADE_DURATION` variable to control the fade-in animation duration
   - This allows easy adjustment of the animation speed without modifying CSS

2. **Word-by-Word Animation System:**
   - Track newly added words in the streaming content
   - Wrap each new word in a span with a unique animation delay
   - Use CSS animations for smooth opacity transitions from 0 to 1

3. **Live Markdown Compatibility:**
   - Continue using the Markdown component for real-time formatting
   - Apply animations after markdown rendering to preserve formatting
   - Handle code blocks, lists, and other markdown elements gracefully

4. **Performance Optimization:**
   - Only animate new words, not existing content
   - Use CSS animations instead of JavaScript for better performance
   - Clean up animation classes after completion

### Implementation Details
- **Animation Duration:** Configurable via `WORD_FADE_DURATION` variable
- **Stagger Delay:** Each word starts animating 50-100ms after the previous one
- **CSS Class:** `.animated-word` with keyframe animation from opacity 0 to 1
- **DOM Manipulation:** Minimal and efficient to avoid layout thrashing

### Technical Approach
1. Monitor content updates during streaming
2. Identify new text segments by comparing with previous content
3. Split new text into words and wrap each in animated spans
4. Apply staggered animation delays for waterfall effect
5. Let CSS handle the actual animations for smooth performance

## Real-time Staggered Word Fade-in Animation for Streaming Text (`stan/+page.svelte`)

**1. Problem Identified**

The current text animation in `src/routes/(public)/stan/+page.svelte` applies a fade-in effect using `animation-delay` after the entire assistant response is loaded. This doesn't provide a real-time "waterfall" effect where each word animates as it streams in. The goal is to have each new word fade from opacity 0 to 1 individually and sequentially as the text streams, while maintaining live Markdown and Prism.js syntax highlighting.

**2. Solution Outline**

We will modify the streaming logic and the existing `MutationObserver` in `src/routes/(public)/stan/+page.svelte` to achieve a real-time word-by-word fade-in.

*   **Post-Markdown/Prism Processing:** Animations will be applied *after* the Svelte Markdown component (`svelte-rune-markdown`) and Prism.js have processed the content. This means we'll be working with the HTML structure they generate.
*   **Targeted DOM Updates & Word Wrapping:** A new function, `applyRealtimeWordAnimation`, will be triggered by the `MutationObserver`. This function will scan the message's rendered HTML content, identify text nodes, and determine which words are new based on a counter stored in `animatedWordsMap`. Only new words will be wrapped in `<span>` elements.
*   **CSS Animation:** These spans will have a CSS class (e.g., `.streaming-word-fade-in`) that triggers an immediate opacity fade-in animation. The staggered "waterfall" effect will arise naturally from the sequential arrival and processing of words.
*   **Animation Speed Control:** A JavaScript constant (`WORD_ANIMATION_DURATION_MS`) will control the `animation-duration` of the fade-in for each word.
*   **State Management:** The `animatedWordsMap` will store the count of words already processed and animated for each message ID.

**3. Implementation Details (`src/routes/(public)/stan/+page.svelte`)**

*   **Constants:**
    *   Define `WORD_ANIMATION_DURATION_MS` (e.g., `300` or `500`) for animation speed.
*   **`animatedWordsMap`:**
    *   This existing map will be used to store `Map<messageId, { processedWords: number }>` to track how many words have been wrapped for animation for each message.
    *   Initialize `processedWords` to `0` for a message when its streaming begins in `handleOmnibarSubmit`.
*   **New Function: `applyRealtimeWordAnimation(container: HTMLElement, messageId: string)`:**
    *   Retrieves `processedWords` for the `messageId` from `animatedWordsMap`.
    *   `let currentWordOrderInContainer = 0;` (This counter helps map words in the current DOM state to their overall order).
    *   Uses a `TreeWalker` to iterate over all text nodes within the `container`.
    *   For each text node:
        *   Skips if the parent is already an animated span (e.g., `.streaming-word-fade-in`).
        *   Splits `node.textContent` into an array of words and whitespace segments.
        *   Iterates through these segments. If a segment is a word:
            *   Increments `currentWordOrderInContainer`.
            *   If `currentWordOrderInContainer > processedWords`:
                *   This is a new word. It needs to be wrapped.
                *   A `DocumentFragment` is used to replace the original text node with a mix of plain text (for already processed words in this node) and new `<span>` wrapped words.
                *   The new `<span>` gets the class `.streaming-word-fade-in` and its `animation-duration` is set via inline style using `WORD_ANIMATION_DURATION_MS`.
        *   After processing all segments of a text node, if any new words were wrapped, the original text node is replaced with the `DocumentFragment`.
    *   Updates `animatedWordsMap.set(messageId, { processedWords: currentWordOrderInContainer })`.
*   **Modify `setupStreamingContentObserver` function:**
    *   The `MutationObserver` callback will now execute the following in order:
        1.  `highlightCodeBlocks(container)` (for Prism.js syntax highlighting).
        2.  `applyRealtimeWordAnimation(container, messageId)` (for the new word animations).
*   **CSS:**
    *   Define the `.streaming-word-fade-in` class and its `@keyframes fadeInWord` (opacity 0 to 1). The `animation-duration` will be applied inline via JavaScript.
*   **Cleanup Old Animation:**
    *   Remove the Svelte-defined `animateNewWords` function (lines approx. 181-219 in the provided file) which used `animation-delay`.
    *   Remove the old CSS classes `.word-fade-in` and `.word-animated` if they are no longer used.

**4. Checklist**
    - [ ] Define `WORD_ANIMATION_DURATION_MS` in `stan/+page.svelte`.
    - [ ] Initialize/Reset `processedWords` in `animatedWordsMap` when a new message stream starts.
    - [ ] Implement the `applyRealtimeWordAnimation(containerElement, messageId)` function as described.
    - [ ] Modify the `MutationObserver` callback in `setupStreamingContentObserver` to call `highlightCodeBlocks` then `applyRealtimeWordAnimation`.
    - [ ] Add CSS for `.streaming-word-fade-in` and `@keyframes fadeInWord`.
    - [ ] Remove the old `animateNewWords` function and its associated CSS.
    - [ ] Test with various Markdown structures (plain text, bold, italic, lists, code blocks).
    - [ ] Verify animation speed control and overall visual effect.

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

## Enhanced Stagehand Observation Log Streaming and Summary Pills

**Date:** 2025-05-29

**Problem:**
1. Detailed observation logs like "The search button located within the search section of the page" were missing from real-time pills despite being visible in terminal logs
2. Final Stagehand Agent Response was flooding the chat with many individual action pills all at once

**Solution Implemented:**

### 1. Enhanced Backend Log Parsing (`/api/stagehand/+server.ts`)

- **Improved `found elements` parsing**: Enhanced log parsing to extract detailed element descriptions from structured log data using regex to capture `"description": "..."` from elements arrays
- **Added `observe` category handling**: New support for 'observe' category logs with instruction-based descriptions
- **Enhanced pattern matching**: Better extraction of element IDs, timestamps, and structured data from complex Stagehand logs
- **Real-time streaming**: All parsed observations now stream immediately as pills during execution

### 2. Summary Pill Implementation (`+page.svelte`)

**Frontend Changes:**
- **New pill type**: Added `'summary'` to `EventLogEntry` type alongside 'reasoning' and 'action'
- **Replaced bulk action pills**: Instead of generating many individual action pills from `actionsPerformed` array, creates single collapsible summary pill
- **Collapsible UI component**: Uses `<details>/<summary>` HTML elements for expandable summary pill
- **Consistent handling**: Applied to both streaming and fallback response modes

**Summary Pill Features:**
- **Closed by default**: Shows overview like "Stagehand completed 3 actions" without cluttering chat
- **Expandable details**: Click to reveal full breakdown of actions, reasoning, and extracted data
- **Structured display**: Numbered action list with status indicators (✓ Completed / ⏳ Pending)
- **Rich content**: Shows action descriptions, reasoning (when available), and extracted data in formatted JSON
- **Responsive design**: Proper styling with orange accent color (#FF6B35) to distinguish from other pill types

### 3. Real-Time Observation Enhancement

**Now Captures:**
- Element discovery: "Found: The search button located within the search section of the page"
- Selector extraction: "Getting element selector (ID: 31)"
- Page analysis: "Page analysis completed in 1483ms"
- Observation requests: "Looking for: click on the search button"
- Accessibility tree data: "Analyzing page accessibility tree..."

**Streaming Behavior:**
- Real-time pills appear as Stagehand executes (observation logs)
- Final summary pill appears at completion with all action details
- No more overwhelming flood of individual action pills
- Maintains user ability to see real-time progress while keeping final result organized

**Result:** Users now see detailed real-time observation logs as they happen, plus a clean, collapsible summary of all actions that doesn't overwhelm the chat interface. The summary pill preserves all the detailed Stagehand response data while presenting it in an organized, user-friendly format.

## Enhanced Real-Time Stagehand Log Streaming

**Date:** 2025-05-29

**Goal:** Surface all Stagehand execution logs that were previously only visible in backend terminal as real-time action pills in the frontend chat interface.

**Problem:** While basic action pills were displaying, many detailed Stagehand logs (extraction, observation, init, etc.) were only visible in terminal output but not streaming to the frontend as pills.

**Solution Implemented:**

1. **Enhanced Log Pattern Matching**:
   - Expanded `parseAndStreamLog` function to capture ALL Stagehand INFO logs, not just specific patterns
   - Added support for categories: `init`, `extract`, `extraction`, `observation`, `action`
   - Added parsing for additional fields: `sessionId`, `url`, `requestId`, `modelName`

2. **Intelligent Log Categorization**:
   - **Init logs**: Browser session creation, connection, startup
   - **Extract logs**: Data extraction requests and processing
   - **Extraction logs**: Accessibility tree analysis, content processing
   - **Observation logs**: Page state analysis, element discovery
   - **Action logs**: Browser interactions, navigation, clicks

3. **Pill Type Determination**:
   - **Reasoning pills** (blue): Init, extract, observation - preparatory steps
   - **Action pills** (purple): Extraction completion, actions - execution steps
   - Automatic detection based on log content and completion status

4. **Enhanced Metadata**:
   - Each pill now includes structured metadata (sessionId, url, requestId, etc.)
   - Better error handling with fallback to raw log content
   - Support for system logs (console messages with emojis)

**Frontend Integration**:
- No frontend changes needed - existing pill rendering system automatically handles the enhanced log stream
- Pills appear in real-time as Stagehand processes commands
- Maintains proper interleaving of reasoning and action steps

**Result:** Users now see a comprehensive real-time view of everything Stagehand is doing, from session initialization through page analysis to action execution, with proper categorization and timing.

## Browserbase Session Timeout Fix

**Date:** 2025-05-29

**Problem:** Browserbase sessions were timing out after approximately 5 minutes despite having `keepAlive: true` configured.

**Root Cause:** According to [Browserbase documentation](https://docs.browserbase.com/guides/long-running-sessions), `keepAlive` and `timeout` serve different purposes:
- **Keep Alive**: Allows reconnection to a session after disconnect
- **Custom Timeout**: Extends session lifetime beyond the default project timeout

Setting only `keepAlive: true` allows reconnection but doesn't prevent the session from hitting the default timeout period.

**Solution Implemented:**

1. **Direct Browserbase Service** (`/api/browserbase/+server.ts`):
   - Added both `keepAlive: true` and `timeout: 3600` (1 hour) to session creation
   - This prevents automatic termination while allowing reconnection after disconnects

2. **Stagehand Integration** (`/api/stagehand/+server.ts`):
   - Added `browserbaseSessionCreateParams` configuration to Stagehand initialization
   - Included `projectId`, `keepAlive: true`, and `timeout: 3600`
   - Ensures Stagehand's underlying Browserbase sessions also use extended timeouts

**Technical Details:**
- **Maximum session duration**: 6 hours (Browserbase limit)
- **Recommended timeout**: 3600 seconds (1 hour) for most use cases
- **Keep alive requirement**: Only available on paid Browserbase plans
- **Best practice**: Explicitly close sessions when no longer needed to avoid unnecessary billing

**Reference:** [Browserbase Long Running Sessions Guide](https://docs.browserbase.com/guides/long-running-sessions)

# Fabric Canvas Plan

The user wants to integrate Fabric.js into the src/routes/(public)/canvas/+page.svelte file. This involves:
Setting up Fabric.js canvas: Initialize a Fabric.js canvas, which will inherently create a lower and upper canvas.
Integrating perfect-freehand: Strokes drawn with perfect-freehand should be converted into fabric.Path objects and added to the Fabric.js canvas. This implies a temporary canvas for perfect-freehand drawing, and then transferring the completed stroke to Fabric.js.
Implementing Tools:
 Pen Tool: Uses perfect-freehand for drawing, then adds the stroke as a fabric.Path.
 Eraser Tool: Uses Fabric.js's EraserBrush. This means isDrawingMode will be true, and the brush will be set

## Disable Text Selection on Canvas Page

- **Objective:** Prevent accidental text selection/highlighting on the canvas page to improve drawing experience, especially on mobile.
- **File:** `src/routes/(public)/canvas/+page.svelte`
- **Changes:**
    - Apply CSS `user-select: none;` (and vendor prefixes: `-webkit-user-select`, `-ms-user-select`) to a high-level container element (e.g., the main `div` with `id="app"` or `.draw-demo-container`) to prevent text selection globally on that page.

## Fix for "Unsupported model: flux-schnell" Error

- **Objective:** Prevent the `generateImage` function from making an HTTP POST to `/api/ai/edit-replicate` when "Flux Schnell (Realtime)" is selected, as this model is handled via Socket.io.
- **File:** `src/routes/(public)/canvas/+page.svelte`
- **Changes:**
    - In the `generateImage` function, add a condition at the beginning: if `$selectedModel === 'flux-schnell'`, the function should log that real-time generation is active and then return immediately, bypassing the rest of the HTTP request logic. This ensures the Omnibar's submit button doesn't cause an error for this specific real-time model.

## Fix for Realtime Flux Schnell Images Not Displaying & Add Status Indicator

- **Objective:** Ensure images generated by "Flux Schnell" (real-time) are displayed, and add a status indicator for the real-time connection and image count.
- **Files:**
    - `src/routes/(public)/canvas/+page.svelte`
    - `src/lib/components/shared/RealtimeStatusIndicator.svelte`
- **Changes in `canvas/+page.svelte` (Client-Side):**
    1.  **Debugging Image Display**:
        - Add `console.log` statements inside the `socket.on('generation-complete', ...)` event handler to trace `data.imageUrl` and confirm `editedImageUrl.set()` is called.
    2.  **Status Indicator State**:
        - Create reactive variable `socketConnectionStatus: string` (e.g., 'Disconnected', 'Connecting', 'Connected').
        - Update `socketConnectionStatus` based on `socket.on('connect')`, `socket.on('disconnect')`, `socket.on('connect_error')` and during socket initialization.
        - Create reactive variable `realtimeImagesReceivedCount: number`, initialized to 0.
        - Increment `realtimeImagesReceivedCount` within `socket.on('generation-complete')` after successfully processing `data.imageUrl`.
    3.  **Integrate Status Indicator Component**:
        - Import `RealtimeStatusIndicator.svelte`.
        - Conditionally render `<RealtimeStatusIndicator>` when `realtimeGenerationEnabled` is true.
        - Pass `socketConnectionStatus` and `realtimeImagesReceivedCount` as props to the indicator.
    4.  **Socket.IO Connection Diagnostics (Client-Side)**:
        - Add a `socket.on('connect_error', (err) => { ... });` handler to log detailed connection errors to the console. This will show reasons like "xhr poll error", "websocket error", etc.
        - Add `socket.on('reconnect_attempt', (attempt) => { ... });` to log reconnection attempts.
        - Consider changing `io('/')` to `io({ transports: ['websocket', 'polling'] })` to be explicit, though these are defaults.
- **New Component `RealtimeStatusIndicator.svelte`**:
    - (Already created in previous step)
- **Verify Reactivity**:
    - (Ongoing)

- **Backend Socket.IO Setup (Guidance for User):**
    - **Requirement**: A functioning Socket.IO server is needed on the backend to handle client connections and real-time model interactions for "Flux Schnell".
    - **SvelteKit Integration**: This typically involves:
        - **Vite Dev Server (Development)**: Configuring the Vite dev server to handle WebSocket upgrades for Socket.IO. This might involve Vite plugins or custom server setup.
        - **`src/hooks.server.ts`**: Attaching Socket.IO to the HTTP server instance provided by SvelteKit. This is a common place to initialize Socket.IO.
        - **Dedicated Endpoint**: Alternatively, a SvelteKit endpoint (e.g., a `+server.ts` file) could be used to set up Socket.IO, though this is less common for persistent WebSocket connections.
    - **Server-Side Event Handlers**: The Socket.IO server must implement handlers for:
        - `connection`: To manage new client connections.
        - `disconnect`: To handle client disconnections.
        - `canvas-update`: An event the client will emit with drawing data. The server should then:
            - Call the Flux Schnell model (e.g., using Replicate's API: `replicate.run('black-forest-labs/flux-schnell', ...)`).
            - Emit `generation-started` back to the client.
            - Upon receiving results from the model, emit `generation-complete` (with `imageUrl`) or `generation-error` back to the client.
    - **CORS Configuration**: Ensure appropriate CORS settings are in place on the server if the client and server are considered different origins (less likely with `io('/')` but important for production).

## Socket.IO Server Setup (for Real-time Canvas)

- **Objective:** Implement a Socket.IO server on the backend to handle real-time communication for the Flux Schnell feature on the canvas page, resolving client connection timeouts.
- **Files to Create/Modify:**
    - `src/lib/server/socket-handler.js` (New): Contains the Socket.IO server initialization and event handling logic (e.g., `connection`, `canvas-update`, `disconnect`).
    - `vite.config.ts` (Modify): Import the server handler and add a custom Vite plugin to integrate Socket.IO with the SvelteKit development server.
    - `package.json` (Verify/Update): Ensure `socket.io` is listed as a dependency.
    - `src/routes/(public)/canvas/+page.svelte` (Modify): Fix a minor linter error related to error handling.
- **Details:**
    - The Socket.IO server will listen for connections from the canvas page.
    - It will handle `canvas-update` events, (eventually) process the image data, and emit `generation-started`, `generation-complete`, or `generation-error` events back to the client.
    - This setup is primarily for the local development environment. Standard Vercel serverless functions do not support persistent WebSocket connections, which will require a different solution for production deployment (e.g., dedicated WebSocket service, or Vercel's Edge Functions with specific configurations if compatible).

## Video Gradient Mask on Landing Page

### Problem
The background video on the landing page (`/`) has a hard edge at the bottom, which can be visually jarring. A smooth fade-to-transparent effect is needed to blend it better with the content below it.

### Solution Outline
1.  **Target File:** `src/routes/(public)/+page.svelte`
2.  **CSS Modification:**
    *   Locate the `#video` CSS selector.
    *   Apply a `mask-image` property to create a vertical gradient mask.
    *   The gradient will be `linear-gradient(to bottom, black 70%, transparent 100%)`. This makes the top 70% of the video fully opaque, with the bottom 30% fading smoothly to full transparency.
    *   Add the `-webkit-mask-image` property with the same value to ensure compatibility with WebKit-based browsers (like Safari and Chrome).

### Implementation Details
- No new files or dependencies are needed.
- The change is purely cosmetic and achieved with a few lines of CSS.

### Testing
- Verify on the landing page that the video at the top fades out at the bottom.
- Check on different browsers (if possible) to ensure the `-webkit-` prefix works as expected.
