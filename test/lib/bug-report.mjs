export async function openBugReport(page) {
  const fab = page.locator('.bug-fab');
  if (await fab.isVisible()) await fab.click();
  else {
    if (!(await page.locator('#app.nav-peek').count())) await page.locator('.nav-menu >> visible=true').first().click();
    await page.locator('#sidebar .nav-identity-more').click();
    await page.locator('.nav-personal-menu .nav-bug-row').click();
  }
  await page.waitForSelector('#bug-panel .bug-note');
}
