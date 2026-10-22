/**
 * Guard Vditor block-handle (6-dot) so tables / code / math blocks are never
 * flattened into list items. Vditor's drop-into-list path uses
 * li.innerHTML = block.innerHTML, which destroys TABLE structure.
 *
 * - Click (no meaningful move): no-op, table stays a table.
 * - Drag: reorder only among direct siblings of the editor pane (lists stay atomic).
 */
const HANDLE_DRAG = '.vditor-block-handle__drag';
const TARGET = '.vditor-block-handle-target';
const DROP_LINE = 'glass-block-handle-drop-line';
const THRESHOLD = 5;

const isProtected = el => !!el && (
  el.tagName === 'TABLE' ||
  el.tagName === 'PRE' ||
  el.getAttribute('data-type') === 'code-block' ||
  el.getAttribute('data-type') === 'math-block'
);

const paneOf = (editor) => {
  const state = editor?.vditor;
  if (!state) return null;
  return state[state.currentMode]?.element || null;
};

const siblingBlocks = (pane, except) => [...pane.children].filter(node => {
  if (node === except) return false;
  if (!(node instanceof HTMLElement)) return false;
  if (node.classList.contains('vditor-block-handle')) return false;
  if (node.classList.contains('vditor-block-handle__drop-line')) return false;
  if (node.classList.contains(DROP_LINE)) return false;
  return true;
});

const ensureDropLine = (pane) => {
  let line = pane.querySelector(`:scope > .${DROP_LINE}`);
  if (!line) {
    line = document.createElement('div');
    line.className = DROP_LINE;
    line.style.cssText = 'position:absolute;left:0;right:0;height:2px;background:var(--link-color,#0366d6);pointer-events:none;display:none;z-index:6;';
    pane.style.position ||= 'relative';
    pane.appendChild(line);
  }
  return line;
};

const placeDropLine = (line, pane, ref) => {
  const paneBox = pane.getBoundingClientRect();
  const y = ref ? ref.getBoundingClientRect().top : (pane.lastElementChild && pane.lastElementChild !== line
    ? pane.lastElementChild.getBoundingClientRect().bottom
    : paneBox.bottom);
  line.style.display = 'block';
  line.style.top = `${y - paneBox.top + pane.scrollTop}px`;
};

export function installBlockHandleGuard(editor) {
  let session = null;

  const finish = (ev) => {
    if (!session) return;
    const { pointerId, startX, startY, block, pane, line } = session;
    if (ev && ev.pointerId !== pointerId) return;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', finish, true);
    document.removeEventListener('pointercancel', finish, true);
    if (line) line.style.display = 'none';
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    const moved = session.moved;
    session = null;
    if (!moved || !block?.isConnected || !pane?.contains(block)) return;

    const y = ev?.clientY ?? startY;
    const siblings = siblingBlocks(pane, block);
    let ref = null;
    for (const node of siblings) {
      const box = node.getBoundingClientRect();
      if (y < box.top + box.height / 2) { ref = node; break; }
    }
    const state = editor.vditor;
    state?.undo?.addToUndoStack?.(state);
    if (ref) pane.insertBefore(block, ref);
    else {
      const lineNode = pane.querySelector(`:scope > .${DROP_LINE}`);
      if (lineNode) pane.insertBefore(block, lineNode);
      else pane.appendChild(block);
    }
    block.classList.add('vditor-block-handle-target');
  };

  const onMove = (ev) => {
    if (!session || ev.pointerId !== session.pointerId) return;
    const dx = ev.clientX - session.startX;
    const dy = ev.clientY - session.startY;
    if (!session.moved && (Math.abs(dx) > THRESHOLD || Math.abs(dy) > THRESHOLD)) {
      session.moved = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    }
    if (!session.moved) return;
    ev.preventDefault();
    const siblings = siblingBlocks(session.pane, session.block);
    let ref = null;
    for (const node of siblings) {
      const box = node.getBoundingClientRect();
      if (ev.clientY < box.top + box.height / 2) { ref = node; break; }
    }
    placeDropLine(session.line, session.pane, ref);
  };

  const onDown = (ev) => {
    if (ev.button !== 0) return;
    if (!ev.target?.closest?.(HANDLE_DRAG)) return;
    if (window.glassRawVisible) return;
    const block = document.querySelector(TARGET);
    const pane = paneOf(editor);
    if (!isProtected(block) || !pane || !pane.contains(block)) return;

    // Take over from Vditor so its list-flattening drop path never runs.
    ev.preventDefault();
    ev.stopImmediatePropagation();

    session = {
      pointerId: ev.pointerId,
      startX: ev.clientX,
      startY: ev.clientY,
      block,
      pane,
      moved: false,
      line: ensureDropLine(pane),
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', finish, true);
  };

  // Capture on the editor shell so we run before Vditor's button listener.
  const root = editor.vditor?.element || document.getElementById('vditor');
  root?.addEventListener('pointerdown', onDown, true);
}
