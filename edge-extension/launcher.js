/* Trusted extension page. Verify the worker before enabling launch actions. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),PROTOCOL='xxt-launch-v1';
  const UPDATE='扩展后台未更新或不支持启动页。请打开 edge://extensions，重新加载“学习通视频播放助手”，关闭旧启动页，再双击“启动学习.cmd”。';
  let selecting='',connected=false,busy=false,polling=false,active=false,notice=false;
  const version=()=>document.documentElement.dataset.version || '';
  function buttons(){for(const id of ['begin','portal'])$(id).disabled=!connected || busy || (id==='begin' && active);$('cancel').disabled=!connected || busy;}
  function fail(message){notice=true;$('status').textContent=message;buttons();}
  function contextReady(){
    try{const u=new URL(location.href),expected=new URL(chrome.runtime.getURL('launcher.html'));return (u.protocol===expected.protocol || (u.protocol==='extension:' && expected.protocol==='chrome-extension:')) && u.host===expected.host && u.pathname===expected.pathname && !!chrome.runtime.id;}
    catch{return false;}
  }
  async function send(data){
    let timer;
    try{
      const reply=await Promise.race([chrome.runtime.sendMessage({channel:'xxt-player-v1',...data}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('扩展后台 5 秒未响应。请重新加载扩展，然后点“重新检查连接”。')),5000);})]);
      if(reply?.error)throw Object.assign(Error(reply.error),{validation:true});
      if(reply?.protocol!==PROTOCOL || typeof reply.phase!=='string' || typeof reply.active!=='boolean')throw Error(UPDATE);
      if(reply.version!==version())throw Error('启动页和后台版本不一致。'+UPDATE);
      return reply;
    }catch(error){
      if(!error?.validation)connected=false;
      if(error?.message?.includes('Extension context invalidated') || error?.message?.includes('Receiving end does not exist'))throw Error(UPDATE);
      throw error;
    }finally{clearTimeout(timer);}
  }
  function render(f){
    active=f.active;$('status').textContent=f.message || '已连接，可启动';buttons();
    const key=JSON.stringify(f.choices || []);if(key===selecting)return;selecting=key;$('choices').replaceChildren();
    for(const item of f.choices || []){const b=document.createElement('button');b.textContent=item.title+'（'+item.key.split(':')[0]+'）';b.onclick=()=>void action({type:'LAUNCH_SELECT',courseKey:item.key},'正在选择课程…');$('choices').append(b);}
  }
  async function action(data,message){
    if(!connected || busy)return;notice=false;busy=true;buttons();$('status').textContent=message;
    try{render(await send(data));}catch(error){fail(error.message || '启动请求失败，请重新检查连接');}
    finally{busy=false;buttons();}
  }
  const begin=()=>action({type:'LAUNCH_BEGIN',courseId:$('courseId').value.trim(),loginMode:$('loginMode').value},'正在打开登录和课程页面…');
  async function connect(autorun=false){
    if(busy || polling)return;notice=false;connected=false;buttons();
    if(!contextReady()){fail('当前页面没有扩展权限。请关闭此页，从“启动学习.cmd”或 Edge 扩展选项重新打开；不要直接双击 launcher.html 或在 HTML 预览中启动。');return;}
    polling=true;$('status').textContent='正在连接扩展后台…';
    try{const f=await send({type:'LAUNCH_VIEW'});connected=true;render(f);if(autorun && !f.active)await begin();}
    catch(error){fail(error.message || UPDATE);}
    finally{polling=false;buttons();}
  }
  $('begin').onclick=()=>void begin();
  $('portal').onclick=()=>void action({type:'LAUNCH_PORTAL'},'正在打开课程列表…');
  $('cancel').onclick=()=>void action({type:'LAUNCH_CANCEL'},'正在停止启动导航…');
  $('retry').onclick=()=>void connect();
  $('diagnostic').onclick=async()=>{
    if(!connected){fail('请先点“重新检查连接”，再复制启动诊断');return;}
    try{const result=await send({type:'LAUNCH_DIAGNOSTIC'}),json=JSON.stringify(result.diagnostic,null,2);$('diagnosticText').value=json;$('diagnosticText').hidden=false;
      try{await navigator.clipboard.writeText(json);$('diagnostic').textContent='已复制启动诊断';}catch{$('diagnostic').textContent='请复制下方诊断文本';}
    }catch(error){fail(error.message || UPDATE);}
  };
  $('settings').onclick=async()=>{try{if(!contextReady())throw Error('请从 Edge 扩展选项打开设置');await chrome.runtime.openOptionsPage();}catch(error){fail(error.message || UPDATE);}};
  $('manage').onclick=async event=>{if(!contextReady() || !chrome.tabs?.create)return;event.preventDefault();try{await chrome.tabs.create({url:'edge://extensions/'});}catch{fail('请在 Edge 地址栏输入 edge://extensions，重新加载本扩展。');}};
  const params=new URL(location.href).searchParams,course=params.get('courseId');if(course && /^[1-9]\d{0,19}$/.test(course))$('courseId').value=course;
  setInterval(async()=>{
    if(!connected || busy || polling || notice)return;polling=true;
    try{render(await send({type:'LAUNCH_VIEW'}));}catch(error){connected=false;fail(error.message || UPDATE);}
    finally{polling=false;}
  },1000);
  void connect(params.get('autorun')==='1');
})();
