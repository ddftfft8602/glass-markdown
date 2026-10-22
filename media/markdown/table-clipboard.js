const elementOf = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;

const stripEditorChrome = root => {
  root.querySelectorAll('.vditor-cm-host,.vditor-wysiwyg__preview,.vditor-ir__preview,wbr,.vditor-wbr').forEach(node => node.remove());
};

const cellMeaningful = cell => {
  const copy = cell.cloneNode(true);
  stripEditorChrome(copy);
  copy.querySelectorAll('.vditor-ir__marker').forEach(node => node.remove());
  return !!copy.textContent.replace(/[\s\u200b]/g, '') || !!copy.querySelector('img');
};

// Fix jam patterns where a pipe was absorbed into broken $...$ pairing:
//   "$e_t(...) |$ text $|$ more"  →  "$e_t(...)$ | text | more"
const normalizeBrokenMathPipes = text => {
  let out = String(text || '');
  // "$|$" or "$ | $" used as a fake separator between former cells
  out = out.replace(/\$\s*\|\s*\$/g, ' | ');
  // "$formula |$" → "$formula$ |"  (pipe before the closing dollar)
  out = out.replace(/\$([^$\n]+?)\s*\|\s*\$/g, (_m, body) => {
    // Keep real TeX that needs a pipe (rare); only rewrite when body looks like
    // a closed formula fragment, not "a|b" relational notation.
    if (/\\vert|\\mid|\\\|/.test(body)) return `$${body} |$`;
    return `$${body.trim()}$ |`;
  });
  return out;
};

// Split on | / \| outside $...$ / $$...$$ so jammed rows can be healed.
const splitPipesOutsideMath = text => {
  text = normalizeBrokenMathPipes(text);
  const parts = [];
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '$') {
      const token = text[i + 1] === '$' ? '$$' : '$';
      let end = i + token.length;
      let closed = false;
      while (end < text.length) {
        const at = text.indexOf(token, end);
        if (at < 0) { cur += text.slice(i); i = text.length; closed = true; break; }
        let n = 0; for (let k = at - 1; k >= 0 && text[k] === '\\'; k--) n++;
        if (n % 2 === 0) { cur += text.slice(i, at + token.length); i = at + token.length - 1; closed = true; break; }
        end = at + token.length;
      }
      if (!closed && i < text.length) { cur += text.slice(i); i = text.length; }
      continue;
    }
    // Lute escapes literal pipes in cell prose as \|; treat them as separators
    // when healing jammed column text (legitimate \| inside math already skipped).
    if (text[i] === '\\' && text[i + 1] === '|') {
      parts.push(cur.trim()); cur = ''; i++; continue;
    }
    if (text[i] === '|') { parts.push(cur.trim()); cur = ''; continue; }
    cur += text[i];
  }
  parts.push(cur.trim());
  return parts;
};

// DOM probe keeps literal "|" (Lute serialize would turn them into \|).
const cellToProbeText = cell => {
  const copy = cell.cloneNode(true);
  stripEditorChrome(copy);
  copy.querySelectorAll('.vditor-ir__marker,.katex').forEach(node => node.remove());
  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.matches('code[data-type="math-inline"]')) return `$${node.textContent}$`;
    if (node.matches('code[data-type="math-block"],code.language-math')) {
      return node.closest('[data-type="math-block"],pre') ? `$$${node.textContent}$$` : `$${node.textContent}$`;
    }
    const inlineCode = node.matches('[data-type="math-inline"],[data-type="inline-node"]') &&
      node.querySelector(':scope > code[data-type="math-inline"]');
    if (inlineCode) return `$${inlineCode.textContent}$`;
    const blockCode = node.matches('[data-type="math-block"]') &&
      node.querySelector('code[data-type="math-block"],code.language-math');
    if (blockCode) return `$$${blockCode.textContent}$$`;
    let out = '';
    for (const child of node.childNodes) out += walk(child);
    return out;
  };
  return walk(copy).replace(/\u200b/g, '');
};

