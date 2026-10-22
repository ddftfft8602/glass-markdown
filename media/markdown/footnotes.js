import { deleteFootnote, matchesFootnoteDefinition } from './footnote-deletion.js';
import { installFootnoteOrigins } from './footnote-references.js';
import { installFootnoteEditing, removeNoteSpacer } from './footnote-editing.js';

const refSelector = '[data-type="footnotes-ref"]';
const clickableSelector = `${refSelector}, .glass-text-note`;
const linkHref = link => link.getAttribute('href') ?? link.querySelector(':scope > .vditor-ir__marker--link')?.textContent ?? '';
const labelOf = ref => ref.classList.contains('glass-text-note') ? linkHref(ref).replace(/^#footnote:/, '') : (ref.dataset.footnotesLabel || ref.textContent).replace(/^\^/, '');

export function installFootnotes(editor) {
  const root = editor.vditor.element;
  installFootnoteOrigins(editor);
  installFootnoteEditing(editor);
  let popup, currentRef, previousFocus, previousRange, openScroll, openWindow, sizeObserver, positionPopup, editingRef;
  const pane = () => editor.vditor[editor.vditor.currentMode]?.element;
  const close = (restoreFocus = false) => {
    if (!popup) return;
    sizeObserver?.disconnect(); sizeObserver = null; positionPopup = null;
    popup.remove(); popup = null;
    currentRef?.classList.remove('glass-note-open'); currentRef = null;
    if (restoreFocus) {
      if (previousRange?.startContainer.isConnected && previousRange.endContainer.isConnected) {
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(previousRange);
      }
      const target = previousFocus?.isConnected && pane()?.contains(previousFocus) ? previousFocus : pane();
      target?.focus({ preventScroll: true });
    }
    previousFocus = previousRange = null;
  };
  const open = (ref, keyboard = false) => {
    editingRef = null;
    if (currentRef === ref) { close(true); return; }
    close();
    previousFocus = keyboard ? ref : document.activeElement;
    previousRange = !keyboard && getSelection()?.rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
    root.querySelectorAll('.vditor-hint, .vditor-wysiwyg__popover').forEach(panel => { panel.style.display = 'none'; });
    currentRef = ref;
    const label = labelOf(ref);
    const definition = findDefinition(pane(), label);
    popup = document.createElement('section');
    popup.className = 'glass-footnote-popup';
    popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', `备注 ${label}`);
    popup.tabIndex = -1;
    const header = document.createElement('header');
    const title = document.createElement('span'); title.textContent = ref.classList.contains('glass-text-note') ? '备注' : `备注 · ${label}`;
    const dismiss = document.createElement('button');
    dismiss.type = 'button'; dismiss.setAttribute('aria-label', '关闭备注'); dismiss.title = '关闭备注（Esc）'; dismiss.textContent = '×';
    dismiss.addEventListener('click', () => close(true));
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'glass-note-delete'; remove.textContent = '删除备注';
    remove.title = '删除这条备注及所有对应入口，保留正文文字（可撤销）';
    remove.addEventListener('click', () => { close(); deleteFootnote(editor, label, ref); });
    const actions = document.createElement('div'); actions.className = 'glass-note-actions'; actions.append(remove, dismiss);
    header.append(title, actions);
    const content = document.createElement('div'); content.className = 'glass-footnote-content';
    if (definition) content.append(noteContents(definition));
    else content.textContent = `没有找到这条备注，请在源码中补充 [^${label}]: 备注内容。`;
    popup.append(header, content);
    // Outside the editable panes: opening, selecting and copying notes must
    // never enter Markdown serialization or the document's undo history.
    root.append(popup); ref.classList.add('glass-note-open');
    openScroll = {top: pane().scrollTop, left: pane().scrollLeft};
    openWindow = {width: innerWidth, height: innerHeight};
    const place = () => {
    if (!popup || !ref.isConnected) return;
    const anchor = ref.getBoundingClientRect(), box = popup.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8));
    const below = anchor.bottom + 8;
    const top = Math.max(8, Math.min(below + box.height <= innerHeight - 8 ? below : anchor.top - box.height - 8, innerHeight - box.height - 8));
    popup.style.left = `${left}px`; popup.style.top = `${top}px`;
    };
    positionPopup = place; place(); sizeObserver = new ResizeObserver(place); sizeObserver.observe(popup);
    // Isolate its readonly content from the editor's delegated edit handlers.
    for (const type of ['mousedown', 'pointerdown', 'dblclick', 'copy', 'contextmenu', 'keydown']) {
      popup.addEventListener(type, event => event.stopPropagation());
    }
    popup.addEventListener('click', event => {
      event.stopPropagation();
      const link = event.target.closest('a[href]');
      if (!link) return;
      event.preventDefault();
      const href = link.getAttribute('href');
      if (href.startsWith('#')) { close(true); window.glassNavigateNoteLink?.(href); }
      else if (/^(https?:|mailto:)/i.test(href)) handler.emit('openLink', href);
    });
    popup.addEventListener('auxclick', event => { event.preventDefault(); event.stopPropagation(); });
    popup.focus({ preventScroll: true });
  };
  const getRef = event => {
    const ref = event.target instanceof Element ? event.target.closest(clickableSelector) : null;
    return ref && pane()?.contains(ref) && !window.glassRawVisible ? ref : null;
  };
  const onPointer = event => {
    if (editingRef && !editingRef.contains(event.target)) editingRef = null;
    if (popup && !popup.contains(event.target) && !getRef(event)) close();
    if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && getRef(event)) {
      const ref = getRef(event);
      if (ref.classList.contains('glass-text-note') && (event.detail >= 2 || editingRef === ref)) {
        close(); return;
      }
      // A second click on the open note should place a real editing caret at
      // that pointer position. Do not suppress the browser's selection here.
      if (popup && getRef(event) === currentRef) return;
      event.preventDefault(); event.stopPropagation();
    }
  };
  const onClick = event => {
    const ref = getRef(event);
    if (!ref || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (ref.classList.contains('glass-text-note') && (event.type === 'dblclick' || event.detail >= 2 || editingRef === ref)) {
      close(); editingRef = ref;
      // Formula editing remains native; its link metadata must never open.
      if (event.target.closest('.cm-editor')) return;
      if (event.target.closest('.vditor-wysiwyg__preview,.vditor-ir__preview,code[data-type="math-inline"]')) {
        if (getSelection()?.rangeCount && !getSelection().isCollapsed) getSelection().collapseToStart();
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      const caret = document.caretRangeFromPoint?.(event.clientX,event.clientY);
      pane()?.focus({preventScroll:true});
      if (caret && ref.contains(caret.startContainer)) {
        caret.collapse(true); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(caret);
      }
      return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    if (currentRef === ref) {
      const selection = getSelection();
      const clickedRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
      close();
      editingRef = ref.classList.contains('glass-text-note') ? ref : null;
      // The link has tabindex for keyboard opening. Return focus to the
      // editable pane so Space/Enter type normally instead of reopening it.
      pane()?.focus({preventScroll: true});
      if (clickedRange && pane()?.contains(clickedRange.startContainer) && pane().contains(clickedRange.endContainer)) {
        selection.removeAllRanges(); selection.addRange(clickedRange);
      }
      return;
    }
    if (event.type === 'click') open(ref);
  };
  const onKey = event => {
    if (event.key === 'Escape') editingRef = null;
    if (event.key === 'Escape' && popup) { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
    else if (['Enter', ' '].includes(event.key) && getRef(event) && !event.ctrlKey && !event.metaKey) {
      event.preventDefault(); event.stopImmediatePropagation(); open(getRef(event), true);
    }
  };
  const onScroll = event => {
    if (!popup || event.target !== pane()) return;
    // Clicking a reference after navigation can deliver its scroll event after
    // the popup opens. Ignore that already-completed scroll, not later motion.
    if (event.target === pane() && pane().scrollTop === openScroll.top && pane().scrollLeft === openScroll.left) return;
    const refBox = currentRef.getBoundingClientRect(), viewport = pane().getBoundingClientRect();
    if (refBox.bottom < viewport.top || refBox.top > viewport.bottom) close();
    else positionPopup?.();
  };
  const onWheel = event => { if (popup && pane()?.contains(event.target)) close(); };
  // Capture above the native editor, whose footnote click handler navigates.
  document.addEventListener('mousedown', onPointer, true);
  root.addEventListener('click', onClick, true); root.addEventListener('dblclick', onClick, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('scroll', onScroll, true);
  root.addEventListener('wheel', onWheel, {capture:true, passive:true});
  const onResize = () => { if (popup && (innerWidth !== openWindow.width || innerHeight !== openWindow.height)) close(); };
  window.addEventListener('resize', onResize);
  const onInput = () => {
    const editing = !!editingRef; close();
    if (editing) queueMicrotask(()=>{
      const node = getSelection()?.anchorNode;
      editingRef = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('.glass-text-note') || null;
    });
  };
  root.addEventListener('beforeinput', onInput, true);
  window.addEventListener('pagehide', () => {
    close(); document.removeEventListener('mousedown', onPointer, true);
    root.removeEventListener('click', onClick, true); root.removeEventListener('dblclick', onClick, true);
    document.removeEventListener('keydown', onKey, true); document.removeEventListener('scroll', onScroll, true);
    root.removeEventListener('wheel', onWheel, true);
    window.removeEventListener('resize', onResize); root.removeEventListener('beforeinput', onInput, true);
  }, { once: true });
  return scope => {
    if (popup && !currentRef?.isConnected) close();
    if (scope.matches('a[href], [data-type="a"]')) scope = scope.parentElement;
    for (const link of scope.querySelectorAll('.glass-text-note')) {
      let ref = link.nextSibling;
      while (ref?.nodeType === Node.TEXT_NODE && !ref.textContent.replace(/\u200b/g,'')) ref = ref.nextSibling;
      if (!(ref instanceof Element) || !ref.matches(refSelector) || linkHref(link) !== `#footnote:${labelOf(ref)}`) {
        link.classList.remove('glass-text-note'); link.removeAttribute('tabindex'); link.removeAttribute('role'); link.removeAttribute('aria-label');
      }
    }
    const refs = [...scope.querySelectorAll(refSelector)];
    if (scope.matches(refSelector)) refs.push(scope);
    for (const ref of refs) {
      if (!pane()?.contains(ref)) continue;
      let previous = ref.previousSibling;
      while (previous?.nodeType === Node.TEXT_NODE && !previous.textContent.replace(/\u200b/g,'')) previous = previous.previousSibling;
      const textNote = previous instanceof Element && linkHref(previous) === `#footnote:${labelOf(ref)}`;
      ref.classList.toggle('glass-text-note-ref', textNote);
      if (textNote) {
        removeNoteSpacer(ref);
        previous.classList.add('glass-text-note'); previous.tabIndex = 0; previous.setAttribute('role','button'); previous.setAttribute('aria-label','查看备注；双击编辑文字');
      }
      ref.tabIndex = 0; ref.setAttribute('role', 'button');
      if (textNote) ref.tabIndex = -1;
      ref.setAttribute('aria-label', `查看备注 ${ref.dataset.footnotesLabel?.replace(/^\^/, '') || ''}`);
    }
  };
}

function findDefinition(pane, label) {
  for (const node of pane.querySelectorAll('[data-type="footnotes-li"], [data-type="footnotes-def"]')) {
    if (matchesFootnoteDefinition(node, label)) return node;
  }
  return null;
}

function noteContents(definition) {
  const box = document.createElement('div');
  // IR definitions store their label as a leading text node, outside the body.
  for (const child of definition.childNodes) {
    if (definition.dataset.type === 'footnotes-def' && child.nodeType === Node.TEXT_NODE && /^\[\^.*?\]:\s*$/.test(child.textContent)) continue;
    box.append(child.cloneNode(true));
  }
  // The popup is readonly. A display formula has both hidden source and a
  // preview in the editor; stripping their styles would expose both copies.
  for (const block of box.querySelectorAll('div[data-type="math-block"]')) {
    const source = block.querySelector(':scope > pre > code[data-type="math-block"]');
    if (!source) continue;
    const preview = block.querySelector(':scope > .vditor-wysiwyg__preview,:scope > .vditor-ir__preview');
    const display = document.createElement('div');
    if (preview?.querySelector('.katex')) display.append(...preview.childNodes);
    else display.textContent = source.textContent;
    block.replaceWith(display);
  }
  for (const link of box.querySelectorAll('[data-type="a"]')) {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', link.querySelector(':scope > .vditor-ir__marker--link')?.textContent || '');
    anchor.append(...link.childNodes); link.replaceWith(anchor);
  }
  box.querySelectorAll('.vditor-cm-host, .vditor-math-inline__cm-host, .vditor-cm-chrome, .vditor-ir__marker, .vditor-wysiwyg__pre, code[data-type="math-inline"], [data-type="backslash"] > span, .katex-mathml, wbr, script, style, iframe, object, embed, form, input, textarea, button, select').forEach(node => node.remove());
  const tags = new Set('P DIV SPAN STRONG EM B I S DEL CODE PRE BLOCKQUOTE UL OL LI TABLE THEAD TBODY TR TH TD A BR HR H1 H2 H3 H4 H5 H6 SUP SUB MARK IMG'.split(' '));
  for (const node of [...box.querySelectorAll('*')]) {
    const math = !!node.closest('.katex');
    const svg = math && ['svg', 'path', 'line'].includes(node.localName);
    if (!tags.has(node.tagName) && !svg) { node.replaceWith(...node.childNodes); continue; }
    for (const attr of [...node.attributes]) {
      const permitted = ['colspan', 'rowspan', 'alt', 'title'].includes(attr.name) ||
        (node.tagName === 'A' && attr.name === 'href' && /^(#|https?:|mailto:)/i.test(attr.value)) ||
        (node.tagName === 'IMG' && attr.name === 'src' && /^(data:image\/(png|jpe?g|gif|webp);|vscode-webview:|https:\/\/[^/]*\.vscode-cdn\.net\/|\/)/i.test(attr.value)) ||
        (math && ['class', 'style', 'aria-hidden', 'viewBox', 'width', 'height', 'd', 'preserveAspectRatio'].includes(attr.name));
      if (!permitted) node.removeAttribute(attr.name);
    }
    if (node.tagName === 'IMG' && !node.hasAttribute('src')) node.replaceWith(document.createTextNode(node.alt || '[图片]'));
  }
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) walker.currentNode.data = walker.currentNode.data.replace(/\u200b/g, '');
  return box;
}
