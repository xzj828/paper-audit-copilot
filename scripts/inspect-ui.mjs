import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const page = await browser.newPage({ viewport: { width: 1488, height: 1058 } });
await page.goto('http://127.0.0.1:3001');
await page.locator('.demo-paper').waitFor();
const session = await page.context().newCDPSession(page);
await session.send('DOM.enable');
await session.send('CSS.enable');
const { root } = await session.send('DOM.getDocument');
for (const selector of [
  '.event-content h3',
  '.paper p',
  '.finding-section p',
  '.primary-nav button span',
]) {
  const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  console.log(
    selector,
    JSON.stringify(await session.send('CSS.getPlatformFontsForNode', { nodeId })),
  );
}
console.log(
  JSON.stringify(
    await page
      .locator('.paper p')
      .first()
      .evaluate((el) => ({
        font: getComputedStyle(el).font,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      })),
  ),
);
await browser.close();
