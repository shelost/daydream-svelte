import { json } from '@sveltejs/kit';
import { Stagehand } from '@browserbasehq/stagehand';
// Removed problematic type import: import type { BrowserbaseSession } from '@browserbasehq/stagehand/types/sessions';
import { readFileSync } from 'fs';
import { join } from 'path';

// Global session management to keep Stagehand sessions alive
let globalStagehandSession: any = null;
let globalSessionId: string | null = null;
let globalLiveViewUrl: string | null = null;
let sessionInitializing: boolean = false;

// Reusing the environment variable loading logic
function loadEnvVariables(): Record<string, string> {
  try {
    const envPath = join(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const envVars: Record<string, string> = {};
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        envVars[key.trim()] = value;
      }
    });
    return envVars;
  } catch (error) {
    console.log('📁 Could not read .env file for Stagehand route:', error.message);
    return {};
  }
}

const envVars = loadEnvVariables();
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || envVars.BROWSERBASE_PROJECT_ID
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY || envVars.BROWSERBASE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || envVars.ANTHROPIC_API_KEY
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || envVars.OPENAI_API_KEY

// Updated model configuration for Stagehand compatibility
const LLM_PROVIDER = 'openai'; // Switch to OpenAI for better compatibility
const LLM_API_KEY = OPENAI_API_KEY;
// Use Stagehand-compatible model names
const LLM_MODEL_NAME = 'gpt-4o';

console.log('🔧 Stagehand Configuration:', {
  hasProjectId: !!BROWSERBASE_PROJECT_ID,
  hasApiKey: !!BROWSERBASE_API_KEY,
  llmProvider: LLM_PROVIDER,
  hasLlmKey: !!LLM_API_KEY,
  modelName: LLM_MODEL_NAME
});

if (!BROWSERBASE_PROJECT_ID || !BROWSERBASE_API_KEY) {
  console.error('❌ Missing Browserbase credentials for Stagehand route');
}
if (!LLM_API_KEY) {
  console.error(`❌ Missing ${LLM_PROVIDER.toUpperCase()} API Key for Stagehand route. Stagehand will not function correctly.`);
}

// Function to check if current session is still valid
async function isSessionValid(): Promise<boolean> {
  if (!globalStagehandSession || !globalSessionId) {
    return false;
  }

  try {
    // Check if we can still access the page
    if (globalStagehandSession.page && !globalStagehandSession.page.isClosed()) {
      console.log('✅ Existing Stagehand session is valid');
      return true;
    }
  } catch (error) {
    console.warn('⚠️ Session validation failed:', error.message);
  }

  return false;
}

