import { Archive } from './archive.mjs';

const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;

export class ResourceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ResourceError';
    this.code = code;
  }
}

export async function capture(url, directory, options = {}) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
  if (!response.ok) throw new Error(`来源领取失败：${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_RESOURCE_BYTES) throw new Error('单份人工领取超过当前收件上限');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const source = { url, status: response.status, type: response.headers.get('content-type'), etag: response.headers.get('etag') };
  const archive = new Archive(directory);
  const receipt = await archive.save(bytes, source);
  return { bytes, receipt };
}

function combinedSignal(signal, timeoutMs) {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  return AbortSignal.any(signals);
}

/**
 * 领取单个展示资源，只负责按剩余预算读取字节并回报来源凭据，不做任何图像内容处理。
 * remainingBytes 为本次领取剩余预算；先核对响应声明长度，再在流式读取中复核。
 * signal 用于页面切换作品时由外部中止仍在进行的下载。
 */
export async function downloadResource(url, { remainingBytes = Infinity, signal, timeoutMs = 8000 } = {}) {
  let response;
  try {
    response = await fetch(url, { redirect: 'manual', signal: combinedSignal(signal, timeoutMs) });
  } catch (error) {
    const code = error.name === 'TimeoutError' ? 'TIMEOUT' : error.name === 'AbortError' ? 'ABORTED' : 'FETCH';
    throw new ResourceError(`资源领取中断：${error.message}`, code);
  }
  if (!response.ok) {
    throw new ResourceError(`来源领取失败：${response.status}`, response.status === 409 ? 'EDITION' : 'STATUS');
  }
  const lengthHeader = response.headers.get('content-length');
  const declared = lengthHeader === null ? NaN : Number(lengthHeader);
  if (Number.isFinite(remainingBytes) && Number.isFinite(declared) && declared > remainingBytes) {
    throw new ResourceError('资源声明体积超过剩余领取预算', 'BUDGET');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (Number.isFinite(remainingBytes) && size > remainingBytes) {
      throw new ResourceError('资源实际体积超过剩余领取预算', 'BUDGET');
    }
    if (size > MAX_RESOURCE_BYTES) {
      throw new ResourceError('单份资源超过当前收件上限', 'SIZE_LIMIT');
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  return {
    bytes,
    source: {
      url,
      status: response.status,
      type: response.headers.get('content-type'),
      etag: response.headers.get('etag'),
      contentLength: Number.isFinite(declared) ? declared : null    }
  };
}
