/* Opt-in startup runner. It remains inactive unless the extension launcher armed it. */
(() => {
  'use strict';
  if(!/(^|\.)chaoxing\.com$/.test(location.hostname))return;
  const send=data=>chrome.runtime.sendMessage({channel:'xxt-player-v1',...data});
  let busy=false,seen=false,withoutForm=0,qrClicked=false,choicesSent='',landingFlow='',portalShape='';
  async function tick(){
    if(busy)return;busy=true;
    try{
      const f=await send({type:'LAUNCH_STATUS'});if(!f?.active)return;
      if(XXTStartupDOM.verification())return;
      if(['login','portal'].includes(f.phase) && location.hostname==='v1.chaoxing.com' && /^\/manage\/?$/.test(location.pathname)){
        if(landingFlow!==f.id){landingFlow=f.id;await send({type:'LAUNCH_PORTAL_LANDING',id:f.id});}
        return;
      }
      const login=XXTStartupDOM.login(),authHost=['v8.chaoxing.com','passport2.chaoxing.com'].includes(location.hostname);
      if(authHost && login.present){
        withoutForm=0;
        if(!seen){seen=true;await send({type:'LAUNCH_LOGIN_SEEN',id:f.id});}
        if(location.hostname==='passport2.chaoxing.com')await send({type:'LAUNCH_LOGIN_PAGE',id:f.id});
        else if(f.loginMode==='qr' && login.qr && !qrClicked){qrClicked=true;login.qr.click();}
        return;
      }
      if(authHost && f.phase==='login' && (seen || f.loginOwner)){
        if(!withoutForm)withoutForm=Date.now();
        if(document.readyState==='complete' && Date.now()-withoutForm>=2000)await send({type:'LAUNCH_LOGIN_READY',id:f.id});
        return;
      }
      if(['login','portal'].includes(f.phase)){
        const all=XXTStartupDOM.courses(),summary=XXTStartupDOM.portalSummary?.(all) || {links:0,candidates:0,recognized:all.length},shape=f.id+':'+JSON.stringify(summary);
        if(shape!==portalShape){portalShape=shape;await send({type:'LAUNCH_PORTAL_SCAN',id:f.id,...summary});}
        if(!all.length)return;
        const available=all.filter(c=>!c.complete),matched=available.filter(c=>(!f.courseId || c.courseId===f.courseId) && (!f.courseKey || c.key===f.courseKey));
        if(matched.length===1){await send({type:'LAUNCH_OPEN_COURSE',id:f.id,url:matched[0].url});return;}
        if(!available.length){await send({type:'LAUNCH_FINISHED',id:f.id,total:all.length,pending:0,unknown:0});return;}
        const choices=f.courseId?matched:available,choiceKey=choices.map(c=>c.key).join('|');
        if(choices.length>1 && choiceKey!==choicesSent){choicesSent=choiceKey;await send({type:'LAUNCH_CHOICES',id:f.id,courses:choices.map(({key,title})=>({key,title}))});}
        return;
      }
      if(f.phase==='course'){
        const rows=XXTStartupDOM.chapters();
        if(rows.length){
          const next=rows.find(row=>row.pending>0);
          if(next){if(!next.visible)return;const claim=await send({type:'LAUNCH_CHAPTER',id:f.id,chapterId:next.chapterId,pending:next.pending});if(claim.ok && next.target.isConnected)next.target.click();return;}
          if(rows.every(row=>row.done))await send({type:'LAUNCH_FINISHED',id:f.id,total:rows.length,pending:0,unknown:0});
          return;
        }
        const menu=XXTStartupDOM.chapterMenu();if(menu){const claim=await send({type:'LAUNCH_MENU',id:f.id});if(claim.ok && menu.isConnected)menu.click();}
      }
    }catch{ /* The launcher view reports timeouts; do not loop clicks on errors. */ }
    finally{busy=false;}
  }
  setInterval(()=>void tick(),1000);void tick();
})();
