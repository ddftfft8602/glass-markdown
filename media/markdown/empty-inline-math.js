// An empty inline source is an editor placeholder, not Markdown "$$". Lute
// either emits those ambiguous delimiters or dereferences its missing child.
// Normalize only detached parser input; keep the live formula editor available
// for typing, local undo and composition while its source is temporarily empty.
export function withoutEmptyInlineMath(html) {
  if (!html.includes('data-type="math-inline"')) return html;
  // Avoid parsing entire documents on the common nonempty-formula path.
  const sources = html.matchAll(/<code\b[^>]*data-type="math-inline"[^>]*>([\s\S]*?)<\/code>/g);
  if (![...sources].some(match => !match[1].replace(/<[^>]*>|&nbsp;|&#(?:8203|160);|&#x(?:200b|a0);|\u200b/gi,'').trim())) return html;
  const root = document.createElement('div'); root.innerHTML = html;
  let changed = false;
  for (const code of root.querySelectorAll('code[data-type="math-inline"]')) {
    if (code.textContent.replace(/\u200b/g,'').trim()) continue;
    const wrapper = code.parentElement;
    if (!wrapper.matches('span[data-type="math-inline"],span[data-type="inline-node"]')) continue;
    const bookmarks = [...wrapper.querySelectorAll('wbr,.vditor-wbr')].filter(node => !node.closest('.cm-editor'));
    wrapper.replaceWith(...bookmarks); changed = true;
  }
  return changed ? root.innerHTML : html;
}
