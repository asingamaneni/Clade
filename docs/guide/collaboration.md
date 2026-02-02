# Agent Collaboration

Agents in Clade can work together through delegation, shared memory, and a message bus.

## Delegation

One agent can formally hand off a task to another:

```
Agent "pm" delegates to "coder":
  Task: "Implement the user authentication module"
  Context: "Requirements are in docs/auth-spec.md"
  Callback: Notify pm when done
```

Delegation creates a task file in the target agent's directory. The target agent picks it up on its next heartbeat or when explicitly triggered.

## Shared Memory

Agents can read (but not write) each other's MEMORY.md:

- Agent "researcher" saves findings to its memory
- Agent "pm" reads researcher's memory to include in status reports
- No agent can modify another agent's memory (prevents conflicts)

This is read-only by design — it prevents prompt injection via shared memory while still enabling information flow.

## Message Bus

A pub/sub topic system for loose coupling:

```
Agent "coder" publishes: topic="code-review-needed", data={pr: "#42"}
Agent "reviewer" subscribes to: topic="code-review-needed"
  → Reviewer picks up the task
```

Topics are lightweight — agents subscribe to topics they care about, and messages are delivered asynchronously.

## @mentions in Channels

The simplest form of collaboration is @mentioning another agent in a channel message:

```
You: @jarvis fix the auth bug, then ask @researcher for the latest security best practices
```

The message routes to `jarvis`, who can then use the messaging MCP to contact `researcher` directly.

## Notifications

Agents can proactively update you on your preferred channel:

```json
{
  "notifications": {
    "preferredChannel": "slack:#updates",
    "minSeverity": "info",
    "quietHours": {
      "start": "22:00",
      "end": "08:00",
      "timezone": "America/New_York"
    },
    "batchDigest": true,
    "digestIntervalMinutes": 30
  }
}
```

- **Severity levels**: info, warn, error, critical
- **Quiet hours**: Suppress non-critical notifications during off hours
- **Digest batching**: Group low-severity notifications into periodic digests
