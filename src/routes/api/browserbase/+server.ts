// src/routes/api/browserbase/+server.ts
import { json } from '@sveltejs/kit';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as playwright from 'playwright';

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
const ANTHROPIC_API_KEY = envVars.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

// Validate environment variables
if (!BROWSERBASE_PROJECT_ID || !BROWSERBASE_API_KEY) {
  console.error('❌ Missing Browserbase credentials:', {
    hasProjectId: !!BROWSERBASE_PROJECT_ID,
    hasApiKey: !!BROWSERBASE_API_KEY
  });
}

if (!ANTHROPIC_API_KEY) {
  console.warn('⚠️ ANTHROPIC_API_KEY not found - intelligent command parsing will use fallback mode');
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

interface BrowserAction {
  type: 'navigate' | 'search' | 'click' | 'extract' | 'scroll' | 'wait' | 'type';
  url?: string;
  query?: string;
  target?: string;
  text?: string;
  selector?: string;
  direction?: string;
  waitTime?: number;
  description?: string;
}

interface ParsedCommand {
  intent: string;
  platform?: string;
  actions: BrowserAction[];
  reasoning?: string;
}

class DirectBrowserbaseService {
  private sessionInfo: BrowserSessionInfo | null = null;
  private isInitializing = false;
  private projectId: string | undefined = BROWSERBASE_PROJECT_ID;
  private browser: playwright.Browser | null = null;
  private context: playwright.BrowserContext | null = null;
  private page: playwright.Page | null = null;

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
        console.warn('⚠️ Waited for another initialization that failed. Proceeding to create a new session.');
      } else {
        console.log('✅ Another initialization completed. Returning its session.');
        return this.sessionInfo;
      }
    }

    this.isInitializing = true;

    try {
      // Aggressively close any existing session Info this service instance might hold
      if (this.sessionInfo && this.sessionInfo.sessionId) {
        console.log(`🚀 Initializing new session, but service instance still holds old session ${this.sessionInfo.sessionId}. Attempting to close it first.`);
        const oldSessionIdToClose = this.sessionInfo.sessionId;
        // Clear local state before attempting to close to prevent race conditions
        this.sessionInfo = null;
        try {
          await this.makeRequest(`/sessions/${oldSessionIdToClose}`, { method: 'DELETE' });
          console.log(`👻 Successfully closed lingering session ${oldSessionIdToClose} from service instance before new init.`);
        } catch (e: any) {
          console.warn(`⚠️ Could not close lingering session ${oldSessionIdToClose} from service instance:`, e.message);
        }
      }

      const stealthArgs = [
        '--disable-blink-features=AutomationControlled',
        // Add other stealth-related arguments here if needed in the future
        // e.g., '--disable-infobars', '--window-size=1920,1080',
        // '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.84 Safari/537.36'
      ];

      console.log('🚀 Initializing new Browserbase session with stealth arguments:', stealthArgs);
      const sessionData: BrowserSession = await this.makeRequest('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          projectId: this.projectId,
          keepAlive: true, // Allow reconnection after disconnect
          timeout: 3600, // Set custom timeout to 1 hour (3600 seconds)
          browserSettings: { // Add browserSettings for stealth
            args: stealthArgs,
            viewport: {
              width: 1440,
              height: 900,
            },
            // We could also explore other settings like 'fingerprintId' or 'proxy' here in the future
          }
        }),
      });

      if (!sessionData || !sessionData.id) {
        throw new Error('Failed to initialize session or session ID missing.');
      }

      this.sessionInfo = {
        sessionId: sessionData.id,
        liveViewUrl: sessionData.connectUrl,
        currentUrl: '', // Will be updated by navigation
        connectUrl: sessionData.connectUrl, // Store the connectUrl for Playwright
        isActive: true,
        lastActivity: Date.now(),
        status: sessionData.status
      };

      console.log('✅ Browserbase session initialized:', this.sessionInfo.sessionId, 'Status:', this.sessionInfo.status);

      // If the session is immediately 'RUNNING' or 'PROXYING', try to connect Playwright
      if (this.sessionInfo.status === 'RUNNING' || this.sessionInfo.status === 'PROXYING') {
         if (this.sessionInfo.connectUrl) {
            console.log(`Attempting to connect Playwright for session: ${this.sessionInfo.sessionId}`);
            try {
                this.browser = await playwright.chromium.connectOverCDP(this.sessionInfo.connectUrl, { timeout: 30000 });
                console.log(`✅ Playwright connected to Browserbase session: ${this.sessionInfo.sessionId}`);
                const contexts = this.browser.contexts();
                if (contexts.length > 0) {
                    this.context = contexts[0];
                    const pages = this.context.pages();
                    if (pages.length > 0) {
                        this.page = pages[0];
                        this.sessionInfo.currentUrl = this.page.url();
                    } else {
                        console.warn('⚠️ No pages found in the browser context after connection.');
                        // Optionally, create a new page if none exist, though Browserbase usually provides one.
                        // this.page = await this.context.newPage();
                        // console.log('📄 Created a new page in the context.');
                    }
                } else {
                    console.warn('⚠️ No contexts found in the browser after connection. Will create a new one.');
                    // This case might happen if Browserbase session initializes without a default context/page ready for CDP connection.
                    // We might need to create a context and page if this occurs.
                    // this.context = await this.browser.newContext();
                    // this.page = await this.context.newPage();
                    // console.log('📄 Created a new context and page.');
                }
            } catch (connectError: any) {
                console.error(`❌ Playwright connection failed for session ${this.sessionInfo.sessionId}:`, connectError.message);
                // Decide if session should be closed or retried
                await this.closeSession(); // Close if Playwright can't connect
                throw new Error(`Playwright connection failed: ${connectError.message}`);
            }
        } else {
            console.warn(`⚠️ Session ${this.sessionInfo.sessionId} is ${this.sessionInfo.status} but no connectUrl provided.`);
            // This shouldn't happen if status is RUNNING/PROXYING
        }
      } else if (this.sessionInfo.status === 'STARTING'){
        console.log(`⏳ Session ${this.sessionInfo.sessionId} is STARTING. Playwright will connect once it's RUNNING.`);
        // We'll need to poll or wait for a status update if we want to connect Playwright automatically.
        // For now, ensureSessionActive will handle this if called before an action.
      } else {
        console.warn(`⚠️ Session ${this.sessionInfo.sessionId} has unexpected status: ${this.sessionInfo.status}.`);
      }

      return this.sessionInfo;
    } catch (error: any) {
      console.error('❌ Error initializing Browserbase session:', error.message);
      this.sessionInfo = null; // Clear session info on error
      throw error; // Re-throw to be caught by caller
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

  async performSearch(query: string): Promise<void> {
    await this.ensureSessionActive();

    if (!this.sessionInfo?.connectUrl) {
      throw new Error('Missing connectUrl for session – cannot perform search');
    }

    const { chromium } = await import('playwright');

    let browser: any;
    try {
      console.log('🔍 Connecting to browser for search...');
      browser = await chromium.connectOverCDP(this.sessionInfo.connectUrl);
      const defaultContext = browser.contexts()[0] || (await browser.newContext());
      const page = defaultContext.pages()[0] || (await defaultContext.newPage());

      // Wait for page to be ready and verify current URL
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
      const currentUrl = page.url();
      console.log('🌐 Current page URL:', currentUrl);

      // Take a moment to ensure page is fully interactive
      await page.waitForTimeout(1000);

      // Try multiple common search input selectors with detailed debugging
      const searchSelectors = [
        'input[name="q"]',           // Google, DuckDuckGo
        'input[type="search"]',      // Generic search inputs
        'input[placeholder*="search" i]', // Inputs with "search" in placeholder
        'input[aria-label*="search" i]',  // Inputs with "search" in aria-label
        '[data-testid*="search"] input', // Common test ID patterns
        '.search-input',             // Common class names
        '#search-input',             // Common ID names
        'input[name="search"]',      // Generic search name
        'textarea[name="q"]',        // Some sites use textarea
        '[role="searchbox"]',        // ARIA searchbox role
        'input.search',              // Common search class
        '#search',                   // Generic search ID
        '[name="query"]'             // Alternative query name
      ];

      let searchInput = null;
      let workingSelector = null;
      let selectorAttempts = [];

      for (const selector of searchSelectors) {
        try {
          console.log(`🔍 Trying selector: ${selector}`);
          const locator = page.locator(selector).first();

          // Check if element exists
          const count = await locator.count();
          console.log(`📊 Found ${count} elements for selector: ${selector}`);

          if (count > 0) {
            // Check if it's visible
            const isVisible = await locator.isVisible({ timeout: 2000 });
            console.log(`👀 Visibility for ${selector}: ${isVisible}`);

            if (isVisible) {
              // Check if it's enabled and editable
              const isEnabled = await locator.isEnabled();
              const isEditable = await locator.isEditable();
              console.log(`✏️ Enabled: ${isEnabled}, Editable: ${isEditable} for ${selector}`);

              if (isEnabled && isEditable) {
                searchInput = locator;
                workingSelector = selector;
                console.log(`✅ Found working search input: ${selector}`);
          break;
              }
            }
          }

          selectorAttempts.push({
            selector,
            count,
            visible: count > 0 ? await locator.isVisible({ timeout: 500 }).catch(() => false) : false,
            enabled: count > 0 ? await locator.isEnabled().catch(() => false) : false
          });

        } catch (error) {
          console.log(`❌ Error with selector ${selector}:`, error.message);
          selectorAttempts.push({
            selector,
            error: error.message
          });
        }
      }

      if (!searchInput || !workingSelector) {
        console.error('❌ No working search input found. Attempts:', selectorAttempts);
        console.log('🔍 Available inputs on page:');

        try {
          // Log all input elements for debugging
          const allInputs = await page.locator('input').all();
          for (let i = 0; i < allInputs.length; i++) {
            const input = allInputs[i];
            const name = await input.getAttribute('name').catch(() => 'no-name');
            const type = await input.getAttribute('type').catch(() => 'no-type');
            const placeholder = await input.getAttribute('placeholder').catch(() => 'no-placeholder');
            const id = await input.getAttribute('id').catch(() => 'no-id');
            const className = await input.getAttribute('class').catch(() => 'no-class');
            const ariaLabel = await input.getAttribute('aria-label').catch(() => 'no-aria-label');
            const visible = await input.isVisible().catch(() => false);

            console.log(`📝 Input ${i}: name="${name}", type="${type}", placeholder="${placeholder}", id="${id}", class="${className}", aria-label="${ariaLabel}", visible=${visible}`);
          }
        } catch (debugError) {
          console.error('❌ Could not debug page inputs:', debugError.message);
        }

        throw new Error(`No search input found on the current page (${currentUrl}). Checked ${searchSelectors.length} selectors.`);
      }

      console.log(`🎯 Using search input with selector: ${workingSelector}`);

      // Clear existing content and type the search query
      await searchInput.click();
      await searchInput.fill(''); // Clear existing content
      await searchInput.type(query, { delay: 50 }); // Add small delay between keystrokes

      console.log(`⌨️ Typed search query: "${query}"`);

      // Submit the search (try Enter key first, then look for search button)
      await searchInput.press('Enter');
      console.log('⏎ Pressed Enter to submit search');

      // Wait for navigation or search results to load
      try {
        await page.waitForLoadState('networkidle', { timeout: 10000 });
        console.log('✅ Search results loaded (networkidle)');
      } catch (e) {
        console.log('⏳ Network idle timeout, waiting for basic load state...');
        try {
          await page.waitForLoadState('load', { timeout: 5000 });
          console.log('✅ Search results loaded (load)');
        } catch (e2) {
          // If both timeouts fail, just wait a bit for results
          console.log('⏳ Load state timeout, waiting 3 seconds...');
          await page.waitForTimeout(3000);
        }
      }

      const finalUrl = page.url();
      console.log('🏁 Final URL after search:', finalUrl);

      this.sessionInfo.currentUrl = finalUrl;
      this.sessionInfo.lastActivity = Date.now();

    } catch (err) {
      console.error('❌ Search failed:', err);
      throw err;
    }
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
    } else if (normalizedCommand.includes('search for') || normalizedCommand.includes('search:') || normalizedCommand.includes('find')) {
      // Extract search query from command
      const searchMatch = command.match(/(?:search for|search:|find)\s*['""]?([^'""\n]+)['""]?/i);
      let searchQuery = searchMatch ? searchMatch[1].trim() : '';

      // Remove quotes if present
      searchQuery = searchQuery.replace(/^['"]|['"]$/g, '');

      if (!searchQuery) {
        results.push({
          success: false,
          error: 'No search query specified',
          timestamp: Date.now(),
          actionDescription: 'Failed to extract search query from command'
        });
      } else {
        try {
          await this.performSearch(searchQuery);
          results.push({
            success: true,
            data: { searchQuery },
            timestamp: Date.now(),
            actionDescription: `Searched for "${searchQuery}"`
          });
        } catch (error) {
          results.push({
            success: false,
            error: error.message,
            timestamp: Date.now(),
            actionDescription: `Failed to search for "${searchQuery}"`
          });
        }
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
          message: `Browser session is active and ready. Use the live view for interactive control, or try commands like "take a screenshot", "search for [query]", or "go to [website]".`,
          sessionId: this.sessionInfo?.sessionId,
          liveViewUrl: this.sessionInfo?.liveViewUrl,
          availableCommands: ['take a screenshot', 'search for [query]', 'go to [website]', 'open [website]']
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

  // New method to execute structured browser actions from Claude
  async executeStructuredActions(parsedCommand: ParsedCommand): Promise<BrowserActionResult[]> {
    console.log('🎯 Executing structured actions:', parsedCommand);
    const results: BrowserActionResult[] = [];

    // Ensure session is active before any actions
    await this.ensureSessionActive();

    for (let i = 0; i < parsedCommand.actions.length; i++) {
      const action = parsedCommand.actions[i];
      console.log(`🔄 Executing action ${i + 1}/${parsedCommand.actions.length}:`, action);

      try {
      switch (action.type) {
          case 'navigate':
            if (action.url) {
              await this.connectAndNavigate(action.url);
              results.push({
                success: true,
                data: { navigatedTo: action.url },
                timestamp: Date.now(),
                url: action.url,
                actionDescription: action.description || `Navigated to ${action.url}`
              });
            } else {
              throw new Error('Navigate action missing URL');
            }
          break;

          case 'search':
            if (action.query) {
              await this.performSearch(action.query);
              results.push({
                success: true,
                data: { searchQuery: action.query },
                timestamp: Date.now(),
                actionDescription: action.description || `Searched for "${action.query}"`
              });
            } else {
              throw new Error('Search action missing query');
            }
          break;

        case 'click':
          if (action.selector) {
              await this.performClick(action.selector);
              results.push({
                success: true,
                data: { clickTarget: action.selector },
                timestamp: Date.now(),
                actionDescription: action.description || `Clicked element with selector ${action.selector}`
              });
            } else if (action.target) {
              await this.performClick(action.target);
              results.push({
                success: true,
                data: { clickTarget: action.target },
                timestamp: Date.now(),
                actionDescription: action.description || `Clicked on "${action.target}"`
              });
          } else {
              throw new Error('Click action missing target');
            }
            break;

          case 'extract':
            // Extract text content from the current page
            await this.ensureSessionActive();
            const screenshot = await this.takeScreenshot();
            results.push({
              success: true,
              data: { screenshot },
              screenshot,
              timestamp: Date.now(),
              actionDescription: action.description || 'Extracted page content'
            });
            break;

          case 'wait':
            const waitTime = action.waitTime || 2000;
            await new Promise(resolve => setTimeout(resolve, waitTime));
            results.push({
              success: true,
              data: { waitTime },
              timestamp: Date.now(),
              actionDescription: action.description || `Waited ${waitTime}ms`
            });
            break;

          case 'scroll':
            // Scroll action: direction can be 'top','bottom','up','down'
            const dir = action.direction || action.target || 'down';
            await this.performScroll(dir);
            results.push({
              success: true,
              data: { direction: dir },
              timestamp: Date.now(),
              actionDescription: action.description || `Scrolled ${dir}`
            });
            break;

          default:
            console.warn(`⚠️ Unknown action type: ${action.type}`);
            results.push({
              success: false,
              error: `Unknown action type: ${action.type}`,
              timestamp: Date.now(),
              actionDescription: `Failed to execute: ${action.description || action.type}`
            });
        }

        // Small delay between actions to ensure stability
        await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
        console.error(`❌ Action ${i + 1} failed:`, error);
        results.push({
        success: false,
          error: error.message,
          timestamp: Date.now(),
          actionDescription: `Failed: ${action.description || action.type}`
        });

        // Continue with remaining actions even if one fails
        continue;
      }
    }

    // Update live view URL after actions
    if (this.sessionInfo) {
      try {
        const debugData = await this.makeRequest(`/sessions/${this.sessionInfo.sessionId}/debug`, {
          method: 'GET'
        });
        if (debugData.debuggerFullscreenUrl) {
          this.sessionInfo.liveViewUrl = debugData.debuggerFullscreenUrl;
        }
      } catch (error) {
        console.warn('⚠️ Could not refresh live view URL:', error.message);
      }
    }

    return results;
  }

  // Basic click implementation (can be enhanced)
  async performClick(target: string): Promise<void> {
    await this.ensureSessionActive();

    if (!this.sessionInfo?.connectUrl) {
      throw new Error('Missing connectUrl for session – cannot perform click');
    }

    const { chromium } = await import('playwright');

    let browser: any;
    try {
      browser = await chromium.connectOverCDP(this.sessionInfo.connectUrl);
      const defaultContext = browser.contexts()[0] || (await browser.newContext());
      const page = defaultContext.pages()[0] || (await defaultContext.newPage());

      // If input looks like a valid CSS selector (starts with ., #, [ or contains > or space), prioritise that
      const looksLikeSelector = /[\.\#\[\s>]/.test(target);

      const clickSelectors = looksLikeSelector ? [target] : [
        `text="${target}"`,
        `[aria-label="${target}"]`,
        `[title="${target}"]`,
        `button:has-text("${target}")`,
        `a:has-text("${target}")`,
        // Generic ordinal patterns, e.g., 'first video', 'second result'
        ...(target.match(/first|second|third|fourth|fifth/) ? [
          'a',
          'button',
          'div[role="button"]',
          'ytd-video-renderer a#video-title'
        ] : []),
        target // Fallback direct selector/text
      ];

      let clicked = false;
      for (const selector of clickSelectors) {
        try {
          const element = page.locator(selector).first();
          const count = await element.count();
          if (count > 0 && await element.isVisible()) {
            await element.click();
            clicked = true;
            console.log(`✅ Successfully clicked element with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
          continue;
        }
      }

      if (!clicked) {
        throw new Error(`Could not find clickable element: ${target}`);
      }

      this.sessionInfo.lastActivity = Date.now();

    } catch (err) {
      console.error('❌ Click action failed:', err);
      throw err;
    }
  }

  // Simple scroll utility
  async performScroll(direction: string): Promise<void> {
    await this.ensureSessionActive();

    if (!this.sessionInfo?.connectUrl) {
      throw new Error('Missing connectUrl for session – cannot perform scroll');
    }

    const { chromium } = await import('playwright');

    let browser: any;
    try {
      browser = await chromium.connectOverCDP(this.sessionInfo.connectUrl);
      const defaultContext = browser.contexts()[0] || (await browser.newContext());
      const page = defaultContext.pages()[0] || (await defaultContext.newPage());

      switch (direction.toLowerCase()) {
        case 'top':
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          break;
        case 'bottom':
          await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
          break;
        case 'up':
          await page.evaluate(() => window.scrollBy(0, -window.innerHeight));
          break;
        case 'down':
        default:
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          break;
      }

      this.sessionInfo.lastActivity = Date.now();
    } catch (err) {
      console.error('❌ Scroll action failed:', err);
      throw err;
    }
  }

  getSessionInfo(): BrowserSessionInfo | null {
    return this.sessionInfo;
  }

  async closeSession(): Promise<void> {
    if (!this.sessionInfo || !this.sessionInfo.sessionId) {
      console.log('🤷 No active session in this service instance to close.');
      return;
    }

    const sessionIdToClose = this.sessionInfo.sessionId;
    console.log(`🧹 Closing session ${sessionIdToClose} managed by this service instance...`);

    // Disconnect Playwright if connected
    if (this.page && !this.page.isClosed()) {
      try {
        // await this.page.close(); // Closing context is usually better
      } catch (e) { /* console.warn('Error closing page:', e.message) */ }
    }
    if (this.context) {
      try {
        await this.context.close();
        console.log(`🎭 Playwright context for session ${sessionIdToClose} closed.`);
      } catch (e) { console.warn(`⚠️ Error closing Playwright context for ${sessionIdToClose}:`, e.message); }
    }
    if (this.browser && this.browser.isConnected()) {
      try {
        await this.browser.close(); // This might be too aggressive if browser is shared; disconnect is better
        // Or if using connectOverCDP, a simple disconnect might be browser.disconnect() if available
        console.log(`🤖 Playwright browser disconnected for session ${sessionIdToClose}.`);
      } catch (e) { console.warn(`⚠️ Error closing/disconnecting Playwright browser for ${sessionIdToClose}:`, e.message); }
    }
    this.page = null;
    this.context = null;
    this.browser = null;

    // Attempt to delete the session via Browserbase API
    try {
      console.log(`📞 Calling Browserbase API to delete session ${sessionIdToClose}...`);
      const response = await this.makeRequest(`/sessions/${sessionIdToClose}`, { method: 'DELETE' });
      // makeRequest throws on non-ok, so if we reach here, it was successful or handled by makeRequest
      console.log(`✅ Browserbase session ${sessionIdToClose} confirmed deleted via API by service.`);
    } catch (error: any) {
      // Check if the error message or status indicates a 404
      if (error.message && (error.message.includes('404') || error.message.includes('not found'))) {
        console.log(`☑️ Browserbase session ${sessionIdToClose} was already terminated or not found (404) when service tried to close.`);
      } else {
        console.warn(`⚠️ Failed to delete session ${sessionIdToClose} via API from service:`, error.message);
        // Do not re-throw, as we want to ensure local state is cleared.
      }
    }

    // Clear local session state in all cases after attempting API deletion
    console.log(`👻 Cleared local sessionInfo for ${sessionIdToClose} in service instance.`);
    this.sessionInfo = null;
    this.isInitializing = false; // Reset initializing flag too
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
  // Check for explicit browser command prefix (>)
  if (message.trim().startsWith('>')) {
    return { isBrowserCommand: true, confidence: 1.0 };
  }

  const browserKeywords = [
    'go to', 'open', 'navigate', 'visit', 'browse', 'website', 'url', 'page',
    'click', 'press', 'tap', 'select', 'choose',
    'type', 'enter', 'input', 'fill', 'write',
    'search for', 'search:', 'find', 'lookup',
    'screenshot', 'capture', 'image', 'picture',
    'scroll', 'search', 'look for',
    'login', 'sign in', 'register', 'submit',
    'google', 'linkedin', 'facebook', 'twitter', 'github'
  ];

  const normalizedMessage = message.toLowerCase();
  const matches = browserKeywords.filter(keyword => normalizedMessage.includes(keyword));

  const confidence = Math.min(matches.length * 0.3, 1.0);
  const isBrowserCommand = confidence > 0.2;

  return { isBrowserCommand, confidence };
}

// Intelligent command parser using Claude
async function parseNaturalLanguageCommand(userCommand: string): Promise<ParsedCommand> {
  if (!ANTHROPIC_API_KEY) {
    console.warn('⚠️ ANTHROPIC_API_KEY not available - falling back to simple parsing');
    return fallbackCommandParsing(userCommand);
  }

  const prompt = `You are an expert browser automation assistant. Parse this natural language command into structured browser actions.

User command: "${userCommand}"

Analyze the user's intent and break it down into a sequence of browser actions. Common patterns:

1. **Profile/Person Search**: "go to [Person]'s [Platform] page"
   → Navigate to platform → Search for person → Click first result

2. **Topic Search**: "search for [topic]" or "find [topic]"
   → Search on current page or navigate to search engine first

3. **Content Extraction**: "read all posts" or "get the articles"
   → Extract text from relevant elements

4. **Navigation**: "go to [website]" or "open [site]"
   → Navigate directly to URL

5. **Interaction**: "click [element]" or "fill [form]"
   → Interact with specific page elements

Respond with a JSON object in this exact format:
{
  "intent": "brief description of user intent",
  "platform": "platform name if applicable (linkedin, google, etc.)",
  "actions": [
    {
      "type": "action_type",
      "url": "url if navigate action",
      "query": "search query if search action",
      "target": "element description if click action",
      "description": "human readable description"
    }
  ],
  "reasoning": "brief explanation of your interpretation"
}

Action types: navigate, search, click, extract, scroll, wait, type
Keep actions simple and executable. Focus on the user's core intent.

When generating a 'click' action, if possible, include a "selector" field with a robust Playwright selector (CSS or text) so the automation can click reliably. For ordinal clicks like "first video", return a selector like "ytd-video-renderer a#video-title:nth-of-type(1)" or similar.

For 'scroll' actions include a "direction" field with one of "top", "bottom", "up", or "down".`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.content[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Claude response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log('🧠 Claude parsed command:', parsed);
    return parsed;

  } catch (error) {
    console.warn('⚠️ Claude parsing failed:', error.message);
    return fallbackCommandParsing(userCommand);
  }
}

// Fallback parser for when Claude is unavailable
function fallbackCommandParsing(userCommand: string): ParsedCommand {
  const command = userCommand.toLowerCase().trim();

  // Simple pattern matching for common commands
  if (command.includes('linkedin') && (command.includes('page') || command.includes('profile'))) {
    const nameMatch = userCommand.match(/(?:go to|find|open)\s+(.+?)(?:'s?\s+linkedin|on linkedin)/i);
    const personName = nameMatch ? nameMatch[1].trim() : '';

    return {
      intent: 'find_linkedin_profile',
      platform: 'linkedin',
      actions: [
        { type: 'navigate', url: 'https://google..com', description: 'Navigate to LinkedIn' },
        { type: 'search', query: personName, description: `Search for "${personName} linkedin"` },
        { type: 'click', target: 'first profile result', description: 'Click on the first profile result' }
      ],
      reasoning: `Fallback parsing: detected LinkedIn profile search for "${personName}"`
    };
  }

  if (command.includes('search for') || command.includes('find')) {
    const searchMatch = userCommand.match(/(?:search for|find)\s+['""]?([^'""\n]+)['""]?/i);
    const searchQuery = searchMatch ? searchMatch[1].trim() : '';

    return {
      intent: 'search_content',
      actions: [
        { type: 'search', query: searchQuery, description: `Search for "${searchQuery}"` }
      ],
      reasoning: `Fallback parsing: detected search command for "${searchQuery}"`
    };
  }

  if (command.includes('go to') || command.includes('open') || command.includes('navigate')) {
    const urlMatch = userCommand.match(/(?:go to|open|navigate to?)\s+([^\s]+)/i);
    let url = urlMatch ? urlMatch[1] : '';
    if (url && !url.startsWith('http')) {
      url = `https://${url.replace(/^[^a-z0-9]+/i, '')}`;
    }

    return {
      intent: 'navigate_to_url',
      actions: [
        { type: 'navigate', url, description: `Navigate to ${url}` }
      ],
      reasoning: `Fallback parsing: detected navigation to "${url}"`
    };
  }

  // Default fallback
  return {
    intent: 'general_command',
    actions: [
      { type: 'search', query: userCommand, description: `Execute: ${userCommand}` }
    ],
    reasoning: 'Fallback parsing: treating as general search command'
  };
}

export async function POST({ request }) {
  try {
    let { message, chatId } = await request.json();

    if (!message || typeof message !== 'string') {
      return json({ error: 'Message is required' }, { status: 400 });
    }

    console.log('🔍 Processing message:', message);

    // Strip explicit browser command prefix (>) if present
    const originalMessage = message;
    if (message.trim().startsWith('>')) {
      message = message.trim().substring(1).trim();
      console.log('🎯 Explicit browser command detected, stripped prefix:', message);
    }

    // Detect if this is a browser command
    const intent = detectBrowserIntent(originalMessage);
    console.log('🎯 Intent detection:', intent);

    if (!intent.isBrowserCommand) {
        return json({
          isBrowserCommand: false,
        message: 'This doesn\'t appear to be a browser automation command. Try commands like "go to google.com", "search for something", "take a screenshot", or prefix with ">" for explicit browser commands.',
        confidence: intent.confidence
      });
    }

    // Get browser service
    const browserService = getBrowserService();

    console.log('🧠 Parsing command with AI...');
    // Parse command intelligently using Claude
    const parsedCommand = await parseNaturalLanguageCommand(message);
    console.log('🎯 Parsed command:', parsedCommand);

    console.log('🤖 Executing structured browser actions...');
    // Execute the structured actions
    const results = await browserService.executeStructuredActions(parsedCommand);

    const sessionInfo = browserService.getSessionInfo();

    // Create response
    const actions = results.map(r => r.actionDescription || 'Unknown action');
    const hasSuccess = results.some(r => r.success);
    const hasFailure = results.some(r => !r.success);

    let responseMessage = '';
    if (hasSuccess && !hasFailure) {
      responseMessage = `✅ Successfully executed: ${parsedCommand.intent}`;
    } else if (hasSuccess && hasFailure) {
      responseMessage = `⚠️ Partially completed: ${parsedCommand.intent} (some actions failed)`;
    } else {
      responseMessage = `❌ Failed to execute: ${parsedCommand.intent}`;
    }

    // Add reasoning from Claude if available
    if (parsedCommand.reasoning) {
      responseMessage += `\n\n💭 **AI Analysis**: ${parsedCommand.reasoning}`;
    }

    return json({
      success: true,
      isBrowserCommand: intent.isBrowserCommand,
      message: responseMessage,
      sessionId: sessionInfo?.sessionId,
      liveViewUrl: sessionInfo?.liveViewUrl,
      results,
      actions,
      parsedCommand, // Include the parsed command for debugging
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
  let requestBody;
  try {
    // Handle different content types for sessionId extraction
    const contentType = request.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      requestBody = await request.json();
    } else {
      const textBody = await request.text();
      requestBody = JSON.parse(textBody); // Attempt to parse assuming it might be stringified JSON
    }
  } catch (e) {
    console.warn('⚠️ DELETE /api/browserbase: Could not parse request body:', e.message);
    return json({ success: false, error: 'Invalid request body for session deletion.' }, { status: 400 });
  }

  const sessionId = requestBody?.sessionId;

  if (!sessionId) {
    return json({ success: false, error: 'sessionId is required in DELETE request body' }, { status: 400 });
  }

  console.log(`🗑️ Received DELETE request for Browserbase session: ${sessionId}`);

  if (!BROWSERBASE_API_BASE || !BROWSERBASE_API_KEY) {
    console.error('❌ Browserbase API credentials not configured on server for DELETE.');
    return json({ success: false, error: 'Server configuration error for Browserbase API.' }, { status: 500 });
  }

  // Get the singleton browser service instance
  const browserService = getBrowserService();
  const currentServiceSessionInfo = browserService.getSessionInfo();

  try {
    // First, attempt to delete via Browserbase API directly
    const response = await fetch(`${BROWSERBASE_API_BASE}/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { 'X-BB-API-Key': BROWSERBASE_API_KEY }
    });

    let apiDeletionSuccessful = false;
    if (response.ok) {
      console.log(`✅ Browserbase session ${sessionId} terminated successfully via API.`);
      apiDeletionSuccessful = true;
    } else if (response.status === 404) {
      console.log(`☑️ Browserbase session ${sessionId} was already terminated or not found (404) via API. Considered success.`);
      apiDeletionSuccessful = true; // Treat 404 as success for idempotency
    } else {
      const errorText = await response.text();
      console.error(`❌ Failed to terminate Browserbase session ${sessionId} via API: ${response.status}`, errorText);
      // Do not immediately return error; still try to clean up local service if it matches
    }

    // If the session ID matches the one managed by the local service instance, ensure its state is also cleaned.
    if (currentServiceSessionInfo && currentServiceSessionInfo.sessionId === sessionId) {
      console.log(`🧹 Session ${sessionId} matches current service instance. Ensuring local service cleanup.`);
      await browserService.closeSession(); // This is now idempotent and handles Playwright cleanup
    } else if (apiDeletionSuccessful) {
        console.log(`ℹ️ Session ${sessionId} deleted via API did not match active service session (if any). No further local service cleanup needed for this ID.`);
    }

    if (apiDeletionSuccessful) {
        return json({ success: true, message: `Session ${sessionId} cleanup processed. Status: ${response.ok ? 'Terminated' : 'Already_Gone'}` });
    }
    // If we reach here, API deletion failed with something other than 404
    return json({ success: false, error: `Failed to terminate session ${sessionId} via API. Status: ${response.status}` }, { status: response.status || 500 });

  } catch (error) {
    console.error(`❌ Exception during Browserbase session ${sessionId} termination process:`, error);
    // Fallback: ensure local service is cleaned if it was managing this session, even if API call failed before or during
    if (currentServiceSessionInfo && currentServiceSessionInfo.sessionId === sessionId) {
      console.warn(`🌪️ Exception occurred. Attempting fallback cleanup of local service for session ${sessionId}.`);
      try {
        await browserService.closeSession();
      } catch (serviceCloseError) {
        console.error(` Nested error during fallback service cleanup for ${sessionId}:`, serviceCloseError);
      }
    }
    return json({ success: false, error: 'Exception during session termination: ' + error.message }, { status: 500 });
  }
}

// export async function GET({ url }) {
//   // ... (existing GET handler)
// }
