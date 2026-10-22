/**
 * Click-only table caret fix.
 *
 * Chromium contenteditable often leaves the caret on the editor pane at a
 * TABLE child offset when the user clicks a cell. Typing then inserts a
 * paragraph *before* the table.
 *
 * Strategy (deliberately minimal):
 *  - On pointer/click: if the live caret ended up pane@TABLE-before, place it
 *    into the clicked cell (prefer caretRangeFromPoint).
 *  - NEVER relocate while the caret is already inside ANY td/th.
 *  - Do NOT listen to keydown/beforeinput. Moving the selection during an
 *    insert attempt eats the first character and can dump the next into the
 *    wrong cell after IR re-renders (detached lastCell → old first-cell
 *    fallback).
 *  - glassRescueTableCaret remains for blank-line-deletion's pane@TABLE-before
 *    path only: uses last clicked cell, or the same row/col after re-render.
 *    NEVER falls back to table.querySelector("th,td") (first cell).
 *  - Pane@TABLE-after is left alone so blank-line-deletion can create a
 *    paragraph below the table.
 */
const elementOf = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;

const paneOf = editor => {
  const state = editor?.vditor;
  if (!state) return null;
  return state[state.currentMode]?.element || null;
};

const cellOf = node => {
  const el = elementOf(node);
  return el?.closest?.("td,th") || null;
};

const isEditableChrome = node =>
  !!elementOf(node)?.closest?.(
    ".vditor-ir__marker,.vditor-wysiwyg__preview,.vditor-ir__preview,.vditor-cm-host,.vditor-table-handle,.vditor-block-handle"
  );

