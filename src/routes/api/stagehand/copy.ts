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

// Console capture for streaming logs
let logStreamCallback: ((logData: any) => void) | null = null;
let originalConsoleLog: any = null;
let originalConsoleInfo: any = null;
let originalConsoleWarn: any = null;
let originalConsoleError: any = null;

function startLogCapture(streamCallback: (logData: any) => void) {
  logStreamCallback = streamCallback;

  // Capture console.log from Stagehand
  if (!originalConsoleLog) {
    originalConsoleLog = console.log;
    originalConsoleInfo = console.info;
    originalConsoleWarn = console.warn;
    originalConsoleError = console.error;
  }

  console.log = (...args) => {
    originalConsoleLog(...args);
    if (logStreamCallback) {
      parseAndStreamLog('log', args);
    }
  };

  console.info = (...args) => {
    originalConsoleInfo(...args);
    if (logStreamCallback) {
      parseAndStreamLog('info', args);
    }
  };

  console.warn = (...args) => {
    originalConsoleWarn(...args);
    if (logStreamCallback) {
      parseAndStreamLog('warn', args);
    }
  };

  console.error = (...args) => {
    originalConsoleError(...args);
    if (logStreamCallback) {
      parseAndStreamLog('error', args);
    }
  };
}

function stopLogCapture() {
  if (originalConsoleLog) {
    console.log = originalConsoleLog;
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  }
  logStreamCallback = null;
}

function parseAndStreamLog(level: string, args: any[]) {
  if (!logStreamCallback) return;

  let message = args
    .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg))
    .join(' ');

  let pillType: 'reasoning' | 'action' | 'summary' = 'reasoning';
  let description = message;
  let fullDetails: any = args; // Default to full args

  // Attempt to parse structured logs from Stagehand or CU agent
  if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
    const logEntry = args[0];
    fullDetails = logEntry; // Store the original object

    // Check for Anthropic CU agent tool_use format
    if (logEntry.type === 'tool_use' && logEntry.name === 'computer' && logEntry.input) {
      pillType = 'action';
      const input = logEntry.input;
      description = `CU: ${input.action}`;
      if (input.coordinate) description += ` at [${input.coordinate.join(', ')}]`;
      if (input.text) description += ` '${input.text}'`;
      if (input.url) description += ` ${input.url}`;
      if (input.query) description += ` for '${input.query}'`;
       // Add more specific descriptions as needed
    }
    // Check for Stagehand's own structured log format (heuristic)
    else if (logEntry.category === 'agent' && logEntry.message) {
      description = logEntry.message;
      if (logEntry.message.toLowerCase().includes('executing action:')) {
        pillType = 'action';
      } else {
        pillType = 'reasoning';
      }
    } else if (logEntry.action && logEntry.reasoning) { // Common pattern for actions
      pillType = 'action';
      description = logEntry.action || 'Performing action';
      if (logEntry.parameters) description += `: ${JSON.stringify(logEntry.parameters)}`;
    } else if (logEntry.observation) {
      pillType = 'reasoning';
      description = `Observation: ${logEntry.observation}`;
    }
    // Add other specific log structure parsers here
  } else {
    // Simpler heuristic for non-object logs
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('executing action:') || lowerMessage.includes('action:') || lowerMessage.includes('performing action')) {
      pillType = 'action';
    } else if (lowerMessage.includes('observation:') || lowerMessage.includes('reasoning:') || lowerMessage.includes('INFO:')) {
      pillType = 'reasoning';
    }
  }

  // Filter out less useful logs or reformat them
  if (description.startsWith("Starting Anthropic agent execution with instruction:")) {
    description = "CU: Starting execution...";
    pillType = 'reasoning';
  }
  if (description.startsWith("Taking screenshot and sending to agent")) {
    description = "CU: Analyzing screen...";
    pillType = 'reasoning';
  }
   if (description.includes("Error executing action")) {
    pillType = 'action'; // Still an action, but an error occurred
    description = `CU: Error - ${description}`;
  }


  const pillData = {
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type: pillType,
    description: description,               // full, un-truncated description
    descriptionShort: description.length > 200 ? description.substring(0, 197) + '...' : description,
    fullDetails: fullDetails,               // parsed structured object when available
    rawArgs: args                           // original console arguments for maximum fidelity
  };

  logStreamCallback(pillData);
}

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
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID || envVars.BROWSERBASE_PROJECT_ID;
const BROWSERBASE_API_BASE = process.env.BROWSERBASE_API_BASE || envVars.BROWSERBASE_API_BASE || 'https://api.browserbase.com/v1';
const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY || envVars.BROWSERBASE_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || envVars.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || envVars.OPENAI_API_KEY;

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
  if (!sessionId) {
    console.error('❌ getBrowserbaseLiveViewUrl called with no sessionId');
    return null;
  }
  if (!BROWSERBASE_API_KEY) {
    console.error('❌ No Browserbase API key set. Cannot fetch live view URL.');
    return null;
  }
  console.log('🔍 Fetching live view URL from Browserbase Session Live URLs API...');
  try {
    const response = await fetch(`${BROWSERBASE_API_BASE}/sessions/${sessionId}/live-urls`, {
      headers: { 'X-BB-API-Key': BROWSERBASE_API_KEY },
    });
    if (response.ok) {
      const data = await response.json();
      const preferredUrl = data.debuggerFullscreenUrl || data.debuggerUrl || data.liveViewUrl;
      if (preferredUrl) {
        return preferredUrl;
      }
    }
    console.warn(`⚠️ Session Live URLs API failed: ${response.status} ${await response.text()}. Will attempt fallback.`);
  } catch (error) {
    console.error('❌ Error fetching from Session Live URLs API:', error);
    console.warn('⚠️ Will attempt fallback due to Session Live URLs API error.');
  }

  // Fallback to debug endpoint
  console.log('🔍 Trying debug endpoint as fallback for live view URL...');
  try {
    const debugResponse = await fetch(`${BROWSERBASE_API_BASE}/sessions/${sessionId}/debug`, {
      headers: { 'X-BB-API-Key': BROWSERBASE_API_KEY },
    });
    if (debugResponse.ok) {
      const debugData = await debugResponse.json();
      //console.log('🔍 Debug response:', JSON.stringify(debugData, null, 2));
      if (debugData.pages && debugData.pages.length > 0) {
        const activePage = debugData.pages[0];
        if (activePage.debuggerFullscreenUrl) {
          return activePage.debuggerFullscreenUrl;
        }
        if (activePage.debuggerUrl) {
          return activePage.debuggerUrl;
        }
      }
      if (debugData.debuggerFullscreenUrl) {
        return debugData.debuggerFullscreenUrl;
      }
      if (debugData.debuggerUrl) {
        return debugData.debuggerUrl;
      }
    }
    console.error(`❌ Debug endpoint also failed: ${debugResponse.status} ${await debugResponse.text()}`);
  } catch (error) {
    console.error('❌ Error fetching from debug endpoint:', error);
  }

  console.error(`❌❌❌ Failed to get any live view URL for session ${sessionId} from both primary and fallback endpoints.`);
  // Defensive: trigger session cleanup or return null so next request will recreate session
  // (You may want to call closeSession() here if you want to force cleanup)
  return null;
}

