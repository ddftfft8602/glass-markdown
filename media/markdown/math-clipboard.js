// A selection can begin in KaTeX or IR source markers, beyond the full formula.
// Include that whole formula in the clipboard clone without moving the user's
// selection. The native copy converter then retains both TeX and selected prose.
window.glassMathClipboardRange = range => {
  const copy = range.cloneRange();
  const formula = node => {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    let block = element?.closest('.vditor-wysiwyg__preview,.vditor-ir__preview')?.parentElement ||
      element?.closest('[data-type="inline-node"],[data-type="math-inline"]');
    if (block?.matches('code[data-type="math-inline"]')) block = block.parentElement;
    return block?.querySelector(':scope > code[data-type="math-inline"],:scope > pre > code.language-math') ? block : null;
  };
  const start = formula(copy.startContainer), end = formula(copy.endContainer);
  if (start && start !== end) copy.setStartBefore(start);
  if (end && start !== end) copy.setEndAfter(end);
  return copy;
};

// A range spanning LI siblings omits their OL/UL common ancestor. Keep that
// detached context so the converter preserves ordered-list numbering.
window.glassClipboardFragment = range => {
  const fragment = range.cloneContents(), ancestor = range.commonAncestorContainer;
  if (ancestor instanceof Element && ancestor.matches('ol,ul')) {
    const list = ancestor.cloneNode(false); list.append(fragment);
    const wrapped = document.createDocumentFragment(); wrapped.append(list); return wrapped;
  }
  return fragment;
};

export function mathClipboard(editor, range) {
  if (!range || range.collapsed || window.glassRawVisible) return null;
  const state = editor.vditor, pane = state[state.currentMode]?.element;
  if (!pane?.contains(range.commonAncestorContainer)) return null;
  const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  if (element.closest('.cm-editor')) return null;
  const box = document.createElement('div');
  box.append(window.glassClipboardFragment(window.glassMathClipboardRange(range)));
  if (!box.querySelector('code[data-type="math-inline"],[data-type="math-block"]')) return null;
  box.querySelectorAll('.vditor-cm-host,.vditor-wysiwyg__preview,.vditor-ir__preview,wbr').forEach(node => node.remove());
  const lute = state.lute;
  const text = (state.currentMode === 'ir' ? lute.VditorIRDOM2Md(box.innerHTML) : lute.VditorDOM2Md(box.innerHTML)).trim();
  box.innerHTML = lute.Md2HTML(text);
  box.querySelectorAll('.language-math').forEach(node => {
    const delimiter = node.tagName === 'DIV' ? '$$' : '$';
    node.replaceWith(document.createTextNode(delimiter + node.textContent + delimiter));
  });
  return {text, html:box.innerHTML};
}
