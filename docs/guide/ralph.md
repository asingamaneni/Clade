# RALPH — Autonomous Work

RALPH (Read-Assess-Learn-Plan-Handle) is Clade's autonomous work loop. Give an agent a task list, and it works through each task independently, verifying its work and reporting progress.

## Quick Start

```bash
# Create a plan
cat > PLAN.md << 'EOF'
- [ ] Research competitor pricing models
- [ ] Summarize findings in a report
- [ ] Draft recommendations for our pricing strategy
EOF

# Let the research agent work through it
clade work --agent researcher --plan ./PLAN.md
```

## How It Works

```
┌─── Loop (fresh context each iteration) ──────────────────────┐
│ 1. Read PLAN.md → find next task with status "open"           │
│ 2. Set task status to "in_progress"                           │
│ 3. Read progress.md → accumulated learnings from prior tasks  │
│ 4. Build prompt with task + learnings + domain guidelines     │
│ 5. Spawn: claude -p "work prompt" --max-turns 25              │
│ 6. Parse result                                               │
│ 7. Run verification (optional configurable command)           │
│ 8. Passing? → mark "done", log learnings, send status update  │
│ 9. Failing? → increment retry, append failure info            │
│ 10. Max retries? → mark "blocked", move to next               │
│ 11. All tasks done? → EXIT with summary                       │
│ 12. More tasks? → LOOP (fresh claude instance)                │
└───────────────────────────────────────────────────────────────┘
```

Each iteration uses a **fresh Claude context** — this prevents context window exhaustion on long task lists. Learnings accumulate in `progress.md` and carry forward.

## Domain-Aware Work

RALPH adapts its work style based on the agent's domain:

| Domain | Behavior |
|--------|----------|
| `coding` | Write production code, run tests, auto-commit on success |
| `research` | Find accurate info, cross-reference sources, save to memory |
| `ops` | Diagnose systematically, attempt remediation, escalate if needed |
| `general` | Complete the task to a high standard, verify your work |

For coding agents, each completed task automatically commits to git with a descriptive message.

## Status Updates

RALPH sends progress updates to the user's preferred channel. Configure this per-agent:

```json
{
  "agents": {
    "researcher": {
      "notifications": {
        "preferredChannel": "slack:#research-updates"
      }
    }
  }
}
```

You'll get notified when tasks are completed, blocked, or when the full plan is done.

## Plan Format

Plans use standard markdown checkboxes:

```markdown
- [ ] Task one (open)
- [x] Task two (already done, will be skipped)
- [ ] Task three with more detail
  Context: additional information the agent should know
```

## Verification

You can specify a verification command that runs after each task:

```bash
clade work --agent coder --plan ./PLAN.md --verify "npm test"
```

If verification fails, the task is retried (up to the max retry count) before being marked as blocked.