// Use native (unwrapped) serializers when provided to avoid heal recursion.
const cellToMarkdown = (cell, lute, mode, nativeSerialize) => {
  const copy = cell.cloneNode(true);
  stripEditorChrome(copy);
  copy.querySelectorAll('.vditor-ir__marker').forEach(node => node.remove());
  const box = document.createElement('div');
  const p = document.createElement('p');
  while (copy.firstChild) p.append(copy.firstChild);
  box.append(p);
  const serialize = nativeSerialize || (mode === 'ir' ? lute.VditorIRDOM2Md.bind(lute) : lute.VditorDOM2Md.bind(lute));
  return serialize(box.innerHTML).trim();
};

const markdownToCellHtml = (md, lute, mode) => {
  const html = mode === 'ir' ? lute.Md2VditorIRDOM(md || '') : lute.Md2VditorDOM(md || '');
  const box = document.createElement('div');
  box.innerHTML = html;
  const block = box.querySelector('p,h1,h2,h3,h4,h5,h6') || box;
  return block.innerHTML;
};


const isEmptyMatrixCell = cell => !String(cell ?? '').replace(/[\s\u200b|]/g, '');
const isEmptyMatrixRow = row => Array.isArray(row) && row.length > 0 && row.every(isEmptyMatrixCell);

// Copied single rows always ship an empty <thead>; drop leading blank matrix
// rows so paste does not invent an empty <tr> / "||" gap.
const trimLeadingEmptyMatrixRows = matrix => {
  if (!matrix?.length) return matrix;
  let start = 0;
  while (start < matrix.length && isEmptyMatrixRow(matrix[start])) start++;
  return start ? matrix.slice(start) : matrix;
};

const isBlankParagraph = node => {
  if (!node || node.tagName !== 'P') return false;
  const text = (node.textContent || '').replace(/[\s\u200b]/g, '');
  return !text && !node.querySelector('img,table,code,iframe,hr,[data-type],input,svg,math');
};

const topLevelBlock = (node, pane) => {
  let el = elementOf(node);
  if (!el || !pane.contains(el)) return null;
  while (el.parentElement && el.parentElement !== pane) el = el.parentElement;
  return el.parentElement === pane ? el : null;
};

const skipBoundary = (node, dir) => {
  let next = node;
  while (next?.classList?.contains('vditor-editor-boundary')) {
    next = dir < 0 ? next.previousElementSibling : next.nextElementSibling;
  }
  return next;
};

// Caret on an empty paragraph beside a table (Enter after the table, gap
// before it): merge clipboard rows into that table instead of insertMarkdown.
const nearbyTableContext = (pane, selection) => {
  if (!pane || !selection?.rangeCount) return null;
  const anchor = selection.anchorNode;
  const cell = elementOf(anchor)?.closest('td,th');
  if (cell && pane.contains(cell)) return { kind: 'cell', cell, table: cell.closest('table') };
  const block = topLevelBlock(anchor, pane);
  if (!block) return null;
  if (block.tagName === 'TABLE') {
    const rows = [...block.rows];
    const last = rows[rows.length - 1];
    const startCell = last?.cells?.[0];
    if (!startCell) return null;
    return { kind: 'table', table: block, where: 'append', startCell, blank: null };
  }
  if (!isBlankParagraph(block)) return null;
  const prev = skipBoundary(block.previousElementSibling, -1);
  const next = skipBoundary(block.nextElementSibling, 1);
  if (prev?.tagName === 'TABLE') {
    return { kind: 'near', table: prev, where: 'append', blank: block };
  }
  if (next?.tagName === 'TABLE') {
    return { kind: 'near', table: next, where: 'prepend', blank: block };
  }
  return null;
};

const appendMatrixRows = (table, matrix, lute, mode) => {
  if (!matrix?.length) return false;
  const rows = [...table.rows];
  const width = Math.max(
    ...rows.map(row => row.cells.length),
    ...matrix.map(row => row.length),
    1
  );
  const startRow = table.insertRow(-1);
  for (let c = 0; c < width; c++) startRow.append(document.createElement('td'));
  return fillTableFromMatrix(startRow.cells[0], matrix, lute, mode);
};

