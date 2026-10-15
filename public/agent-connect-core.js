(function (root) {
  const TOOLS = [
    {
      id: 'claude',
      name: 'Claude',
      where: 'claude.ai or the Claude app',
      kind: 'chat',
      icon: 'lucide:sparkles',
      copy: 'url',
      steps: [
        'Open claude.ai and go to Customize, then Connectors.',
        'Click Add, then Add custom connector.',
        'Name it weave, paste the address below, and click Continue.',
        'If Claude asks how to register, pick Register automatically, then click Add.',
        'Click Connect and sign in to your weave account.',
        'In a new chat, click the + button, open Connectors and turn weave on.',
      ],
      note: 'On Team and Enterprise plans, an owner does steps 1 to 4 first, and you start at step 5. The Free plan allows one custom connector.',
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      where: 'chatgpt.com',
      kind: 'chat',
      icon: 'lucide:message-circle',
      copy: 'url',
      steps: [
        'Open chatgpt.com and go to Plugins. Older menus call it Settings, then Apps.',
        'Click the + button and pick Add custom MCP server.',
        'Name it weave and paste the address below as the server URL.',
        'Choose OAuth for authentication, accept the custom server warning, and create it.',
        'Sign in to your weave account.',
        'In a chat, type @weave to use it.',
      ],
      note: 'Needs a Business, Enterprise or Edu workspace. An admin may need to allow custom servers.',
    },
    {
      id: 'gemini',
      name: 'Gemini',
      where: 'gemini.google.com',
      kind: 'chat',
      icon: 'lucide:star',
      copy: 'url',
      steps: [
        'Open gemini.google.com and go to Settings, then Connected apps.',
        'Under Custom apps, click Add a custom app.',
        'Paste the address below and click Next.',
        'Sign in to your weave account.',
      ],
      note: 'Before you start: custom apps need a personal Google account in the US, set to English, with Keep Activity turned on.',
    },
    {
      id: 'perplexity',
      name: 'Perplexity',
      where: 'perplexity.ai',
      kind: 'chat',
      icon: 'lucide:search',
      copy: 'url',
      steps: [
        'Open perplexity.ai and go to Connectors.',
        'Click Add custom and pick Connector. Then click Add MCP connector and choose Remote.',
        'Name it weave, paste the address below, and pick OAuth 2.0.',
        'Click Add and sign in to your weave account.',
      ],
      note: 'In an organization, an admin must first turn on the setting named Allow members to add custom connectors.',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      where: 'the Cursor editor',
      kind: 'editor',
      icon: 'lucide:code-xml',
      copy: 'cursor',
      install: 'cursor',
      steps: [
        'Click Add to Cursor below, or paste the setting into ~/.cursor/mcp.json.',
        'Cursor opens a browser window. Sign in to your weave account.',
        'Ask Cursor to use weave.',
      ],
    },
    {
      id: 'vscode',
      name: 'VS Code',
      where: 'GitHub Copilot in VS Code',
      kind: 'editor',
      icon: 'lucide:code',
      copy: 'vscode',
      install: 'vscode',
      steps: [
        'Click Add to VS Code below, or run MCP: Add Server from the command palette and paste the address.',
        'Sign in to your weave account when VS Code asks.',
        'In Copilot Chat, switch to Agent mode and ask it to use weave.',
      ],
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      where: 'a terminal',
      kind: 'terminal',
      icon: 'lucide:terminal',
      copy: 'command',
      steps: [
        'Paste the command below into a terminal.',
        'Start Claude Code, type /mcp, pick weave and sign in.',
      ],
    },
    {
      id: 'other',
      name: 'Something else',
      where: 'any AI app that accepts custom connectors',
      kind: 'other',
      icon: 'lucide:link',
      copy: 'url',
      steps: [
        'Find the place where your AI app adds a custom connector or MCP server.',
        'Paste the address below. weave asks you to sign in, so you do not need a key.',
      ],
    },
  ];

  const TOOL_IDS = new Set(TOOLS.map((t) => t.id));
  const b64 = (text) => (typeof btoa === 'function' ? btoa(text) : Buffer.from(text).toString('base64'));

  function snippet(tool, url, name = 'weave') {
    if (tool.copy === 'command') return `claude mcp add --transport http --scope user ${name} ${url}`;
    if (tool.copy === 'cursor') return JSON.stringify({ mcpServers: { [name]: { url } } }, null, 2);
    if (tool.copy === 'vscode') return JSON.stringify({ servers: { [name]: { type: 'http', url } } }, null, 2);
    return url;
  }

  function installLink(tool, url, name = 'weave') {
    if (tool.install === 'cursor') return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(b64(JSON.stringify({ url })))}`;
    if (tool.install === 'vscode') return `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: 'http', url }))}`;
    return null;
  }

  function firstMessage({ workspace, template = null, other = '' } = {}) {
    const what = String(other).trim().replace(/[.!?\s]+$/, '');
    if (what) return `Use weave to set up my ${workspace} workspace for this: ${what}. Propose the tables and fields first, and build them once I agree.`;
    if (template) return `Use weave to open my ${workspace} workspace and walk me through the ${template} tables weave set up. Then help me add my first real row.`;
    return `Use weave to open my ${workspace} workspace. Ask me what I want to track, propose tables for it, and build them once I agree.`;
  }

  function guide(toolId, { url, workspace, template = null, other = '' }) {
    const tool = TOOLS.find((t) => t.id === toolId);
    if (!tool) return null;
    return { ...tool, value: snippet(tool, url), install: installLink(tool, url), message: firstMessage({ workspace, template, other }) };
  }

  root.WeaveAgentConnect = { TOOLS, TOOL_IDS, snippet, installLink, firstMessage, guide };
})(globalThis);
