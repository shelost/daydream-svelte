// src/routes/api/browserbase/+server.ts
import { json } from '@sveltejs/kit';
import { chromium } from 'playwright';
import { env } from '$env/dynamic/private';

const BROWSERBASE_PROJECT_ID = env.BROWSERBASE_PROJECT_ID;
const BROWSERBASE_KEY = env.BROWSERBASE_KEY;

if (!BROWSERBASE_PROJECT_ID || !BROWSERBASE_KEY) {
  console.error('❌ Missing Browserbase credentials:', {
    hasProjectId: !!BROWSERBASE_PROJECT_ID,
    hasKey: !!BROWSERBASE_KEY
  });
}

interface BrowserbaseSession {
  id: string;
  status: string;
  connectUrl: string;
  page?: any; // Playwright page instance
}

interface BrowserAction {
  type: 'navigate' | 'click' | 'type' | 'screenshot' | 'read' | 'wait' | 'scroll' | 'init';
  selector?: string;
  text?: string;
  url?: string;
  timeout?: number;
}

interface BrowserActionResult {
  success: boolean;
  data?: any;
  screenshot?: string;
  error?: string;
  timestamp: number;
  url?: string;
}

class BrowserbaseService {
  private baseUrl = 'https://www.browserbase.com/v1';
  private headers: HeadersInit;
  private sessions = new Map<string, any>(); // Store Playwright page instances

  constructor() {
    this.headers = {
      'Content-Type': 'application/json',
      'X-BB-API-Key': BROWSERBASE_KEY,
      'X-BB-Project-Id': BROWSERBASE_PROJECT_ID
    };
  }

  async createSession(): Promise<BrowserbaseSession> {
    try {
      // Create Browserbase session
      const response = await fetch(`${this.baseUrl}/sessions`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          projectId: BROWSERBASE_PROJECT_ID
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`);
      }

      const session = await response.json();

      // Connect with Playwright
      const browser = await chromium.connectOverCDP(session.connectUrl);
      const context = browser.contexts()[0];
      const page = await context.newPage();

      // Store the page instance
      this.sessions.set(session.id, page);

      return {
        ...session,
        page
      };
    } catch (error) {
      console.error('Error creating Browserbase session:', error);
      throw error;
    }
  }

  async destroySession(sessionId: string): Promise<void> {
    try {
      // Close Playwright connection
      const page = this.sessions.get(sessionId);
      if (page) {
        await page.context().browser().close();
        this.sessions.delete(sessionId);
      }

      // Destroy Browserbase session
      const response = await fetch(`${this.baseUrl}/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: this.headers
      });

      if (!response.ok) {
        console.warn(`Failed to destroy session: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error destroying session:', error);
    }
  }

  async executeAction(sessionId: string, action: BrowserAction): Promise<BrowserActionResult> {
    const timestamp = Date.now();

    try {
      const page = this.sessions.get(sessionId);
      if (!page && action.type !== 'init') {
        throw new Error('No active page found for session');
      }

      let result: any;

      switch (action.type) {
        case 'init':
          const session = await this.createSession();
          result = { sessionId: session.id, connectUrl: session.connectUrl };
          break;
        case 'navigate':
          await page.goto(action.url!, { waitUntil: 'networkidle' });
          result = { url: action.url, navigated: true };
          break;
        case 'click':
          await page.click(action.selector!);
          result = { clicked: action.selector };
          break;
        case 'type':
          if (action.selector) {
            await page.fill(action.selector, action.text!);
          } else {
            await page.keyboard.type(action.text!);
          }
          result = { typed: action.text, selector: action.selector };
          break;
        case 'screenshot':
          const screenshot = await page.screenshot({ fullPage: false, type: 'png' });
          const base64Screenshot = screenshot.toString('base64');
          result = {
            screenshot: base64Screenshot,
            url: page.url()
          };
          break;
        case 'read':
          const content = await page.textContent(action.selector || 'body');
          result = { content, selector: action.selector };
          break;
        case 'wait':
          await page.waitForTimeout(action.timeout || 1000);
          result = { waited: action.timeout };
          break;
        case 'scroll':
          if (action.selector) {
            await page.locator(action.selector).scrollIntoViewIfNeeded();
          } else {
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          }
          result = { scrolled: true };
          break;
        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }

      // Get current URL for all successful actions
      if (page && action.type !== 'init') {
        result.currentUrl = page.url();
      }

      return {
        success: true,
        data: result,
        url: result.currentUrl,
        timestamp
      };
    } catch (error) {
      console.error(`Browser action ${action.type} failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp
      };
    }
  }
}

// Intent detection patterns
const BROWSER_INTENT_PATTERNS = [
  /open\s+(\w+(?:\.\w+)+|linkedin|facebook|twitter|instagram|youtube)/i,
  /go\s+to\s+(\w+(?:\.\w+)+)/i,
  /visit\s+(\w+(?:\.\w+)+)/i,
  /navigate\s+to\s+(\w+(?:\.\w+)+)/i,
  /log\s*in\s+to\s+(\w+)/i,
  /sign\s+in\s+to\s+(\w+)/i,
  /take\s+a?\s*screenshot/i,
  /click\s+(.*)/i,
  /type\s+(.*)/i,
  /read\s+(.*)/i,
  /scroll\s+(down|up)/i,
  /wait\s+(\d+)/i
];

