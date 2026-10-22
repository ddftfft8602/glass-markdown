// Keep the two viewports independently. Merely looking at source must not
// rebuild the rendered document, clear undo history or focus its final block.
export function installSourceView(editor) {
  let session, lastRaw, generation = 0;
  const pane = () => editor.vditor[editor.vditor.currentMode].element;
  const snapshot = element => ({ element, top: element.scrollTop, left: element.scrollLeft });
  const restore = items => items.forEach(({ element, top, left }) => { element.scrollTop = top; element.scrollLeft = left; });
  window.glassToggleRaw = () => {
    const current = pane(), content = editor.vditor.element.querySelector('.vditor-content');
    if (!window.glassRaw) {
      const raw = document.createElement('textarea'); raw.id = 'glass-source'; raw.spellcheck = false; raw.hidden = true;
      raw.setAttribute('aria-label', 'Markdown 源码'); raw.addEventListener('input', () => glassHost.change(raw.value));
      content.append(raw); window.glassRaw = raw;
    }
    const raw = window.glassRaw, turn = ++generation;
    if (!window.glassRawVisible) {
      const value = editor.getValue(), selection = getSelection();
      const range = selection.rangeCount && current.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
      const scroll = [current, current.parentElement, content].map(snapshot);
      session = { value, scroll, range };
      const reuse = lastRaw && lastRaw.value === value && lastRaw.mode === editor.vditor.currentMode && Math.abs(lastRaw.visualTop - current.scrollTop) < 2;
      const ratio = current.scrollTop / Math.max(1, current.scrollHeight - current.clientHeight);
      if (raw.value !== value) raw.value = value;
      window.glassRawVisible = true; raw.hidden = false; document.body.classList.add('glass-source-open');
      const offset = reuse ? lastRaw.start : Math.max(0, value.lastIndexOf('\n', Math.floor(value.length * ratio)) + 1);
      raw.setSelectionRange(offset, reuse ? lastRaw.end : offset, reuse ? lastRaw.direction : 'none');
      raw.focus({ preventScroll: true });
      raw.scrollTop = reuse ? lastRaw.top : ratio * Math.max(0, raw.scrollHeight - raw.clientHeight);
      raw.scrollLeft = reuse ? lastRaw.left : 0;
    } else {
      lastRaw = { value: raw.value, mode: editor.vditor.currentMode, start: raw.selectionStart, end: raw.selectionEnd, direction: raw.selectionDirection, top: raw.scrollTop, left: raw.scrollLeft };
      const changed = raw.value !== session.value;
      if (changed) editor.setValue(raw.value);
      window.glassRawVisible = false; raw.hidden = true; document.body.classList.remove('glass-source-open');
      current.focus({ preventScroll: true });
      if (session.range?.startContainer.isConnected && session.range?.endContainer.isConnected) {
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(session.range);
      }
      restore(session.scroll); lastRaw.visualTop = current.scrollTop;
      // Focus can schedule a native caret update and then a hint/layout update
      // on the following frame. Keep their scroll anchoring from nudging the
      // restored viewport; stale callbacks after another toggle do nothing.
      const settle = () => { if (turn === generation && !window.glassRawVisible) { restore(session.scroll); return true; } return false; };
      requestAnimationFrame(() => { if (settle()) requestAnimationFrame(settle); });
    }
  };
}
