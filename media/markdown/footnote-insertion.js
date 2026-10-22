import { definitionLabel } from './footnote-references.js';

let inserting = null;

function existingNotes(pane) {
  const notes = new Map();
  for (const definition of pane.querySelectorAll('[data-type="footnotes-li"],[data-type="footnotes-def"]')) {
    const id = definitionLabel(definition); if (!id || notes.has(id)) continue;
    const copy = definition.cloneNode(true);
    if (copy.dataset.type === 'footnotes-def' && copy.firstChild?.nodeType === Node.TEXT_NODE) copy.firstChild.remove();
    copy.querySelectorAll('.vditor-ir__marker:not(code),.vditor-wysiwyg__preview,.vditor-ir__preview,.vditor-cm-host,wbr').forEach(node=>node.remove());
    const preview = copy.textContent.replace(/\u200b/g,'').trim();
    notes.set(id,{id,preview});
  }
  return [...notes.values()];
}

export function installFootnoteInsertion(editor) {
  let dialog;
  window.glassInsertFootnote = () => {
    if (dialog) { dialog.querySelector('select,textarea').focus(); return; }
    const pane = editor.vditor[editor.vditor.currentMode]?.element;
    const selection = getSelection();
    const range = selection?.rangeCount ? (window.glassMathClipboardRange?.(selection.getRangeAt(0)) || selection.getRangeAt(0).cloneRange()) : null;
    const end = range?.endContainer.nodeType === Node.ELEMENT_NODE ? range?.endContainer : range?.endContainer.parentElement;
    const protectedNode = end?.closest('pre,code,.cm-editor,[data-type="footnotes-block"],[contenteditable="false"]');
    if (window.glassRawVisible || !range || !pane?.contains(range.startContainer) || !pane.contains(range.endContainer) ||
        (protectedNode && protectedNode !== pane)) {
      editor.tip('请先在正文中放置光标或选中文字，再插入脚注。', 3500); return;
    }
    const before = editor.getValue();
    const mode = editor.vditor.currentMode, notes = existingNotes(pane);
    const used = new Set([...before.matchAll(/\[\^([^\]\r\n]+)\]/g)].map(match => match[1]));
    const textNote = !range.collapsed;
    let number = 1, id;
    do { id = textNote ? `note-${number++}` : String(number++); } while (used.has(id));
    dialog = document.createElement('div'); dialog.className = 'glass-note-dialog-backdrop';
    dialog.innerHTML = `<form class="glass-note-dialog" role="dialog" aria-modal="true" aria-labelledby="glass-note-title">
      <h3 id="glass-note-title">${textNote ? '为选中文字添加备注' : '插入脚注'}</h3><p>${textNote ? '所选文字变色，单击查看备注，双击编辑文字。' : '在光标处加入脚注编号。'}备注保存在当前文件中。</p>
      ${notes.length ? '<label for="glass-note-choice">选择备注</label><select id="glass-note-choice"><option value="">新建备注</option></select>' : ''}
      <label for="glass-note-body" data-body-label>备注内容 <span>支持 Markdown</span></label>
      <textarea id="glass-note-body" rows="5" placeholder="填写备注内容……" required></textarea>
      <div class="glass-note-reuse-preview" hidden></div>
      <div><button type="button" data-cancel>取消</button><button type="submit">插入</button></div>
    </form>`;
    editor.vditor.element.append(dialog);
    const input = dialog.querySelector('textarea');
    const choice = dialog.querySelector('select'), preview = dialog.querySelector('.glass-note-reuse-preview');
    for (const [index,note] of notes.entries()) {
      const option = document.createElement('option'); option.value = note.id;
      option.textContent = `${index+1} · ${note.preview.replace(/\s+/g,' ').slice(0,90) || '空备注'}`;
      choice.append(option);
    }
    choice?.addEventListener('change',()=>{
      const note = notes.find(note=>note.id===choice.value);
      input.hidden = !!note; input.required = !note;
      dialog.querySelector('[data-body-label]').hidden = !!note;
      preview.hidden = !note; preview.textContent = note ? note.preview : '';
      dialog.querySelector('[type="submit"]').textContent = note ? '引用此备注' : '插入';
    });
    const restore = () => {
      if (!range.startContainer.isConnected || !range.endContainer.isConnected) return false;
      pane.focus({preventScroll:true}); selection.removeAllRanges(); selection.addRange(range); return true;
    };
    const close = () => { dialog?.remove(); dialog = null; };
    const cancel = () => { close(); restore(); };
    dialog.querySelector('[data-cancel]').addEventListener('click', cancel);
    dialog.addEventListener('mousedown', event => { if (event.target === dialog) cancel(); event.stopPropagation(); });
    dialog.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); dialog.querySelector('form').requestSubmit(); }
    });
    dialog.addEventListener('submit', event => {
      event.preventDefault(); event.stopPropagation();
      const reused = notes.find(note=>note.id===choice?.value);
      const note = input.value.trim(); if (!reused && !note) { input.focus(); return; }
      if (editor.getValue() !== before || editor.vditor.currentMode !== mode || !restore()) {
        close(); editor.tip('文档已变化，请重新选择位置插入脚注。', 4000); return;
      }
      let label = '';
      if (textNote) {
        const fragment = document.createElement('div'); fragment.append(range.cloneContents());
        label = (editor.vditor.currentMode === 'ir' ? editor.vditor.lute.VditorIRDOM2Md(fragment.innerHTML) : editor.vditor.lute.VditorDOM2Md(fragment.innerHTML)).trim();
        if (!label || /\n\s*\n/.test(label) || fragment.querySelector('a, [data-type="a"], [data-type="footnotes-ref"]')) {
          editor.tip('请选择同一段内尚未添加链接的文字。', 3500); input.focus(); return;
        }
      }
      selection.removeAllRanges(); selection.addRange(range);
      const targetId = reused?.id || id;
      close(); inserting = {reuse:!!reused};
      // The detached parser needs a definition to recognize the reference.
      // Reuse inserts only its reference; the existing definition stays intact.
      try { editor.insertMarkdown(`${textNote ? `[${label}](#footnote:${targetId})` : ''}[^${targetId}]\n\n[^${targetId}]: ${reused ? '.' : note.replace(/\r?\n/g, '\n    ')}\n`); }
      finally { inserting = null; }
    });
    (choice || input).focus({preventScroll:true});
  };
}

// Run inside the native paste transaction, so one undo removes both the
// reference and its definition, without serializing/replacing the whole paper.
window.glassInsertFootnoteFragment = (content, state, range) => {
  if (!inserting) return false;
  const reference = content.querySelector('[data-type="footnotes-ref"]');
  const definitions = content.querySelector('[data-type="footnotes-block"]');
  const pane = state[state.currentMode]?.element;
  if (!reference || !definitions || !pane?.contains(range.startContainer)) return false;
  // A reference following a formatted link should belong to the surrounding
  // sentence. Keep an insertion inside the middle of formatted text in place.
  const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
  const link = element.closest('a[href], [data-type="a"]');
  if (link) {
    const tail = range.cloneRange(); tail.setEnd(link, link.childNodes.length);
    const remaining = tail.cloneContents(); remaining.querySelectorAll('.vditor-ir__marker').forEach(n=>n.remove());
    if (!remaining.textContent.replace(/\u200b/g,'')) { range.setStartAfter(link); range.collapse(true); }
  }
  const textLink = content.querySelector(`a[href^="#footnote:"], [data-type="a"]`);
  if (textLink) range.deleteContents();
  const fragment = document.createDocumentFragment();
  if (textLink) fragment.append(textLink);
  fragment.append(reference); range.insertNode(fragment);
  const spacer = document.createTextNode('\u200b'); reference.after(spacer);
  range.setStart(spacer, 1); range.collapse(true);
  const existing = pane.querySelector(':scope > [data-type="footnotes-block"]');
  if (inserting.reuse) {
    // Do not append, replace or duplicate the shared definition.
  } else if (existing) {
    if (state.currentMode === 'wysiwyg') existing.querySelector('ol').append(...definitions.querySelector('ol').children);
    else existing.append(...definitions.children);
  } else {
    const boundary = pane.lastElementChild;
    if (boundary?.classList.contains('vditor-editor-boundary')) boundary.before(definitions);
    else pane.append(definitions);
  }
  const numbers = new Map();
  for (const ref of pane.querySelectorAll('[data-type="footnotes-ref"]')) {
    const label = ref.dataset.footnotesLabel;
    if (!numbers.has(label)) numbers.set(label, numbers.size + 1);
    const display = state.currentMode === 'ir' ? ref.querySelector('.vditor-ir__marker--hide') : ref;
    if (display) display.textContent = numbers.get(label);
  }
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  state[state.currentMode].range = range;
  return true;
};
