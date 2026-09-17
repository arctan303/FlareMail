# Deploy the experience

The experience and Docs share a Pages site. The root opens the mailbox; /docs opens the documentation. No Worker, database or real mailbox service is required.

## Local preview

Run from the repository root:

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 dev:pages
```

Visit http://127.0.0.1:3002. To build and preview the output:

```sh
npx --yes pnpm@10.34.5 build:pages
npx --yes pnpm@10.34.5 preview:pages
```

Visit http://127.0.0.1:4174.

## Pages build configuration

| Setting | Value |
| --- | --- |
| Project name | flaremail-demo (current public preview project) |
| Root directory | Repository root |
| Build command | npx --yes pnpm@10.34.5 build:pages |
| Output directory | apps/web/dist-pages |
| Node.js | 24 |

Alternatively, upload the locally built apps/web/dist-pages directory. The real mailbox retains its build / deploy commands and uses a separate output directory.

Pages supports SPA routing by default. The output has no top-level 404.html so document deep links and mail routes work on refresh.

[Cloudflare build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [SPA routing](https://developers.cloudflare.com/pages/configuration/serving-pages/)

## Maintain documentation

Edit the matching Markdown in apps/web/docs/zh and apps/web/docs/en, then rebuild. Add new articles to the apps/web/src/playground/docs.js directory registry; use the same slug in both languages.

Online experience: [flaremail-demo.pages.dev](https://flaremail-demo.pages.dev). For the existing Direct Upload project, build locally and upload:

```sh
npx --yes pnpm@10.34.5 build:pages
npx --yes pnpm@10.34.5 --filter worker exec wrangler pages deploy dist-pages --cwd ../web --project-name your-pages-project --branch main
```

Replace your-pages-project with your own Pages project name. Direct Upload and Git integration are different project creation modes; deploy according to your existing type. Experience output is separate from the real mailbox Worker.
