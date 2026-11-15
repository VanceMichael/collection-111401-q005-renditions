import { capture, downloadResource, ResourceError } from './client.mjs';
import { Archive } from './archive.mjs';
import { openBrowser } from './browser.mjs';

const DEFAULT_CONFIG = {
  viewport: { width: 1000, height: 700 },
  deviceScaleFactor: 1,
  views: ['front', 'seal'],
  budgetBytes: 8 * 1024 * 1024
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const VIEW_NAME = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;

async function readToken(page) {
  return page.locator('main').evaluate(main => ({
    artwork: main.getAttribute('data-artwork'),
    edition: main.getAttribute('data-edition')
  }));
}

// 在浏览器内部完成视角发布、懒加载触发与标准资源选择；不自行重算 srcset 候选。
async function readView(page, view) {
  return page.evaluate(async view => {
    const figure = document.querySelector(`figure[data-view="${view}"]`);
    if (!figure) return null;
    figure.scrollIntoView({ block: 'center' });
    const image = figure.querySelector('img');
    if (image) {
      if (image.loading === 'lazy') image.loading = 'eager';
      // 解码失败（如展示版切换导致资源 409）不直接抛出，交给后续版本护栏裁决。
      await image.decode().catch(() => undefined);
    }
    const caption = figure.querySelector('figcaption')?.textContent.trim() ?? '';
    const picture = figure.querySelector('picture');
    return {
      view,
      selected: image?.currentSrc || image?.src || '',
      alt: image?.alt || '',
      caption,
      candidates: {
        imgSrc: image?.getAttribute('src') ?? null,
        imgSrcset: image?.getAttribute('srcset') ?? null,
        sizes: image?.getAttribute('sizes') ?? null,
        pictureSources: picture
          ? [...picture.querySelectorAll('source')].map(source => ({
              media: source.getAttribute('media'),
              type: source.getAttribute('type'),
              srcset: source.getAttribute('srcset')
            }))
          : []
      }
    };
  }, view);
}

function urlEdition(href) {
  try { return new URL(href).searchParams.get('edition'); }
  catch { return null; }
}

// 下载期间持续核对页面作品与展示版；页面一旦切换作品即中止未结束的下载。
async function watchToken(page, controller, initial) {
  let failures = 0;
  while (!controller.signal.aborted) {
    await delay(100);
    let token;
    try { token = await readToken(page); }
    catch { failures += 1; if (failures >= 2) { controller.abort(); return; } continue; }
    failures = 0;
    if (token.artwork !== initial.artwork || token.edition !== initial.edition) {
      controller.abort();
      return;
    }
  }
}

export async function receiveCurrent(base, directory, config = {}) {
  const settings = {
    viewport: { ...DEFAULT_CONFIG.viewport, ...(config.viewport ?? {}) },
    deviceScaleFactor: config.deviceScaleFactor ?? DEFAULT_CONFIG.deviceScaleFactor,
    views: config.views ?? DEFAULT_CONFIG.views,
    budgetBytes: config.budgetBytes ?? DEFAULT_CONFIG.budgetBytes
  };
  for (const view of settings.views) {
    if (!VIEW_NAME.test(view)) throw new Error(`视角标识不受支持：${view}`);
  }

  // 沿用既有收存入口：先把图录原文作为来源凭据保存。
  const { receipt: pageReceipt } = await capture(base + '/gallery', directory);
  const archive = new Archive(directory);

  const browser = await openBrowser();
  const collected = [];
  const missing = [];
  let usedBytes = 0;
  let superseded = false;
  let artwork = null;
  let edition = null;
  let currentFallback = null;

  const markMissing = (view, reason, detail) => missing.push({ view, reason, detail: detail ?? null });

  try {
    const page = await browser.newPage({
      viewport: settings.viewport,
      deviceScaleFactor: settings.deviceScaleFactor
    });
    await page.goto(base + '/gallery', { waitUntil: 'domcontentloaded' });
    await page.locator('img').first().evaluate(image => image.decode()).catch(() => undefined);

    const initialToken = await readToken(page);
    artwork = initialToken.artwork;
    edition = initialToken.edition;
    currentFallback = await page.locator('img').first().evaluate(image => image.currentSrc);

    // 触发懒加载入口，让细节视角在页面中发布。
    const detailsButton = page.locator('#details');
    if (await detailsButton.count()) {
      await detailsButton.first().click();
      await page.locator('#more figure img').waitFor({ state: 'attached', timeout: 3000 })
        .catch(() => undefined);
    }

    for (const view of settings.views) {
      if (superseded) { markMissing(view, 'aborted', '展示版已切换，未再发起领取'); continue; }

      let tokenBefore;
      try { tokenBefore = await readToken(page); }
      catch (error) { superseded = true; markMissing(view, 'aborted', error.message); continue; }
      if (tokenBefore.artwork !== artwork || tokenBefore.edition !== edition) {
        superseded = true;
        markMissing(view, 'edition', '领取前页面作品或展示版已变化');
        continue;
      }

      let snapshot;
      try { snapshot = await readView(page, view); }
      catch (error) { markMissing(view, 'unavailable', error.message); continue; }
      if (!snapshot) { markMissing(view, 'not-published', '该视角未在当前展示配置中发布'); continue; }
      if (!snapshot.selected) { markMissing(view, 'unavailable', '浏览器未为该视角选出可用资源'); continue; }
      if (urlEdition(snapshot.selected) !== edition) {
        superseded = true;
        markMissing(view, 'edition', '选中资源的展示版与当前页面不一致');
        continue;
      }

      const remaining = settings.budgetBytes - usedBytes;
      if (remaining <= 0) { markMissing(view, 'budget', '领取预算已用尽'); continue; }

      const controller = new AbortController();
      const watcher = watchToken(page, controller, tokenBefore);
      let downloaded;
      try {
        downloaded = await downloadResource(new URL(snapshot.selected, base + '/gallery').href, {
          remainingBytes: remaining,
          signal: controller.signal
        });
      } catch (error) {
        if (error instanceof ResourceError) {
          if (error.code === 'EDITION' || error.code === 'ABORTED') {
            superseded = true;
            markMissing(view, error.code === 'EDITION' ? 'edition' : 'aborted', error.message);
          } else if (error.code === 'BUDGET') {
            markMissing(view, 'budget', error.message);
          } else if (error.code === 'TIMEOUT') {
            markMissing(view, 'timeout', error.message);
          } else {
            markMissing(view, 'unavailable', error.message);
          }
          continue;
        }
        markMissing(view, 'unavailable', error.message);
        continue;
      } finally {
        controller.abort();
        await watcher.catch(() => undefined);
      }

      // 下载结束后再次核对页面：旧图不得挂到切换后的新作品/新说明上。
      let tokenAfter;
      try { tokenAfter = await readToken(page); }
      catch (error) { superseded = true; markMissing(view, 'aborted', error.message); continue; }
      if (tokenAfter.artwork !== artwork || tokenAfter.edition !== edition) {
        superseded = true;
        markMissing(view, 'edition', '领取完成时页面作品或展示版已变化，内容已弃置不归档');
        continue;
      }
      if (urlEdition(snapshot.selected) !== edition) {
        superseded = true;
        markMissing(view, 'edition', '资源展示版与页面快照不一致，内容已弃置不归档');
        continue;
      }

      const receipt = await archive.save(downloaded.bytes, downloaded.source);
      usedBytes += downloaded.bytes.length;
      collected.push({
        view: snapshot.view,
        caption: snapshot.caption,
        alt: snapshot.alt,
        edition,
        candidates: snapshot.candidates,
        source: downloaded.source,
        receipt: receipt.id,
        digest: receipt.digest,
        size: receipt.size
      });
    }
  } finally {
    await browser.close();
  }

  const complete = !superseded && missing.length === 0 && collected.length === settings.views.length;
  const manifest = await archive.saveManifest({
    gallery: base + '/gallery',
    pageReceipt: pageReceipt.id,
    artwork,
    edition,
    config: settings,
    views: collected,
    missing,
    budget: { limit: settings.budgetBytes, used: usedBytes, remaining: Math.max(0, settings.budgetBytes - usedBytes) },
    superseded,
    complete
  });

  const front = collected.find(item => item.view === 'front');
  return {
    receipt: pageReceipt.id,
    manifest: manifest.id,
    artwork,
    edition,
    config: settings,
    views: collected,
    missing,
    budget: manifest.budget,
    superseded,
    complete,
    current: front?.source.url ?? currentFallback
  };
}
