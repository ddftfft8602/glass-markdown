import { normalizeNoteSpacers } from './footnote-editing.js';

// With selected text, history must not split live nodes or reverse the range.
// Place the caret marker in the detached snapshot instead of the editable DOM.
window.glassCloneHistory = pane => {
  const clone = pane.cloneNode(true), selection = getSelection();
  if (!selection?.rangeCount || pane.querySelector('wbr')) return clone;
  const range = selection.getRangeAt(0), source = range.startContainer;
  const element = source.nodeType === 1 ? source : source.parentElement;
  if (!pane.contains(source) || element?.closest('.cm-editor')) return clone;
  const path = [];
  for (let node = source; node !== pane; node = node.parentNode) path.unshift([...node.parentNode.childNodes].indexOf(node));
  let target = clone;
  for (const index of path) target = target.childNodes[index];
  const marker = document.createElement('span'); marker.className = 'vditor-wbr';
  const caret = document.createRange(); caret.setStart(target, range.startOffset); caret.collapse(true); caret.insertNode(marker);
  return clone;
};

// Keep rendering state out of history. This runs on the detached history clone,
// never on the editable document, including the engine's initial snapshot.
window.glassNormalizeHistory = root => {
  // A caret between root blocks is tracked by edit-history's separate
  // bookmark. Parsing a root <wbr> on redo would create a phantom paragraph.
  root.querySelectorAll(':scope > wbr,:scope > .vditor-wbr').forEach(node=>node.remove());
  normalizeNoteSpacers(root);
  root.querySelectorAll('[data-glass-note-origin]').forEach(node => node.removeAttribute('data-glass-note-origin'));
  root.querySelectorAll('.glass-text-note,[data-type="footnotes-ref"]').forEach(node => {
    for (const name of ['tabindex', 'role', 'aria-label']) node.removeAttribute(name);
  });
  // Deferred decoration and popup focus must not become a second undo step
  // after deleting note wording. Normalize both our UI and native caret UI.
  root.querySelectorAll('[style*="--vditor-block-marker-top"]').forEach(node => {
    node.style.removeProperty('--vditor-block-marker-top');
    if (!node.getAttribute('style')) node.removeAttribute('style');
  });
  root.querySelectorAll('.vditor-block-handle-target,.glass-active-block,.glass-caret-heading,.glass-caret-format,.glass-caret-node,.glass-text-note,.glass-text-note-ref,.glass-note-open,.vditor-heading--active,.vditor-ir__node--expand').forEach(node => {
    node.classList.remove('vditor-block-handle-target', 'glass-active-block', 'glass-caret-heading', 'glass-caret-format', 'glass-caret-node',
      'glass-text-note', 'glass-text-note-ref', 'glass-note-open', 'vditor-heading--active', 'vditor-ir__node--expand');
    if (!node.className) node.removeAttribute('class');
  });
  root.querySelectorAll('.vditor-cm-host:empty').forEach(node => node.removeAttribute('style'));
  // Removing the active paragraph class can leave class="" behind after a
  // list operation. Empty styling attributes are not a separate document edit.
  root.querySelectorAll('[class=""]').forEach(node => node.removeAttribute('class'));
  root.querySelectorAll('.vditor-wysiwyg__preview,.vditor-ir__preview').forEach(preview => {
    const math = preview.querySelector('.language-math');
    if (!math) return;
    const block = preview.parentElement;
    const source = block.querySelector(':scope > code[data-type="math-inline"],:scope > pre:not(.vditor-wysiwyg__preview):not(.vditor-ir__preview) > code');
    if (!source) return;
    // A pending preview may not have data-math yet. Always use the actual source,
    // so asynchronous typesetting cannot become a spurious document edit.
    math.textContent = source.textContent.replace(/\u200b/g, '').replace(/\$([^$\n]+)\$/g, '$1').trimEnd();
    math.removeAttribute('data-math');
    preview.setAttribute('data-render', '2');
  });
};

// KaTeX output is pure for ordinary formulas. Bound both entry count and total
// size, and exclude commands that may define macros as a rendering side effect.
const mathCache = new Map();
let mathBytes = 0;
window.glassRenderMath = (source, options) => {
  // Compat prepare() used to wrap TeX groups as ($...$). Bare $ is invalid in
  // KaTeX math mode; strip those flanking pairs from already-math source.
  if (source.includes('$')) source = source.replace(/\$([^$\n]+)\$/g, '$1');
  let key;
  if (!/\\(?:gdef|global|def|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand)\b/.test(source)) {
    try {
      key = JSON.stringify([window.katex.version, source, options], (_key, value) => {
        if (typeof value === 'function') throw new Error('Dynamic macro');
        return value;
      });
    } catch { /* Dynamic options use the native renderer. */ }
  }
  if (key && mathCache.has(key)) {
    const html = mathCache.get(key); mathCache.delete(key); mathCache.set(key, html); return html;
  }
  const html = window.katex.renderToString(source, options);
  if (key && 2 * (key.length + html.length) <= 262144) {
    mathCache.set(key, html); mathBytes += 2 * (key.length + html.length);
    while (mathCache.size > 256 || mathBytes > 2 * 1024 * 1024) {
      const oldest = mathCache.keys().next().value;
      mathBytes -= 2 * (oldest.length + mathCache.get(oldest).length); mathCache.delete(oldest);
    }
  }
  return html;
};

// During an IR paragraph replacement, move unchanged formula previews into the
// new detached fragment before attaching it. Keep their DOM and copy listeners,
// not just cached HTML, and never replace the editable source/caret marker.
window.glassCollectMath = root => {
  const pool = new Map();
  root.querySelectorAll('.vditor-ir__preview > .language-math[data-math]').forEach(node => {
    if (!node.querySelector('.katex')) return;
    const key = node.tagName + ':' + node.dataset.math;
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(node);
  });
  return pool;
};
window.glassReuseMathHTML = (html, pool) => {
  const template = document.createElement('template'); template.innerHTML = html;
  if (pool?.size) template.content.querySelectorAll('.vditor-ir__preview > .language-math:not([data-math])').forEach(node => {
    if (node.querySelector('wbr')) return;
    const key = node.tagName + ':' + node.textContent.replace(/\u00a0/g, ' ');
    const previous = pool.get(key)?.shift();
    if (!previous) return;
    node.parentElement.setAttribute('data-render', '1'); node.replaceWith(previous);
  });
  return template.content;
};

export function installEditorPerformance(editor) {
  const state = editor.vditor, undo = state.undo, original = undo.recordFirstPosition;
  const edited = new WeakSet();
  undo.recordFirstPosition = function(context, event) {
    const first = this[context.currentMode].undoStack[0];
    if (first && edited.has(first)) return;
    return original.call(this, context, event);
  };
  const input = event => {
    if (event.target.closest?.('.cm-editor') || !state[state.currentMode]?.element.contains(event.target)) return;
    const history = undo[state.currentMode];
    if (history?.undoStack.length === 1 && history.undoStack[0].length) edited.add(history.undoStack[0]);
  };
  state.element.addEventListener('input', input, true);
  window.addEventListener('pagehide', () => state.element.removeEventListener('input', input, true), { once: true });
}
