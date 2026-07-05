'use strict';

const socket = io();

const $ = (id) => document.getElementById(id);

const RPS_EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };
// slap → waving hand, dodge → raised hand slipping away, timeout → limp hand
const ACTION_EMOJI = { slap: '👋', dodge: '🤚', none: '✋' };
const HEART_FULL = '❤️';
const HEART_LOST = '🖤';

// ─── Client state ─────────────────────────────────────────────────────────────
// The server is authoritative for everything; this only tracks what we've been
// told, so the HUD and result screens can show deltas (e.g. which heart popped).

const state = {
  roomCode: null,
  matchActive: false,
  round: 0,
  startingLives: 3,          // overwritten by phase1_start payload
  lives: { you: null, them: null },
  yourChoice: null,          // this round's RPS choices, shown during phase 2
  theirChoice: null,
};

// ─── Sound (WebAudio, no assets) ──────────────────────────────────────────────

const Sound = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('slap_muted') === '1'; } catch { /* private mode */ }

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone({ freq = 440, endFreq = 0, type = 'sine', dur = 0.15, vol = 0.15, delay = 0 }) {
    const c = ac();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.12, vol = 0.25, freq = 1800, delay = 0 }) {
    const c = ac();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = freq;
    const gain = c.createGain();
    gain.gain.value = vol;
    src.connect(filt).connect(gain).connect(c.destination);
    src.start(t0);
  }

  return {
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('slap_muted', muted ? '1' : '0'); } catch { /* ignore */ }
      return muted;
    },
    unlock() { ac(); }, // must be called from a user gesture before autoplay works
    click: () => tone({ freq: 700, type: 'triangle', dur: 0.06, vol: 0.07 }),
    lock:  () => tone({ freq: 520, endFreq: 780, type: 'triangle', dur: 0.1, vol: 0.1 }),
    go:    () => { tone({ freq: 330, type: 'square', dur: 0.08, vol: 0.08 }); tone({ freq: 660, type: 'square', dur: 0.1, vol: 0.08, delay: 0.09 }); },
    slap:  () => { noise({ dur: 0.09, vol: 0.5, freq: 2400 }); tone({ freq: 160, endFreq: 60, dur: 0.18, vol: 0.35 }); },
    dodge: () => noise({ dur: 0.25, vol: 0.16, freq: 900 }),
    hurt:  (delay = 0) => tone({ freq: 300, endFreq: 120, type: 'sawtooth', dur: 0.3, vol: 0.11, delay }),
    draw:  () => tone({ freq: 440, type: 'triangle', dur: 0.12, vol: 0.1 }),
    win:   () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.18, vol: 0.11, delay: i * 0.12 })),
    lose:  () => [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.22, vol: 0.09, delay: i * 0.14 })),
  };
})();

// WebAudio contexts start suspended until a user gesture; unlock on the first one.
document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
document.addEventListener('keydown', () => Sound.unlock(), { once: true });

$('btn-mute').textContent = Sound.muted ? '🔇' : '🔊';
$('btn-mute').addEventListener('click', () => {
  $('btn-mute').textContent = Sound.toggle() ? '🔇' : '🔊';
});

// ─── Screen helpers ───────────────────────────────────────────────────────────

const SCREENS = [
  'screen-lobby', 'screen-waiting', 'screen-phase1',
  'screen-phase2', 'screen-round-result', 'screen-gameover',
];

function showScreen(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  $('hud').hidden = !state.matchActive;
}

function currentScreen() {
  return SCREENS.find(s => !$(s).hidden) || null;
}

function flashScreen() {
  const f = $('flash');
  f.classList.remove('on');
  void f.offsetWidth; // restart the animation
  f.classList.add('on');
}

function shakeScreen() {
  const app = $('app');
  app.classList.remove('shake');
  void app.offsetWidth;
  app.classList.add('shake');
}

// ─── Countdown timer (rAF, driven by a deadline — no setInterval drift) ──────

