// ---------------------------------------------------------------------------
// Custom error types for TeamAgents
//
// Each error carries a `code` string for programmatic matching and inherits
// from the base `TeamAgentsError` so callers can catch broad or narrow.
// ---------------------------------------------------------------------------

/**
 * Base error class for all TeamAgents errors.
 * Provides a machine-readable `code` alongside the human-readable `message`.
 */
export class TeamAgentsError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'TeamAgentsError';
    this.code = code;
    // Restore the prototype chain (necessary when extending built-ins).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Configuration errors
// ---------------------------------------------------------------------------

export class ConfigError extends TeamAgentsError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class ConfigNotFoundError extends ConfigError {
  public readonly path: string;

  constructor(path: string) {
    super(`Config file not found: ${path}`);
    this.name = 'ConfigNotFoundError';
    this.path = path;
  }
}

export class ConfigValidationError extends ConfigError {
  public readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    const summary = issues
      .map((i) => `  - ${i.path}: ${i.message}`)
      .join('\n');
    super(`Config validation failed:\n${summary}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Session errors
// ---------------------------------------------------------------------------

export class SessionError extends TeamAgentsError {
  constructor(message: string) {
    super(message, 'SESSION_ERROR');
    this.name = 'SessionError';
  }
}

export class SessionNotFoundError extends SessionError {
  public readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}

export class SessionSpawnError extends SessionError {
  public readonly agentId: string;

  constructor(agentId: string, reason: string) {
    super(`Failed to spawn session for agent "${agentId}": ${reason}`);
    this.name = 'SessionSpawnError';
    this.agentId = agentId;
  }
}

// ---------------------------------------------------------------------------
// Channel errors
// ---------------------------------------------------------------------------

export class ChannelError extends TeamAgentsError {
  public readonly channel: string;

  constructor(channel: string, message: string) {
    super(`[${channel}] ${message}`, 'CHANNEL_ERROR');
    this.name = 'ChannelError';
    this.channel = channel;
  }
}

export class ChannelConnectionError extends ChannelError {
  constructor(channel: string, reason: string) {
    super(channel, `Connection failed: ${reason}`);
    this.name = 'ChannelConnectionError';
  }
}

export class ChannelSendError extends ChannelError {
  constructor(channel: string, target: string, reason: string) {
    super(channel, `Failed to send to "${target}": ${reason}`);
    this.name = 'ChannelSendError';
  }
}

// ---------------------------------------------------------------------------
// Agent errors
// ---------------------------------------------------------------------------

export class AgentError extends TeamAgentsError {
  public readonly agentId: string;

  constructor(agentId: string, message: string) {
    super(`Agent "${agentId}": ${message}`, 'AGENT_ERROR');
    this.name = 'AgentError';
    this.agentId = agentId;
  }
}

export class AgentNotFoundError extends AgentError {
  constructor(agentId: string) {
    super(agentId, 'not found');
    this.name = 'AgentNotFoundError';
  }
}

export class AgentConfigError extends AgentError {
  constructor(agentId: string, detail: string) {
    super(agentId, `configuration error — ${detail}`);
    this.name = 'AgentConfigError';
  }
}

// ---------------------------------------------------------------------------
// Store / database errors
// ---------------------------------------------------------------------------

export class StoreError extends TeamAgentsError {
  constructor(message: string) {
    super(message, 'STORE_ERROR');
    this.name = 'StoreError';
  }
}

export class StoreInitError extends StoreError {
  constructor(reason: string) {
    super(`Database initialization failed: ${reason}`);
    this.name = 'StoreInitError';
  }
}
