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
      id: 'chatgpt',
      hue: '#10a37f',
      name: 'ChatGPT',
      where: 'chatgpt.com on the web',
      pitch: 'Plugins, Add custom MCP server, paste the weave address, sign in. Needs a Business, Enterprise or Edu workspace, where an admin adds it. Pro can only read.',
      kind: 'chat',
      icon: 'lucide:message-circle',
      copy: 'url',
      steps: [
        'Open chatgpt.com on a computer and go to Plugins.',
        'Click the + button, then Add custom MCP server.',
        'Name it weave and paste the address below under Connection.',
        'Set authentication to OAuth, tick I understand and want to continue, and click Create as a plugin.',
        'Sign in to your weave account when ChatGPT asks.',
        'In a new chat, type @ and pick weave.',
      ],
      note: 'Reading and writing needs a Business, Enterprise or Edu workspace, where an admin or owner adds weave. Pro accounts can connect it to read only. Plus and Free cannot add custom MCP servers. Web only, not the mobile app.',
    },
    {
      id: 'gemini',
      hue: '#7b6be6',
      name: 'Gemini',
      where: 'gemini.google.com',
      pitch: 'Settings, Connected Apps, Add a custom app, paste the weave address, sign in. Personal Google accounts in the US only.',
      kind: 'chat',
      icon: 'lucide:message-square',
      copy: 'url',
      steps: [
        'Open gemini.google.com on a computer and click Settings, then Connected Apps.',
        'Under Custom apps, click Add a custom app.',
        'Paste the address below and click Next.',
        'Follow the prompts and sign in to your weave account.',
        'In a chat, type @ and pick weave.',
      ],
      note: 'Needs a personal Google account, age 18 or over, in the US, in English, with Keep Activity on. Work and school accounts cannot add it yet. Add it on the web, and it then works in the mobile app too.',
    },
    {
      id: 'claude-code',
      hue: '#c4683f',
      name: 'Claude Code',
      where: 'a terminal',
      pitch: 'Paste the setup prompt, run /mcp, choose Authenticate.',
      kind: 'harness',
      icon: 'lucide:terminal',
      copy: 'prompt',
      steps: [
        'Start Claude Code and paste the setup prompt below.',
        'Run /mcp, pick weave and choose Authenticate.',
        'Sign in to your weave account.',
      ],
    },
    {
      id: 'codex',
      hue: '#5b6b82',
      name: 'Codex',
      where: 'the Codex CLI, app or IDE extension',
      pitch: 'Run one command, then codex mcp login weave and sign in.',
      kind: 'harness',
      icon: 'lucide:code-xml',
      copy: 'codex',
      steps: [
        'Run the command below in a terminal.',
        'Run codex mcp login weave and sign in to your weave account.',
        'Start Codex and run /mcp to check weave is listed.',
      ],
      note: 'The Codex app and IDE extension read the same settings. There, click Authenticate next to weave in place of step 2.',
    },
    {
      id: 'antigravity',
      hue: '#2f80ed',
      name: 'Antigravity',
      where: 'the Antigravity app, IDE or CLI',
      pitch: 'Paste the setup prompt, click Authenticate in Settings, paste the sign-in code back.',
      kind: 'harness',
      icon: 'lucide:rocket',
      copy: 'prompt',
      steps: [
        'Paste the setup prompt below into the Antigravity agent.',
        'Open Settings with Cmd + , (Ctrl + , on Windows and Linux), go to Customizations and click Authenticate next to weave.',
        'Sign in to your weave account, copy the code it shows, paste it back and click Submit.',
      ],
      note: 'The app, IDE and CLI share ~/.gemini/config/mcp_config.json. weave goes there with serverUrl set to the address.',
    },
    {
      id: 'gemini-cli',
      hue: '#4c7dea',
      name: 'Gemini CLI',
      where: 'a terminal',
      pitch: 'Run /mcp auth weave after pasting the setup prompt.',
      kind: 'harness',
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

  const setupPrompt = (url) => SETUP_PROMPT.replace('{URL}', url);

  function snippet(tool, url, name = 'weave') {
    if (tool.copy === 'prompt') return setupPrompt(url);
    if (tool.copy === 'command') return `claude mcp add --transport http --scope user ${name} ${url}`;
    if (tool.copy === 'codex') return `codex mcp add ${name} --url ${url}`;
    return url;
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
    return { ...tool, value: snippet(tool, url), message: firstMessage({ workspace, template, other }) };
  }

  root.WeaveAgentConnect = { TOOLS, TOOL_IDS, SETUP_PROMPT, setupPrompt, snippet, firstMessage, guide };
})(globalThis);
