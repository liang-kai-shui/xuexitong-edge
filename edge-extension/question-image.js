/* Render only question text with the fonts actually used by the course page. */
(() => {
  'use strict';
  const encrypted = el => !!el && (el.closest('.font-cxsecret,[class*="cxsecret"]') ||
    [...el.querySelectorAll('*'),el].some(node=>/cxsecret|encrypt[-_ ]?font/i.test(getComputedStyle(node).fontFamily)));
  async function render(parts) {
    let timer;
    try {await Promise.race([document.fonts.ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('题目字体尚未加载，请稍后重试')),5000);})]);}
    finally {clearTimeout(timer);}
    const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=3200;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('无法生成题目字形图像，已停止作答');
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111';ctx.textBaseline='top';
    let y=24;
    for(const {label,el} of parts) {
      if(el.querySelector('img,svg,math,canvas'))throw new Error('混淆字体题目含图片或公式，当前字形读题无法完整表示，请手动处理');
      ctx.font='bold 26px sans-serif';ctx.fillText(label,24,y);y+=42;
      let x=24,written=0;
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()) {
        const node=walker.currentNode,parent=node.parentElement;
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
    const image=out.toDataURL('image/png');
    if(image.length>1500000)throw new Error('题目图像过大，已停止作答');
    return image;
  }
  globalThis.XXTQuestionImage=Object.freeze({encrypted,render});
})();
