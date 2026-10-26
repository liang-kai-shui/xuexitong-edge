/* Conservative DOM navigation: only native links and explicit pending counts. */
(() => {
  'use strict';
  const text=el=>(el?.innerText || el?.textContent || '').replace(/\s+/g,' ').trim();
  const visible=el=>!!el?.isConnected && getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden' && el.getClientRects().length>0;
  function exact(label){return [...document.querySelectorAll('a,button,[role="tab"],li,span')].find(el=>visible(el) && text(el)===label && ![...el.children].some(child=>text(child)===label));}
  function login(){
    // Presence only; never access input.value or QR contents.
    const present=[...document.querySelectorAll('input[type="password"]')].some(visible) || !!exact('扫码登录') || !!exact('账号登录');
    return {present,qr:exact('扫码登录')};
  }
  function courses(){
    const out=[],seen=new Set();
    for(const link of document.querySelectorAll('a[href]')){
      if(!visible(link))continue;
      let url;try{url=new URL(link.getAttribute('href'),document.baseURI);}catch{continue;}
      const info=XXTPolicy.courseEntry(url.href);
      if(!info || /\/studentstudy\/?$/.test(url.pathname) || seen.has(info.key))continue;
      const card=link.closest('li,.course,.course-item,.course-info,.courseInfo,.course-box') || link.parentElement;
      const name=card?.querySelector('.course-name,[class*="courseName"],h3,h4');
      const title=(name?.getAttribute('title') || text(name) || link.getAttribute('title') || text(link)).slice(0,120) || '课程 '+info.courseId;
      const progress=/任务点(?:进度)?\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/.exec(text(card));
      const complete=!!progress && Number(progress[2])>0 && Number(progress[1])>=Number(progress[2]);
      seen.add(info.key);out.push({key:info.key,courseId:info.courseId,title,complete,url:url.href});
    }
    return out;
  }
  function portalSummary(found=courses()){
    return {links:[...document.querySelectorAll('a[href]')].filter(visible).length,candidates:[...document.querySelectorAll('.course-name,[class*="courseName"],.course-item,.course-info')].filter(visible).length,recognized:found.length};
  }
  function chapters(){
    const candidates=[...document.querySelectorAll('.chapter_item,.posCatalog_select:not(.firstLayer),.chapter-item,[data-knowledgeid],[data-knowledge-id]')];
    const rows=candidates.filter(el=>!candidates.some(child=>child!==el && el.contains(child)));
    return rows.map(row=>{
      const status=row.querySelector('.catalog_task') || row;
      const done=!!status.querySelector('.icon_yiwanc,.icon_yiwancheng,[title="已完成"],[aria-label="已完成"]') || row.matches('.completed,.ans-job-finished');
      const point=status.querySelector('.catalog_points_yi,.orange');
      const count=/^\d+$/.test(text(point))?Number(text(point)):0;
      const pending=!done && count>0?count:0;
      const target=row.querySelector('.catalog_name [title],.catalog_name,.posCatalog_name,a,[onclick]') || row;
      let chapterId=row.getAttribute('data-knowledgeid') || row.getAttribute('data-knowledge-id') || row.getAttribute('knowledgeid') || '';
      const href=target.getAttribute('href');
      if(href){try{const url=new URL(href,document.baseURI);chapterId=url.searchParams.get('chapterId') || url.searchParams.get('chapterid') || chapterId;}catch{ /* Not a navigable URL. */ }}
      return {target,visible:visible(target),title:text(target).slice(0,120),done,pending,chapterId:/^[1-9]\d{0,19}$/.test(chapterId)?chapterId:''};
    });
  }
  function verification(){return [...document.querySelectorAll('#captcha,.validateBox,.geetest_panel,.yidun_popup,[role="dialog"],.risk-warning')].some(el=>visible(el) && /验证码|滑块|人脸|身份验证|安全验证|异常学习|违规学习/.test(text(el)));}
  globalThis.XXTStartupDOM=Object.freeze({login,courses,portalSummary,chapters,chapterMenu:()=>exact('章节'),verification});
})();
