import { protectNoteMath } from './note-math.js';
import { withoutEmptyInlineMath } from './empty-inline-math.js';
// A small compatibility layer around the bundled parser. Existing math and code
// are opaque; only complete, unambiguous extra forms are converted for rendering.
const commands = new Set(('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega frac dfrac tfrac sqrt sum prod int iint iiint oint lim log ln exp sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh min max sup inf arg det dim gcd Pr mathbb mathcal mathrm mathbf mathit mathsf mathtt boldsymbol operatorname text textrm textbf left right middle big Big bigg Bigg cdot times div pm mp le leq ge geq ne neq approx equiv sim simeq in notin subset subseteq supset supseteq cup cap emptyset varnothing forall exists neg land lor to mapsto rightarrow leftarrow Rightarrow Leftarrow leftrightarrow Leftrightarrow infty partial nabla ell ellipsis ldots cdots vdots ddots overline underline hat widehat bar vec dot ddot tilde widetilde underbrace overbrace binom dbinom tbinom begin end quad qquad thinspace mathop limits nolimits tag label lVert rVert lvert rvert vert Vert langle rangle lceil rceil lfloor rfloor').split(' '));
const edgeSpace = /^[ \t\u00a0\u3000]+|[ \t\u00a0\u3000]+$/g;
// Chromium and IMEs can insert nonbreaking/fullwidth heading separators.
// Normalize only those spaces after a complete ATX prefix.
const headingPrefix = /^( {0,3}#{1,6})([ \t\u00a0\u3000]+)/;
const normalizeHeadingPrefix = text => text.replace(headingPrefix, (_all, hashes, spaces) =>
  hashes + spaces.replace(/[\u00a0\u3000]/g,' '));
let serial = 0;
const escaped = (s, at) => { let n = 0; while (at > 0 && s[--at] === '\\') n++; return n % 2 !== 0; };
const nextUnescaped = (s, token, from) => {
  let at = s.indexOf(token, from);
  while (at >= 0 && escaped(s, at)) at = s.indexOf(token, at + token.length);
  return at;
};
const balancedEnd = (s, at, open, close) => {
  let depth = 0;
  for (let i = at; i < s.length; i++) {
    if (escaped(s, i)) continue;
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) return i + 1;
  }
  return -1;
};

