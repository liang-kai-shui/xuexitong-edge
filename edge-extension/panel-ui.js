/* Panel layout only; playback state is owned by the existing coordinator. */
(() => {
  'use strict';
  function attach(host,send) {
    const root=host.shadowRoot,header=root.querySelector('#panelHeader'),body=root.querySelector('#panelBody'),toggle=root.querySelector('#minimize');
    let position=null,minimized=false,drag=null,revision=0,disposed=false,resizeTimer;
    const clamp=(value,max)=>Math.min(Math.max(8,value),Math.max(8,max));
    function place(x,y) {
      const box=host.getBoundingClientRect();
      position={x:clamp(x,innerWidth-box.width-8),y:clamp(y,innerHeight-box.height-8)};
      Object.assign(host.style,{left:`${position.x}px`,top:`${position.y}px`,right:'auto',bottom:'auto'});
    }
    function fit() {if(position)place(position.x,position.y);}
    function persist() {
      if(disposed)return;
      const box=host.getBoundingClientRect();
      const normalized=position?{x:Math.max(0,Math.min(1,box.left/Math.max(1,innerWidth-box.width))),y:Math.max(0,Math.min(1,box.top/Math.max(1,innerHeight-box.height)))}:null;
      void send({type:'PANEL_SAVE',panelUi:{minimized,position:normalized}}).catch(()=>{});
    }
    function collapse(value) {
      minimized=value;body.hidden=value;host.dataset.minimized=String(value);
      host.style.width=value?'230px':'330px';
      toggle.textContent=value?'＋':'−';
      toggle.setAttribute('aria-expanded',String(!value));
      toggle.setAttribute('aria-label',value?'展开助手':'最小化助手');toggle.title=value?'展开':'最小化';
      fit();
    }
    toggle.onclick=()=>{revision++;collapse(!minimized);persist();};
    function down(event) {
      if(event.button!==0 || event.isPrimary===false || event.target.closest('button,a,input,select,textarea,[role="button"]'))return;
      event.preventDefault();revision++;
      const box=host.getBoundingClientRect();place(box.left,box.top);
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:position.x,top:position.y};
      header.setPointerCapture(event.pointerId);host.dataset.dragging='true';
    }
    function move(event) {if(drag?.id===event.pointerId)place(drag.left+event.clientX-drag.x,drag.top+event.clientY-drag.y);}
    function finish(event) {
      if(!drag || event.pointerId!==drag.id)return;
      const id=drag.id;drag=null;delete host.dataset.dragging;
      if(header.hasPointerCapture(id))header.releasePointerCapture(id);
      persist();
    }
    function resize() {fit();clearTimeout(resizeTimer);resizeTimer=setTimeout(persist,250);}
    header.addEventListener('pointerdown',down);header.addEventListener('pointermove',move);
    for(const type of ['pointerup','pointercancel','lostpointercapture'])header.addEventListener(type,finish);
    window.addEventListener('resize',resize);
    const observer=new ResizeObserver(fit);observer.observe(host);
    void send({type:'PANEL_GET'}).then(result=>{
      if(disposed || revision || !result?.panelUi)return;
      collapse(!!result.panelUi.minimized);
      const saved=result.panelUi.position;
      if(saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        const box=host.getBoundingClientRect();place(saved.x*Math.max(1,innerWidth-box.width),saved.y*Math.max(1,innerHeight-box.height));
      }
    }).catch(()=>{});
    return ()=>{
      disposed=true;clearTimeout(resizeTimer);observer.disconnect();window.removeEventListener('resize',resize);
      header.removeEventListener('pointerdown',down);header.removeEventListener('pointermove',move);
      for(const type of ['pointerup','pointercancel','lostpointercapture'])header.removeEventListener(type,finish);
    };
  }
  globalThis.XXTPanelUi=Object.freeze({attach});
})();
