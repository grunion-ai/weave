/* Door B through the real sign-in page (Feature #222 part 2, gate G2).

   The unit suites prove the verifier and the routes against a software
   authenticator; this one proves the page a person actually uses drives
   them: Chromium's virtual authenticator (CDP WebAuthn domain — ctap2,
   internal transport, resident keys, user verification) answers the
   navigator.credentials prompts, and the flow is the one the guide
   describes — invite URL, register, land on the walled page, sign out,
   sign in with the discoverable credential, the walled page loads again.

   The page is opened as localhost, not 127.0.0.1: a passkey RP ID cannot be
   an IP address, which is also why the page moves a 127.0.0.1 visitor over. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';

let task, invite;

const s = await launch('auth-passkey', (weave) => {
  weave.createSpace({ name: 'Dev' });
  const db = weave.createTable({ space: 'Dev', name: 'Task' });
  task = weave.createEntity(db.id, { Name: 'Behind the wall' });
  weave.createAccount({ name: 'kyle', role: 'admin' });
  weave.setRequireAuth(true);
  invite = weave.createInvite('kyle').token;
});

if (s) {
  const { server, browser, weave } = s;
  const base = `http://localhost:${server.address().port}`;
  const walled = `/e/${task.id}/doc.html`;

  async function passkeyPage() {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
    });
    const credentials = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
    return { context, page, cdp, authenticatorId, credentials };
  }

  test('the wall page links to the sign-in page, and a 127.0.0.1 visitor is moved to localhost', async () => {
    const page = await browser.newPage();
    const res = await page.goto(`http://127.0.0.1:${server.address().port}${walled}`);
    assert.equal(res.status(), 401);
    const href = await page.getAttribute('a', 'href');
    assert.equal(href, `/auth?next=${encodeURIComponent(walled)}`);
    await page.click('a');
    await page.waitForURL(/^http:\/\/localhost:\d+\/auth\?next=/);
    await page.waitForSelector('#sec-signin:not([hidden])');
    await page.close();
  });

  test('invite → register → the walled page → sign out → sign in with the passkey → the walled page again', async () => {
    const { context, page, credentials } = await passkeyPage();
    // The invite link shows the registration form, prefilled with a device name.
    await page.goto(`${base}/auth?invite=${invite}&next=${encodeURIComponent(walled)}`);
    await page.waitForSelector('#sec-register:not([hidden])');
    assert.equal(await page.textContent('#register-title'), 'Register this device');
    await page.fill('#label', 'Virtual iPhone');
    await page.click('#register');
    // The ceremony lands the browser on the page it was headed for, signed in.
    await page.waitForURL(`${base}${walled}`);
    assert.match(await page.content(), /Behind the wall/);
    assert.equal((await credentials()).length, 1, 'the authenticator holds one resident credential');
    const row = weave.listAccounts().find((a) => a.name === 'kyle');
    assert.equal(row.credentials.length, 1);
    assert.equal(row.credentials[0].label, 'Virtual iPhone');
    assert.equal(row.credentials[0].alg, -7, 'the virtual authenticator speaks ES256');
    assert.equal(weave.readInvite(invite), null, 'the invite is spent');
    assert.equal(weave.listSessions('kyle').length, 1);
    // The account page: the passkey and this session are listed.
    await page.goto(`${base}/auth`);
    await page.waitForSelector('#sec-me:not([hidden])');
    assert.equal(await page.textContent('#who-name'), 'kyle');
    assert.equal(await page.textContent('#who-role'), 'admin');
    assert.match(await page.textContent('#creds'), /Virtual iPhone/);
    assert.match(await page.textContent('#sessions'), /This browser/);
    // Sign out: the session is gone on the server and the wall is back.
    await page.click('#signout');
    await page.waitForSelector('#sec-signin:not([hidden])');
    assert.equal(weave.listSessions('kyle').length, 0);
    const back = await page.goto(`${base}${walled}`);
    assert.equal(back.status(), 401);
    // Sign in: discoverable credential, no username, then the walled page loads.
    await page.goto(`${base}/auth?next=${encodeURIComponent(walled)}`);
    await page.waitForSelector('#sec-signin:not([hidden])');
    await page.click('#signin');
    await page.waitForURL(`${base}${walled}`);
    assert.match(await page.content(), /Behind the wall/);
    assert.equal(weave.listSessions('kyle').length, 1);
    assert.ok(weave.listAccounts().find((a) => a.name === 'kyle').credentials[0].lastUsedAt, 'the credential records its use');
    // The app shell itself opens under the cookie.
    const shell = await page.goto(`${base}/`);
    assert.equal(shell.status(), 200);
    await context.close();
  });

  test('a passkey the account no longer holds is refused with a message that says what to do', async () => {
    const { context, page, credentials } = await passkeyPage();
    // Register a second device through a signed-in session, then remove it.
    const inv = weave.createInvite('kyle').token;
    await page.goto(`${base}/auth?invite=${inv}`);
    await page.waitForSelector('#sec-register:not([hidden])');
    await page.click('#register');
    await page.waitForURL(`${base}/`);
    assert.equal((await credentials()).length, 1);
    const kyle = () => weave.listAccounts().find((a) => a.name === 'kyle');
    assert.equal(kyle().credentials.length, 2);
    const mine = kyle().credentials.find((c) => c.label !== 'Virtual iPhone');
    weave.removeCredential('kyle', mine.id);
    weave.revokeSession('kyle', { all: true });
    await page.goto(`${base}/auth`);
    await page.waitForSelector('#sec-signin:not([hidden])');
    await page.click('#signin');
    await page.waitForSelector('#msg.bad');
    assert.match(await page.textContent('#msg'), /No account holds this passkey/);
    assert.equal(weave.listSessions('kyle').length, 0, 'no session was minted');
    await context.close();
  });
}
