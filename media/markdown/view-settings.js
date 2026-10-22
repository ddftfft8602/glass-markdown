const fields = [
  { key: 'paragraphSpacingBefore', label: '段前间距' },
  { key: 'paragraphSpacingAfter', label: '段后间距' },
  { key: 'notePopupWidth', label: '备注弹窗宽度', min: 220, max: 900, default: 360, group: 'note' },
  { key: 'notePopupHeight', label: '备注弹窗最大高度', min: 120, max: 900, default: 420, group: 'note' },
  { key: 'noteFontSize', label: '备注文字字号', min: 10, max: 32, default: 14, group: 'note' },
];
const normalize = (value, field = fields[0]) => typeof value === 'number' && Number.isFinite(value) ? Math.max(field.min ?? 0, Math.min(field.max ?? 96, Math.round(value))) : undefined;

export function installViewSettings(editor) {
  const root = editor.vditor.element, toolbar = editor.vditor.toolbar.element;
  let applying = false, previousSettings;
  const preserveDraft = (input, key, settings) => document.activeElement === input && previousSettings && previousSettings[key] === settings[key];
  // Native settings used to replace innerHTML on every apply. Reconcile the
  // stable panel structure instead, keeping the focused node and custom rows.
  window.glassRefreshSettingsPanel = (panel, html) => {
    const template = document.createElement('template'); template.innerHTML = html;
    const settings = editor.exportViewerSettings().globalSettings || {};
    const update = (current, next) => {
      if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) { current.replaceWith(next.cloneNode(true)); return; }
      if (current.nodeType === Node.TEXT_NODE) { if (current.data !== next.data) current.data = next.data; return; }
      if (current.nodeType !== Node.ELEMENT_NODE) return;
      if (current instanceof HTMLInputElement) {
        const key = current.hasAttribute('data-lh-value') ? 'editorLineHeight' : null;
        if (!preserveDraft(current, key, settings) && current.value !== next.value) current.value = next.value;
      }
      for (const attr of [...current.attributes]) if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
      for (const attr of next.attributes) if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
      reconcile(current, next);
    };
    const reconcile = (current, next) => {
      const existing = [...current.childNodes].filter(node => !node.classList?.contains('glass-paragraph-settings'));
      [...next.childNodes].forEach((node, index) => existing[index] ? update(existing[index], node) : current.append(node.cloneNode(true)));
      existing.slice(next.childNodes.length).forEach(node => node.remove());
    };
    reconcile(panel, template.content);
  };
  const applySpacing = settings => {
    for (const field of fields) {
      const { key } = field;
      const value = normalize(settings?.globalSettings?.[key], field);
      root.classList.toggle(`glass-${key}`, value !== undefined);
      if (value === undefined) root.style.removeProperty(`--glass-${key}`);
      else root.style.setProperty(`--glass-${key}`, `${value}px`);
    }
  };
  const decorate = () => {
    const line = toolbar.querySelector('[data-lh-key]'); if (!line) return;
    const label = line.querySelector('.vditor-settings-panel__stepper-label');
    if (label.textContent !== '行间距（倍）') label.textContent = '行间距（倍）';
    line.querySelector('input')?.setAttribute('aria-label', '行间距（倍）');
    if (line.nextElementSibling?.classList.contains('glass-paragraph-settings')) {
      if (!applying) return;
      const settings = editor.exportViewerSettings().globalSettings || {};
      line.nextElementSibling.querySelector('[data-glass-latex-paste]').checked = settings.recognizeLatexPaste === true;
      for (const field of fields) {
        const input = line.nextElementSibling.querySelector(`[data-glass-spacing="${field.key}"]`);
        if (preserveDraft(input, field.key, settings)) continue;
        const value = normalize(settings[field.key], field), text = value === undefined ? '' : String(value);
        if (input.value !== text) input.value = text;
      }
      return;
    }
    const settings = editor.exportViewerSettings().globalSettings || {}, section = document.createElement('div');
    section.className = 'glass-paragraph-settings';
    const mathHeading = document.createElement('div'); mathHeading.className = 'glass-note-settings-heading'; mathHeading.textContent = '公式识别';
    const mathRow = document.createElement('label'); mathRow.className = 'glass-latex-setting';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.glassLatexPaste = ''; checkbox.checked = settings.recognizeLatexPaste === true;
    mathRow.append(checkbox, document.createTextNode('粘贴时识别无美元符号公式'));
    const help = document.createElement('div'); help.className = 'glass-latex-help';
    help.textContent = '识别 \\(…\\)、\\[…\\] 和 (\\epsilon) 这类公式，保留表格和加粗。公式保存为 $…$ / $$…$$；代码保持原样。';
    section.append(mathHeading, mathRow, help);
    for (const group of ['paragraph', 'note']) {
    if (group === 'note') {
      const heading = document.createElement('div'); heading.className = 'glass-note-settings-heading'; heading.textContent = '备注弹窗'; section.append(heading);
    }
    for (const field of fields.filter(field => (field.group || 'paragraph') === group)) {
      const { key, label } = field;
      const row = document.createElement('label'); row.className = 'vditor-settings-panel__stepper-row';
      row.innerHTML = `<span class="vditor-settings-panel__stepper-label">${label} <small>px</small></span><input class="glass-spacing-input" type="number" min="${field.min ?? 0}" max="${field.max ?? 96}" step="1" placeholder="${field.default ?? '默认'}" aria-label="${label}（像素）" data-glass-spacing="${key}">`;
      const value = normalize(settings[key], field); row.querySelector('input').value = value === undefined ? '' : String(value);
      section.append(row);
    }
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'glass-spacing-reset';
    reset.textContent = group === 'note' ? '恢复默认备注弹窗' : '恢复默认段落间距'; reset.dataset.glassSpacingReset = group; section.append(reset);
    }
    line.after(section);
  };
  const originalApply = editor.applyViewerSettings.bind(editor);
  editor.applyViewerSettings = settings => {
    applying = true;
    previousSettings = editor.exportViewerSettings().globalSettings || {};
    try {
      const panel = toolbar.querySelector('[data-type="settings"]')?.parentElement.querySelector('.vditor-hint');
      const wasOpen = panel && getComputedStyle(panel).display !== 'none';
      const scrolling = panel ? [panel, ...panel.querySelectorAll('*')].filter(node => node.scrollTop || node.scrollLeft).map(node => ({node, top:node.scrollTop, left:node.scrollLeft})) : [];
      originalApply(settings); applySpacing(settings); decorate();
      if (wasOpen) {
        panel.style.display = 'block';
        for (const {node, top, left} of scrolling) { node.scrollTop = top; node.scrollLeft = left; }
      }
    } finally { applying = false; previousSettings = undefined; }
  };
  toolbar.addEventListener('change', event => { if (applying) event.stopImmediatePropagation(); }, true);
  const originalChange = editor.vditor.options.onSettingsChange;
  editor.vditor.options.onSettingsChange = settings => { applySpacing(settings); originalChange?.(settings); };
  const observer = new MutationObserver(decorate);
  observer.observe(toolbar, { childList: true, subtree: true });
  const commit = (key, value, group = 'paragraph') => {
    const settings = editor.exportViewerSettings();
    if (key) {
      if (value === undefined) delete settings.globalSettings[key]; else settings.globalSettings[key] = value;
    } else for (const field of fields.filter(field => (field.group || 'paragraph') === group)) delete settings.globalSettings[field.key];
    // Use the editor's existing store and host sync; appearance is not Markdown.
    editor.applyViewerSettings(settings); editor.vditor.options.onSettingsChange?.(settings);
  };
  toolbar.addEventListener('input', event => {
    const input = event.target.closest('[data-glass-spacing]'); if (!input) return;
    const value = input.value === '' ? undefined : normalize(input.valueAsNumber, fields.find(field => field.key === input.dataset.glassSpacing));
    if (input.value !== '' && value === undefined) return;
    const settings = editor.exportViewerSettings(); settings.globalSettings[input.dataset.glassSpacing] = value; applySpacing(settings);
  });
  toolbar.addEventListener('change', event => {
    if (event.target.matches('[data-glass-latex-paste]')) {
      commit('recognizeLatexPaste', event.target.checked); return;
    }
    const input = event.target.closest('[data-glass-spacing]'); if (!input) return;
    const key = input.dataset.glassSpacing, focused = document.activeElement === input;
    const value = input.value === '' ? undefined : normalize(input.valueAsNumber, fields.find(field => field.key === key));
    input.value = value === undefined ? '' : String(value);
    commit(key, value);
    if (focused) toolbar.querySelector(`[data-glass-spacing="${key}"]`)?.focus({ preventScroll: true });
  });
  toolbar.addEventListener('click', event => {
    const button = event.target.closest('[data-glass-spacing-reset]'); if (!button) return;
    const group = button.dataset.glassSpacingReset;
    event.preventDefault(); event.stopPropagation(); commit(null, undefined, group);
    toolbar.querySelector(`[data-glass-spacing-reset="${group}"]`)?.focus({ preventScroll: true });
  });
  applySpacing(editor.exportViewerSettings()); decorate();
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}
