// ---------------------------------------------------------------------------
// Tests: Platform MCP Server
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => {
  return {
    execSync: vi.fn(),
  };
});

vi.mock('node:os', () => {
  return {
    platform: vi.fn(() => 'darwin'),
    tmpdir: vi.fn(() => '/tmp'),
    hostname: vi.fn(() => 'test-host'),
    userInfo: vi.fn(() => ({ username: 'testuser' })),
    uptime: vi.fn(() => 7200),
    type: vi.fn(() => 'Darwin'),
  };
});

// Mock the MCP SDK so we can capture tool registrations without starting a server
const mockToolHandlers = new Map<string, Function>();
const mockToolSchemas = new Map<string, object>();

const mockConnect = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: vi.fn().mockImplementation(() => ({
      tool: vi.fn(
        (
          name: string,
          description: string,
          schema: object,
          handler: Function,
        ) => {
          mockToolHandlers.set(name, handler);
          mockToolSchemas.set(name, schema);
        },
      ),
      connect: mockConnect,
    })),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return {
    StdioServerTransport: vi.fn().mockImplementation(() => ({})),
  };
});

import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const mockExecSync = vi.mocked(execSync);
const mockPlatform = vi.mocked(platform);

// ---------------------------------------------------------------------------
// Helper: invoke a tool handler
// ---------------------------------------------------------------------------

