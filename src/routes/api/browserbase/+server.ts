// src/routes/api/browserbase/+server.ts
import { json } from '@sveltejs/kit';
import { readFileSync } from 'fs';
import { join } from 'path';

// Manual environment variable loading for SvelteKit API routes
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
    console.log('📁 Could not read .env file:', error.message);
    return {};
  }
}

// Load environment variables
const envVars = loadEnvVariables();
const BROWSERBASE_PROJECT_ID = envVars.BROWSERBASE_PROJECT_ID || process.env.BROWSERBASE_PROJECT_ID;
const BROWSERBASE_API_KEY = envVars.BROWSERBASE_API_KEY || process.env.BROWSERBASE_API_KEY;

// Validate environment variables
if (!BROWSERBASE_PROJECT_ID || !BROWSERBASE_API_KEY) {
  console.error('❌ Missing Browserbase credentials:', {
    hasProjectId: !!BROWSERBASE_PROJECT_ID,
    hasApiKey: !!BROWSERBASE_API_KEY
  });
}

const BROWSERBASE_API_BASE = 'https://api.browserbase.com/v1';

interface BrowserSession {
  id: string;
  projectId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  contextId?: string;
  region?: string;
  keepAlive?: boolean;
  connectUrl?: string;
  seleniumRemoteUrl?: string;
  signingKey?: string;
}

interface BrowserActionResult {
  success: boolean;
  data?: any;
  screenshot?: string;
  error?: string;
  timestamp: number;
  url?: string;
  actionDescription?: string;
}

interface BrowserSessionInfo {
  sessionId: string;
  liveViewUrl?: string;
  currentUrl?: string;
  connectUrl?: string;
  isActive: boolean;
  lastActivity: number;
  status?: string;
}

class DirectBrowserbaseService {
  private sessionInfo: BrowserSessionInfo | null = null;
  private isInitializing = false;

  constructor() {
    console.log('🌐 DirectBrowserbaseService created - using REST API');
  }

