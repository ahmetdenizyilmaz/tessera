// Tessera adaptation, 2026-10-14. GPL-3.0; see LICENSE.txt.
(() => {
  const dialog = document.querySelector('#credits-dialog');
  function saveBest() {
    if (!isCasualGame() && state.game.score > getHighScore()) {
      try { localStorage.setItem(highScoreKey, String(state.game.score)); } catch {}
    }
  }
  function pause() { handleCanvasPointerUp(); pauseGame(); saveBest(); }
  window.addEventListener('blur', pause);
  window.addEventListener('pagehide', saveBest);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  document.querySelector('#credits').addEventListener('click', async () => {
    pause();
    dialog.showModal();
    try { document.querySelector('#license').textContent = await (await fetch('LICENSE.txt')).text(); }
    catch { document.querySelector('#license').textContent = 'See LICENSE.txt in the app package.'; }
  });
  document.querySelector('.pause-btn').addEventListener('click', pause);
  window.panelGame = { pause, saveBest, get paused() { return isPaused(); }, get score() { return state.game.score; }, get best() { return getHighScore(); } };
})();
