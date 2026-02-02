import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createConnection } from 'node:net';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const socketPath = process.env['TEAMAGENTS_IPC_SOCKET'] ?? '';

// ---------------------------------------------------------------------------
// IPC communication over Unix socket
// ---------------------------------------------------------------------------

interface IpcResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Send a JSON message to the main TeamAgents process via Unix socket
 * and wait for the JSON response.
 */
async function sendIpc(message: object): Promise<IpcResponse> {
  if (!socketPath) {
    return {
      ok: false,
      error:
        'TEAMAGENTS_IPC_SOCKET not set. Messaging requires the main TeamAgents process.',
    };
  }

  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath);
    let data = '';

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('IPC request timed out after 30 seconds'));
    }, 30_000);

    client.on('connect', () => {
      client.write(JSON.stringify(message));
      client.end();
    });

    client.on('data', (chunk) => {
      data += chunk.toString();
    });

    client.on('end', () => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data) as IpcResponse);
      } catch {
        resolve({ ok: false, error: `Invalid IPC response: ${data}` });
      }
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `IPC connection error: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    });
  });
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'teamagents-messaging',
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// Tool: send_message
// ---------------------------------------------------------------------------

server.tool(
  'send_message',
  'Send a message to a channel (telegram, slack, discord, webchat).',
  {
    channel: z
      .enum(['telegram', 'slack', 'discord', 'webchat'])
      .describe('Target channel'),
    to: z.string().describe('Chat ID, channel ID, or user ID'),
    text: z.string().describe('Message text to send'),
    threadId: z
      .string()
      .optional()
      .describe('Optional thread ID for threaded replies'),
  },
  async ({ channel, to, text, threadId }) => {
    try {
      const response = await sendIpc({
        type: 'messaging.send',
        channel,
        to,
        text,
        threadId: threadId ?? undefined,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error sending message: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      const messageId = response['messageId'] as string | undefined;
      const resultThreadId = response['threadId'] as string | undefined;

      const parts = [`Message sent to ${channel}:${to}.`];
      if (messageId) parts.push(`Message ID: ${messageId}`);
      if (resultThreadId) parts.push(`Thread ID: ${resultThreadId}`);

      return {
        content: [
          {
            type: 'text' as const,
            text: parts.join('\n'),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error sending message: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: send_typing
// ---------------------------------------------------------------------------

server.tool(
  'send_typing',
  'Show a typing indicator in a channel.',
  {
    channel: z
      .enum(['telegram', 'slack', 'discord', 'webchat'])
      .describe('Target channel'),
    to: z.string().describe('Chat ID, channel ID, or user ID'),
  },
  async ({ channel, to }) => {
    try {
      const response = await sendIpc({
        type: 'messaging.typing',
        channel,
        to,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error sending typing indicator: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Typing indicator sent to ${channel}:${to}.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error sending typing indicator: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: get_channel_info
// ---------------------------------------------------------------------------

server.tool(
  'get_channel_info',
  'Get information about a messaging channel.',
  {
    channel: z
      .enum(['telegram', 'slack', 'discord', 'webchat'])
      .describe('Channel to query'),
  },
  async ({ channel }) => {
    try {
      const response = await sendIpc({
        type: 'messaging.channel_info',
        channel,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting channel info: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      const connected = response['connected'] as boolean | undefined;
      const channelType = response['type'] as string | undefined;
      const info = response['info'] as Record<string, unknown> | undefined;

      const lines = [
        `## Channel: ${channel}`,
        '',
        `- **Connected:** ${connected !== undefined ? String(connected) : 'unknown'}`,
        `- **Type:** ${channelType ?? 'unknown'}`,
      ];

      if (info) {
        lines.push('', '### Additional Info', '');
        for (const [key, value] of Object.entries(info)) {
          lines.push(`- **${key}:** ${String(value)}`);
        }
      }

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
            text: `Error getting channel info: ${err instanceof Error ? err.message : String(err)}`,
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