const prependMatrixRows = (table, matrix, lute, mode) => {
  if (!matrix?.length) return false;
  const rows = [...table.rows];
  const width = Math.max(
    ...rows.map(row => row.cells.length),
    ...matrix.map(row => row.length),
    1
  );
  const headCount = table.tHead?.rows?.length || 0;
  let insertAt = headCount;
  for (let r = 0; r < matrix.length; r++) {
    const tr = table.insertRow(insertAt + r);
    for (let c = 0; c < width; c++) tr.append(document.createElement('td'));
    for (let c = 0; c < matrix[r].length; c++) {
      tr.cells[c].innerHTML = markdownToCellHtml(matrix[r][c], lute, mode);
    }
  }
  return true;
};

// Drop wholly empty / pipe-only rows left by empty-thead paste merges.
const removeEmptyPipeRows = root => {
  let changed = false;
  for (const row of [...root.querySelectorAll('table tr')]) {
    const cells = [...row.cells];
    if (!cells.length) continue;
    const table = row.closest('table');
    if (!table || table.rows.length <= 1) continue;
    const junk = cells.every(cell => {
      if (cell.querySelector('img,table')) return false;
      const probe = cellToProbeText(cell).replace(/[\s\u200b]/g, '');
      return !probe || /^\|+$/.test(probe);
    });
    if (!junk) continue;
    row.remove();
    changed = true;
  }
  return changed;
};

// Nested one-row tables inside a cell (paste of a row) flatten into sibling cells.
const flattenNestedRowTables = (root, lute, mode, nativeSerialize) => {
  let changed = false;
  for (const cell of [...root.querySelectorAll('td,th')]) {
    const nested = [...cell.children].filter(node => node.tagName === 'TABLE');
    if (nested.length !== 1) continue;
    if ([...cell.childNodes].some(node => {
      if (node === nested[0]) return false;
      return node.nodeType === Node.TEXT_NODE ? !!node.textContent.replace(/[\s\u200b]/g, '') : true;
    })) continue;
    const table = nested[0];
    if (table.rows.length !== 1) continue;
    const parts = [...table.rows[0].cells].map(c => cellToMarkdown(c, lute, mode, nativeSerialize));
    if (parts.length < 2) continue;
    const row = cell.parentElement;
    if (!row || row.tagName !== 'TR') continue;
    const start = cell.cellIndex;
    const following = [...row.cells].slice(start + 1, start + parts.length);
    if (following.some(cellMeaningful)) continue;
    while (row.cells.length < start + parts.length) {
      row.append(document.createElement(cell.tagName || 'td'));
    }
    for (let i = 0; i < parts.length; i++) {
      row.cells[start + i].innerHTML = markdownToCellHtml(parts[i], lute, mode);
    }
    changed = true;
  }
  return changed;
};

const jamPartsFromCell = (cell, lute, mode, nativeSerialize) => {
  const probe = cellToProbeText(cell);
  if (probe.includes('|') || probe.includes('\\|')) {
    const fromProbe = splitPipesOutsideMath(probe);
    if (fromProbe.length >= 2) return fromProbe;
  }
  let md = '';
  try { md = cellToMarkdown(cell, lute, mode, nativeSerialize); } catch { md = ''; }
  if (!md) md = (cell.textContent || '').replace(/\u200b/g, '');
  if (!md.includes('|') && !md.includes('\\|')) return null;
  const fromMd = splitPipesOutsideMath(md);
  return fromMd.length >= 2 ? fromMd : null;
};

// A row whose filled cell holds "a | b | c" (or "a|$ b $|$ c" / "a \| b") with
// empty neighbors is a paste/serialize jam: redistribute into the empty cells.
export function healJammedTableRows(root, lute, mode = 'wysiwyg', nativeSerialize) {
  let changed = flattenNestedRowTables(root, lute, mode, nativeSerialize);
  for (const row of root.querySelectorAll('table tr')) {
    const cells = [...row.cells];
    if (cells.length < 2) continue;
    const table = row.closest('table');
    const tableWidth = Math.max(
      cells.length,
      ...[...(table?.rows || [])].map(r => r.cells.length),
      2
    );
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].querySelector('table')) continue;
      const parts = jamPartsFromCell(cells[i], lute, mode, nativeSerialize);
      if (!parts || parts.length < 2) continue;
      const trailing = cells.slice(i + 1);
      const emptyTrailing = trailing.filter(c => !cellMeaningful(c)).length;
      // Require empty neighbors ahead (classic jam), and enough slots for the parts.
      if (emptyTrailing === 0) continue;
      if (parts.length > emptyTrailing + 1) continue;
      if (parts.length > tableWidth - i) continue;
      while (row.cells.length < i + parts.length) {
        row.append(document.createElement(cells[i].tagName || 'td'));
      }
      const target = [...row.cells];
      for (let k = 0; k < parts.length; k++) {
        target[i + k].innerHTML = markdownToCellHtml(parts[k], lute, mode);
      }
      changed = true;
      break;
    }
  }
  if (removeEmptyPipeRows(root)) changed = true;
  return changed;
};

