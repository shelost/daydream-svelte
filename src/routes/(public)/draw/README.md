# AI Drawing Demo with GPT-image-1

This demo showcases the ability to generate AI images from hand-drawn sketches using OpenAI's advanced GPT-image-1 model.

## Features

- **Drawing Canvas**: A perfect-freehand powered canvas for creating sketches
- **Advanced AI Image Generation**: Convert sketches into detailed, professional images using GPT-image-1
- **Structure Preservation**: The AI maintains the exact structure and proportions of your sketch
- **Enhanced Text Recognition**: Write labels in your drawing for additional context (e.g., write "tree" next to a tree drawing)

## About GPT-image-1

[GPT-image-1](https://azure.microsoft.com/en-us/blog/unveiling-gpt-image-1-rising-to-new-heights-with-image-generation-in-azure-ai-foundry/) is the latest image generation model from OpenAI/Microsoft with several advantages over previous models:

- **Superior Instruction Following**: Excellent at following detailed instructions about maintaining exact structure
- **Enhanced Text Rendering**: Better ability to render text within the generated images
- **Advanced Image Understanding**: Improved capability to interpret sketch elements and convert them appropriately

## How It Works

1. Draw your sketch in the left canvas using the drawing tools.
2. Add textual labels to provide additional context if needed.
3. Click the "Generate Image with GPT-image-1" button to trigger the AI process.
4. The right canvas will display the generated image that matches your sketch's structure.

## Technical Implementation

### Client-Side Drawing
- Uses perfect-freehand for natural, fluid drawing experience
- Canvas is powered by HTML5 Canvas API
- Captures both stroke data and image data for AI processing

### Server-Side Processing
1. **Text Analysis**: First, the drawing is analyzed to extract any textual labels or identify objects.
2. **Image Generation**: The drawing is sent to GPT-image-1 with specific instructions to maintain structural integrity.

### API Configuration
The system supports two generation paths:
- **Azure OpenAI Service** - Using GPT-image-1 directly (preferred)
- **OpenAI API** - Also using GPT-image-1 directly

To configure Azure OpenAI access, set these environment variables:
- `AZURE_OPENAI_API_KEY`: Your Azure OpenAI API key
- `AZURE_OPENAI_ENDPOINT`: Your Azure OpenAI endpoint URL

### API Endpoints
- `/api/ai/analyze`: Extracts text and analyzes the drawing content
- `/api/ai/generate-image`: Generates the final image using GPT-image-1

## Usage Tips

- **Simple Structures**: Works best with clear, simple structures
- **Add Labels**: Write text labels on your drawing to help the AI understand what you're drawing
- **Use Color**: The AI will consider the colors in your sketch
- **Leave Space**: Don't overcrowd your drawing - leave some space between elements
- **Be Specific**: GPT-image-1 excels at following precise instructions, so add clear labels

## Example Use Cases

- Quickly visualize a sketch as a professional illustration
- Generate realistic imagery from simple outlines
- Create concept art by drawing basic shapes and having AI fill in details
- Educational tool for teaching about AI image generation
- Prototyping UI/UX designs with automatic rendering