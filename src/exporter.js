'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { escapeHtml, safeLocalPath } = require('./core');

function browserPath(custom) {
  const paths = [custom, process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'), process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const found = paths.find(p => p && fsSync.existsSync(p));
  if (!found) throw new Error('需要本地 Edge 或 Chrome。请在 glassMarkdown.chromiumPath 中设置浏览器路径。');
  return found;
}
const mime = file => ({ '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf' }[path.extname(file).toLowerCase()] || 'application/octet-stream');
async function dataUri(file) { return `data:${mime(file)};base64,${(await fs.readFile(file)).toString('base64')}`; }
async function exportDocument(options) {
  const { destination, extensionPath, type, documentPath, workspacePath } = options;
  const resource = path.join(extensionPath, 'media/markdown');
  const { chromium } = require('../vendor/playwright-core');
  const tempProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'glass-export-'));
  let browser;
  try {
    browser = await chromium.launchPersistentContext(tempProfile, { executablePath: browserPath(options.chromiumPath), headless: true, args: ['--disable-background-networking','--disable-extensions','--no-first-run'] });
    const page = await browser.newPage();
    await page.route('**/*', route => /^(data:|about:|blob:)/.test(route.request().url()) ? route.continue() : route.abort());
    let html = String(options.html || '');
    for (const match of [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]) {
      if (match[1].startsWith('data:')) continue;
      const file = safeLocalPath(match[1], documentPath, workspacePath);
      try { if (!file) throw new Error('Not local'); html = html.replace(match[0], match[0].replace(match[1], await dataUri(file))); }
      catch { html = html.replace(match[0], `<span class="missing-image">[图片未嵌入：${escapeHtml(match[1])}]</span>`); }
    }
    let katexCss = await fs.readFile(path.join(resource, 'dist/js/katex/katex.min.css'), 'utf8');
    for (const match of [...katexCss.matchAll(/url\(([^)]+)\)/g)]) {
      try { katexCss = katexCss.replace(match[0], `url("${await dataUri(path.join(resource, 'dist/js/katex', match[1].replace(/["']/g, '')))}")`); } catch {}
    }
    const layout = options.exportTheme?.layout || {};
    const fontSize = Math.min(48, Math.max(10, parseInt(layout.fontSize) || 16));
    const fontFamily = String(layout.fontFamily || 'Segoe UI, Microsoft YaHei, sans-serif').replace(/[;{}<>]/g, '');
    const nonce = crypto.randomBytes(16).toString('hex');
    const themeVariables = options.useExportTheme ? Object.entries(options.exportTheme?.cssVariables || {}).filter(([key,val]) => /^--[a-z-]+$/.test(key) && typeof val === 'string' && !/[;{}<>]|url\(/i.test(val)).map(([key,val]) => `${key}:${val}`).join(';') : '';
    const css = `:root{${themeVariables}}body{margin:0;color:var(--front-color,#242429);background:var(--bg-color,#fff);font-family:${fontFamily};font-size:${fontSize}px;line-height:1.75}article{max-width:900px;margin:auto;padding:32px}h1,h2,h3{line-height:1.4;page-break-after:avoid}pre{white-space:pre-wrap;background:var(--code-bg-color,#f6f6f9);color:var(--code-fg-color,inherit);padding:14px;border-radius:6px}code{font-family:Consolas,monospace}table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--table-border,#ddd);padding:8px}th{background:var(--table-header-bg,#f6f6f9)}blockquote{border-left:3px solid var(--blockquote-border,#ccc);padding-left:16px;color:var(--blockquote-color,#666)}img,svg{max-width:100%;height:auto}a{color:var(--link-color,#4e65a2)}strong{color:var(--bold-color,inherit)}nav{padding:16px;background:var(--second-bg-color,#f7f7fa)}nav a{display:block}.missing-image{color:#888;font-size:12px}.katex-display{overflow:auto}@media print{article{padding:0}pre,table,img{break-inside:avoid}}`;
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;"><title>${escapeHtml(options.title || 'Markdown')}</title><style>${css}\n${katexCss}</style></head><body><article>${html}</article></body></html>`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { document.querySelectorAll('article script,iframe,object,embed,form').forEach(n => n.remove()); document.querySelectorAll('article *').forEach(n => { for (const a of [...n.attributes]) if (/^on/i.test(a.name) || /^javascript:/i.test(a.value)) n.removeAttribute(a.name); }); });
    for (const file of ['dist/js/katex/katex.min.js', 'dist/js/mermaid/mermaid.min.js', 'dist/js/highlightjs/highlight.min.js']) {
      const code = await fs.readFile(path.join(resource, file), 'utf8');
      await page.evaluate(({ code, nonce }) => { const script = document.createElement('script'); script.nonce = nonce; script.textContent = code; document.head.append(script); }, { code, nonce });
    }
    await page.evaluate(async ({ withOutline }) => {
      for (const node of document.querySelectorAll('.language-math, .math, [data-type="math-inline"], [data-type="math-block"]')) {
        try { katex.render(node.textContent, node, { throwOnError: false, displayMode: node.tagName === 'DIV' || node.parentElement?.tagName === 'PRE' || node.dataset.type === 'math-block' }); } catch {}
      }
      if (window.mermaid) {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
        for (const code of document.querySelectorAll('code.language-mermaid')) { const d = document.createElement('div'); d.className = 'mermaid'; d.textContent = code.textContent; code.parentElement.replaceWith(d); }
        try { await mermaid.run({ querySelector: '.mermaid' }); } catch {}
      }
      if (window.hljs) for (const code of document.querySelectorAll('pre code:not(.language-math):not(.language-mermaid)')) hljs.highlightElement(code);
      if (withOutline) {
        const nav = document.createElement('nav');
        document.querySelectorAll('article h1,article h2,article h3').forEach((h, i) => { h.id ||= `section-${i}`; const a = document.createElement('a'); a.href = '#' + h.id; a.textContent = h.textContent; a.style.paddingLeft = (Number(h.tagName[1]) - 1) * 14 + 'px'; nav.append(a); });
        if (nav.childElementCount) document.querySelector('article').prepend(nav);
      }
      await document.fonts.ready;
    }, { withOutline: !options.withoutOutline });
    if (type === 'pdf') {
      const marginValue = Number(options.margin?.top ?? 18);
      const margin = Math.min(80, Math.max(0, Number.isFinite(marginValue) ? marginValue : 18));
      await page.pdf({ path: destination, format: ['A3','A4','A5','Letter','Legal','Tabloid'].includes(options.format) ? options.format : 'A4', printBackground: true, margin: { top: `${margin}mm`, bottom: `${margin}mm`, left:'18mm', right:'18mm' }, outline: true });
    } else {
      if (type === 'docx') {
        for (const node of await page.$$('.mermaid, .katex-display, .katex:not(.katex-display .katex)')) {
          const rect = await node.boundingBox();
          if (!rect || rect.width < 1 || rect.height < 1) continue;
          const png = await node.screenshot({ type:'png' });
          await node.evaluate((el, data) => { const img = document.createElement('img'); img.src = data.src; img.width = Math.round(data.width); el.replaceWith(img); }, { src:'data:image/png;base64,' + Buffer.from(png).toString('base64'), width:rect.width });
        }
      }
      await page.evaluate(() => { document.querySelectorAll('script,meta[http-equiv]').forEach(n => n.remove()); });
      const output = await page.content();
      if (type === 'docx') {
        const convert = require('../vendor/vscode-html-to-docx');
        const result = await convert(output, '', { font: fontFamily.split(',')[0], fontSize: fontSize * 1.5 }, '');
        await fs.writeFile(destination, Buffer.isBuffer(result) ? result : Buffer.from(await result.arrayBuffer()));
      } else await fs.writeFile(destination, output, 'utf8');
    }
  } finally {
    if (browser) await browser.close();
    if (path.basename(tempProfile).startsWith('glass-export-') && path.dirname(tempProfile) === os.tmpdir()) await fs.rm(tempProfile, { recursive:true, force:true, maxRetries:3 });
  }
}
module.exports = { exportDocument, browserPath };
