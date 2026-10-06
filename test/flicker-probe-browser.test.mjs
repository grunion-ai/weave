import test from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './lib/browser.mjs';
import { installProbe, readProbe, recordFrames, frameFlashes } from './lib/flicker.mjs';

const s = await launch('flicker probe', (weave) => {
  weave.createSpace({ name: 'S' });
  weave.createTable({ space: 'S', name: 'T' });
});

if (s) {
  const { base, browser } = s;
  const open = async ({ maxMs = 5000 } = {}) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await installProbe(page, { maxMs });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      const st = document.createElement('div');
      st.id = 'stage';
      st.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;';
      document.body.append(st);
    });
    await frames(page, 3);
    await page.evaluate(() => { window.__flicker.length = 0; });
    return page;
  };
  const frames = (page, n) => page.evaluate((k) => new Promise((r) => { const step = () => (k-- > 0 ? requestAnimationFrame(step) : r()); step(); }), n);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const events = async (page, kind) => (await readProbe(page)).filter((e) => (kind ? e.kind === kind : e.kind !== 'jank'));

  test('a node painted for a beat and removed is a transient, named by its selector', async () => {
    const page = await open();
    try {
      await page.evaluate(() => new Promise((r) => {
        const n = document.createElement('div');
        n.className = 'skel flash-me';
        n.style.cssText = 'width:200px;height:40px;background:#888';
        document.getElementById('stage').append(n);
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { n.remove(); r(); })));
      }));
      await frames(page, 2);
      const t = await events(page, 'transient');
      assert.equal(t.length, 1, JSON.stringify(t));
      assert.match(t[0].sel, /div\.skel\.flash-me/);
      assert.ok(t[0].ms > 0 && t[0].ms < 150, `${t[0].ms} ms`);
    } finally { await page.close(); }
  });

  test('a subtree painted and removed is one transient, named at its top', async () => {
    const page = await open();
    try {
      await page.evaluate(() => new Promise((r) => {
        const st = document.getElementById('stage');
        const box = document.createElement('section');
        box.className = 'pane';
        box.style.cssText = 'width:300px;height:120px';
        box.innerHTML = '<div class="head" style="height:40px">h</div><div class="body" style="height:60px">b</div>';
        st.append(box);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          box.querySelector('.body').append(Object.assign(document.createElement('p'), { textContent: 'late', style: 'height:20px' }));
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { box.remove(); r(); })));
        }));
      }));
      await frames(page, 2);
      const t = await events(page, 'transient');
      assert.equal(t.length, 1, JSON.stringify(t));
      assert.match(t[0].sel, /section\.pane$/);
    } finally { await page.close(); }
  });

  test('siblings painted and replaced together are one transient, named by their parent', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const pop = document.createElement('div');
        pop.className = 'pop';
        pop.style.cssText = 'width:300px;min-height:90px';
        document.getElementById('stage').append(pop);
      });
      await frames(page, 2);
      await page.evaluate(() => new Promise((r) => {
        const pop = document.querySelector('#stage .pop');
        const fill = (v) => ['a', 'b', 'c'].map((c) => Object.assign(document.createElement('div'), { className: c, textContent: `${c} ${v}`, style: 'height:30px' }));
        pop.append(...fill('loading'));
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { pop.replaceChildren(...fill('loaded')); r(); })));
      }));
      await frames(page, 2);
      const t = await events(page, 'transient');
      assert.equal(t.length, 1, JSON.stringify(t));
      assert.match(t[0].sel, /div\.pop > \*$/);
    } finally { await page.close(); }
  });

  test('a painted node swapped for an identical one is a rerender, not a transient', async () => {
    const page = await open();
    try {
      await page.evaluate(() => new Promise((r) => {
        const st = document.getElementById('stage');
        const make = () => Object.assign(document.createElement('div'), { className: 'dock-entity', innerHTML: '<h2>Task 1</h2><p>Doing</p>', style: 'width:300px;height:80px' });
        const n = make();
        st.append(n);
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { n.replaceWith(make()); r(); })));
      }));
      await frames(page, 2);
      assert.deepEqual(await events(page, 'transient'), [], 'the reader saw the same thing twice');
      const rr = await events(page, 'rerender');
      assert.equal(rr.length, 1, JSON.stringify(await events(page)));
      assert.match(rr[0].sel, /div\.dock-entity/);
    } finally { await page.close(); }
  });

  test('a painted node swapped for a different one within a beat is a transient', async () => {
    const page = await open();
    try {
      await page.evaluate(() => new Promise((r) => {
        const st = document.getElementById('stage');
        const make = (t) => Object.assign(document.createElement('div'), { className: 'dock-entity', innerHTML: `<h2>${t}</h2>`, style: 'width:300px;height:80px' });
        const n = make('Loading');
        st.append(n);
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { n.replaceWith(make('Task 1')); r(); })));
      }));
      await frames(page, 2);
      const t = await events(page, 'transient');
      assert.equal(t.length, 1, JSON.stringify(await events(page)));
    } finally { await page.close(); }
  });

  test('a node that stays up past the flash window is a change, not a transient', async () => {
    const page = await open({ maxMs: 150 });
    try {
      await page.evaluate(() => new Promise((r) => {
        const n = document.createElement('div');
        n.style.cssText = 'width:200px;height:40px;background:#888';
        document.getElementById('stage').append(n);
        setTimeout(() => { n.remove(); r(); }, 600);
      }));
      await frames(page, 2);
      assert.deepEqual(await events(page, 'transient'), []);
    } finally { await page.close(); }
  });

  test('a node added and removed inside one task never reached the screen', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const n = document.createElement('div');
        n.style.cssText = 'width:200px;height:40px;background:#888';
        document.getElementById('stage').append(n);
        n.remove();
      });
      await frames(page, 3);
      assert.deepEqual(await events(page), []);
    } finally { await page.close(); }
  });

  test('a list emptied, painted empty, then refilled is a blank', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const ul = document.createElement('ul');
        ul.className = 'rows';
        ul.style.cssText = 'width:300px;min-height:60px';
        for (let i = 0; i < 3; i++) { const li = document.createElement('li'); li.textContent = `row ${i}`; ul.append(li); }
        document.getElementById('stage').append(ul);
      });
      await frames(page, 3);
      await page.evaluate(() => { window.__flicker.length = 0; });
      await page.evaluate(() => new Promise((r) => {
        const ul = document.querySelector('ul.rows');
        const kids = [...ul.children];
        ul.replaceChildren();
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { ul.append(...kids); r(); })));
      }));
      await frames(page, 2);
      const b = await events(page, 'blank');
      assert.equal(b.length, 1, JSON.stringify(await events(page)));
      assert.match(b[0].sel, /ul\.rows/);
    } finally { await page.close(); }
  });

  test('a class that flips and flips back after a paint is a revert, with the token named', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const n = document.createElement('div');
        n.className = 'card';
        n.style.cssText = 'width:200px;height:40px';
        document.getElementById('stage').append(n);
      });
      await frames(page, 3);
      await page.evaluate(() => { window.__flicker.length = 0; });
      await page.evaluate(() => new Promise((r) => {
        const n = document.querySelector('#stage .card');
        n.classList.add('is-loading');
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { n.classList.remove('is-loading'); r(); })));
      }));
      await frames(page, 2);
      const v = await events(page, 'revert');
      assert.equal(v.length, 1, JSON.stringify(await events(page)));
      assert.match(v[0].sel, /div\.card/);
      assert.match(v[0].detail, /is-loading/);
    } finally { await page.close(); }
  });

  test('a block redrawn in answer to each keystroke is the typing, not a flicker', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const st = document.getElementById('stage');
        const input = Object.assign(document.createElement('input'), { className: 'field' });
        const out = Object.assign(document.createElement('div'), { className: 'echo', style: 'width:300px;min-height:30px' });
        out.append(Object.assign(document.createElement('p'), { textContent: '' }));
        input.addEventListener('input', () => out.replaceChildren(Object.assign(document.createElement('p'), { textContent: input.value })));
        st.append(input, out);
      });
      await page.click('#stage .field');
      await frames(page, 2);
      await page.evaluate(() => { window.__flicker.length = 0; });
      await page.keyboard.type('typing at a pace', { delay: 40 });
      await frames(page, 3);
      assert.deepEqual(await events(page), []);
    } finally { await page.close(); }
  });

  test('a class rewritten to the same tokens is not a revert', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const n = document.createElement('span');
        n.className = 'ms-box';
        n.style.cssText = 'display:inline-block;width:120px;height:20px';
        document.getElementById('stage').append(n);
      });
      await frames(page, 3);
      await page.evaluate(() => { window.__flicker.length = 0; });
      await page.evaluate(() => new Promise((r) => {
        const n = document.querySelector('#stage .ms-box');
        n.className = 'ms-box';
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { n.setAttribute('class', 'ms-box'); r(); })));
      }));
      await frames(page, 2);
      assert.deepEqual(await events(page), []);
    } finally { await page.close(); }
  });

  test('the toast\'s zero-size live region emptying and refilling is not a flicker', async () => {
    const page = await open();
    try {
      await page.evaluate(() => new Promise((r) => {
        const live = document.createElement('div');
        live.setAttribute('aria-live', 'polite');
        live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
        live.append(document.createElement('span'));
        document.getElementById('stage').append(live);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          live.replaceChildren();
          setTimeout(() => { live.append(document.createElement('span')); r(); }, 50);
        }));
      }));
      await frames(page, 3);
      assert.deepEqual(await events(page), []);
    } finally { await page.close(); }
  });

  test('content pushed down with no input is a shift', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const box = document.createElement('div');
        box.className = 'content';
        box.style.cssText = 'position:relative;width:400px';
        box.innerHTML = '<p class="para" style="height:80px;margin:0;background:#ddd">text</p>';
        document.getElementById('stage').append(box);
      });
      await frames(page, 3);
      await page.evaluate(() => { window.__flicker.length = 0; });
      await page.evaluate(() => {
        const ban = document.createElement('div');
        ban.style.cssText = 'height:120px';
        document.querySelector('#stage .content').prepend(ban);
      });
      await frames(page, 3);
      await wait(100);
      const sh = await events(page, 'shift');
      assert.ok(sh.length >= 1, JSON.stringify(await events(page)));
      assert.ok(sh.some((e) => /p\.para/.test(e.sel)), JSON.stringify(sh));
      assert.ok(sh.some((e) => /^y \d+→\d+/.test(e.detail)), 'it says where the element went');
    } finally { await page.close(); }
  });

  test('an empty spacer pushed down is not a shift: there is nothing on it to see move', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const box = document.createElement('div');
        box.className = 'content';
        box.style.cssText = 'position:relative;width:400px';
        box.innerHTML = '<div class="spacer" style="height:300px"></div>';
        document.getElementById('stage').append(box);
      });
      await frames(page, 3);
      await page.evaluate(() => { window.__flicker.length = 0; });
      await page.evaluate(() => {
        const ban = document.createElement('div');
        ban.style.cssText = 'height:120px';
        document.querySelector('#stage .content').prepend(ban);
      });
      await frames(page, 3);
      await wait(100);
      assert.deepEqual(await events(page, 'shift'), []);
    } finally { await page.close(); }
  });

  test('a node that arrives and stays is not a flicker', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const n = document.createElement('div');
        n.style.cssText = 'width:200px;height:40px;background:#888';
        document.getElementById('stage').append(n);
      });
      await frames(page, 3);
      await wait(250);
      assert.deepEqual(await events(page), []);
    } finally { await page.close(); }
  });

  test('the screencast reads a whole-screen flash as A, B, A', async () => {
    const page = await open();
    try {
      const rec = await recordFrames(page);
      await wait(300);
      await page.evaluate(() => new Promise((r) => {
        const st = document.getElementById('stage');
        st.style.background = '#000';
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => { st.style.background = '#fff'; r(); })));
      }));
      await wait(400);
      const shots = await rec.stop();
      assert.ok(shots.length >= 3, `${shots.length} frames`);
      const flashes = frameFlashes(shots, { maxMs: 2000 });
      assert.equal(flashes.length, 1, `${flashes.length} flashes over ${shots.length} frames`);
      assert.ok(flashes[0].ratio > 0.9, 'the whole screen changed');
    } finally { await page.close(); }
  });
}
