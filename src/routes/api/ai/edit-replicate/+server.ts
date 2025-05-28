import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Replicate from 'replicate';

export const POST: RequestHandler = async (event) => {
  try {
    console.log('Replicate image generation API called');
    const requestData = await event.request.json();
    const {
      drawingContent,
      imageData,
      aspectRatio,
      prompt: clientPrompt,
      additionalContext,
      model: selectedModel
    } = requestData;

    console.log(`Using Replicate model: ${selectedModel}`);

    if (!drawingContent || !imageData) {
      return json({ error: 'Drawing content and image data are required' }, { status: 400 });
    }

    const matches = imageData.match(/^data:(image\/\w+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return json({ error: 'Invalid image data format' }, { status: 400 });
    }
    const imageType = matches[1];
    const base64Data = matches[2];

    // @ts-ignore
    const { REPLICATE_API_TOKEN } = await import('$env/static/private');
    if (!REPLICATE_API_TOKEN) {
      return json({ error: 'Replicate API token is not configured' }, { status: 500 });
    }

    const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });

    if (!clientPrompt) {
      return json({ error: 'Prompt is required' }, { status: 400 });
    }

    // --- Enhanced Prompting Strategy ---
    const baseInstruction = "Produce a high-quality, beautiful, and detailed artistic rendering. Faithfully adhere to the structure, element placement, and proportions of the provided sketch. The user's primary textual description is crucial.";
    const commonNegativePrompt = "ugly, blurry, low quality, deformed, disfigured, artifacts, noisy, watermark, signature, text, sketch lines, messy, incoherent";
    let enhancedUserPrompt;
    if (additionalContext && additionalContext.trim() !== "") {
      enhancedUserPrompt = `User's prompt: "${clientPrompt}". Additional context: "${additionalContext}".`;
    } else {
      enhancedUserPrompt = `User's prompt: "${clientPrompt}".`;
    }
    // --- End Enhanced Prompting Strategy ---

    try {
      let prediction;
      let apiPrompt;

      switch (selectedModel) {
        case 'flux-canny-pro':
          apiPrompt = `${baseInstruction} ${enhancedUserPrompt} Style: Emphasize a clean, refined version of the sketch.`;
          prediction = await replicate.predictions.create({
            version: "b0a59442583d6a8946e4766836f11b8d3fc516fe847c22cf11309c5f0a792111",
            input: {
              control_image: `data:${imageType};base64,${base64Data}`,
              prompt: apiPrompt,
              guidance: 7.5,
              num_inference_steps: 40, // Increased
            },
          });
          break;

        case 'controlnet-scribble':
          apiPrompt = `${baseInstruction} ${enhancedUserPrompt} Desired style: Clean, professional anime illustration, vibrant, aesthetically pleasing. Avoid a 'scribbled' or rough final look.`;
          prediction = await replicate.predictions.create({
            //version: "435061a1b5a4c1e26740464bf786efdfa9cb3a3ac488595a2de23e143fdb0117",
            version: "aff48af9c68d162388d230a2ab003f68d2638d88307bdaf1c2f1ac95079c9613",
            input: {
              image: `data:${imageType};base64,${base64Data}`,
              prompt: apiPrompt,
              num_inference_steps: 40, // Increased
              scale: 8.0, // Slightly adjusted
              negative_prompt: `${commonNegativePrompt}, childish, amateurish, rough sketch, pencil marks`, // Added
            },
          });
          break;

        case 'stable-diffusion':
          apiPrompt = `${baseInstruction} Create a completed version of this exact sketch. CRITICAL: Maintain EXACT positions of eyes, face, crown, hair, and all other elements. The sketch shows the precise structure to follow. Detailed description: "${clientPrompt}". ${additionalContext && additionalContext.trim() !== "" ? `Additional context: "${additionalContext}".` : ''} High-quality anime illustration with perfect structural fidelity to the original sketch.`;
          prediction = await replicate.predictions.create({
            version: "15a3689ee13b0d2616e98820eca31d4c3abcd36672df6afce5cb6feb1d66087d",
            input: {
              image: `data:${imageType};base64,${base64Data}`,
              prompt: apiPrompt,
              num_inference_steps: 50, // Increased for better detail
              guidance_scale: 15, // Increased for better prompt adherence
              prompt_strength: 0.5, // Significantly reduced to preserve original sketch structure
              negative_prompt: `${commonNegativePrompt}, chaotic, nonsensical elements, distorted proportions, misplaced features, deformed face, wrong position`, // Enhanced
            },
          });
          break;

          case 'latent-consistency':
            apiPrompt = `${baseInstruction} Create a high-quality completed version of this sketch. CRITICAL: Maintain EXACT positions and proportions of all elements. The sketch provides the precise structure to follow. Primary description: "${clientPrompt}". ${additionalContext && additionalContext.trim() !== "" ? `Additional context: "${additionalContext}".` : ''} Ensure perfect structural fidelity to the original sketch.`;
            prediction = await replicate.predictions.create({
              version: "683d19dc312f7a9f0428b04429a9ccefd28dbf7785fef083ad5cf991b65f406f",
              input: {
                prompt: apiPrompt,
                image: `data:${imageType};base64,${base64Data}`,
                num_inference_steps: 8, // LCM is optimized for fewer steps
                guidance_scale: 8.0,
                negative_prompt: `${commonNegativePrompt}, deformed, distorted, inaccurate placement, wrong position, bad anatomy`,
                width: 1024, // Higher resolution
                height: 1024,
                num_images: 1,
                scheduler: "dpm++", // Best scheduler for LCM
                seed: Math.floor(Math.random() * 1000000), // Random seed
              },
            });
            break;

        default:
          return json({ error: `Unsupported model: ${selectedModel}` }, { status: 400 });
      }

      let result = prediction;
      while (result.status !== "succeeded" && result.status !== "failed") {
        await new Promise(resolve => setTimeout(resolve, 1000));
        result = await replicate.predictions.get(result.id);
      }

      if (result.status === "failed") {
        return json({ error: result.error || 'Replicate processing failed' }, { status: 500 });
      }

      let imageUrl;
      if (Array.isArray(result.output)) {
        console.log('Replicate returned an array of length: ' + result.output.length);
        imageUrl = result.output.length > 1 ? result.output[1] : result.output[0];
      } else if (typeof result.output === 'string') {
        imageUrl = result.output;
      } else if (result.output && typeof result.output === 'object') {
        imageUrl = result.output.url || result.output.image || result.output;
      } else {
        console.error('Unexpected output format from Replicate:', result.output);
        return json({ error: 'Unexpected output format from Replicate' }, { status: 500 });
      }

      console.log('Replicate result format:', {
        outputType: typeof result.output,
        isArray: Array.isArray(result.output),
        sampleOutput: result.output,
        extractedUrl: imageUrl,
        modelUsed: selectedModel,
        finalPrompt: apiPrompt
      });

      return json({
        imageUrl: imageUrl,
        url: imageUrl,
        model: selectedModel,
        aspectRatio: aspectRatio
      });

    } catch (error) {
      console.error('Replicate API error:', error);
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('safety') ||
            errorMessage.includes('content filter') ||
            errorMessage.includes('policy violation') ||
            errorMessage.includes('rejected')) {
          return json({
            error: 'Your drawing or description triggered Replicate\'s content filter. Please modify your drawing or description to avoid sensitive content.'
          }, { status: 400 });
        }
      }
      throw error; // Rethrow for SvelteKit to handle as a 500
    }
  } catch (error) {
    console.error('Error generating image with Replicate:', error);
    // Ensure a JSON response for all errors from this endpoint
    return json({ error: error.message || 'Internal server error during Replicate image generation' }, { status: 500 });
  }
};