// Function to ensure we have a valid session (reuse existing or create new)
async function ensureValidSession(): Promise<{ sessionId: string; liveViewUrl: string; stagehandAgent: any }> {
  // If we're already initializing, wait for it to complete
  if (sessionInitializing) {
    console.log('⏳ Session initialization in progress, waiting...');
    while (sessionInitializing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (globalStagehandSession && globalSessionId && globalLiveViewUrl) {
      console.log('✅ Using session created by parallel request');
      const agent = globalStagehandSession.agent({
        provider: 'anthropic', // Default to Anthropic for Computer Use
        model: 'claude-3-7-sonnet-20250219', // Use the latest Sonnet, or a specific CU model
        options: {
          apiKey: ANTHROPIC_API_KEY,
        },
        // instructions: "You are a helpful assistant that can use a web browser. Do not ask follow up questions, the user will trust your judgement." // Optional custom instructions
      });
      return { sessionId: globalSessionId, liveViewUrl: globalLiveViewUrl, stagehandAgent: agent };
    }
  }

  // Check if we have a valid existing session
  if (await isSessionValid()) {
    //console.log('♻️ Reusing existing Stagehand session:', globalSessionId);

    // Refresh live view URL to make sure it's current
    if (globalSessionId) {
      const updatedLiveViewUrl = await getBrowserbaseLiveViewUrl(globalSessionId);
      if (updatedLiveViewUrl) {
        globalLiveViewUrl = updatedLiveViewUrl;
      }
    }
    const agent = globalStagehandSession.agent({
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      options: {
        apiKey: ANTHROPIC_API_KEY,
      },
    });
    return { sessionId: globalSessionId!, liveViewUrl: globalLiveViewUrl!, stagehandAgent: agent };
  }

  // Need to create a new session
  sessionInitializing = true;
  console.log('🚀 Creating new Stagehand session for Computer Use...');

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
      // modelName and modelClientOptions are for the default agent,
      // Computer Use agent will specify its own model and provider.
      enableCaching: false,
      verbose: 1,
      domSettleTimeoutMs: 2000,
      browserbaseSessionCreateParams: {
        projectId: BROWSERBASE_PROJECT_ID!, // Ensure projectId is non-null
        keepAlive: true,
        timeout: 3600,
        browserSettings: { // Required for Computer Use agents
          viewport: {
            width: 1440, // Standard desktop width
            height: 900, // Standard desktop height
          },
          // blockAds: true, // Optional: consider if this affects target sites
        },
      },
    });

    console.log('🔗 Calling stagehand.init()...');
    const sessionDetails = await stagehand.init();
    console.log('📊 Session details from Stagehand:', JSON.stringify(sessionDetails, null, 2));

    const sessionId = sessionDetails?.sessionId;
    if (!sessionId) {
      throw new Error('Failed to get session ID from Stagehand initialization');
    }
    console.log('✅ New Stagehand session created. Session ID:', sessionId);

    const liveViewUrl = await getBrowserbaseLiveViewUrl(sessionId);
    if (!liveViewUrl) {
      throw new Error('Failed to get live view URL for session');
    }

    globalStagehandSession = stagehand;
    globalSessionId = sessionId;
    globalLiveViewUrl = liveViewUrl;

    console.log('🎯 Session stored globally for reuse');

    const agent = globalStagehandSession.agent({
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219', // Or specific computer use model if listed by Stagehand/Anthropic for this
      options: {
        apiKey: ANTHROPIC_API_KEY,
      },
    });

    return { sessionId, liveViewUrl, stagehandAgent: agent };

  } finally {
    sessionInitializing = false;
  }
}