const timer = (() => {
  let raf = null;

  function start(barId, textId, durationMs) {
    stop();
    const bar = $(barId);
    const text = $(textId);
    const t0 = performance.now();

    function frame(now) {
      const left = Math.max(0, durationMs - (now - t0));
      bar.style.transform = `scaleX(${left / durationMs})`;
      bar.classList.toggle('low', left < durationMs * 0.34);
      text.textContent = `${(left / 1000).toFixed(1)}s`;
      if (left > 0) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  return { start, stop };
})();

// ─── Lives HUD ────────────────────────────────────────────────────────────────

function renderHearts(el, lives, justLost) {
  el.innerHTML = '';
  for (let i = 0; i < state.startingLives; i++) {
    const s = document.createElement('span');
    const full = i < lives;
    s.className = 'heart' + (full ? '' : ' lost');
    // The heart that just went dark gets a pop animation.
    if (justLost && i === lives) s.classList.add('just-lost');
    s.textContent = full ? HEART_FULL : HEART_LOST;
    el.appendChild(s);
  }
}

function updateHud({ youJustLost = false, themJustLost = false } = {}) {
  renderHearts($('hud-hearts-you'), state.lives.you ?? state.startingLives, youJustLost);
  renderHearts($('hud-hearts-them'), state.lives.them ?? state.startingLives, themJustLost);
  for (const [sideId, lost] of [['hud-side-you', youJustLost], ['hud-side-them', themJustLost]]) {
    const el = $(sideId);
    el.classList.remove('lost-life');
    if (lost) {
      void el.offsetWidth;
      el.classList.add('lost-life');
    }
  }
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* unsupported */ }
  ta.remove();
  return ok;
}

function copyText(text) {
  // navigator.clipboard needs a secure context — LAN play over http://192.x
  // doesn't have one, so fall back to the old execCommand path there.
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}

let feedbackTimeout = null;
function showCopyFeedback(msg) {
  $('copy-feedback').textContent = msg;
  clearTimeout(feedbackTimeout);
  feedbackTimeout = setTimeout(() => { $('copy-feedback').innerHTML = '&nbsp;'; }, 2500);
}

function inviteLink(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

$('btn-create').addEventListener('click', () => {
  Sound.click();
  $('lobby-error').textContent = '';
  socket.emit('create_room');
});

function tryJoin() {
  const code = $('input-code').value.trim().toUpperCase();
  $('lobby-error').textContent = '';
  if (!code) return;
  Sound.click();
  // Joiners never receive room_created, so remember the code for the HUD now.
  state.roomCode = code;
  socket.emit('join_room', { code });
}

$('btn-join').addEventListener('click', tryJoin);

$('input-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
});

$('input-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') tryJoin();
});

socket.on('room_created', ({ code }) => {
  state.roomCode = code;
  $('hud-room-code').textContent = code;

  const tiles = $('code-tiles');
  tiles.innerHTML = '';
  for (const letter of code) {
    const t = document.createElement('span');
    t.className = 'tile';
    t.textContent = letter;
    tiles.appendChild(t);
  }

  $('invite-link').value = inviteLink(code);
  showScreen('screen-waiting');
});

$('btn-copy-code').addEventListener('click', async () => {
  Sound.click();
  const ok = await copyText(state.roomCode ?? '');
  showCopyFeedback(ok ? 'Code copied! ✔' : 'Copy failed — select it manually.');
});

$('btn-copy-link').addEventListener('click', async () => {
  Sound.click();
  const ok = await copyText($('invite-link').value);
  showCopyFeedback(ok ? 'Link copied! ✔' : 'Copy failed — select it manually.');
});

$('invite-link').addEventListener('click', (e) => e.target.select());

socket.on('room_error', ({ message }) => {
  $('lobby-error').textContent = message;
  const inActiveGame = ['screen-phase1', 'screen-phase2', 'screen-round-result']
    .some(id => !$(id).hidden);
  if (!inActiveGame) showScreen('screen-lobby');
});