  private async makeRequest(endpoint: string, options: RequestInit = {}) {
    const url = `${BROWSERBASE_API_BASE}${endpoint}`;
    const headers = {
      'x-bb-api-key': BROWSERBASE_API_KEY,
      'Content-Type': 'application/json',
      ...options.headers
    };

    console.log(`🌐 Making request to: ${url}`);

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Browserbase API error: ${response.status} - ${errorText}`);
      throw new Error(`Browserbase API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async initializeSession(): Promise<BrowserSessionInfo> {
    if (this.isInitializing) {
      // Wait for existing initialization
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!this.sessionInfo) {
        throw new Error('Session initialization failed');
      }
      return this.sessionInfo;
    }

    if (this.sessionInfo?.isActive) {
      console.log('✅ Returning existing active session');
      return this.sessionInfo;
    }

    this.isInitializing = true;

    try {
      console.log('🚀 Initializing persistent browser session...');

      // Environment variables validation
      if (!BROWSERBASE_API_KEY) {
        throw new Error('BROWSERBASE_API_KEY is required');
      }
      if (!BROWSERBASE_PROJECT_ID) {
        throw new Error('BROWSERBASE_PROJECT_ID is required');
      }

      console.log('🔑 Environment variables validated successfully');

      // Create new session - makeRequest returns parsed JSON, not Response object
      console.log('🎭 Creating new Browserbase session...');
      const session: BrowserSession = await this.makeRequest('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          projectId: BROWSERBASE_PROJECT_ID,
          keepAlive: true,
          browserSettings: {
            viewport: { width: 1280, height: 720 }
          }
        })
      });

      console.log('✅ Session created:', session.id);

      // Get live view URLs using debug endpoint
      console.log('🔍 Getting live view URLs...');
      let liveViewUrl = null;
      try {
        const debugData = await this.makeRequest(`/sessions/${session.id}/debug`, {
          method: 'GET'
        });

        console.log('🔗 Debug data received:', debugData);

        // Extract the fullscreen live view URL
        if (debugData.debuggerFullscreenUrl) {
          liveViewUrl = debugData.debuggerFullscreenUrl;
          console.log('✅ Live view URL obtained:', liveViewUrl);
        } else if (debugData.debuggerUrl) {
          // Fallback to regular debugger URL
          liveViewUrl = debugData.debuggerUrl;
          console.log('✅ Live view URL (fallback) obtained:', liveViewUrl);
        }
      } catch (debugError) {
        console.warn('⚠️ Could not get live view URLs:', debugError.message);
      }

      this.sessionInfo = {
        sessionId: session.id,
        liveViewUrl: liveViewUrl,
        currentUrl: 'about:blank',
        connectUrl: session.connectUrl,
        isActive: true,
        lastActivity: Date.now(),
        status: session.status
      };

      console.log('🎉 Session initialized successfully with live view:', {
        sessionId: session.id,
        hasLiveView: !!liveViewUrl,
        liveViewUrl: liveViewUrl
      });

      return this.sessionInfo;

    } catch (error) {
      console.error('❌ Session initialization failed:', error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  async ensureSessionActive(): Promise<void> {
    if (!this.sessionInfo || !this.sessionInfo.isActive) {
      await this.initializeSession();
    }
  }

  async takeScreenshot(): Promise<string> {
    try {
      await this.ensureSessionActive();

      const response = await this.makeRequest(`/sessions/${this.sessionInfo.sessionId}/screenshot`, {
        method: 'GET'
      });

      return response.screenshot || response.data;
    } catch (error) {
      console.error('❌ Screenshot failed:', error);
      throw error;
    }
  }

  async connectAndNavigate(targetUrl: string): Promise<void> {
    await this.ensureSessionActive();

    if (!this.sessionInfo?.connectUrl) {
      throw new Error('Missing connectUrl for session – cannot navigate');
    }

    // Dynamically import Playwright core to avoid unnecessary bundle size in edge runtimes
    const { chromium } = await import('playwright');

    // Reuse existing connection if already present in globalThis to minimise reconnect overhead
    let browser: any;
    try {
      browser = await chromium.connectOverCDP(this.sessionInfo.connectUrl);
      const defaultContext = browser.contexts()[0] || (await browser.newContext());
      const page = defaultContext.pages()[0] || (await defaultContext.newPage());

      await page.goto(targetUrl, { waitUntil: 'load', timeout: 30000 });
      this.sessionInfo.currentUrl = targetUrl;
      this.sessionInfo.lastActivity = Date.now();
    } catch (err) {
      console.error('❌ Navigation failed:', err);
      throw err;
    }
    // IMPORTANT: do NOT close the browser here – that would terminate the cloud session.
    // Playwright currently doesn't expose a lightweight "disconnect" – calling browser.close() would
    // close the underlying remote browser. We therefore rely on process exit to release the CDP socket.
  }

  async parseNaturalLanguageCommand(command: string): Promise<BrowserActionResult[]> {
    const normalizedCommand = command.toLowerCase().trim();
    const results: BrowserActionResult[] = [];

    // Ensure session is active before any command
    await this.ensureSessionActive();

    if (normalizedCommand.includes('screenshot') || normalizedCommand.includes('capture')) {
      try {
        const screenshot = await this.takeScreenshot();
        results.push({
          success: true,
          data: { screenshot },
          screenshot,
          timestamp: Date.now(),
          actionDescription: 'Took screenshot of current page'
        });
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          timestamp: Date.now(),
          actionDescription: 'Failed to take screenshot'
        });
      }
    } else if (normalizedCommand.includes('go to') || normalizedCommand.includes('open') || normalizedCommand.includes('navigate')) {
      // Extract a URL from the command. If none present, try to construct one.
      const urlMatch = command.match(/(?:go to|open|navigate to?)\s+([^\s]+)/i);
      let rawUrl = urlMatch ? urlMatch[1] : '';
      if (!rawUrl.startsWith('http')) {
        rawUrl = `https://${rawUrl.replace(/^[^a-z0-9]+/i, '')}`; // rudimentary sanitisation
      }

      try {
        await this.connectAndNavigate(rawUrl);
        results.push({
          success: true,
          data: { navigatedTo: rawUrl },
          timestamp: Date.now(),
          url: rawUrl,
          actionDescription: `Navigated browser to ${rawUrl}`
        });
      } catch (err) {
        results.push({
          success: false,
          error: err.message,
          timestamp: Date.now(),
          url: rawUrl,
          actionDescription: `Failed navigation to ${rawUrl}`
        });
      }
    } else {
      // For other commands, provide general guidance
      results.push({
        success: true,
        data: {
          message: `Browser session is active and ready. Use the live view for interactive control, or try commands like "take a screenshot".`,
          sessionId: this.sessionInfo?.sessionId,
          liveViewUrl: this.sessionInfo?.liveViewUrl,
          availableCommands: ['take a screenshot', 'go to [website]', 'open [website]']
        },
        timestamp: Date.now(),
        actionDescription: `Processed command: ${command}`
      });
    }

    // Update live view URL if needed
    if (this.sessionInfo) {
      try {
        console.log('🔄 Refreshing live view URL...');
        const debugData = await this.makeRequest(`/sessions/${this.sessionInfo.sessionId}/debug`, {
          method: 'GET'
        });

        if (debugData.debuggerFullscreenUrl && debugData.debuggerFullscreenUrl !== this.sessionInfo.liveViewUrl) {
          this.sessionInfo.liveViewUrl = debugData.debuggerFullscreenUrl;
          console.log('🔗 Live view URL updated:', this.sessionInfo.liveViewUrl);
        }
      } catch (error) {
        console.warn('⚠️ Could not refresh live view URL:', error.message);
      }
    }

    return results;
  }

  getSessionInfo(): BrowserSessionInfo | null {
    return this.sessionInfo;
  }

  async closeSession(): Promise<void> {
    if (!this.sessionInfo?.sessionId) {
      console.log('🔍 No active session to close');
      return;
    }

    const sessionId = this.sessionInfo.sessionId;
    console.log('🔴 Closing browser session:', sessionId);

    try {
      // Attempt to close the session via Browserbase API
      // DELETE requests don't need a body or content-type header
      const url = `${BROWSERBASE_API_BASE}/sessions/${sessionId}`;
      const headers = {
        'x-bb-api-key': BROWSERBASE_API_KEY
        // No Content-Type header needed for DELETE without body
      };

      console.log(`🌐 Making DELETE request to: ${url}`);

      const response = await fetch(url, {
        method: 'DELETE',
        headers
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Browserbase API error: ${response.status} - ${errorText}`);
      }

      console.log('✅ Session closed via API:', sessionId);
    } catch (error) {
      console.warn('⚠️ Failed to close session via API:', error.message);
      // Continue with cleanup even if API call fails
    } finally {
      // Reset service state regardless of API success
      this.sessionInfo = null;
      this.isInitializing = false;
      console.log('🧹 Service state reset');
    }
  }
}

// Global service instance
let globalBrowserService: DirectBrowserbaseService | null = null;

function getBrowserService(): DirectBrowserbaseService {
  if (!globalBrowserService) {
    globalBrowserService = new DirectBrowserbaseService();
  }
  return globalBrowserService;
}

function detectBrowserIntent(message: string): { isBrowserCommand: boolean; confidence: number } {
  const browserKeywords = [
    'go to', 'open', 'navigate', 'visit', 'browse', 'website', 'url', 'page',
    'click', 'press', 'tap', 'select', 'choose',
    'type', 'enter', 'input', 'fill', 'write',
    'screenshot', 'capture', 'image', 'picture',
    'scroll', 'search', 'find', 'look for',
    'login', 'sign in', 'register', 'submit',
    'google', 'linkedin', 'facebook', 'twitter', 'github'
  ];

  const normalizedMessage = message.toLowerCase();
  const matches = browserKeywords.filter(keyword => normalizedMessage.includes(keyword));

  const confidence = Math.min(matches.length * 0.3, 1.0);
  const isBrowserCommand = confidence > 0.2;

  return { isBrowserCommand, confidence };
}

export async function POST({ request }) {
  try {
    const { message, chatId } = await request.json();

    if (!message || typeof message !== 'string') {
      return json({ error: 'Message is required' }, { status: 400 });
    }

    console.log('🔍 Processing message:', message);

    // Detect if this is a browser command
    const intent = detectBrowserIntent(message);
    console.log('🎯 Intent detection:', intent);

    if (!intent.isBrowserCommand) {
      return json({
        isBrowserCommand: false,
        message: 'This doesn\'t appear to be a browser automation command. Try commands like "go to google.com" or "take a screenshot".',
        confidence: intent.confidence
      });
    }

    // Get browser service and execute command
    const browserService = getBrowserService();

    console.log('🤖 Executing browser command...');
    const results = await browserService.parseNaturalLanguageCommand(message);

    const sessionInfo = browserService.getSessionInfo();

    // Create response
    const actions = results.map(r => r.actionDescription || 'Unknown action');
    const hasSuccess = results.some(r => r.success);
    const hasFailure = results.some(r => !r.success);

    let responseMessage = '';
    if (hasSuccess && !hasFailure) {
      responseMessage = '✅ Browser command executed successfully!';
    } else if (hasSuccess && hasFailure) {
      responseMessage = '⚠️ Browser command partially completed with some errors.';
    } else {
      responseMessage = '❌ Browser command failed to execute.';
    }

    return json({
      success: true,
      isBrowserCommand: intent.isBrowserCommand,
      message: `Browser automation ${intent.isBrowserCommand ? 'executed' : 'attempted'}`,
      sessionId: browserService.getSessionInfo()?.sessionId,
      liveViewUrl: browserService.getSessionInfo()?.liveViewUrl,
      results,
      actions: [message],
      confidence: intent.confidence,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('❌ Error in browser automation:', error);
    return json({
      isBrowserCommand: true,
      message: 'Browser automation error occurred.',
      error: error.message,
      results: [{
        success: false,
        error: error.message,
        timestamp: Date.now(),
        actionDescription: 'Failed to process browser command'
      }]
    }, { status: 500 });
  }
}

export async function DELETE({ request }) {
  console.log('🗑️ DELETE request received for session cleanup');

  try {
    let sessionId;

    // Handle both regular DELETE requests and sendBeacon requests
    const contentType = request.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const body = await request.json();
      sessionId = body.sessionId;
    } else {
      // Handle sendBeacon or other non-JSON requests
      const body = await request.text();
      try {
        const parsed = JSON.parse(body);
        sessionId = parsed.sessionId;
      } catch {
        console.warn('⚠️ Could not parse DELETE request body');
        return json({ success: false, error: 'Invalid request body' }, { status: 400 });
      }
    }

    if (!sessionId) {
      console.warn('⚠️ No sessionId provided in DELETE request');
      return json({ success: false, error: 'sessionId is required' }, { status: 400 });
    }

    console.log('🔄 Attempting to close session:', sessionId);

    const browserService = getBrowserService();
    await browserService.closeSession();

    console.log('✅ Session cleanup completed successfully');

    return json({
      success: true,
      message: 'Session closed successfully',
      sessionId
    });

  } catch (error) {
    console.error('❌ Error in session cleanup:', error);

    return json({
      success: false,
      error: error.message || 'Failed to close session',
      timestamp: Date.now()
    }, { status: 500 });
  }
}
