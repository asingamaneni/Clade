# SOUL.md & Self-Improvement

Every agent has a `SOUL.md` file that defines its personality, communication style, and behavioral guidelines. This file evolves over time as the agent learns from interactions.

## What's in SOUL.md

```markdown
# Core Principles (LOCKED — never modified by reflection)

You are a proactive assistant. You observe, anticipate, and act.
You communicate clearly and concisely.
You never wait for instructions when you can anticipate needs.

# Communication Style

- Direct and concise
- Use bullet points for complex topics
- Provide context before recommendations

# Learned Preferences

- User prefers TypeScript over JavaScript
- User wants tests written for all new code
- User prefers detailed commit messages
```

## The Reflection Cycle

After every N sessions (configurable, default 10), the agent reflects:

1. **Review** — Agent reads recent interactions from memory
2. **Identify patterns** — Communication style, preferences, workflow habits
3. **Generate updates** — Proposes changes to SOUL.md
4. **Apply** — Updates SOUL.md with new insights
5. **Snapshot** — Previous version saved to `soul-history/YYYY-MM-DD.md`

## Core Principles Are Locked

The section under `# Core Principles` is **immutable**. The reflection cycle cannot modify it. This prevents personality drift or self-modification loops.

If you want to change Core Principles, edit SOUL.md manually.

## History & Rollback

Every reflection creates a snapshot in `soul-history/`:

```
~/.clade/agents/jarvis/soul-history/
├── 2025-01-15.md
├── 2025-01-22.md
└── 2025-01-29.md
```

To rollback, copy an older version back:

```bash
cp ~/.clade/agents/jarvis/soul-history/2025-01-22.md \
   ~/.clade/agents/jarvis/SOUL.md
```

## Configuration

```json
{
  "reflection": {
    "enabled": true,
    "interval": 10
  }
}
```

- `enabled` — Whether the reflection cycle runs
- `interval` — Number of sessions between reflections

## Why This Matters

Traditional chatbots are stateless — every conversation starts from scratch. Clade agents accumulate understanding of how you work, what you prefer, and how to communicate with you. This happens organically, not through manual configuration.

The locked Core Principles ensure the agent's fundamental values don't drift, while everything else adapts to you.
