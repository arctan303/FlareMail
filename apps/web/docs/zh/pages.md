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

[Cloudflare 构建配置](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [单页应用路由](https://developers.cloudflare.com/pages/configuration/serving-pages/)

## 维护文档

修改 apps/web/docs/zh 或 apps/web/docs/en 下对应 Markdown，重新构建即可。新增文章还需更新 apps/web/src/playground/docs.js 的目录；两种语言保持相同 slug。

当前在线体验：[flaremail-demo.pages.dev](https://flaremail-demo.pages.dev)。已有 Direct Upload 项目可在本地构建后执行：

```sh
npx --yes pnpm@10.34.5 build:pages
npx --yes pnpm@10.34.5 --filter worker exec wrangler pages deploy dist-pages --cwd ../web --project-name your-pages-project --branch main
```

将 your-pages-project 替换成自己的 Pages 项目名。Direct Upload 与 Git 集成是不同创建方式，按现有项目类型部署；不要把体验站构建产物作为正式邮箱 Worker。
