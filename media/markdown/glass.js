let previous;
let caretHeading;
let caretFormats = [];
let caretNodes = [];
export function installDiagramRefresh(editor) {
  const root = editor.vditor.element, pending = new Set();
  const selector = '.vditor-wysiwyg__preview .language-mermaid,.vditor-ir__preview .language-mermaid';
  let timer;
  const collect = scope => {
    if (!scope?.querySelectorAll) return;
    const nodes = [...scope.querySelectorAll(selector)];
    if (scope.matches?.(selector)) nodes.push(scope);
    for (const node of nodes) if (!node.querySelector('svg') && node.getAttribute('data-processed') !== 'true') pending.add(node);
  };
  const schedule = () => {
    if (!pending.size || timer) return;
    timer = setTimeout(() => {
      timer = 0;
      for (const node of pending) if (node.isConnected && !node.querySelector('svg')) {
        const preview = node.closest('.vditor-wysiwyg__preview,.vditor-ir__preview');
        if (preview) Vditor.mermaidRender(preview, editor.vditor.options.cdn, editor.vditor);
      }
      pending.clear();
    }, 180);
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target?.closest('svg')) continue;
      if (target?.matches(selector)) collect(target);
      for (const node of record.addedNodes) if (node.nodeType === 1) collect(node);
    }
    schedule();
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  collect(root); schedule();
  window.addEventListener('pagehide', () => { observer.disconnect(); clearTimeout(timer); pending.clear(); }, { once: true });
}
function updateCaretHints() {
  const selection = window.getSelection();
  const node = selection?.focusNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const pane = element?.closest('.vditor-wysiwyg .vditor-reset, .vditor-ir .vditor-reset');
  const editing = !!pane && !window.glassRawVisible && (document.activeElement === pane || pane.contains(document.activeElement));
  const block = editing ? element.closest('.vditor-reset > *') : null;
  if (block !== previous) {
    previous?.classList.remove('glass-active-block'); block?.classList.add('glass-active-block'); previous = block;
  }
  const heading = editing ? element.closest('h1,h2,h3,h4,h5,h6') : null;
  if (heading !== caretHeading) {
    caretHeading?.classList.remove('glass-caret-heading'); heading?.classList.add('glass-caret-heading'); caretHeading = heading;
  }
  const formats = [];
  if (editing) for (let current = element; current && current !== pane; current = current.parentElement) {
    if (current.matches('strong,em,s,del,code:not(pre > code)')) formats.push(current);
  }
  for (const item of caretFormats) if (!formats.includes(item)) item.classList.remove('glass-caret-format');
  for (const item of formats) item.classList.add('glass-caret-format');
  caretFormats = formats;
  const nodes = [];
  if (editing) for (let current = element; current && current !== pane; current = current.parentElement) {
    if (current.matches('.vditor-ir__node')) nodes.push(current);
  }
  for (const item of caretNodes) if (!nodes.includes(item)) item.classList.remove('glass-caret-node');
  for (const item of nodes) item.classList.add('glass-caret-node');
  caretNodes = nodes;
}
let caretFrame;
function scheduleCaretHints() {
  cancelAnimationFrame(caretFrame); caretFrame = requestAnimationFrame(updateCaretHints);
}
document.addEventListener('selectionchange', scheduleCaretHints);
document.addEventListener('focusin', scheduleCaretHints);
document.addEventListener('focusout', scheduleCaretHints);
document.addEventListener('input', scheduleCaretHints);