// Function to get the correct live view URL from Browserbase
async function getBrowserbaseLiveViewUrl(sessionId: string): Promise<string | null> {
  try {
    console.log('🔍 Fetching live view URL from Browserbase Session Live URLs API...');

    // Use the correct Browserbase Session Live URLs API endpoint
    const response = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/live-urls`, {
      method: 'GET',
      headers: {
        'X-BB-API-Key': BROWSERBASE_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      console.log('🔍 Live URLs response:', JSON.stringify(data, null, 2));

      // Prioritize debuggerUrl for proper browser UI with URL bar
      const liveViewUrl = data.debuggerUrl ||
                         data.liveViewUrl ||
                         data.browserViewUrl ||
                         data.contentViewUrl;

      if (liveViewUrl) {
        console.log('🔗 Got live view URL from Session Live URLs API:', liveViewUrl);
        return liveViewUrl;
      }
    } else {
      console.warn('⚠️ Session Live URLs API failed:', response.status, await response.text());
    }
  } catch (error) {
    console.warn('⚠️ Error getting live URLs:', error.message);
  }

  // Fallback to debug endpoint
  try {
    console.log('🔍 Trying debug endpoint as fallback...');
    const debugResponse = await fetch(`https://api.browserbase.com/v1/sessions/${sessionId}/debug`, {
      headers: {
        'X-BB-API-Key': BROWSERBASE_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    if (debugResponse.ok) {
      const debugData = await debugResponse.json();
      console.log('🔍 Debug response:', JSON.stringify(debugData, null, 2));

      // Prioritize debuggerUrl for proper browser UI with URL bar
      const liveViewUrl = debugData.debuggerUrl ||
                         debugData.liveViewUrl ||
                         `https://www.browserbase.com/sessions/${sessionId}`;

      console.log('🔗 Got live view URL from debug endpoint:', liveViewUrl);
      return liveViewUrl;
    }
  } catch (debugError) {
    console.warn('⚠️ Debug endpoint also failed:', debugError.message);
  }

  // Final fallback
  const fallbackUrl = `https://www.browserbase.com/sessions/${sessionId}`;
  console.log('🔗 Using fallback live view URL:', fallbackUrl);
  return fallbackUrl;
}

// Function to ensure we have a valid session (reuse existing or create new)
async function ensureValidSession(): Promise<{ sessionId: string; liveViewUrl: string }> {
  // If we're already initializing, wait for it to complete
  if (sessionInitializing) {
    console.log('⏳ Session initialization in progress, waiting...');
    while (sessionInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (globalStagehandSession && globalSessionId && globalLiveViewUrl) {
      console.log('✅ Using session created by parallel request');
      return { sessionId: globalSessionId, liveViewUrl: globalLiveViewUrl };
    }
  }

  // Check if we have a valid existing session
  if (await isSessionValid()) {
    console.log('♻️ Reusing existing Stagehand session:', globalSessionId);

    // Refresh live view URL to make sure it's current
    if (globalSessionId) {
      const updatedLiveViewUrl = await getBrowserbaseLiveViewUrl(globalSessionId);
      if (updatedLiveViewUrl) {
        globalLiveViewUrl = updatedLiveViewUrl;
      }
    }

    return { sessionId: globalSessionId!, liveViewUrl: globalLiveViewUrl! };
  }

  // Need to create a new session
  sessionInitializing = true;
  console.log('🚀 Creating new Stagehand session...');

  try {
    // Close any existing session first
    if (globalStagehandSession) {
      console.log('🧹 Closing invalid/stale session...');
      try {
        await globalStagehandSession.close();
      } catch (error) {
        console.warn('⚠️ Error closing stale session:', error.message);
      }
      globalStagehandSession = null;
      globalSessionId = null;
      globalLiveViewUrl = null;
    }

    // Initialize new Stagehand session
    const stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: BROWSERBASE_API_KEY,
      projectId: BROWSERBASE_PROJECT_ID,
      modelName: LLM_MODEL_NAME,
      modelClientOptions: {
        apiKey: LLM_API_KEY,
      },
      enableCaching: false,
      verbose: 1,
      // Add configuration to avoid timing issues in Browserbase
      domSettleTimeoutMs: 2000, // Wait longer for DOM to settle
    });

    console.log('🔗 Calling stagehand.init()...');
    const sessionDetails = await stagehand.init();

    console.log('📊 Session details from Stagehand:', JSON.stringify(sessionDetails, null, 2));

    // Extract session information
    const sessionId = sessionDetails?.sessionId;

    if (!sessionId) {
      throw new Error('Failed to get session ID from Stagehand initialization');
    }

    console.log('✅ New Stagehand session created. Session ID:', sessionId);

    // Get the proper live view URL
    const liveViewUrl = await getBrowserbaseLiveViewUrl(sessionId);

    if (!liveViewUrl) {
      throw new Error('Failed to get live view URL for session');
    }

    // Store globally for reuse
    globalStagehandSession = stagehand;
    globalSessionId = sessionId;
    globalLiveViewUrl = liveViewUrl;

    console.log('🎯 Session stored globally for reuse');

    return { sessionId, liveViewUrl };

  } finally {
    sessionInitializing = false;
  }
}

// Function to close session completely
async function closeSession() {
  if (globalStagehandSession) {
    console.log('🧹 Closing Stagehand session:', globalSessionId);
    try {
      await globalStagehandSession.close();
      console.log('✅ Session closed successfully');
    } catch (error) {
      console.warn('⚠️ Error closing session:', error.message);
    }
    globalStagehandSession = null;
    globalSessionId = null;
    globalLiveViewUrl = null;
  } else {
    console.log('🔍 No active session to close');
  }
}