function looksLikeMath(body) {
  const trimmed = body.trim();
  if (!/^\\[A-Za-z]+/.test(trimmed) || /[$\n\r`]|:\/\/|\\\\/.test(trimmed) || trimmed.length > 1200) return false;
  const names = [...trimmed.matchAll(/\\([A-Za-z]+)/g)].map(match => match[1]);
  if (!names.length || names.some(name => !commands.has(name))) return false;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (escaped(trimmed, i)) continue;
    if (trimmed[i] === '{') depth++;
    if (trimmed[i] === '}' && --depth < 0) return false;
  }
  return depth === 0;
}

// Process Markdown before it loses the distinction between literal escapes,
// link destinations, code and prose. Bold placeholders preserve edge spaces
// without turning four leading spaces into an indented code block.
function prepare(source, inlineOnly = false, delimitersOnly = false, formulaToken = value => value) {
  const replacements = [];
  let prefix;
  do { prefix = `GLASSCOMPAT${++serial}TOKEN`; } while (source.includes(prefix));
  let result = '', i = 0;
  const copy = end => { result += source.slice(i, end); i = end; };
  while (i < source.length) {
    if (!inlineOnly && (i === 0 || source[i - 1] === '\n')) {
      const end = source.indexOf('\n', i), lineEnd = end < 0 ? source.length : end + 1;
      const line = source.slice(i, lineEnd);
      const fence = line.match(/^(?: {0,3}>[ \t]?)* {0,3}(`{3,}|~{3,})/);
      if (fence) {
        let stop = lineEnd;
        const closing = new RegExp('^(?: {0,3}>[ \\t]?)* {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \\t]*\\r?$');
        while (stop < source.length) {
          const next = source.indexOf('\n', stop), nextEnd = next < 0 ? source.length : next + 1;
          const match = closing.test(source.slice(stop, next < 0 ? source.length : next));
          stop = nextEnd; if (match) break;
        }
        copy(stop); continue;
      }
      if (i === 0 && /^---[ \t]*\r?\n/.test(line)) {
        const close = /^(?:---|\.\.\.)[ \t]*\r?$/gm; close.lastIndex = lineEnd;
        const match = close.exec(source);
        if (match) { copy(match.index + match[0].length); continue; }
      }
      if (/^(?: {4}|\t)|^ {0,3}\[[^\]\n]+\]:/.test(line)) { copy(lineEnd); continue; }
      const normalized = normalizeHeadingPrefix(line);
      if (!delimitersOnly && normalized !== line) {
        const inner = prepare(normalized,true);
        replacements.push(...inner.replacements);
        result += inner.source; i = lineEnd; continue;
      }
    }
    if (source[i] === '`' && !escaped(source, i)) {
      const run = source.slice(i).match(/^`+/)[0]; let end = source.indexOf(run, i + run.length);
      while (end >= 0 && (source[end - 1] === '`' || source[end + run.length] === '`')) end = source.indexOf(run, end + run.length);
      if (end >= 0) { copy(end + run.length); continue; }
    }
    if (source[i] === '<' && !escaped(source, i)) {
      const rest = source.slice(i);
      const comment = rest.startsWith('<!--') ? source.indexOf('-->', i + 4) : -1;
      if (comment >= 0) { copy(comment + 3); continue; }
      const tag = rest.match(/^<([A-Za-z][\w-]*)\b[^>]*>/);
      if (tag) {
        const close = new RegExp('</' + tag[1] + '\\s*>', 'i').exec(rest.slice(tag[0].length));
        if (close) { copy(i + tag[0].length + close.index + close[0].length); continue; }
        // An unmatched HTML container can continue across lines: leave it alone.
        if (/^(pre|code|script|style|textarea)$/i.test(tag[1])) { copy(source.length); continue; }
      }
      const end = source.indexOf('>', i + 1);
      if (end >= 0) { copy(end + 1); continue; }
    }
    if (source[i] === '[' && !escaped(source, i)) {
      const end = balancedEnd(source, i, '[', ']');
      if (end > 0) {
        let stop = end;
        if (source[end] === '(') { const destination = balancedEnd(source, end, '(', ')'); if (destination > 0) stop = destination; }
        else if (source[end] === '[') { const reference = balancedEnd(source, end, '[', ']'); if (reference > 0) stop = reference; }
        copy(stop); continue;
      }
    }
    if (source[i] === '$' && !escaped(source, i)) {
      const token = source[i + 1] === '$' ? '$$' : '$';
      const end = nextUnescaped(source, token, i + token.length);
      if (end >= 0) {
        // Heal nested ($...$) wrappers that an older compat pass left inside math.
        const body = source.slice(i + token.length, end);
        if (body.includes('$')) {
          result += token + body.replace(/\$([^$\n]+)\$/g, '$1') + token;
          i = end + token.length; continue;
        }
        copy(end + token.length); continue;
      }
    }
    if (source[i] === '\\' && !escaped(source, i) && ['(', '['].includes(source[i + 1])) {
      const block = source[i + 1] === '[', token = block ? '\\]' : '\\)';
      const end = nextUnescaped(source, token, i + 2);
      if (end >= 0) {
        const body = source.slice(i + 2, end);
        // Escaped literal text from plain paste may start with a doubled slash.
        if (body.trim() && !body.includes('$') && !body.trimStart().startsWith('\\\\') && (block ? !inlineOnly : !/[\r\n]/.test(body))) {
          result += formulaToken(block ? '\n\n$$\n' + body.trim() + '\n$$\n\n' : '$' + body.trim() + '$');
          i = end + 2; continue;
        }
        copy(end + 2); continue;
      }
    }
    if (source[i] === '(' && !escaped(source, i)) {
      const end = balancedEnd(source, i, '(', ')');
      if (end > 0 && looksLikeMath(source.slice(i + 1, end - 1))) {
        // Skip TeX argument groups: \sum(...), \sum (...), \left(...), f(\alpha).
        // Still wrap prose parentheses such as (\epsilon) or 条件(\lambda).
        const left = source.slice(Math.max(0, i - 40), i);
        if (!/\\[A-Za-z]+[ \t]*$/.test(left) && !/[A-Za-z0-9_^}_{]$/.test(left)) {
          const body = source.slice(i + 1, end - 1);
          result += '(' + formulaToken('$' + body.trim() + '$') + ')'; i = end; continue;
        }
      }
    }
    if (!delimitersOnly && source.startsWith('**', i) && source[i - 1] !== '*' && source[i + 2] !== '*' && !escaped(source, i)) {
      const end = nextUnescaped(source, '**', i + 2);
      if (end >= 0 && source[end + 2] !== '*' && source[end - 1] !== '*') {
        const body = source.slice(i + 2, end), trimmed = body.replace(edgeSpace, '');
        if (trimmed && trimmed !== body && !/[\r\n]/.test(body)) {
          const leading = body.match(/^[ \t\u00a0\u3000]*/)[0], trailing = body.match(/[ \t\u00a0\u3000]*$/)[0];
          const token = prefix + replacements.length + 'END';
          replacements.push({ token, body: trimmed, leading, trailing }); result += token; i = end + 2; continue;
        }
        // Consume valid pairs too: their closing ** must never become the
        // opening delimiter of a new span across the gap to the next bold word.
        const inner = prepare(body, true);
        replacements.push(...inner.replacements);
        result += '**' + inner.source + '**'; i = end + 2; continue;
      }
    }
    // Lute treats paired single tildes as GFM strikethrough (~like this~),
    // same as ~~double~~. Academic notes often use a lone ~ for "approximately"
    // next to bold numbers; IR spin in tables can separate ~ from ** and the
    // two approx marks then wrap the middle in <del>. Escape lone ~; keep ~~.
    if (source[i] === '~' && !escaped(source, i)) {
      if (source[i + 1] === '~') {
        const end = nextUnescaped(source, '~~', i + 2);
        if (end >= 0) { copy(end + 2); continue; }
        copy(i + 2); continue;
      }
      result += '\\~';
      i++; continue;
    }
    // Consume escaped punctuation as a pair, so \( and escaped ** are not
    // reconsidered from their second character on the next iteration.
    if (source[i] === '\\' && /[\\`*_{}\[\]()#+.!|>~$<>=-]/.test(source[i + 1] || '\0')) { copy(i + 2); continue; }
    result += source[i++];
  }
  return { source: result, replacements };
}

