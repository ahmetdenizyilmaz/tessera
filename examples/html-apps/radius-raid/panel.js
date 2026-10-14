// Tessera adaptation, 2026-10-14. MIT; see LICENSE.txt.
(() => {
  const find = selector => document.querySelector(selector);
  function saveBest() {
    if ($.state !== 'play' && $.state !== 'pause') return;
    if ($.score > $.storage.score) { $.storage.score = $.score; $.updateStorage(); }
  }
  function changed() {
    find('#play').textContent = $.state === 'play' ? 'Pause' : $.state === 'pause' ? 'Resume' : 'Play';
    find('#sound').textContent = $.mute ? 'Sound off' : 'Sound on';
    find('#sound').setAttribute('aria-pressed', String(!$.mute));
    find('#best').textContent = `Best ${$.storage?.score || 0}`;
  }
  function pause() { if (!$.keys) return; $.blurcb(); saveBest(); Howler.mute(true); changed(); }
  function toggle() {
    if (document.querySelector('dialog[open]')) return;
    if ($.state === 'play') pause();
    else {
      if ($.state !== 'pause') $.reset();
      $.setState('play');
      Howler.mute($.mute);
    }
    changed();
  }
  async function confirmAction(message) {
    const dialog = find('#confirm-dialog');
    if (dialog.open) return false;
    find('#confirm-text').textContent = message;
    dialog.returnValue = 'cancel';
    dialog.showModal();
    return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {once: true}));
  }
  window.panelGame = {
    pause, changed, saveBest, get paused() { return $.state === 'pause'; },
    async confirmReset() {
      if (await confirmAction('Clear Radius Raid best scores and completed-run statistics?')) { $.clearStorage(); changed(); }
    },
    async confirmQuit() {
      if (await confirmAction('End this run and return to the menu? Your best score is kept.')) { saveBest(); $.setState('menu'); }
    }
  };
  find('#play').onclick = toggle;
  find('#sound').onclick = () => { $.mute = !$.mute; Howler.mute($.mute); changed(); };
  find('#credits').onclick = async () => {
    pause();
    find('#credits-dialog').showModal();
    try { find('#license').textContent = (await Promise.all(['LICENSE.txt', 'Howler-LICENSE.txt'].map(async p => (await fetch(p)).text()))).join('\n\n'); }
    catch { find('#license').textContent = 'See the license files in this app package.'; }
  };
  const originalSetState = $.setState;
  $.setState = function (state) {
    originalSetState(state);
    if (state === 'play') Howler.mute($.mute);
    else if (state === 'pause') { saveBest(); Howler.mute(true); changed(); }
  };
  window.addEventListener('blur', pause);
  window.addEventListener('pagehide', saveBest);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('load', () => {
    new ResizeObserver($.resizecb).observe(find('#stage'));
    find('#play').disabled = false;
    changed();
  });
})();
