// Used by the native paste/insertMarkdown path after parsing clipboard content.
// Only a payload consisting of display formulas changes block placement.
const isDisplayMath = node => node.nodeType === Node.ELEMENT_NODE && (
  node.getAttribute('data-type') === 'math-block' ||
  (node.getAttribute('data-type') === 'code-block' && node.querySelector('pre > code.language-math'))
);
const hasContent = fragment => {
  const copy = fragment.cloneNode(true);
  copy.querySelectorAll('.vditor-ir__marker:not([data-type="math-inline"]),.vditor-cm-host,.vditor-wysiwyg__preview,.vditor-ir__preview,wbr').forEach(node => node.remove());
  return !!copy.textContent.replace(/[\s\u200b]/g, '') || !!copy.querySelector('img,video,audio,iframe,[data-type="math-inline"],[data-type="html-inline"]');
};
const followingText = node => {
  while (node && (node.nodeType !== Node.ELEMENT_NODE || node.classList.contains('vditor-editor-boundary'))) node = node.nextSibling;
  return node?.matches('p,h1,h2,h3,h4,h5,h6') ? node : null;
};
// The new block boundary replaces one existing line break at the split edge.
// Remove only that break, keeping intentional additional breaks and paragraphs.
const consumeBoundaryBreak = (fragment, prefix) => {
  const edge = parent => {
    const children = [...parent.childNodes];
    if (prefix) children.reverse();
    for (const node of children) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.replace(/\u200b/g, '')) return node;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.matches('.vditor-ir__marker:not([data-type="math-inline"]),.vditor-ir__preview,.vditor-wysiwyg__preview,wbr')) continue;
        if (node.matches('br,img,code,[data-type="math-inline"],[data-type="html-inline"],[contenteditable="false"]')) return node;
        const child = edge(node); if (child) return child;
      }
    }
    return null;
  };
  const node = edge(fragment);
  if (node?.nodeName === 'BR') node.remove();
  else if (node?.nodeType === Node.TEXT_NODE) {
    node.textContent = node.textContent.replace(prefix ? /\r?\n[\t \u200b]*$/ : /^[\t \u200b]*\r?\n/, '');
  }
};
// A Range fragment inside IR bold/link text omits its opening or closing source
// markers. Restore only those markers, never text outside the selected half.
const closeIREdge = (fragment, container, offset, block, prefix) => {
  const ancestors = [];
  for (let node = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement; node && node !== block; node = node.parentElement) {
    if (node.classList.contains('vditor-ir__node')) ancestors.push(node);
  }
  if (!prefix) ancestors.reverse();
  const used = new Set();
  for (const original of ancestors) {
    const matches = [...fragment.querySelectorAll('.vditor-ir__node')].filter(node => !used.has(node) && node.dataset.type === original.dataset.type);
    const clone = prefix ? matches.at(-1) : matches[0]; if (!clone) continue;
    used.add(clone);
    const children = [...original.childNodes];
    const index = original === container ? offset : children.findIndex(node => node === container || node.contains(container));
    const missing = prefix ? children.slice(index + (original === container ? 0 : 1)) : children.slice(0, index);
    const markers = missing.filter(node => node.nodeType === Node.ELEMENT_NODE && node.classList.contains('vditor-ir__marker')).map(node => node.cloneNode(true));
    if (prefix) clone.append(...markers); else clone.prepend(...markers);
  }
};
window.glassInsertDisplayMath = (content, state, range) => {
  if (window.glassDeleteFootnoteFragment?.(content, state, range)) return true;
  if (window.glassInsertFootnoteFragment?.(content, state, range)) return true;
  if (window.glassInsertHeadingFragment?.(content, state, range)) return true;
  const nodes = [...content.childNodes].filter(node => node.nodeType !== Node.TEXT_NODE || node.textContent.trim());
  if (!nodes.length || !nodes.every(isDisplayMath)) return false;
  const pane = state[state.currentMode]?.element;
  if (!pane || !pane.contains(range.startContainer) || !pane.contains(range.endContainer)) return false;
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  for (const endpoint of [element, endElement]) {
    const protectedNode = endpoint.closest('pre,code,table,.cm-editor,[data-type="math-block"],[data-type="code-block"],[data-type="math-inline"],[contenteditable="false"]');
    if (protectedNode && protectedNode !== pane && pane.contains(protectedNode)) return false;
  }
  const placeCaret = tail => {
    if (tail) { range.selectNodeContents(tail); range.collapse(true); }
    else { range.setStartAfter(nodes.at(-1)); range.collapse(true); }
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    state[state.currentMode].range = range;
  };
  if (range.collapsed && (element === pane || element.classList.contains('vditor-editor-boundary'))) {
    if (element !== pane) { range.setStartAfter(element); range.collapse(true); }
    const tail = followingText(pane.childNodes[range.startOffset]);
    const fragment = document.createDocumentFragment(); nodes.forEach(node => fragment.append(node));
    range.insertNode(fragment); placeCaret(tail); return true;
  }
  const block = element.closest('p,h1,h2,h3,h4,h5,h6');
  if (!block || !block.contains(range.endContainer)) return false;
  const before = range.cloneRange(); before.selectNodeContents(block); before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange(); after.selectNodeContents(block); after.setStart(range.endContainer, range.endOffset);
  const prefix = before.cloneContents(), suffix = after.cloneContents();
  consumeBoundaryBreak(prefix, true);
  consumeBoundaryBreak(suffix, false);
  if (state.currentMode === 'ir') {
    closeIREdge(prefix, range.startContainer, range.startOffset, block, true);
    closeIREdge(suffix, range.endContainer, range.endOffset, block, false);
  }
  const fragment = document.createDocumentFragment();
  const cleanBlock = node => {
    node.removeAttribute('id');
    node.classList.remove('glass-active-block', 'glass-caret-heading');
    if (!node.className) node.removeAttribute('class');
    return node;
  };
  if (hasContent(prefix)) {
    const first = cleanBlock(block.cloneNode(false)); first.append(prefix); fragment.append(first);
  }
  nodes.forEach(node => fragment.append(node));
  const hasSuffix = hasContent(suffix);
  const tail = hasSuffix ? cleanBlock(block.cloneNode(false)) : followingText(block.nextSibling);
  if (hasSuffix) { tail.append(suffix); fragment.append(tail); }
  const headingMarker = state.currentMode === 'ir' && block.querySelector(':scope > .vditor-ir__marker--heading');
  if (headingMarker) for (const node of fragment.children) {
    if (node.tagName === block.tagName && !node.querySelector(':scope > .vditor-ir__marker--heading')) node.prepend(headingMarker.cloneNode(true));
  }
  fragment.querySelectorAll('.glass-active-block,.glass-caret-heading,.glass-caret-format,.glass-caret-node').forEach(node => {
    node.classList.remove('glass-active-block', 'glass-caret-heading', 'glass-caret-format', 'glass-caret-node');
    if (!node.className) node.removeAttribute('class');
  });
  // Range clones do not copy event listeners. Let the native renderer hydrate
  // cloned inline formulas (including their copy handlers) from exact TeX again.
  fragment.querySelectorAll('.vditor-wysiwyg__preview .language-math[data-math],.vditor-ir__preview .language-math[data-math]').forEach(math => {
    math.textContent = math.dataset.math; math.removeAttribute('data-math');
    math.closest('.vditor-wysiwyg__preview,.vditor-ir__preview').setAttribute('data-render', '2');
  });
  // Preserve explicit paragraph IDs on the first surviving text fragment.
  if (block.id) {
    const firstText = [...fragment.children].find(node => !isDisplayMath(node));
    (firstText || nodes[0]).setAttribute('id', block.id);
  }
  block.replaceWith(fragment);
  placeCaret(tail);
  return true;
};
