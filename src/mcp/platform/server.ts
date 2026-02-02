import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execSync } from 'node:child_process';
import { tmpdir, hostname, userInfo, uptime, platform, type } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

const currentPlatform = platform();
const isMac = currentPlatform === 'darwin';
const isLinux = currentPlatform === 'linux';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute a shell command with a timeout, returning stdout as a string.
 * Returns null if the command fails or is unavailable.
 */
function safeExec(
  command: string,
  options: { timeout?: number; input?: string } = {},
): string | null {
  try {
    const result = execSync(command, {
      timeout: options.timeout ?? 5_000,
      encoding: 'utf-8',
      input: options.input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return typeof result === 'string' ? result.trimEnd() : null;
  } catch {
    return null;
  }
}

/**
 * Check whether a command is available on the system.
 */
function commandExists(cmd: string): boolean {
  const checkCmd = isMac || isLinux ? `command -v ${cmd}` : `where ${cmd}`;
  return safeExec(checkCmd, { timeout: 3_000 }) !== null;
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'clade-platform',
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// Tool: platform_notify
// ---------------------------------------------------------------------------

server.tool(
  'platform_notify',
  'Send a native system notification.',
  {
    title: z.string().describe('Notification title'),
    message: z.string().describe('Notification message body'),
    sound: z
      .boolean()
      .default(false)
      .describe('Play a sound with the notification'),
  },
  async ({ title, message, sound }) => {
    try {
      if (isMac) {
        const escapedTitle = title.replace(/"/g, '\\"');
        const escapedMessage = message.replace(/"/g, '\\"');
        const soundClause = sound ? ' sound name "default"' : '';
        const script = `display notification "${escapedMessage}" with title "${escapedTitle}"${soundClause}`;
        const result = safeExec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
        if (result === null) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Failed to send notification via osascript.',
              },
            ],
            isError: true,
          };
        }
      } else if (isLinux) {
        if (commandExists('notify-send')) {
          const result = safeExec(
            `notify-send ${JSON.stringify(title)} ${JSON.stringify(message)}`,
          );
          if (result === null) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Failed to send notification via notify-send.',
                },
              ],
              isError: true,
            };
          }
        } else {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No notification tool available. Install notify-send (libnotify) on Linux.',
              },
            ],
            isError: true,
          };
        }
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Notifications not supported on platform: ${currentPlatform}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Notification sent: "${title}"`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error sending notification: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: platform_clipboard_read
// ---------------------------------------------------------------------------

server.tool(
  'platform_clipboard_read',
  'Read the current contents of the system clipboard.',
  {},
  async () => {
    try {
      let content: string | null = null;

      if (isMac) {
        content = safeExec('pbpaste');
      } else if (isLinux) {
        if (commandExists('xclip')) {
          content = safeExec('xclip -selection clipboard -o');
        } else if (commandExists('xsel')) {
          content = safeExec('xsel --clipboard --output');
        } else {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No clipboard tool available. Install xclip or xsel on Linux.',
              },
            ],
            isError: true,
          };
        }
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Clipboard read not supported on platform: ${currentPlatform}`,
            },
          ],
          isError: true,
        };
      }

      if (content === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Clipboard is empty or could not be read.',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: content,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error reading clipboard: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: platform_clipboard_write
// ---------------------------------------------------------------------------

server.tool(
  'platform_clipboard_write',
  'Write content to the system clipboard.',
  {
    content: z.string().describe('Content to write to the clipboard'),
  },
  async ({ content }) => {
    try {
      let success = false;

      if (isMac) {
        const result = safeExec('pbcopy', { input: content });
        success = result !== null;
      } else if (isLinux) {
        if (commandExists('xclip')) {
          const result = safeExec('xclip -selection clipboard', {
            input: content,
          });
          success = result !== null;
        } else if (commandExists('xsel')) {
          const result = safeExec('xsel --clipboard --input', {
            input: content,
          });
          success = result !== null;
        } else {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No clipboard tool available. Install xclip or xsel on Linux.',
              },
            ],
            isError: true,
          };
        }
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Clipboard write not supported on platform: ${currentPlatform}`,
            },
          ],
          isError: true,
        };
      }

      if (!success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Failed to write to clipboard.',
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Wrote ${content.length} characters to clipboard.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error writing to clipboard: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: platform_open
// ---------------------------------------------------------------------------

server.tool(
  'platform_open',
  'Open a URL or file in the default application.',
  {
    target: z.string().describe('URL or file path to open'),
  },
  async ({ target }) => {
    try {
      let result: string | null = null;

      if (isMac) {
        result = safeExec(`open ${JSON.stringify(target)}`);
      } else if (isLinux) {
        if (commandExists('xdg-open')) {
          result = safeExec(`xdg-open ${JSON.stringify(target)}`);
        } else {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'xdg-open is not available. Install xdg-utils on Linux.',
              },
            ],
            isError: true,
          };
        }
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Open not supported on platform: ${currentPlatform}`,
            },
          ],
          isError: true,
        };
      }

      if (result === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to open: ${target}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Opened: ${target}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error opening target: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: platform_screenshot
// ---------------------------------------------------------------------------

server.tool(
  'platform_screenshot',
  'Take a screenshot and return the file path.',
  {
    outputPath: z
      .string()
      .optional()
      .describe(
        'Output file path for the screenshot. Defaults to a temp file.',
      ),
  },
  async ({ outputPath }) => {
    try {
      const screenshotPath =
        outputPath ?? join(tmpdir(), `screenshot-${Date.now()}.png`);

      let result: string | null = null;

      if (isMac) {
        result = safeExec(`screencapture -x ${JSON.stringify(screenshotPath)}`, {
          timeout: 10_000,
        });
      } else if (isLinux) {
        if (commandExists('import')) {
          result = safeExec(
            `import -window root ${JSON.stringify(screenshotPath)}`,
            { timeout: 10_000 },
          );
        } else if (commandExists('gnome-screenshot')) {
          result = safeExec(
            `gnome-screenshot -f ${JSON.stringify(screenshotPath)}`,
            { timeout: 10_000 },
          );
        } else {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No screenshot tool available. Install ImageMagick (import) or gnome-screenshot on Linux.',
              },
            ],
            isError: true,
          };
        }
      } else {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Screenshots not supported on platform: ${currentPlatform}`,
            },
          ],
          isError: true,
        };
      }

      if (result === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to take screenshot. The command may not be available or display access is restricted.`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Screenshot saved to: ${screenshotPath}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error taking screenshot: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: platform_info
// ---------------------------------------------------------------------------

server.tool(
  'platform_info',
  'Get system information about the current platform.',
  {},
  async () => {
    try {
      const info = {
        os: `${type()} ${currentPlatform}`,
        hostname: hostname(),
        username: userInfo().username,
        shell: process.env['SHELL'] ?? process.env['COMSPEC'] ?? 'unknown',
        terminal: process.env['TERM_PROGRAM'] ?? process.env['TERM'] ?? 'unknown',
        workingDirectory: process.cwd(),
        uptime: `${Math.floor(uptime() / 3600)}h ${Math.floor((uptime() % 3600) / 60)}m`,
      };

      const lines = [
        '## System Information',
        '',
        `- **OS:** ${info.os}`,
        `- **Hostname:** ${info.hostname}`,
        `- **Username:** ${info.username}`,
        `- **Shell:** ${info.shell}`,
        `- **Terminal:** ${info.terminal}`,
        `- **Working Directory:** ${info.workingDirectory}`,
        `- **Uptime:** ${info.uptime}`,
      ];

      return {
        content: [
          {
            type: 'text' as const,
            text: lines.join('\n'),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error getting system info: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