// Function to close session completely
async function closeSession(sessionIdToClose?: string) {
  const targetSessionId = sessionIdToClose || globalSessionId;
  let sessionToClose = globalStagehandSession;

  if (sessionIdToClose && sessionIdToClose !== globalSessionId) {
    console.warn(`Attempting to close session ${sessionIdToClose} which is not the current global session ${globalSessionId}. This might indicate a logic issue or cleanup of a specific stale session.`);
    // If we had a way to get a Stagehand instance by ID, we would use it here.
    // For now, we can only close the global one or proceed to Browserbase direct deletion.
  }

  if (sessionToClose && targetSessionId) {
    console.log('🧹 Closing Stagehand session object for ID:', targetSessionId);
    try {
      await sessionToClose.close(); // This should ideally also trigger Browserbase session close via Stagehand lib
      console.log('✅ Stagehand session object closed successfully for ID:', targetSessionId);
    } catch (error) {
      console.warn(`⚠️ Error closing Stagehand session object for ID ${targetSessionId}:`, error.message);
    }
  }

  // Always attempt to directly terminate the Browserbase session as a safeguard
  if (targetSessionId && BROWSERBASE_API_BASE && BROWSERBASE_API_KEY) {
    console.log(` diretamente Browserbase session for ID: ${targetSessionId}`);
    try {
      const response = await fetch(`${BROWSERBASE_API_BASE}/sessions/${targetSessionId}`, {
        method: 'DELETE',
        headers: { 'X-BB-API-Key': BROWSERBASE_API_KEY },
      });
      if (response.ok) {
        console.log(`✅ Browserbase session ${targetSessionId} terminated directly.`);
      } else if (response.status === 404) {
        console.log(`☑️ Browserbase session ${targetSessionId} was already terminated or not found (404).`);
      } else {
        console.warn(`⚠️ Failed to directly terminate Browserbase session ${targetSessionId}: ${response.status} ${await response.text()}`);
      }
    } catch (error) {
      console.warn(`❌ Error directly terminating Browserbase session ${targetSessionId}:`, error.message);
    }
  }

  // If the closed session was the global one, reset globals
  if (targetSessionId === globalSessionId) {
    globalStagehandSession = null;
    globalSessionId = null;
    globalLiveViewUrl = null;
    console.log('🌍 Global session variables reset.');
  }
}