socket.on('room_expired', () => {
  state.roomCode = null;
  $('lobby-error').textContent = 'Room expired. No one joined in time.';
  showScreen('screen-lobby');
});

// ─── Phase 1: throw ───────────────────────────────────────────────────────────

const rpsButtons = [...document.querySelectorAll('.btn-rps')];

socket.on('phase1_start', ({ duration, newRound, startingLives }) => {
  // First phase1_start of a match — initialise the HUD.
  if (!state.matchActive) {
    state.matchActive = true;
    state.round = 0;
    state.startingLives = startingLives ?? 3;
    state.lives = { you: state.startingLives, them: state.startingLives };
    state.roomCode = state.roomCode ?? '';
    $('hud-room-code').textContent = state.roomCode;
    updateHud();
  }
  if (newRound) state.round++;

  $('round-number').textContent = state.round;
  $('phase1-status').innerHTML = '&nbsp;';
  for (const btn of rpsButtons) {
    btn.disabled = false;
    btn.classList.remove('selected');
  }

  Sound.go();
  timer.start('phase1-bar', 'phase1-timer-text', duration);
  showScreen('screen-phase1');
});

function chooseRps(btn) {
  timer.stop();
  Sound.lock();
  for (const b of rpsButtons) b.disabled = true;
  btn.classList.add('selected');
  socket.emit('rps_choice', { choice: btn.dataset.choice });
  $('phase1-status').textContent =
    `Locked in ${RPS_EMOJI[btn.dataset.choice]} — waiting for opponent…`;
}

for (const btn of rpsButtons) {
  btn.addEventListener('click', () => chooseRps(btn));
}

socket.on('phase1_draw', ({ yourChoice, opponentChoice }) => {
  timer.stop();
  Sound.draw();
  for (const b of rpsButtons) b.disabled = true;
  $('phase1-status').textContent =
    `DRAW! ${RPS_EMOJI[yourChoice]} vs ${RPS_EMOJI[opponentChoice]} — go again!`;
});

socket.on('phase1_result', ({ yourChoice, opponentChoice }) => {
  // The server deliberately does not send roles (attacker/defender) — deducing
  // the right phase-2 action from these two choices is the core skill.
  state.yourChoice = yourChoice;
  state.theirChoice = opponentChoice;
});

// ─── Phase 2: slap ────────────────────────────────────────────────────────────

const slapBtn = $('btn-slap');
const dodgeBtn = $('btn-dodge');

socket.on('phase2_start', ({ duration }) => {
  $('reveal-line').innerHTML =
    `You <strong>${RPS_EMOJI[state.yourChoice] ?? '?'}</strong> vs ` +
    `<strong>${RPS_EMOJI[state.theirChoice] ?? '?'}</strong> Them`;
  $('phase2-status').innerHTML = '&nbsp;';
  slapBtn.disabled = false;
  dodgeBtn.disabled = false;

  Sound.go();
  timer.start('phase2-bar', 'phase2-timer-text', duration);
  showScreen('screen-phase2');
});

function sendAction(action) {
  slapBtn.disabled = true;
  dodgeBtn.disabled = true;
  Sound.lock();
  socket.emit('phase2_action', { action, timestamp: Date.now() });
  $('phase2-status').textContent = action === 'slap' ? 'SLAP thrown! 👋' : 'Dodging! 💨';
}

slapBtn.addEventListener('click', () => sendAction('slap'));
dodgeBtn.addEventListener('click', () => sendAction('dodge'));

// ─── Round result ─────────────────────────────────────────────────────────────

