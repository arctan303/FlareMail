# Open source & licenses

## Source and combined distribution

FlareMail's own source is MIT licensed; see [LICENSE](LICENSE).

The combined distribution includes TinyMCE and ua-parser-js and is provided under AGPL-3.0-or-later. Preserve third-party copyright and license notices; component and source notices are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

The experience retains the frontend's editor and its license files. Source is available in the [project repository](https://github.com/arctan303/FlareMail).

## Icons and Markdown

Supplemental icons shared by the application and experience include Solar by 480 Design ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)) and Fluent UI System Icons by Microsoft ([MIT license](/fluent-icons-license.txt)). They were obtained through Iconify without path changes; author and source attribution is recorded in the third-party notices. Markdown is rendered with marked (MIT).

## Contribute and report issues

Report ordinary problems through [Issues](https://github.com/arctan303/FlareMail/issues); discuss usage in [Discussions](https://github.com/arctan303/FlareMail/discussions).

Run from the repository root:

```sh
npx --yes pnpm@10.34.5 test:worker
npx --yes pnpm@10.34.5 test:web
npx --yes pnpm@10.34.5 build
npx --yes pnpm@10.34.5 build:pages
```

See [SECURITY.md](SECURITY.md) for vulnerability reports.