// Share the Markdown-aware exclusions with clipboard conversion. Do not run
// bold placeholders here: this result is Markdown, not parser-internal input.
export const normalizeLatexDelimiters = (source, formulaToken) => prepare(source, false, true, formulaToken).source;

export function normalizeRichLatexText(source, formulaToken) {
  // Markdown rendered by a web page can consume the delimiter backslashes.
  // Recognize a whole bracketed display only with known TeX commands; ordinary
  // square-bracket prose, links and plain equations are not inferred as math.
  const display = source.match(/^\s*\[([\s\S]+)\]\s*$/);
  if (display) {
    const body = display[1].trim();
    const probe = body.replace(/[\r\n]+/g, ' ').replace(/^[A-Za-z0-9_{}^ .+\-]+\s*=\s*/, '');
    if (looksLikeMath(probe)) return formulaToken('\n\n$$\n' + body + '\n$$\n\n');
  }
  return normalizeLatexDelimiters(source, formulaToken);
}

const container = html => { const element = document.createElement('div'); element.innerHTML = html; return element; };
const unwrapParagraphs = root => {
  for (const p of [...root.children]) if (p.tagName === 'P') p.replaceWith(...p.childNodes);
  return root;
};
// IR marks single-tilde strike with marker text "~" (double uses "~~").
// Unwrap those nodes into escaped tildes so the next spin cannot revive <del>.
const neutralizeSingleTildeStrike = html => {
  if (!html || !html.includes('data-type="s"') && !html.includes("data-type='s'")) return html;
  const root = container(html);
  let changed = false;
  for (const node of [...root.querySelectorAll('span[data-type="s"]')]) {
    const markers = [...node.children].filter(el => el.classList?.contains('vditor-ir__marker'));
    if (markers.length < 2) continue;
    if (markers[0].textContent !== '~' || markers[markers.length - 1].textContent !== '~') continue;
    const frag = document.createDocumentFragment();
    const esc = () => {
      const wrap = document.createElement('span');
      wrap.setAttribute('data-type', 'backslash');
      wrap.className = 'vditor-ir__node';
      const mark = document.createElement('span');
      mark.className = 'vditor-ir__marker vditor-ir__marker--bi';
      mark.textContent = '\\';
      wrap.append(mark, document.createTextNode('~'));
      return wrap;
    };
    frag.append(esc());
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1 && child.classList?.contains('vditor-ir__marker')) continue;
      if (child.nodeType === 1 && child.tagName === 'S') frag.append(...child.childNodes);
      else frag.append(child);
    }
    frag.append(esc());
    node.replaceWith(frag);
    changed = true;
  }
  return changed ? root.innerHTML : html;
};
function renderPrepared(prepared, parser) {
  if (!prepared.replacements.length) return parser(prepared.source);
  const root = container(parser(prepared.source));
  for (const item of prepared.replacements) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const found = []; let node;
    while (node = walker.nextNode()) if (node.data.includes(item.token)) found.push(node);
    for (const node of found) {
      const parts = node.data.split(item.token), replacement = document.createDocumentFragment();
      parts.forEach((part, index) => {
        if (index) {
          replacement.append(document.createTextNode(item.leading));
          const inner = unwrapParagraphs(container(renderPrepared(prepare('**' + item.body + '**', true), parser)));
          replacement.append(...inner.childNodes, document.createTextNode(item.trailing));
        }
        replacement.append(document.createTextNode(part));
      });
      node.replaceWith(replacement);
    }
  }
  return root.innerHTML;
}

