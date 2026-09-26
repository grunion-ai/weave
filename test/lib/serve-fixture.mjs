// Boot fixtures own the server until it closes, including failed starts.
export async function bootAndStop(child, { timeout = 20000, killAfter = 1000 } = {}) {
  let log = '';
  let timer;
  let onData, onExit, onError;
  const closed = new Promise((resolve) => child.once('close', resolve));
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`serve never came up:\n${log}`)), timeout);
      onData = (data) => { log += data; if (/Weave running/.test(log)) resolve(); };
      onExit = (code) => reject(new Error(`serve exited ${code}:\n${log}`));
      onError = reject;
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', onExit);
      child.once('error', onError);
    });
    return log;
  } finally {
    clearTimeout(timer);
    child.stdout.off('data', onData);
    child.stderr.off('data', onData);
    child.off('exit', onExit);
    // Keep the error listener until close, including an unsuccessful spawn.
    let force;
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      force = setTimeout(() => child.kill('SIGKILL'), killAfter);
    }
    await closed;
    clearTimeout(force);
    child.off('error', onError);
  }
}