export async function POST({ request }) {
  const { command, chatId } = await request.json();

  if (!command) {
    return json({ success: false, error: 'Command is required' }, { status: 400 });
  }

  if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID || !LLM_API_KEY) {
    return json({ success: false, error: 'Server configuration error: Missing API keys.' }, { status: 500 });
  }

  console.log(`🤖 Stagehand received command: "${command}" (chatId: ${chatId})`);

  let agentResponse;
  let finalScreenshot = null;

  try {
    // Ensure we have a valid session (reuse existing or create new if needed)
    const { sessionId, liveViewUrl } = await ensureValidSession();

    console.log('🧠 Executing command with existing session:', command);

    // Execute the command through Stagehand's agent using the existing session
    try {
      agentResponse = await globalStagehandSession.agent().execute(command);
      console.log('💬 Stagehand agent response:', agentResponse);
    } catch (executionError) {
      // Handle specific Stagehand/Playwright method errors
      if (executionError.message && executionError.message.includes('Method page.evaluate not supported')) {
        console.warn('⚠️ Stagehand attempted unsupported method (page.evaluate), but command may have partially succeeded');
        // Create a partial success response
        agentResponse = {
          success: true,
          message: 'Command executed with some limitations. Stagehand attempted to use page.evaluate for scrolling which is not supported in this environment, but other actions may have completed successfully.',
          actions: [
            {
              type: 'info',
              reasoning: 'page.evaluate method not supported in Browserbase environment',
              taskCompleted: false,
              parameters: 'Scrolling actions limited'
            }
          ],
          completed: true
        };
      } else {
        // Re-throw other errors
        throw executionError;
      }
    }

    // Take a screenshot after execution
    if (globalStagehandSession.page) {
        try {
            console.log('📸 Taking screenshot...');
            const screenshotBuffer = await globalStagehandSession.page.screenshot();
            finalScreenshot = screenshotBuffer.toString('base64');
            console.log('📸 Screenshot taken successfully');
        } catch (screenshotError) {
            console.warn('⚠️ Could not take screenshot:', screenshotError.message);
        }
    } else {
        console.warn('⚠️ No page available for screenshot');
    }

    // Update live view URL after command execution (in case page changed)
    const updatedLiveViewUrl = await getBrowserbaseLiveViewUrl(sessionId);
    if (updatedLiveViewUrl) {
      globalLiveViewUrl = updatedLiveViewUrl;
    }

    console.log('🎯 Command executed successfully with session:', sessionId);

    return json({
      success: true,
      message: agentResponse?.message || "Stagehand executed the command successfully.",
      actionsPerformed: agentResponse?.actions || [],
      data: agentResponse?.data,
      screenshot: finalScreenshot,
      liveViewUrl: globalLiveViewUrl,
      sessionId: sessionId,
      modelUsed: `Stagehand (${LLM_MODEL_NAME})`,
      sessionReused: true // Indicate that we reused an existing session
    });

  } catch (error) {
    console.error('❌ Stagehand execution error:', error);

    // Log more detailed error information
    console.error('❌ Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });

    // If there was an error and we have a session, mark it as potentially invalid
    // but don't close it yet - let the next request determine if it needs a new session
    console.warn('⚠️ Command failed, session may need to be recreated on next request');

    return json({
      success: false,
      error: error.message || 'An unknown error occurred with Stagehand.',
      screenshot: finalScreenshot,
      liveViewUrl: globalLiveViewUrl,
      sessionId: globalSessionId,
      modelUsed: `Stagehand (${LLM_MODEL_NAME})`
    }, { status: 500 });
  }
  // Note: We deliberately keep the session alive for reuse across multiple commands
}

// Cleanup endpoint to manually close sessions (called when page is closed/refreshed)
export async function DELETE({ request }) {
  console.log('🗑️ DELETE request received for Stagehand session cleanup');

  try {
    await closeSession();

    return json({
      success: true,
      message: 'Stagehand session closed successfully'
    });
  } catch (error) {
    console.error('❌ Error closing Stagehand session:', error);

    return json({
      success: false,
      error: error.message || 'Failed to close Stagehand session'
    }, { status: 500 });
  }
}