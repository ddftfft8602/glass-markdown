const linkSelector = 'a[href], [data-type="a"]';
const elementOf = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
const empty = text => !text.replace(/\u200b/g, '');
const precedingLink = node => {
  if (node instanceof Element && node.matches('[data-type="footnotes-ref"]')) {
    const ref = node;
    node = node.previousSibling;
    while (node?.nodeType === Node.TEXT_NODE && empty(node.data)) node = node.previousSibling;
    const href = node instanceof Element && (node.getAttribute('href') ?? node.querySelector(':scope > .vditor-ir__marker--link')?.textContent);
    return href === `#footnote:${ref.dataset.footnotesLabel?.replace(/^\^/,'')}` ? node : null;
  }
  return elementOf(node)?.matches(linkSelector) ? node : null;
};

// A DOM boundary after a link is not a stable typing position in Chromium:
// it can be canonicalized back inside the last visible child of the link.
// Give native typing/paste/IME a real text position outside the link instead.
export function installLinkEditing(editor) {
  const root = editor.vditor.element;
  let composing = false;
  const prepare = event => {
    if (event.type === 'beforeinput' && (composing || event.isComposing ||
        !['insertText', 'insertReplacementText'].includes(event.inputType))) return;
    const pane = editor.vditor[editor.vditor.currentMode]?.element;
    const selection = getSelection();
    if (!pane || !selection?.isCollapsed || !selection.rangeCount ||
        !pane.contains(selection.anchorNode) ||
        elementOf(selection.anchorNode)?.closest('.cm-editor, [contenteditable="false"]')) return;
    const range = selection.getRangeAt(0);
    let link = elementOf(range.startContainer)?.closest(linkSelector);
    if (link) {
      if (editor.vditor.currentMode === 'ir') {
        // Explicit source editing (URL, title and delimiters) must remain native.
        const marker = elementOf(range.startContainer)?.closest('.vditor-ir__marker');
        if (marker && !(marker === link.lastElementChild && marker.textContent === ')' &&
            atEnd(range, marker))) return;
      }
      const tail = range.cloneRange();
      tail.setEnd(link, link.childNodes.length);
      const fragment = tail.cloneContents();
      // Keep escaped label characters, formatted text and images; remove only
      // IR syntax so a citation's closing visible ] still counts as label text.
      fragment.querySelectorAll('.vditor-ir__marker').forEach(node => node.remove());
      if (!empty(fragment.textContent) || fragment.querySelector('img, br')) return;
    } else {
      // Walk backwards from an exact boundary, including a following text node
      // at offset zero. Never move a caret already inside ordinary prose.
      let node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        if (!empty(node.data.slice(0, range.startOffset))) return;
      } else if (range.startOffset > 0) {
        node = node.childNodes[range.startOffset - 1];
        link = precedingLink(node);
        while (!link && node?.lastChild && !elementOf(node)?.matches(linkSelector)) node = node.lastChild;
        link ||= elementOf(node)?.closest(linkSelector);
        if (!link) return;
      }
      if (!link) {
        while (node !== pane && !node.previousSibling) node = node.parentNode;
        node = node?.previousSibling;
        while (node?.nodeType === Node.TEXT_NODE && empty(node.data)) node = node.previousSibling;
        link = precedingLink(node);
      }
    }
    if (!link || !pane.contains(link) || link.closest('[contenteditable="false"]')) return;
    let boundary = link;
    if (link.classList.contains('glass-text-note')) {
      let ref = link.nextSibling;
      while (ref?.nodeType === Node.TEXT_NODE && empty(ref.data)) ref = ref.nextSibling;
      if (ref instanceof Element && ref.matches('[data-type="footnotes-ref"]')) boundary = ref;
    }
    let next = boundary.nextSibling;
    if (next?.nodeType !== Node.TEXT_NODE) {
      next = document.createTextNode('\u200b'); boundary.after(next);
    } else if (!next.data.startsWith('\u200b')) {
      next.insertData(0, '\u200b');
    }
    range.setStart(next, 1); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
  };
  const onCompositionStart = event => { prepare(event); composing = true; };
  const onCompositionEnd = () => { composing = false; };
  root.addEventListener('beforeinput', prepare, true);
  root.addEventListener('paste', prepare, true);
  root.addEventListener('compositionstart', onCompositionStart, true);
  root.addEventListener('compositionend', onCompositionEnd, true);
  window.addEventListener('pagehide', () => {
    root.removeEventListener('beforeinput', prepare, true);
    root.removeEventListener('paste', prepare, true);
    root.removeEventListener('compositionstart', onCompositionStart, true);
    root.removeEventListener('compositionend', onCompositionEnd, true);
  }, { once: true });
}

function atEnd(range, node) {
  const tail = range.cloneRange(); tail.setEnd(node, node.childNodes.length);
  return empty(tail.toString());
}
