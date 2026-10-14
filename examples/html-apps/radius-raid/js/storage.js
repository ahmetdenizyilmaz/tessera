// Tessera adaptation, 2026-10-14. MIT; see LICENSE.txt.
$.storageKey = 'tessera-radius-raid-stats-v1';
$.readStorage = function () {
  let saved;
  try { saved = JSON.parse(localStorage.getItem($.storageKey)); } catch {}
  const result = {mute: true, score: 0, level: 0, rounds: 0, kills: 0, bullets: 0, powerups: 0, time: 0};
  for (const key of Object.keys(result)) {
    if (key !== 'mute' && Number.isSafeInteger(saved?.[key]) && saved[key] >= 0) result[key] = saved[key];
  }
  return result;
};
$.setupStorage = function () {
  $.storage = $.readStorage();
  $.storageBaseline = {...$.storage};
};
$.updateStorage = function () {
  const latest = $.readStorage();
  for (const key of Object.keys(latest)) {
    if (key === 'mute') continue;
    $.storage[key] = ['score', 'level'].includes(key) ? Math.max($.storage[key], latest[key])
      : Math.min(Number.MAX_SAFE_INTEGER, latest[key] + Math.max(0, $.storage[key] - $.storageBaseline[key]));
  }
  try { localStorage.setItem($.storageKey, JSON.stringify($.storage)); } catch {}
  $.storageBaseline = {...$.storage};
};
$.clearStorage = function () {
  try { localStorage.removeItem($.storageKey); } catch {}
  $.setupStorage();
};
