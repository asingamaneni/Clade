/**
 * Playwright E2E tests for the secondary admin pages:
 * Skills, Channels, Cron, Config, and Sessions.
 *
 * Validates both the UI navigation (clicking sidebar links and verifying
 * page content) and the underlying REST API contracts for each section.
 *
 * Pre-seeded data:
 * - 2 agents: jarvis (coding) and scout (research/messaging)
 * - 1 conversation for jarvis with 2 messages
 * - Channels: webchat enabled, slack/telegram/discord disabled
 */
import { test, expect } from '@playwright/test';
import { startTestServer, stopTestServer, TestServer } from './fixtures/server.ts';

let server: TestServer;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(() => {
  stopTestServer(server);
});

test.describe('Secondary Pages', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // MCP Servers page
  // ═══════════════════════════════════════════════════════════════════════

  test('MCP Servers page loads', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=MCP Servers').first().click();
    await page.waitForTimeout(500);
    // MCP Servers page should show - either empty state or server list
    // Look for "MCP" heading or "No MCP servers" message
    const hasMcp = await page.locator('text=/[Mm][Cc][Pp]/').first().isVisible();
    expect(hasMcp).toBe(true);
  });

  test('MCP Servers API returns empty array', async ({ request }) => {
    const res = await request.get(server.baseUrl + '/api/mcp');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.mcpServers).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Skills page
  // ═══════════════════════════════════════════════════════════════════════

  test('Skills page loads', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Skills').first().click();
    await page.waitForTimeout(500);
    // Skills page should show - look for "Skill" in the page
    const hasSkills = await page.locator('text=/[Ss]kill/').first().isVisible();
    expect(hasSkills).toBe(true);
  });

  test('Skills API returns pre-seeded skills from disk', async ({ request }) => {
    const res = await request.get(server.baseUrl + '/api/skills');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.skills).toBeDefined();
    expect(Array.isArray(body.skills)).toBe(true);
    // Should have the pre-seeded 'code-review' skill loaded from disk
    const codeReview = body.skills.find((s: { name: string }) => s.name === 'code-review');
    expect(codeReview).toBeDefined();
    expect(codeReview.status).toBe('active');
  });

  test('Skills API full lifecycle: install, approve, delete', async ({ request }) => {
    // Install a skill
    const installRes = await request.post(server.baseUrl + '/api/skills/install', {
      data: {
        name: 'e2e-test-skill',
        description: 'E2E test skill',
        content: '# E2E Test Skill\n\nTest instructions.\n',
      },
    });
    expect(installRes.status()).toBe(201);
    const installBody = await installRes.json();
    expect(installBody.skill.status).toBe('pending');

    // Approve it
    const approveRes = await request.post(server.baseUrl + '/api/skills/e2e-test-skill/approve');
    expect(approveRes.ok()).toBe(true);
    const approveBody = await approveRes.json();
    expect(approveBody.skill.status).toBe('active');

    // Verify it appears in the list
    const listRes = await request.get(server.baseUrl + '/api/skills');
    const listBody = await listRes.json();
    const found = listBody.skills.find((s: { name: string }) => s.name === 'e2e-test-skill');
    expect(found).toBeDefined();
    expect(found.status).toBe('active');

    // Delete it
    const deleteRes = await request.delete(server.baseUrl + '/api/skills/e2e-test-skill');
    expect(deleteRes.ok()).toBe(true);

    // Verify it is gone
    const afterDelete = await request.get(server.baseUrl + '/api/skills');
    const afterDeleteBody = await afterDelete.json();
    const gone = afterDeleteBody.skills.find((s: { name: string }) => s.name === 'e2e-test-skill');
    expect(gone).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Channels page
  // ═══════════════════════════════════════════════════════════════════════

  test('Channels page loads', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Channels').first().click();
    await page.waitForTimeout(500);
    // Should see channel-related content
    const hasChannels = await page.locator('text=/[Cc]hannel/').first().isVisible();
    expect(hasChannels).toBe(true);
  });

  test('Channels API returns channel list', async ({ request }) => {
    const res = await request.get(server.baseUrl + '/api/channels');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.channels).toBeDefined();
    expect(Array.isArray(body.channels)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Cron page
  // ═══════════════════════════════════════════════════════════════════════

  test('Cron page loads', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Cron').first().click();
    await page.waitForTimeout(500);
    const hasCron = await page.locator('text=/[Cc]ron/').first().isVisible();
    expect(hasCron).toBe(true);
  });

  test('Cron API returns empty jobs', async ({ request }) => {
    const res = await request.get(server.baseUrl + '/api/cron');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.jobs).toEqual([]);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Config page
  // ═══════════════════════════════════════════════════════════════════════

  test('Config page loads', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Config').first().click();
    await page.waitForTimeout(500);
    // Should see config content - the JSON or config UI
    const hasConfig = await page.locator('text=/[Cc]onfig/').first().isVisible();
    expect(hasConfig).toBe(true);
  });

  test('Config API returns config with gateway', async ({ request }) => {
    const res = await request.get(server.baseUrl + '/api/config');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.config).toBeDefined();
    expect(body.config.gateway).toBeDefined();
    expect(body.config.gateway.port).toBe(server.port);
  });

  test('Config can be updated via API', async ({ request }) => {
    // Read current config
    const getRes = await request.get(server.baseUrl + '/api/config');
    const original = await getRes.json();

    // Update config
    const putRes = await request.put(server.baseUrl + '/api/config', {
      data: { routing: { defaultAgent: 'scout', rules: [] } },
    });
    expect(putRes.ok()).toBe(true);

    // Verify update
    const verifyRes = await request.get(server.baseUrl + '/api/config');
    const updated = await verifyRes.json();
    expect(updated.config.routing.defaultAgent).toBe('scout');

    // Restore original
    await request.put(server.baseUrl + '/api/config', {
      data: { routing: original.config.routing },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Sessions page
  // ═══════════════════════════════════════════════════════════════════════

  test('Sessions page loads', async ({ page }) => {
    await page.goto(server.baseUrl + '/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Sessions').first().click();
    await page.waitForTimeout(500);
    const hasSessions = await page.locator('text=/[Ss]ession/').first().isVisible();
    expect(hasSessions).toBe(true);
  });

  test('Sessions API returns session data', async ({ request }) => {
    const res = await request.get(server.baseUrl + '/api/sessions');
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.sessions).toBeDefined();
    expect(Array.isArray(body.sessions)).toBe(true);
    // Should have at least the pre-seeded jarvis conversation
    expect(body.sessions.length).toBeGreaterThan(0);
    const jarvisSession = body.sessions.find((s: { agentId: string }) => s.agentId === 'jarvis');
    expect(jarvisSession).toBeDefined();
  });

  test('Sessions show agent ID and status', async ({ request }) => {
    const res = await request.get(server.baseUrl + '/api/sessions');
    const body = await res.json();
    const session = body.sessions[0];
    expect(session.agentId).toBeDefined();
    expect(session.status).toMatch(/^(active|idle)$/);
    expect(session.channel).toBe('webchat');
  });
});
