/**
 * Playwright E2E test suite for Clade REST API contracts.
 *
 * Validates every public REST endpoint's response shape, status codes,
 * and error handling against a real running Clade server with pre-seeded
 * test data (two agents, one conversation with messages).
 *
 * Requirements:
 * - Build must be fresh (`npm run build`)
 * - No `claude` CLI needed (these tests only exercise the HTTP API)
 */
import { test, expect } from '@playwright/test';
import { startTestServer, stopTestServer, type TestServer } from './fixtures/server.js';

let server: TestServer;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(() => {
  stopTestServer(server);
});

test.describe('REST API', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Health
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /health returns status ok', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBeDefined();
  });

  test('GET /health includes uptime', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Agent listing
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/agents returns all agents', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.agents).toBeDefined();
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBe(2);
    const ids = body.agents.map((a: { id: string }) => a.id);
    expect(ids).toContain('jarvis');
    expect(ids).toContain('scout');
  });

  test('GET /api/agents includes correct fields', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const jarvis = body.agents.find((a: { id: string }) => a.id === 'jarvis');
    expect(jarvis).toBeDefined();
    expect(jarvis.id).toBe('jarvis');
    expect(jarvis.name).toBe('Jarvis');
    expect(typeof jarvis.description).toBe('string');
    expect(jarvis.model).toBe('sonnet');
    expect(jarvis.toolPreset).toBe('coding');
    expect(jarvis.emoji).toBe('\u{1F4BB}');

    const scout = body.agents.find((a: { id: string }) => a.id === 'scout');
    expect(scout).toBeDefined();
    expect(scout.emoji).toBe('\u{1F50D}');
  });

  test('GET /api/agents includes skills and mcp arrays', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const jarvis = body.agents.find((a: { id: string }) => a.id === 'jarvis');
    expect(jarvis).toBeDefined();
    expect(Array.isArray(jarvis.skills)).toBe(true);
    expect(Array.isArray(jarvis.mcp)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Agent detail
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/agents/:id returns single agent', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents/jarvis`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.agent).toBeDefined();
    expect(body.agent.id).toBe('jarvis');
    expect(body.agent.name).toBe('Jarvis');
    expect(body.agent.toolPreset).toBe('coding');
  });

  test('GET /api/agents/:id returns 404 for unknown', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents/nonexistent`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error).toContain('not found');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Config
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/config returns config object', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/config`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.config).toBeDefined();
    expect(typeof body.config).toBe('object');
    // The config should have agents section
    expect(body.config.agents).toBeDefined();
    expect(body.config.agents.jarvis).toBeDefined();
    expect(body.config.agents.scout).toBeDefined();
  });

  test('GET /api/config/full returns raw config', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/config/full`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    // The full config endpoint returns the raw config object directly
    expect(body.agents).toBeDefined();
    expect(body.agents.jarvis).toBeDefined();
    expect(body.agents.jarvis.name).toBe('Jarvis');
    expect(body.gateway).toBeDefined();
    expect(body.gateway.port).toBe(server.port);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Templates
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/templates returns available templates', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/templates`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.templates).toBeDefined();
    expect(Array.isArray(body.templates)).toBe(true);

    const templateIds = body.templates.map((t: { id: string }) => t.id);
    expect(templateIds).toContain('coding');
    expect(templateIds).toContain('research');
    expect(templateIds).toContain('ops');
    expect(templateIds).toContain('pm');

    // Verify template shape
    const coding = body.templates.find((t: { id: string }) => t.id === 'coding');
    expect(coding.name).toBeDefined();
    expect(coding.description).toBeDefined();
    expect(coding.toolPreset).toBeDefined();
    expect(coding.model).toBeDefined();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Chat conversations
  // ═══════════════════════════════════════════════════════════════════════

  test('POST /api/chat/conversations creates conversation', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/chat/conversations`, {
      data: { agentId: 'jarvis' },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.conversation).toBeDefined();
    expect(body.conversation.id).toMatch(/^conv_/);
    expect(body.conversation.label).toBeDefined();
    expect(body.conversation.createdAt).toBeDefined();
    expect(body.conversation.lastActiveAt).toBeDefined();
    expect(body.conversation.messageCount).toBe(0);
  });

  test('POST /api/chat/conversations rejects missing agentId', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/chat/conversations`, {
      data: {},
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error).toContain('agentId');
  });

  test('POST /api/chat/conversations rejects unknown agent', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/chat/conversations`, {
      data: { agentId: 'nonexistent_agent' },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error).toContain('not found');
  });

  test('DELETE /api/chat/conversations/:id deletes conversation', async ({ request }) => {
    // First create a conversation to delete
    const createRes = await request.post(`${server.baseUrl}/api/chat/conversations`, {
      data: { agentId: 'jarvis' },
    });
    expect(createRes.ok()).toBe(true);
    const { conversation } = await createRes.json();
    const convId = conversation.id;

    // Delete it
    const deleteRes = await request.delete(
      `${server.baseUrl}/api/chat/conversations/${convId}?agentId=jarvis`,
    );
    expect(deleteRes.ok()).toBe(true);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.success).toBe(true);

    // Verify it is gone from the conversation list
    const historyRes = await request.get(
      `${server.baseUrl}/api/chat/history?agentId=jarvis`,
    );
    const historyBody = await historyRes.json();
    const ids = historyBody.conversations.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(convId);
  });

  test('DELETE /api/chat/conversations clears all for agent', async ({ request }) => {
    // First ensure scout has at least one conversation
    await request.post(`${server.baseUrl}/api/chat/conversations`, {
      data: { agentId: 'scout' },
    });

    // Clear all scout conversations
    const deleteRes = await request.delete(
      `${server.baseUrl}/api/chat/conversations?agentId=scout`,
    );
    expect(deleteRes.ok()).toBe(true);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.success).toBe(true);

    // Verify scout has no conversations
    const historyRes = await request.get(
      `${server.baseUrl}/api/chat/history?agentId=scout`,
    );
    const historyBody = await historyRes.json();
    expect(historyBody.conversations).toBeDefined();
    expect(historyBody.conversations.length).toBe(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Chat history
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/chat/history returns conversation list', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/chat/history?agentId=jarvis`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.conversations).toBeDefined();
    expect(Array.isArray(body.conversations)).toBe(true);

    // Should include the pre-seeded conversation
    const preSeeded = body.conversations.find(
      (c: { id: string }) => c.id === 'conv_test000001',
    );
    expect(preSeeded).toBeDefined();
    expect(preSeeded.label).toBe('Test conversation');
    expect(preSeeded.messageCount).toBe(2);
  });

  test('GET /api/chat/history with conversationId returns messages', async ({ request }) => {
    const res = await request.get(
      `${server.baseUrl}/api/chat/history?agentId=jarvis&conversationId=conv_test000001`,
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.conversation).toBeDefined();
    expect(body.conversation.id).toBe('conv_test000001');
    expect(body.conversation.label).toBe('Test conversation');

    expect(body.messages).toBeDefined();
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages.length).toBe(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].text).toBe('Hello Jarvis');
    expect(body.messages[1].role).toBe('assistant');
    expect(body.messages[1].text).toBe('Hello! How can I help?');
  });

  test('GET /api/chat/history rejects missing agentId', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/chat/history`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error).toContain('agentId');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Memory
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/agents/:id/memory returns file list', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents/jarvis/memory`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.agentId).toBe('jarvis');
    expect(body.files).toBeDefined();
    expect(Array.isArray(body.files)).toBe(true);
    // Should include MEMORY.md
    expect(body.files).toContain('MEMORY.md');
    // Should also include the daily log we seeded
    const dailyLogs = body.files.filter((f: string) => f.startsWith('memory/'));
    expect(dailyLogs.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /api/agents/:id/memory/MEMORY.md returns content', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents/jarvis/memory/MEMORY.md`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.agentId).toBe('jarvis');
    expect(body.file).toBe('MEMORY.md');
    expect(body.content).toBeDefined();
    expect(body.content).toContain('Prefers TypeScript');
    expect(body.content).toContain('Vim keybindings');
  });

  test('GET /api/agents/:id/memory rejects unknown agent', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents/nonexistent/memory`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error).toContain('not found');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Agent CRUD
  // ═══════════════════════════════════════════════════════════════════════

  test('POST /api/agents creates new agent', async ({ request }) => {
    // The API uses 'name' as the agent ID slug, 'description' as the display name
    const res = await request.post(`${server.baseUrl}/api/agents`, {
      data: {
        name: 'testcrud',
        template: 'coding',
        description: 'Test CRUD Agent',
        model: 'sonnet',
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.agent).toBeDefined();
    expect(body.agent.id).toBe('testcrud');

    // Verify the agent now appears in the list
    const listRes = await request.get(`${server.baseUrl}/api/agents`);
    const listBody = await listRes.json();
    const created = listBody.agents.find((a: { id: string }) => a.id === 'testcrud');
    expect(created).toBeDefined();
  });

  test('PUT /api/agents/:id updates agent', async ({ request }) => {
    // First ensure testcrud exists (created by previous test, but create if needed)
    const checkRes = await request.get(`${server.baseUrl}/api/agents/jarvis`);
    expect(checkRes.ok()).toBe(true);

    const res = await request.put(`${server.baseUrl}/api/agents/jarvis`, {
      data: {
        description: 'Updated description for testing',
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.agent || body.success).toBeTruthy();

    // Verify the update persisted
    const getRes = await request.get(`${server.baseUrl}/api/agents/jarvis`);
    const getBody = await getRes.json();
    expect(getBody.agent.description).toBe('Updated description for testing');
  });

  test('DELETE /api/agents/:id deletes agent', async ({ request }) => {
    // Ensure testcrud exists before deleting
    const checkRes = await request.get(`${server.baseUrl}/api/agents/testcrud`);
    if (!checkRes.ok()) {
      await request.post(`${server.baseUrl}/api/agents`, {
        data: {
          name: 'testcrud',
          template: 'coding',
          description: 'Test CRUD Agent',
        },
      });
    }

    const res = await request.delete(`${server.baseUrl}/api/agents/testcrud`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify it is gone
    const getRes = await request.get(`${server.baseUrl}/api/agents/testcrud`);
    expect(getRes.status()).toBe(404);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Soul & Heartbeat
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/agents/:id/soul returns SOUL.md', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents/jarvis/soul`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.agentId).toBe('jarvis');
    expect(body.content).toBeDefined();
    expect(typeof body.content).toBe('string');
    expect(body.content).toContain('Jarvis');
    expect(body.content).toContain('Core Principles');
  });

  test('PUT /api/agents/:id/soul updates SOUL.md', async ({ request }) => {
    const newContent = '# SOUL.md - Jarvis\n\nUpdated soul content.\n\n## Core Principles\n- Be helpful\n- Be accurate\n';
    const res = await request.put(`${server.baseUrl}/api/agents/jarvis/soul`, {
      data: { content: newContent },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify the update
    const getRes = await request.get(`${server.baseUrl}/api/agents/jarvis/soul`);
    const getBody = await getRes.json();
    expect(getBody.content).toBe(newContent);
  });

  test('GET /api/agents/:id/heartbeat returns HEARTBEAT.md', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/agents/jarvis/heartbeat`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.agentId).toBe('jarvis');
    expect(body.content).toBeDefined();
    expect(typeof body.content).toBe('string');
    expect(body.content).toContain('Heartbeat');
  });

  test('PUT /api/agents/:id/heartbeat updates HEARTBEAT.md', async ({ request }) => {
    const newContent = '# Heartbeat\n\nUpdated heartbeat checklist.\n\n- [ ] Check all services\n';
    const res = await request.put(`${server.baseUrl}/api/agents/jarvis/heartbeat`, {
      data: { content: newContent },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify the update
    const getRes = await request.get(`${server.baseUrl}/api/agents/jarvis/heartbeat`);
    const getBody = await getRes.json();
    expect(getBody.content).toBe(newContent);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Sessions
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/sessions returns session list', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/sessions`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.sessions).toBeDefined();
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Skills
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/skills loads pre-seeded skills from disk on startup', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/skills`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.skills).toBeDefined();
    expect(Array.isArray(body.skills)).toBe(true);
    // Should have the pre-seeded 'code-review' skill from disk
    const codeReview = body.skills.find((s: { name: string }) => s.name === 'code-review');
    expect(codeReview).toBeDefined();
    expect(codeReview.status).toBe('active');
    expect(codeReview.description).toContain('Review code');
  });

  test('POST /api/skills/install creates a pending skill', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/skills/install`, {
      data: {
        name: 'git-workflow',
        description: 'Git branching workflow instructions',
        content: '# Git Workflow\n\nUse feature branches.\n',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.skill).toBeDefined();
    expect(body.skill.name).toBe('git-workflow');
    expect(body.skill.status).toBe('pending');
    expect(body.skill.description).toBe('Git branching workflow instructions');
  });

  test('POST /api/skills/install rejects duplicate name', async ({ request }) => {
    // Ensure the skill exists first (may have been created by previous test)
    const check = await request.get(`${server.baseUrl}/api/skills`);
    const checkBody = await check.json();
    if (!checkBody.skills.find((s: { name: string }) => s.name === 'git-workflow')) {
      await request.post(`${server.baseUrl}/api/skills/install`, {
        data: { name: 'git-workflow', description: 'test' },
      });
    }

    const res = await request.post(`${server.baseUrl}/api/skills/install`, {
      data: { name: 'git-workflow', description: 'duplicate' },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already exists');
  });

  test('POST /api/skills/install rejects invalid name', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/skills/install`, {
      data: { name: 'Invalid Name!', description: 'bad' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  test('POST /api/skills/install rejects missing name', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/skills/install`, {
      data: { description: 'no name' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('name');
  });

  test('GET /api/skills lists installed skills', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/skills`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.skills.length).toBeGreaterThanOrEqual(1);
    const gitSkill = body.skills.find((s: { name: string }) => s.name === 'git-workflow');
    expect(gitSkill).toBeDefined();
    expect(gitSkill.status).toBe('pending');
  });

  test('POST /api/skills/:name/approve transitions to active', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/skills/git-workflow/approve`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.skill).toBeDefined();
    expect(body.skill.status).toBe('active');
    expect(body.skill.approved_at).toBeTruthy();
  });

  test('POST /api/skills/:name/approve rejects non-pending skill', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/skills/git-workflow/approve`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not pending');
  });

  test('POST /api/skills/:name/approve rejects unknown skill', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/skills/nonexistent/approve`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  test('POST /api/skills/:name/reject transitions to disabled', async ({ request }) => {
    // Create a new skill to reject
    await request.post(`${server.baseUrl}/api/skills/install`, {
      data: { name: 'reject-me', description: 'will be rejected' },
    });

    const res = await request.post(`${server.baseUrl}/api/skills/reject-me/reject`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test('POST /api/skills/:name/reject rejects non-pending skill', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/skills/reject-me/reject`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not pending');
  });

  test('POST /api/skills/:name/assign assigns skill to agent', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/skills/git-workflow/assign`, {
      data: { agentId: 'jarvis' },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify agent has the skill
    const agentRes = await request.get(`${server.baseUrl}/api/agents/jarvis`);
    const agentBody = await agentRes.json();
    expect(agentBody.agent.skills).toContain('git-workflow');
  });

  test('GET /api/skills includes assignedAgents after assignment', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/skills`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    const gitSkill = body.skills.find((s: { name: string }) => s.name === 'git-workflow');
    expect(gitSkill).toBeDefined();
    expect(Array.isArray(gitSkill.assignedAgents)).toBe(true);
    expect(gitSkill.assignedAgents).toContain('jarvis');
  });

  test('POST /api/skills/:name/unassign removes skill from agent', async ({ request }) => {
    const res = await request.post(`${server.baseUrl}/api/skills/git-workflow/unassign`, {
      data: { agentId: 'jarvis' },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify agent no longer has the skill
    const agentRes = await request.get(`${server.baseUrl}/api/agents/jarvis`);
    const agentBody = await agentRes.json();
    expect(agentBody.agent.skills).not.toContain('git-workflow');
  });

  test('DELETE /api/skills/:name removes the skill', async ({ request }) => {
    const res = await request.delete(`${server.baseUrl}/api/skills/reject-me`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verify it is gone
    const listRes = await request.get(`${server.baseUrl}/api/skills`);
    const listBody = await listRes.json();
    const found = listBody.skills.find((s: { name: string }) => s.name === 'reject-me');
    expect(found).toBeUndefined();
  });

  test('DELETE /api/skills/:name returns 404 for unknown', async ({ request }) => {
    const res = await request.delete(`${server.baseUrl}/api/skills/nonexistent`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Stubs (MCP, Channels, Cron)
  // ═══════════════════════════════════════════════════════════════════════

  test('GET /api/mcp returns array', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/mcp`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.mcpServers).toBeDefined();
    expect(Array.isArray(body.mcpServers)).toBe(true);
  });

  test('GET /api/channels returns array', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/channels`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.channels).toBeDefined();
    expect(Array.isArray(body.channels)).toBe(true);
  });

  test('GET /api/cron returns jobs array', async ({ request }) => {
    const res = await request.get(`${server.baseUrl}/api/cron`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.jobs).toBeDefined();
    expect(Array.isArray(body.jobs)).toBe(true);
  });
});
