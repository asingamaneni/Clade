import { defineConfig } from 'vitepress';

// DOCS_BASE env var overrides the base path (e.g. /Clade/ for GitHub Pages)
const base = (process.env['DOCS_BASE'] as `/${string}/` | undefined) ?? '/';

export default defineConfig({
  title: 'Clade',
  description: 'Your personal team of AI agents, powered by Claude Code',
  base,

  head: [
    ['meta', { name: 'theme-color', content: '#7c3aed' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Concepts', link: '/concepts/architecture' },
      { text: 'CLI', link: '/cli/' },
      { text: 'Config', link: '/reference/config' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'How It Works', link: '/guide/how-it-works' },
          ],
        },
        {
          text: 'Core Features',
          items: [
            { text: 'Agents', link: '/guide/agents' },
            { text: 'Channels', link: '/guide/channels' },
            { text: 'RALPH — Autonomous Work', link: '/guide/ralph' },
            { text: 'Collaboration', link: '/guide/collaboration' },
            { text: 'Portability', link: '/guide/portability' },
          ],
        },
      ],
      '/concepts/': [
        {
          text: 'Architecture',
          items: [
            { text: 'System Overview', link: '/concepts/architecture' },
            { text: 'SOUL.md & Self-Improvement', link: '/concepts/soul' },
            { text: 'Memory System', link: '/concepts/memory' },
            { text: 'MCP Servers', link: '/concepts/mcp' },
            { text: 'Platform Integration', link: '/concepts/platform' },
            { text: 'Security Model', link: '/concepts/security' },
          ],
        },
      ],
      '/cli/': [
        {
          text: 'CLI Reference',
          items: [
            { text: 'Overview', link: '/cli/' },
            { text: 'clade setup', link: '/cli/setup' },
            { text: 'clade start', link: '/cli/start' },
            { text: 'clade agent', link: '/cli/agent' },
            { text: 'clade ask', link: '/cli/ask' },
            { text: 'clade work', link: '/cli/work' },
            { text: 'clade mcp', link: '/cli/mcp' },
            { text: 'clade ui', link: '/cli/ui' },
            { text: 'clade docs', link: '/cli/docs' },
            { text: 'clade doctor', link: '/cli/doctor' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Configuration', link: '/reference/config' },
            { text: 'API Endpoints', link: '/reference/api' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/asingamaneni/Clade' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
    },
  },
});
