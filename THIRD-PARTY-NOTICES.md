# Third-party notices

FlareMail's own source files are provided under the MIT license in [LICENSE](LICENSE). That file does not cover bundled third-party software, and it does not describe the license of the combined distribution.

## Distribution license

FlareMail does not claim an MIT-only distribution. Because it bundles TinyMCE (GPL-2.0-or-later) and ua-parser-js (AGPL-3.0-or-later), **the combined distribution is copyleft and is provided under AGPL-3.0-or-later**, which covers the GPL-2.0-or-later component and the AGPL-3.0-or-later component together.

Anyone redistributing FlareMail, or running a modified version as a network service, must:

- provide the corresponding source code of the version they distribute or operate;
- keep the copyright and license notices of the bundled components;
- not relicense the bundled components under MIT or another permissive license.

This notice records the licenses of the included components and the resulting distribution position. It is not legal advice; confirm the applicable requirements before publishing a distribution.

## Bundled editor

- TinyMCE 7.9.1 is included under `apps/web/public/tinymce/`.
- The bundled [license declaration](apps/web/public/tinymce/license.md) identifies GPL version 2 or later.
- Preserve that declaration, copyright headers, and [third-party notices](apps/web/public/tinymce/notices.txt), including the bundled DOMPurify notices.
- TinyMCE's [official licensing documentation](https://www.tiny.cloud/docs/tinymce/7/license-key/) explains the GPL and commercial licensing options.

The editor was retained from the existing mailbox implementation. No commercial license is bundled or implied, and its files have not been relicensed as MIT.

## User-Agent parser

The Worker retains `ua-parser-js` 2.0.10 from the existing implementation. Its installed package declares `AGPL-3.0-or-later`; the [upstream repository](https://github.com/faisalman/ua-parser-js) documents the v2 AGPL / commercial options. Its network clause applies when FlareMail runs as a service, so a modified deployment must offer the corresponding source. No commercial license is bundled or implied. Versions 0.7.x and 1.0.x remain MIT; 2.0.x is AGPL / commercial.

## Package dependencies

JavaScript dependencies are pinned by the root workspace pnpm lockfile. The Pages Markdown renderer uses marked (MIT); retain its package license when redistributing. Their package-specific license files and notices continue to apply.

Keep this inventory in sync with the bundled components. The distribution position above follows from the licenses of those components; confirm the applicable source-availability and notice requirements before publishing.


## Experience icons

The additional icons shared by the application and experience in `apps/web/src/icons/supplemental.json` are unmodified SVG paths retrieved through Iconify:

- Solar by [480 Design](https://www.figma.com/@480design), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); [collection and source attribution](https://icon-sets.iconify.design/solar/).
- Fluent UI System Icons by Microsoft Corporation, under [MIT](https://github.com/microsoft/fluentui-system-icons/blob/main/LICENSE).

The Fluent icon license is reproduced in the static experience as `/fluent-icons-license.txt`. The experience also includes this notices file and the project license as plain-text assets.

## Historical source notice

The original mailbox baseline carried the following notice. It is retained here for any surviving portions derived from that baseline, separately from independently authored FlareMail code. The maintainer reports extensive independent reconstruction; this notice does not claim that a source-provenance comparison has been completed.

The MIT License (MIT)

Copyright (c) 2025 eoao

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.