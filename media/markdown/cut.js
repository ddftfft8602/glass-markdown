import { deleteNoteText, protectNoteBoundaries } from './footnote-editing.js';
import { deleteTextBesideMath } from './math-deletion.js';

// VS Code may invoke document.execCommand('cut'). Chromium ignores a nested
// execCommand('delete') within that cut event. Finish the already-copied cut in
// the following task, after the browser's clipboard command has returned.
window.glassDeleteAfterCut = (state, range) => {
  const pane = state[state.currentMode]?.element;
  if (!range || range.collapsed || !pane?.contains(range.startContainer) || !pane.contains(range.endContainer)) return;
  const selected = range.toString();
  // Selection.toString() excludes hidden LaTeX, while Range.toString() includes
  // it. Compare DOM boundaries; comparing those strings cancels every math cut.
  setTimeout(() => {
    // Never remove different text if the document/selection changed while the
    // clipboard command was completing (e.g. an external document update).
    const selection = getSelection();
    if (!range.startContainer.isConnected || !range.endContainer.isConnected ||
        range.toString() !== selected || !selection?.rangeCount ||
        selection.getRangeAt(0).compareBoundaryPoints(Range.START_TO_START, range) !== 0 ||
        selection.getRangeAt(0).compareBoundaryPoints(Range.END_TO_END, range) !== 0 ||
        !pane.contains(selection.anchorNode) || !pane.contains(selection.focusNode)) return;
    if (deleteNoteText(state, range, 'deleteByCut')) return;
    if (deleteTextBesideMath(state, range, 'deleteByCut')) return;
    if (state.currentMode === 'ir') {
      const element = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      const selector = '.vditor-ir__node:is([data-type="strong"],[data-type="em"],[data-type="s"],[data-type="code"],[data-type="a"])';
      const format = element(range.startContainer)?.closest(selector);
      if (format && format.contains(range.endContainer)) {
        const before = range.cloneRange(), after = range.cloneRange();
        before.selectNodeContents(format); before.setEnd(range.startContainer, range.startOffset);
        after.selectNodeContents(format); after.setStart(range.endContainer, range.endOffset);
        const empty = fragment => {
          fragment.querySelectorAll('.vditor-ir__marker').forEach(node=>node.remove());
          return !fragment.textContent.replace(/\u200b/g,'') && !fragment.querySelector('img,br');
        };
        // Cutting all displayed text should also remove its now-empty syntax;
        // otherwise IR leaves literal **** where a bold phrase used to be.
        if (empty(before.cloneContents()) && empty(after.cloneContents())) range.selectNode(format);
      }
    }
    pane.focus({preventScroll:true}); selection.removeAllRanges(); selection.addRange(range);
    const release = protectNoteBoundaries(state, range);
    try { Document.prototype.execCommand.call(document, 'delete', false); }
    finally { release(); }
  }, 0);
};
