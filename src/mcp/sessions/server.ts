import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createConnection } from 'node:net';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function discoverIpcSocket(): string {
  // First try the explicit env var, but verify it still exists
  const explicit = process.env['CLADE_IPC_SOCKET'];
  if (explicit) {
    try {
      statSync(explicit);
      return explicit;
    } catch { /* stale socket path — fall through to discovery */ }
  }

  // Fallback: scan CLADE_HOME for ipc-*.sock files
  const home = process.env['CLADE_HOME'] || join(homedir(), '.clade');
  try {
    const entries = readdirSync(home);
    for (const entry of entries) {
      if (entry.startsWith('ipc-') && entry.endsWith('.sock')) {
        return join(home, entry);
      }
    }
  } catch { /* CLADE_HOME may not exist */ }
  return '';
}

const socketPath = discoverIpcSocket();
const currentSessionId = process.env['CLADE_SESSION_ID'] ?? '';
const callingAgentId = process.env['CLADE_AGENT_ID'] ?? '';

// ---------------------------------------------------------------------------
// IPC communication over Unix socket
// ---------------------------------------------------------------------------

interface IpcResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

/**
 * Send a JSON message to the main Clade process via Unix socket
 * and wait for the JSON response.
 */
async function sendIpc(message: object): Promise<IpcResponse> {
  if (!socketPath) {
    return {
      ok: false,
      error:
        'CLADE_IPC_SOCKET not set. Sessions require the main Clade process.',
    };
  }

  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath);
    let data = '';

    const timeout = setTimeout(() => {
      client.destroy();
      reject(new Error('IPC request timed out after 120 seconds'));
    }, 120_000);

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
  name: 'clade-sessions',
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// Tool: sessions_list
// ---------------------------------------------------------------------------

