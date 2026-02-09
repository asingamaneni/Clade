// ---------------------------------------------------------------------------
// Collaboration MCP Server
//
// Exposes the inter-agent collaboration protocol (delegation, pub/sub
// message bus, shared memory) as MCP tools for use by agent subprocesses.
// ---------------------------------------------------------------------------

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createDelegation,
  updateDelegation,
  getDelegations,
  publishMessage,
  subscribe,
  unsubscribe,
  getMessages,
  getSubscriptions,
  getSharedMemory,
} from '../../agents/collaboration.js';

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'clade-collaboration',
  version: '0.1.0',
});

// ---------------------------------------------------------------------------
// Tool: collab_delegate
// ---------------------------------------------------------------------------

server.tool(
  'collab_delegate',
  'Create a delegation — formally assign a task from one agent to another.',
  {
    fromAgent: z.string().describe('Agent ID of the delegator'),
    toAgent: z.string().describe('Agent ID of the delegate'),
    task: z.string().describe('Description of the task to delegate'),
    context: z.string().describe('Context and background for the task'),
    constraints: z
      .string()
      .optional()
      .describe('Optional constraints or requirements'),
  },
  async ({ fromAgent, toAgent, task, context, constraints }) => {
    try {
      const delegation = createDelegation(
        fromAgent,
        toAgent,
        task,
        context,
        constraints ?? undefined,
      );

      const lines = [
        '## Delegation Created',
        '',
        `| Field | Value |`,
        `|-------|-------|`,
        `| **ID** | \`${delegation.id}\` |`,
        `| **From** | ${delegation.fromAgent} |`,
        `| **To** | ${delegation.toAgent} |`,
        `| **Task** | ${delegation.task} |`,
        `| **Status** | ${delegation.status} |`,
        `| **Created** | ${delegation.createdAt} |`,
      ];

      if (delegation.constraints) {
        lines.push(`| **Constraints** | ${delegation.constraints} |`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error creating delegation: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: collab_update_delegation
// ---------------------------------------------------------------------------

server.tool(
  'collab_update_delegation',
  'Update the status of a delegation (and optionally attach a result).',
  {
    id: z.string().describe('Delegation ID'),
    status: z
      .enum(['pending', 'accepted', 'in_progress', 'completed', 'failed'])
      .describe('New status'),
    result: z
      .string()
      .optional()
      .describe('Optional result or summary to attach'),
  },
  async ({ id, status, result }) => {
    try {
      const delegation = updateDelegation(id, status, result ?? undefined);

      const lines = [
        '## Delegation Updated',
        '',
        `| Field | Value |`,
        `|-------|-------|`,
        `| **ID** | \`${delegation.id}\` |`,
        `| **From** | ${delegation.fromAgent} |`,
        `| **To** | ${delegation.toAgent} |`,
        `| **Status** | ${delegation.status} |`,
        `| **Updated** | ${delegation.updatedAt} |`,
      ];

      if (delegation.result) {
        lines.push(`| **Result** | ${delegation.result} |`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error updating delegation: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: collab_get_delegations
// ---------------------------------------------------------------------------

server.tool(
  'collab_get_delegations',
  'List delegations for an agent, optionally filtered by role (from/to).',
  {
    agentId: z.string().describe('Agent ID to query'),
    role: z
      .enum(['from', 'to'])
      .optional()
      .describe('Filter by role: "from" (delegator) or "to" (delegate)'),
  },
  async ({ agentId, role }) => {
    try {
      const delegations = getDelegations(agentId, role ?? undefined);

      if (delegations.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No delegations found for agent **${agentId}**${role ? ` (role: ${role})` : ''}.`,
            },
          ],
        };
      }

      const lines = [
        `## Delegations for ${agentId}${role ? ` (role: ${role})` : ''}`,
        '',
        '| ID | From | To | Task | Status | Updated |',
        '|----|------|----|------|--------|---------|',
      ];

      for (const d of delegations) {
        lines.push(
          `| \`${d.id.slice(0, 8)}...\` | ${d.fromAgent} | ${d.toAgent} | ${d.task.slice(0, 40)} | ${d.status} | ${d.updatedAt} |`,
        );
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing delegations: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: collab_publish
// ---------------------------------------------------------------------------

server.tool(
  'collab_publish',
  'Publish a message to a topic on the message bus.',
  {
    topic: z.string().describe('Topic name to publish to'),
    fromAgent: z.string().describe('Agent ID of the publisher'),
    payload: z.string().describe('Message payload (text or JSON)'),
  },
  async ({ topic, fromAgent, payload }) => {
    try {
      const message = publishMessage(topic, fromAgent, payload);

      const lines = [
        '## Message Published',
        '',
        `- **ID:** \`${message.id}\``,
        `- **Topic:** ${message.topic}`,
        `- **From:** ${message.fromAgent}`,
        `- **Timestamp:** ${message.timestamp}`,
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error publishing message: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: collab_subscribe
// ---------------------------------------------------------------------------

server.tool(
  'collab_subscribe',
  'Subscribe an agent to a topic on the message bus.',
  {
    agentId: z.string().describe('Agent ID to subscribe'),
    topic: z.string().describe('Topic name to subscribe to'),
  },
  async ({ agentId, topic }) => {
    try {
      subscribe(agentId, topic);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Agent **${agentId}** subscribed to topic **${topic}**.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error subscribing: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: collab_unsubscribe
// ---------------------------------------------------------------------------

server.tool(
  'collab_unsubscribe',
  'Unsubscribe an agent from a topic on the message bus.',
  {
    agentId: z.string().describe('Agent ID to unsubscribe'),
    topic: z.string().describe('Topic name to unsubscribe from'),
  },
  async ({ agentId, topic }) => {
    try {
      unsubscribe(agentId, topic);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Agent **${agentId}** unsubscribed from topic **${topic}**.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error unsubscribing: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: collab_get_messages
// ---------------------------------------------------------------------------

server.tool(
  'collab_get_messages',
  'Get messages on a topic, optionally filtered to those after a given timestamp.',
  {
    topic: z.string().describe('Topic name to read'),
    since: z
      .string()
      .optional()
      .describe('ISO-8601 timestamp — only return messages after this time'),
  },
  async ({ topic, since }) => {
    try {
      const messages = getMessages(topic, since ?? undefined);

      if (messages.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No messages on topic **${topic}**${since ? ` since ${since}` : ''}.`,
            },
          ],
        };
      }

      const lines = [
        `## Messages on topic: ${topic}${since ? ` (since ${since})` : ''}`,
        '',
        `${messages.length} message(s):`,
        '',
      ];

      for (const m of messages) {
        lines.push(
          `### ${m.fromAgent} — ${m.timestamp}`,
          '',
          m.payload,
          '',
        );
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error getting messages: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: collab_get_subscriptions
// ---------------------------------------------------------------------------

server.tool(
  'collab_get_subscriptions',
  "Get the list of topics an agent is subscribed to.",
  {
    agentId: z.string().describe('Agent ID to query'),
  },
  async ({ agentId }) => {
    try {
      const topics = getSubscriptions(agentId);

      if (topics.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Agent **${agentId}** has no active subscriptions.`,
            },
          ],
        };
      }

      const lines = [
        `## Subscriptions for ${agentId}`,
        '',
        ...topics.map((t) => `- ${t}`),
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error getting subscriptions: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: collab_shared_memory
// ---------------------------------------------------------------------------

server.tool(
  'collab_shared_memory',
  "Read another agent's MEMORY.md (both agents must exist in the same workspace).",
  {
    requestingAgent: z.string().describe('Agent ID making the request'),
    targetAgent: z.string().describe('Agent ID whose memory to read'),
  },
  async ({ requestingAgent, targetAgent }) => {
    try {
      const memory = getSharedMemory(requestingAgent, targetAgent);

      if (memory === null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Cannot access memory for agent **${targetAgent}**. Either the agent does not exist, the requesting agent (**${requestingAgent}**) does not exist, or the target has no MEMORY.md.`,
            },
          ],
          isError: true,
        };
      }

      const lines = [
        `## Shared Memory: ${targetAgent}`,
        '',
        memory,
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error reading shared memory: ${err instanceof Error ? err.message : String(err)}`,
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
