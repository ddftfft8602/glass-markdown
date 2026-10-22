const elementOf = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
const mathBlock = node => {
  const element = elementOf(node);
  const inline = element?.closest('[data-type="math-inline"]');
  if (inline) return inline.tagName === 'CODE' ? inline.parentElement : inline;
  const block = element?.closest('[data-type="math-block"],[data-type="code-block"]');
  return block?.querySelector('pre > code.language-math') ? block : null;
};
const pathTo = (root, node) => {
  const path = [];
  while (node && node !== root) {
    path.unshift([...node.parentNode.childNodes].indexOf(node)); node = node.parentNode;
  }
  return node === root ? path : null;
};

// Called when the bundled search bar is constructed. Keep its text matching,
// regular expressions, replacements and keyboard controls; formula navigation
// uses the rendered preview instead of opening a source editor.
window.glassInstallFormulaSearch = find => {
  const root = find.vditor.element;
  const outline = document.createElement('div');
  outline.className = 'glass-find-formula'; outline.hidden = true;
  outline.setAttribute('aria-hidden','true'); root.append(outline);
  let current, searchedPane, frame = 0;
  const previewOf = block => {
    const preview = block?.querySelector('.vditor-wysiwyg__preview,.vditor-ir__preview');
    return preview?.getClientRects().length ? preview.querySelector('.katex') || preview : block;
  };
  const position = () => {
    frame = 0;
    const pane = find.getEditorRoot();
    if (!find.isVisible() || window.glassRawVisible || !current?.isConnected || !pane?.contains(current)) { outline.hidden = true; return; }
    const box = previewOf(current).getBoundingClientRect(), viewport = pane.getBoundingClientRect();
    const left = Math.max(viewport.left,box.left-3), top = Math.max(viewport.top,box.top-3);
    const right = Math.min(viewport.right,box.right+3), bottom = Math.min(viewport.bottom,box.bottom+3);
    outline.hidden = !box.width || !box.height || right<=left || bottom<=top;
    Object.assign(outline.style,{left:`${left}px`,top:`${top}px`,width:`${Math.max(0,right-left)}px`,height:`${Math.max(0,bottom-top)}px`});
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(position); };
  const clear = () => { current = null; outline.hidden = true; };
  const search = find.search;
  find.search = function(...args) {
    const pane = this.getEditorRoot();
    if (searchedPane !== pane) { this.bindEditorRefresh(); searchedPane = pane; }
    return search.apply(this,args);
  };
  const navigate = find.navigate, focusInput = find.focusInput;
  find.navigate = function(direction) {
    if (searchedPane !== this.getEditorRoot()) { this.search(); return; }
    return navigate.call(this,direction);
  };
  find.focusInput = function() {
    if (searchedPane !== this.getEditorRoot()) this.search();
    return focusInput.call(this);
  };
  const collect = find.collectDomMatches;
  find.collectDomMatches = function(content, pattern) {
    collect.call(this,content,pattern);
    // KaTeX's accessibility tree must not duplicate matches in its source.
    this.matches = this.matches.filter(match => {
      if (match.kind !== 'dom') return true;
      const node = this.getDomMatchRange(match)?.startContainer;
      return !mathBlock(node) && !elementOf(node)?.closest('.katex');
    });
    const pane = this.getEditorRoot();
    for (const code of content.querySelectorAll('code[data-type="math-inline"]')) {
      if (code.closest('.vditor-wysiwyg__preview,.vditor-ir__preview,.cm-editor')) continue;
      const walker = document.createTreeWalker(code,NodeFilter.SHOW_TEXT); let node;
      while (node = walker.nextNode()) {
        const regex = new RegExp(pattern.global.source,pattern.global.flags), path = pathTo(pane,node); let match;
        if (!path) continue;
        while ((match = regex.exec(node.data)) !== null) {
          if (!match[0]) { regex.lastIndex++; continue; }
          this.matches.push({kind:'dom',startPath:path,startOffset:match.index,endPath:path,endOffset:match.index+match[0].length,glassMath:code.parentElement});
        }
      }
    }
  };
  const collectCode = find.applyCodeMirrorHighlights;
  find.applyCodeMirrorHighlights = function(...args) {
    collectCode.apply(this,args);
    for (const match of this.matches) if (match.kind === 'cm' && mathBlock(match.block)) match.glassMath = match.block;
  };
  const update = find.updateCurrent;
  find.updateCurrent = function() {
    const keepFindFocus = this.element.contains(document.activeElement);
    clear();
    const match = this.matches[this.currentIndex], block = match?.glassMath;
    if (block?.isConnected) {
      window.glassRevealHeadingTarget?.(block);
      this.renderDomHighlights(); this.updateCodeMirrorDecorations();
      const pane = this.getScrollElement(), target = previewOf(block), box = target.getBoundingClientRect();
      const viewport = pane.getBoundingClientRect();
      if (box.height) pane.scrollTop += box.top+box.height/2-viewport.top-viewport.height/2;
      current = block; position(); schedule();
    } else {
      if (match?.kind === 'dom') window.glassRevealHeadingTarget?.(this.getDomMatchRange(match)?.startContainer);
      update.call(this);
    }
    // A mutation refresh while the user edits a formula must not take focus
    // back from its source editor. Navigation buttons still retain find focus.
    if (keepFindFocus) this.scheduleRestoreFindFocus();
  };
  const clearHighlights = find.clearHighlights;
  find.clearHighlights = function() { clear(); return clearHighlights.call(this); };
  root.addEventListener('scroll',schedule,true); window.addEventListener('resize',schedule);
  const resize = new ResizeObserver(schedule); resize.observe(root);
  window.addEventListener('pagehide',()=>{
    cancelAnimationFrame(frame); resize.disconnect(); outline.remove();
    root.removeEventListener('scroll',schedule,true); window.removeEventListener('resize',schedule);
  },{once:true});
};