const firstLastText = (cell, wantLast) => {
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (isEditableChrome(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let first = null, last = null, node;
  while ((node = walker.nextNode())) {
    if (!first) first = node;
    last = node;
  }
  return wantLast ? last : first;
};

const syncVditorRange = (editor, range) => {
  const state = editor?.vditor;
  const mode = state?.currentMode;
  if (!state || !mode || !range) return;
  try { state[mode].range = range.cloneRange(); } catch {}
};

const selectionInside = (cell, range) => {
  if (!cell || !range) return false;
  const node = range.startContainer;
  return cell === node || cell.contains(node);
};

const cellFromPoint = (x, y, pane) => {
  if (x == null || y == null) return null;
  const stack = document.elementsFromPoint?.(x, y) || [];
  for (const el of stack) {
    if (!(el instanceof Element) || !pane.contains(el)) continue;
    const cell = el.closest("td,th");
    if (cell && pane.contains(cell)) return cell;
  }
  return null;
};

const cellCoords = cell => {
  if (!(cell instanceof HTMLTableCellElement)) return null;
  const tr = cell.parentElement;
  if (!(tr instanceof HTMLTableRowElement)) return null;
  const table = cell.closest("table");
  if (!table) return null;
  return { row: tr.rowIndex, col: cell.cellIndex };
};

const cellAtCoords = (table, coords) => {
  if (!table || !coords) return null;
  const row = table.rows?.[coords.row];
  if (!row) return null;
  return row.cells?.[coords.col] || null;
};

/** When the caret sits on the pane at a TABLE boundary, return that table + side. */
export function tableAtPaneCaret(pane, range) {
  if (!pane || !range || range.startContainer !== pane) return null;
  const at = pane.childNodes[range.startOffset];
  if (at?.nodeType === 1 && at.tagName === "TABLE") return { table: at, atEnd: false };
  const before = range.startOffset > 0 ? pane.childNodes[range.startOffset - 1] : null;
  if (before?.nodeType === 1 && before.tagName === "TABLE") return { table: before, atEnd: true };
  return null;
}

export function placeCaretInCell(cell, atEnd = false) {
  if (!(cell instanceof HTMLElement)) return null;
  const selection = getSelection();
  if (!selection) return null;
  const range = document.createRange();
  const text = firstLastText(cell, atEnd);
  if (text) {
    if (atEnd) range.setStart(text, text.data.length);
    else range.setStart(text, text.data.charAt(0) === "\u200b" ? Math.min(1, text.data.length) : 0);
  } else {
    // Empty cell: one zwsp so IR has an editable text node.
    const zwsp = document.createTextNode("\u200b");
    cell.insertBefore(zwsp, cell.firstChild);
    range.setStart(zwsp, 1);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

export function installTableFocus(editor) {
  const root = editor.vditor.element;
  /** @type {HTMLElement|null} */
  let lastCell = null;
  /** @type {{row:number,col:number}|null} */
  let lastCoords = null;
  let lastClickX = null;
  let lastClickY = null;

  const remember = cell => {
    if (!cell?.isConnected) return;
    lastCell = cell;
    lastCoords = cellCoords(cell);
  };

  const resolvePreferredCell = table => {
    if (!table) return null;
    if (lastCell?.isConnected && table.contains(lastCell)) return lastCell;
    const byCoords = cellAtCoords(table, lastCoords);
    if (byCoords && table.contains(byCoords)) return byCoords;
    const pane = paneOf(editor);
    if (pane) {
      const byPoint = cellFromPoint(lastClickX, lastClickY, pane);
      if (byPoint && table.contains(byPoint)) return byPoint;
    }
    // Never fall back to the first cell (that caused 2nd letter -> row0/col0).
    return null;
  };

  const fixInto = (cell, atEnd = false) => {
    if (!cell?.isConnected) return false;
    const range = placeCaretInCell(cell, atEnd);
    if (!range) return false;
    syncVditorRange(editor, range);
    remember(cell);
    return true;
  };

  /**
   * Only when the live caret is on the pane at TABLE-before: move into a cell.
   * If caret is already inside ANY td/th: never relocate.
   * Returns true if the selection was moved.
   */
  const rescueCaret = () => {
    const pane = paneOf(editor);
    const selection = getSelection();
    if (!pane || pane.getAttribute("contenteditable") !== "true" || window.glassRawVisible) return false;
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);

    // Hard rule: already in a cell → never relocate.
    const inside = cellOf(range.startContainer);
    if (inside && pane.contains(inside)) {
      syncVditorRange(editor, range);
      remember(inside);
      return false;
    }

    // Caret in another block (paragraph, heading, …): never steal.
    if (range.startContainer !== pane) return false;

    const boundary = tableAtPaneCaret(pane, range);
    if (!boundary) return false;

    // TABLE-after: leave alone — blank-line-deletion creates a paragraph.
    if (boundary.atEnd) return false;

    const cell = resolvePreferredCell(boundary.table);
    if (!cell) return false;
    return fixInto(cell, false);
  };

  const onPointer = event => {
    if (event.button != null && event.button !== 0) return;
    const pane = paneOf(editor);
    if (!pane || window.glassRawVisible) return;
    const target = event.target instanceof Element ? event.target : elementOf(event.target);
    if (!target || !pane.contains(target)) return;
    if (target.closest(".vditor-table-handle,.vditor-block-handle,.glass-heading-fold")) return;

    lastClickX = event.clientX;
    lastClickY = event.clientY;

    const cell = target.closest("td,th") || cellFromPoint(event.clientX, event.clientY, pane);
    if (!cell || !pane.contains(cell)) {
      if (!target.closest("table")) {
        lastCell = null;
        lastCoords = null;
      }
      return;
    }
    remember(cell);

    // Let the browser place the caret, then correct pane@TABLE-before only.
    // If caret is already inside ANY cell, leave it alone.
    requestAnimationFrame(() => {
      const paneNow = paneOf(editor);
      if (!paneNow || !cell.isConnected) return;
      const selection = getSelection();
      if (!selection?.rangeCount) {
        fixInto(cell, false);
        return;
      }
      const range = selection.getRangeAt(0);

      const insideAny = cellOf(range.startContainer);
      if (insideAny && paneNow.contains(insideAny)) {
        syncVditorRange(editor, range);
        remember(insideAny);
        return;
      }

      const boundary = tableAtPaneCaret(paneNow, range);
      if (!(boundary && !boundary.atEnd && boundary.table.contains(cell))) return;

      let placed = null;
      if (document.caretRangeFromPoint) {
        try { placed = document.caretRangeFromPoint(event.clientX, event.clientY); } catch {}
      }
      if (placed && selectionInside(cell, placed)) {
        selection.removeAllRanges();
        selection.addRange(placed);
        syncVditorRange(editor, placed);
        remember(cell);
        return;
      }
      fixInto(cell, false);
    });
  };

  for (const type of ["mousedown", "pointerdown", "click"]) {
    root.addEventListener(type, onPointer, true);
  }
  window.addEventListener("pagehide", () => {
    for (const type of ["mousedown", "pointerdown", "click"]) root.removeEventListener(type, onPointer, true);
  }, { once: true });

  window.glassRescueTableCaret = rescueCaret;
  window.glassPlaceCaretInCell = placeCaretInCell;
  window.glassTableAtPaneCaret = tableAtPaneCaret;
}