function playFighter(handElId, fighterElId, action, gotHit) {
  const hand = $(handElId);
  const fighter = $(fighterElId);
  hand.className = 'hand-emoji';
  fighter.classList.remove('hit');
  void hand.offsetWidth; // restart animations from a clean state

  hand.textContent = ACTION_EMOJI[action ?? 'none'];
  if (action === 'slap') hand.classList.add('anim-slap');
  else if (action === 'dodge') hand.classList.add('anim-dodge');
  else hand.classList.add('anim-flinch');

  if (gotHit) fighter.classList.add('hit');
}

/** Personalised headline + detail for a resolved round. */
function describeRound({ outcome, yourAction, youLost, themLost }) {
  switch (outcome) {
    case 'fast_slap':
      return yourAction === 'slap'
        ? { headline: 'SLAP LANDED! 💥', tone: 'good', detail: 'They dodged too late — they lose a heart.' }
        : { headline: 'YOU GOT SLAPPED! 💥', tone: 'bad', detail: 'You dodged too late — you lose a heart.' };
    case 'successful_dodge':
      return yourAction === 'dodge'
        ? { headline: 'CLEAN DODGE! 💨', tone: 'neutral', detail: 'You slipped away just in time. No hearts lost.' }
        : { headline: 'SWING AND A MISS! 💨', tone: 'neutral', detail: 'They dodged before your slap landed. No hearts lost.' };
    case 'double_illegal':
      return { headline: 'DOUBLE FAULT! ⚠️', tone: 'bad', detail: 'You both blew it — a heart each.' };
    case 'attacker_illegal':
    case 'defender_illegal': {
      if (youLost) {
        const why = yourAction === null
          ? 'You froze!'
          : `You had to ${yourAction === 'slap' ? 'DODGE' : 'SLAP'}!`;
        return { headline: 'ILLEGAL MOVE! ⚠️', tone: 'bad', detail: `${why} You lose a heart.` };
      }
      return {
        headline: 'OPPONENT FAULT! ⚠️', tone: 'good',
        detail: themLost ? 'They picked wrong (or froze) — they lose a heart.' : '',
      };
    }
    default:
      return { headline: outcome, tone: 'neutral', detail: '' };
  }
}

socket.on('phase2_result', ({ outcome, yourAction, opponentAction, yourLives, opponentLives }) => {
  timer.stop();

  const youLost = yourLives < (state.lives.you ?? state.startingLives);
  const themLost = opponentLives < (state.lives.them ?? state.startingLives);
  state.lives = { you: yourLives, them: opponentLives };
  updateHud({ youJustLost: youLost, themJustLost: themLost });

  playFighter('hand-you', 'fighter-you', yourAction, youLost);
  playFighter('hand-them', 'fighter-them', opponentAction, themLost);
  $('hit-you').hidden = !youLost;
  $('hit-them').hidden = !themLost;

  const { headline, tone, detail } = describeRound({ outcome, yourAction, youLost, themLost });
  const headlineEl = $('round-headline');
  headlineEl.textContent = headline;
  headlineEl.className = `headline ${tone}`;
  $('round-detail').textContent = detail;

  if (outcome === 'fast_slap') { Sound.slap(); Sound.hurt(0.2); }
  else if (outcome === 'successful_dodge') Sound.dodge();
  else Sound.hurt();

  if (youLost) flashScreen();
  if (youLost || themLost) shakeScreen();

  showScreen('screen-round-result');
});

// ─── Game over ────────────────────────────────────────────────────────────────

function gameOverDetail(outcome, result) {
  const youDied = result === 'loss';
  switch (outcome) {
    case 'fast_slap':
      return youDied
        ? 'Their slap landed before you could dodge.'
        : 'Your slap landed before they could dodge.';
    case 'attacker_illegal':
    case 'defender_illegal':
      return youDied
        ? 'An illegal move cost you your last heart.'
        : 'Their illegal move cost them their last heart.';
    case 'double_illegal':
      if (result === 'draw') return 'A double fault took you both down. 🤝';
      return youDied
        ? 'You both fouled — you just had fewer hearts to spare.'
        : 'You both fouled — they ran out of hearts first.';
    default:
      return '';
  }
}

