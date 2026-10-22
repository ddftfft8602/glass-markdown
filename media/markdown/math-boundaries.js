import { deleteNoteText } from './footnote-editing.js';

const elementOf = node => node?.nodeType === 1 ? node : node?.parentElement;
const ignored = '.vditor-ir__marker,.glass-text-note-ref,wbr';
function visibleContent(fragment) {
  fragment.querySelectorAll(ignored).forEach(node => node.remove());
  return !!fragment.textContent.replace(/\u200b/g,'') || !!fragment.querySelector('img,br,[data-type="math-inline"]');
}
const formulas = block => [...block.querySelectorAll('code[data-type="math-inline"]')].map(code => code.parentElement);
const setRange = range => { const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); };

export function installMathBoundaries(editor) {
  const root = editor.vditor.element;
  let outsideClick = false, outsideRange, outsidePane;
  const onKey = event => {
    if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        !['Backspace','Delete'].includes(event.key) || window.glassRawVisible) return;
    const state = editor.vditor, pane = state[state.currentMode]?.element, selection = getSelection();
    if (!pane?.contains(event.target) || pane.getAttribute('contenteditable') !== 'true' || !selection?.isCollapsed || !selection.rangeCount ||
        elementOf(selection.anchorNode)?.closest('.cm-editor,code[data-type="math-inline"],[contenteditable="false"]')) return;
    const caret = selection.getRangeAt(0), block = elementOf(caret.startContainer)?.closest('p,h1,h2,h3,h4,h5,h6,li,td,th');
    if (!block || !pane.contains(block)) return;
    const backward = event.key === 'Backspace';
    const nodes = formulas(block); if (backward) nodes.reverse();
    for (const math of nodes) {
      if (math.contains(caret.startContainer)) continue;
      const edge = document.createRange(); edge.selectNode(math); edge.collapse(!backward);
      const order = edge.compareBoundaryPoints(Range.START_TO_START,caret);
      if (backward ? order > 0 : order < 0) continue;
      const gap = caret.cloneRange();
      if (backward) gap.setStart(edge.startContainer,edge.startOffset);
      else gap.setEnd(edge.startContainer,edge.startOffset);
      if (visibleContent(gap.cloneContents())) continue;
      const range = document.createRange(); range.selectNode(math);
      const inputType = backward ? 'deleteContentBackward' : 'deleteContentForward';
      event.preventDefault(); event.stopImmediatePropagation();
      if (!deleteNoteText(state,range,inputType)) {
        state.undo.recordFirstPosition(state,{key:event.key});
        range.deleteContents(); range.collapse(true); setRange(range);
        pane.dispatchEvent(new InputEvent('input',{bubbles:true,inputType}));
      }
      return;
    }
  };
  const onMouseDown = event => {
    outsideClick = false; outsideRange = outsidePane = null;
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || window.glassRawVisible) return;
    const state = editor.vditor, pane = state[state.currentMode]?.element;
    if (!pane?.contains(event.target) || pane.getAttribute('contenteditable') !== 'true' || elementOf(event.target)?.closest('.cm-editor,[contenteditable="false"]')) return;
    const block = elementOf(event.target)?.closest('p,h1,h2,h3,h4,h5,h6,li,td,th');
    if (!block) return;
    for (const math of formulas(block).reverse()) {
      const preview = math.querySelector('.vditor-wysiwyg__preview,.vditor-ir__preview');
      const rects = preview?.getClientRects(); const box = rects?.[rects.length-1];
      if (!box || event.clientY < box.top || event.clientY > box.bottom || event.clientX <= box.right+1) continue;
      const tail = document.createRange(); tail.selectNodeContents(block); tail.setStartAfter(math);
      if (visibleContent(tail.cloneContents())) continue;
      // The native click fallback uses the preview under the nearest caret,
      // even when the pointer is in blank space after the formula.
      let boundary = math;
      const note = math.closest('.glass-text-note');
      if (note) boundary = note.nextElementSibling?.matches('.glass-text-note-ref') ? note.nextElementSibling : note;
      let text = boundary.nextSibling;
      if (text?.nodeType !== Node.TEXT_NODE) { text = document.createTextNode('\u200b'); boundary.after(text); }
      const range = document.createRange(); range.setStart(text,text.data.startsWith('\u200b')?1:0); range.collapse(true);
      event.stopImmediatePropagation();
      pane.focus({preventScroll:true}); setRange(range); state[state.currentMode].range = range.cloneRange();
      queueMicrotask(()=>{if (range.startContainer.isConnected) {setRange(range);state[state.currentMode].range=range.cloneRange();}});
      outsideRange = range; outsidePane = pane;
      outsideClick = true; return;
    }
  };
  const onClick = event => {
    if (!outsideClick) return;
    outsideClick = false;
    event.preventDefault(); event.stopImmediatePropagation();
    // Native mousedown must start drag selection. A plain click can still
    // canonicalize the caret into the preview; fix only that collapsed caret.
    if (getSelection()?.isCollapsed && outsideRange?.startContainer.isConnected) {
      outsidePane.focus({preventScroll:true}); setRange(outsideRange);
      editor.vditor[editor.vditor.currentMode].range = outsideRange.cloneRange();
    }
    outsideRange = outsidePane = null;
  };
  root.addEventListener('keydown',onKey,true);
  root.addEventListener('mousedown',onMouseDown,true);
  root.addEventListener('click',onClick,true);
  window.addEventListener('pagehide',()=>{
    root.removeEventListener('keydown',onKey,true);
    root.removeEventListener('mousedown',onMouseDown,true);
    root.removeEventListener('click',onClick,true);
  },{once:true});
}