async function callTool(
  name: string,
  params: Record<string, unknown> = {},
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const handler = mockToolHandlers.get(name);
  if (!handler) {
    throw new Error(`Tool "${name}" not registered`);
  }
  return handler(params) as Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Platform MCP Server', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockToolHandlers.clear();
    mockToolSchemas.clear();

    // Default to macOS
    mockPlatform.mockReturnValue('darwin');

    // Default execSync: succeed for command -v checks, return empty for others
    mockExecSync.mockImplementation((cmd: string) => {
      const command = typeof cmd === 'string' ? cmd : String(cmd);
      if (command.startsWith('command -v')) {
        return '/usr/bin/found';
      }
      return '';
    });

    // Re-import to register tools (fresh module)
    vi.resetModules();

    // Re-apply all mocks before reimporting
    vi.doMock('node:child_process', () => ({
      execSync: mockExecSync,
    }));
    vi.doMock('node:os', () => ({
      platform: mockPlatform,
      tmpdir: vi.fn(() => '/tmp'),
      hostname: vi.fn(() => 'test-host'),
      userInfo: vi.fn(() => ({ username: 'testuser' })),
      uptime: vi.fn(() => 7200),
      type: vi.fn(() => 'Darwin'),
    }));
    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
      McpServer: vi.fn().mockImplementation(() => ({
        tool: vi.fn(
          (
            name: string,
            _description: string,
            schema: object,
            handler: Function,
          ) => {
            mockToolHandlers.set(name, handler);
            mockToolSchemas.set(name, schema);
          },
        ),
        connect: mockConnect,
      })),
    }));
    vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
      StdioServerTransport: vi.fn().mockImplementation(() => ({})),
    }));

    await import('../../src/mcp/platform/server.js');
  });

  // =========================================================================
  // Tool registration
  // =========================================================================

  describe('tool registration', () => {
    it('should register all 6 tools', () => {
      expect(mockToolHandlers.size).toBe(6);
      expect(mockToolHandlers.has('platform_notify')).toBe(true);
      expect(mockToolHandlers.has('platform_clipboard_read')).toBe(true);
      expect(mockToolHandlers.has('platform_clipboard_write')).toBe(true);
      expect(mockToolHandlers.has('platform_open')).toBe(true);
      expect(mockToolHandlers.has('platform_screenshot')).toBe(true);
      expect(mockToolHandlers.has('platform_info')).toBe(true);
    });

    it('should connect to the stdio transport', () => {
      expect(mockConnect).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // platform_notify
  // =========================================================================

  describe('platform_notify', () => {
    it('should send macOS notification via osascript', async () => {
      const result = await callTool('platform_notify', {
        title: 'Test',
        message: 'Hello World',
        sound: false,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Notification sent');

      // Verify osascript was called
      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const osascriptCall = calls.find((c) => c.includes('osascript'));
      expect(osascriptCall).toBeDefined();
      expect(osascriptCall).toContain('display notification');
      expect(osascriptCall).toContain('Hello World');
      expect(osascriptCall).toContain('Test');
    });

    it('should include sound clause when sound is true on macOS', async () => {
      await callTool('platform_notify', {
        title: 'Alert',
        message: 'Ding!',
        sound: true,
      });

      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const osascriptCall = calls.find((c) => c.includes('osascript'));
      expect(osascriptCall).toContain('sound name');
    });

    it('should send Linux notification via notify-send', async () => {
      // Reconfigure for Linux
      vi.resetModules();
      const linuxMockExecSync = vi.fn().mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('command -v')) return '/usr/bin/found';
        return '';
      });

      vi.doMock('node:child_process', () => ({
        execSync: linuxMockExecSync,
      }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _description: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_notify', {
        title: 'Test',
        message: 'Hello Linux',
        sound: false,
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Notification sent');

      const calls = linuxMockExecSync.mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      const notifySendCall = calls.find((c: string) =>
        c.includes('notify-send'),
      );
      expect(notifySendCall).toBeDefined();
    });

    it('should return error when osascript fails on macOS', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.includes('osascript')) {
          throw new Error('osascript failed');
        }
        return '';
      });

      const result = await callTool('platform_notify', {
        title: 'Fail',
        message: 'Nope',
        sound: false,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Failed to send notification');
    });

    it('should return error on unsupported platform', async () => {
      vi.resetModules();
      vi.doMock('node:child_process', () => ({
        execSync: vi.fn(() => ''),
      }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'win32'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Windows_NT'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _description: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_notify', {
        title: 'Test',
        message: 'Hi',
        sound: false,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not supported on platform');
    });
  });

  // =========================================================================
  // platform_clipboard_read
  // =========================================================================

  describe('platform_clipboard_read', () => {
    it('should read clipboard via pbpaste on macOS', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command === 'pbpaste') return 'clipboard content';
        return '';
      });

      const result = await callTool('platform_clipboard_read');

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toBe('clipboard content');
    });

    it('should read clipboard via xclip on Linux', async () => {
      vi.resetModules();
      const linuxExec = vi.fn().mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('command -v xclip')) return '/usr/bin/xclip';
        if (command.startsWith('command -v')) return '/usr/bin/found';
        if (command.includes('xclip -selection clipboard -o'))
          return 'linux clipboard';
        return '';
      });

      vi.doMock('node:child_process', () => ({ execSync: linuxExec }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _desc: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_clipboard_read');

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toBe('linux clipboard');
    });

    it('should fall back to xsel when xclip is unavailable on Linux', async () => {
      vi.resetModules();
      const linuxExec = vi.fn().mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('command -v xclip'))
          throw new Error('not found');
        if (command.startsWith('command -v xsel')) return '/usr/bin/xsel';
        if (command.startsWith('command -v')) return '/usr/bin/found';
        if (command.includes('xsel --clipboard --output'))
          return 'xsel clipboard';
        return '';
      });

      vi.doMock('node:child_process', () => ({ execSync: linuxExec }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _desc: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_clipboard_read');

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toBe('xsel clipboard');
    });

    it('should return error when no clipboard tool is available on Linux', async () => {
      vi.resetModules();
      const linuxExec = vi.fn().mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('command -v'))
          throw new Error('not found');
        return '';
      });

      vi.doMock('node:child_process', () => ({ execSync: linuxExec }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _desc: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_clipboard_read');

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('No clipboard tool available');
    });

    it('should handle empty clipboard gracefully', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command === 'pbpaste') throw new Error('empty');
        return '';
      });

      const result = await callTool('platform_clipboard_read');

      expect(result.content[0]!.text).toContain(
        'Clipboard is empty or could not be read',
      );
    });
  });

  // =========================================================================
  // platform_clipboard_write
  // =========================================================================

  describe('platform_clipboard_write', () => {
    it('should write to clipboard via pbcopy on macOS', async () => {
      const result = await callTool('platform_clipboard_write', {
        content: 'test data',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('9 characters');

      const calls = mockExecSync.mock.calls;
      const pbcopyCall = calls.find(
        (c) => typeof c[0] === 'string' && c[0] === 'pbcopy',
      );
      expect(pbcopyCall).toBeDefined();
      // Verify input was passed
      expect((pbcopyCall![1] as Record<string, unknown>)?.['input']).toBe(
        'test data',
      );
    });

    it('should write to clipboard via xclip on Linux', async () => {
      vi.resetModules();
      const linuxExec = vi.fn().mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('command -v xclip')) return '/usr/bin/xclip';
        if (command.startsWith('command -v')) return '/usr/bin/found';
        return '';
      });

      vi.doMock('node:child_process', () => ({ execSync: linuxExec }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _desc: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_clipboard_write', {
        content: 'linux data',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('10 characters');
    });

    it('should return error when pbcopy fails', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command === 'pbcopy') throw new Error('pbcopy failed');
        return '';
      });

      const result = await callTool('platform_clipboard_write', {
        content: 'fail data',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Failed to write to clipboard');
    });
  });

  // =========================================================================
  // platform_open
  // =========================================================================

  describe('platform_open', () => {
    it('should open a URL on macOS with open command', async () => {
      const result = await callTool('platform_open', {
        target: 'https://example.com',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Opened');
      expect(result.content[0]!.text).toContain('https://example.com');

      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const openCall = calls.find((c) => c.startsWith('open '));
      expect(openCall).toBeDefined();
      expect(openCall).toContain('https://example.com');
    });

    it('should open via xdg-open on Linux', async () => {
      vi.resetModules();
      const linuxExec = vi.fn().mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('command -v xdg-open'))
          return '/usr/bin/xdg-open';
        if (command.startsWith('command -v')) return '/usr/bin/found';
        return '';
      });

      vi.doMock('node:child_process', () => ({ execSync: linuxExec }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _desc: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_open', {
        target: '/home/user/document.pdf',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Opened');

      const calls = linuxExec.mock.calls.map((c: unknown[]) => String(c[0]));
      const xdgCall = calls.find((c: string) => c.startsWith('xdg-open'));
      expect(xdgCall).toBeDefined();
    });

    it('should return error when open command fails', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('open ')) throw new Error('open failed');
        return '';
      });

      const result = await callTool('platform_open', {
        target: 'https://bad.url',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Failed to open');
    });
  });

  // =========================================================================
  // platform_screenshot
  // =========================================================================

  describe('platform_screenshot', () => {
    it('should take screenshot via screencapture on macOS', async () => {
      const result = await callTool('platform_screenshot', {
        outputPath: '/tmp/test-screenshot.png',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Screenshot saved');
      expect(result.content[0]!.text).toContain('/tmp/test-screenshot.png');

      const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
      const screencaptureCall = calls.find((c) =>
        c.includes('screencapture'),
      );
      expect(screencaptureCall).toBeDefined();
      expect(screencaptureCall).toContain('-x');
    });

    it('should use temp path when outputPath is not provided on macOS', async () => {
      const result = await callTool('platform_screenshot', {});

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Screenshot saved to: /tmp/');
    });

    it('should use import command on Linux when available', async () => {
      vi.resetModules();
      const linuxExec = vi.fn().mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('command -v import'))
          return '/usr/bin/import';
        if (command.startsWith('command -v')) return '/usr/bin/found';
        return '';
      });

      vi.doMock('node:child_process', () => ({ execSync: linuxExec }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _desc: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_screenshot', {
        outputPath: '/tmp/linux-shot.png',
      });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]!.text).toContain('Screenshot saved');

      const calls = linuxExec.mock.calls.map((c: unknown[]) => String(c[0]));
      const importCall = calls.find((c: string) =>
        c.startsWith('import -window root'),
      );
      expect(importCall).toBeDefined();
    });

    it('should fall back to gnome-screenshot on Linux when import is unavailable', async () => {
      vi.resetModules();
      const linuxExec = vi.fn().mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('command -v import'))
          throw new Error('not found');
        if (command.startsWith('command -v gnome-screenshot'))
          return '/usr/bin/gnome-screenshot';
        if (command.startsWith('command -v')) return '/usr/bin/found';
        return '';
      });

      vi.doMock('node:child_process', () => ({ execSync: linuxExec }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _desc: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_screenshot', {
        outputPath: '/tmp/gnome-shot.png',
      });

      expect(result.isError).toBeUndefined();

      const calls = linuxExec.mock.calls.map((c: unknown[]) => String(c[0]));
      const gnomeCall = calls.find((c: string) =>
        c.startsWith('gnome-screenshot'),
      );
      expect(gnomeCall).toBeDefined();
    });

    it('should return error when no screenshot tool is available on Linux', async () => {
      vi.resetModules();
      const linuxExec = vi.fn().mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.startsWith('command -v'))
          throw new Error('not found');
        return '';
      });

      vi.doMock('node:child_process', () => ({ execSync: linuxExec }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'test-host'),
        userInfo: vi.fn(() => ({ username: 'testuser' })),
        uptime: vi.fn(() => 7200),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _desc: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_screenshot', {
        outputPath: '/tmp/fail.png',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('No screenshot tool available');
    });

    it('should return error when screencapture command fails on macOS', async () => {
      mockExecSync.mockImplementation((cmd: string) => {
        const command = typeof cmd === 'string' ? cmd : String(cmd);
        if (command.includes('screencapture')) {
          throw new Error('screencapture failed');
        }
        return '';
      });

      const result = await callTool('platform_screenshot', {
        outputPath: '/tmp/fail.png',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('Failed to take screenshot');
    });
  });

  // =========================================================================
  // platform_info
  // =========================================================================

  describe('platform_info', () => {
    it('should return system information with expected structure', async () => {
      const result = await callTool('platform_info');

      expect(result.isError).toBeUndefined();

      const text = result.content[0]!.text;
      expect(text).toContain('## System Information');
      expect(text).toContain('**OS:**');
      expect(text).toContain('**Hostname:**');
      expect(text).toContain('test-host');
      expect(text).toContain('**Username:**');
      expect(text).toContain('testuser');
      expect(text).toContain('**Shell:**');
      expect(text).toContain('**Terminal:**');
      expect(text).toContain('**Working Directory:**');
      expect(text).toContain('**Uptime:**');
    });

    it('should format uptime correctly', async () => {
      // Uptime is mocked as 7200 seconds = 2 hours, 0 minutes
      const result = await callTool('platform_info');

      const text = result.content[0]!.text;
      expect(text).toContain('2h 0m');
    });

    it('should include OS type information', async () => {
      const result = await callTool('platform_info');

      const text = result.content[0]!.text;
      expect(text).toContain('Darwin');
    });

    it('should return Linux info when on Linux', async () => {
      vi.resetModules();
      vi.doMock('node:child_process', () => ({
        execSync: vi.fn(() => ''),
      }));
      vi.doMock('node:os', () => ({
        platform: vi.fn(() => 'linux'),
        tmpdir: vi.fn(() => '/tmp'),
        hostname: vi.fn(() => 'linux-box'),
        userInfo: vi.fn(() => ({ username: 'linuxuser' })),
        uptime: vi.fn(() => 86400),
        type: vi.fn(() => 'Linux'),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
        McpServer: vi.fn().mockImplementation(() => ({
          tool: vi.fn(
            (
              name: string,
              _desc: string,
              schema: object,
              handler: Function,
            ) => {
              mockToolHandlers.set(name, handler);
              mockToolSchemas.set(name, schema);
            },
          ),
          connect: mockConnect,
        })),
      }));
      vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
        StdioServerTransport: vi.fn().mockImplementation(() => ({})),
      }));

      await import('../../src/mcp/platform/server.js');

      const result = await callTool('platform_info');

      const text = result.content[0]!.text;
      expect(text).toContain('Linux');
      expect(text).toContain('linux-box');
      expect(text).toContain('linuxuser');
      expect(text).toContain('24h 0m');
    });
  });
});
