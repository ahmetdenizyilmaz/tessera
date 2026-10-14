// Tessera panel controls and persistence. MIT; see LICENSE.txt.
import {clearKeys} from './src/keys.js';
import {setAudio, playMusic} from './src/sound.js';

export async function installPanel(game, levelCount) {
  const $ = selector => document.querySelector(selector);
  const identity = window.Tessera ? await window.Tessera.ready : {instanceId: 'standalone'};
  const saveKey = `tessera-onoff-progress-v1:${identity.instanceId}`;
  let sound = false;
  let started = false;
  let save;
  try { save = JSON.parse(localStorage.getItem(saveKey)); } catch {}
  if (save && Number.isInteger(save.level) && save.level >= 0 && save.level <= levelCount) {
    game.scene.index = save.level;
    game.scene.deaths.value = Number.isSafeInteger(save.deaths) && save.deaths >= 0 ? save.deaths : 0;
  }
  function persist() {
    try { localStorage.setItem(saveKey, JSON.stringify({level: game.scene.index, deaths: game.scene.deaths.value || 0})); } catch {}
  }
  function update() {
    const finished = game.scene.finished;
    $('#progress').textContent = finished ? 'All levels complete!' : `Level ${game.scene.index + 1} / ${levelCount}`;
    $('#play').textContent = finished ? 'Play again' : game.paused ? (started ? 'Resume' : 'Play') : 'Pause';
    $('#resume').textContent = finished ? 'Play again' : `${started ? 'Resume' : 'Play'} level ${game.scene.index + 1}`;
    $('#pause-overlay').hidden = !game.paused;
    $('#pause-overlay h1').textContent = finished ? 'Both worlds, mastered.' : started ? 'Paused' : 'Two worlds. One way through.';
    $('#restart').disabled = finished;
    document.body.classList.toggle('panel-paused', game.paused);
    $('#sound').textContent = sound ? 'Sound on' : 'Sound off';
    $('#sound').setAttribute('aria-pressed', String(sound));
    void setAudio(sound && !game.paused && !document.hidden);
  }
  function pause() { game.paused = true; clearKeys(); persist(); update(); }
  function restart(level = game.scene.index) {
    game.scene.transition = (game.scene.transition || 0) + 1;
    document.body.classList.remove('finish', 'dying');
    game.scene.index = level;
    game.scene.paused = false;
    clearKeys();
  }
  function resume() {
    if ($('#credits-dialog').open) return;
    if (game.scene.finished) { game.scene.deaths.value = 0; restart(0); playMusic(); }
    started = true;
    clearKeys();
    game.paused = false;
    update();
  }
  game.changed = () => { persist(); update(); };
  $('#play').disabled = $('#resume').disabled = false;
  $('#play').onclick = () => game.paused || game.scene.finished ? resume() : pause();
  $('#resume').onclick = resume;
  $('#restart').onclick = () => { restart(); persist(); update(); };
  $('#sound').onclick = () => { sound = !sound; update(); };
  $('#credits').onclick = async () => {
    pause();
    $('#credits-dialog').showModal();
    try { $('#license').textContent = (await Promise.all(['LICENSE.txt', 'TinyMusic-LICENSE.txt'].map(async p => (await fetch(p)).text()))).join('\n\n'); }
    catch { $('#license').textContent = 'See LICENSE.txt and TinyMusic-LICENSE.txt in this app package.'; }
  };
  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape' || event.key.toLowerCase() === 'p') {
      event.preventDefault();
      game.paused ? resume() : pause();
    }
  });
  window.addEventListener('blur', pause);
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.panelGame = {pause, resume, get paused() { return game.paused; }, get level() { return game.scene.index; }, saveKey};
  update();
}