const parseMarkdownTable = text => {
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 1) return null;
  const isSep = line => /^\|?[\t :|-]+\|?$/.test(line) && line.includes('-');
  const splitRow = line => {
    let body = line;
    if (body.startsWith('|')) body = body.slice(1);
    if (body.endsWith('|')) body = body.slice(0, -1);
    return splitPipesOutsideMath(body);
  };
  const rows = [];
  for (const line of lines) {
    if (isSep(line)) continue;
    if (!line.includes('|') && !line.includes('\\|')) return null;
    rows.push(splitRow(line));
  }
  return rows.length ? rows : null;
};

const parseHtmlTable = html => {
  const box = document.createElement('div');
  box.innerHTML = html;
  const table = box.querySelector('table');
  if (!table?.rows?.length) return null;
  return [...table.rows].map(row => [...row.cells].map(cell => cell.innerHTML));
};

const matrixFromClipboard = (html, text, lute, mode, nativeSerialize) => {
  if (html) {
    const fromHtml = parseHtmlTable(html);
    if (fromHtml) {
      return fromHtml.map(row => row.map(cellHtml => {
        const td = document.createElement('td');
        td.innerHTML = cellHtml;
        try { return cellToMarkdown(td, lute, mode, nativeSerialize); }
        catch { return td.textContent.trim(); }
      }));
    }
  }
  if (text && (text.includes('|') || text.includes('\\|'))) return parseMarkdownTable(text);
  return null;
};

const fillTableFromMatrix = (startCell, matrix, lute, mode) => {
  const startRow = startCell.parentElement;
  const table = startCell.closest('table');
  if (!startRow || !table || !matrix?.length) return false;
  const startCol = startCell.cellIndex;
  const rows = [...table.rows];
  const rowIndex = rows.indexOf(startRow);
  if (rowIndex < 0) return false;
  for (let r = 0; r < matrix.length; r++) {
    let target = rows[rowIndex + r];
    if (!target) {
      const width = Math.max(
        ...rows.map(row => row.cells.length),
        startCol + matrix[r].length,
        matrix[0].length
      );
      target = table.insertRow(-1);
      for (let c = 0; c < width; c++) target.append(document.createElement('td'));
      rows.push(target);
    }
    while (target.cells.length < startCol + matrix[r].length) {
      target.append(document.createElement(target.cells[0]?.tagName || 'td'));
    }
    for (let c = 0; c < matrix[r].length; c++) {
      target.cells[startCol + c].innerHTML = markdownToCellHtml(matrix[r][c], lute, mode);
    }
  }
  return true;
};

const markTablePreviews = table => {
  table?.querySelectorAll('.vditor-wysiwyg__preview,.vditor-ir__preview').forEach(node => {
    node.setAttribute('data-render', '2');
  });
};

