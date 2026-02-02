import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/teamagents': 'bin/teamagents.ts',
    'mcp/memory-server': 'src/mcp/memory/server.ts',
    'mcp/sessions-server': 'src/mcp/sessions/server.ts',
    'mcp/messaging-server': 'src/mcp/messaging/server.ts',
    'mcp/skills-server': 'src/mcp/skills/server.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  splitting: false,
  sourcemap: true,
  clean: true,
  dts: false,
  shims: true,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
