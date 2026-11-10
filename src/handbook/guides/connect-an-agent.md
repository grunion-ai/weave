# Connect an agent

An agent connects to a workspace through MCP. On a hosted weave the address is `https://<host>/w/<workspace>/mcp`. Open `https://<host>/w/<workspace>/docs` in a browser to read that address and copy it, and use the address of your own workspace rather than the public documentation workspace.

Pick the section for your client below. Each one ends at the same two steps: the browser sign-in on the first call, and a read-only first request.

## Claude Code plugin on weave cloud

In Claude Code:

```
/plugin install weave --marketplace grunion-ai/weave
```

The plugin ships weave cloud's MCP server address, `https://weave.grunion.ai/mcp`, so there is nothing to paste. Each workspace on an instance also has its own endpoint, so to point Claude Code at one workspace use the command in the next section instead.

## Claude Code with a workspace address

```
claude mcp add --scope user --transport http weave https://<host>/w/<workspace>/mcp
```

Then run `/mcp` in Claude Code and sign in.

## Claude.ai connector

Open Settings, then Connectors, and add a custom connector with the MCP address.

## ChatGPT connector

Add a custom connector with the MCP address.

## Codex and other MCP clients

```
codex mcp add weave --url https://<host>/w/<workspace>/mcp
codex mcp login weave
```

Any other client that supports a remote MCP server with OAuth takes the same address.

## A self-hosted file over stdio

```
claude mcp add weave -- node /path/to/weave/bin/weave.js mcp --data /path/to/workspace.db
```

`weave mcp --data <file.db>` serves MCP over stdio on its own. Hosted HTTP and local stdio are set up differently, so use the instructions that match the server you run.

## Sign-in and access

The first call opens a browser sign-in, so there is no token to paste. Access follows your role: an observer reads and comments, an editor also changes records, and an architect also changes the schema and accounts. Connecting an agent does not grant a higher role.

## The first request

Ask: “Read the workspace outline. Tell me its spaces and tables, and suggest one small improvement. Do not change anything.”

Confirm the agent describes the workspace you meant. When you are ready to build, ask it to run `weave_build` with `dryRun: true` before it applies a schema. The **Agent access (MCP)** guide in [[table:Handbook/Guide|Guides]] describes `weave_ontology`, `weave_build` and the remaining tools.

## A refused connection

Check the workspace address, finish the browser sign-in, and confirm your account can open that workspace. A connection that succeeds with too few permissions needs a role change by a workspace architect.
