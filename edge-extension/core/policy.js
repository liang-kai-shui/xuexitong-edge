/* Pure policy helpers shared by the service worker, content scripts and tests. */
(() => {
  "use strict";
  const PLAYBACK_RATES = Object.freeze([0, 1, 1.25, 1.5, 1.75, 2, 2.5, 3]);
  const REPORT_TTL = 5000;
  const validRate = value => Number.isFinite(value) && PLAYBACK_RATES.includes(value);
  const PENDING_SUBMISSION = Object.freeze(["awaiting_confirmation", "confirming", "submitted"]);
  const pendingSubmission = record => PENDING_SUBMISSION.includes(record?.status);
  /* Merge fresh per-frame reports into the coordinator snapshot. */
  function select(reports, now) {
    const fresh = reports.filter(r => now - r.at < REPORT_TTL);
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
  globalThis.XXTPolicy = Object.freeze({ PLAYBACK_RATES, REPORT_TTL, validRate, pendingSubmission, select });
})();
