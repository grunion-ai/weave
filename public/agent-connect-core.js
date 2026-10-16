(function (root) {
  const SETUP_PROMPT = [
    "Connect yourself to my weave workspace.",
    "",
    "Its MCP address is {URL}",
    "",
    "weave is a remote MCP server (Streamable HTTP). It signs people in with OAuth, so there is no API key and you must never ask me for a token or password. Do not run the server locally and do not install anything.",
    "",
    "1. Work out which app you are running in.",
    "2. If you can change your own MCP settings, add one server named \"weave\" with the address above. Use your app's own add-server command when it has one, otherwise edit its MCP config file. Use that app's real config format and the key it uses for a Streamable HTTP URL. Do not guess a format from memory if you can check it. After you finish, read the setting back to confirm it is saved.",
    "3. If you cannot change your own settings (a chat app in a browser or on a phone), do not pretend. Tell me the exact clicks to add a custom connector or MCP server in your app today, as a short numbered list with the address in it. Say plainly if my plan or my organization's admin must allow it first.",
    "4. Finish by telling me the one thing left for me to do, which is signing in to weave when the app asks, and how to check that it worked."
  ].join('\n');

  const TOOLS = [
    {
      id: 'claude',
      hue: '#d97757',
      name: 'Claude',
      where: 'claude.ai or the Claude app',
      pitch: 'About seven clicks: Settings, Connectors, Add custom connector, paste the weave address, sign in. Works on every plan. On Team and Enterprise an owner adds it first.',
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
      id: 'claude-code',
      hue: '#c4683f',
      name: 'Claude Code',
      where: 'a terminal',
      pitch: 'Paste the setup prompt, run /mcp, choose Authenticate.',
      kind: 'terminal',
      icon: 'lucide:terminal',
      copy: 'prompt',
      steps: [
        'Start Claude Code and paste the setup prompt below.',
        'Run /mcp, pick weave and choose Authenticate.',
        'Sign in to your weave account.',
      ],
    },
    {
      id: 'cursor',
      hue: '#5b6b82',
      name: 'Cursor',
      where: 'the Cursor editor',
      pitch: 'Paste the setup prompt, reload, sign in.',
      kind: 'editor',
      icon: 'lucide:code-xml',
      copy: 'prompt',
      install: 'cursor',
      steps: [
        'Click Add to Cursor below, or paste the setup prompt below into Cursor\'s agent.',
        'Reload Cursor when it asks.',
        'Sign in to your weave account.',
      ],
    },
    {
      id: 'vscode',
      hue: '#2f80ed',
      name: 'VS Code',
      where: 'GitHub Copilot in VS Code',
      pitch: 'Trust the server after pasting the setup prompt, then sign in.',
      kind: 'editor',
      icon: 'lucide:code',
      copy: 'prompt',
      install: 'vscode',
      steps: [
        'Click Add to VS Code below, or paste the setup prompt below into Copilot Chat in Agent mode.',
        'Trust the weave server when VS Code asks.',
        'Sign in to your weave account.',
      ],
    },
    {
      id: 'gemini-cli',
      hue: '#4c7dea',
      name: 'Gemini CLI',
      where: 'a terminal',
      pitch: 'Run /mcp auth weave after pasting the setup prompt.',
      kind: 'terminal',
      icon: 'lucide:star',
      copy: 'prompt',
      steps: [
        'Start Gemini CLI and paste the setup prompt below.',
        'Run /mcp auth weave.',
        'Sign in to your weave account.',
      ],
    },
    {
      id: 'other',
      hue: '#6b7280',
      name: 'Something else',
      where: 'any agent that edits its settings',
      pitch: 'Paste the setup prompt into any agent that edits settings or lists the clicks.',
      kind: 'other',
      icon: 'lucide:link',
      copy: 'prompt',
      steps: [
        'Paste the setup prompt below into your agent.',
        'Follow what it tells you, then sign in to your weave account.',
      ],
    },
  ];

  const TOOL_IDS = new Set(TOOLS.map((t) => t.id));
  const b64 = (text) => (typeof btoa === 'function' ? btoa(text) : Buffer.from(text).toString('base64'));

  const setupPrompt = (url) => SETUP_PROMPT.replace('{URL}', url);

  function snippet(tool, url, name = 'weave') {
    if (tool.copy === 'prompt') return setupPrompt(url);
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

  root.WeaveAgentConnect = { TOOLS, TOOL_IDS, SETUP_PROMPT, setupPrompt, snippet, installLink, firstMessage, guide };
})(globalThis);
