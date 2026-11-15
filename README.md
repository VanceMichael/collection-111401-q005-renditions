# 响应式图录的展示资源领取

在按指定 viewport、deviceScaleFactor 与视角清单打开的页面中，由浏览器标准语义选出每个视角实际加载的资源地址，再以有限预算从来源原始领取并归档。图片候选与说明版本由来源页面发布；流程不做图像识别或画质增强。

`receiveCurrent(base, directory, config?)` 是业务入口，config 可覆盖 viewport、deviceScaleFactor、views 与 budgetBytes。返回结果包含每个视角的收据、说明、候选清单与展示版，以及 missing 视角及原因（budget、not-published、edition、aborted、timeout、unavailable）、预算用量和 complete 标记；展示版在下载进行中切换时会中止未结束的下载、弃置已读字节并把 superseded 记为 true。manifest 与对象收据均原子落盘，可重新打开校验。

## 运行

使用 Node.js 22。依赖版本已锁定，运行、测试和演示不下载任何数据或软件。浏览器运行环境预装 Playwright 1.56.1 与 Chromium 1194；本机安装使用 `npm ci`，只在环境准备阶段执行。

- `npm test`：执行本地来源交互及收件存储测试。
- `npm run build`：逐个检查模块语法。
- `npm run demo`：启动本地来源，运行当前领取流程，打印真实收件结果后退出。
- `npm start`：在 127.0.0.1:8080 启动本地来源，PORT 可调整。`GET /health` 返回服务与当前来源版本；原有 `/_health` 仍可使用。

容器方式：`docker build -t collection-renditions .`，然后 `docker run --rm --network none collection-renditions`。镜像构建属于环境准备，运行时不访问公网。

## 项目结构

`src/domain.mjs` 提供当前业务读取入口；`src/client.mjs` 负责人工指定地址的有限大小原始领取；`src/archive.mjs` 保存内容及来源凭据。`provider/` 是独立的本地来源服务，`docs/source-contract.md` 说明它的资料和状态约定。演示使用临时目录，正式接入可向业务入口传入持久目录。

本地服务中的机构、记录和文件都是合成业务资料，不使用真实账号、个人信息或第三方站点数据。当前演示通常十秒内结束，全部本地测试应在六十秒内结束。
