import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProvider } from '../provider/server.mjs';
import { receiveCurrent } from '../src/domain.mjs';
import { downloadResource, ResourceError } from '../src/client.mjs';
import { Archive } from '../src/archive.mjs';

async function controlled(provider, change) {
  const response = await fetch(provider.base + '/_control', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change)
  });
  assert.equal(response.status, 200);
}

async function withDirectory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'receive-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

async function imageLength(provider, name = 'front-wide') {
  const response = await fetch(`${provider.base}/image/${name}?edition=1`);
  assert.equal(response.status, 200);
  return Number(response.headers.get('content-length'));
}

test('指定配置下领取各视角真实资源并把说明与收据绑定落盘', { timeout: 30000 }, async () => {
  const provider = await createProvider();
  await withDirectory(async directory => {
    try {
      const result = await receiveCurrent(provider.base, directory);
      assert.equal(result.artwork, 'lot-8');
      assert.equal(result.edition, '1');
      assert.equal(result.complete, true);
      assert.equal(result.superseded, false);
      assert.deepEqual(result.missing, []);
      assert.deepEqual(result.views.map(item => item.view), ['front', 'seal']);

      const front = result.views.find(item => item.view === 'front');
      const seal = result.views.find(item => item.view === 'seal');
      assert.equal(front.caption, '全貌');
      assert.equal(seal.caption, '右下角印章');
      assert.equal(front.alt, '作品正面');
      // 1000px 宽视口命中 picture 的 min-width:900px 候选，而不是 img 占位 src。
      assert.match(front.source.url, /\/image\/front-wide\?edition=1$/);
      assert.match(seal.source.url, /\/image\/seal\?edition=1$/);
      assert.equal(result.current, front.source.url);
      // 候选清单原样保留，由浏览器标准语义选择，不自行重算。
      assert.equal(front.candidates.pictureSources.length, 1);
      assert.match(front.candidates.imgSrcset, /front-large/);

      // 清单与对象均可重新打开，且图像收据与展示版一致。
      const archive = new Archive(directory);
      const manifests = await archive.listManifests();
      assert.equal(manifests.length, 1);
      assert.equal(manifests[0].id, result.manifest);
      for (const item of result.views) {
        const receipt = (await archive.list()).find(entry => entry.id === item.receipt);
        assert.ok(receipt);
        const bytes = await archive.read(receipt);
        assert.equal(bytes.length, item.size);
        assert.match(receipt.source.url, new RegExp(`edition=${result.edition}$`));
      }
      assert.ok(provider.audit.some(request => request.path.startsWith('/image/')));
    } finally { await provider.close(); }
  });
});

test('展示配置改变时浏览器选出的资源随视口变化', { timeout: 30000 }, async () => {
  const provider = await createProvider();
  await withDirectory(async directory => {
    try {
      const result = await receiveCurrent(provider.base, directory, {
        viewport: { width: 600, height: 700 },
        deviceScaleFactor: 1,
        views: ['front']
      });
      assert.equal(result.config.viewport.width, 600);
      assert.equal(result.complete, true);
      const front = result.views[0];
      assert.doesNotMatch(front.source.url, /front-wide/);
      assert.match(front.source.url, /\/image\/front-(small|large)\?edition=1$/);
    } finally { await provider.close(); }
  });
});

test('懒加载细节图在触发入口并解码后才领取', { timeout: 30000 }, async () => {
  const provider = await createProvider();
  try {
    const html = await (await fetch(provider.base + '/gallery')).text();
    assert.match(html, /loading="lazy"/);
    await withDirectory(async directory => {
      const result = await receiveCurrent(provider.base, directory);
      assert.equal(result.views.some(item => item.view === 'seal'), true);
    });
  } finally { await provider.close(); }
});

