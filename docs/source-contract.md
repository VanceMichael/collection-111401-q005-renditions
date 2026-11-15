# 图录展示约定

`/gallery` 是正常浏览器图录页面，作品由 data-artwork 标识，data-edition 表示说明与候选资源的展示版本，figure.data-view 标识视角。source.media、srcset 与 sizes 使用浏览器的标准资源选择语义，领取流程不自行重算候选，只在按配置打开的页面内读取浏览器实际选中的 `img.currentSrc`。资源编码采用 SVG，只为使本地资料清晰可检查，不要求栅格化，也不做任何图像识别或画质增强。

输入展示配置由 viewport、deviceScaleFactor 和视角清单构成，默认配置为 1000×700、1x、front 与 seal。seal 视角在点击“查看细节”后才出现，其图片带 `loading="lazy"`，流程会先触发入口、滚动到视角并等待解码，再读取所选资源；未发布的视角按 not-published 记入缺失清单，不视为不存在。

## 领取与归档

- 每个视角在浏览器内取得资源地址、alt、figcaption 说明与候选清单（picture source、img srcset、sizes）后，由 Node 侧按该地址重新发起有限大小的原始领取，收据与作品、视角、展示版和说明一并写入 manifest（manifests 目录，与收据同样原子落盘）。
- 目录资源地址带 edition，旧展示版下载返回 409。下载前、下载完成后都会核对页面的 data-artwork/data-edition 与资源 URL 上的 edition；任何一处不一致即中止后续视角，已读到的字节弃置不归档，避免旧图挂到新说明上。下载期间另有页面轮询，页面切换作品时通过 AbortController 中止尚未结束的下载。
- 下载预算针对实际读取的资源字节，不以候选 URL 数量计费。响应声明的 content-length 先做剩余预算预检，流式读取时再按真实字节复核；预算不足的视角按 budget 原因列入 missing，并记录已用与剩余预算。未加载视角不等于不存在。
- 只有配置中的全部视角都成功归档、且过程未发生展示版替代（superseded）时，manifest 的 complete 才为 true；单个缩略图成功不代表整件作品采集完成。

## 本地演练控制

`GET /_health` 返回服务健康状态；`GET /_audit` 仅返回请求路径、方法和体积，不记录凭据。`POST /_control` 接收 JSON，可调整 generation、mode、clock。mode 为 slow 时，图像响应会先等待 clock 毫秒，用于演练下载进行中切换展示版的中止与护栏；控制端点只服务于本地演练，不是资料接口，也不是浏览器业务操作入口。每次重新启动服务都会恢复初始数据；生产接入时不部署此控制面。
