/* Serialized by chrome.scripting; keep all dependencies inside the function. */
globalThis.XXTPageAction = async function ({ kind, token, text }) {
  const root = [...document.querySelectorAll('[data-xxt-action]')].find(el => el.getAttribute('data-xxt-action') === token);
  if (!root) return { ok:false, error:'目标页面已变化' };
  if(kind==='mouse') {
    const key=Symbol.for('xxt-player.mouseLeaveGuard');
    if(text==='off') {window[key]?.restore();return {ok:true,enabled:false};}
    if(text!=='on')return {ok:false,error:'无效鼠标事件设置'};
    if(window[key])return {ok:true,enabled:true};
    const events=['mouseout','mouseleave','pointerout','pointerleave'];
    const guard=event=>{
      if(event.pointerType && event.pointerType!=='mouse')return;
      // Browser chrome is outside the DOM: the last target may be a header,
      // link, or assistant child rather than body/html. A null relatedTarget
      // covers this path (and cross-document exits) without swallowing moves
      // between controls that still have a related target in the page.
      const leavesPage=event.relatedTarget===null;
      if(!leavesPage && event.composedPath().some(node=>node?.id==='xxt-player-assistant'))return;
      const videos=[...document.querySelectorAll('video')];
      const frames=[...document.querySelectorAll('iframe[src*="/ananas/modules/video/"],iframe[src*="/knowledge/cards"]')];
      const surfaces=[...new Set([...videos,...frames,...videos.map(video=>video.closest('.video-js,.ans-video-player,[data-vjs-player]')).filter(Boolean)])];
      if(!surfaces.length)return;
      const target=event.target,related=event.relatedTarget;
      const contains=(el,node)=>!!node && node instanceof Node && (el===node || el.contains(node));
      const leavesSurface=surfaces.some(el=>contains(el,target) && !contains(el,related));
      if(leavesSurface || leavesPage)event.stopImmediatePropagation();
    };
    for(const event of events)window.addEventListener(event,guard,true);
    const restore=()=>{for(const event of events)window.removeEventListener(event,guard,true);delete window[key];};
    window[key]={restore};return {ok:true,enabled:true};
  }
  if(kind==='foreground') {
    const key=Symbol.for('xxt-player.foregroundCompat');
    if(text==='off') {window[key]?.restore();return {ok:true,enabled:false};}
    if(text!=='on')return {ok:false,error:'无效兼容设置'};
    if(window[key])return {ok:true,enabled:true};
    const saved=new Map(['hidden','visibilityState','hasFocus'].map(name=>[name,Object.getOwnPropertyDescriptor(document,name)]));
    const restore=()=>{
      for(const [name,descriptor] of saved) {if(descriptor)Object.defineProperty(document,name,descriptor);else delete document[name];}
      delete window[key];
    };
    try {
      Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>'visible'});
      Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>true});
      window[key]={restore};return {ok:true,enabled:true};
    } catch {restore();return {ok:false,error:'页面不允许修改可见性读取'};}
  }
  if (kind === 'editor') {
    const editors = Object.values(window.UE?.instants || {});
    const editor = editors.find(ed => [ed.container, ed.iframe, ed.textarea].some(el => el && typeof el==='object' && el.nodeType && root.contains(el)));
    if (!editor?.setContent || !editor?.sync || !editor?.getContentTxt) return { ok:false, unavailable:true };
    const escaped = document.createElement('div');
    escaped.textContent = text;
    editor.setContent('<p>' + escaped.innerHTML.replace(/\r?\n/g, '</p><p>') + '</p>');
    editor.fireEvent?.('contentchange');
    editor.sync();
    editor.blur?.();
    editor.sync();
    const body=editor.body || editor.iframe?.contentDocument?.body;
    let field=typeof editor.textarea==='object' && editor.textarea?.tagName==='TEXTAREA' ? editor.textarea : null;
    if(!field && editor.options?.textarea) field=document.getElementById('ueditor_textarea_'+editor.options.textarea);
    if(!field) { const fields=root.querySelectorAll('textarea');if(fields.length===1)field=fields[0]; }
    let fieldText=field?.value;
    if(field && /<\/?(?:p|div|span|br|strong|em|ol|ul|li)\b/i.test(fieldText || '')) {
      const template=document.createElement('template');template.innerHTML=fieldText;fieldText=template.content.textContent;
    }
    return { ok:true, text:editor.getContentTxt(),domText:body?.innerText || body?.textContent || '',fieldFound:!!field,fieldText };
  }
  if (kind === 'submit' || kind === 'confirm') {
    const original = window.confirm;
    window.confirm = function (message) {
      const value = String(message || '');
      if (/提交/.test(value) && /确定|确认|是否|不能修改|不可修改/.test(value) && !/未答|未完成|验证码|人脸/.test(value)) return true;
      return original.call(window, message);
    };
    try { root.click(); return { ok:true }; }
    finally { window.confirm = original; }
  }
  return {ok:false, error:'未知页面操作'};
};
