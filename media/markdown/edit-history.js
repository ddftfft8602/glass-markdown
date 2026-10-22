// Native snapshots carry the caret from the previous edit. Track transaction
// endpoints separately so undoing an edit here doesn't focus an earlier edit
// elsewhere (and reveal a folded chapter containing that stale caret).
export function installEditHistory(editor) {
  const state=editor.vditor, root=state.element, undo=state.undo;
  const transactions=new WeakMap();
  let candidate, pending, afterEdit, restoring=false, generation=0;
  const pane=()=>state[state.currentMode]?.element;
  const snapshot=()=>{
    const current=pane(),selection=getSelection();
    if (!current || !selection?.rangeCount || !current.contains(selection.anchorNode) || !current.contains(selection.focusNode)) return null;
    const endpoint=(node,offset)=>{
      if(node===current)return {root:true,offset};
      let block=node.nodeType===1?node:node.parentElement;
      while(block.parentElement!==current)block=block.parentElement;
      const range=document.createRange();range.selectNodeContents(block);range.setEnd(node,offset);
      const element=node.nodeType===1?node:node.parentElement;
      return {index:[...current.children].indexOf(block),offset:range.toString().length,
        inSyntax:!!element?.closest('.vditor-ir__marker')};
    };
    return {mode:state.currentMode,anchor:endpoint(selection.anchorNode,selection.anchorOffset),focus:endpoint(selection.focusNode,selection.focusOffset),top:current.scrollTop};
  };
  const restore=bookmark=>{
    const current=pane();if(!bookmark || bookmark.mode!==state.currentMode)return false;
    const endpoint=point=>{
      if(point.root)return [current,Math.min(point.offset,current.childNodes.length)];
      const block=current.children[point.index];if(!block)return null;
      const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);let remaining=point.offset,last;
      while(walker.nextNode()){
        const node=walker.currentNode;last=node;
        // A rendered heading's first text position has the same text offset
        // as the end of its hidden "## " marker. Restore the visible side
        // unless the original edit deliberately happened inside source syntax.
        if(remaining<=node.length && !(remaining===node.length && !point.inSyntax && node.parentElement.closest('.vditor-ir__marker')))return [node,remaining];
        remaining-=node.length;
      }
      return last?[last,last.length]:[block,0];
    };
    const anchor=endpoint(bookmark.anchor),focus=endpoint(bookmark.focus);
    if(!anchor||!focus)return false;
    current.focus({preventScroll:true});getSelection().setBaseAndExtent(...anchor,...focus);return true;
  };
  const inProse=event=>pane()?.contains(event.target) && !event.target.closest?.('.cm-editor,input,textarea');
  const before=event=>{if(inProse(event)&&!restoring)candidate=snapshot();};
  const input=event=>{
    if(!inProse(event)||restoring)return;
    if(!pending && candidate)pending=candidate;
    afterEdit=snapshot();
    candidate=null;
    const turn=generation;
    queueMicrotask(()=>{if(!restoring && pending && generation===turn)afterEdit=snapshot()||afterEdit;});
  };
  const key=event=>{
    generation++;
    if(inProse(event) && (event.key.length===1 || ['Backspace','Delete','Enter','Tab'].includes(event.key)))candidate=snapshot();
  };
  const nativeAdd=undo.addToUndoStack;
  const withoutCaret = html => html?.replace(/<wbr\b[^>]*>|<span\b[^>]*class="vditor-wbr"[^>]*><\/span>/g,'');
  undo.addToUndoStack=function(context){
    const history=this[context.currentMode],previous=history.undoStack.at(-1),previousText=history.lastText;
    const previousLength=history.undoStack.length,previousFirst=history.undoStack[0],previousRedo=history.redoStack,previousHasUndo=history.hasUndo;
    const result=nativeAdd.call(this,context),patch=history.undoStack.at(-1);
    // Delayed serialization after leaving an empty inline source can snapshot
    // only the caret moving into prose. It must not consume an undo step.
    if (patch!==previous && previous && withoutCaret(previousText)===withoutCaret(history.lastText)) {
      history.undoStack.pop();
      if(history.undoStack.length<previousLength)history.undoStack.unshift(previousFirst);
      history.lastText=previousText;history.redoStack=previousRedo;history.hasUndo=previousHasUndo;this.resetIcon(context);
      pending=null;candidate=null;afterEdit=null;return result;
    }
    if(patch!==previous){
      if(pending?.mode===context.currentMode)transactions.set(patch,{before:pending,after:afterEdit||snapshot()});
    }
    pending=null;candidate=null;afterEdit=null;
    return result;
  };
  const natives={undo:undo.undo,redo:undo.redo};
  for(const action of ['undo','redo'])undo[action]=function(context){
    // CodeMirror owns its local history and scrolling.
    if(document.activeElement?.closest('.cm-editor'))return natives[action].call(this,context);
    if(pending?.mode===context.currentMode)this.addToUndoStack(context);
    const current=pane(),history=this[context.currentMode],patch=history[action==='undo'?'undoStack':'redoStack'].at(-1);
    const transaction=transactions.get(patch),bookmark=transaction?.[action==='undo'?'before':'after'];
    const top=current.scrollTop,turn=++generation;
    restoring=true;
    try {
      const result=natives[action].call(this,context);
      if(bookmark)restore(bookmark);
      const range=getSelection()?.rangeCount?getSelection().getRangeAt(0):null;
      const viewport=current.getBoundingClientRect(),rect=range?.getBoundingClientRect();
      // First try the current viewport. If undo intentionally targets a
      // different page, use that transaction's original reading position.
      const y=rect?.top+current.scrollTop-top;
      const desired=bookmark && rect?.height && (y<viewport.top || y+rect.height>viewport.bottom)?bookmark.top:top;
      current.scrollTop=desired;
      requestAnimationFrame(()=>{if(generation===turn && pane()===current)current.scrollTop=desired;});
      return result;
    } finally {restoring=false;candidate=null;pending=null;afterEdit=null;}
  };
  const cancel=()=>{generation++;candidate=null;};
  const resets={};
  for(const name of ['setValue','switchEditMode','clearStack']){
    resets[name]=editor[name];
    editor[name]=function(...args){
      generation++;candidate=null;pending=null;afterEdit=null;
      return resets[name].apply(this,args);
    };
  }
  window.addEventListener('keydown',key,true);
  root.addEventListener('beforeinput',before,true);root.addEventListener('input',input,true);
  root.addEventListener('cut',before,true);
  window.addEventListener('pointerdown',cancel,true);window.addEventListener('wheel',cancel,{passive:true});
  window.addEventListener('pagehide',()=>{
    generation++;undo.addToUndoStack=nativeAdd;Object.assign(undo,natives);Object.assign(editor,resets);
    window.removeEventListener('keydown',key,true);root.removeEventListener('beforeinput',before,true);root.removeEventListener('input',input,true);
    root.removeEventListener('cut',before,true);
    window.removeEventListener('pointerdown',cancel,true);window.removeEventListener('wheel',cancel);
  },{once:true});
}
