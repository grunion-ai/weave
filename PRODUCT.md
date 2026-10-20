# Weave

## Platform

web

## Users

People and agents use Weave to organize related records in workspaces. The public status page helps production users check service availability and follow incident updates.

## Product purpose

Weave provides connected tables, documents, workflows, and an MCP interface over the same workspace data.

## Capabilities and constraints

The application uses vanilla JavaScript, Node.js and SQLite, with zero runtime dependencies and no build step. Production runs at https://weave.grunion.ai. Production promotion follows successful CI and dev soak checks.

The status page covers production web, API, and MCP availability. Monitoring runs independently of the production application and records observed history. Missing measurements are unknown. Operators publish incident updates; visitors do not submit reports through the status page.

## Brand commitments

Preserve the weave name, rope mark, and light and dark surface palettes in brand/README.md. Kyle requested a status page like Anthropic's: service availability, uptime history, and incident reporting.

## Evidence

AGENTS.md documents product behavior. DEVELOPMENT.md documents deployment. brand/README.md defines visual assets. Historical uptime before monitoring began is unavailable and must not be fabricated.