export async function POST({ request }) {
  const body = await request.json();
  const { command, chatId, stream = false, agentProvider = 'anthropic', agentModel = 'claude-3-7-sonnet-20250219', initUrl } = body; // Allow client to specify agent and initUrl

  if (!command && !initUrl) {
    return json({ success: false, error: 'Either command or initUrl must be provided' }, { status: 400 });
  }

  if (!BROWSERBASE_API_BASE || !BROWSERBASE_PROJECT_ID ) {
    return json({ success: false, error: 'Server configuration error: Missing Browserbase API keys.' }, { status: 500 });
  }

  // Validate API key for the selected provider
  let selectedApiKey;
  if (agentProvider === 'anthropic') {
    selectedApiKey = ANTHROPIC_API_KEY;
  } else if (agentProvider === 'openai') {
    selectedApiKey = OPENAI_API_KEY; // Assuming OPENAI_API_KEY is also loaded
  }

  if (!selectedApiKey) {
    return json({ success: false, error: `API key for provider '${agentProvider}' is missing.` }, { status: 500 });
  }

  console.log(`🤖 Stagehand (CU) received command: "${command}" (chatId: ${chatId}, stream: ${stream}, provider: ${agentProvider}, model: ${agentModel}, initUrl: ${initUrl})`);

  // If only initUrl is provided (bootstrap navigation) perform direct navigation without using CU agent
  if (initUrl && !command) {
    try {
      const { sessionId, liveViewUrl } = await ensureValidSession();

      console.log(`🌐 [Bootstrap] Navigating to initial URL: ${initUrl}`);
      if (globalStagehandSession?.page) {
        await globalStagehandSession.page.goto(initUrl, { waitUntil: 'domcontentloaded' });
      } else {
        throw new Error('Stagehand page object not available after session initialization');
      }

      // Optional screenshot after navigation
      let finalScreenshot: string | null = null;
      try {
        const screenshotBuffer = await globalStagehandSession.page.screenshot();
        finalScreenshot = screenshotBuffer.toString('base64');
      } catch (sErr) {
        console.warn('⚠️ Could not take screenshot after initial navigation:', sErr.message);
      }

      return json({
        success: true,
        message: `Navigated to ${initUrl}`,
        screenshot: finalScreenshot,
        liveViewUrl,
        sessionId,
        sessionReused: false
      });
    } catch (navError) {
      console.error('❌ Error during direct initUrl navigation:', navError);
      return json({ success: false, error: navError.message || 'Failed direct navigation to initUrl' }, { status: 500 });
    }
  }

  // Handle streaming requests
  if (stream) {
    return new Response(
      new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();

          function sendEvent(eventType: string, data: any) {
            const eventData = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
            controller.enqueue(encoder.encode(eventData));
          }

          try {
            // Capture console.log and forward the parsed pill object as-is
            startLogCapture((pillData) => {
              sendEvent('pill', pillData);
            });

            sendEvent('start', { message: 'Starting Stagehand CU execution...' });
            const { sessionId, liveViewUrl, stagehandAgent } = await ensureValidSession(); // Gets the configured agent

            // Override agent if client sent specific provider/model
            const activeAgent = globalStagehandSession.agent({
                provider: agentProvider,
                model: agentModel,
                options: { apiKey: selectedApiKey }
            });

            sendEvent('session', { sessionId, liveViewUrl });
            let agentResponse;
            let finalScreenshot = null;

            console.log('🧠 Executing CU command with session:', command);
            if (initUrl) {
              await globalStagehandSession.page.goto(initUrl);
              agentResponse = await activeAgent.execute(command);
            } else {
              agentResponse = await activeAgent.execute(command);
            }
            console.log('💬 Stagehand CU agent response:', agentResponse);

            if (globalStagehandSession.page) {
              try {
                console.log('📸 Taking screenshot CU...');
                const screenshotBuffer = await globalStagehandSession.page.screenshot();
                finalScreenshot = screenshotBuffer.toString('base64');
                console.log('📸 Screenshot CU taken successfully');
              } catch (screenshotError) {
                console.warn('⚠️ CU Could not take screenshot:', screenshotError.message);
              }
            }

            const updatedLiveViewUrl = await getBrowserbaseLiveViewUrl(sessionId);
            if (updatedLiveViewUrl) {
              globalLiveViewUrl = updatedLiveViewUrl;
            }

            sendEvent('complete', {
              success: true,
              message: agentResponse?.message || "Stagehand CU executed the command successfully.",
              actionsPerformed: agentResponse?.actions || [],
              data: agentResponse?.data,
              screenshot: finalScreenshot,
              liveViewUrl: globalLiveViewUrl,
              sessionId: sessionId,
              modelUsed: `Stagehand CU (${agentProvider}/${agentModel})`,
              sessionReused: true
            });

          } catch (error) {
            console.error('❌ Stagehand CU streaming error:', error);
            sendEvent('error', {
              success: false,
              error: error.message || 'An unknown error occurred with Stagehand CU.',
              sessionId: globalSessionId,
              modelUsed: `Stagehand CU (${agentProvider}/${agentModel})`
            });
          } finally {
            stopLogCapture();
            controller.close();
          }
        }
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Cache-Control'
        }
      }
    );
  }

  // Non-streaming execution
  let agentResponse;
  let finalScreenshot = null;

  try {
    const { sessionId, liveViewUrl, stagehandAgent } = await ensureValidSession();

    // Override agent if client sent specific provider/model
    const activeAgent = globalStagehandSession.agent({
        provider: agentProvider,
        model: agentModel,
        options: { apiKey: selectedApiKey }
    });

    console.log('🧠 Executing CU command non-streaming:', command);
    if (initUrl) {
      await globalStagehandSession.page.goto(initUrl);
      agentResponse = await activeAgent.execute(command);
    } else {
      agentResponse = await activeAgent.execute(command);
    }
    console.log('💬 Stagehand CU agent response non-streaming:', agentResponse);

    if (globalStagehandSession.page) {
        try {
            console.log('📸 Taking CU screenshot non-streaming...');
            const screenshotBuffer = await globalStagehandSession.page.screenshot();
            finalScreenshot = screenshotBuffer.toString('base64');
            console.log('📸 CU Screenshot non-streaming taken successfully');
        } catch (screenshotError) {
            console.warn('⚠️ CU Could not take non-streaming screenshot:', screenshotError.message);
        }
    } else {
        console.warn('⚠️ CU No page available for non-streaming screenshot');
    }

    const updatedLiveViewUrl = await getBrowserbaseLiveViewUrl(sessionId);
    if (updatedLiveViewUrl) {
      globalLiveViewUrl = updatedLiveViewUrl;
    }

    console.log('🎯 CU Command executed successfully non-streaming with session:', sessionId);

    return json({
      success: true,
      message: agentResponse?.message || "Stagehand CU executed the command successfully.",
      actionsPerformed: agentResponse?.actions || [],
      data: agentResponse?.data,
      screenshot: finalScreenshot,
      liveViewUrl: globalLiveViewUrl,
      sessionId: sessionId,
      modelUsed: `Stagehand CU (${agentProvider}/${agentModel})`,
      sessionReused: true
    });

  } catch (error) {
    console.error('❌ Stagehand CU non-streaming execution error:', error);
    console.error('❌ CU Error details:', { name: error.name, message: error.message, stack: error.stack });
    console.warn('⚠️ CU Command failed, session may need to be recreated on next request');

    return json({
      success: false,
      error: error.message || 'An unknown error occurred with Stagehand CU.',
      screenshot: finalScreenshot,
      liveViewUrl: globalLiveViewUrl,
      sessionId: globalSessionId,
      modelUsed: `Stagehand CU (${agentProvider}/${agentModel})`
    }, { status: 500 });
  }
}

