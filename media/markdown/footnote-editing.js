const elementOf = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
const empty = text => !text.replace(/\u200b/g, '');
const refSelector = '[data-type="footnotes-ref"]';
const inlineMath = node => node instanceof Element && (node.matches('span[data-type="math-inline"]') ||
  node.matches('.vditor-ir__node') && node.querySelector(':scope > code[data-type="math-inline"]'));

function visibleEdge(parent, backward) {
  const children = [...parent.childNodes]; if (backward) children.reverse();
  for (const node of children) {
    if (node.nodeType === Node.TEXT_NODE) { if (!empty(node.data)) return node; }
    else if (node instanceof Element && !node.matches('.vditor-ir__marker,.vditor-ir__preview,.vditor-wysiwyg__preview,.vditor-cm-host')) {
      if (inlineMath(node) || node.matches('img,br')) return node;
      const found = visibleEdge(node,backward); if (found) return found;
    }
  }
}

function setVisibleEdge(range, link, backward) {
  const node = visibleEdge(link,backward); if (!node) return false;
  if (node.nodeType === Node.TEXT_NODE) range.setStart(node,backward?node.length:0);
  else if (backward) range.setStartAfter(node); else range.setStartBefore(node);
  range.collapse(true);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  return true;
}

function skipNoteSyntax(range, backward) {
  const element = elementOf(range.startContainer), ref = element?.closest(refSelector);
  let link = ref ? noteLink(ref) : element?.closest('a[href],[data-type="a"]');
  if (!link) return false;
  let companion = link.nextSibling;
  while (companion?.nodeType === Node.TEXT_NODE && empty(companion.data)) companion = companion.nextSibling;
  if (noteLink(companion) !== link) return false;
  const marker = element?.closest('.vditor-ir__marker');
  if (!ref && (!marker || marker.parentElement !== link)) return false;
  const beforeLabel = !ref && !marker.previousElementSibling;
  if (backward !== beforeLabel) return setVisibleEdge(range,link,backward);
  if (beforeLabel) range.setStartBefore(link); else range.setStartAfter(companion);
  range.collapse(true);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  return true;
}
function noteLink(ref) {
  if (!(ref instanceof Element) || !ref.matches(refSelector)) return null;
  let link = ref.previousSibling;
  while (link?.nodeType === Node.TEXT_NODE && empty(link.data)) link = link.previousSibling;
  const href = link instanceof Element && (link.getAttribute('href') ?? link.querySelector(':scope > .vditor-ir__marker--link')?.textContent);
  return href === `#footnote:${ref.dataset.footnotesLabel?.replace(/^\^/, '')}` ? link : null;
}

export function removeNoteSpacer(ref) {
  if (!noteLink(ref)) return;
  // The engine appends ZWSP after references as a caret scaffold. For hidden
  // text-note references it creates a phantom character at the visible end.
  // Keep empty text nodes (and live ranges), removing only that leading scaffold.
  for (let node = ref.nextSibling; node?.nodeType === Node.TEXT_NODE; node = node.nextSibling) {
    const count = node.data.match(/^\u200b+/)?.[0].length || 0;
    if (count) node.deleteData(0, count);
    if (node.data) break;
  }
}

export function normalizeNoteSpacers(root) {
  root.querySelectorAll(refSelector).forEach(removeNoteSpacer);
}

function precedingNote(node) {
  let previous = node.previousSibling;
  while (previous?.nodeType === Node.TEXT_NODE && empty(previous.data)) previous = previous.previousSibling;
  return noteLink(previous);
}

function rewindBoundary(range) {
  let node = range.startContainer, link;
  if (node.nodeType === Node.TEXT_NODE && empty(node.data.slice(0, range.startOffset))) link = precedingNote(node);
  else if (node.nodeType === Node.ELEMENT_NODE && range.startOffset > 0) {
    node = node.childNodes[range.startOffset - 1];
    link = noteLink(node) || (node.nodeType === Node.TEXT_NODE && empty(node.data) && precedingNote(node));
  }
  if (!link) return false;
  // Let the browser compute the actual character/grapheme deletion after
  // skipping the hidden reference and its scaffold, even before the next RAF.
  return setVisibleEdge(range,link,true);
}