server.tool(
  'sessions_list',
  'List all active sessions.',
  {},
  async () => {
    try {
      const response = await sendIpc({
        type: 'sessions.list',
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error listing sessions: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      const sessions = response['sessions'] as Array<{
        sessionId: string;
        agentId: string;
        channel: string;
        status: string;
        lastActive: string;
      }> | undefined;

      if (!sessions || sessions.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No active sessions.',
            },
          ],
        };
      }

      const lines = sessions.map(
        (s) =>
          `- **${s.sessionId}** | agent: ${s.agentId} | channel: ${s.channel} | status: ${s.status} | last active: ${s.lastActive}`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `## Active Sessions\n\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing sessions: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: sessions_spawn
// ---------------------------------------------------------------------------

server.tool(
  'sessions_spawn',
  'Spawn a new sub-agent session. Sends IPC message to the main process to start a new claude subprocess.',
  {
    agent: z.string().describe('Agent ID to spawn'),
    prompt: z.string().describe('Initial message / prompt for the agent'),
  },
  async ({ agent, prompt }) => {
    try {
      const response = await sendIpc({
        type: 'sessions.spawn',
        agentId: agent,
        prompt,
        parentSessionId: currentSessionId || undefined,
        callingAgentId: callingAgentId || undefined,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error spawning session: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      const sessionId = response['sessionId'] as string | undefined;
      const responseText = response['response'] as string | undefined;

      const parts: string[] = [];
      if (sessionId) {
        parts.push(`**Session ID:** ${sessionId}`);
      }
      if (responseText) {
        parts.push(`\n**Response:**\n\n${responseText}`);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: parts.length > 0 ? parts.join('\n') : 'Session spawned successfully.',
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error spawning session: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: sessions_send
// ---------------------------------------------------------------------------

server.tool(
  'sessions_send',
  'Send a message to an existing session.',
  {
    sessionId: z.string().describe('The session ID to send the message to'),
    message: z.string().describe('The message to send'),
  },
  async ({ sessionId, message }) => {
    try {
      const response = await sendIpc({
        type: 'sessions.send',
        sessionId,
        message,
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

      const responseText = response['response'] as string | undefined;

      return {
        content: [
          {
            type: 'text' as const,
            text: responseText ?? 'Message sent. No response received.',
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
// Tool: session_status
// ---------------------------------------------------------------------------

server.tool(
  'session_status',
  'Get status of current or specified session.',
  {
    sessionId: z
      .string()
      .optional()
      .describe(
        'Session ID to check. Defaults to current session if omitted.',
      ),
  },
  async ({ sessionId }) => {
    try {
      const targetId = sessionId ?? currentSessionId;

      if (!targetId) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No session ID provided and no current session ID available.',
            },
          ],
          isError: true,
        };
      }

      const response = await sendIpc({
        type: 'sessions.status',
        sessionId: targetId,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting session status: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      const status = response['status'] as string | undefined;
      const agent = response['agentId'] as string | undefined;
      const channel = response['channel'] as string | undefined;
      const created = response['createdAt'] as string | undefined;
      const lastActive = response['lastActive'] as string | undefined;

      const lines = [
        `## Session Status`,
        '',
        `- **Session ID:** ${targetId}`,
        `- **Status:** ${status ?? 'unknown'}`,
        `- **Agent:** ${agent ?? 'unknown'}`,
        `- **Channel:** ${channel ?? 'unknown'}`,
        `- **Created:** ${created ?? 'unknown'}`,
        `- **Last Active:** ${lastActive ?? 'unknown'}`,
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
            text: `Error getting session status: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: agents_list
// ---------------------------------------------------------------------------

server.tool(
  'agents_list',
  'List all configured agents.',
  {},
  async () => {
    try {
      const response = await sendIpc({
        type: 'agents.list',
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error listing agents: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      const agents = response['agents'] as Array<{
        id: string;
        name: string;
        description: string;
        toolPreset: string;
        mcp: string[];
      }> | undefined;

      if (!agents || agents.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No agents configured.',
            },
          ],
        };
      }

      const lines = agents.map((a) => {
        const mcp =
          a.mcp.length > 0 ? a.mcp.join(', ') : 'none';
        return [
          `### ${a.name} (\`${a.id}\`)`,
          a.description ? `> ${a.description}` : '',
          `- **Tool preset:** ${a.toolPreset}`,
          `- **MCP servers:** ${mcp}`,
        ]
          .filter(Boolean)
          .join('\n');
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `## Configured Agents\n\n${lines.join('\n\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing agents: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: task_queue_schedule
// ---------------------------------------------------------------------------

server.tool(
  'task_queue_schedule',
  'Schedule a follow-up task to be executed after a delay. Use this when you promise to do something later (e.g., "I\'ll check on that in 5 minutes", "Let me forward that invite"). The task will run automatically using your conversation context.',
  {
    prompt: z
      .string()
      .describe('The prompt/instruction for the follow-up task. Be specific about what needs to be done.'),
    description: z
      .string()
      .describe('Short human-readable description of the task (e.g., "Check flight status", "Forward calendar invite")'),
    delayMinutes: z
      .number()
      .min(0.5)
      .max(1440)
      .describe('Minutes to wait before executing (0.5 = 30 seconds, 1440 = 24 hours)'),
  },
  async ({ prompt, description, delayMinutes }) => {
    try {
      const response = await sendIpc({
        type: 'taskqueue.schedule',
        agentId: callingAgentId || undefined,
        sessionId: currentSessionId || undefined,
        prompt,
        description,
        delayMinutes,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error scheduling task: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      const taskId = response['taskId'] as string | undefined;
      const executeAt = response['executeAt'] as string | undefined;

      return {
        content: [
          {
            type: 'text' as const,
            text: `Task scheduled successfully.\n\n- **Task ID:** ${taskId}\n- **Description:** ${description}\n- **Executes at:** ${executeAt ? new Date(executeAt).toLocaleString() : `in ${delayMinutes} minutes`}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error scheduling task: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: task_queue_cancel
// ---------------------------------------------------------------------------

server.tool(
  'task_queue_cancel',
  'Cancel a pending scheduled task.',
  {
    taskId: z.string().describe('The task ID to cancel'),
  },
  async ({ taskId }) => {
    try {
      const response = await sendIpc({
        type: 'taskqueue.cancel',
        taskId,
        agentId: callingAgentId || undefined,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error cancelling task: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Task ${taskId} cancelled successfully.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error cancelling task: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: task_queue_list
// ---------------------------------------------------------------------------

server.tool(
  'task_queue_list',
  'List your pending and recent scheduled tasks.',
  {},
  async () => {
    try {
      const response = await sendIpc({
        type: 'taskqueue.list',
        agentId: callingAgentId || undefined,
      });

      if (!response.ok) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error listing tasks: ${response.error ?? 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }

      const tasks = response['tasks'] as Array<{
        id: string;
        description: string;
        status: string;
        executeAt: string;
        prompt: string;
      }> | undefined;

      if (!tasks || tasks.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No scheduled tasks found.',
            },
          ],
        };
      }

      const lines = tasks.map((t) => {
        const when = new Date(t.executeAt).toLocaleString();
        return `- **${t.id}** | ${t.description} | status: ${t.status} | execute at: ${when}`;
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `## Scheduled Tasks\n\n${lines.join('\n')}`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing tasks: ${err instanceof Error ? err.message : String(err)}`,
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
