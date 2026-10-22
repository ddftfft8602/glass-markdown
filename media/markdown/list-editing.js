// Shared by the native toolbar, context menu and list shortcuts. Work on whole
// selected paragraphs/items, while leaving the native parse/history path intact.
const element = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
const intersects = (range, node) => {
  const contents = document.createRange(); contents.selectNodeContents(node);
  return range.compareBoundaryPoints(Range.END_TO_START, contents) < 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, contents) > 0;
};
const kind = item => item.classList.contains('vditor-task') ? 'check' :
  item.parentElement.tagName === 'OL' ? 'ordered-list' : 'list';
const makeList = type => {
  const list = document.createElement(type === 'ordered-list' ? 'ol' : 'ul');
  list.dataset.block = '0'; list.dataset.marker = type === 'ordered-list' ? '1.' : '*';
  return list;
};
const setKind = (item, type) => {
  item.querySelectorAll(':scope > input[type="checkbox"],:scope > p > input[type="checkbox"]').forEach(node => node.remove());
  item.classList.toggle('vditor-task', type === 'check');
  item.dataset.marker = type === 'ordered-list' ? '1.' : '*';
  if (type === 'check') {
    const input = document.createElement('input'); input.type = 'checkbox';
    (item.querySelector(':scope > p') || item).prepend(input, document.createTextNode(' '));
  }
};
const unwrapItem = item => {
  item.querySelectorAll(':scope > input[type="checkbox"],:scope > p > input[type="checkbox"]').forEach(node => node.remove());
  const result = document.createDocumentFragment(); let paragraph;
  for (const node of [...item.childNodes]) {
    if (node.nodeType === Node.ELEMENT_NODE && node.matches('p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,div,pre')) {
      paragraph = null; result.append(node);
    } else {
      if (!paragraph) { paragraph = document.createElement('p'); paragraph.dataset.block = '0'; result.append(paragraph); }
      paragraph.append(node);
    }
  }
  return result;
};
window.glassEditListSelection = (state, range, type) => {
  const pane = state[state.currentMode]?.element;
  if (!pane || !['wysiwyg','ir'].includes(state.currentMode) ||
      !pane.contains(range.startContainer) || !pane.contains(range.endContainer)) return false;
  // Definitions and table cells have their own editing structure.
  const excluded = '[data-type="footnotes-block"],td,th,pre:not(.vditor-reset),.cm-editor';
  if (element(range.startContainer)?.closest(excluded) || element(range.endContainer)?.closest(excluded)) return false;
  let units;
  if (range.collapsed) {
    const item = element(range.startContainer)?.closest('li');
    if (!item) return false; // Keep native single-paragraph insertion.
    units = [item];
  } else {
    const scope = element(range.commonAncestorContainer)?.closest('ol,ul') || pane;
    units = [...scope.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li')].filter(node =>
      !node.closest(excluded) && intersects(range, node));
    // A paragraph inside a list belongs to its list item. If both range ends
    // are in a nested item, leave its ancestor items alone.
    units = units.filter(node => !units.some(other => other !== node &&
      other.contains(node) && !(node.tagName === 'LI' && node.contains(range.startContainer) && node.contains(range.endContainer))));
    units = units.filter(node => !units.some(other => other !== node && node.contains(other)));
    if (!units.length) return false;
    if (units.length === 1 && units[0].tagName !== 'LI') return false;
  }
  const remove = units.every(node => node.tagName === 'LI' && kind(node) === type);
  const selected = new Set(units), lists = new Set(units.filter(node => node.tagName === 'LI').map(node => node.parentElement));
  const changedLists = new Set();
  state.undo.addToUndoStack(state);
  pane.querySelectorAll('wbr').forEach(node => node.remove());
  const caret = range.cloneRange(); caret.collapse(true); caret.insertNode(document.createElement('wbr'));
  for (const list of lists) {
    const fragment = document.createDocumentFragment(); let run, previous;
    const start = Number(list.getAttribute('start')) || 1;
    [...list.children].forEach((item,index) => {
      const active = selected.has(item);
      if (active && remove) { fragment.append(unwrapItem(item)); run = null; previous = undefined; return; }
      if (!run || active !== previous) {
        run = active ? makeList(type) : list.cloneNode(false);
        changedLists.add(run);
        // Preserve numbering of unaffected items when a list is split.
        if (!active && run.tagName === 'OL') run.setAttribute('start', String(start + index));
        fragment.append(run); previous = active;
      }
      if (active) setKind(item, type);
      run.append(item);
      if (active && type === 'ordered-list') item.dataset.marker = `${run.children.length}.`;
    });
    list.replaceWith(fragment);
  }
  let run, previous;
  for (const block of units.filter(node => node.tagName !== 'LI')) {
    if (!run || previous?.nextElementSibling !== block) { run = makeList(type); changedLists.add(run); block.before(run); }
    const item = document.createElement('li'); setKind(item,type);
    if (block.tagName === 'P') item.append(block);
    else { // Match native heading-to-list conversion without copying IR hashes.
      block.querySelectorAll(':scope > .vditor-ir__marker--heading').forEach(node => node.remove());
      item.append(...block.childNodes); block.remove();
    }
    run.append(item);
    if (type === 'ordered-list') item.dataset.marker = `${run.children.length}.`;
    previous = run;
  }
  // Applying numbering across existing items and plain paragraphs should form
  // one list, rather than several adjacent lists each starting at 1.
  const sameKind = (a,b) => a?.matches('ol,ul') && b?.matches('ol,ul') &&
    a.tagName === b.tagName && a.firstElementChild && b.firstElementChild &&
    kind(a.firstElementChild) === kind(b.firstElementChild);
  for (let list of changedLists) {
    if (!list.isConnected) continue;
    const before = list.previousElementSibling;
    if (sameKind(before,list)) { before.append(...list.children); list.remove(); list = before; }
    while (sameKind(list,list.nextElementSibling)) {
      const next = list.nextElementSibling; list.append(...next.children); next.remove();
    }
    if (list.tagName === 'OL') [...list.children].forEach((item,index) => {
      item.dataset.marker = `${(Number(list.getAttribute('start')) || 1) + index}.`;
    });
  }
  // The caller normalizes DOM and restores the caret synchronously. Commit
  // afterward so immediate undo does not depend on its input debounce timer.
  queueMicrotask(() => state.undo.addToUndoStack(state));
  return true;
};
