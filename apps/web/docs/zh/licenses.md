# 开源与许可

## 项目源码与完整分发物

FlareMail 自身源码采用 MIT，见 [LICENSE](LICENSE)。

完整分发物包含 TinyMCE 与 ua-parser-js，整体按 AGPL-3.0-or-later 提供。保留第三方许可和版权通知；具体组件与来源通知见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

体验站保留与正式前端相同的编辑器及其许可文件。源码可从 [项目仓库](https://github.com/arctan303/FlareMail) 获取。

## 图标与文档渲染

应用与体验站共用的补充图标包括 480 Design 的 Solar（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)）与 Microsoft 的 Fluent UI System Icons（[MIT 许可原文](/fluent-icons-license.txt)）。图标通过 Iconify 获取，未修改路径；作者与来源见第三方通知。Markdown 渲染使用 marked（MIT）。

## 贡献与问题报告

普通问题通过 [Issues](https://github.com/arctan303/FlareMail/issues) 反馈，使用交流见 [Discussions](https://github.com/arctan303/FlareMail/discussions)。

在仓库根目录运行：

```sh
npx --yes pnpm@10.34.5 test:worker
npx --yes pnpm@10.34.5 test:web
npx --yes pnpm@10.34.5 build
npx --yes pnpm@10.34.5 build:pages
```

安全漏洞报告方式见 [SECURITY.md](SECURITY.md)。
