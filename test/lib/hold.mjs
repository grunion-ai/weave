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
