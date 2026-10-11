(function (root) {
  const RESERVED = ['www', 'app', 'api', 'mcp', 'auth', 'docs', 'status', 'admin', 'mail', 'clerk', 'accounts', 'clkmail', 'clk', 'clk2', 'weave', 'grunion'];
  const RESERVED_SET = new Set(RESERVED);
  const PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

  const COPY = {
    nameLabel: 'Workspace name',
    label: 'Workspace address',
    helper: 'Lowercase letters, numbers and hyphens. Your workspace lives at {slug}.{base}.',
    helperNoBase: 'Lowercase letters, numbers and hyphens.',
    helperSlugFallback: 'name',
    available: '{slug}.{base} is available.',
    availableNoBase: '{slug} is available.',
    taken: 'Another workspace already uses {slug}.',
    reserved: 'The name {slug} is reserved for weave itself.',
    invalid: 'Use lowercase letters, numbers and hyphens, and start and end with a letter or number.',
    chipLead: 'Try a name that is yours:',
    chips: { name: 'Your name', team: 'Your team', project: 'Your project', mascot: 'Your mascot' },
    placeholders: { team: 'design-crew', project: 'harbor-launch', mascot: 'otter' },
    submit: 'Create workspace',
    start: {
      title: 'weave',
      signIn: 'Sign in with {provider}',
      listTitle: 'Your workspaces',
      empty: 'No workspace opens for this sign-in yet.',
      create: 'Create workspace',
      signOut: 'Use a different account',
      inviteLead: 'Invited as {role}',
      accept: 'Accept invite',
    },
    api: {
      slug_taken: 'The name {slug} belongs to another workspace. Try the name of the person, team, project or mascot the workspace is for.',
      slug_reserved: 'The name {slug} is reserved and cannot be claimed. Try the name of the person, team, project or mascot the workspace is for.',
      slug_invalid: 'Workspace names use lowercase letters, numbers and hyphens, run 1 to 63 characters, and cannot start or end with a hyphen.',
    },
  };

  const fill = (text, vars = {}) => String(text).replace(/\{(\w+)\}/g, (all, k) => (vars[k] ?? all));

  function slugify(text) {
    return String(text ?? '').trim().normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/['’]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-')
      .replace(/^-+/, '').slice(0, 63).replace(/-+$/, '');
  }

  function formState(slug) {
    const s = String(slug ?? '');
    if (RESERVED_SET.has(s) || s.startsWith('_') || s.startsWith('xn--')) return 'reserved';
    if (!PATTERN.test(s)) return 'invalid';
    return null;
  }

  const apiMessage = (state, slug) => fill(COPY.api[`slug_${state}`], { slug });

  root.WeaveSlugs = { RESERVED, COPY, fill, slugify, formState, apiMessage };
})(globalThis);
