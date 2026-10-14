// Adapted for Tessera on 2026-10-14; see UPSTREAM.json.
import {installPanel} from './panel.js'
import {onPress, upKey} from './src/keys.js'
import levels from './src/levels.js'
import sleep from './src/sleep.js'
import Body from './src/body.js'
import Goal from './src/goal.js'
import Guy from './src/guy.js'
import Bar from './src/bar.js'
import {GOAL_FX, JUMP_FX, DEATH_FX, ON_FX, OFF_FX, playWin, playMusic} from './src/sound.js'
import create from './src/create.js'
import {WIDTH, HEIGHT} from './src/dimensions.js'
import Counter from './src/counter.js'
import Spikes from './src/spikes.js'

class Scene extends Body {
  constructor (game, levels) {
    super(document.getElementById('game'))
    this.deaths = new Counter(document.getElementById('death-counter'))
    this.stars = new Counter(document.getElementById('level-counter'))
    this.congrats = new Body(document.getElementById('congrats'))
    this.esc = new Body(document.getElementById('esc'))
    this.game = game
    this.levels = levels
    this.bars = []
    this.spikes = []
    this.paused = false
    this.guy = new Guy
    this.append(this.guy)
    this.goal = new Goal
    this.append(this.goal)
    this.index = 0
  }

  get fromURL () {
    return !!this._fromURL
  }

  set fromURL (value) {
    this._fromURL = !!value
    this.esc.hidden = !this.fromURL
  }

  get on () {
    return this._on
  }

  set on (value) {
    this._on = value
    document.body.classList.toggle('on', value)
    document.body.classList.toggle('off', !value)
  }

  get index () {
    return this._index
  }

  set index (value) {
    this._index = Math.min(this.levels.length, Math.max(0, Math.floor(value || 0)))
    queueMicrotask(() => this.game.changed?.())

    this.on = true
    this.stars.value = this.index
    while (this.bars.length) this.bars.pop().remove()
    while (this.spikes.length) this.spikes.pop().remove()

    if (this.finished) {
      this.guy.hidden = true
      this.congrats.hidden = false
      playWin()
      return
    }

    const [guy, goal, bars, spikes] = this.level
    this.guy.load(...guy)
    this.guy.hidden = false
    this.goal.load(...goal)
    this.goal.hidden = false
    this.congrats.hidden = true

    for (const values of bars) {
      const bar = new Bar(...values)
      this.append(bar)
      this.bars.push(bar)
    }

    for (const values of spikes) {
      const spike = new Spikes(...values)
      this.append(spike)
      this.spikes.push(spike)
    }
  }

  get level () {
    return this.levels[this.index]
  }

  get finished () {
    return this.index >= this.levels.length
  }

  async advance () {
    const transition = this.transition = (this.transition || 0) + 1
    GOAL_FX.play()
    this.paused = true
    document.body.classList.add('finish')
    await sleep(1000)
    if (transition !== this.transition) return
    this.index += 1
    document.body.classList.remove('finish')
    await sleep(1000)
    if (transition !== this.transition) return
    if (this.finished) {
      this.goal.hidden = true
    } else {
      this.paused = false
    }
  }

  async death () {
    const transition = this.transition = (this.transition || 0) + 1
    DEATH_FX.play()
    this.deaths.value += 1
    queueMicrotask(() => this.game.changed?.())
    this.paused = true
    const death = document.getElementById('death')
    death.setAttribute('x', this.guy.x - 32 + this.guy.width / 2)
    death.setAttribute('y', this.guy.y - 32 + this.guy.height / 2)
    this.guy.element.setAttribute('hidden', true)
    document.body.classList.add('dying')
    await sleep(700)
    if (transition !== this.transition) return
    document.body.classList.remove('dying')
    this.reset()
    this.guy.element.removeAttribute('hidden')
    this.paused = false
  }

  reset () {
    this.guy.load(...this.level[0])
  }

  lost () {
    return this.guy.bottom > HEIGHT || this.bars.some((bar) =>
      bar.on === this.on && bar.overlaps(this.guy)
    ) || this.spikes.some((spike) =>
      spike.on === this.on && spike.overlaps(this.guy)
    )
  }

  setBounds (body) {
    const {bounds} = body

    bounds.left = -body.left
    bounds.right = WIDTH - body.right
    bounds.top = -body.top
    bounds.bottom = HEIGHT - body.bottom + 1

    for (const bar of this.bars) {
      if (bar.on !== this.on) continue

      if (bar.top < body.bottom && bar.bottom > body.top) {
        if (bar.isRightOf(body)) {
          bounds.right = Math.min(bounds.right, bar.left - body.right)
        } else if (bar.isLeftOf(body)) {
          bounds.left = Math.max(bounds.left, bar.right - body.left)
        }
      }

      if (bar.left < body.right && bar.right > body.left) {
        if (bar.isBelow(body)) {
          bounds.bottom = Math.min(bounds.bottom, bar.top - body.bottom)
        } else if (bar.isAbove(body)) {
          bounds.top = Math.max(bounds.top, bar.bottom - body.top)
        }
      }
    }

    return bounds
  }

  tick (scale) {
    if (this.paused || this.hidden) return

    this.guy.tick(scale)

    const {left, right} = this.setBounds(this.guy)
    this.guy.x += Math.min(right, Math.max(left, this.guy.vx))

    const {top, bottom} = this.setBounds(this.guy)
    this.guy.y += Math.min(bottom, Math.max(top, this.guy.vy))

    if (bottom === 0) {
      this.guy.vy = upKey() ? -scale(1200) : 0
      if (upKey()) JUMP_FX.play()
    } else {
      this.guy.vy = Math.min(scale(600), this.guy.vy + scale(120))
    }

    if (this.lost()) {
      this.death()
    } else if (this.guy.overlaps(this.goal)) {
      this.advance()
    }
  }
}

class Game {
  constructor () {
    this.paused = true
    this.scene = new Scene(this, levels)
    onPress(1, () => this.toggle())
    document.addEventListener('keydown', (event) => {
      if (event.key === ' ' && !event.repeat && !document.querySelector('dialog[open]')) this.toggle()
    })
  }
  toggle () {
    if (this.paused || this.scene.paused || this.scene.finished) return
    this.scene.on = !this.scene.on
    if (this.scene.on) OFF_FX.play()
    else ON_FX.play()
  }
  tick (scale) { if (!this.paused) this.scene.tick(scale) }
}
const game = new Game
window.game = game
await installPanel(game, levels.length)
let previous = performance.now()
requestAnimationFrame(function tick (time) {
  const duration = Math.min(32, Math.max(0, time - previous))
  if (!document.hidden) game.tick((value) => Math.round(value * duration / 1000))
  previous = time
  requestAnimationFrame(tick)
})
