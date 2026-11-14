import { capture } from './client.mjs';
import { openBrowser } from './browser.mjs';
export async function receiveCurrent(base,directory) {
 const {receipt}=await capture(base+'/gallery',directory);
 const browser=await openBrowser();
 try { const page=await browser.newPage({viewport:{width:1000,height:700},deviceScaleFactor:1});await page.goto(base+'/gallery');await page.locator('img').evaluate(image=>image.decode());return {receipt:receipt.id,artwork:await page.locator('main').getAttribute('data-artwork'),current:await page.locator('img').evaluate(image=>image.currentSrc)}; }
 finally { await browser.close(); }
}