function captureBoundaries(range, pane) {
  const scopes = new Set([range.startContainer, range.endContainer].map(node =>
    elementOf(node)?.closest('p, h1, h2, h3, h4, h5, h6, td, th, li')).filter(node => node && pane.contains(node)));
  const saved = [];
  for (const scope of scopes) for (const ref of scope.querySelectorAll(refSelector)) {
    const link = noteLink(ref); if (!link || saved.some(item => item.link === link)) continue;
    const children = [...link.childNodes], marker = node => node instanceof Element && node.matches('.vditor-ir__marker');
    const first = children.findIndex(node => !marker(node));
    const last = children.findLastIndex(node => !marker(node));
    saved.push({link, ref, prefix: children.slice(0, Math.max(0, first)), suffix: children.slice(last + 1)});
  }
  return saved;
}

function restoreBoundaries(saved) {
  for (const {link, ref, prefix, suffix} of saved) {
    // Native paragraph merging is still responsible for text and block layout.
    // If the label survived, put back only metadata that Chromium discarded as
    // hidden content, before the editor serializes its input event. A removed
    // link/paragraph is never resurrected.
    if (!link.isConnected || !hasContent(link)) continue;
    const anchor = [...link.childNodes].find(node => !prefix.includes(node));
    for (const node of prefix) if (node.parentNode !== link) link.insertBefore(node, anchor || null);
    for (const node of suffix) if (node.parentNode !== link) link.append(node);
    // A native merge can leave the reference connected but move prose between
    // it and its label. Adjacency is part of the annotation's serialization.
    let next = link.nextSibling;
    while (next?.nodeType === Node.TEXT_NODE && empty(next.data)) next = next.nextSibling;
    if (next !== ref) link.after(ref);
    removeNoteSpacer(ref);
  }
}

export function protectNoteBoundaries(state, range) {
  const saved = captureBoundaries(range, state[state.currentMode].element);
  const restore = () => restoreBoundaries(saved);
  // execCommand('delete') used after a cut has no beforeinput event. Protect
  // that synchronous transaction at the same pre-serialization input boundary.
  state.element.addEventListener('input', restore, {capture: true, once: true});
  return () => state.element.removeEventListener('input', restore, true);
}
const syntax = '.vditor-ir__marker, .vditor-wysiwyg__preview, .vditor-ir__preview, [data-type="math-inline"], .cm-editor';
const hasContent = node => {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('.vditor-ir__marker').forEach(marker => marker.remove());
  return !!copy.textContent.replace(/\u200b/g, '') || !!copy.querySelector('img, br, [data-type="math-inline"]');
};

// Chromium's contenteditable deletion also removes display:none siblings at
// the edge of a visible range. In a text note those siblings are essential:
// the IR link delimiters and the companion footnote reference. Delete the
// requested DOM range ourselves, then use the editor's normal input pipeline
// for parsing, document synchronization and undo, without reloading the file.
export function deleteNoteText(state, range, inputType = 'deleteContentBackward') {
  const pane = state[state.currentMode]?.element;
  if (!range || range.collapsed || !pane?.contains(range.startContainer) ||
      !pane.contains(range.endContainer) || pane.getAttribute('contenteditable') !== 'true') return false;
  if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE &&
      precedingNote(range.startContainer)) {
    // Deleting following text, including a selected leftover scaffold, must
    // not let Chromium clean up the preceding hidden reference or IR markers.
    state.undo.recordFirstPosition(state, {key: 'Delete'});
    range.startContainer.deleteData(range.startOffset, range.endOffset - range.startOffset);
    range.collapse(true);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    pane.dispatchEvent(new InputEvent('input', {bubbles: true, inputType}));
    return true;
  }
  let link = elementOf(range.startContainer)?.closest('a[href], [data-type="a"]');
  // Selecting exactly the colored element puts endpoints in its parent,
  // rather than inside its wording. Preserve the attached definition here too.
  if (!link && range.startContainer === range.endContainer && range.startContainer.nodeType === Node.ELEMENT_NODE && range.endOffset === range.startOffset+1) {
    const candidate = range.startContainer.childNodes[range.startOffset];
    if (candidate instanceof Element && candidate.matches('a[href],[data-type="a"]')) {
      link = candidate; range.selectNodeContents(link);
    }
  }
  let ref = link?.nextSibling;
  while (ref?.nodeType === Node.TEXT_NODE && empty(ref.data)) ref = ref.nextSibling;
  if (!link?.contains(range.startContainer) || !link.contains(range.endContainer) ||
      noteLink(ref) !== link ||
      elementOf(range.startContainer)?.closest('.vditor-ir__marker, .cm-editor, [contenteditable="false"]') ||
      elementOf(range.endContainer)?.closest('.vditor-ir__marker, .cm-editor, [contenteditable="false"]')) return false;
  state.undo.recordFirstPosition(state, {key: 'Delete'});
  // IR can have several label spans, nested in strong/emphasis nodes. Keep
  // their delimiters balanced when a selection crosses formatting boundaries.
  const edits = [], walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (elementOf(node).closest(syntax) || !range.intersectsNode(node)) continue;
    edits.push([node, node === range.startContainer ? range.startOffset : 0,
      node === range.endContainer ? range.endOffset : node.length]);
  }
  const objects = [...new Set([...link.querySelectorAll('[data-type="math-inline"], img, br')].map(node=>
    node.matches('code[data-type="math-inline"]') ? node.parentElement : node))].filter(node => {
    const index = [...node.parentNode.childNodes].indexOf(node);
    return range.comparePoint(node.parentNode, index) === 0 && range.comparePoint(node.parentNode, index + 1) === 0;
  });
  for (const [node, from, to] of edits.reverse()) node.deleteData(from, to - from);
  objects.forEach(node => node.remove());
  range.collapse(true);
  for (const format of [...link.querySelectorAll('[data-type="strong"], [data-type="em"], [data-type="s"], [data-type="code"], strong, em, s, del, code, b, i')].reverse()) {
    if (!hasContent(format)) format.remove();
  }
  if (!hasContent(link)) {
    // Deleting all wording leaves the existing reference as an ordinary
    // numbered footnote; its definition remains accessible and undoable.
    range.setStartBefore(link); range.collapse(true); link.remove();
  }
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  pane.dispatchEvent(new InputEvent('input', {bubbles: true, inputType}));
  return true;
}