function detectBrowserIntent(message: string): { isBrowserCommand: boolean; intent?: string; params?: any } {
  const lowerMessage = message.toLowerCase().trim();

  for (const pattern of BROWSER_INTENT_PATTERNS) {
    const match = lowerMessage.match(pattern);
    if (match) {
      return {
        isBrowserCommand: true,
        intent: match[0],
        params: match.slice(1)
      };
    }
  }

  return { isBrowserCommand: false };
}

function parseActionFromMessage(message: string): BrowserAction[] {
  const lowerMessage = message.toLowerCase().trim();
  const actions: BrowserAction[] = [];

  // Navigation patterns
  if (lowerMessage.match(/open\s+(\w+(?:\.\w+)+|linkedin|facebook|twitter|instagram|youtube)/i)) {
    const match = lowerMessage.match(/open\s+(\w+(?:\.\w+)+|linkedin|facebook|twitter|instagram|youtube)/i);
    if (match) {
      let url = match[1];

      // Handle common sites without full URLs
      const siteMap: Record<string, string> = {
        'linkedin': 'https://www.linkedin.com',
        'facebook': 'https://www.facebook.com',
        'twitter': 'https://www.twitter.com',
        'instagram': 'https://www.instagram.com',
        'youtube': 'https://www.youtube.com'
      };

      if (siteMap[url]) {
        url = siteMap[url];
      } else if (!url.startsWith('http')) {
        url = `https://${url}`;
      }

      actions.push({ type: 'navigate', url });
    }
  }

  // Screenshot
  if (lowerMessage.match(/take\s+a?\s*screenshot/i)) {
    actions.push({ type: 'screenshot' });
  }

  // Click actions
  const clickMatch = lowerMessage.match(/click\s+(.*)/i);
  if (clickMatch) {
    actions.push({ type: 'click', selector: clickMatch[1] });
  }

  // Type actions
  const typeMatch = lowerMessage.match(/type\s+"([^"]+)"(?:\s+in\s+(.*))?/i);
  if (typeMatch) {
    actions.push({
      type: 'type',
      text: typeMatch[1],
      selector: typeMatch[2] || 'input, textarea'
    });
  }

  // Wait actions
  const waitMatch = lowerMessage.match(/wait\s+(\d+)/i);
  if (waitMatch) {
    actions.push({ type: 'wait', timeout: parseInt(waitMatch[1]) * 1000 });
  }

  // If no specific actions found but it's a browser command, take a screenshot
  if (actions.length === 0 && detectBrowserIntent(message).isBrowserCommand) {
    actions.push({ type: 'screenshot' });
  }

  return actions;
}

// Session storage for active browser sessions
const activeSessions = new Map<string, string>(); // chatId -> sessionId

export async function POST({ request }) {
  try {
    const { message, chatId, action } = await request.json();

    if (!message && !action) {
      return json({ error: 'Message or action required' }, { status: 400 });
    }

    console.log('🌐 Browserbase API called with:', { message, chatId, action });
    console.log('🔑 Environment check:', {
      hasProjectId: !!BROWSERBASE_PROJECT_ID,
      hasKey: !!BROWSERBASE_KEY,
      projectId: BROWSERBASE_PROJECT_ID?.substring(0, 8) + '...',
      keyLength: BROWSERBASE_KEY?.length
    });

    const browserService = new BrowserbaseService();

    // Handle explicit actions vs message parsing
    let actions: BrowserAction[];
    if (action) {
      actions = [action];
    } else {
      const detection = detectBrowserIntent(message);
      if (!detection.isBrowserCommand) {
        return json({
          isBrowserCommand: false,
          message: 'This doesn\'t appear to be a browser automation command.'
        });
      }
      actions = parseActionFromMessage(message);
    }

    // Get or create session
    let sessionId = activeSessions.get(chatId);
    if (!sessionId) {
      const session = await browserService.createSession();
      sessionId = session.id;
      activeSessions.set(chatId, sessionId);
    }

    // Execute actions
    const results: BrowserActionResult[] = [];
    for (const browserAction of actions) {
      const result = await browserService.executeAction(sessionId, browserAction);
      results.push(result);

      // If action failed, break the chain
      if (!result.success) {
        break;
      }
    }

    // Always take a screenshot at the end for visual feedback
    if (results.length > 0 && results[results.length - 1].success) {
      const screenshotResult = await browserService.executeAction(sessionId, { type: 'screenshot' });
      if (screenshotResult.success) {
        results.push(screenshotResult);
      }
    }

    return json({
      isBrowserCommand: true,
      sessionId,
      actions: actions.map(a => a.type),
      results,
      message: `Executed ${actions.length} browser action(s) successfully.`
    });

  } catch (error) {
    console.error('Browserbase API error:', error);
    return json(
      {
        error: 'Browser automation failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function DELETE({ request }) {
  try {
    const { chatId } = await request.json();

    const sessionId = activeSessions.get(chatId);
    if (sessionId) {
      const browserService = new BrowserbaseService();
      await browserService.destroySession(sessionId);
      activeSessions.delete(chatId);
    }

    return json({ message: 'Browser session ended' });
  } catch (error) {
    console.error('Error ending browser session:', error);
    return json(
      { error: 'Failed to end browser session' },
      { status: 500 }
    );
  }
}
