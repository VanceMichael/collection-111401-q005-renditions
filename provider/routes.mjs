import { GALLERY } from './gallery.mjs';
export const initialState = { generation: 1, mode: 'normal', clock: 1000 };
export async function stop(state) {  }
export async function routes(context) {
 const { request, url, body, payload, state, json, text, binary } = context;

 if (url.pathname==='/gallery') return text(GALLERY.replaceAll('EDITION',String(state.generation)),200,{'content-type':'text/html; charset=utf-8'});
 if (url.pathname.startsWith('/image/')) {
   // slow 模式模拟来源响应缓慢，用于演练页面切换作品时未结束下载的中止处理。
   if (state.mode === 'slow') await new Promise(resolve => setTimeout(resolve, state.clock));
   if (Number(url.searchParams.get('edition'))!==state.generation) return json({error:'作品展示版本改变'},409);
   const view=url.pathname.split('/').at(-1);
   return binary(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="beige"/><text x="10" y="40">${view}-${state.generation}</text></svg>`),'image/svg+xml', {etag:'"'+view+'-'+state.generation+'"'});
 }

}
