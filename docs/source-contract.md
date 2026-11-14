# 图录展示约定

`/gallery` 是正常浏览器图录页面，作品由 data-artwork 标识，data-edition 表示说明与候选资源的展示版本，figure.data-view 标识视角。source.media、srcset 与 sizes 使用浏览器的标准资源选择语义。资源编码采用 SVG，只为使本地资料清晰可检查，不要求栅格化。

输入展示配置由 viewport、deviceScaleFactor 和视角清单构成，默认配置为 1000×700、1x、front 与 seal。seal 视角在点击“查看细节”后才出现。目录资源地址带 edition，旧展示版下载返回 409。下载预算针对实际读取的资源字节，不以候选 URL 数量计费；未加载视角不等于不存在。

## 本地演练控制

`GET /_health` 返回服务健康状态；`GET /_audit` 仅返回请求路径、方法和体积，不记录凭据。`POST /_control` 接收 JSON，可调整 generation、mode、clock。控制端点只服务于本地演练，不是资料接口，也不是浏览器业务操作入口。每次重新启动服务都会恢复初始数据；生产接入时不部署此控制面。
