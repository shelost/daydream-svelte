# Fix SVG to PNG Conversion in Analyze-Strokes API

## Problem
The analyze-strokes API was failing inconsistently when converting SVG drawings to PNG format for OpenAI's Vision API analysis. This was causing the enhanced shape recognition feature to fail silently in some cases.

## Solution
This PR adds robust error handling and debugging to properly diagnose and fix SVG to PNG conversion issues:

1. **Enhanced Error Reporting**:
   - Added detailed logging throughout the SVG generation and PNG conversion process
   - Improved error handling to provide clearer feedback when conversion fails
   - Created debug endpoints to test each step of the process independently

2. **Improved SVG to PNG Conversion**:
   - Updated the `svgToPngDataUrl` function with more robust validation
   - Added explicit width, height, and background settings to ensure proper rendering
   - Fixed issues with SVG namespace and attribute handling

3. **Better Fallback Behavior**:
   - When SVG to PNG conversion fails, the API now gracefully falls back to basic shape detection
   - Error information is properly returned to the client for better debugging
   - Added specific error handling for cases when the OpenAI API key is missing

4. **Testing**:
   - Added debug endpoints for testing SVG generation, PNG conversion, and the entire workflow:
     - `/api/debug/test-svg-to-png`: Tests basic SVG to PNG conversion
     - `/api/debug/test-complex-svg`: Tests conversion with actual stroke data
     - `/api/debug/test-analyze-strokes`: Tests the full API flow with sample strokes

## Testing
The changes have been tested extensively with various stroke patterns. The SVG to PNG conversion now works reliably, and error cases are properly handled with useful error messages.

## Notes
- The changes are focused on improving reliability and error handling, with minimal changes to the core functionality
- All debugging endpoints are intended for development use only and should not be included in production builds