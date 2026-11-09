# Connect an agent

An agent connects to a workspace through MCP. On a hosted weave, the address is `https://<host>/w/<workspace>/mcp`. Use the address of your own workspace, not the public documentation workspace.

## Open the native connection guide

Open your workspace's MCP address in a browser. The setup page supplies the address and connection instructions. The embedded guide above explains the routes for browser clients, Claude Code, and Codex; the native page supplies your workspace's actual address.

The client opens a weave sign-in when authorization is needed. Access follows your role: an observer reads and comments, an editor also changes records, and an architect also changes the schema and accounts. Connecting an agent does not grant a higher role.

## Make the first request read-only

Ask: “Read the workspace outline. Tell me its spaces and tables, and suggest one small improvement. Do not change anything.”

Confirm the agent describes the intended workspace. When you are ready to build, ask for a dry run before it applies a schema. The **Agent access (MCP)** guide in [[table:Handbook/Guide|Guides]] describes `weave_ontology`, `weave_build`, and the remaining tools.

## If setup fails

Check the workspace address, finish the browser sign-in, and confirm your account can open that workspace. A successful connection with too few permissions needs a role change by a workspace architect, not a different prompt.

For a local file, `weave mcp --data <file.db>` serves MCP over stdio. Hosted HTTP and local stdio setup are different; use the matching instructions in **Agent access (MCP)**.
