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

