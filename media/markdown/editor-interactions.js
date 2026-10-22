export function installEditorInteractions(editor) {
  const root = editor.vditor.element;
  const runHistory = action => {
    if (!['undo', 'redo'].includes(action)) return;
    const active = document.activeElement;
    const cm = active?.closest('.cm-editor');
    if (cm && root.contains(cm)) {
      window.glassCodeMirrorHistory(cm, action === 'redo');
      return;
    }
    if (active?.matches('input,textarea') || active?.closest('.glass-footnote-popup')) {
      document.execCommand(action); return;
    }
    const state = editor.vditor, pane = state[state.currentMode]?.element;
    if (pane?.contains(active)) state.undo[action](state);
  };
  window.glassRunHistory = runHistory;
  const historyKey = event => {
    if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    const action = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && !event.shiftKey ? 'redo' : null;
    if (!action || !root.contains(event.target) || event.target.closest('input,textarea,.glass-footnote-popup')) return;
    event.preventDefault(); event.stopImmediatePropagation(); runHistory(action);
  };
  window.addEventListener('keydown', historyKey, true);
  const inlinePreview = node => {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const preview = element?.closest('.vditor-wysiwyg__preview, .vditor-ir__preview');
    return preview?.closest('[data-type="math-inline"]') ||
      preview?.parentElement.querySelector(':scope > code[data-type="math-inline"]');
  };
  const keepMathSelection = event => {
    const state = editor.vditor, pane = state[state.currentMode]?.element;
    const selection = getSelection();
    if (!pane?.contains(event.target) || !selection?.rangeCount || selection.isCollapsed) return;
    // A text note consumes the first click to show its popup. Its second
    // click intentionally opens an embedded formula, rather than completing
    // the ordinary drag selection that this guard protects.
    if (event.detail >= 2 && inlinePreview(event.target) && event.target.closest('.glass-text-note')) return;
    const range = selection.getRangeAt(0);
    if (!pane.contains(range.commonAncestorContainer)) return;
    // A drag emits click after mouseup. The upstream click handler also uses
    // the range's start preview as a fallback, even when the pointer is now on
    // ordinary text. Opening CodeMirror there collapses the completed selection.
    if (!inlinePreview(event.target) && !inlinePreview(range.startContainer) &&
        !inlinePreview(range.endContainer)) return;
    state[state.currentMode].range = range.cloneRange();
    event.stopPropagation();
  };
  root.addEventListener('click', keepMathSelection, true);
  const keepMathFocus = event => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const chrome = target?.closest('.vditor-cm-chrome');
    const formula = chrome?.closest('[data-type="math-block"].vditor-cm-block--editing');
    if (!formula || !root.contains(formula)) return;
    // The first click expands a formula underneath the pointer. The second
    // click can hit its new readonly language header instead of the source.
    // Do not let that inert header focus the outer editor and trigger blur.
    const control = target.closest('button:not(:disabled), input, textarea, select, a[href], [contenteditable="true"]');
    if (control && chrome.contains(control)) return;
    event.preventDefault(); event.stopPropagation();
    formula.querySelector('.cm-content')?.focus({ preventScroll: true });
  };
  for (const type of ['mousedown', 'click', 'dblclick']) root.addEventListener(type, keepMathFocus, true);

  const switchTab = event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing ||
        !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (!root.contains(event.target) && !root.contains(document.activeElement)) return;
    // CodeMirror stops consumed key events before they reach the outer webview.
    // Capture only the requested chord and let the host select the adjacent tab.
    event.preventDefault(); event.stopImmediatePropagation();
    handler.emit('switchEditor', event.key === 'ArrowLeft' ? 'previous' : 'next');
  };
  window.addEventListener('keydown', switchTab, true);
  window.addEventListener('pagehide', () => {
    window.removeEventListener('keydown', historyKey, true);
    if (window.glassRunHistory === runHistory) delete window.glassRunHistory;
    root.removeEventListener('click', keepMathSelection, true);
    for (const type of ['mousedown', 'click', 'dblclick']) root.removeEventListener(type, keepMathFocus, true);
    window.removeEventListener('keydown', switchTab, true);
  }, { once: true });
}
