// Folding is presentation only: buttons and hiding rules live outside the
// editable DOM, so Markdown, clipboard conversion and history keep all blocks.
export function installHeadingFolding(editor) {
  const root = editor.vditor.element, folded = new Set(['document-notes']); // notes collapsed by default
  const layer = document.createElement('div'); layer.className = 'glass-heading-folds';
  const style = document.createElement('style');
  root.append(layer, style);
  let entries = [], pane, frame, pointer;
  const headingName = heading => {
    const copy = heading.cloneNode(true);
    copy.querySelectorAll('.vditor-ir__marker,.vditor-wysiwyg__preview,.vditor-ir__preview,.cm-editor,.vditor-cm-chrome').forEach(node => node.remove());
    return copy.textContent.replace(/\u200b/g, '').trim();
  };
  const place = () => {
    frame = 0;
    if (!pane?.isConnected) return;
    const viewport = pane.getBoundingClientRect();
    for (const entry of entries) {
      const {heading,button} = entry, box = heading.getBoundingClientRect();
      const size = parseFloat(getComputedStyle(heading,entry.note?'::before':null).lineHeight) || 26;
      const inset = entry.note ? parseFloat(getComputedStyle(heading).paddingTop)+1 : 0;
      const x = Math.max(viewport.left + 3, box.left - 27), y = box.top + inset + Math.min(size,box.height)/2 - 10;
      button.hidden = !box.height || y < viewport.top || y+20 > viewport.bottom || window.glassRawVisible;
      button.style.left = `${x}px`; button.style.top = `${y}px`;
      button.classList.toggle('glass-fold-near', !!pointer && Math.hypot(pointer.x-x-10,pointer.y-y-10)<64);
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
  const update = () => {
    pane = editor.vditor[editor.vditor.currentMode]?.element;
    if (!pane) return;
    const children = [...pane.children], seen = new Map(), old = new Map(entries.map(entry => [entry.key,entry.button]));
    entries = [];
    children.forEach((heading,index) => {
      const note=heading.matches('[data-type="footnotes-block"]');
      if (!note && !/^H[1-6]$/.test(heading.tagName)) return;
      const name = note?'备注':headingName(heading), level = note?1:Number(heading.tagName[1]);
      const signature = level+':'+name, count = seen.get(signature)||0; seen.set(signature,count+1);
      const key = note?'document-notes':signature+':'+count;
      let end=index+1;
      while (end<children.length && !children[end].matches('[data-type="footnotes-block"]') &&
        !(/^H[1-6]$/.test(children[end].tagName) && Number(children[end].tagName[1])<=level)) end++;
      const body=note?[...heading.children]:children.slice(index+1,end).filter(node=>!node.classList.contains('vditor-editor-boundary'));
      if (!body.length) return;
      const button=old.get(key)||document.createElement('button'); old.delete(key);
      button.type='button';button.className='glass-heading-fold';button.dataset.foldKey=key;
      button.setAttribute('aria-expanded',String(!folded.has(key)));
      button.setAttribute('aria-label',`${folded.has(key)?'展开':'折叠'}“${name||'空标题'}”`);
      button.title=button.getAttribute('aria-label');
      if (!button.firstChild) {const icon=document.createElement('span');icon.setAttribute('aria-hidden','true');button.append(icon);}
      if (button.parentNode!==layer) layer.append(button);
      entries.push({heading,button,key,body,index,end,note});
    });
    old.forEach(button=>button.remove());
    const mode=editor.vditor.currentMode;
    const rules=entries.filter(entry=>folded.has(entry.key)).map(entry=>
      entry.note ? `.vditor-${mode} .vditor-reset > [data-type="footnotes-block"] > *{display:none!important}` :
      `.vditor-${mode} .vditor-reset > :nth-child(n+${entry.index+2}):nth-child(-n+${entry.end}):not(.vditor-editor-boundary){display:none!important}`
    ).join('\n');
    const css=rules?`@media screen{${rules}}`:'';
    if (style.textContent!==css) style.textContent=css;
    schedule();
  };
  const expandAll = () => {if (folded.size) {folded.clear();update();}};
  const nativeScrollToBlock=editor.scrollToBlock;
  editor.scrollToBlock=function(...args){expandAll();return nativeScrollToBlock.apply(this,args);};
  const reveal = target => {
    let changed=false;
    for (const entry of entries) if (folded.has(entry.key) && entry.body.some(node=>node===target || node.contains(target))) {
      folded.delete(entry.key);changed=true;
    }
    if (changed) update();
  };
  window.glassRevealHeadingTarget = reveal;
  const foldPointer = event => {if(layer.contains(event.target)){event.preventDefault();event.stopPropagation();}};
  window.addEventListener('mousedown',foldPointer,true);
  layer.addEventListener('click',event=>{
    const button=event.target.closest('button'); if (!button) return;
    const entry=entries.find(entry=>entry.button===button);if (!entry) return;
    event.preventDefault();event.stopPropagation();
    if (folded.has(entry.key)) folded.delete(entry.key);
    else {
      const selection=getSelection();
      if (entry.body.some(node=>node.contains(selection?.anchorNode)||node.contains(selection?.focusNode)||node.contains(document.activeElement))) {
        const range=document.createRange();
        if(entry.note){range.setStartBefore(entry.heading);range.collapse(true);}
        else {range.selectNodeContents(entry.heading);range.collapse(false);}
        pane.focus({preventScroll:true});selection.removeAllRanges();selection.addRange(range);
      }
      folded.add(entry.key);
    }
    update();
  });
  const move = event => {pointer={x:event.clientX,y:event.clientY};schedule();};
  const leave = () => {pointer=null;schedule();};
  const selectionChanged = () => {if(window.glassRawVisible)return;const target=getSelection()?.anchorNode;if (target && pane?.contains(target)) reveal(target);};
  const expandForDelete = direction => {
    const selection=getSelection();if(!selection?.rangeCount || !pane?.contains(selection.anchorNode))return;
    const range=selection.getRangeAt(0),rect=range.getBoundingClientRect();
    let block=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    while(block!==pane && block.parentElement!==pane)block=block.parentElement;
    const edge=range.cloneRange();edge.selectNodeContents(block);edge.setEnd(range.startContainer,range.startOffset);
    const leading=edge.cloneContents();
    leading.querySelectorAll('[data-type="heading-marker"]').forEach(node=>node.remove());
    const atStart=!leading.textContent.replace(/\u200b/g,'');
    let changed=false;
    for(const entry of entries)if(folded.has(entry.key)){
      const affected=range.collapsed ? entry.heading===block || entry.body.some(node=>node.contains(range.startContainer)) ||
        (direction==='backward' && atStart && entry.body.includes(block.previousElementSibling)) :
        entry.body.some(node=>range.intersectsNode(node));
      if(affected){folded.delete(entry.key);changed=true;}
    }
    if(changed){
      update();
      const next=range.getBoundingClientRect();
      // Expanding a preceding section must keep the editing line in place.
      if(rect.height && next.height)pane.scrollTop+=next.top-rect.top;
    }
  };
  const key = event => {
    if (!pane?.contains(event.target) || event.target.closest('.cm-editor')) return;
    if (['Backspace','Delete'].includes(event.key)) expandForDelete(event.key==='Backspace'?'backward':'forward');
    else if((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='a')expandAll();
    else if((event.ctrlKey||event.metaKey) && event.key.toLowerCase()==='x')expandForDelete('selection');
  };
  const input = event => {if (pane?.contains(event.target) && /^delete/.test(event.inputType||'')) expandForDelete(/Backward$/.test(event.inputType)?'backward':'forward');};
  const outline = event => {
    if (event.target.closest('.vditor-outline__action')) return;
    const link=event.target.closest('.vditor-outline [data-target-id]');
    if (link) {const target=pane?.querySelector(`[id="${CSS.escape(link.dataset.targetId)}"]`);if(target)reveal(target);}
  };
  const observer=new MutationObserver(records=>{
    if (records.some(record=>{
      const node=record.target.nodeType===1?record.target:record.target.parentElement;
      return node?.closest('.vditor-reset') || node?.matches('.vditor-wysiwyg,.vditor-ir');
    })) update();
  });
  observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['style']});
  const sourceObserver=new MutationObserver(schedule);
  sourceObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
  const resize=new ResizeObserver(schedule);resize.observe(root);
  for (const mode of ['wysiwyg','ir']) if (editor.vditor[mode]?.element) resize.observe(editor.vditor[mode].element);
  document.addEventListener('pointermove',move,{passive:true});document.addEventListener('pointerleave',leave);
  document.addEventListener('selectionchange',selectionChanged);
  root.addEventListener('scroll',schedule,true);root.addEventListener('keydown',key,true);
  root.addEventListener('beforeinput',input,true);root.addEventListener('click',outline,true);
  window.addEventListener('resize',schedule);update();
  window.addEventListener('pagehide',()=>{
    observer.disconnect();sourceObserver.disconnect();resize.disconnect();cancelAnimationFrame(frame);
    document.removeEventListener('pointermove',move);document.removeEventListener('pointerleave',leave);
    document.removeEventListener('selectionchange',selectionChanged);
    root.removeEventListener('scroll',schedule,true);root.removeEventListener('keydown',key,true);
    root.removeEventListener('beforeinput',input,true);root.removeEventListener('click',outline,true);
    window.removeEventListener('resize',schedule);layer.remove();style.remove();
    window.removeEventListener('mousedown',foldPointer,true);
    editor.scrollToBlock=nativeScrollToBlock;
    if(window.glassRevealHeadingTarget===reveal)delete window.glassRevealHeadingTarget;
  },{once:true});
}
