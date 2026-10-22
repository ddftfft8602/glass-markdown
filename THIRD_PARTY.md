# Third-party provenance

This is an independent local derivative, not an official Office Viewer release.

| Component | Version / source | License |
| --- | --- | --- |
| Office Viewer Markdown host files and bundled Vditor | Installed `cweijan.vscode-office` 4.2.0 distribution; upstream https://github.com/cweijan/vscode-office | MIT; `licenses/office-viewer-MIT.txt` |
| Vditor / Lute | Bundled editor and Markdown parser; upstream https://github.com/Vanessa219/vditor and https://github.com/88250/lute | MIT |
| CodeMirror / Lezer | Bundled into the editor; https://codemirror.net/ | MIT |
| KaTeX | Packaged editor assets; https://github.com/KaTeX/KaTeX | MIT |
| Mermaid | Packaged editor assets; https://github.com/mermaid-js/mermaid | MIT |
| Markmap and D3 | Packaged editor assets; https://github.com/markmap/markmap and https://github.com/d3/d3 | MIT / ISC; retain bundled notices |
| highlight.js | Office Viewer bundled `highlight.js.js`, browser wrapper added; https://github.com/highlightjs/highlight.js | BSD-3-Clause |
| vscode-html-to-docx | Office Viewer bundled renderer; https://www.npmjs.com/package/vscode-html-to-docx | See distribution notices retained in the bundle |
| Playwright Core | Copied from the available workspace runtime; https://github.com/microsoft/playwright | Apache-2.0; full LICENSE/NOTICE and ThirdPartyNotices retained in `vendor/playwright-core` |

The public repository tree used for reference was commit `908258dafc827ce0475fe7671d414914fbd3867b`. The shipped editor resources are from the installed 4.2.0 distribution, not a claim that all Pro TypeScript source exists in that public commit.

Local changes: independent VS Code document adapter, fixed translucent syntax markers, raw source view, self-contained export pipeline, offline highlighting for Markmap, diagram refresh, first-edit undo initialization, and removal of server/account integration. The standalone host enables the MIT-distributed component's local feature options. No official activation service or license key is used.

Original bundled license comments and notices have been retained. `scripts/package.py` includes the bundled runtime resources so rebuilding the delivered extension does not require downloading the upstream repository.

Version 0.2.0 adds the compact toolbar, context-menu UI and clipboard host adapter. Its baseline was recovered from the installed local-glass.glass-markdown 0.1.0 extension.

Version 0.3.0 adds caret-based syntax hints and compact typography. Version 0.4.0 adds `compatibility.js` around the parser, scoped pending-math preview refresh, and the requested default-editor association. Two color-toolbar ancestor helpers in `media/markdown/dist/index.min.js` were patched to accept a text-node selection by starting from its parent element; this prevents a `classList.contains` error after insertion/undo. The bundled editor's original license notices remain intact.

Version 0.4.1 adds `links.js`, citation-only presentation rules and host callback changes for local fragment navigation and missing-target feedback. The bundled parser and editor bundle are unchanged in this version.

Version 0.4.2 adds `editor-interactions.js` to preserve math editor focus across readonly header clicks and forward Alt+arrow tab switching. Compact context-menu copy now preserves CodeMirror line breaks. No additional changes were made to the bundled editor/parser binaries.

Version 0.4.3 patches the bundled editor's math display mode and source editor lifecycle: reuse unchanged previews, build nested source views while detached, avoid redundant selection/contenteditable writes, and skip full-document synchronization when source is unchanged. Changed source synchronizes once. Those replacements were produced with exact-match guards. The patch script (`scripts/patch-editor.cjs`) is not included in this public tree; the patched bundle in `media/markdown/dist/index.min.js` is what this repository ships. `glass.css` removes the code-block background only from rendered math fences. Inline math, source delimiters, and third-party license notices are preserved.

Version 0.4.4 adds one scoped CSS rule to remove the invisible source PRE of a closed math fence from IR layout. This prevents a zero-size inline-block from generating a blank line. The bundled engine/parser remains identical to 0.4.3.

Version 0.4.5 adds table selection serialization and portable Markdown/HTML clipboard payloads in `table-clipboard.js`, and replaces the pending-math preview timer with a coalesced microtask in `compatibility.js`. The bundled native engine is unchanged from 0.4.3.
