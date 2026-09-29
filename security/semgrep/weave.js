// Fixtures for security/semgrep/weave.yml: `semgrep --test security/semgrep`
// (run by test/security/semgrep-rules.test.mjs). Each `ruleid` line must fire,
// each `ok` line must not. Never imported by the app.
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import cp from 'node:child_process';

function html(el, name, text) {
  // ruleid: weave-html-sink-unescaped
  el.innerHTML = `<b>${name}</b>`;
  // ruleid: weave-html-sink-unescaped
  el.insertAdjacentHTML('beforeend', name);
  // ruleid: weave-html-sink-unescaped
  el.outerHTML = '<i>' + name + '</i>';
  // ok: weave-html-sink-unescaped
  el.innerHTML = escapeHtmlText(name);
  // ok: weave-html-sink-unescaped
  el.innerHTML = '';
  // ok: weave-html-sink-unescaped
  el.innerHTML = '<hr>';
}

function sql(db, table, id) {
  // ruleid: weave-sql-built-from-variable
  db.prepare(`SELECT * FROM ${table}`).all();
  // ruleid: weave-sql-built-from-variable
  db.exec('DELETE FROM t WHERE id = ' + id);
  // ok: weave-sql-built-from-variable
  db.prepare('SELECT * FROM t WHERE id = ?').get(id);
}

function files(rx, body) {
  // ruleid: weave-fs-path-from-request
  fs.readFileSync(rx.path);
  // ruleid: weave-fs-path-from-request
  fs.writeFileSync('/data/' + body.name, 'x');
  // ok: weave-fs-path-from-request
  fs.readFileSync(safeJoin('/data', rx.path));
  // ok: weave-fs-path-from-request
  readFileSync('/etc/fixed');
}

function decode(s) {
  // ruleid: weave-decodeuricomponent-unguarded
  const a = decodeURIComponent(s);
  try {
    // ok: weave-decodeuricomponent-unguarded
    return decodeURIComponent(s);
  } catch {
    return a;
  }
}

function dynamic(src) {
  // ruleid: weave-dynamic-code
  return new Function(src)();
}
function dynamic2(src) {
  // ruleid: weave-dynamic-code
  return eval(src);
}

function shell(cmd) {
  // ruleid: weave-child-process-shell
  cp.execSync(cmd);
  // ruleid: weave-child-process-shell
  cp.spawn(cmd, [], { shell: true });
  // ok: weave-child-process-shell
  cp.execFile('git', ['status']);
  // ok: weave-child-process-shell
  /a/.exec(cmd);
}

function bracket(rx, table) {
  const key = rx.searchParams.get('k');
  // ruleid: weave-bracket-access-request-key
  return table[key];
}
function bracketSafe(rx, table) {
  const key = rx.searchParams.get('k');
  // ok: weave-bracket-access-request-key
  return Object.hasOwn(table, key) ? table[Number(key)] : null;
}
