/* Tessera panel adapter for Jake Gordon's MIT-licensed Tetris. */
(async () => {
  const info = window.Tessera ? await Tessera.ready : { instanceId: 'standalone' };
  const stateKey = 'tessera-tetris:board:' + info.instanceId, bestKey = 'tessera-tetris:best';
  const types = { i, j, l, o, s, t, z };
  Object.entries({ i:'#67d4e8',j:'#769bfd',l:'#f3ac6b',o:'#f5d985',s:'#9ce6c4',t:'#c8a4ee',z:'#ee8b9b' }).forEach(([name,color]) => types[name].color = color);
  let paused = true, animation = 0, last = 0, saveTimer = 0, best = 0;
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { document.querySelector('.hint').textContent = 'Storage unavailable. Keep this panel open to retain progress.'; } };
  const typeName = type => Object.keys(types).find(name => types[name] === type);
  const packPiece = p => ({ type: typeName(p.type), x:p.x, y:p.y, dir:p.dir });
  const unpackPiece = p => p && types[p.type] && Number.isInteger(p.x) && p.x >= -3 && p.x < nx && Number.isInteger(p.y) && p.y >= 0 && p.y < ny && Number.isInteger(p.dir) && p.dir >= 0 && p.dir <= 3 ? { ...p, type:types[p.type] } : null;
  function save() {
    clearTimeout(saveTimer);
    best = Math.max(best, score || 0); write(bestKey,best); get('best').textContent = best;
    write(stateKey, {version:1,playing:!!playing,score,rows,blocks:Array.from({length:nx},(_,x) => Array.from({length:ny},(_,y) => typeName(getBlock(x,y)) || null)),current:packPiece(current),next:packPiece(next),pieces:pieces.map(typeName)});
  }
  function changed() { clearTimeout(saveTimer); saveTimer = setTimeout(save,150); }
  const originalInvalidate = invalidate;
  invalidate = function () { originalInvalidate(); changed(); };
  function renderState() {
    get('play').textContent = !playing ? 'Start' : paused ? 'Resume' : 'Pause';
    get('overlay').hidden = playing && !paused;
    get('status').textContent = playing ? 'Paused' : score ? 'Nice run' : 'Ready when you are';
    get('subtitle').textContent = playing ? 'Resume whenever you like' : 'Press Start or Space';
  }
  function frame(time) {
    animation = 0;
    if (paused || !playing) return;
    update(Math.min(.05, (time - last) / 1000)); last = time; draw();
    if (playing && !paused) animation = requestAnimationFrame(frame);
  }
  function pause() {
    paused = true; clearActions(); cancelAnimationFrame(animation); animation = 0;
    setVisualScore(); renderState(); save(); draw();
  }
  function resume() {
    if (!playing) { reset(); playing = true; }
    paused = false; last = performance.now(); renderState();
    if (!animation) animation = requestAnimationFrame(frame);
    save();
  }
  function toggle() { playing && !paused ? pause() : resume(); }
  play = resume;
  lose = function () { playing = false; setVisualScore(); pause(); };
  // Keep a stable logical board when a Tessera split or window changes size.
  function fit() {
    const w = Math.max(70, Math.min(300,(innerWidth - 52) / 1.5,(innerHeight - 250) / 2));
    document.documentElement.style.setProperty('--board', w + 'px');
    canvas.width = 300; canvas.height = 600; ucanvas.width = 150; ucanvas.height = 150; dx = dy = 30;
    invalidate(); invalidateNext(); draw();
  }
  function action(name) {
    if (!playing || paused) return;
    if (name === 'drop') { while (move(DIR.DOWN)) {} drop(); }
    else handle({left:DIR.LEFT,right:DIR.RIGHT,rotate:DIR.UP,down:DIR.DOWN}[name]);
    draw(); changed();
  }
  document.addEventListener('keydown', ev => {
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.target.closest('summary,details[open]')) return;
    if (['Space','KeyP','Escape'].includes(ev.code)) { ev.preventDefault(); if (!ev.repeat) ev.code === 'Escape' ? pause() : toggle(); return; }
    const name = {ArrowLeft:'left',KeyA:'left',ArrowRight:'right',KeyD:'right',ArrowUp:'rotate',KeyW:'rotate',ArrowDown:'down',KeyS:'down',Enter:'drop'}[ev.code];
    if (name && !(ev.code === 'Enter' && ev.target.closest('button'))) { ev.preventDefault(); action(name); }
  });
  get('play').addEventListener('click',toggle);
  get('new').addEventListener('click',() => { reset(); playing = true; resume(); });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click',() => action(button.dataset.action)));
  document.querySelector('details').addEventListener('toggle', ev => { if (ev.target.open) pause(); });
  window.addEventListener('blur',pause);
  document.addEventListener('visibilitychange',() => { if (document.hidden) pause(); });
  window.addEventListener('pagehide',save); window.addEventListener('resize',fit);
  best = Math.max(0,Number(read(bestKey)) || 0); get('best').textContent = best;
  const saved = read(stateKey);
  reset(); playing = false;
  if (saved?.version === 1 && typeof saved.playing === 'boolean' && Number.isFinite(saved.score) && saved.score >= 0 && Number.isInteger(saved.rows) && saved.rows >= 0 && Array.isArray(saved.blocks) && saved.blocks.length === nx && saved.blocks.every(col => Array.isArray(col) && col.length === ny && col.every(v => v === null || Object.hasOwn(types,v))) && unpackPiece(saved.current) && unpackPiece(saved.next)) {
    blocks = saved.blocks.map(col => col.map(v => types[v] || null)); setScore(saved.score); setRows(saved.rows); current = unpackPiece(saved.current); next = unpackPiece(saved.next); playing = saved.playing;
    pieces = Array.isArray(saved.pieces) ? saved.pieces.filter(v => Object.hasOwn(types,v)).slice(0,28).map(v => types[v]) : [];
    if (playing && occupied(current.type,current.x,current.y,current.dir)) { reset(); playing = false; }
  }
  renderState(); fit(); save();
  window.panelGame = { pause, resume, save, get paused() { return paused; } };
})().catch(error => { document.querySelector('#status').textContent = 'Could not open game'; document.querySelector('#subtitle').textContent = 'Reload the panel to retry'; console.error(error); });
