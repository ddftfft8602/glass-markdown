// Lute's WYSIWYG footnote round-trip incorrectly removes the first two
// characters of each display-math line. Keep these opaque blocks out of that
// indentation pass, both while spinning DOM and while writing Markdown.
let sequence = 0;
export function protectNoteMath(html, convert, markdown = false) {
  if (!html.includes('footnotes-li') || !html.includes('math-block')) return convert(html);
  const root = document.createElement('div'); root.innerHTML = html;
  const saved = [];
  for (const block of root.querySelectorAll('[data-type="footnotes-li"] div[data-type="math-block"]')) {
    const code = block.querySelector(':scope > pre > code[data-type="math-block"]');
    if (!code) continue;
    let token;
    do { token = `GLASSNOTEMATH${++sequence}END`; } while (html.includes(token));
    const placeholder = document.createElement('p'); placeholder.dataset.block = '0'; placeholder.textContent = token;
    saved.push({token, block, nested:!!block.parentElement.closest('li:not([data-type="footnotes-li"])'), source: code.textContent.replace(/\u200b/g, '')});
    block.replaceWith(placeholder);
  }
  if (!saved.length) return convert(html);
  const result = convert(root.innerHTML);
  if (markdown) {
    let text = result;
    for (const {token, source, nested} of saved) {
      text = text.replace(new RegExp(`^(\\[\\^[^\\]\\n]+\\]:)[ \\t]*${token}[ \\t]*$`, 'm'), (_line, label) =>
        label + '\n' + ['$$', ...source.replace(/\n$/, '').split('\n'), '$$'].map(line => '    '+line).join('\n'));
      text = text.replace(new RegExp(`^([ \\t]*)${token}[ \\t]*$`, 'm'), (_line, indent) => {
        // WYSIWYG's synthetic footnote OL contributes three extra spaces on
        // top of the four-space definition indent. Math must not retain them:
        // Lute otherwise strips source characters when this file is reopened.
        const padding = !nested && indent.startsWith('       ') ? indent.slice(3) : indent;
        return ['$$', ...source.replace(/\n$/, '').split('\n'), '$$'].map(line => padding + line).join('\n');
      });
      if (text.includes(token)) throw new Error('无法保存备注公式，请撤销本次编辑');
    }
    return text;
  }
  root.innerHTML = result;
  for (const {token, block} of saved) {
    const placeholder = [...root.querySelectorAll('p')].find(node => node.textContent === token);
    if (!placeholder) throw new Error('无法保留备注公式，请撤销本次编辑');
    placeholder.replaceWith(block);
  }
  return root.innerHTML;
}
