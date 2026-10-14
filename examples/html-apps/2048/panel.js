/* Tessera adaptation. Original game by Gabriele Cirulli; MIT, see LICENSE.txt. */
(async () => {
  const info = window.Tessera ? await Tessera.ready : { instanceId: 'standalone' };
  function PanelStorage() {
    LocalStorageManager.call(this);
    this.bestScoreKey = 'tessera-2048:best';
    this.gameStateKey = 'tessera-2048:board:' + info.instanceId;
    if (this.storage === window.fakeStorage) document.querySelector('#status').textContent = 'Storage unavailable. This board will last until the panel closes.';
  }
  PanelStorage.prototype = Object.create(LocalStorageManager.prototype);
  PanelStorage.prototype.getGameState = function () {
    try {
      const s = JSON.parse(this.storage.getItem(this.gameStateKey));
      if (!s || s.grid?.size !== 4 || !Number.isFinite(s.score) || !Array.isArray(s.grid.cells) || s.grid.cells.length !== 4) return null;
      if (!s.grid.cells.every((col, x) => Array.isArray(col) && col.length === 4 && col.every((tile, y) => tile === null || (tile.position?.x === x && tile.position?.y === y && Number.isInteger(tile.value) && tile.value >= 2 && tile.value <= 131072 && Math.log2(tile.value) % 1 === 0)))) return null;
      return s;
    } catch { return null; }
  };
  // Save immediately when continuing after the winning tile, too.
  GameManager.prototype.keepPlaying = function () { this.keepPlaying = true; this.actuator.continueGame(); this.actuate(); };
  const game = window.game = new GameManager(4, KeyboardInputManager, HTMLActuator, PanelStorage);
  document.querySelectorAll('[data-move]').forEach(button => button.addEventListener('click', () => game.move(Number(button.dataset.move))));
  function fit() {
    const board = document.querySelector('.game-container');
    const base = matchMedia('(max-width: 520px)').matches ? 280 : 500;
    const width = document.querySelector('.container').clientWidth;
    const height = Math.max(120, innerHeight - 218);
    board.style.zoom = Math.min(1, width / base, height / base);
  }
  window.addEventListener('resize', fit);
  fit();
})().catch(error => { document.querySelector('#status').textContent = 'Could not open the saved game. Reload this panel to retry.'; console.error(error); });