// A Range inside a table omits its common ancestor when cloning. The Markdown
// converter needs TABLE / THEAD / TR context; bare cells become concatenated text.
export function tableClipboard(editor, range) {
  if (!range || range.collapsed || window.glassRawVisible) return null;
  const state = editor.vditor, pane = state[state.currentMode]?.element;
  if (!['wysiwyg', 'ir'].includes(state.currentMode) || !pane?.contains(range.commonAncestorContainer)) return null;
  if (elementOf(range.startContainer)?.closest('.cm-editor')) return null;
  range = window.glassMathClipboardRange?.(range) || range;
  const ancestor = elementOf(range.commonAncestorContainer);
  const table = ancestor?.closest('table');
  const box = document.createElement('div');
  let fragment = range.cloneContents();
  if (table) {
    // Copying text within a single cell keeps the editor's normal text behavior.
    if (ancestor.closest('td,th')) return null;
    for (let node = ancestor; node; node = node.parentElement) {
      const wrapper = node.cloneNode(false);
      wrapper.append(fragment); fragment = wrapper;
      if (node === table) break;
    }
  }
  box.append(fragment);
  if (!box.querySelector('table')) return null;
  for (const clone of box.querySelectorAll('table')) {
    const rows = [...clone.rows];
    if (!rows.length) continue;
    // Partial rows must keep their column positions without copying unselected
    // text. A body-only selection gets an empty Markdown header, not a data row.
    const first = elementOf(range.startContainer)?.closest('td,th');
    if (rows.length > 1 && first && table && clone === box.firstElementChild) {
      for (let i = 0; i < first.cellIndex; i++) rows[0].insertBefore(document.createElement(rows[0].cells[0]?.tagName || 'td'), rows[0].firstChild);
    }
    const width = Math.max(...rows.map(row => row.cells.length));
    for (const row of rows) while (row.cells.length < width) row.append(document.createElement(row.cells[0]?.tagName || 'td'));
    if (!clone.tHead?.rows.length) {
      const head = clone.createTHead().insertRow();
      for (let i = 0; i < width; i++) head.append(document.createElement('th'));
    }
  }
  // Match math-clipboard: drop KaTeX previews so DOM2Md keeps TeX source only.
  stripEditorChrome(box);
  const lute = state.lute;
  const markdown = (state.currentMode === 'ir' ? lute.VditorIRDOM2Md(box.innerHTML) : lute.VditorDOM2Md(box.innerHTML)).trim();
  if (!markdown) return null;
  const rich = document.createElement('div');
  rich.innerHTML = lute.Md2HTML(markdown);
  // Portable HTML has no editor UI, hidden source copies or KaTeX layout spans.
  // Keep explicit delimiters: HTML2Md otherwise treats language-math spans as
  // ordinary text, losing the formulas on a rich clipboard round trip.
  rich.querySelectorAll('.language-math').forEach(node => {
    const delimiter = node.tagName === 'DIV' ? '$$' : '$';
    node.replaceWith(document.createTextNode(delimiter + node.textContent + delimiter));
  });
  rich.querySelectorAll('table').forEach(node => { node.style.borderCollapse = 'collapse'; });
  rich.querySelectorAll('td,th').forEach(node => { node.style.border = '1px solid #aaa'; node.style.padding = '4px 8px'; });
  return { text: markdown, html: rich.innerHTML };
}