export function installFootnoteEditing(editor) {
  const root = editor.vditor.element;
  let pending;
  const inPane = event => editor.vditor[editor.vditor.currentMode]?.element.contains(event.target) &&
    !elementOf(event.target)?.closest('.cm-editor, [contenteditable="false"]');
  const onKey = event => {
    if (!inPane(event) || event.isComposing || event.defaultPrevented || window.glassRawVisible ||
        !['Backspace', 'Delete'].includes(event.key) || (event.shiftKey && event.key === 'Delete')) return;
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    if (selection.isCollapsed) {
      skipNoteSyntax(selection.getRangeAt(0).cloneRange(),event.key === 'Backspace');
      if (event.key === 'Backspace' && !event.ctrlKey && !event.metaKey && !event.altKey)
        rewindBoundary(selection.getRangeAt(0).cloneRange());
      return;
    }
    // The editor's keydown handler rewrites fully selected inline nodes before
    // beforeinput. Handle a selection inside note wording before that rewrite.
    if (deleteNoteText(editor.vditor, selection.getRangeAt(0).cloneRange(),
        event.key === 'Backspace' ? 'deleteContentBackward' : 'deleteContentForward')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const onInput = event => {
    pending = null;
    if (!inPane(event) || !event.cancelable || event.isComposing || !event.inputType.startsWith('delete') ||
        event.inputType === 'deleteByDrag' || window.glassRawVisible) return;
    const ranges = event.getTargetRanges?.();
    if (ranges?.length !== 1) return;
    // Use the browser's deletion range: this retains platform word deletion,
    // selections, emoji and combining-character boundaries.
    const target = ranges[0], range = document.createRange();
    range.setStart(target.startContainer, target.startOffset);
    range.setEnd(target.endContainer, target.endOffset);
    // Definitions are editable, but are a separate surface from body prose.
    // A collapsed Delete/Backspace must not merge across that boundary.
    const definition = node => elementOf(node)?.closest('[data-type="footnotes-block"],[data-type="footnotes-def"]');
    if (getSelection()?.isCollapsed && !!definition(range.startContainer) !== !!definition(range.endContainer)) {
      event.preventDefault(); return;
    }
    if (deleteNoteText(editor.vditor, range, event.inputType)) event.preventDefault();
    else pending = {type: event.inputType, saved: captureBoundaries(range, editor.vditor[editor.vditor.currentMode].element)};
  };
  const afterInput = event => {
    const transaction = pending; pending = null;
    if (transaction?.type === event.inputType && inPane(event)) restoreBoundaries(transaction.saved);
  };
  root.addEventListener('beforeinput', onInput, true);
  root.addEventListener('input', afterInput, true);
  root.addEventListener('keydown', onKey, true);
  window.addEventListener('pagehide', () => {
    root.removeEventListener('beforeinput', onInput, true);
    root.removeEventListener('input', afterInput, true);
    root.removeEventListener('keydown', onKey, true);
  }, {once: true});
}