test('预算只够部分视角时明确记录未取得视角且不宣布完成', { timeout: 30000 }, async () => {
  const provider = await createProvider();
  await withDirectory(async directory => {
    try {
      const length = await imageLength(provider);
      const result = await receiveCurrent(provider.base, directory, { budgetBytes: length + 10 });
      assert.equal(result.complete, false);
      assert.equal(result.views.length, 1);
      assert.equal(result.views[0].view, 'front');
      assert.equal(result.budget.used, length);
      assert.deepEqual(result.missing, [{ view: 'seal', reason: 'budget', detail: result.missing[0].detail }]);
      assert.ok(result.missing[0].detail);
    } finally { await provider.close(); }
  });
});

test('预算连一个视角都不够时该视角按 budget 原因缺失', { timeout: 30000 }, async () => {
  const provider = await createProvider();
  await withDirectory(async directory => {
    try {
      const length = await imageLength(provider);
      const result = await receiveCurrent(provider.base, directory, {
        views: ['front'], budgetBytes: length - 1
      });
      assert.equal(result.complete, false);
      assert.equal(result.views.length, 0);
      assert.equal(result.missing[0].view, 'front');
      assert.equal(result.missing[0].reason, 'budget');
      assert.equal(result.budget.used, 0);
    } finally { await provider.close(); }
  });
});

test('展示版在下载进行中切换时中止下载且旧图不挂新说明', { timeout: 30000 }, async () => {
  const provider = await createProvider();
  await controlled(provider, { mode: 'slow', clock: 1500 });
  await withDirectory(async directory => {
    try {
      const running = receiveCurrent(provider.base, directory);
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && !provider.audit.some(request => request.path.startsWith('/image/'))) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.ok(provider.audit.some(request => request.path.startsWith('/image/')), '未观察到进行中的图像下载');
      await controlled(provider, { generation: 2, mode: 'normal' });
      const result = await running;

      assert.equal(result.superseded, true);
      assert.equal(result.complete, false);
      assert.equal(result.views.length, 0);
      assert.ok(result.missing.length > 0);
      assert.ok(result.missing.every(item => ['edition', 'aborted'].includes(item.reason)));

      // 落盘清单同样记录缺失原因，且没有任何旧版图像收据被归档。
      const archive = new Archive(directory);
      const manifests = await archive.listManifests();
      assert.equal(manifests[0].superseded, true);
      const receipts = await archive.list();
      assert.ok(receipts.every(receipt => !receipt.source.url.includes('/image/')));
    } finally { await provider.close(); }
  });
});

test('未在当前配置发布的视角按 not-published 明确缺失', { timeout: 30000 }, async () => {
  const provider = await createProvider();
  await withDirectory(async directory => {
    try {
      const result = await receiveCurrent(provider.base, directory, { views: ['front', 'verso'] });
      assert.equal(result.complete, false);
      assert.deepEqual(result.missing.map(item => item.view), ['verso']);
      assert.equal(result.missing[0].reason, 'not-published');
    } finally { await provider.close(); }
  });
});

test('downloadResource 区分预算、展示版冲突与外部中止', async () => {
  const provider = await createProvider();
  try {
    const length = await imageLength(provider);
    await assert.rejects(
      () => downloadResource(`${provider.base}/image/front-wide?edition=1`, { remainingBytes: length - 1 }),
      error => error instanceof ResourceError && error.code === 'BUDGET'
    );

    await controlled(provider, { generation: 2 });
    await assert.rejects(
      () => downloadResource(`${provider.base}/image/front-wide?edition=1`),
      error => error instanceof ResourceError && error.code === 'EDITION'
    );
  } finally { await provider.close(); }
});

test('外部中止信号能中断尚未结束的下载', { timeout: 15000 }, async () => {
  const provider = await createProvider();
  await controlled(provider, { mode: 'slow', clock: 3000 });
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    await assert.rejects(
      () => downloadResource(`${provider.base}/image/front-wide?edition=1`, {
        signal: controller.signal, timeoutMs: 10000
      }),
      error => error instanceof ResourceError && error.code === 'ABORTED'
    );
    clearTimeout(timer);
  } finally { await provider.close(); }
});
