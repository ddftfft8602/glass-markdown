import { normalizeLatexDelimiters, normalizeRichLatexText } from './compatibility.js';

function richMarkdown(html, editor) {
  const template = document.createElement('template'); template.innerHTML = html;
  const formulas = [];
  let prefix = 'GLASSLATEXPASTETOKEN';
  while (html.includes(prefix)) prefix += 'X';
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT); let node;
  while (node = walker.nextNode()) {
    if (node.parentElement?.closest('pre,code,kbd,samp,script,style,textarea,a,.katex,math,[data-type="math-inline"],[data-type="math-block"]')) continue;
    node.data = normalizeRichLatexText(node.data, formula => {
      const token = prefix + formulas.length + 'END'; formulas.push({ token, formula }); return token;
    });
  }
  if (!formulas.length) return null;
  let markdown = editor.html2md(template.innerHTML);
  // The native HTML converter retains tables, lists and emphasis. Protect TeX
  // until afterwards so that it cannot escape the formula's backslashes.
  for (const { token, formula } of formulas) markdown = markdown.split(token).join(formula);
  return markdown;
}

const looksLikeTable = (html, text) =>
  /<table[\s>]/i.test(html || '') || /^\s*\|.+\|/m.test(text || '');

export function installLatexPaste(editor) {
  const paste = event => {
    if (event.defaultPrevented || window.glassRawVisible ||
        editor.exportViewerSettings().globalSettings?.recognizeLatexPaste !== true) return;
    const pane = editor.vditor[editor.vditor.currentMode]?.element;
    const selection = getSelection();
    if (!pane?.contains(event.target) || !selection?.rangeCount) return;
    const excluded = 'code,pre:not(.vditor-reset),textarea,input,.cm-editor,[contenteditable="false"],[data-type="math-inline"],[data-type="math-block"],[data-type="html-inline"],[data-type="html-block"]';
    for (const node of [event.target, selection.anchorNode, selection.focusNode]) {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      if (!element || !pane.contains(element) || element.closest(excluded)) return;
    }
    const data = event.clipboardData;
    if (!data || data.files.length) return;
    const text = data.getData('text/plain'), html = data.getData('text/html');
    // Table paste: cell fill, or merge into an adjacent table when the caret
    // sits on a blank line beside one. Avoid insertMarkdown empty-row / "||" gaps.
    if (looksLikeTable(html, text)) {
      if (window.glassPasteTableIntoCell?.(editor, html, text)) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
    }
    let normalized;
    if (html) {
      normalized = richMarkdown(html, editor);
      if (normalized === null) return;
    } else {
      normalized = normalizeLatexDelimiters(text);
      if (normalized === text) return;
    }
    // Table markdown with formulas must not be inserted as a pipe string into a cell
    // (or as a broken fragment on a blank line next to a table).
    if (looksLikeTable('', normalized)) {
      if (window.glassPasteTableIntoCell?.(editor, '', normalized)) {
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
    }
    event.preventDefault(); event.stopImmediatePropagation();
    editor.insertMarkdown(normalized);
  };
  window.addEventListener('paste', paste, true);
  window.addEventListener('pagehide', () => window.removeEventListener('paste', paste, true), { once: true });
}
