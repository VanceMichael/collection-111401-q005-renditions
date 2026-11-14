import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProvider } from '../provider/server.mjs';
import { receiveCurrent } from '../src/domain.mjs';
import { Archive } from '../src/archive.mjs';

async function controlled(provider, change) {
  const response = await fetch(provider.base + '/_control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change) });
  assert.equal(response.status, 200);
}

test('现有业务入口真实收存来源资料并可重新打开', async () => {
  const provider = await createProvider();
  const directory = await mkdtemp(join(tmpdir(), 'business-'));
  try {
    const result = await receiveCurrent(provider.base, directory);
    assert.ok(result);
    const archive = new Archive(directory);
    const receipts = await archive.list();
    assert.ok(receipts.length > 0);
    for (const receipt of receipts) assert.ok((await archive.read(receipt)).length > 0);
    assert.ok(provider.audit.some(request => !request.path.startsWith('/_')));
  } finally { await provider.close(); await rm(directory, { recursive: true, force: true }); }
});

test('图录候选与懒加载入口存在', async () => {
 const provider = await createProvider();
 try {
const html=await(await fetch(provider.base+'/gallery')).text();assert.match(html, /srcset=/);assert.match(html,/查看细节/);
 } finally { await provider.close(); }
});

test('图像资源不会跨展示版复用', async () => {
 const provider = await createProvider();
 try {
assert.equal((await fetch(provider.base+'/image/front-wide?edition=1')).headers.get('content-type'),'image/svg+xml');await controlled(provider,{generation:2});assert.equal((await fetch(provider.base+'/image/front-wide?edition=1')).status,409);
 } finally { await provider.close(); }
});
