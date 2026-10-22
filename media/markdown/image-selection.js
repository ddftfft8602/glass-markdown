const elementOf = node => node?.nodeType === 1 ? node : node?.parentElement;
const ZWSP = '\u200b';
const setRange = range => { const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); };
const imageUnit = image => image.closest('[data-type="img"]') || image;

// Starting on an image normally starts HTML drag-and-drop (and may move the
// image). Treat that gesture as an atomic image + text selection instead.
// After a plain click, keep the image selected so ArrowLeft/Right can place the
// caret immediately before/after that image (including between consecutive
// images, where Chromium otherwise has no gap caret).
export function installImageSelection(editor) {
  let gesture, suppressClick = false, frame = 0, selected = null;
  const clearSelected = () => {
    if (selected?.classList) selected.classList.remove('glass-image--selected');
    selected = null;
  };
  const markSelected = image => {
    if (selected === image) return;
    clearSelected();
    selected = image;
    image.classList.add('glass-image--selected');
  };
  const hideImagePopover = state => {
    const popover = state[state.currentMode]?.popover;
    if (!popover || popover._sourceElement?.tagName !== 'IMG') return;
    popover.style.display = 'none';
    delete popover._sourceElement;
  };
  const selectImageRange = (image, pane) => {
    const range = document.createRange();
    range.selectNode(imageUnit(image));
    pane.focus({ preventScroll: true });
    setRange(range);
    editor.vditor[editor.vditor.currentMode].range = range.cloneRange();
  };
  const imageFromRange = (range, pane) => {
    if (!range || range.collapsed) return null;
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === 1) {
      const nodes = [...range.startContainer.childNodes].slice(range.startOffset, range.endOffset);
      if (nodes.length === 1) {
        const node = nodes[0];
        if (node.nodeType === 1 && node.tagName === 'IMG') return pane.contains(node) ? node : null;
        const wrapped = node.nodeType === 1 && node.getAttribute?.('data-type') === 'img'
          ? node.querySelector(':scope > img')
          : null;
        if (wrapped && pane.contains(wrapped)) return wrapped;
      }
    }
    const fragment = range.cloneContents();
    const images = fragment.querySelectorAll?.('img');
    if (images?.length === 1 && !fragment.textContent.replace(/\u200b/g, '').trim()) {
      // Recover the live node: walk from range start.
      const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_ELEMENT);
      if (range.commonAncestorContainer.nodeType === 1 && range.commonAncestorContainer.tagName === 'IMG') {
        return pane.contains(range.commonAncestorContainer) ? range.commonAncestorContainer : null;
      }
      let node = walker.currentNode;
      while (node) {
        if (node.tagName === 'IMG' && range.intersectsNode(node) && pane.contains(node)) return node;
        node = walker.nextNode();
      }
    }
    return null;
  };
  const resolveSelectedImage = pane => {
    if (selected?.isConnected && pane.contains(selected)) return selected;
    const state = editor.vditor;
    const popover = state[state.currentMode]?.popover;
    const source = popover?._sourceElement;
    if (source?.tagName === 'IMG' && pane.contains(source) && popover.style.display !== 'none') return source;
    const selection = getSelection();
    if (!selection?.rangeCount) return null;
    return imageFromRange(selection.getRangeAt(0), pane);
  };
  const placeCaretBeside = (image, after) => {
    const state = editor.vditor, pane = state[state.currentMode]?.element;
    const unit = imageUnit(image);
    if (!pane || !unit.isConnected) return;
    let text;
    if (after) {
      text = unit.nextSibling;
      if (text?.nodeType !== Node.TEXT_NODE) {
        text = document.createTextNode(ZWSP);
        unit.after(text);
      } else if (!text.data.startsWith(ZWSP)) {
        text.data = ZWSP + text.data;
      }
      const range = document.createRange();
      range.setStart(text, 1);
      range.collapse(true);
      hideImagePopover(state);
      clearSelected();
      pane.focus({ preventScroll: true });
      setRange(range);
      state[state.currentMode].range = range.cloneRange();
      return;
    }
    text = unit.previousSibling;
    if (text?.nodeType !== Node.TEXT_NODE) {
      text = document.createTextNode(ZWSP);
      unit.before(text);
    } else if (!text.data.endsWith(ZWSP)) {
      text.data += ZWSP;
    }
    const range = document.createRange();
    range.setStart(text, text.data.length);
    range.collapse(true);
    hideImagePopover(state);
    clearSelected();
    pane.focus({ preventScroll: true });
    setRange(range);
    state[state.currentMode].range = range.cloneRange();
  };
  const update = () => {
    frame = 0;
    if (!gesture?.dragging || !gesture.image.isConnected) return;
    const {pane,image,x,y} = gesture, box = pane.getBoundingClientRect();
    const top = Math.max(0,box.top), bottom = Math.min(innerHeight,box.bottom);
    const delta = y < top+24 ? -Math.min(24,top+24-y) : y > bottom-24 ? Math.min(24,y-bottom+24) : 0;
    if (delta) pane.scrollTop += delta;
    const point = document.caretRangeFromPoint(Math.max(box.left+1,Math.min(box.right-1,x)),Math.max(top+1,Math.min(bottom-1,y)));
    if (point && pane.contains(point.startContainer)) {
      const unit = imageUnit(image);
      const range = document.createRange(); range.selectNode(unit);
      const order = range.comparePoint(point.startContainer,point.startOffset);
      const backward = order < 0 || order === 0 && (y < gesture.startY || y === gesture.startY && x < gesture.startX);
      const anchor = range.cloneRange(); anchor.collapse(!backward);
      const hit = document.elementFromPoint(x,Math.max(top+1,Math.min(bottom-1,y)))?.closest('img');
      if (hit && hit !== image && pane.contains(hit)) {
        point.selectNode(hit.closest('[data-type="img"]') || hit); point.collapse(backward);
      }
      // A hit inside the initiating image still selects the complete image.
      else if (order === 0) { point.setStart(backward?range.startContainer:range.endContainer,backward?range.startOffset:range.endOffset); point.collapse(true); }
      getSelection().setBaseAndExtent(anchor.startContainer,anchor.startOffset,point.startContainer,point.startOffset);
      editor.vditor[editor.vditor.currentMode].range = getSelection().getRangeAt(0).cloneRange();
    }
    if (delta) frame = requestAnimationFrame(update);
  };
  const down = event => {
    gesture = null; suppressClick = false; cancelAnimationFrame(frame); frame = 0;
    if (event.button !== 0 || event.detail >= 2 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || window.glassRawVisible) return;
    const pane = editor.vditor[editor.vditor.currentMode]?.element, image = elementOf(event.target)?.closest('img');
    if (!image || !pane?.contains(image) || image.closest('.cm-editor,.vditor-wysiwyg__preview,.vditor-ir__preview,.vditor-img-overlay')) {
      if (selected && (!image || image !== selected)) clearSelected();
      return;
    }
    gesture = {pane,image,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,dragging:false};
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const move = event => {
    if (!gesture || !(event.buttons & 1)) return;
    gesture.x = event.clientX; gesture.y = event.clientY;
    if (!gesture.dragging) {
      if (Math.hypot(gesture.x-gesture.startX,gesture.y-gesture.startY)<4) return;
      gesture.dragging = true; clearSelected(); gesture.pane.focus({preventScroll:true});
    }
    event.preventDefault(); event.stopImmediatePropagation();
    cancelAnimationFrame(frame); update();
  };
  const up = event => {
    if (!gesture || event.button !== 0) return;
    if (gesture.dragging) {
      gesture.x = event.clientX; gesture.y = event.clientY; cancelAnimationFrame(frame); update();
      suppressClick = true; event.preventDefault(); event.stopImmediatePropagation();
    } else if (gesture.image.isConnected) {
      markSelected(gesture.image);
      selectImageRange(gesture.image, gesture.pane);
    }
    gesture = null; cancelAnimationFrame(frame); frame = 0;
  };
  const click = event => {
    if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (!selected?.isConnected) return;
    const image = selected;
    // Keep the image selected after Vditor opens its popover so arrow keys work.
    queueMicrotask(() => {
      if (selected !== image || !image.isConnected) return;
      const pane = editor.vditor[editor.vditor.currentMode]?.element;
      if (!pane?.contains(image)) return;
      if (document.activeElement?.matches?.('input,textarea') ||
          document.activeElement?.closest?.('input,textarea,.cm-editor')) return;
      selectImageRange(image, pane);
    });
  };
  const onKey = event => {
    if (event.defaultPrevented || event.isComposing || window.glassRawVisible) return;
    // Typing / Escape drops the image selection so later arrows edit text normally.
    if (selected && !event.ctrlKey && !event.metaKey && !event.altKey &&
        (event.key === 'Escape' || event.key === 'Enter' || event.key === 'Backspace' ||
         event.key === 'Delete' || (event.key.length === 1 && !event.altKey))) {
      clearSelected();
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const target = elementOf(event.target);
    // Do not steal caret movement while editing popover fields or CodeMirror.
    if (target?.closest('input,textarea,.cm-editor,.vditor-img-overlay,.glass-footnote-popup')) return;
    const state = editor.vditor, pane = state[state.currentMode]?.element;
    if (!pane || pane.getAttribute('contenteditable') !== 'true') return;
    const image = resolveSelectedImage(pane);
    if (!image) return;
    // Only intercept when this image is clearly the selection target, not when
    // the caret is already collapsed in ordinary surrounding text.
    const selection = getSelection();
    const popover = state[state.currentMode]?.popover;
    const fromPopover = popover?._sourceElement === image && popover.style.display !== 'none';
    const fromMark = selected === image;
    const fromRange = selection?.rangeCount ? imageFromRange(selection.getRangeAt(0), pane) === image : false;
    if (!fromMark && !fromPopover && !fromRange) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    placeCaretBeside(image, event.key === 'ArrowRight');
  };
  const cancel = () => {gesture=null;cancelAnimationFrame(frame);frame=0;};
  window.addEventListener('mousedown',down,true);
  window.addEventListener('mousemove',move,true);
  window.addEventListener('mouseup',up,true);
  window.addEventListener('click',click,true);
  window.addEventListener('keydown',onKey,true);
  window.addEventListener('blur',cancel);
  window.addEventListener('pagehide',()=>{
    cancel(); clearSelected();
    window.removeEventListener('mousedown',down,true); window.removeEventListener('mousemove',move,true);
    window.removeEventListener('mouseup',up,true); window.removeEventListener('click',click,true);
    window.removeEventListener('keydown',onKey,true); window.removeEventListener('blur',cancel);
  },{once:true});
}
