import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { ClaudeCliRunner } from './claude-cli.js';
import type { ClaudeOptions, ClaudeResult } from './claude-cli.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RalphConfig {
  agentId: string;
  planPath: string;
  progressPath?: string;
  verifyCommand?: string;
  maxRetries: number;
  maxIterations: number;
  workingDirectory?: string;
  systemPrompt?: string;
  model?: string;
  mcpConfigPath?: string;
  allowedTools?: string[];
  maxTurnsPerTask?: number;
  /** Agent domain — determines work guidelines and completion behavior. */
  domain?: 'coding' | 'research' | 'ops' | 'general';
  /** Whether to auto-commit after completing each task (default: true for coding, false otherwise). */
  autoCommit?: boolean;
  /** Optional callback to notify user of progress on their preferred channel. */
  onStatusUpdate?: (message: string) => void;
}

export interface PlanTask {
  index: number;
  text: string;
  status: 'open' | 'in_progress' | 'done' | 'blocked';
  lineNumber: number;
}

export type RalphProgressEventType =
  | 'loop_start'
  | 'task_start'
  | 'task_working'
  | 'task_verify'
  | 'task_done'
  | 'task_retry'
  | 'task_blocked'
  | 'task_error'
  | 'loop_done';

export interface RalphProgressEvent {
  type: RalphProgressEventType;
  iteration: number;
  task?: PlanTask;
  message: string;
  output?: string;
  durationMs?: number;
}

export interface RalphResult {
  totalIterations: number;
  tasksCompleted: number;
  tasksBlocked: number;
  tasksRemaining: number;
  durationMs: number;
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Defaults for RalphConfig
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_ITERATIONS = 50;
const DEFAULT_MAX_TURNS_PER_TASK = 25;

// ---------------------------------------------------------------------------
// RALPH Engine
// ---------------------------------------------------------------------------

export class RalphEngine {
  private aborted = false;
  private retryCounts: Map<number, number> = new Map();

  /**
   * Signal the engine to stop after the current iteration completes.
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * Parse a PLAN.md file into a list of tasks.
   *
   * Recognized formats:
   *   - [ ] Task text       -> open
   *   - [x] Task text       -> done
   *   - [!] Task text       -> blocked
   *   - [~] Task text       -> in_progress
   */
  parsePlan(content: string): PlanTask[] {
    const tasks: PlanTask[] = [];
    const lines = content.split('\n');
    let taskIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      const match = line.match(/^(\s*)-\s*\[([x !~])\]\s+(.+)$/i);
      if (match) {
        const marker = match[2]?.toLowerCase() ?? ' ';
        const text = match[3]?.trim() ?? '';

        let status: PlanTask['status'];
        switch (marker) {
          case 'x':
            status = 'done';
            break;
          case '!':
            status = 'blocked';
            break;
          case '~':
            status = 'in_progress';
            break;
          default:
            status = 'open';
        }

        tasks.push({
          index: taskIndex,
          text,
          status,
          lineNumber: i,
        });
        taskIndex++;
      }
    }

    return tasks;
  }

  /**
   * Update a task's status in the PLAN.md file.
   */
  updateTaskStatus(
    planPath: string,
    taskIndex: number,
    status: PlanTask['status'],
  ): void {
    const content = readFileSync(planPath, 'utf-8');
    const lines = content.split('\n');
    const tasks = this.parsePlan(content);

    const task = tasks.find((t) => t.index === taskIndex);
    if (!task) {
      throw new Error(`Task index ${taskIndex} not found in ${planPath}`);
    }

    const marker = statusToMarker(status);
    const line = lines[task.lineNumber];
    if (line === undefined) {
      throw new Error(`Line ${task.lineNumber} not found in ${planPath}`);
    }

    lines[task.lineNumber] = line.replace(
      /\[([x !~])\]/i,
      `[${marker}]`,
    );

    writeFileSync(planPath, lines.join('\n'), 'utf-8');
  }

