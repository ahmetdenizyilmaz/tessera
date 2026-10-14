/* Tessera adapter for Jake Gordon's MIT-licensed Breakout. No external assets. */
(async () => {
  const info = window.Tessera ? await Tessera.ready : { instanceId:'standalone' };
  const prefix = 'tessera-breakout:', stateKey = prefix + 'board:' + info.instanceId;
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const write = (key,value) => { try { localStorage.setItem(key,JSON.stringify(value)); } catch { document.querySelector('.hint').textContent = 'Storage unavailable. Keep this panel open to retain progress.'; } };
  let paused = true, animation = 0, last = 0, lastSave = 0, game, audio;
  const saved = read(stateKey);
  const storage = new Proxy({}, {
    get: (_,key) => read(prefix + (key === 'level' ? 'level:' + info.instanceId : key)),
    set: (_,key,value) => { write(prefix + (key === 'level' ? 'level:' + info.instanceId : key),value); return true; }
  });
  function fit() { document.documentElement.style.setProperty('--court', Math.max(120, Math.min(600,innerWidth - 32,(innerHeight - 220) * 600 / 560)) + 'px'); }
  Game.Runner.storage = () => storage;
  // CSS scales a fixed court. Resizing must never reset the ball or paddle.
  Game.Runner.resize = function () { this.bounds = this.canvas.getBoundingClientRect(); };
  Game.Runner.onresize = function () { fit(); this.bounds = this.canvas.getBoundingClientRect(); };
  Game.Runner.addEvents = function () { window.addEventListener('resize',this.onresize.bind(this)); };
  Game.Runner.start = function () {};
  Game.Runner.stop = function () { pause(); };
  Breakout.addEvents = function () {};
  Breakout.onbeforeabandon = () => true;
  Breakout.refreshDOM = function () {
    document.querySelector('#level').textContent = this.level + 1;
    document.querySelector('#prev').disabled = !this.canPrevLevel();
    document.querySelector('#next').disabled = !this.canNextLevel();
    document.querySelector('#sound').checked = this.sound;
  };
  // A launch stays still until the player resumes; no hidden countdown timers.
  Breakout.Ball.launch = function () { this.clearLaunch(); this.launchNow(); };
  Breakout.Score.load = function () { this.highscore = Math.max(0,Number(this.game.storage.highscore) || 0); };
  Breakout.playSound = function (name) {
    if (!this.sound || !audio || paused || audio.state !== 'running') return;
    const tone = audio.createOscillator(), gain = audio.createGain();
    tone.frequency.value = {brick:540,paddle:330,go:660,levelup:880,loselife:150,gameover:110}[name] || 440;
    gain.gain.setValueAtTime(.035,audio.currentTime); gain.gain.exponentialRampToValueAtTime(.0001,audio.currentTime + .09);
    tone.connect(gain); gain.connect(audio.destination); tone.start(); tone.stop(audio.currentTime + .1);
  };
  function renderState() {
    const active = game.is('game');
    document.querySelector('#play').textContent = !active ? 'Start' : paused ? 'Resume' : 'Pause';
    document.querySelector('#overlay').hidden = active && !paused;
    document.querySelector('#status').textContent = active ? 'Paused' : 'Ready when you are';
    document.querySelector('#subtitle').textContent = active ? 'Resume whenever you like' : 'Press Start or Space';
    game.refreshDOM();
  }
  function save() {
    if (!game) return;
    game.score.save();
    write(stateKey, {version:1,active:game.is('game'),level:game.level,score:game.score.score,lives:game.score.lives,hits:game.court.bricks.map((brick,index) => brick.hit ? index : -1).filter(index => index >= 0),paddle:game.paddle.x,ball:{x:game.ball.x,y:game.ball.y,dx:game.ball.dx,dy:game.ball.dy,speed:game.ball.speed}});
  }
  function pause() {
    if (!game) return;
    paused = true; cancelAnimationFrame(animation); animation = 0; game.ball.clearLaunch(); game.paddle.setdir(0);
    game.score.vscore = game.score.score; game.score.rerender = true;
    save(); renderState(); game.runner.draw();
  }
  function frame(time) {
    animation = 0;
    if (paused) return;
    game.update(Math.min(.035,(time - last) / 1000)); last = time;
    if (!game.is('game')) { pause(); return; }
    game.runner.draw();
    if (time - lastSave > 1000) { save(); lastSave = time; }
    animation = requestAnimationFrame(frame);
  }
  function resume() {
    if (!game.is('game')) game.play();
    paused = false; game.ball.launchNow(); last = performance.now(); renderState();
    if (game.sound) { audio ??= new AudioContext(); audio.resume().catch(() => {}); }
    if (!animation) animation = requestAnimationFrame(frame);
    save();
  }
  function toggle() { game.is('game') && !paused ? pause() : resume(); }
  fit();
  // Ignore corrupt old settings instead of passing an invalid level into court.reset.
  const level = Number(storage.level); if (!Number.isInteger(level) || level < 0 || level >= Breakout.Levels.length) storage.level = 0;
  game = window.game = Game.start('canvas',Breakout,{width:600,height:560,color:{...Breakout.Defaults.color,background:'#0b1018',foreground:'#b5c7d9',border:'#182433',wall:'#344659',ball:'#f5ebda',score:'#ffd2a7',highscore:'#9ce6c4'}});
  if (!game) throw Error('Could not initialize Breakout');
  if (saved?.version === 1 && saved.active === true && Number.isInteger(saved.level) && saved.level >= 0 && saved.level < Breakout.Levels.length && Number.isFinite(saved.score) && saved.score >= 0 && Number.isInteger(saved.lives) && saved.lives > 0 && saved.lives <= 5 && Array.isArray(saved.hits) && saved.hits.length < 1000 && saved.hits.every(Number.isInteger) && Number.isFinite(saved.paddle) && saved.ball && ['x','y','dx','dy','speed'].every(k => Number.isFinite(saved.ball[k]))) {
    game.setLevel(saved.level); game.play();
    saved.hits.forEach(index => { const brick = game.court.bricks[index]; if (brick && !brick.hit) game.court.remove(brick); });
    game.score.set(saved.score); game.score.setLives(saved.lives); game.paddle.place(saved.paddle); game.ball.reset();
    game.ball.setpos(Math.max(0,Math.min(600,saved.ball.x)),Math.max(0,Math.min(560,saved.ball.y)));
    game.ball.setdir(saved.ball.dx,saved.ball.dy); game.ball.speed = Math.max(100,Math.min(game.ball.maxspeed,saved.ball.speed));
    if (game.court.empty()) game.winLevel();
  }
  document.querySelector('#play').addEventListener('click',toggle);
  document.querySelector('#new').addEventListener('click',() => { pause(); if (game.is('game')) game.abandon(); game.resetLevel(); resume(); });
  for (const [id,method] of [['prev','prevLevel'],['next','nextLevel']]) document.querySelector('#'+id).addEventListener('click',() => { game[method](false); game.paddle.reset(); game.ball.reset(); game.runner.draw(); save(); });
  document.querySelector('#sound').addEventListener('change',ev => { game.sound = ev.target.checked; storage.sound = String(game.sound); if (game.sound) { audio ??= new AudioContext(); audio.resume().catch(() => {}); } });
  document.addEventListener('keydown',ev => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.target.closest('details[open],summary,input')) return;
    if (['Space','KeyP','Escape'].includes(ev.code)) { ev.preventDefault(); if (!ev.repeat) ev.code === 'Escape' ? pause() : toggle(); return; }
    if (paused) return;
    if (['ArrowLeft','KeyA'].includes(ev.code)) { ev.preventDefault(); game.paddle.moveLeft(); }
    if (['ArrowRight','KeyD'].includes(ev.code)) { ev.preventDefault(); game.paddle.moveRight(); }
  });
  document.addEventListener('keyup',ev => {
    if (['ArrowLeft','KeyA'].includes(ev.code)) game.paddle.stopMovingLeft();
    if (['ArrowRight','KeyD'].includes(ev.code)) game.paddle.stopMovingRight();
  });
  const canvas = document.querySelector('#canvas');
  canvas.addEventListener('pointermove',ev => {
    if (paused) return;
    const bounds = canvas.getBoundingClientRect();
    game.paddle.place((ev.clientX - bounds.left) * 600 / bounds.width - game.paddle.w / 2);
  });
  canvas.addEventListener('pointerdown',ev => { if (paused) resume(); canvas.setPointerCapture(ev.pointerId); });
  window.addEventListener('blur',pause);
  document.addEventListener('visibilitychange',() => { if (document.hidden) pause(); });
  document.querySelector('details').addEventListener('toggle',ev => { if (ev.target.open) pause(); });
  window.addEventListener('pagehide',save);
  renderState(); game.runner.draw(); save();
  window.panelGame = {pause,resume,save,get paused(){return paused;}};
})().catch(error => { document.querySelector('#status').textContent = 'Could not open game'; document.querySelector('#subtitle').textContent = 'Reload the panel to retry'; console.error(error); });
