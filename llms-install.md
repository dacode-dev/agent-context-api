# Install Agent Context API in Cline

This repository contains a local MCP server that preflights LLM context without uploading repository text.

```json
{
  "mcpServers": {
    "agent-context-api": {
      "command": "npx",
      "args": ["-y", "github:dacode-dev/agent-context-api"]
    }
  }
}
```

The free local MCP tool accepts up to 12,000 characters. It counts tokens, checks an optional model budget, and redacts likely credentials locally. Larger context can use the x402 HTTP endpoint documented in `README.md` at `$0.005` per request.
