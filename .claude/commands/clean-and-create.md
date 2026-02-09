Clean the existing Clade state and start a fresh server for admin UI testing.

Steps:
1. Kill any existing Clade server running on port 7890 (`lsof -ti :7890 | xargs kill -9`)
2. Remove `~/.clade` entirely (`rm -rf ~/.clade`)
3. Build the project (`npm run build`)
4. Start the server in background (`nohup node dist/bin/clade.js start > /tmp/clade-server.log 2>&1 &`)
5. Wait 3 seconds for the server to be ready
6. Verify the server is responding by hitting `http://localhost:7890/api/agents`
7. Open `http://localhost:7890/admin` in the browser using Playwright MCP so I can see the fresh admin UI
