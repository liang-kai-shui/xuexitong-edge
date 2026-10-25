/* Render only question text and loaded images, never the whole course page. */
(() => {
  'use strict';
  const encrypted = el => !!el && (el.closest('.font-cxsecret,[class*="cxsecret"]') ||
    [...el.querySelectorAll('*'),el].some(node=>/cxsecret|encrypt[-_ ]?font/i.test(getComputedStyle(node).fontFamily)));
  const media = el => !!el && (el.matches('img,svg,math,canvas') || !!el.querySelector('img,svg,math,canvas'));
  const shown=el=>getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden' && el.getClientRects().length>0;
  async function imageReady(img) {
    if(!img.complete)await new Promise((resolve,reject)=>{
      let timer;
      const finish=error=>{clearTimeout(timer);img.removeEventListener('load',loaded);img.removeEventListener('error',failed);error?reject(error):resolve();};
      const loaded=()=>finish(),failed=()=>finish(new Error('题目图片加载失败，请刷新课程页或恢复图片后重试'));
      img.addEventListener('load',loaded,{once:true});img.addEventListener('error',failed,{once:true});
      timer=setTimeout(()=>finish(new Error('题目图片尚未加载完成，请稍后重试')),5000);
      if(img.complete)loaded();
    });
    if(!img.naturalWidth || !img.naturalHeight)throw new Error('题目图片未加载或已损坏，缺少完整题干；请刷新课程页或恢复图片后重试');
  }
  async function render(parts) {
    let timer;
    try {await Promise.race([document.fonts.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('题目字体尚未加载，请稍后重试')),5000);})]);}
    finally {clearTimeout(timer);}
    const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=3200;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法生成题目字形图像，已停止作答');
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111';ctx.textBaseline='top';
    let y=24;
    for(const {label,el} of parts) {
      if(el.matches('svg,math,canvas') || el.querySelector('svg,math,canvas'))throw new Error('题目含尚不支持的 SVG、MathML 或画布公式，请手动核对');
      const images=[...(el.matches('img')?[el]:[]),...el.querySelectorAll('img')].filter(shown);
      if(images.length>12)throw new Error('单个题干或选项图片过多，请手动核对');
      await Promise.all(images.map(imageReady));
      ctx.font='bold 26px sans-serif';ctx.fillText(label,24,y);y+=42;
      let x=24,written=0;
      const drawImage=img=>{
        if(x!==24)y+=42;
        const scale=Math.min(1,928/img.naturalWidth,1600/img.naturalHeight),width=Math.ceil(img.naturalWidth*scale),height=Math.ceil(img.naturalHeight*scale);
        if(y+height>3100)throw new Error('题目图像过长，已停止作答');
        ctx.drawImage(img,24,y,width,height);x=24;y+=height+20;
      };
      if(el.matches('img') && images.includes(el))drawImage(el);
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
      while(walker.nextNode()) {
        const node=walker.currentNode,parent=node.parentElement;
        if(node.nodeType===Node.ELEMENT_NODE) {
          if(!shown(node))continue;
          if(node.matches('br')){x=24;y+=42;continue;}
          if(node.matches('img') && images.includes(node))drawImage(node);
          continue;
        }
        if(!parent || parent.closest('script,style,.xxt-ai-explanation'))continue;
        const css=getComputedStyle(parent);
        if(css.display==='none'||css.visibility==='hidden'||!parent.getClientRects().length)continue;
        ctx.font=`${css.fontStyle} ${css.fontWeight} 28px ${css.fontFamily}`;
        for(const char of (node.nodeValue || '').replace(/\s+/g,' ')) {
          if(++written>6500)throw new Error('题目文字过长，已停止图像读题');
          const width=ctx.measureText(char).width;
          if(x+width>976){x=24;y+=42;}
          if(y>3100)throw new Error('题目图像过长，已停止作答');
          ctx.fillText(char,x,y);x+=width;
        }
      }
      y+=64;
    }
    const out=document.createElement('canvas');out.width=1000;out.height=y+16;
    out.getContext('2d').drawImage(canvas,0,0);
    let image;
    try {image=out.toDataURL('image/png');}
    catch(error){if(error.name==='SecurityError')throw new Error('题目图片受跨域读取限制，无法生成完整题图，请手动处理');throw error;}
    if(image.length>1500000)throw new Error('题目图像过大，已停止作答');
    return image;
  }
  globalThis.XXTQuestionImage=Object.freeze({encrypted,media,render});
})();
