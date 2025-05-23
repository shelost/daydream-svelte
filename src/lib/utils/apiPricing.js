/**
 * Pricing data for various API providers and models.
 * Prices are typically per 1000 tokens for LLMs, per image for image models,
 * or per second/minute for other processing.
 *
 * NOTE: These prices are illustrative and should be regularly updated
 * from the official pricing pages of each API provider.
 */
const PRICING_DATA = {
    OpenAI: {
        'gpt-4o': {
            input: 0.005 / 1000, // $ per input token
            output: 0.015 / 1000, // $ per output token
        },
        'gpt-4-turbo': {
            input: 0.01 / 1000,
            output: 0.03 / 1000,
        },
        'gpt-3.5-turbo': { // Example, check latest
            input: 0.0005 / 1000,
            output: 0.0015 / 1000,
        },
        'dall-e-3': { // Per image, standard quality, 1024x1024
            '1024x1024': 0.040,
            '1024x1792': 0.080, // Example for other resolutions
            '1792x1024': 0.080, // Example for other resolutions
        },
        'gpt-image-1': { // Hypothetical pricing, treat like DALL-E 3 for now
             '1024x1024': 0.040,
             '1024x1792': 0.080,
             '1792x1024': 0.080,
        }
        // Add other OpenAI models as needed
    },
    Replicate: {
        // Replicate pricing is often per second of GPU time.
        // This is highly variable. We'll use a generic per-second cost as a placeholder.
        // For specific models, you'd find their per-second cost on Replicate.
        'stable-diffusion': { // Example: SDXL on an A100
            perSecond: 0.00055, // Highly illustrative
        },
        'controlnet-scribble': {
            perSecond: 0.00055, // Illustrative
        },
        'flux-canny-pro': {
            perSecond: 0.00075, // Illustrative, might be more expensive
        },
        'latent-consistency': {
            perSecond: 0.00040, // Illustrative
        }
        // Add other Replicate models here
    },
    // Add Anthropic, Google, Perplexity etc. when you integrate them
    // Anthropic: {
    //     'claude-3-opus': { input: 0.015 / 1000, output: 0.075 / 1000 },
    //     'claude-3-sonnet': { input: 0.003 / 1000, output: 0.015 / 1000 },
    // },
    // Google: {
    //      'gemini-1.5-pro': { input: 0.007 / 1000, output: 0.021 / 1000 }, // Assuming characters/4 for tokens
    // }
};

/**
 * Calculates the cost of an API call.
 * @param {string} apiProvider - e.g., "OpenAI", "Replicate"
 * @param {string} model - e.g., "gpt-4o", "stable-diffusion"
 * @param {object} usageDetails - Details specific to the API call.
 *   For OpenAI LLMs: { inputTokens, outputTokens }
 *   For OpenAI DALL-E: { resolution: "1024x1024", count: 1 }
 *   For Replicate: { durationSeconds }
 * @returns {number} The calculated cost, or 0 if pricing info is not found.
 */
export function calculateCost(apiProvider, model, usageDetails) {
    if (!PRICING_DATA[apiProvider] || !PRICING_DATA[apiProvider][model]) {
        console.warn(`Pricing data not found for ${apiProvider} - ${model}. Returning cost 0.`);
        return 0;
    }

    const modelPricing = PRICING_DATA[apiProvider][model];
    let cost = 0;

    if (apiProvider === 'OpenAI') {
        if (model.startsWith('gpt-')) { // Text models
            cost = (usageDetails.inputTokens * modelPricing.input) +
                   (usageDetails.outputTokens * modelPricing.output);
        } else if (model.startsWith('dall-e') || model.startsWith('gpt-image')) { // Image models
            const resolutionPrice = modelPricing[usageDetails.resolution];
            if (resolutionPrice) {
                cost = (usageDetails.count || 1) * resolutionPrice;
            } else {
                console.warn(`Pricing for resolution ${usageDetails.resolution} not found for ${model}. Using default 1024x1024 if available.`);
                cost = (usageDetails.count || 1) * (modelPricing['1024x1024'] || 0);
            }
        }
    } else if (apiProvider === 'Replicate') {
        if (modelPricing.perSecond && usageDetails.durationSeconds) {
            cost = usageDetails.durationSeconds * modelPricing.perSecond;
        }
    }
    // Add logic for other providers here

    return cost;
}

// Example usage (for testing):
// console.log("GPT-4o cost:", calculateCost("OpenAI", "gpt-4o", { inputTokens: 1000, outputTokens: 500 }));
// console.log("DALL-E 3 cost:", calculateCost("OpenAI", "dall-e-3", { resolution: "1024x1024", count: 2 }));
// console.log("Replicate SD cost:", calculateCost("Replicate", "stable-diffusion", { durationSeconds: 15.5 }));