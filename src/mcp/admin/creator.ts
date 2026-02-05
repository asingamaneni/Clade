// ---------------------------------------------------------------------------
// Skill Creator - Generate skills from scratch
// ---------------------------------------------------------------------------

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AgentSkill, SkillCreateRequest, SkillSource } from './types.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CLAUDE_HOME = join(homedir(), '.claude');
const SKILLS_DIR = join(CLAUDE_HOME, 'skills');

// Ensure directories exist
mkdirSync(SKILLS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Skill Name Validation
// ---------------------------------------------------------------------------

/**
 * Validate skill name against AgentSkills.io spec
 */
export function validateSkillName(name: string): { valid: boolean; error?: string } {
  if (!name || name.length === 0) {
    return { valid: false, error: 'Name is required' };
  }
  if (name.length > 64) {
    return { valid: false, error: 'Name must be 64 characters or less' };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(name)) {
    return { valid: false, error: 'Name must be lowercase alphanumeric with hyphens, not starting/ending with hyphen' };
  }
  if (name.includes('--')) {
    return { valid: false, error: 'Name cannot contain consecutive hyphens' };
  }
  return { valid: true };
}

/**
 * Generate a valid skill name from a string
 */
export function toValidSkillName(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'skill';
}

// ---------------------------------------------------------------------------
// SKILL.md Generation
// ---------------------------------------------------------------------------

/**
 * Generate SKILL.md content from a request
 */
export function generateSkillMd(request: SkillCreateRequest): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`name: ${request.name}`);
  lines.push(`description: ${request.description}`);

  if (request.license) {
    lines.push(`license: ${request.license}`);
  }

  if (request.allowedTools) {
    lines.push(`allowed-tools: ${request.allowedTools}`);
  }

  if (request.metadata && Object.keys(request.metadata).length > 0) {
    lines.push('metadata:');
    for (const [key, value] of Object.entries(request.metadata)) {
      lines.push(`  ${key}: "${value}"`);
    }
  }

  lines.push('---');
  lines.push('');

  // Instructions
  lines.push(request.instructions);

  // References section if scripts or references provided
  if (request.scripts?.length || request.references?.length) {
    lines.push('');
    lines.push('## Resources');
    lines.push('');

    if (request.scripts?.length) {
      for (const script of request.scripts) {
        lines.push(`- Script: [${script.filename}](scripts/${script.filename})`);
      }
    }

    if (request.references?.length) {
      for (const ref of request.references) {
        lines.push(`- Reference: [${ref.filename}](references/${ref.filename})`);
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Skill Creation
// ---------------------------------------------------------------------------

/**
 * Create a new skill from a request
 */
export function createSkill(
  request: SkillCreateRequest,
): { success: boolean; skill?: AgentSkill; error?: string } {
  // Validate name
  const nameValidation = validateSkillName(request.name);
  if (!nameValidation.valid) {
    return { success: false, error: nameValidation.error };
  }

  // Validate description
  if (!request.description || request.description.length === 0) {
    return { success: false, error: 'Description is required' };
  }
  if (request.description.length > 1024) {
    return { success: false, error: 'Description must be 1024 characters or less' };
  }

  // Validate instructions
  if (!request.instructions || request.instructions.length === 0) {
    return { success: false, error: 'Instructions are required' };
  }

  try {
    // Create skill directory
    const skillDir = join(SKILLS_DIR, request.name);
    if (existsSync(skillDir)) {
      return { success: false, error: `Skill "${request.name}" already exists` };
    }

    mkdirSync(skillDir, { recursive: true });

    // Generate and write SKILL.md
    const skillMdContent = generateSkillMd(request);
    writeFileSync(join(skillDir, 'SKILL.md'), skillMdContent);

    // Write scripts
    if (request.scripts?.length) {
      const scriptsDir = join(skillDir, 'scripts');
      mkdirSync(scriptsDir, { recursive: true });

      for (const script of request.scripts) {
        writeFileSync(join(scriptsDir, script.filename), script.content);
      }
    }

    // Write references
    if (request.references?.length) {
      const refsDir = join(skillDir, 'references');
      mkdirSync(refsDir, { recursive: true });

      for (const ref of request.references) {
        writeFileSync(join(refsDir, ref.filename), ref.content);
      }
    }

    // Create source metadata
    const source: SkillSource = {
      type: 'created',
      installedAt: new Date().toISOString(),
    };
    writeFileSync(join(skillDir, '.source.json'), JSON.stringify(source, null, 2));

    const skill: AgentSkill = {
      name: request.name,
      description: request.description,
      license: request.license,
      allowedTools: request.allowedTools,
      metadata: request.metadata,
      path: skillDir,
      source,
    };

    return { success: true, skill };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Skill Templates
// ---------------------------------------------------------------------------

export interface SkillTemplate {
  name: string;
  description: string;
  category: string;
  instructionsTemplate: string;
  suggestedTools?: string;
}

/**
 * Available skill templates for common use cases
 */
export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    name: 'code-review',
    description: 'Review code for best practices, bugs, and improvements',
    category: 'development',
    instructionsTemplate: `# Code Review

When reviewing code, analyze the following aspects:

## 1. Code Quality
- Check for clear, readable code
- Look for proper naming conventions
- Identify code duplication

## 2. Potential Issues
- Look for bugs and edge cases
- Check error handling
- Identify security concerns

## 3. Best Practices
- Verify adherence to language conventions
- Check for proper documentation
- Review test coverage

## 4. Suggestions
- Provide specific, actionable recommendations
- Include code examples where helpful
- Prioritize issues by severity

Always be constructive and explain the reasoning behind suggestions.`,
    suggestedTools: 'Read Grep Glob',
  },
  {
    name: 'api-documentation',
    description: 'Generate API documentation from code',
    category: 'documentation',
    instructionsTemplate: `# API Documentation Generator

Generate comprehensive API documentation following these guidelines:

## Format
- Use OpenAPI/Swagger style descriptions
- Include request/response examples
- Document all parameters and types

## Sections to Include
1. **Endpoint Overview**: HTTP method, path, description
2. **Parameters**: Path, query, header, body parameters
3. **Request Body**: Schema with examples
4. **Responses**: Status codes, schemas, examples
5. **Error Handling**: Common errors and their meanings
6. **Authentication**: Required auth methods

## Style
- Be concise but complete
- Use consistent terminology
- Include curl examples`,
    suggestedTools: 'Read Grep Glob',
  },
  {
    name: 'test-generator',
    description: 'Generate unit tests for code',
    category: 'development',
    instructionsTemplate: `# Test Generator

Generate comprehensive unit tests following these principles:

## Test Structure
- Use AAA pattern (Arrange, Act, Assert)
- One assertion per test when possible
- Descriptive test names

## Coverage Areas
1. **Happy Path**: Normal expected behavior
2. **Edge Cases**: Boundary conditions, empty inputs
3. **Error Cases**: Invalid inputs, exceptions
4. **Integration Points**: External dependencies

## Best Practices
- Mock external dependencies
- Use meaningful test data
- Keep tests independent
- Test behavior, not implementation

## Output Format
- Match the project's testing framework
- Follow existing test conventions
- Include setup and teardown if needed`,
    suggestedTools: 'Read Write Edit Bash(npm test)',
  },
  {
    name: 'data-analysis',
    description: 'Analyze data and generate insights',
    category: 'analytics',
    instructionsTemplate: `# Data Analysis

Perform data analysis following this methodology:

## 1. Data Understanding
- Identify data types and structure
- Check for missing values
- Understand relationships

## 2. Analysis Steps
- Summary statistics
- Distribution analysis
- Correlation analysis
- Trend identification

## 3. Visualization
- Create appropriate charts (describe in text/ASCII)
- Highlight key patterns
- Compare across dimensions

## 4. Insights
- State findings clearly
- Support with evidence
- Note limitations
- Suggest next steps

## Output Format
- Start with executive summary
- Include methodology
- Present findings with evidence
- End with recommendations`,
    suggestedTools: 'Read Bash(python)',
  },
  {
    name: 'deployment',
    description: 'Deploy applications to various platforms',
    category: 'devops',
    instructionsTemplate: `# Deployment Skill

Deploy applications safely following this checklist:

## Pre-Deployment
1. Verify all tests pass
2. Check environment variables
3. Review configuration
4. Backup current state

## Deployment Steps
1. Build the application
2. Run database migrations
3. Deploy to target environment
4. Verify health checks

## Post-Deployment
1. Monitor logs for errors
2. Verify functionality
3. Check performance metrics
4. Document changes

## Rollback Plan
- Keep previous version available
- Document rollback steps
- Test rollback procedure

Always confirm with the user before executing destructive operations.`,
    suggestedTools: 'Bash Read',
  },
];

/**
 * Create a skill from a template
 */
export function createFromTemplate(
  templateName: string,
  customName?: string,
  customDescription?: string,
): { success: boolean; skill?: AgentSkill; error?: string } {
  const template = SKILL_TEMPLATES.find((t) => t.name === templateName);

  if (!template) {
    return {
      success: false,
      error: `Template "${templateName}" not found. Available: ${SKILL_TEMPLATES.map((t) => t.name).join(', ')}`,
    };
  }

  return createSkill({
    name: customName ?? template.name,
    description: customDescription ?? template.description,
    instructions: template.instructionsTemplate,
    allowedTools: template.suggestedTools,
    metadata: {
      template: template.name,
      category: template.category,
    },
  });
}

// ---------------------------------------------------------------------------
// Skill Update
// ---------------------------------------------------------------------------

/**
 * Update an existing skill's instructions
 */
export function updateSkill(
  name: string,
  updates: Partial<SkillCreateRequest>,
): { success: boolean; error?: string } {
  const skillDir = join(SKILLS_DIR, name);

  if (!existsSync(skillDir)) {
    return { success: false, error: `Skill "${name}" not found` };
  }

  try {
    const skillMdPath = join(skillDir, 'SKILL.md');
    const currentContent = readFileSync(skillMdPath, 'utf-8');

    // Parse current frontmatter
    const frontmatterMatch = currentContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      return { success: false, error: 'Invalid SKILL.md format' };
    }

    const [, frontmatter, body] = frontmatterMatch;

    // Build updated request
    const request: SkillCreateRequest = {
      name,
      description: updates.description ?? extractFrontmatterValue(frontmatter, 'description') ?? '',
      instructions: updates.instructions ?? body.trim(),
      allowedTools: updates.allowedTools ?? extractFrontmatterValue(frontmatter, 'allowed-tools'),
      license: updates.license ?? extractFrontmatterValue(frontmatter, 'license'),
      metadata: updates.metadata,
    };

    // Regenerate SKILL.md
    const newContent = generateSkillMd(request);
    writeFileSync(skillMdPath, newContent);

    // Update scripts if provided
    if (updates.scripts?.length) {
      const scriptsDir = join(skillDir, 'scripts');
      mkdirSync(scriptsDir, { recursive: true });

      for (const script of updates.scripts) {
        writeFileSync(join(scriptsDir, script.filename), script.content);
      }
    }

    // Update references if provided
    if (updates.references?.length) {
      const refsDir = join(skillDir, 'references');
      mkdirSync(refsDir, { recursive: true });

      for (const ref of updates.references) {
        writeFileSync(join(refsDir, ref.filename), ref.content);
      }
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function extractFrontmatterValue(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : undefined;
}