function showGameOver({ titleText, titleClass, detail, livesLine, sound }) {
  timer.stop();
  state.matchActive = false;
  state.roomCode = null;
  $('gameover-result').textContent = titleText;
  $('gameover-result').className = `gameover-title ${titleClass}`;
  $('gameover-detail').textContent = detail;
  $('gameover-lives').textContent = livesLine;
  if (sound) sound();
  showScreen('screen-gameover');
}

socket.on('game_over', ({ result, outcome, yourLives, opponentLives }) => {
  state.lives = { you: yourLives, them: opponentLives };
  const titles = {
    win: { text: 'YOU WIN! 🏆', cls: 'win', sound: Sound.win },
    loss: { text: 'YOU LOSE 💀', cls: 'loss', sound: Sound.lose },
    draw: { text: 'MUTUAL DESTRUCTION 🤝', cls: 'draw', sound: Sound.draw },
  };
  const t = titles[result] ?? { text: result, cls: 'draw', sound: null };
  showGameOver({
    titleText: t.text,
    titleClass: t.cls,
    detail: gameOverDetail(outcome, result),
    livesLine: `Final hearts — You: ${yourLives}  Them: ${opponentLives}`,
    sound: t.sound,
  });
});

socket.on('opponent_disconnected', () => {
  showGameOver({
    titleText: 'YOU WIN! 🏳️',
    titleClass: 'win',
    detail: 'Your opponent disconnected — victory by forfeit.',
    livesLine: '',
    sound: Sound.win,
  });
});

socket.on('disconnect', () => {
  if (state.matchActive) {
    showGameOver({
      titleText: 'CONNECTION LOST',
      titleClass: 'draw',
      detail: 'Lost connection to the server.',
      livesLine: '',
      sound: null,
    });
  } else if (currentScreen() === 'screen-waiting') {
    state.roomCode = null;
    $('lobby-error').textContent = 'Lost connection to the server.';
    showScreen('screen-lobby');
  }
});

socket.on('connect_error', () => {
  if (currentScreen() === 'screen-lobby') {
    $('lobby-error').textContent = 'Cannot reach the server. Is it running?';
  }
});

$('btn-again').addEventListener('click', () => {
  Sound.click();
  $('lobby-error').textContent = '';
  $('input-code').value = '';
  showScreen('screen-lobby');
});

// ─── Keyboard controls ────────────────────────────────────────────────────────
// Phase 1: ← rock, ↑ paper, → scissors.  Phase 2: ← slap, → dodge.

document.addEventListener('keydown', (e) => {
  if (e.repeat || e.target.tagName === 'INPUT') return;

  if (!$('screen-phase1').hidden) {
    const keyToChoice = { ArrowLeft: 'rock', ArrowUp: 'paper', ArrowRight: 'scissors' };
    const choice = keyToChoice[e.key];
    if (!choice) return;
    e.preventDefault();
    const btn = rpsButtons.find(b => b.dataset.choice === choice);
    if (btn && !btn.disabled) btn.click();
  } else if (!$('screen-phase2').hidden) {
    if (e.key === 'ArrowLeft' && !slapBtn.disabled) { e.preventDefault(); slapBtn.click(); }
    if (e.key === 'ArrowRight' && !dodgeBtn.disabled) { e.preventDefault(); dodgeBtn.click(); }
  }
});

// ─── Invite links: ?room=CODE auto-joins ──────────────────────────────────────

{
  const roomParam = (new URLSearchParams(location.search).get('room') || '')
    .trim().toUpperCase();
  if (/^[A-Z]{4}$/.test(roomParam)) {
    $('input-code').value = roomParam;
    state.roomCode = roomParam;
    socket.emit('join_room', { code: roomParam });
    // Rooms are one-shot; drop the query so a refresh doesn't rejoin a dead room.
    history.replaceState(null, '', location.pathname);
  }
}