export function installCompatibility(editor) {
  const lute = editor.vditor.lute;
  if (lute.glassCompatibility) return;
  lute.glassCompatibility = true;
  const setCaret = (pane, range) => {
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    editor.vditor[editor.vditor.currentMode].range = range.cloneRange();
  };
  const insertHeadingPrefix = (event, data) => {
    const pane = editor.vditor[editor.vditor.currentMode]?.element, selection = getSelection();
    if (!pane?.contains(event.target) || !selection?.isCollapsed || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0), element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const p = element.closest('p');
    if (!p || !element.closest('strong,b,em,i,s,del') ||
        element.closest('code,pre:not(.vditor-reset),a,.cm-editor,[contenteditable="false"],.vditor-ir__marker,[data-type="a"],[data-type="math-inline"],[data-type="html-block"]')) return false;
    const prefix = range.cloneRange(); prefix.setStart(p,0);
    const leading = prefix.cloneContents(); leading.querySelectorAll('.vditor-ir__marker').forEach(node=>node.remove());
    if (leading.textContent !== '' || leading.querySelector('img,br,code')) return false;
    // Keep the ATX prefix outside a copied heading's inline formatting.
    // Handling # before native keydown also avoids its bold caret scaffold.
    event.preventDefault();
    editor.vditor.undo.recordFirstPosition(editor.vditor,{key:data});
    const text = document.createTextNode(data); p.prepend(text);
    range.setStart(text,text.length); range.collapse(true); setCaret(pane,range);
    pane.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data}));
    return true;
  };
  const headingKey = event => {
    if (!event.defaultPrevented && !event.isComposing && event.key === '#' && !event.ctrlKey && !event.metaKey && !event.altKey && !window.glassRawVisible &&
        insertHeadingPrefix(event,'#')) event.stopImmediatePropagation();
  };
  const formattedHome = event => {
    if (event.defaultPrevented || event.isComposing || event.key !== 'Home' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        editor.vditor.currentMode !== 'ir' || window.glassRawVisible) return;
    const pane = editor.vditor.ir.element, selection = getSelection();
    if (!pane.contains(event.target) || !selection?.isCollapsed || !selection.rangeCount) return;
    const element = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
    const p = element.closest('p'), first = p?.firstElementChild;
    if (!p || !first?.matches('[data-type="strong"],[data-type="em"],[data-type="s"]') ||
        p.querySelector('br,code,.cm-editor,[data-type="a"],[data-type="math-inline"]') ||
        [...p.childNodes].some(node=>node === first ? false : node.compareDocumentPosition(first)&Node.DOCUMENT_POSITION_FOLLOWING && node.textContent)) return;
    // Hidden IR delimiters can make Chromium's Home land in the closing **.
    // Handle only one rendered line; wrapped-line navigation stays native.
    const walker = document.createTreeWalker(p,NodeFilter.SHOW_TEXT); let node, target, middle;
    while (node = walker.nextNode()) {
      if (!node.length || node.parentElement.closest('.vditor-ir__marker')) continue;
      const text = document.createRange(); text.selectNodeContents(node);
      for (const rect of text.getClientRects()) {
        if (!rect.width || !rect.height) continue;
        const y = (rect.top+rect.bottom)/2;
        if (middle !== undefined && Math.abs(y-middle)>rect.height/2) return;
        middle ??= y; target ??= node;
      }
    }
    if (!target) return;
    const range = document.createRange(); range.setStart(target,0); range.collapse(true);
    event.preventDefault(); event.stopImmediatePropagation(); setCaret(pane,range);
  };
  const headingSeparator = event => {
    if (event.defaultPrevented || !event.cancelable || event.isComposing || window.glassRawVisible ||
        event.inputType !== 'insertText') return;
    if (/^#{1,6}(?:[ \t\u00a0\u3000]|$)/.test(event.data || '') && insertHeadingPrefix(event,event.data)) return;
    const pane = editor.vditor[editor.vditor.currentMode]?.element, selection = getSelection();
    if (!pane?.contains(event.target) || !selection?.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0), element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const p = element.closest('p');
    if (!p || element.closest('code,pre:not(.vditor-reset),a,.cm-editor,[contenteditable="false"],[data-type="a"],[data-type="math-inline"],[data-type="html-block"]')) return;
    const prefix = range.cloneRange(); prefix.setStart(p,0);
    if (!/^[ \t\u00a0\u3000]*[\u00a0\u3000]/.test(event.data || '')) return;
    if (!/^ {0,3}#{1,6}$/.test(prefix.toString())) return;
    // Use a normal text insertion event too: IR's space-key conversion uses
    // event.data when restoring the caret in an otherwise empty heading.
    event.preventDefault();
    document.execCommand('insertText',false,event.data.replace(/^[ \t\u00a0\u3000]+/,spaces=>spaces.replace(/[\u00a0\u3000]/g,' ')));
  };
  editor.vditor.element.addEventListener('keydown',headingKey,true);
  editor.vditor.element.addEventListener('keydown',formattedHome,true);
  editor.vditor.element.addEventListener('beforeinput',headingSeparator,true);
  window.addEventListener('pagehide',()=>{
    editor.vditor.element.removeEventListener('keydown',headingKey,true);
    editor.vditor.element.removeEventListener('keydown',formattedHome,true);
    editor.vditor.element.removeEventListener('beforeinput',headingSeparator,true);
  },{once:true});
  // Native paste inserts inline content without spinning the surrounding
  // paragraph. Finish an ATX prefix when its wording arrives from clipboard.
  window.glassInsertHeadingFragment = (content, state, range) => {
    if (window.glassRawVisible || !range.collapsed) return false;
    const pane = state[state.currentMode]?.element;
    const element = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const p = element.closest('p');
    if (!pane?.contains(p) || element.closest('pre:not(.vditor-reset),code,.cm-editor,[contenteditable="false"]')) return false;
    const prefix = range.cloneRange(); prefix.setStart(p,0);
    if (!/^ {0,3}#{1,6}[ \t\u00a0\u3000]+$/.test(prefix.toString())) return false;
    const payload = content.cloneNode(true);
    if (payload.children.length === 1 && payload.firstElementChild.tagName === 'P') {
      const paragraph = payload.firstElementChild; paragraph.replaceWith(...paragraph.childNodes);
    }
    if (!payload.textContent || payload.querySelector('p,h1,h2,h3,h4,h5,h6,ol,ul,blockquote,table,pre,div,[data-type="footnotes-ref"],[data-type="footnotes-block"]')) return false;
    const fragment = document.createDocumentFragment(); fragment.append(...payload.childNodes);
    range.insertNode(fragment); range.collapse(false);
    const marker = document.createElement('wbr'); range.insertNode(marker);
    const spin = state.currentMode === 'ir' ? 'SpinVditorIRDOM' : 'SpinVditorDOM';
    const result = container(state.lute[spin](p.outerHTML)), heading = result.firstElementChild;
    const caret = heading?.querySelector('wbr');
    if (!heading?.matches('h1,h2,h3,h4,h5,h6') || !caret) {
      range.setStartBefore(marker); range.collapse(true); marker.remove(); setCaret(pane,range); return true;
    }
    p.replaceWith(heading); range.setStartBefore(caret); range.collapse(true); caret.remove(); setCaret(pane,range);
    return true;
  };
  if (typeof lute.Md2HTML === 'function' && !lute.glassMd2HtmlStrikeGuard) {
    lute.glassMd2HtmlStrikeGuard = true;
    const md2html = lute.Md2HTML.bind(lute);
    lute.Md2HTML = text => renderPrepared(prepare(text), md2html);
  }
  for (const mode of ['DOM', 'IRDOM']) {
    const name = 'Md2Vditor' + mode, spin = 'SpinVditor' + mode;
    const parse = lute[name].bind(lute), nativeSpin = lute[spin].bind(lute);
    const originalSpin = html => mode === 'DOM'
      ? protectNoteMath(withoutEmptyInlineMath(html), nativeSpin)
      : nativeSpin(withoutEmptyInlineMath(html));
    const serializeName = 'Vditor' + mode + '2Md', serialize = lute[serializeName].bind(lute);
    lute[serializeName] = html => mode === 'DOM'
      ? protectNoteMath(withoutEmptyInlineMath(html), serialize, true)
      : serialize(withoutEmptyInlineMath(html));
    lute[name] = text => renderPrepared(prepare(text), parse);
    lute[spin] = html => {
      html = neutralizeSingleTildeStrike(html);
      const headingInput = html.includes('#') && /\u00a0|\u3000|&nbsp;|&#(?:160|12288);|&#x(?:a0|3000);/i.test(html);
      // Include "~": lone approx tildes must run through prepare() or they pair as <del>.
      if (!html.includes('\\') && !html.includes('**') && !html.includes('~') && !headingInput) return originalSpin(html);
      // Keep native wbr caret bookmarks in place. The native parser then
      // converts this paragraph and restores the caret in the new heading.
      let headingChanged = false;
      if (headingInput) {
        const headings = container(html);
        for (const p of headings.querySelectorAll('p')) {
          if (p.closest('pre,code,[data-type="math-block"],[data-type="html-block"],[data-type="html-inline"]')) continue;
          const texts = [];
          for (const child of p.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) texts.push(child);
            else if (!child.matches('wbr,.vditor-wbr')) break;
          }
          const prefix = texts.map(node=>node.data).join(''), normalized = normalizeHeadingPrefix(prefix);
          if (prefix === normalized) continue;
          // Replacing individual characters keeps split text nodes and the
          // parser's caret marker in the same order, including IME commits.
          const end = prefix.match(headingPrefix)[0].length;
          let offset = 0;
          for (const node of texts) {
            const length = node.length, count = Math.max(0,Math.min(length,end-offset));
            node.replaceData(0,count,node.data.slice(0,count).replace(/[\u00a0\u3000]/g,' '));
            offset += length;
          }
          headingChanged = true;
        }
        if (headingChanged) html = headings.innerHTML;
      }
      if (!html.includes('\\') && !html.includes('**') && !html.includes('~')) return originalSpin(html);
      const root = container(html), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; let node;
      while (node = walker.nextNode()) {
        if (!node.parentElement.closest('pre,code,a,kbd,samp,script,style,textarea,strong,em,s,del,[contenteditable=false],[data-type=backslash],[data-type=html-entity],[data-type=html-inline],[data-type=html-block],[data-type=math-inline],[data-type=math-block],.vditor-ir__node,.vditor-wysiwyg__preview,.vditor-ir__preview')) nodes.push(node);
      }
      let changed = false;
      for (const node of nodes) {
        const prepared = prepare(node.data, true);
        if (prepared.source === node.data) continue;
        // Boundary sentinels keep a fragment's spaces and prevent list parsing.
        const left = `GLASSSTART${++serial}END`, right = `GLASSSTOP${serial}END`;
        prepared.source = left + prepared.source + right;
        const fragment = unwrapParagraphs(container(renderPrepared(prepared, parse)));
        const walk = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT); let text;
        while (text = walk.nextNode()) text.data = text.data.replace(left, '').replace(right, '');
        node.replaceWith(...fragment.childNodes); changed = true;
      }
      const spun = originalSpin(changed ? root.innerHTML : html);
      return neutralizeSingleTildeStrike(spun);
    };
  }
  // Some native insertion paths leave previews in data-render=2 until another
  // interaction. Refresh only preview elements, never editable math/code source.
  const pending = new WeakSet();
  const changed = new Set();
  const selector = '.vditor-wysiwyg__preview .language-math:not([data-math]),.vditor-ir__preview .language-math:not([data-math])';
  let queued = false, disposed = false;
  const refresh = () => {
    if (queued || disposed) return;
    queued = true;
    // IR replaces the paragraph on input. Render its new previews before paint;
    // a trailing timer exposes raw TeX on each keystroke (and during long IME input).
    queueMicrotask(() => {
      queued = false;
      if (disposed) return;
      const previews = new Set();
      const collect = node => {
        if (pending.has(node)) return;
        pending.add(node); setTimeout(() => pending.delete(node), 500);
        previews.add(node.closest('.vditor-wysiwyg__preview,.vditor-ir__preview'));
      };
      for (const scope of changed) {
        if (!scope.isConnected) continue;
        if (scope.matches(selector)) collect(scope);
        scope.querySelectorAll(selector).forEach(collect);
      }
      changed.clear();
      for (const preview of previews) Vditor.mathRender(preview, { cdn: editor.vditor.options.cdn, math: editor.vditor.options.preview.math });
    });
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      // Ignore typesetting's own output and ordinary text/source edits. A parser
      // replacement adds a fresh paragraph/preview and is collected below.
      if (target?.closest('.language-math[data-math]')) continue;
      const math = target?.closest(selector);
      if (math) changed.add(math);
      for (const node of record.addedNodes) if (node.nodeType === 1) changed.add(node);
    }
    if (changed.size) refresh();
  });
  observer.observe(editor.vditor.element, { childList: true, subtree: true, characterData: true });
  window.addEventListener('pagehide', () => { disposed = true; observer.disconnect(); }, { once: true });
  changed.add(editor.vditor.element); refresh();
}
