// ---------------------------------------------------------------------------
// Tests: SQLite Store
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../../src/store/sqlite.js';

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = Store.inMemory();
  });

  afterEach(() => {
    store.close();
  });

  // -----------------------------------------------------------------------
  // Database initialization
  // -----------------------------------------------------------------------

  describe('initialization', () => {
    it('should create all required tables', () => {
      const db = store.raw;
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as Array<{ name: string }>;

      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('sessions');
      expect(tableNames).toContain('users');
      expect(tableNames).toContain('mcp_servers');
      expect(tableNames).toContain('skills');
      expect(tableNames).toContain('cron_jobs');
      expect(tableNames).toContain('memory_index');
    });

    it('should create the FTS5 virtual table', () => {
      const db = store.raw;
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='memory_fts'",
        )
        .all() as Array<{ name: string }>;

      expect(tables).toHaveLength(1);
    });

    it('should return database stats', () => {
      const stats = store.stats();
      expect(stats['sessions']).toBe(0);
      expect(stats['users']).toBe(0);
      expect(stats['mcp_servers']).toBe(0);
      expect(stats['skills']).toBe(0);
      expect(stats['cron_jobs']).toBe(0);
      expect(stats['memory_index']).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Sessions CRUD
  // -----------------------------------------------------------------------

  describe('sessions', () => {
    it('should create and retrieve a session', () => {
      const session = store.createSession({
        id: 'sess-1',
        agentId: 'main',
        channel: 'telegram',
        channelUserId: 'user1',
      });

      expect(session.id).toBe('sess-1');
      expect(session.agent_id).toBe('main');
      expect(session.channel).toBe('telegram');
      expect(session.status).toBe('active');
    });

    it('should get a session by ID', () => {
      store.createSession({ id: 'sess-2', agentId: 'main' });
      const found = store.getSession('sess-2');
      expect(found).toBeDefined();
      expect(found!.id).toBe('sess-2');
    });

    it('should return undefined for nonexistent session', () => {
      const found = store.getSession('nonexistent');
      expect(found).toBeUndefined();
    });

    it('should list sessions filtered by agent', () => {
      store.createSession({ id: 's1', agentId: 'main' });
      store.createSession({ id: 's2', agentId: 'coder' });
      store.createSession({ id: 's3', agentId: 'main' });

      const mainSessions = store.listSessions({ agentId: 'main' });
      expect(mainSessions).toHaveLength(2);
    });

    it('should update session status', () => {
      store.createSession({ id: 's4', agentId: 'main' });
      store.updateSessionStatus('s4', 'terminated');

      const session = store.getSession('s4');
      expect(session!.status).toBe('terminated');
    });

    it('should delete a session', () => {
      store.createSession({ id: 's5', agentId: 'main' });
      const deleted = store.deleteSession('s5');
      expect(deleted).toBe(true);
      expect(store.getSession('s5')).toBeUndefined();
    });

    it('should return false when deleting nonexistent session', () => {
      const deleted = store.deleteSession('ghost');
      expect(deleted).toBe(false);
    });

    it('should find active session by agent/channel/user', () => {
      store.createSession({
        id: 'active-1',
        agentId: 'main',
        channel: 'slack',
        channelUserId: 'U001',
      });

      const found = store.findActiveSession({
        agentId: 'main',
        channel: 'slack',
        channelUserId: 'U001',
      });
      expect(found).toBeDefined();
      expect(found!.id).toBe('active-1');
    });

    it('should not find terminated session as active', () => {
      store.createSession({
        id: 'term-1',
        agentId: 'main',
        channel: 'slack',
        channelUserId: 'U002',
      });
      store.updateSessionStatus('term-1', 'terminated');

      const found = store.findActiveSession({
        agentId: 'main',
        channel: 'slack',
        channelUserId: 'U002',
      });
      expect(found).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Users CRUD
  // -----------------------------------------------------------------------

  describe('users', () => {
    it('should create/upsert and retrieve a user', () => {
      const user = store.upsertUser({
        channel: 'telegram',
        channelUserId: 'tg-123',
        agentId: 'main',
        displayName: 'Alice',
      });

      expect(user.channel).toBe('telegram');
      expect(user.channel_user_id).toBe('tg-123');
      expect(user.agent_id).toBe('main');
      expect(user.display_name).toBe('Alice');
    });

    it('should get user by channel and ID', () => {
      store.upsertUser({
        channel: 'slack',
        channelUserId: 'U001',
        agentId: 'main',
      });

      const found = store.getUser('slack', 'U001');
      expect(found).toBeDefined();
      expect(found!.agent_id).toBe('main');
    });

    it('should return undefined for nonexistent user', () => {
      const found = store.getUser('ghost', 'channel');
      expect(found).toBeUndefined();
    });

    it('should upsert user (update on conflict)', () => {
      store.upsertUser({
        channel: 'telegram',
        channelUserId: 'tg-u1',
        agentId: 'main',
      });
      store.upsertUser({
        channel: 'telegram',
        channelUserId: 'tg-u1',
        agentId: 'coder',
      });

      const user = store.getUser('telegram', 'tg-u1');
      expect(user!.agent_id).toBe('coder');
    });

    it('should list all users', () => {
      store.upsertUser({ channel: 'slack', channelUserId: 'u1', agentId: 'main' });
      store.upsertUser({ channel: 'slack', channelUserId: 'u2', agentId: 'coder' });

      const users = store.listUsers();
      expect(users).toHaveLength(2);
    });

    it('should delete a user', () => {
      store.upsertUser({ channel: 'slack', channelUserId: 'del-user', agentId: 'main' });
      const deleted = store.deleteUser('slack', 'del-user');
      expect(deleted).toBe(true);

      const found = store.getUser('slack', 'del-user');
      expect(found).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // MCP Servers CRUD
  // -----------------------------------------------------------------------

  describe('mcp_servers', () => {
    it('should create and retrieve an mcp server', () => {
      const server = store.createMcpServer({
        name: 'weather-mcp',
        package: '@mcp/weather',
        requestedBy: 'main',
      });

      expect(server.name).toBe('weather-mcp');
      expect(server.status).toBe('pending');
      expect(server.requested_by).toBe('main');
    });

    it('should approve an mcp server', () => {
      store.createMcpServer({ name: 'test-skill' });
      store.approveMcpServer('test-skill');

      const server = store.getMcpServer('test-skill');
      expect(server!.status).toBe('active');
      expect(server!.approved_at).toBeTruthy();
    });

    it('should disable an mcp server', () => {
      store.createMcpServer({ name: 'dis-skill' });
      store.approveMcpServer('dis-skill');
      store.disableMcpServer('dis-skill');

      const server = store.getMcpServer('dis-skill');
      expect(server!.status).toBe('disabled');
    });

    it('should list mcp servers by status', () => {
      store.createMcpServer({ name: 's1' });
      store.createMcpServer({ name: 's2' });
      store.createMcpServer({ name: 's3' });
      store.approveMcpServer('s2');

      const pending = store.listMcpServers('pending');
      expect(pending).toHaveLength(2);

      const active = store.listMcpServers('active');
      expect(active).toHaveLength(1);
      expect(active[0]!.name).toBe('s2');
    });

    it('should delete an mcp server', () => {
      store.createMcpServer({ name: 'to-delete' });
      const deleted = store.deleteMcpServer('to-delete');
      expect(deleted).toBe(true);
      expect(store.getMcpServer('to-delete')).toBeUndefined();
    });

    it('should store and parse mcp server config JSON', () => {
      const config = { apiKey: 'abc', endpoint: 'https://example.com' };
      store.createMcpServer({
        name: 'config-skill',
        config,
      });

      const server = store.getMcpServer('config-skill')!;
      const parsed = store.parseMcpServerConfig(server);
      expect(parsed).toEqual(config);
    });
  });

  // -----------------------------------------------------------------------
  // Skills CRUD
  // -----------------------------------------------------------------------

  describe('skills', () => {
    it('should create and retrieve a skill', () => {
      const skill = store.createSkill({
        name: 'git-workflow',
        description: 'Git workflow instructions',
        requestedBy: 'main',
      });

      expect(skill.name).toBe('git-workflow');
      expect(skill.status).toBe('pending');
      expect(skill.description).toBe('Git workflow instructions');
      expect(skill.requested_by).toBe('main');
      expect(skill.created_at).toBeTruthy();
    });

    it('should get a skill by name', () => {
      store.createSkill({ name: 'test-skill' });
      const found = store.getSkill('test-skill');
      expect(found).toBeDefined();
      expect(found!.name).toBe('test-skill');
    });

    it('should return undefined for nonexistent skill', () => {
      const found = store.getSkill('nonexistent');
      expect(found).toBeUndefined();
    });

    it('should create skill with path', () => {
      const skill = store.createSkill({
        name: 'docker-helper',
        path: '/home/user/.clade/skills/docker-helper',
      });

      expect(skill.path).toBe('/home/user/.clade/skills/docker-helper');
    });

    it('should approve a skill', () => {
      store.createSkill({ name: 'approve-me' });
      store.approveSkill('approve-me');

      const skill = store.getSkill('approve-me');
      expect(skill!.status).toBe('active');
      expect(skill!.approved_at).toBeTruthy();
    });

    it('should disable a skill', () => {
      store.createSkill({ name: 'disable-me' });
      store.approveSkill('disable-me');
      store.disableSkill('disable-me');

      const skill = store.getSkill('disable-me');
      expect(skill!.status).toBe('disabled');
    });

    it('should list skills by status', () => {
      store.createSkill({ name: 'sk1' });
      store.createSkill({ name: 'sk2' });
      store.createSkill({ name: 'sk3' });
      store.approveSkill('sk2');

      const pending = store.listSkills('pending');
      expect(pending).toHaveLength(2);

      const active = store.listSkills('active');
      expect(active).toHaveLength(1);
      expect(active[0]!.name).toBe('sk2');
    });

    it('should list all skills when no status filter', () => {
      store.createSkill({ name: 'a1' });
      store.createSkill({ name: 'a2' });
      store.approveSkill('a2');

      const all = store.listSkills();
      expect(all).toHaveLength(2);
    });

    it('should delete a skill', () => {
      store.createSkill({ name: 'to-delete' });
      const deleted = store.deleteSkill('to-delete');
      expect(deleted).toBe(true);
      expect(store.getSkill('to-delete')).toBeUndefined();
    });

    it('should return false when deleting nonexistent skill', () => {
      const deleted = store.deleteSkill('ghost');
      expect(deleted).toBe(false);
    });

    it('should create skill with explicit active status', () => {
      const skill = store.createSkill({
        name: 'pre-approved',
        status: 'active',
      });
      expect(skill.status).toBe('active');
    });

    it('should handle skill without optional fields', () => {
      const skill = store.createSkill({ name: 'minimal' });
      expect(skill.name).toBe('minimal');
      expect(skill.status).toBe('pending');
      expect(skill.description).toBeNull();
      expect(skill.path).toBeNull();
      expect(skill.requested_by).toBeNull();
      expect(skill.approved_at).toBeNull();
    });

    it('should include skills in stats', () => {
      store.createSkill({ name: 'stat-skill' });
      const stats = store.stats();
      expect(stats['skills']).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // Cron Jobs CRUD
  // -----------------------------------------------------------------------

  describe('cron jobs', () => {
    it('should create and retrieve a cron job', () => {
      const job = store.createCronJob({
        name: 'daily-report',
        schedule: '0 9 * * *',
        agentId: 'main',
        prompt: 'Generate daily report',
        deliverTo: 'slack:#reports',
      });

      expect(job.name).toBe('daily-report');
      expect(job.schedule).toBe('0 9 * * *');
      expect(job.agent_id).toBe('main');
      expect(job.deliver_to).toBe('slack:#reports');
      expect(job.enabled).toBe(1);
    });

    it('should get cron job by name', () => {
      store.createCronJob({
        name: 'test-job',
        schedule: '*/15 * * * *',
        agentId: 'main',
        prompt: 'test',
      });

      const found = store.getCronJobByName('test-job');
      expect(found).toBeDefined();
      expect(found!.name).toBe('test-job');
    });

    it('should list cron jobs with filters', () => {
      store.createCronJob({ name: 'j1', schedule: '* * * * *', agentId: 'main', prompt: 'p1' });
      store.createCronJob({ name: 'j2', schedule: '* * * * *', agentId: 'coder', prompt: 'p2' });

      const mainJobs = store.listCronJobs({ agentId: 'main' });
      expect(mainJobs).toHaveLength(1);

      const allJobs = store.listCronJobs();
      expect(allJobs).toHaveLength(2);
    });

    it('should filter by enabled status', () => {
      store.createCronJob({ name: 'enabled-job', schedule: '* * * * *', agentId: 'main', prompt: 'p' });
      store.createCronJob({ name: 'disabled-job', schedule: '* * * * *', agentId: 'main', prompt: 'p' });

      const disabledRow = store.getCronJobByName('disabled-job')!;
      store.disableCronJob(disabledRow.id);

      const enabled = store.listCronJobs({ enabled: true });
      expect(enabled).toHaveLength(1);
      expect(enabled[0]!.name).toBe('enabled-job');
    });

    it('should update last run time', () => {
      const job = store.createCronJob({
        name: 'run-job',
        schedule: '* * * * *',
        agentId: 'main',
        prompt: 'test',
      });

      expect(job.last_run_at).toBeNull();

      store.updateCronJobLastRun(job.id);
      const updated = store.getCronJob(job.id);
      expect(updated!.last_run_at).toBeTruthy();
    });

    it('should delete cron job by name', () => {
      store.createCronJob({ name: 'del-job', schedule: '* * * * *', agentId: 'main', prompt: 'p' });
      const deleted = store.deleteCronJobByName('del-job');
      expect(deleted).toBe(true);
      expect(store.getCronJobByName('del-job')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Memory Index + FTS5
  // -----------------------------------------------------------------------

  describe('memory index and FTS5 search', () => {
    it('should insert and retrieve memory chunks', () => {
      const chunk = store.indexMemoryChunk({
        agentId: 'main',
        filePath: 'MEMORY.md',
        chunkText: 'The user prefers dark mode in all applications.',
        chunkStart: 0,
        chunkEnd: 46,
      });

      expect(chunk.agent_id).toBe('main');
      expect(chunk.chunk_text).toContain('dark mode');
    });

    it('should search memory with FTS5', () => {
      store.indexMemoryChunk({
        agentId: 'main',
        filePath: 'MEMORY.md',
        chunkText: 'The user prefers TypeScript over JavaScript for all projects.',
      });
      store.indexMemoryChunk({
        agentId: 'main',
        filePath: 'memory/2024-01-15.md',
        chunkText: 'User asked about Python web frameworks.',
      });
      store.indexMemoryChunk({
        agentId: 'other',
        filePath: 'MEMORY.md',
        chunkText: 'TypeScript is a typed superset of JavaScript.',
      });

      const results = store.searchMemory('main', 'TypeScript');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.chunk_text).toContain('TypeScript');
      // Should only return results for the 'main' agent
      for (const r of results) {
        expect(r.agent_id).toBe('main');
      }
    });

    it('should rank more relevant results higher', () => {
      store.indexMemoryChunk({
        agentId: 'main',
        filePath: 'f1.md',
        chunkText: 'TypeScript is great for building large-scale TypeScript applications with TypeScript.',
      });
      store.indexMemoryChunk({
        agentId: 'main',
        filePath: 'f2.md',
        chunkText: 'I went to the store today and bought some food.',
      });

      const results = store.searchMemory('main', 'TypeScript');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.file_path).toBe('f1.md');
    });

    it('should clear memory file chunks', () => {
      store.indexMemoryChunk({
        agentId: 'main',
        filePath: 'clear-me.md',
        chunkText: 'chunk 1',
      });
      store.indexMemoryChunk({
        agentId: 'main',
        filePath: 'clear-me.md',
        chunkText: 'chunk 2',
      });
      store.indexMemoryChunk({
        agentId: 'main',
        filePath: 'keep-me.md',
        chunkText: 'chunk 3',
      });

      const cleared = store.clearMemoryFile('main', 'clear-me.md');
      expect(cleared).toBe(2);

      const remaining = store.listMemoryChunks('main');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.file_path).toBe('keep-me.md');
    });

    it('should clear all agent memory', () => {
      store.indexMemoryChunk({ agentId: 'main', filePath: 'a.md', chunkText: 'hello' });
      store.indexMemoryChunk({ agentId: 'main', filePath: 'b.md', chunkText: 'world' });
      store.indexMemoryChunk({ agentId: 'other', filePath: 'c.md', chunkText: 'kept' });

      const cleared = store.clearAgentMemory('main');
      expect(cleared).toBe(2);

      const mainChunks = store.listMemoryChunks('main');
      expect(mainChunks).toHaveLength(0);

      const otherChunks = store.listMemoryChunks('other');
      expect(otherChunks).toHaveLength(1);
    });

    it('should list chunks by agent and optionally by file', () => {
      store.indexMemoryChunk({ agentId: 'main', filePath: 'a.md', chunkText: 'c1', chunkStart: 0, chunkEnd: 2 });
      store.indexMemoryChunk({ agentId: 'main', filePath: 'a.md', chunkText: 'c2', chunkStart: 2, chunkEnd: 4 });
      store.indexMemoryChunk({ agentId: 'main', filePath: 'b.md', chunkText: 'c3', chunkStart: 0, chunkEnd: 2 });

      const allChunks = store.listMemoryChunks('main');
      expect(allChunks).toHaveLength(3);

      const fileChunks = store.listMemoryChunks('main', 'a.md');
      expect(fileChunks).toHaveLength(2);
    });
  });

  // -----------------------------------------------------------------------
  // Transactions
  // -----------------------------------------------------------------------

  describe('transactions', () => {
    it('should execute operations atomically', () => {
      store.transaction(() => {
        store.createSession({ id: 'tx-1', agentId: 'main' });
        store.createSession({ id: 'tx-2', agentId: 'main' });
      });

      const sessions = store.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('should rollback on error', () => {
      try {
        store.transaction(() => {
          store.createSession({ id: 'tx-ok', agentId: 'main' });
          throw new Error('abort');
        });
      } catch {
        // Expected
      }

      const sessions = store.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });
});
