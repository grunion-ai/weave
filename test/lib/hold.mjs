export async function hold(locator, { timeout = 10000 } = {}) {
  const page = locator.page();
  await locator.scrollIntoViewIfNeeded();
  const handle = await locator.elementHandle();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction((n) => n.classList.contains('holding'), handle, { timeout });
  await page.waitForFunction((n) => !n.isConnected || !n.classList.contains('holding'), handle, { timeout });
  await page.mouse.up();
}

export async function releaseEarly(locator, { at = 0.5, timeout = 10000 } = {}) {
  const page = locator.page();
  await locator.scrollIntoViewIfNeeded();
  const handle = await locator.elementHandle();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction(([n, f]) => {
    if (!n.classList.contains('holding')) return false;
    const sweep = n.querySelector('.hold-fill')?.getAnimations()[0];
    const span = sweep?.effect?.getComputedTiming()?.activeDuration;
    if (!(span > 0)) return false;
    if (sweep.playState !== 'paused') {
      sweep.pause();
      sweep.currentTime = span * f;
    }
    return true;
  }, [handle, at], { polling: 'raf', timeout });
  await page.mouse.up();
  await page.waitForFunction((n) => !n.isConnected || !n.classList.contains('holding'), handle, { timeout });
}
