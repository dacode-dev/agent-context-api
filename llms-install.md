# Install Agent Context API in Cline

This repository contains a local MCP server that preflights LLM context without uploading repository text.

```bash
git clone https://github.com/dacode-dev/agent-context-api.git
cd agent-context-api
npm ci
npm run start:mcp
```

Then point the MCP client at the absolute path to `mcp-server.js`:

```json
{
  "mcpServers": {
    "agent-context-api": {
      "command": "node",
      "args": ["/absolute/path/to/agent-context-api/mcp-server.js"]
    }
  }
}
```

The free local MCP tool accepts up to 12,000 characters. It counts tokens, checks an optional model budget, and redacts likely credentials locally. Larger context can use the x402 HTTP endpoint documented in `README.md` at `$0.005` per request.
