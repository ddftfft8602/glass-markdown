import { tableClipboard, installTableClipboard } from './table-clipboard.js';
import { mathClipboard } from './math-clipboard.js';
// Local UI additions. Formatting is delegated to the editor's existing commands.
const icon = name => name === 'scissors' ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12 12M8.2 15.8 20.2 3.8"/></svg>' : `<span class="codicon codicon-${name}" aria-hidden="true"></span>`;
const button = (action, name, label, extra = '') => `<button type="button" data-glass-action="${action}" aria-label="${label}" title="${label}" ${extra}>${icon(name)}</button>`;
const nativeCommand = (name, value) => Document.prototype.execCommand.call(document, name, false, value);
const toolbarButton = name => document.querySelector(`.vditor-toolbar button[data-type="${name}"]`);
const escapeMarkdown = text => text.replace(/[\\`*_{}\[\]()#+.!|>~$<>=-]/g, '\\$&');

export function installCompactUi(editor, exportFile) {
  installTableClipboard(editor);
  const container = document.getElementById('vditor');
  const menu = document.getElementById('context-menu');
  const dock = document.createElement('div');
  dock.id = 'glass-floating-tools'; dock.hidden = true;
  dock.setAttribute('role', 'toolbar'); dock.setAttribute('aria-label', '精简编辑工具');
  dock.innerHTML = button('outline', 'list-tree', '展开 / 收起目录', 'aria-pressed="false"') + button('expand', 'chevron-down', '展开工具栏');
  container.append(dock);
  let compact = false;
  const syncOutline = () => dock.querySelector('[data-glass-action="outline"]').setAttribute('aria-pressed', String(!!editor.vditor?.options.outline.enable));
  const setCompact = value => {
    // Leave the editable pane and its selection in place; only change the toolbar layout.
    const scroller = editor.vditor?.[editor.vditor.currentMode]?.element;
    const scrollTop = scroller?.scrollTop;
    compact = value;
    document.body.classList.toggle('glass-compact', compact); dock.hidden = !compact;
    try { localStorage.setItem('glass.compactToolbar', String(compact)); } catch {}
    requestAnimationFrame(() => { if (scroller) scroller.scrollTop = scrollTop; });
    syncOutline();
  };
  window.glassToggleCompact = () => setCompact(!compact);
  try { if (localStorage.getItem('glass.compactToolbar') === 'true') setCompact(true); } catch {}
  dock.addEventListener('pointerdown', e => e.preventDefault());
  dock.addEventListener('click', e => {
    const action = e.target.closest('button')?.dataset.glassAction;
    if (action === 'expand') setCompact(false);
    if (action === 'outline') { toolbarButton('outline')?.click(); syncOutline(); }
  });
  document.addEventListener('pointermove', e => {
    if (!compact) return;
    const b = dock.getBoundingClientRect();
    dock.classList.toggle('is-near', e.clientX >= b.left - 64 && e.clientX <= b.right + 64 && e.clientY >= b.top - 64 && e.clientY <= b.bottom + 64);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => dock.classList.remove('is-near'));

  menu.classList.add('glass-context-menu');
  // Theme variables are defined on the editor root.
  container.append(menu);
  menu.innerHTML = `<div class="glass-menu-row glass-clipboard-row" role="group" aria-label="剪贴板">
    ${button('cut','scissors','剪切 · Ctrl+X')}${button('copy','copy','复制 · Ctrl+C')}${button('paste','clippy','粘贴 · Ctrl+V')}${button('plain-paste','symbol-string','粘贴为纯文本 · Ctrl+Shift+V')}
  </div><div class="glass-menu-row glass-format-row" role="group" aria-label="文字格式">
    ${button('bold','bold','加粗 · Ctrl+B')}${button('italic','italic','斜体 · Ctrl+I')}${button('strike','strikethrough','删除线')}${button('font-color','symbol-color','文字颜色')}${button('background-color','paintcan','背景高亮')}${button('link','link','链接')}${button('clear','clear-all','清除文字格式')}
  </div><div class="glass-menu-footer">
    <button type="button" data-glass-panel="paragraph" aria-expanded="true">段落格式 ${icon('chevron-down')}</button>
    <button type="button" data-glass-panel="more" aria-expanded="false">更多操作 ${icon('chevron-down')}</button>
  </div><div class="glass-subpanel" data-panel="paragraph">
    <div class="glass-heading-row">${['正文','H1','H2','H3','H4','H5','H6'].map((label,i)=>`<button type="button" data-glass-action="heading-${i}" title="${i ? i+' 级标题' : '正文'}">${label}</button>`).join('')}</div>
    <div class="glass-menu-row">${button('quote','quote','引用')}${button('list','list-unordered','项目符号')}${button('ordered-list','list-ordered','编号列表')}${button('check','tasklist','任务列表')}${button('footnote','comment','插入脚注')}</div>
  </div><div class="glass-subpanel glass-more-panel" data-panel="more" hidden>
    <button type="button" data-glass-action="copy-html">${icon('code')} 复制为 HTML</button>
    <button type="button" data-glass-action="copy-plain">${icon('symbol-string')} 复制为纯文本</button>
    <button type="button" data-glass-action="export-pdf">${icon('file-pdf')} 导出 PDF</button>
    <button type="button" data-glass-action="export-docx">${icon('file-text')} 导出 Word</button>
    <button type="button" data-glass-action="export-html">${icon('code')} 导出 HTML</button>
    <button type="button" data-glass-action="image">${icon('file-media')} 插入图片</button>
    <button type="button" data-glass-action="folder">${icon('folder-opened')} 在文件夹中显示</button>
  </div>`;
  let saved, rightClickSelection, anchor = { x: 0, y: 0 }, popup;
  const capture = () => {
    const raw = window.glassRawVisible && window.glassRaw;
    if (raw) return { raw, start: raw.selectionStart, end: raw.selectionEnd };
    const selection = getSelection();
    if (!selection?.rangeCount || !container.contains(selection.anchorNode)) return null;
    const pane = selection.anchorNode.parentElement?.closest('[contenteditable="true"]');
    // CodeMirror renders lines as separate divs. Range.toString() concatenates
    // them, whereas the live selection includes the required source newlines.
    return { range: selection.getRangeAt(0).cloneRange(), pane,
      codeText: pane?.closest('.cm-editor') ? selection.toString() : undefined };
  };
  const restore = () => {
    if (saved?.raw) { saved.raw.focus({ preventScroll: true }); saved.raw.setSelectionRange(saved.start, saved.end); return; }
    if (!saved?.range?.startContainer.isConnected || !saved.range.endContainer.isConnected) return;
    saved.pane?.focus({ preventScroll: true });
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(saved.range);
  };
  const selectedText = () => saved?.raw ? saved.raw.value.slice(saved.start, saved.end) : saved?.codeText ?? saved?.range?.toString() ?? '';
  const selectedHtml = () => { const box = document.createElement('div'); if (saved?.range) box.append(saved.range.cloneContents()); return box.innerHTML; };
  container.addEventListener('pointerdown', e => {
    rightClickSelection = e.button === 2 ? capture() : null;
    if (rightClickSelection?.range?.collapsed) rightClickSelection = null;
  }, true);
  const closePopup = () => { if (popup) { popup.style.display = 'none'; popup.classList.remove('glass-native-panel'); popup = null; } };
  const closeMenu = () => { menu.hidden = true; };
  const place = (element, x, y) => {
    const padding = 8, bounds = element.getBoundingClientRect();
    element.style.left = `${Math.max(padding, Math.min(x, innerWidth - bounds.width - padding))}px`;
    element.style.top = `${Math.max(padding, Math.min(y, innerHeight - bounds.height - padding))}px`;
    if (element.classList.contains('glass-native-panel')) {
      container.style.setProperty('--glass-popup-x', element.style.left);
      container.style.setProperty('--glass-popup-y', element.style.top);
    }
  };
  const nativePanel = name => {
    const tool = toolbarButton(name);
    if (!tool || !selectedText()) return;
    // A context-menu click can leave the toolbar's cached selection state stale.
    // The captured editor range has already been restored above.
    tool.classList.remove('vditor-menu--disabled');
    tool.click();
    popup = tool.parentElement.querySelector('.vditor-hint');
    if (popup) { popup.classList.add('glass-native-panel'); popup.style.display = 'block'; place(popup, anchor.x, anchor.y); }
  };
  const writeText = text => window.glassHost.clipboard('write', text);
  const readText = () => window.glassHost.clipboard('read');
  const copy = async (as = '') => {
    const table = tableClipboard(editor, saved?.range) || mathClipboard(editor, saved?.range);
    const text = table?.text ?? selectedText();
    const html = table?.html ?? selectedHtml();
    if (as === 'html') return writeText(html || text);
    if (!as && !saved?.raw && navigator.clipboard?.write && window.ClipboardItem) {
      try { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]); return; } catch {}
    }
    await writeText(text);
  };
  const insertPlain = text => {
    restore();
    if (saved?.raw) {
      saved.raw.setRangeText(text, saved.start, saved.end, 'end');
      saved.raw.dispatchEvent(new Event('input', { bubbles: true }));
    } else nativeCommand('insertText', text);
  };
  const changeHeading = level => {
    // The native heading menu handles Markdown normalization and undo history.
    const tool = toolbarButton('headings');
    if (level === '0') {
      const node = saved?.range?.startContainer;
      const heading = (node?.nodeType === 1 ? node : node?.parentElement)?.closest('h1,h2,h3,h4,h5,h6');
      if (!heading) return;
      // The heading toolbar button toggles the current heading back to a paragraph.
      tool?.classList.add('vditor-menu--current'); tool?.click(); return;
    }
    tool?.click();
    const choice = tool?.parentElement.querySelector(`[data-tag="h${level}"]`);
    if (choice) choice.click();
  };
  const clearFormat = () => {
    const range = saved?.range;
    const boundary = node => (node.nodeType === 1 ? node : node.parentElement)?.closest('[data-type="html-inline"][data-md-source]');
    const first = range && boundary(range.startContainer), last = range && boundary(range.endContainer);
    if (!first && !last) {
      if (range?.cloneContents().querySelector('[data-type="html-inline"]')) editor.insertMarkdown(escapeMarkdown(selectedText()));
      else { nativeCommand('removeFormat'); nativeCommand('unlink'); }
      return;
    }
    const text = selectedText();
    const styled = (element, text) => {
      if (!text) return '';
      const span = document.createElement('span');
      const source = new DOMParser().parseFromString(element.dataset.mdSource, 'text/html').body.firstElementChild;
      // Preserve the unselected part's local color/highlight, without copying other HTML.
      for (const property of ['color','background-color']) if (source?.style.getPropertyValue(property)) span.style.setProperty(property, source.style.getPropertyValue(property));
      span.textContent = text; return span.outerHTML;
    };
    let before = '', after = '';
    if (first) { const prefix = range.cloneRange(); prefix.selectNodeContents(first); prefix.setEnd(range.startContainer, range.startOffset); before = styled(first, prefix.toString()); }
    if (last) { const suffix = range.cloneRange(); suffix.selectNodeContents(last); suffix.setStart(range.endContainer, range.endOffset); after = styled(last, suffix.toString()); }
    if (first) range.setStartBefore(first);
    if (last) range.setEndAfter(last);
    restore(); editor.insertMarkdown(before + escapeMarkdown(text) + after);
  };
  menu.addEventListener('pointerdown', e => { if (e.target.closest('button')) e.preventDefault(); });
  menu.addEventListener('click', async e => {
    const toggle = e.target.closest('[data-glass-panel]');
    if (toggle) {
      const opened = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(opened));
      menu.querySelector(`[data-panel="${toggle.dataset.glassPanel}"]`).hidden = !opened;
      place(menu, anchor.x, anchor.y); return;
    }
    const item = e.target.closest('[data-glass-action]');
    if (!item || item.disabled) return;
    const action = item.dataset.glassAction;
    closeMenu(); restore();
    try {
      if (action === 'copy' || action === 'copy-plain' || action === 'copy-html') await copy(action === 'copy' ? '' : action.slice(5));
      else if (action === 'cut') { await copy(); insertPlain(''); }
      else if (action === 'paste' || action === 'plain-paste') {
        const text = await readText(); restore();
        if (saved?.raw) insertPlain(text);
        else if (action === 'plain-paste') {
          if (window.glassPasteTableIntoCell?.(editor, '', text)) { /* table into cells */ }
          else editor.insertMarkdown(escapeMarkdown(text));
        }
        else if (window.glassPasteTableIntoCell?.(editor, '', text)) { /* table cells filled in place */ }
        else editor.insertMarkdown(text);
      }
      else if (action === 'clear') clearFormat();
      else if (action === 'footnote') window.glassInsertFootnote?.();
      else if (action === 'font-color' || action === 'background-color') nativePanel(action);
      else if (action.startsWith('heading-')) changeHeading(action.slice(8));
      else if (action.startsWith('export-')) exportFile(action.slice(7));
      else if (action === 'image') handler.emit('insertImage');
      else if (action === 'folder') handler.emit('showInFolder');
      else toolbarButton(action)?.click();
    } catch (error) { editor.tip(`操作未完成：${error.message || error}`, 5000); }
  });
  container.addEventListener('contextmenu', e => {
    const target = e.target.closest?.('.vditor-reset, #glass-source');
    if (!target) return;
    e.preventDefault(); e.stopPropagation(); closePopup(); saved = rightClickSelection || capture(); rightClickSelection = null;
    // The upstream editor treats styled HTML spans as atomic inline objects.
    // Right-clicking one should still allow copying or clearing that object's style.
    const inline = e.target.closest?.('[data-type="html-inline"][data-md-source]');
    if (inline && (!saved?.range || saved.range.collapsed)) {
      const range = document.createRange(); range.selectNode(inline);
      saved = { range, pane: inline.closest('[contenteditable="true"]') }; restore();
    }
    if (!saved) return;
    anchor = { x: e.clientX, y: e.clientY };
    menu.querySelectorAll('[data-panel]').forEach(n => { n.hidden = n.dataset.panel !== 'paragraph'; });
    menu.querySelectorAll('[data-glass-panel]').forEach(n => n.setAttribute('aria-expanded', String(n.dataset.glassPanel === 'paragraph')));
    const hasText = !!selectedText();
    menu.querySelectorAll('[data-glass-action]').forEach(n => {
      const a = n.dataset.glassAction;
      n.disabled = (['copy','copy-plain','copy-html','cut','clear','font-color','background-color','link'].includes(a) && !hasText)
        || ((n.closest('.glass-format-row') || n.closest('[data-panel="paragraph"]')) && (!!saved.raw || !!saved.pane?.closest('.cm-editor')));
    });
    menu.hidden = false; place(menu, anchor.x, anchor.y);
  });
  document.addEventListener('pointerdown', e => {
    if (!menu.contains(e.target)) closeMenu();
    if (popup && !popup.contains(e.target)) closePopup();
  });
  document.addEventListener('scroll', e => { if (!menu.contains(e.target) && !popup?.contains(e.target)) { closeMenu(); closePopup(); } }, true);
  window.addEventListener('resize', () => { closeMenu(); closePopup(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && (!menu.hidden || popup)) { closeMenu(); closePopup(); restore(); e.preventDefault(); e.stopPropagation(); return; }
    if (menu.hidden || !['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    const items = [...menu.querySelectorAll('button:not(:disabled)')].filter(n => n.getClientRects().length);
    let i = items.indexOf(document.activeElement), step = ['ArrowLeft','ArrowUp'].includes(e.key) ? -1 : 1;
    i = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + step + items.length) % items.length;
    items[i]?.focus({ preventScroll: true }); e.preventDefault();
  });
}
