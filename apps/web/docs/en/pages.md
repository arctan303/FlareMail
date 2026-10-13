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

## Search and sharing

The build produces HTML containing each Chinese and English article, with its own title, description, language alternatives and sharing metadata. The document sitemap is at `/sitemap.xml`. Crawling is allowed for public documentation and the static resources it needs; experience mailbox pages remain excluded from indexing. The real mailbox build keeps its existing indexing restrictions.

The default canonical origin is `https://flaremail.arcinks.com`. When hosting your own documentation, set the build environment variable `VITE_PUBLIC_SITE_URL` to its HTTPS origin, such as `https://docs.example.com`, without a path, query or fragment. Canonical links, language alternatives, sharing URLs and the sitemap all use this origin.

After binding a domain, rebuild with that origin and check `/robots.txt`, `/sitemap.xml` and the HTML of an article. Binding a domain alone does not change metadata in an earlier build. Search engines decide when to index content. Pages preview deployments may add indexing restrictions, so check responses from the production site.

[Cloudflare build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [SPA routing](https://developers.cloudflare.com/pages/configuration/serving-pages/)

## Maintain documentation

Edit the matching Markdown in apps/web/docs/zh and apps/web/docs/en, then rebuild. Add new articles to the registry at apps/web/src/playground/doc-catalog.js; use the same slug in both languages. The documentation UI and static build share this registry.

Online experience: [flaremail.arcinks.com](https://flaremail.arcinks.com). For the existing Direct Upload project, build locally and upload:

```sh
npx --yes pnpm@10.34.5 build:pages
npx --yes pnpm@10.34.5 --filter worker exec wrangler pages deploy dist-pages --cwd ../web --project-name your-pages-project --branch main
```

Replace your-pages-project with your own Pages project name. Direct Upload and Git integration are different project creation modes; deploy according to your existing type. Experience output is separate from the real mailbox Worker.
