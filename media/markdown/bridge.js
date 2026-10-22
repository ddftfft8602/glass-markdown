/* Standalone host adapter for the MIT-licensed Office Viewer component. */
(() => {
  const api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : window.__glassTestApi;
  const listeners = new Map();
  const clipboardRequests = new Map();
  let clipboardId = 0;
  let version = 0, seq = 0, inflight, pending, saveRequested = false, ready = false, applying = false, dirty = false;
  const post = (type, data) => api.postMessage({ type, data });
  const value = () => window.glassRawVisible ? window.glassRaw.value : window.glassEditor?.getValue() || '';
  function pump() {
    if (inflight || !ready) return;
    if (pending !== undefined) {
      inflight = { value: pending, seq: ++seq, baseVersion: version }; pending = undefined; post('change', inflight);
    } else if (saveRequested) { saveRequested = false; post('save'); }
  }
  function change(text) { if (ready && !applying) { dirty = true; pending = text; pump(); } }
  function dispatch(type, data) {
    if (type === 'save') return change(data);
    if (type === 'doSave') { if (dirty || window.glassRawVisible) change(window.glassRawVisible ? value() : data); saveRequested = true; return pump(); }
    if (type === 'queryAIAvailable') { requestAnimationFrame(() => { window.glassEditor?.clearStack(); ready = true; post('ready'); }); return; }
    if (['telemetry','queryVSCodeModels','openProPanel','aiPolish','aiPolishCancel'].includes(type)) return;
    if (type === 'command') { if (data === 'office.markdown.paste') post('paste'); return; }
    if (type === 'syncViewerSettings') return post('settings', data);
    if (type === 'img') return post('image', { base64: btoa(data.data), ext: data.ext });
    if (type === 'export') {
      if (window.glassRawVisible) window.glassEditor.setValue(value());
      return post('export', { ...data, html: window.glassEditor.getHTML(), markdown: value(), title: window.__officeMarkdownFileName });
    }
    post(type, data);
  }
  function receive(type, data) {
    if (type === 'clipboardResult') {
      const request = clipboardRequests.get(data?.id);
      if (request) { clearTimeout(request.timer); clipboardRequests.delete(data.id); data.error ? request.reject(new Error(data.error)) : request.resolve(data.text || ''); }
      return;
    }
    if (type === 'open') {
      version = data.version;
      // This separate MIT derivative uses the local component capabilities.
      // It does not contact or impersonate the official activation service.
      data.config = { codeMirrorTheme: 'Auto', mermaidTheme: 'default', ...data.config, isPro: true, isProCancelled: false, isWeb: false, isDev: false, markdown: {} };
      data.documentCacheId = 'glass:' + data.documentBaseUrl + '/' + data.fileName;
      data.viewerSettings = { enabled: true, settings: { globalSettings: { editorFontFamily: 'inherit', editorFontSize: 16, editorLineHeight: 1.7, outlineEnable: false, ...data.settings?.globalSettings }, aiPreferences: {} } };
    }
    if (type === 'ack') { if (inflight?.seq === data.seq) { version = data.version; inflight = undefined; pump(); } return; }
    if (type === 'update' || type === 'conflict') {
      if (type === 'conflict' || inflight || pending !== undefined) {
        post('recover', value()); inflight = undefined; pending = undefined; saveRequested = false;
      }
      version = data.version; applying = true;
      if (window.glassRawVisible) window.glassRaw.value = data.value;
      listeners.get('update')?.(data.value); applying = false; return;
    }
    if (type === 'saved') { dirty = false; window.glassEditor?.markSaved(); return; }
    if (type === 'settings') { listeners.get('viewerSettings')?.(data); return; }
    if (type === 'showExport') { window.glassShowExport?.(); return; }
    if (type === 'history') { window.glassRunHistory?.(data); return; }
    if (type === 'paste') {
      const ed = window.glassEditor;
      if (ed && window.glassPasteTableIntoCell?.(ed, '', typeof data === 'string' ? data : '')) return;
      ed?.insertMarkdown(data); return;
    }
    if (type === 'error') { window.glassEditor?.tip(String(data), 6000); return; }
    listeners.get(type)?.(data);
  }
  window.handler = window.vscodeEvent = {
    on(type, callback) { listeners.set(type, callback); return this; },
    emit(type, data) { dispatch(type, data); return this; }
  };
  window.glassHost = { post, receive, change, clipboard(action, text) {
    return new Promise((resolve, reject) => {
      const id = ++clipboardId;
      const timer = setTimeout(() => { clipboardRequests.delete(id); reject(new Error('剪贴板响应超时')); }, 10000);
      clipboardRequests.set(id, { resolve, reject, timer }); post('clipboard', { id, action, text });
    });
  } };
  window.isCompose = event => event.ctrlKey || event.metaKey;
  window.addEventListener('message', e => receive(e.data.type, e.data.data));
})();