// Cleanup endpoint to manually close sessions (called when page is closed/refreshed)
export async function DELETE({ request }) {
  console.log('🗑️ DELETE request received for Stagehand session cleanup');
  let requestBody;
  try {
    requestBody = await request.json();
  } catch (e) {
    console.warn('⚠️ DELETE request body is not valid JSON or empty');
    // If body is problematic, we might still try to close the global session if one exists
    // For now, require sessionId for specific cleanup
    return json({ success: false, error: 'Invalid request body' }, { status: 400 });
  }

  const { sessionId } = requestBody;

  if (!sessionId) {
    console.warn('⚠️ No sessionId provided in DELETE request body. Cannot perform targeted cleanup.');
    // Optionally, could decide to clean up globalSessionId if no specific one is passed.
    // For now, let's be strict.
    return json({ success: false, error: 'SessionId is required for deletion' }, { status: 400 });
  }

  console.log(`Targeted DELETE for session ID: ${sessionId}`);
  try {
    await closeSession(sessionId); // Pass the specific sessionId to ensure it's targeted
    return json({
      success: true,
      message: `Session ${sessionId} targeted for cleanup. Associated Browserbase session also targeted.`
    });
  } catch (error) {
    console.error(`❌ Error during targeted session cleanup for ${sessionId}:`, error);
    return json({
      success: false,
      error: error.message || `Failed to close session ${sessionId}`
    }, { status: 500 });
  }
}