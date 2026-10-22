# Glass Markdown · 轻墨

A local Markdown editor for VS Code and Cursor. Extension id: `local-glass.glass-markdown`.

[English](#english) · [中文](#中文)

## English

### What it is

Glass Markdown edits Markdown on your machine. It is an independent extension built from the MIT-licensed Markdown / Vditor files that ship with Office Viewer 4.2.0. Office Viewer can stay installed; this extension has its own id and display name.

Headings are set apart by size, weight, and spacing, and they scale with the body font size. The pale `#` marker, and the markers for bold, italic, strikethrough, and inline code, show only while the caret is inside that text. Those hints stay out of the Markdown file. Marker opacity is fixed.

### Install

Install the packaged extension from the GitHub release.

1. Open the [v0.4.28 release](https://github.com/ddftfft8602/glass-markdown/releases/tag/v0.4.28) and download [`glass-markdown-0.4.28.vsix`](https://github.com/ddftfft8602/glass-markdown/releases/download/v0.4.28/glass-markdown-0.4.28.vsix).
2. In VS Code or Cursor, run **Extensions: Install from VSIX…**.
3. Select `glass-markdown-0.4.28.vsix`, then run **Developer: Reload Window**.
4. The first launch associates `.md`, `.markdown`, and `.mdown` with **Glass Markdown · 轻墨**. Open a Markdown file to enter the editor.
5. If a Markdown tab was already open, close it and open the file again. A workspace or per-file editor association still wins. Change it from the tab’s **Reopen With → Configure default editor**.

The default association is written once. A later manual choice is left in place. Run **Glass Markdown: 设为默认 Markdown 编辑器** to apply the association again. **Reopen With** can still open the text editor.

### Features

- WYSIWYG, instant render, and a separate Markdown source view.
- Headings, bold, italic, strikethrough, links, quotes, lists, tasks, tables, code blocks, undo/redo, and find/replace.
- Outline, block drag, table editing, footnotes and text notes, YAML front matter, and local WikiLinks.
- Font, size, line height, paragraph spacing, page width, light and dark themes, code themes, and typewriter mode.
- Font color, highlight, image size, and drag-to-resize.
- Paste, drop, or pick images. They are saved in an `assets` folder next to the Markdown file.
- KaTeX math, Mermaid diagrams, Markmap mind maps, a local WikiLink graph, and SVG export.
- Local HTML, PDF, and DOCX export, with outline, fonts, theme, and PDF page size and margins.
- Optional paste-time recognition of LaTeX that has no dollar delimiters (off by default: gear menu → formula recognition).
- Formula source search, caret-scoped syntax markers, a collapsible toolbar, and a compact context menu.
- `Ctrl+S` save, `Ctrl+B` bold, `Ctrl+F` find, and `Ctrl+Alt+E` back to the VS Code text editor.
- No account, subscription, activation service, or telemetry. The editor runtime is bundled in the extension.

Version history is in [`CHANGELOG.md`](CHANGELOG.md).

### Performance notes

On a ~171 KB sample document with 515 inline formulas, the longest main-thread task after typing in WYSIWYG mode dropped from 1568 ms to 241 ms, and the median instant-render input response dropped from 241 ms to 164 ms. On a ~61 KB sample document, six runs in each editing mode showed the median time from expanding a formula to the following paint frame drop from about 306 ms / 434 ms to 193 ms / 259 ms. The runs used the real editor page and a simulated VS Code message host. Input response is the time from the key event to the second animation frame. Results vary with machine, document, and load. Very long documents can still pause briefly.

### Offline scope

This release edits Markdown. Excel, Word, and PDF editing from Office Viewer, and a Git workspace, are outside this extension.

AI rewrite, remote image-host upload, and PlantUML rendering that needs a server are outside the offline feature set. Use a local image or a data URI; remote images stay as links and are left on the network. Local resources must be in the document directory or the opened workspace.

Export uses a local Edge or Chrome and does not download a browser. If detection fails, set `glassMarkdown.chromiumPath`. HTML, PDF, and DOCX export all use that browser so formulas and diagrams are laid out locally. In DOCX, formulas and diagrams become images; text, headings, and tables stay editable. There is no native Word equation object.

The WikiLink graph reads at most 2,000 Markdown files in the current workspace. Saving an edit can normalize some Markdown. Opening a file and leaving it unedited does not write it back. When an external change conflicts, local edits stay in a separate unsaved document. The line-break arrow in the editor is a hint for the current paragraph.

### Build and development

The extension runs without an npm install. This tree has the editable JS/CSS for the extension and the third-party runtime assets it loads. Those third-party files are the packaged builds used at runtime. Licenses and versions are in [`THIRD_PARTY.md`](THIRD_PARTY.md).

```text
npm run check
npm test
npm run package
python3 scripts/package.py
python scripts/package.py
```

- `npm run check` runs `node --check` on the extension sources.
- `npm test` prints a short notice and exits successfully. The Playwright harness is absent from this public tree, so the script does not launch `node test/...`.
- `npm run package` builds a VSIX with [`scripts/package.py`](scripts/package.py) (Python 3 standard library). `python3 scripts/package.py` is the direct command. On Windows, `python scripts/package.py` is the same script when `python` is Python 3.
- When npm can reach the registry, `npx @vscode/vsce package` is the preferred packager. `scripts/package.py` is the offline helper. It writes the vsce archive layout (`extension/` prefix, `extension.vsixmanifest`, `[Content_Types].xml`) and skips `.git`, `node_modules`, VSIX outputs, and similar junk.

Historical notes for the 0.4.5 table-copy and formula-preview fixes are in [`验证说明.md`](验证说明.md) (Chinese and English), using generic repro samples. Check the extension in VS Code as well.

### License

MIT. See [`LICENSE`](LICENSE) and [`THIRD_PARTY.md`](THIRD_PARTY.md). The upstream Office Viewer / Vditor MIT notice stays in [`licenses/office-viewer-MIT.txt`](licenses/office-viewer-MIT.txt).

## 中文

### 这是什么

轻墨在本机编辑 Markdown，可用于 VS Code 和 Cursor。扩展 ID：`local-glass.glass-markdown`。它基于 Office Viewer 4.2.0 随附、MIT 许可的 Markdown / Vditor 文件制作，是独立扩展。原来的 Office Viewer 可以继续保留；此插件使用自己的 ID 和显示名称。

标题通过字号、字重和留白区分层级，并随正文字号同步缩放。浅灰 `#`，以及加粗、斜体、删除线和行内代码的标记，只在光标位于对应文字时显示。这些提示不写入 Markdown 文件。标记透明度固定。

### 安装

从 GitHub Release 安装已经打包好的 VSIX。

1. 打开 [v0.4.28 发布页](https://github.com/ddftfft8602/glass-markdown/releases/tag/v0.4.28)，下载 [`glass-markdown-0.4.28.vsix`](https://github.com/ddftfft8602/glass-markdown/releases/download/v0.4.28/glass-markdown-0.4.28.vsix)。
2. 在 VS Code 或 Cursor 中执行 **扩展：从 VSIX 安装…**（Extensions: Install from VSIX…）。
3. 选择 `glass-markdown-0.4.28.vsix`，然后执行 **开发人员：重新加载窗口**（Developer: Reload Window）。
4. 首次启动会把 `.md`、`.markdown`、`.mdown` 关联到 **Glass Markdown · 轻墨**。之后打开 Markdown 文件即可进入编辑器。
5. 如果升级前标签已经打开，请关闭后再打开一次。工作区或单个文件自己的编辑器关联优先级更高，可在标签的“重新打开方式 → 配置默认编辑器”中调整。

默认关联只写入一次。之后手动选择其他编辑器时，启动不会把它改回来。需要重新设置时，执行 **Glass Markdown: 设为默认 Markdown 编辑器**。仍可从“重新打开方式”打开文本编辑器查看源码。

### 功能概要

- 所见即所得、即时渲染，以及独立的 Markdown 源码视图。
- 标题、粗体、斜体、删除线、链接、引用、列表、任务列表、表格、代码块、撤销重做、查找替换。
- 目录、块拖动、表格操作、脚注与文字备注、YAML front matter、本地 WikiLink 跳转。
- 字体、字号、行距、段间距、页面宽度、浅色/深色主题、代码主题、打字机模式。
- 字体颜色和背景色、图片宽高与拖拽缩放。
- 粘贴、拖入或选择图片，保存到 Markdown 文件旁的 `assets` 文件夹。
- KaTeX 数学公式、Mermaid 图表、Markmap 思维导图、本地 WikiLink 关系图与 SVG 导出。
- 本地 HTML、PDF、DOCX 导出，支持目录、字体、字号、主题和 PDF 纸张/页边距。
- 可选：粘贴时识别没有美元符号的 LaTeX（默认关闭；齿轮设置 → 公式识别）。
- 按源码搜索公式、跟随光标的语法标记、可收起工具栏和紧凑右键菜单。
- `Ctrl+S` 保存、`Ctrl+B` 加粗、`Ctrl+F` 查找；`Ctrl+Alt+E` 切回 VS Code 文本编辑器。
- 没有账号、订阅、激活服务和遥测。编辑器运行资源随插件打包。

版本记录见 [`CHANGELOG.md`](CHANGELOG.md)。

### 性能说明

在一份约 171 KB、含 515 处行内公式的示例文档上，所见即所得模式输入结束后的最长主线程任务从 1568 ms 降到 241 ms；即时渲染模式输入响应中位数从 241 ms 降到 164 ms。在一份约 61 KB 的示例文档上，两种编辑模式各测 6 次，公式展开到后续绘制帧的中位数从约 306 ms / 434 ms 降到 193 ms / 259 ms。测量使用真实编辑器页面和模拟的 VS Code 消息端。输入响应按按键到第二个动画帧近似。结果会随机器、文档和负载变化。超长文档仍可能短暂停顿。

### 离线范围

本版编辑 Markdown。Office Viewer 的 Excel、Word、PDF 编辑，以及 Git 工作区，不在这个扩展里。

AI 润色、远程图床上传、需要服务器的 PlantUML 渲染不在离线功能范围内。请使用本地图片或 data URI；在线图片保持为链接，扩展不会去下载它们。本地资源必须位于文档目录或打开的工作区内。

导出使用本机 Edge 或 Chrome，扩展本身不下载浏览器。找不到时，在 `glassMarkdown.chromiumPath` 中指定路径。HTML、PDF、DOCX 三种导出都使用该浏览器，以便在本地完成公式和图表排版。DOCX 里的公式和图表会变成图片；文字、标题和表格仍可编辑。没有 Word 原生公式对象。

WikiLink 关系图最多扫描当前工作区 2,000 个 Markdown 文件。编辑后保存时，编辑器可能规范化部分 Markdown。只打开、不编辑时不会写回文件。外部修改冲突时，本地编辑保留在单独的未保存文档里。编辑器中的换行箭头是当前段落的提示。

### 构建与开发

运行插件不需要 `npm install`。仓库包含本插件可编辑的 JS/CSS，以及运行时加载的第三方资源。这些第三方文件是运行时使用的打包结果。许可证和版本见 [`THIRD_PARTY.md`](THIRD_PARTY.md)。

```text
npm run check
npm test
npm run package
python3 scripts/package.py
python scripts/package.py
```

- `npm run check` 对扩展源码执行 `node --check`。
- `npm test` 打印一句说明并成功退出。完整 Playwright 测试套件不在这个公开仓库里，因此不会执行 `node test/...`。
- `npm run package` 用 [`scripts/package.py`](scripts/package.py) 打包 VSIX（仅 Python 3 标准库）。直接运行的命令是 `python3 scripts/package.py`。在 Windows 上，当 `python` 指向 Python 3 时，使用 `python scripts/package.py`。
- npm 可以访问注册表时，优先使用 `npx @vscode/vsce package`。`scripts/package.py` 是离线辅助脚本，按 vsce 的压缩包布局写入（`extension/` 前缀、`extension.vsixmanifest`、`[Content_Types].xml`），并跳过 `.git`、`node_modules`、VSIX 产物和类似的无关文件。

0.4.5 表格复制与公式预览的历史验证说明见 [`验证说明.md`](验证说明.md)（中英双语），复现材料是通用示例。请同时在 VS Code 里实际打开插件确认。

### 许可证

MIT。见 [`LICENSE`](LICENSE) 与 [`THIRD_PARTY.md`](THIRD_PARTY.md)。上游 Office Viewer / Vditor 的 MIT 声明保留在 [`licenses/office-viewer-MIT.txt`](licenses/office-viewer-MIT.txt)。
