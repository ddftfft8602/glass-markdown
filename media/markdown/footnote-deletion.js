let pending;
const labelOf = ref => (ref.dataset.footnotesLabel || '').replace(/^\^/, '');
const hrefOf = link => link.getAttribute('href') ?? link.querySelector(':scope > .vditor-ir__marker--link')?.textContent;
export const matchesFootnoteDefinition = (node, label) => node.dataset.type === 'footnotes-li'
  ? node.dataset.marker?.replace(/^\^/, '') === label
  : node.dataset.type === 'footnotes-def' && node.textContent.startsWith(`[^${label}]:`);

export function deleteFootnote(editor, label, target) {
  const pane = editor.vditor[editor.vditor.currentMode]?.element;
  if (pending || window.glassRawVisible || !pane?.contains(target)) return;
  const top = pane.scrollTop, left = pane.scrollLeft;
  const range = document.createRange(); range.setStartAfter(target); range.collapse(true);
  pane.focus({preventScroll:true});
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  editor.vditor[editor.vditor.currentMode].range = range;
  pending = {label, pane};
  try {
    // Use the editor's existing insertion transaction to record one undo and
    // notify the host. The hook below consumes this placeholder before insert.
    editor.insertMarkdown('\u200b');
  } finally { pending = null; }
  pane.scrollTop = top; pane.scrollLeft = left;
}

window.glassDeleteFootnoteFragment = (_content, state, range) => {
  if (!pending) return false;
  const {label, pane} = pending;
  if (pane !== state[state.currentMode]?.element || !pane.contains(range.startContainer)) return false;
  // Match parsed nodes, not Markdown strings: examples in code, unrelated
  // labels, formatting, and the rest of a long document remain untouched.
  const refs = [...pane.querySelectorAll('[data-type="footnotes-ref"]')].filter(ref => labelOf(ref) === label);
  const links = [...pane.querySelectorAll('a[href], [data-type="a"]')].filter(link => hrefOf(link) === `#footnote:${label}`);
  const definitions = [...pane.querySelectorAll('[data-type="footnotes-li"], [data-type="footnotes-def"]')].filter(node => matchesFootnoteDefinition(node, label));
  // Unwrapping a link relocates its children and can move a live Range before
  // the label. Re-anchor after mutation using a real, serialization-free node.
  const caret = document.createTextNode('\u200b'); range.insertNode(caret);
  for (const link of links) {
    if (link.dataset.type === 'a') {
      link.querySelectorAll(':scope > .vditor-ir__marker').forEach(marker => marker.remove());
      link.querySelectorAll('.vditor-ir__link').forEach(span => span.replaceWith(...span.childNodes));
    }
    link.replaceWith(...link.childNodes);
  }
  refs.forEach(ref => ref.remove());
  definitions.forEach(definition => definition.remove());
  for (const block of pane.querySelectorAll('[data-type="footnotes-block"]')) {
    if (!block.querySelector('[data-type="footnotes-li"], [data-type="footnotes-def"]')) block.remove();
  }
  const numbers = new Map();
  for (const ref of pane.querySelectorAll('[data-type="footnotes-ref"]')) {
    const id = labelOf(ref);
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
    const display = state.currentMode === 'ir' ? ref.querySelector('.vditor-ir__marker--hide') : ref;
    if (display) display.textContent = numbers.get(id);
  }
  if (pane.contains(caret)) { range.setStart(caret,1); range.collapse(true); }
  else { range.selectNodeContents(pane.querySelector('p') || pane); range.collapse(true); }
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  state[state.currentMode].range = range;
  return true;
};
