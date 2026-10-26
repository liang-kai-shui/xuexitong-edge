/* Shared by the isolated content scripts, service worker and local tests. */
(() => {
  "use strict";
  const PLAYBACK_RATES = Object.freeze([0, 1, 1.25, 1.5, 1.75, 2]);
  const validRate = value => PLAYBACK_RATES.includes(value);
  function parseCourse(raw, entry) {
    try {
      const url = new URL(raw);
      if(url.protocol!=='https:' || url.username || url.password || !/(^|\.)chaoxing\.com$/.test(url.hostname) || !(entry?(/\/mycourse\/stu\/?$/.test(url.pathname) || /^\/visit\/stucoursemiddle\/?$/.test(url.pathname)):/\/mycourse\/(studentstudy|stu)\/?$/.test(url.pathname)))return null;
      const values=names=>[...new Set([...url.searchParams].filter(([key])=>names.includes(key.toLowerCase())).map(([,value])=>value))];
      const ids=values(['courseid']),classes=values(['clazzid','classid']);
      const valid=value=>/^[1-9]\d{0,19}$/.test(value);
      if(ids.length!==1 || !valid(ids[0]) || classes.length>1 || classes.some(value=>!valid(value)))return null;
      return {courseId:ids[0],classId:classes[0] || '',key:`${ids[0]}:${classes[0] || ''}`};
    } catch { return null; }
  }
  const courseInfo=raw=>parseCourse(raw,false);
  const courseEntry=raw=>parseCourse(raw,true);
  const coursePage=raw=>!!courseInfo(raw);
  function select(reports, now) {
    const fresh = reports.filter(r => now - r.at < 5000);
    const blocked = fresh.find(r => r.blocked);
    const media = fresh.filter(r => r.videos.length).sort((a, b) => a.frameId - b.frameId);
    const pending = media.find(r => r.videos.some(v => !v.completed));
    return {
      blocked: blocked?.blocked || "",
      activeFrame: pending?.frameId ?? -1,
      allDone: media.length > 0 && media.every(r => r.videos.every(v => v.completed)),
      count: media.reduce((n, r) => n + r.videos.length, 0),
      fresh
    };
  }
  globalThis.XXTPolicy = Object.freeze({ PLAYBACK_RATES, validRate, courseInfo, courseEntry, coursePage, select });
})();