  /**
   * Run one iteration of the RALPH loop: execute a single task.
   */
  async runIteration(
    task: PlanTask,
    config: RalphConfig,
    progress: string,
  ): Promise<{ success: boolean; output: string; durationMs: number }> {
    const runner = new ClaudeCliRunner();

    const workPrompt = buildWorkPrompt(task, progress, config);

    const options: ClaudeOptions = {
      prompt: workPrompt,
      systemPrompt: config.systemPrompt,
      maxTurns: config.maxTurnsPerTask ?? DEFAULT_MAX_TURNS_PER_TASK,
      model: config.model,
      workingDirectory: config.workingDirectory,
      mcpConfigPath: config.mcpConfigPath,
      allowedTools: config.allowedTools,
    };

    const result = await runner.run(options);
    let verifyOutput = '';
    let success = true;

    // Run verification command if configured
    if (config.verifyCommand) {
      try {
        const stdout = execSync(config.verifyCommand, {
          cwd: config.workingDirectory ?? process.cwd(),
          timeout: 300_000, // 5 minute timeout for verification
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        verifyOutput = stdout;
        success = true;
      } catch (err: unknown) {
        success = false;
        if (err && typeof err === 'object' && 'stdout' in err) {
          verifyOutput =
            String((err as { stdout?: unknown }).stdout ?? '') +
            '\n' +
            String((err as { stderr?: unknown }).stderr ?? '');
        } else {
          verifyOutput = err instanceof Error ? err.message : String(err);
        }
      }
    }

    const output = config.verifyCommand
      ? `Claude output:\n${result.text}\n\nVerification (${config.verifyCommand}):\n${verifyOutput}`
      : result.text;

    return { success, output, durationMs: result.durationMs };
  }

  /**
   * Run the full RALPH loop.
   */
  async run(
    config: RalphConfig,
    onProgress?: (event: RalphProgressEvent) => void,
  ): Promise<RalphResult> {
    const startTime = Date.now();
    const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    const maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const progressPath = resolveProgressPath(config);

    this.aborted = false;
    this.retryCounts.clear();

    let iteration = 0;

    onProgress?.({
      type: 'loop_start',
      iteration: 0,
      message: `Starting RALPH loop with plan: ${config.planPath}`,
    });

    while (iteration < maxIterations && !this.aborted) {
      iteration++;

      // 1. Parse PLAN.md
      if (!existsSync(config.planPath)) {
        throw new Error(`Plan file not found: ${config.planPath}`);
      }
      const planContent = readFileSync(config.planPath, 'utf-8');
      const tasks = this.parsePlan(planContent);

      // 2. Find next open task
      const nextTask = tasks.find((t) => t.status === 'open');
      if (!nextTask) {
        // Check if everything is done or all remaining are blocked
        const remaining = tasks.filter(
          (t) => t.status !== 'done' && t.status !== 'blocked',
        );
        if (remaining.length === 0) {
          onProgress?.({
            type: 'loop_done',
            iteration,
            message: 'All tasks completed or blocked',
          });
          break;
        }
        // Reset any in_progress tasks back to open for retry
        for (const t of remaining) {
          if (t.status === 'in_progress') {
            this.updateTaskStatus(config.planPath, t.index, 'open');
          }
        }
        // Re-parse and check again
        const updated = this.parsePlan(
          readFileSync(config.planPath, 'utf-8'),
        );
        const nextOpen = updated.find((t) => t.status === 'open');
        if (!nextOpen) {
          onProgress?.({
            type: 'loop_done',
            iteration,
            message: 'No more open tasks',
          });
          break;
        }
        // Continue with the reopened task on next loop iteration
        continue;
      }

      // 3. Mark task as in_progress
      this.updateTaskStatus(config.planPath, nextTask.index, 'in_progress');
      nextTask.status = 'in_progress';

      onProgress?.({
        type: 'task_start',
        iteration,
        task: nextTask,
        message: `Starting task ${nextTask.index + 1}: ${nextTask.text}`,
      });

      // 4. Read progress.md
      let progress = '';
      if (existsSync(progressPath)) {
        progress = readFileSync(progressPath, 'utf-8');
      }

      // 5. Run iteration
      try {
        onProgress?.({
          type: 'task_working',
          iteration,
          task: nextTask,
          message: `Working on: ${nextTask.text}`,
        });

        const iterResult = await this.runIteration(nextTask, config, progress);

        if (this.aborted) {
          // Revert to open if aborted mid-task
          this.updateTaskStatus(config.planPath, nextTask.index, 'open');
          break;
        }

        if (iterResult.success) {
          // 6. Task passed -- mark done
          this.updateTaskStatus(config.planPath, nextTask.index, 'done');

          onProgress?.({
            type: 'task_done',
            iteration,
            task: { ...nextTask, status: 'done' },
            message: `Completed task ${nextTask.index + 1}: ${nextTask.text}`,
            output: iterResult.output,
            durationMs: iterResult.durationMs,
          });

          // 7. Append learnings to progress.md
          appendProgress(progressPath, nextTask, iteration, iterResult);

          // 8. Git commit if task passes AND autoCommit enabled
          const shouldCommit = config.autoCommit ?? (config.domain === 'coding');
          if (shouldCommit) {
            gitCommit(
              `Complete: ${nextTask.text}`,
              config.workingDirectory,
            );
          }

          // 9. Notify status update
          config.onStatusUpdate?.(`Task ${nextTask.index + 1}/${tasks.length} done: ${nextTask.text}`);
        } else {
          // Task failed
          const retries = this.retryCounts.get(nextTask.index) ?? 0;
          const newRetries = retries + 1;
          this.retryCounts.set(nextTask.index, newRetries);

          if (newRetries >= maxRetries) {
            // Max retries reached -- mark blocked
            this.updateTaskStatus(
              config.planPath,
              nextTask.index,
              'blocked',
            );

            onProgress?.({
              type: 'task_blocked',
              iteration,
              task: { ...nextTask, status: 'blocked' },
              message: `Blocked task ${nextTask.index + 1} after ${newRetries} retries: ${nextTask.text}`,
              output: iterResult.output,
              durationMs: iterResult.durationMs,
            });

            // Append failure info to progress
            appendProgress(progressPath, nextTask, iteration, {
              ...iterResult,
              success: false,
            });
          } else {
            // Retry -- set back to open
            this.updateTaskStatus(config.planPath, nextTask.index, 'open');

            onProgress?.({
              type: 'task_retry',
              iteration,
              task: { ...nextTask, status: 'open' },
              message: `Retrying task ${nextTask.index + 1} (attempt ${newRetries + 1}/${maxRetries}): ${nextTask.text}`,
              output: iterResult.output,
              durationMs: iterResult.durationMs,
            });

            // Append retry info to progress
            appendProgress(progressPath, nextTask, iteration, {
              ...iterResult,
              success: false,
            });
          }
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);

        // Revert task to open on unexpected error
        this.updateTaskStatus(config.planPath, nextTask.index, 'open');

        onProgress?.({
          type: 'task_error',
          iteration,
          task: nextTask,
          message: `Error on task ${nextTask.index + 1}: ${errMsg}`,
        });

        const retries = this.retryCounts.get(nextTask.index) ?? 0;
        this.retryCounts.set(nextTask.index, retries + 1);

        if (retries + 1 >= maxRetries) {
          this.updateTaskStatus(
            config.planPath,
            nextTask.index,
            'blocked',
          );
        }
      }
    }

    // Final stats
    const finalPlan = existsSync(config.planPath)
      ? readFileSync(config.planPath, 'utf-8')
      : '';
    const finalTasks = this.parsePlan(finalPlan);
    const completed = finalTasks.filter((t) => t.status === 'done').length;
    const blocked = finalTasks.filter((t) => t.status === 'blocked').length;
    const remaining = finalTasks.filter(
      (t) => t.status === 'open' || t.status === 'in_progress',
    ).length;

    const result: RalphResult = {
      totalIterations: iteration,
      tasksCompleted: completed,
      tasksBlocked: blocked,
      tasksRemaining: remaining,
      durationMs: Date.now() - startTime,
      aborted: this.aborted,
    };

    onProgress?.({
      type: 'loop_done',
      iteration,
      message: `RALPH loop finished: ${completed} done, ${blocked} blocked, ${remaining} remaining`,
      durationMs: result.durationMs,
    });

    config.onStatusUpdate?.(`Work complete: ${completed}/${finalTasks.length} tasks done, ${blocked} blocked`);

    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusToMarker(status: PlanTask['status']): string {
  switch (status) {
    case 'done':
      return 'x';
    case 'blocked':
      return '!';
    case 'in_progress':
      return '~';
    case 'open':
    default:
      return ' ';
  }
}

function resolveProgressPath(config: RalphConfig): string {
  if (config.progressPath) return config.progressPath;
  return join(dirname(config.planPath), 'progress.md');
}

export function buildWorkPrompt(
  task: PlanTask,
  progress: string,
  config: RalphConfig,
): string {
  const parts: string[] = [];

  parts.push(`## Current Task\n\n${task.text}`);

  if (progress.trim()) {
    parts.push(
      `## Accumulated Learnings\n\nHere are learnings from previous iterations:\n\n${progress}`,
    );
  }

  if (config.verifyCommand) {
    parts.push(
      `## Verification\n\nAfter completing the task, the following verification command will be run:\n\`\`\`\n${config.verifyCommand}\n\`\`\`\nMake sure your changes pass this verification.`,
    );
  }

  parts.push(`## Guidelines\n\n${getDomainGuidelines(config.domain)}`);

  return parts.join('\n\n');
}

function getDomainGuidelines(domain?: RalphConfig['domain']): string {
  switch (domain) {
    case 'coding':
      return (
        `- Focus exclusively on the current task.\n` +
        `- Write clean, production-quality code.\n` +
        `- Make sure all existing tests still pass.\n` +
        `- Do not modify code unrelated to this task.\n` +
        `- If you encounter a blocker that prevents completion, explain it clearly.`
      );
    case 'research':
      return (
        `- Focus on finding accurate, well-sourced information for this task.\n` +
        `- Cross-reference claims across multiple sources when possible.\n` +
        `- Distinguish between facts, expert opinions, and speculation.\n` +
        `- Save key findings to memory for future reference.\n` +
        `- If you cannot find reliable information, say so clearly.`
      );
    case 'ops':
      return (
        `- Diagnose the issue systematically — check logs, metrics, and recent changes.\n` +
        `- Attempt automated remediation within your permission bounds.\n` +
        `- Document what you found and what you did.\n` +
        `- If the issue requires human intervention, escalate with a clear recommendation.\n` +
        `- Prioritize: data loss > service down > degraded performance > cosmetic.`
      );
    case 'general':
    default:
      return (
        `- Focus exclusively on completing this task to a high standard.\n` +
        `- Verify your work is correct before marking the task as done.\n` +
        `- If you need information you don't have, search for it or check memory.\n` +
        `- If you encounter a blocker, explain it clearly with a recommendation.\n` +
        `- Come back with results, not questions.`
      );
  }
}

function appendProgress(
  progressPath: string,
  task: PlanTask,
  iteration: number,
  result: { success: boolean; output: string; durationMs: number },
): void {
  const timestamp = new Date().toISOString();
  const statusLabel = result.success ? 'Success' : 'Failed';
  const durationSec = (result.durationMs / 1000).toFixed(1);

  // Truncate output to prevent progress.md from growing unbounded
  const maxOutputLength = 2000;
  const truncatedOutput =
    result.output.length > maxOutputLength
      ? result.output.substring(0, maxOutputLength) + '\n...(truncated)'
      : result.output;

  const entry = [
    '',
    `## Iteration ${iteration} - Task: "${task.text}"`,
    `- **Status**: ${statusLabel}`,
    `- **Duration**: ${durationSec}s`,
    `- **Timestamp**: ${timestamp}`,
    '',
    '### Output',
    '```',
    truncatedOutput,
    '```',
    '',
  ].join('\n');

  appendFileSync(progressPath, entry, 'utf-8');
}

function gitCommit(message: string, cwd?: string): void {
  try {
    const opts = {
      cwd: cwd ?? process.cwd(),
      encoding: 'utf-8' as const,
      stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    };

    // Check if we're in a git repo
    execSync('git rev-parse --is-inside-work-tree', opts);

    // Stage all changes
    execSync('git add -A', opts);

    // Check if there are staged changes
    try {
      execSync('git diff --cached --quiet', opts);
      // If the above succeeds, there are no staged changes -- nothing to commit
      return;
    } catch {
      // There are staged changes -- proceed with commit
    }

    execSync(`git commit -m ${JSON.stringify(message)}`, opts);
  } catch {
    // Git commit is best-effort -- don't fail the loop
  }
}
