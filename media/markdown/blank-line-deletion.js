const elementOf = node => node?.nodeType === 1 ? node : node?.parentElement;
const boundary = node => node?.classList?.contains('vditor-editor-boundary');
const note = node => node?.matches?.('[data-type="footnotes-block"],[data-type="footnotes-def"]');
const emptyText = text => !text.replace(/\u200b/g,'').trim();
const blank = node => node?.tagName === 'P' && emptyText(node.textContent) &&
  !node.querySelector('img,code,iframe,hr,[data-type],input,svg,math') && node.querySelectorAll('br').length <= 1;
const sibling = (node, backward) => {
  let next = backward ? node.previousElementSibling : node.nextElementSibling;
  while (boundary(next)) next = backward ? next.previousElementSibling : next.nextElementSibling;
  return note(next) ? null : next;
};
function edge(node, backward) {
  if (node.nodeType === Node.TEXT_NODE) return node.data.replace(/\u200b/g,'') ? {node,offset:backward?node.length:0} : null;
  if (!(node instanceof Element) || node.matches('.vditor-ir__marker,.vditor-ir__preview,.vditor-wysiwyg__preview,.vditor-cm-host')) return null;
  if (node.matches('img,[data-type="footnotes-ref"],span[data-type="math-inline"]') || node.querySelector(':scope > code[data-type="math-inline"]')) {
    return {node:node.parentNode,offset:[...node.parentNode.childNodes].indexOf(node)+(backward?1:0)};
  }
  if (node.matches('[data-type="math-block"],[data-type="code-block"],table,[contenteditable="false"]')) return null;
  const children = [...node.childNodes]; if (backward) children.reverse();
  for (const child of children) { const found = edge(child,backward); if (found) return found; }
  return node.matches('p,h1,h2,h3,h4,h5,h6') ? {node,offset:0} : null;
}

