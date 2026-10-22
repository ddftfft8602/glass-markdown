const selector = '[data-type="footnotes-ref"]';
const labelOf = ref => (ref.dataset.footnotesLabel || '').replace(/^\^/, '');
const hrefOf = link => link.getAttribute('href') ?? link.querySelector(':scope > .vditor-ir__marker--link')?.textContent;
const marker = '\uFDD0';
const definitionSelector = '[data-type="footnotes-li"], [data-type="footnotes-def"]';
export const definitionLabel = node => node.dataset.type === 'footnotes-li'
  ? node.dataset.marker?.replace(/^\^/, '')
  : node.firstChild?.textContent.match(/^\[\^([^\]]+)\]:/)?.[1];

// Read a detached display copy, excluding source hints and duplicate MathML.
// The result becomes literal CSS-generated text, never interpreted as HTML.
function plainText(node, ref) {
  const copy = node.cloneNode(true);
  const originals = [...node.querySelectorAll(selector)];
  [...copy.querySelectorAll(selector)].forEach((item, index) => {
    if (originals[index] === ref) item.replaceWith(document.createTextNode(marker));
    else item.remove();
  });
  copy.querySelectorAll('img').forEach(img => img.replaceWith(document.createTextNode(img.alt || '[图片]')));
  copy.querySelectorAll('.vditor-cm-host,.vditor-cm-chrome,.vditor-ir__marker,.katex-mathml,code[data-type="math-inline"],.vditor-wysiwyg__pre,wbr,script,style').forEach(node => node.remove());
  copy.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));
  return copy.textContent.replace(/\u200b/g,'').replace(/[\t \r\n]+/g,' ').trim();
}

function sentenceAtReference(block, ref) {
  const text = plainText(block, ref), index = text.indexOf(marker);
  if (index < 0) return text;
  const sentences = [...new Intl.Segmenter('zh', {granularity:'sentence'}).segment(text)];
  const current = sentences.findIndex(part => index >= part.index && index < part.index + part.segment.length);
  let sentence = sentences[current]?.segment || text;
  // A footnote immediately after a sentence's punctuation refers to that
  // preceding sentence, not to the next sentence in the same paragraph.
  if (current > 0 && !sentence.slice(0, index - sentences[current].index).trim()) sentence = sentences[current - 1].segment;
  return sentence.replaceAll(marker, '').trim();
}

function referenceText(ref) {
  let previous = ref.previousSibling;
  while (previous?.nodeType === Node.TEXT_NODE && !previous.textContent.replace(/\u200b/g,'')) previous = previous.previousSibling;
  const linked = previous instanceof Element && hrefOf(previous) === `#footnote:${labelOf(ref)}`;
  const block = ref.closest('p,h1,h2,h3,h4,h5,h6,td,th,li') || ref.parentElement;
  return linked ? plainText(previous) : sentenceAtReference(block, ref);
}

// Origins are CSS-generated display text on the first definition paragraph.
// They do not enter the editable text, Markdown serialization, or popup body.
export function installFootnoteOrigins(editor) {
  const root = editor.vditor.element;
  let pane, refs = new Map(), definitions = new Map(), reindex = true, frame;
  const changed = new Set();
  const group = (nodes, key) => {
    const result = new Map();
    for (const node of nodes) {
      const label = key(node); if (!label) continue;
      if (!result.has(label)) result.set(label, []);
      result.get(label).push(node);
    }
    return result;
  };
  const refresh = () => {
    frame = 0;
    const active = editor.vditor[editor.vditor.currentMode]?.element;
    if (!active) return;
    if (pane !== active) { pane = active; reindex = true; }
    if (reindex) {
      refs = group(pane.querySelectorAll(selector), labelOf);
      definitions = group(pane.querySelectorAll(definitionSelector), definitionLabel);
      for (const label of definitions.keys()) changed.add(label);
      reindex = false;
    }
    for (const label of changed) {
      const texts = [...new Set((refs.get(label) || []).filter(ref => pane.contains(ref)).map(referenceText).filter(Boolean))];
      const value = texts.join('、');
      for (const definition of definitions.get(label) || []) {
        if (!pane.contains(definition)) continue;
        const target = definition.querySelector(':scope > p') || definition;
        for (const old of [definition, ...definition.querySelectorAll('[data-glass-note-origin]')]) {
          if (old !== target || !value) old.removeAttribute('data-glass-note-origin');
        }
        if (value && target.getAttribute('data-glass-note-origin') !== value) target.setAttribute('data-glass-note-origin', value);
      }
    }
    changed.clear();
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
  const structural = node => node.nodeType === Node.ELEMENT_NODE && (node.matches(`${selector},${definitionSelector}`) || node.querySelector(`${selector},${definitionSelector}`));
  const observer = new MutationObserver(records => {
    const active = editor.vditor[editor.vditor.currentMode]?.element;
    if (!active) return;
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (!active.contains(target)) continue;
      if (active !== pane || record.type === 'attributes' || [...record.addedNodes, ...record.removedNodes].some(structural)) reindex = true;
      const definition = target.closest(definitionSelector);
      if (definition) changed.add(definitionLabel(definition));
      const block = target.closest('p,h1,h2,h3,h4,h5,h6,td,th,li');
      if (block) for (const ref of block.querySelectorAll(selector)) changed.add(labelOf(ref));
    }
    if (reindex || changed.size) schedule();
  });
  observer.observe(root, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['href','data-footnotes-label','data-marker']});
  refresh();
  window.addEventListener('pagehide', () => { observer.disconnect(); cancelAnimationFrame(frame); }, {once:true});
}
