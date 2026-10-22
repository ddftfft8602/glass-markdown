const previews = new WeakMap();
window.glassEnhanceImagePreview = (overlay, image, source) => {
  overlay.classList.add('glass-image-preview'); overlay.tabIndex = -1;
  const stage = overlay.querySelector('.vditor-img-overlay__stage');
  const toolbar = overlay.querySelector('.vditor-img-overlay__toolbar');
  const abort = new AbortController(), signal = abort.signal, previousFocus = document.activeElement;
  let frame = 0, scale = 1, x = 0, y = 0, rotation = 0, fitted = true;
  let width = source.naturalWidth || image.naturalWidth || 1, height = source.naturalHeight || image.naturalHeight || 1;
  let rect, gesture, moved = false, startedOnImage = false;
  const pointers = new Map();
  const button = (action, label, icon) => {
    const el = document.createElement('button'); el.type = 'button'; el.className = 'vditor-img-overlay__btn';
    el.dataset.glassZoom = action; el.title = label; el.setAttribute('aria-label', label);
    if (icon) el.innerHTML = `<span class="codicon codicon-${icon}" aria-hidden="true"></span>`; else el.textContent = label;
    return el;
  };
  const out = button('out', '缩小', 'zoom-out'), zoom = button('actual', '100%'), inside = button('in', '放大', 'zoom-in'), fit = button('fit', '适应窗口');
  zoom.classList.add('glass-image-scale'); zoom.title = '按原始尺寸显示（100%）'; zoom.setAttribute('aria-label', zoom.title);
  toolbar.prepend(out, zoom, inside, fit);
  const hint = document.createElement('div'); hint.className = 'glass-image-hint';
  hint.textContent = '滚轮 / 双指捏合缩放 · 拖动查看 · Esc 关闭'; overlay.append(hint);
  const dimensions = () => rotation % 180 ? [height, width] : [width, height];
  const fitScale = () => { const [w, h] = dimensions(); return Math.min(1, rect.width / w, rect.height / h); };
  const clamp = value => Math.min(8, Math.max(Math.min(.05, fitScale()), value));
  const point = (clientX, clientY) => ({ x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 });
  const constrain = () => {
    const [w, h] = dimensions(), maxX = Math.max(0, (w * scale - rect.width) / 2), maxY = Math.max(0, (h * scale - rect.height) / 2);
    x = Math.min(maxX, Math.max(-maxX, x)); y = Math.min(maxY, Math.max(-maxY, y));
  };
  const draw = () => {
    frame = 0; constrain();
    image.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotation}deg) scale(${scale})`;
    zoom.textContent = `${Math.round(scale * 100)}%`;
    overlay.dataset.zoom = String(scale); overlay.dataset.panX = String(x); overlay.dataset.panY = String(y);
    out.disabled = scale <= Math.min(.05, fitScale()); inside.disabled = scale >= 8;
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
  const zoomTo = (next, anchor = { x: 0, y: 0 }) => {
    const old = scale; scale = clamp(next); const ratio = scale / old;
    x = anchor.x - (anchor.x - x) * ratio; y = anchor.y - (anchor.y - y) * ratio;
    fitted = false; schedule();
  };
  const fitImage = () => { scale = fitScale(); x = y = 0; fitted = true; schedule(); };
  const measure = () => { rect = stage.getBoundingClientRect(); if (fitted) fitImage(); else schedule(); };
  // The fixed stage has known viewport insets. Its first fit can use those
  // without forcing layout of the entire Markdown document during dblclick.
  const top = window.innerWidth <= 540 ? 88 : 64;
  rect = { left: 16, top, width: Math.max(1, window.innerWidth - 32), height: Math.max(1, window.innerHeight - top - 36) };
  image.style.width = `${width}px`; image.style.height = `${height}px`; scale = fitScale(); draw();
  image.addEventListener('load', () => {
    if (image.naturalWidth === width && image.naturalHeight === height) return;
    width = image.naturalWidth || width; height = image.naturalHeight || height;
    image.style.width = `${width}px`; image.style.height = `${height}px`; measure();
  }, { signal });
  window.addEventListener('resize', measure, { signal });
  overlay.addEventListener('wheel', event => {
    event.preventDefault(); event.stopPropagation();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    if (delta) zoomTo(scale * Math.exp(-Math.max(-400, Math.min(400, delta)) * .002), point(event.clientX, event.clientY));
  }, { passive: false, signal });
  toolbar.addEventListener('click', event => {
    const target = event.target.closest('button'); if (!target) return;
    const action = target.dataset.glassZoom;
    if (!action && target.dataset.action !== 'rotate') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (action === 'in') zoomTo(scale * 1.25);
    else if (action === 'out') zoomTo(scale / 1.25);
    else if (action === 'fit') fitImage();
    else if (action === 'actual') zoomTo(1);
    else { rotation = (rotation + 90) % 360; target.dataset.deg = String(rotation); if (fitted) fitImage(); else schedule(); }
  }, { capture: true, signal });
  const beginGesture = () => {
    const points = [...pointers.values()];
    if (points.length === 1) gesture = { point: points[0], x, y, scale };
    else if (points.length >= 2) gesture = { point: { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }, distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), x, y, scale };
    else gesture = null;
  };
  stage.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && (event.button !== 0 || event.target !== image)) return;
    if (!pointers.size) { moved = false; startedOnImage = event.target === image; }
    pointers.set(event.pointerId, point(event.clientX, event.clientY)); beginGesture();
    stage.setPointerCapture(event.pointerId); event.preventDefault(); stage.classList.add('is-dragging');
  }, { signal });
  stage.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    event.preventDefault(); pointers.set(event.pointerId, point(event.clientX, event.clientY));
    const points = [...pointers.values()];
    if (points.length >= 2 && gesture.distance) {
      const center = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
      scale = clamp(gesture.scale * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / gesture.distance);
      const ratio = scale / gesture.scale;
      x = center.x - (gesture.point.x - gesture.x) * ratio; y = center.y - (gesture.point.y - gesture.y) * ratio; moved = true;
    } else {
      const dx = points[0].x - gesture.point.x, dy = points[0].y - gesture.point.y;
      x = gesture.x + dx; y = gesture.y + dy; moved ||= Math.hypot(dx, dy) > 3;
    }
    fitted = false; schedule();
  }, { signal });
  const endPointer = event => {
    pointers.delete(event.pointerId); beginGesture();
    if (!pointers.size) stage.classList.remove('is-dragging');
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stage.addEventListener(type, endPointer, { signal });
  stage.addEventListener('click', event => { if (moved || startedOnImage) { event.preventDefault(); event.stopImmediatePropagation(); moved = startedOnImage = false; } }, { capture: true, signal });
  overlay.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      const buttons = [...toolbar.querySelectorAll('button:not(:disabled)')], index = buttons.indexOf(document.activeElement);
      const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
      event.preventDefault(); buttons[next].focus({ preventScroll: true });
    } else if (['+', '=', '-', '0', '1'].includes(event.key) && !event.altKey && !event.metaKey) {
      event.preventDefault(); event.stopPropagation();
      if (event.key === '0') fitImage(); else if (event.key === '1') zoomTo(1); else zoomTo(scale * (event.key === '-' ? .8 : 1.25));
    }
  }, { signal });
  const focusFrame = requestAnimationFrame(() => { if (!signal.aborted && overlay.isConnected) overlay.focus({ preventScroll: true }); });
  previews.set(overlay, () => { abort.abort(); cancelAnimationFrame(frame); cancelAnimationFrame(focusFrame); pointers.clear(); previousFocus?.isConnected && previousFocus.focus?.({ preventScroll: true }); });
};
window.glassDisposeImagePreview = overlay => { previews.get(overlay)?.(); previews.delete(overlay); };
