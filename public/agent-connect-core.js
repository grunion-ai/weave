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
      pitch: 'Any plan. On Team or Enterprise, an owner adds it.',
      kind: 'chat',
      icon: 'lucide:sparkles',
      logo: 'claude-color',
      copy: 'url',
      steps: [
        'On claude.ai, open Customize, then Connectors.',
        'Click Add, then Add custom connector.',
        'Name it weave, paste the address below, click Continue.',
        'If asked how to register, pick Register automatically, then Add.',
        'Click Connect and sign in to weave.',
        'In a chat, open + then Connectors and turn weave on.',
      ],
      note: 'On Team or Enterprise, an owner does steps 1 to 4. Free allows one custom connector.',
    },
    {
      id: 'chatgpt',
      hue: '#10a37f',
      name: 'ChatGPT',
      where: 'chatgpt.com on the web',
      pitch: 'Business, Enterprise or Edu. Pro can only read.',
      kind: 'chat',
      icon: 'lucide:message-circle',
      logo: 'openai',
      copy: 'url',
      steps: [
        'On chatgpt.com, open Plugins.',
        'Click +, then Add custom MCP server.',
        'Name it weave and paste the address below.',
        'Pick OAuth, tick the confirmation, click Create as a plugin.',
        'Sign in to weave.',
        'In a chat, type @ and pick weave.',
      ],
      note: 'An admin adds it on Business, Enterprise or Edu. Pro reads only; Plus and Free cannot. Web only.',
    },
    {
      id: 'gemini',
      hue: '#7b6be6',
      name: 'Gemini',
      where: 'gemini.google.com',
      pitch: 'Personal Google accounts in the US only.',
      kind: 'chat',
      icon: 'lucide:message-square',
      logo: 'gemini-color',
      copy: 'url',
      steps: [
        'On gemini.google.com, open Settings, then Connected Apps.',
        'Click Add a custom app.',
        'Paste the address below and click Next.',
        'Sign in to weave.',
        'In a chat, type @ and pick weave.',
      ],
      note: 'Personal Google accounts only: 18+, US, English, Keep Activity on. Work and school accounts cannot.',
    },
    {
      id: 'claude-code',
      hue: '#c4683f',
      name: 'Claude Code',
      where: 'Terminal',
      pitch: 'Paste the setup prompt, then run /mcp.',
      kind: 'harness',
      icon: 'lucide:terminal',
      logo: 'claudecode-color',
      copy: 'prompt',
      steps: [
        'Paste the setup prompt below into Claude Code.',
        'Run /mcp, pick weave, choose Authenticate.',
        'Sign in to weave.',
      ],
    },
    {
      id: 'codex',
      hue: '#5b6b82',
      name: 'Codex',
      where: 'CLI, app or IDE extension',
      pitch: 'Run one command, then sign in.',
      kind: 'harness',
      icon: 'lucide:code-xml',
      logo: 'codex-color',
      copy: 'codex',
      steps: [
        'Run the command below.',
        'Run codex mcp login weave and sign in.',
        'In Codex, run /mcp to check.',
      ],
      note: 'In the app or IDE extension, click Authenticate next to weave instead of step 2.',
    },
    {
      id: 'antigravity',
      hue: '#2f80ed',
      name: 'Antigravity',
      where: 'App, IDE or CLI',
      pitch: 'Paste the setup prompt, then sign in.',
      kind: 'harness',
      icon: 'lucide:rocket',
      logo: 'antigravity-color',
      copy: 'prompt',
      steps: [
        'Paste the setup prompt below into the agent.',
        'Open Settings, then Customizations, and click Authenticate next to weave.',
        'Sign in, paste the code back, click Submit.',
      ],
    },
    {
      id: 'gemini-cli',
      hue: '#4c7dea',
      name: 'Gemini CLI',
      where: 'Terminal',
      pitch: 'Paste the setup prompt, then run /mcp auth.',
      kind: 'harness',
      icon: 'lucide:star',
      logo: 'geminicli-color',
      copy: 'prompt',
      steps: [
        'Paste the setup prompt below into Gemini CLI.',
        'Run /mcp auth weave and sign in.',
      ],
    },
    {
      id: 'other',
      hue: '#6b7280',
      name: 'Something else',
      where: 'Any MCP client',
      pitch: 'Any agent that can follow a prompt.',
      kind: 'other',
      icon: 'lucide:link',
      copy: 'prompt',
      steps: [
        'Paste the setup prompt below into your agent.',
        'Follow its steps, then sign in to weave.',
      ],
    },
  ];

  const TOOL_IDS = new Set(TOOLS.map((t) => t.id));

  function serverName(url) {
    const address = new URL(url);
    const path = address.pathname.match(/^\/w\/([a-z0-9][a-z0-9-]*)\/mcp\/?$/i)?.[1];
    const host = address.hostname.match(/^([a-z0-9][a-z0-9-]*)\.weave\.grunion\.ai$/i)?.[1];
    const workspace = path ?? (host === 'dev' ? null : host);
    return workspace ? `weave-${workspace.toLowerCase()}` : 'weave';
  }

  const setupPrompt = (url, name = serverName(url)) => SETUP_PROMPT.replace('{URL}', url).replace('server named "weave"', `server named "${name}"`);

  function snippet(tool, url, name = serverName(url)) {
    if (tool.copy === 'prompt') return setupPrompt(url, name);
    if (tool.copy === 'command') return `claude mcp add --transport http --scope user ${name} ${url}`;
    if (tool.copy === 'codex') return `codex mcp add ${name} --url ${url}`;
    return url;
  }

  function firstMessage({ workspace, template = null, other = '' } = {}) {
    const what = String(other).trim().replace(/[.!?\s]+$/, '');
    if (what) return `Use weave to set up my ${workspace} workspace for this: ${what}. Propose the tables and fields first, and build them once I agree.`;
    if (template) return `Use weave to open my ${workspace} workspace and walk me through the ${template} tables weave set up. Then help me add my first real record.`;
    return `Use weave to open my ${workspace} workspace. Ask me what I want to track, propose tables for it, and build them once I agree.`;
  }

  function guide(toolId, { url, workspace, template = null, other = '' }) {
    const tool = TOOLS.find((t) => t.id === toolId);
    if (!tool) return null;
    const name = serverName(url);
    const named = (text) => text.replace(/\b(Name it |pick |next to |turn |mcp login |mcp auth )weave\b/g, `$1${name}`);
    return { ...tool, steps: tool.steps.map(named), note: tool.note && named(tool.note), value: snippet(tool, url, name), message: firstMessage({ workspace, template, other }) };
  }

  root.WeaveAgentConnect = { TOOLS, TOOL_IDS, SETUP_PROMPT, setupPrompt, snippet, firstMessage, guide };
})(globalThis);
