# 部署体验站

体验与 Docs 在同一个 Pages 站点中。根路径直接进入邮箱，文档入口为 /docs；不需要 Worker、数据库或真实邮箱服务。

## 本地预览

在仓库根目录运行：

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 dev:pages
```

访问 http://127.0.0.1:3002。构建并预览产物：

```sh
npx --yes pnpm@10.34.5 build:pages
npx --yes pnpm@10.34.5 preview:pages
```

访问 http://127.0.0.1:4174。

## Pages 构建配置

| 项目 | 值 |
| --- | --- |
| 项目名称 | flaremail-demo（当前公开体验项目） |
| 根目录 | 仓库根目录 |
| 构建命令 | npx --yes pnpm@10.34.5 build:pages |
| 输出目录 | apps/web/dist-pages |
| Node.js | 24 |

也可在本地构建后，将 apps/web/dist-pages 上传到 Pages。正式邮箱继续使用原有 build / deploy 命令，两个构建目录独立。

Pages 默认支持单页应用路由；产物不放置顶层 404.html，以保证文档深链接与邮件路由刷新可用。

## 搜索与分享

构建会为每篇中英文文档生成包含正文的 HTML，并提供独立标题、摘要、中英对应链接和分享预览。文档站点地图位于 `/sitemap.xml`；公开站点只开放文档与必要静态资源的抓取，体验邮箱页面不参与收录。正式邮箱构建继续保持禁止索引。

规范地址默认使用 `https://flaremail.arcinks.com`。部署自己的文档站时，在构建环境设置 `VITE_PUBLIC_SITE_URL` 为实际使用的 HTTPS 站点来源，例如 `https://docs.example.com`，不要附加路径、查询参数或片段。构建后，文档规范链接、语言对应链接、分享地址和站点地图都会使用同一个来源。

绑定域名后需用相同地址重新构建，再核对 `/robots.txt`、`/sitemap.xml` 和任意文档页的 HTML。域名绑定本身不会更新旧构建的页面信息；搜索引擎何时收录由其决定。Pages 的预览部署可能额外禁止索引，应以正式站点响应为准。

[Cloudflare 构建配置](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [单页应用路由](https://developers.cloudflare.com/pages/configuration/serving-pages/)

## 维护文档

修改 apps/web/docs/zh 或 apps/web/docs/en 下对应 Markdown，重新构建即可。新增文章还需更新 apps/web/src/playground/doc-catalog.js 的目录；两种语言保持相同 slug。文档页面与静态构建共用该目录。

当前在线体验：[flaremail.arcinks.com](https://flaremail.arcinks.com)。已有 Direct Upload 项目可在本地构建后执行：

```sh
npx --yes pnpm@10.34.5 build:pages
npx --yes pnpm@10.34.5 --filter worker exec wrangler pages deploy dist-pages --cwd ../web --project-name your-pages-project --branch main
```

将 your-pages-project 替换成自己的 Pages 项目名。Direct Upload 与 Git 集成是不同创建方式，按现有项目类型部署；不要把体验站构建产物作为正式邮箱 Worker。
