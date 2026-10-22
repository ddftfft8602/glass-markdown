const elementOf = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;

// Chromium deletes hidden siblings at the edge of an editable text deletion.
// Inline math stores its TeX in such a sibling; Backspace can also temporarily
// hide its preview. Use the browser's exact range, without its extra cleanup.
export function deleteTextBesideMath(state, range, inputType) {
  if (state.currentMode !== 'wysiwyg' || !range || range.collapsed || window.glassRawVisible) return false;
  const pane = state.wysiwyg.element;
  if (!pane.contains(range.startContainer) || !pane.contains(range.endContainer) || pane.getAttribute('contenteditable') !== 'true') return false;
  const start = elementOf(range.startContainer), end = elementOf(range.endContainer);
  const syntax = '[data-type="math-inline"],.vditor-wysiwyg__preview,.cm-editor,pre:not(.vditor-reset),[contenteditable="false"]';
  if (start.closest(syntax) || end.closest(syntax)) return false;
  const block = start.closest('p,h1,h2,h3,h4,h5,h6,li,td,th');
  if (!block || block !== end.closest('p,h1,h2,h3,h4,h5,h6,li,td,th')) return false;
  const formulas = [...block.querySelectorAll('span[data-type="math-inline"]')];
  if (!formulas.length || formulas.some(node => range.intersectsNode(node))) return false;
  state.undo.recordFirstPosition(state, {key:'Delete'});
  range.deleteContents(); range.collapse(true);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  pane.dispatchEvent(new InputEvent('input', {bubbles:true, inputType}));
  return true;
}

export function installMathDeletion(editor) {
  const root = editor.vditor.element;
  const before = event => {
    if (event.defaultPrevented || !event.cancelable || event.isComposing || !/^delete/.test(event.inputType) || event.inputType === 'deleteByDrag') return;
    if (!editor.vditor.wysiwyg.element.contains(event.target) || elementOf(event.target).closest('.cm-editor')) return;
    const targets = event.getTargetRanges?.();
    if (targets?.length !== 1) return;
    const target = targets[0], range = document.createRange();
    range.setStart(target.startContainer,target.startOffset); range.setEnd(target.endContainer,target.endOffset);
    if (deleteTextBesideMath(editor.vditor,range,event.inputType)) event.preventDefault();
  };
  root.addEventListener('beforeinput',before,true);
  window.addEventListener('pagehide',()=>root.removeEventListener('beforeinput',before,true),{once:true});
}
