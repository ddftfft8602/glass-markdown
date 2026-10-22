import { installLinkEditing } from './link-editing.js';
import { installFootnotes } from './footnotes.js';
import { installFootnoteInsertion } from './footnote-insertion.js';

const activePane = editor => editor.vditor[editor.vditor.currentMode]?.element;
const wantsNavigation = event => event.type === 'dblclick' ||
  (event.type === 'click' && (event.ctrlKey || event.metaKey));

export function navigateToFragment(editor, fragment) {
  const pane = activePane(editor);
  if (!pane || typeof fragment !== 'string') return false;
  const raw = fragment.replace(/^#/, '');
  if (!raw) { pane.scrollTop = 0; return true; }
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* A literal % can occur in an HTML id. */ }
  // Scope IDs to the visible editor: the inactive mode may contain the same IDs.
  for (const id of new Set([decoded, raw])) {
    const target = pane.querySelector(`[id="${CSS.escape(id)}"], [name="${CSS.escape(id)}"]`);
    if (target) {
      const block = target.closest('[data-block="0"]') || target;
      window.glassRevealHeadingTarget?.(block);
      // An empty <a id> has no meaningful scroll box; scroll its reference line.
      const top = block.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
      pane.scrollTop = Math.max(0, top - 24);
      return true;
    }
  }
  // Retain native heading slugs, block IDs and footnote resolution.
  try {
    if (editor.scrollToBlock(fragment)) return true;
    // IR definitions contain literal [^label]: text, while WYSIWYG uses ^label
    // in data-marker. Try the stripped label only after the native lookup fails.
    if (raw.startsWith('footnote:^') && editor.scrollToBlock(raw.replace('footnote:^', 'footnote:'))) return true;
    if (raw.startsWith('footnote:') && !raw.startsWith('footnote:^') && editor.scrollToBlock(raw.replace('footnote:', 'footnote:^'))) return true;
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
  }
  editor.tip('未找到文内跳转位置，请检查对应的参考文献锚点或标题。', 4000);
  return false;
}

export function installDocumentLinks(editor) {
  installLinkEditing(editor);
  installFootnoteInsertion(editor);
  const refreshFootnotes = installFootnotes(editor);
  window.glassNavigateNoteLink = fragment => navigateToFragment(editor, fragment);
  const root = editor.vditor.element;
  const selector = 'a[href], [data-type="a"]';
  const refresh = scope => {
    if (!scope.isConnected) return;
    refreshFootnotes(scope);
    const links = [...scope.querySelectorAll(selector)];
    if (scope.matches(selector)) links.push(scope);
    for (const link of links) {
      if (link.closest('.vditor-reset')) {
        const href = link.getAttribute('href') ?? link.querySelector(':scope > .vditor-ir__marker--link')?.textContent;
        link.classList.toggle('glass-citation', /^#ref-[\w.-]+$/i.test(href || ''));
      }
    }
  };
  let frame;
  const changed = new Set();
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const link = target?.closest(selector);
      if (link) changed.add(link);
      for (const node of record.addedNodes) if (node.nodeType === 1 && !target?.closest('.katex')) changed.add(node);
    }
    if (!changed.size || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; for (const scope of changed) refresh(scope); changed.clear(); });
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href'] });
  refresh(root);

  const onAnchorClick = event => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const annotation = target?.closest('.glass-text-note');
    if (annotation && activePane(editor)?.contains(annotation)) {
      // Note activation/editing is handled above. Its internal association
      // must never navigate or expose a normal link-address editor.
      event.preventDefault();
      return;
    }
    const anchor = target?.closest('a[href]');
    if (!anchor || !activePane(editor)?.contains(anchor)) return;
    // The webview's <base> points at the file's folder. Browser navigation to
    // #ref-10 would load that folder, not scroll the current Markdown document.
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (href.startsWith('#') && wantsNavigation(event)) {
      event.stopPropagation(); navigateToFragment(editor, href);
    }
  };
  for (const type of ['click', 'dblclick', 'auxclick']) root.addEventListener(type, onAnchorClick, true);
  window.addEventListener('pagehide', () => {
    observer.disconnect(); cancelAnimationFrame(frame);
    for (const type of ['click', 'dblclick', 'auxclick']) root.removeEventListener(type, onAnchorClick, true);
  }, { once: true });
}