// Delete a real empty paragraph before native block merging can enter formula
// source, strip a heading/list, or consume only the editor's end scaffold.
export function installBlankLineDeletion(editor) {
  const root = editor.vditor.element;
  const prepareInsertion = () => {
    // IME composition: never rescue caret or insert a paragraph mid-compose.
    if (window.glassImeComposing) return;
    const state = editor.vditor, pane = state[state.currentMode]?.element, selection = getSelection();
    if (window.glassRawVisible || pane?.getAttribute('contenteditable') !== 'true' || !selection?.isCollapsed || !selection.rangeCount) return;
    let range = selection.getRangeAt(0);

    // Hard rule: caret already inside a table cell → do nothing.
    // Never call rescue (it must not relocate), never insert a paragraph.
    const cellEl = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest?.('td,th');
    if (cellEl && pane.contains(cellEl)) return;

    // Only consider pane-level carets for table/math gap insertion.
    if (range.startContainer !== pane) return;

    // Pane@TABLE-before: try click-remembered cell via glassRescueTableCaret.
    // That helper never falls back to the first cell and never moves an
    // in-cell caret. If it cannot resolve a cell, open a paragraph *before*
    // the table so the keystroke is not lost above/into the table.
    if (typeof window.glassRescueTableCaret === 'function' && window.glassRescueTableCaret()) return;

    // Rescue may have changed the selection — re-read.
    if (!selection.rangeCount) return;
    range = selection.getRangeAt(0);
    if (range.startContainer !== pane) return;

    const at = pane.childNodes[range.startOffset];
    const before = range.startOffset > 0 ? pane.childNodes[range.startOffset - 1] : null;
    const blocked = node => node?.nodeType === 1 && (
      node.tagName === 'TABLE' ||
      node.tagName === 'PRE' ||
      node.getAttribute?.('data-type') === 'math-block' ||
      node.getAttribute?.('data-type') === 'code-block' ||
      node.getAttribute?.('data-type') === 'footnotes-block'
    );

    // Caret on the pane right after a TABLE: insert a fresh paragraph so typing
    // below the table never lands inside it.
    if (before?.nodeType === 1 && before.tagName === 'TABLE' && !(at?.nodeType === 1 && at.tagName === 'TABLE')) {
      const paragraph = document.createElement('p'); paragraph.dataset.block = '0';
      const text = document.createTextNode('\u200b'); paragraph.append(text);
      if (at) pane.insertBefore(paragraph, at); else pane.append(paragraph);
      range.setStart(text, 1); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
      state[state.currentMode].range = range.cloneRange();
      return;
    }

    // Pane@TABLE-before and rescue could not resolve a cell: paragraph before
    // the table (visible) instead of dumping into cell (0,0) or eating the char.
    if (at?.nodeType === 1 && at.tagName === 'TABLE') {
      const paragraph = document.createElement('p'); paragraph.dataset.block = '0';
      const text = document.createTextNode('\u200b'); paragraph.append(text);
      pane.insertBefore(paragraph, at);
      range.setStart(text, 1); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
      state[state.currentMode].range = range.cloneRange();
      return;
    }

    if (blocked(at) || blocked(before)) return;
    const paragraph = document.createElement('p'); paragraph.dataset.block = '0';
    const text = document.createTextNode('\u200b'); paragraph.append(text); range.insertNode(paragraph);
    range.setStart(text,1); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
    state[state.currentMode].range = range.cloneRange();
  };
  const remove = backward => {
    const state = editor.vditor, pane = state[state.currentMode]?.element, selection = getSelection();
    if (!pane || pane.getAttribute('contenteditable') !== 'true' || !selection?.isCollapsed || !selection.rangeCount || window.glassRawVisible) return false;
    const caret = selection.getRangeAt(0), element = elementOf(caret.startContainer);
    if (!pane.contains(element) || element.closest('.cm-editor,[contenteditable="false"]')) return false;
    let current = element;
    while (current !== pane && current.parentElement !== pane) current = current.parentElement;
    let target;
    if (blank(current)) target = current;
    else if (boundary(current)) {
      const adjacent = sibling(current,backward); if (blank(adjacent)) target = adjacent;
    } else if (current.matches('p,h1,h2,h3,h4,h5,h6')) {
      const gap = caret.cloneRange();
      if (backward) gap.setStart(current,0); else gap.setEnd(current,current.childNodes.length);
      const copy = gap.cloneContents(); copy.querySelectorAll('.vditor-ir__marker,[data-type="heading-marker"],wbr').forEach(node=>node.remove());
      if (emptyText(copy.textContent) && !copy.querySelector('img,br,[data-type="math-inline"],[data-type="footnotes-ref"]')) {
        const adjacent = sibling(current,backward); if (blank(adjacent)) target = adjacent;
      }
    }
    if (!target) return false;
    const previous = sibling(target,true), next = sibling(target,false);
    // The single empty document remains an editable paragraph.
    if (!previous && !next) return true;
    let point;
    if (target !== current && !boundary(current)) point = {node:caret.startContainer,offset:caret.startOffset};
    else point = edge(backward ? previous || next : next || previous,backward && !!previous) ||
      (previous && edge(previous,true)) || (next && edge(next,false));
    state.undo.recordFirstPosition(state,{key:backward?'Backspace':'Delete'});
    const range = document.createRange();
    if (point) range.setStart(point.node,point.offset);
    else range.setStartBefore(target);
    range.collapse(true); target.remove();
    selection.removeAllRanges(); selection.addRange(range); state[state.currentMode].range = range.cloneRange();
    // This is already a balanced block removal. Native normalization at a
    // root/scaffold caret would manufacture another empty paragraph in IR.
    if (!point) state[state.currentMode].preventInput = true;
    pane.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:backward?'deleteContentBackward':'deleteContentForward'}));
    return true;
  };
  const compositionInput = event =>
    !!event?.isComposing || !!window.glassImeComposing ||
    event?.inputType === 'insertCompositionText' ||
    event?.inputType === 'insertFromComposition' ||
    event?.inputType === 'deleteCompositionText';
  const key = event => {
    if (!event.defaultPrevented && !event.isComposing && !window.glassImeComposing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.length===1 &&
        editor.vditor[editor.vditor.currentMode]?.element.contains(event.target)) prepareInsertion();
    if (event.defaultPrevented || event.isComposing || window.glassImeComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !['Backspace','Delete'].includes(event.key)) return;
    if (editor.vditor[editor.vditor.currentMode]?.element.contains(event.target) && remove(event.key==='Backspace')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const input = event => {
    // insertCompositionText also starts with "insert" — must not prepareInsertion
    // or rescueCaret during IME or the candidate commit is wiped.
    if (event.defaultPrevented || compositionInput(event)) return;
    if (!event.inputType?.startsWith('insert') || !editor.vditor[editor.vditor.currentMode]?.element.contains(event.target)) return;
    prepareInsertion();
  };
  root.addEventListener('keydown',key,true);
  root.addEventListener('beforeinput',input,true);
  window.addEventListener('pagehide',()=>{root.removeEventListener('keydown',key,true);root.removeEventListener('beforeinput',input,true);},{once:true});
}
