import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import Replicate from 'replicate';
// @ts-ignore
import { env } from '$env/dynamic/private';

const REPLICATE_API_TOKEN = env.REPLICATE_API_TOKEN;

// Model IDs for Replicate
const MODEL_VERSIONS = {
  'sdxl-lightning': "bytedance/sdxl-lightning-4step:6f7a773af6fc3e8de9d5a3c00be77c17308914bf67772726aff83496ba1e3bbe",
  //'playground-v2': "playgroundai/playground-v2-1024px-aesthetic:42fe01b36595979f78e16624a2f5dd701941895e75a482514b686841344a68d1",
  'lcm': "fofr/latent-consistency-model:683d19dc312f7a9f0428b04429a9ccefd28dbf7785fef083ad5cf991b65f406f",
  'sdxl': "stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc",
  // Old/unused models commented out or to be removed:
  // 'flux-canny-pro': "black-forest-labs/flux-canny-pro:2bbd48cf08414ea0d61a1b7be3b618e707def47ba30a557e4dec9d2ec3ad71b3",
  // 'controlnet-canny': "jagilley/controlnet-canny:aff48af9c68d162388a9e5c3ccd367338f132e599d6737ed468f3e7171292eaa",
  // 'stable-diffusion-xl': "stability-ai/sdxl:c221b2b8ef527988fb59bf24a8b97c4561f1c671f73bd389f866fe846a791340", // Another SDXL key
};

// Helper to get Replicate dimensions based on aspect ratio string
function getReplicateDimensions(aspectRatio: string | undefined): { width: number; height: number } {
    // Default to a sensible square for speed if no specific aspect ratio is given
    let baseSize = 768;

    if (!aspectRatio) return { width: baseSize, height: baseSize };

    switch (aspectRatio) {
        case '1:1':
            return { width: 768, height: 768 }; // Standard square
        case 'portrait': // Aiming for ~4:7
            return { width: 512, height: 896 };
        case 'landscape': // Aiming for ~7:4
            return { width: 896, height: 512 };
        // Keep ability to parse specific XxY but prioritize descriptive terms
        default:
            const parts = aspectRatio.split('x');
            if (parts.length === 2) {
                const w = parseInt(parts[0]);
                const h = parseInt(parts[1]);
                if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                    return { width: w, height: h };
                }
            }
            console.warn(`Unknown aspect ratio for Replicate: ${aspectRatio}, defaulting to ${baseSize}x${baseSize}`);
            return { width: baseSize, height: baseSize };
    }
}

export const POST: RequestHandler = async (event) => {
  try {
    console.log('Replicate /generate-replicate API called');
    const requestData = await event.request.json();
    let {
      prompt: clientPrompt,
      model: selectedModel,
      aspectRatio
    } = requestData;

    if (!REPLICATE_API_TOKEN) {
      console.error('Replicate API token is not configured');
      return json({ error: 'Replicate API token is not configured' }, { status: 500 });
    }

    if (!clientPrompt || !selectedModel) {
      return json({ error: 'Prompt and model are required' }, { status: 400 });
    }

    const modelVersion = (MODEL_VERSIONS as any)[selectedModel];
    if (!modelVersion) {
      return json({ error: `Unsupported Replicate model: ${selectedModel}` }, { status: 400 });
    }
    console.log(`Using Replicate model key: ${selectedModel}, version: ${modelVersion}`); // Log the version being used

    const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });
    const { width, height } = getReplicateDimensions(aspectRatio);

    let effectivePrompt = clientPrompt;
    let inputPayload: any = {
        prompt: effectivePrompt,
        width: width,
        height: height,
        // Default parameters, will be overridden by model-specific settings below
        num_inference_steps: 30,
        guidance_scale: 7.5,
    };

    // Model-specific parameter adjustments
    if (selectedModel === 'sdxl-lightning') {
        inputPayload.num_inference_steps = 4;
        inputPayload.guidance_scale = 0.5;
    } else if (selectedModel === 'lcm') {
        inputPayload.num_inference_steps = 4; // LCMs can go very low
        inputPayload.guidance_scale = 1.0;
    } else if (selectedModel === 'sdxl') {
        inputPayload.num_inference_steps = 20; // Reduced for speed
        inputPayload.guidance_scale = 5.0;
    }
    // Note: 'playground-v2' was removed from frontend, so no specific case needed here for it now.
    // If added back, its specific parameters would go here.

    console.log(`Calling Replicate model: ${selectedModel} (version: ${modelVersion}) with payload:`, JSON.stringify(inputPayload, null, 2));

    const prediction = await replicate.predictions.create({
        version: modelVersion,
        input: inputPayload,
    });

    if (prediction.error) {
        console.error('Replicate prediction initiation error:', prediction.error);
        return json({ error: `Replicate error: ${prediction.error}` }, { status: 500 });
    }

    // Polling for result
    let result = prediction;
    const maxAttempts = 120;
    let attempts = 0;

    while (result.status !== "succeeded" && result.status !== "failed" && attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
            result = await replicate.predictions.get(result.id);
        } catch (pollError: any) {
            console.error('Replicate polling error:', pollError);
            return json({ error: `Replicate polling failed: ${pollError.message}` }, { status: 500 });
        }
    }

    if (result.status === "failed") {
        console.error('Replicate processing failed:', result.error);
        return json({ error: result.error || 'Replicate processing failed' }, { status: 500 });
    }

    if (result.status !== "succeeded" || !result.output) {
        console.error('Replicate did not succeed or no output:', result);
        return json({ error: 'Replicate did not produce an output or failed silently.', details: result.logs || result.error }, { status: 500 });
    }

    let imageUrl;
    if (Array.isArray(result.output)) {
        imageUrl = result.output[0];
    } else if (typeof result.output === 'string') {
        imageUrl = result.output;
    } else {
        console.error('Unexpected output format from Replicate:', result.output);
        return json({ error: 'Unexpected output format from Replicate' }, { status: 500 });
    }

    if (!imageUrl) {
        return json({ error: 'No image URL found in Replicate response' }, { status: 500 });
    }

    console.log(`Image generated by Replicate model ${selectedModel}: ${imageUrl}`);
    return json({
        imageUrl: imageUrl,
        url: imageUrl,
        model: selectedModel,
        prompt: clientPrompt, // Return the original client prompt
        revised_prompt: effectivePrompt, // Could also return the modified prompt if desired for debugging
        aspectRatio: `${width}x${height}`
    });

  } catch (error: any) {
    console.error('Error in /api/ai/generate-replicate endpoint:', error);
    let errorMessage = 'Internal server error during Replicate image generation';
    if (error.response && error.response.data && error.response.data.detail) {
        errorMessage = error.response.data.detail;
    } else if (error.message) {
        errorMessage = error.message;
    }
    if (typeof errorMessage === 'string' && (errorMessage.toLowerCase().includes('nsfw') || errorMessage.toLowerCase().includes('safety filter'))) {
        return json({ error: 'Your prompt was rejected by Replicate\'s content filter. Please modify your prompt.' }, { status: 400 });
    }
    return json({ error: errorMessage }, { status: 500 });
  }
};