export function installTableClipboard(editor) {
  const lute = editor.vditor.lute;
  const nativeSerialize = {
    wysiwyg: lute.VditorDOM2Md.bind(lute),
    ir: lute.VditorIRDOM2Md.bind(lute),
  };

  const copy = event => {
    if (!event.clipboardData) return;
    const selection = getSelection();
    if (!selection?.rangeCount) return;
    const payload = tableClipboard(editor, selection.getRangeAt(0));
    if (!payload) return;
    event.clipboardData.setData('text/plain', payload.text);
    event.clipboardData.setData('text/html', payload.html);
    event.preventDefault(); event.stopImmediatePropagation();
  };
  editor.vditor.element.addEventListener('copy', copy, true);

  const applyTablePaste = (editorInstance, html, text) => {
    const state = editorInstance.vditor, mode = state.currentMode;
    if (!['wysiwyg', 'ir'].includes(mode)) return false;
    const pane = state[mode]?.element;
    const selection = getSelection();
    if (!pane || !selection?.rangeCount) return false;
    const ctx = nearbyTableContext(pane, selection);
    if (!ctx) return false;
    let matrix = matrixFromClipboard(html, text, state.lute, mode, nativeSerialize[mode]);
    if (!matrix) return false;
    matrix = trimLeadingEmptyMatrixRows(matrix);
    if (!matrix.length) return false;
    state.undo?.addToUndoStack?.(state);
    let ok = false;
    if (ctx.kind === 'cell') {
      ok = fillTableFromMatrix(ctx.cell, matrix, state.lute, mode);
    } else if (ctx.where === 'append') {
      ok = appendMatrixRows(ctx.table, matrix, state.lute, mode);
    } else if (ctx.where === 'prepend') {
      ok = prependMatrixRows(ctx.table, matrix, state.lute, mode);
    }
    if (!ok) return false;
    if (ctx.blank && isBlankParagraph(ctx.blank)) ctx.blank.remove();
    healJammedTableRows(ctx.table || pane, state.lute, mode, nativeSerialize[mode]);
    markTablePreviews(ctx.table);
    return true;
  };

  const paste = event => {
    if (event.defaultPrevented || window.glassRawVisible || !event.clipboardData) return;
    const state = editor.vditor, mode = state.currentMode;
    if (!['wysiwyg', 'ir'].includes(mode)) return;
    const pane = state[mode]?.element;
    const selection = getSelection();
    if (!pane?.contains(event.target) || !selection?.rangeCount) return;
    // Handle caret in a cell OR on a blank line beside a table.
    if (!nearbyTableContext(pane, selection)) return;
    const html = event.clipboardData.getData('text/html');
    const text = event.clipboardData.getData('text/plain');
    if (!applyTablePaste(editor, html, text)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Capture on the editor root. latex-paste listens on window; when it claims a
  // formula+table paste it must defer to glassPasteTableIntoCell (see latex-paste).
  editor.vditor.element.addEventListener('paste', paste, true);
  window.glassPasteTableIntoCell = (editorInstance, html, text) => {
    return applyTablePaste(editorInstance || editor, html, text);
  };
  window.glassHealJammedTables = (root) => {
    const mode = editor.vditor.currentMode;
    const pane = root || editor.vditor[mode]?.element;
    if (!pane) return false;
    const changed = healJammedTableRows(pane, editor.vditor.lute, mode, nativeSerialize[mode]);
    if (changed) markTablePreviews(pane);
    return changed;
  };

  if (!lute.glassTableHeal) {
    lute.glassTableHeal = true;
    for (const suffix of ['DOM', 'IRDOM']) {
      const serializeName = 'Vditor' + suffix + '2Md';
      const serialize = lute[serializeName].bind(lute);
      const mode = suffix === 'IRDOM' ? 'ir' : 'wysiwyg';
      nativeSerialize[mode] = serialize;
      lute[serializeName] = html => {
        const root = document.createElement('div');
        root.innerHTML = html;
        healJammedTableRows(root, lute, mode, serialize);
        return serialize(root.innerHTML);
      };
      const spinName = 'SpinVditor' + suffix;
      const spin = lute[spinName].bind(lute);
      lute[spinName] = html => {
        const out = spin(html);
        if (typeof out !== 'string' || (!out.includes('|') && !out.includes('\\|') && !out.includes('<table') && !out.includes('<TABLE'))) return out;
        const root = document.createElement('div');
        root.innerHTML = out;
        return healJammedTableRows(root, lute, mode, serialize) ? root.innerHTML : out;
      };
    }
    const runLiveHeal = () => {
      const mode = editor.vditor.currentMode;
      const pane = editor.vditor[mode]?.element;
      if (!pane?.querySelector?.('table')) return;
      if (healJammedTableRows(pane, editor.vditor.lute, mode, nativeSerialize[mode])) {
        markTablePreviews(pane);
      }
    };
    queueMicrotask(runLiveHeal);
    // Catch jams introduced after the first paint (paste via insertMarkdown, spin).
    let healTimer = 0;
    const scheduleHeal = () => {
      clearTimeout(healTimer);
      healTimer = setTimeout(runLiveHeal, 80);
    };
    editor.vditor.element.addEventListener('input', scheduleHeal);
    editor.vditor.element.addEventListener('paste', () => setTimeout(runLiveHeal, 0), true);
  }

  window.addEventListener('pagehide', () => {
    editor.vditor.element.removeEventListener('paste', paste, true);
    if (window.glassPasteTableIntoCell) delete window.glassPasteTableIntoCell;
    if (window.glassHealJammedTables) delete window.glassHealJammedTables;
  }, { once: true });
}
