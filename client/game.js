'use strict';

const socket = io();

let countdownInterval = null;

// ─── Screen helpers ───────────────────────────────────────────────────────────

function showOnly(id) {
  const screens = [
    'screen-lobby', 'screen-waiting', 'screen-phase1',
    'screen-phase2', 'screen-round-result', 'screen-gameover',
  ];
  for (const s of screens) {
    document.getElementById(s).hidden = s !== id;
  }
}

function stopCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
}

function startCountdown(spanId, seconds) {
  stopCountdown();
  const el = document.getElementById(spanId);
  el.textContent = seconds;
  countdownInterval = setInterval(() => {
    seconds--;
    el.textContent = seconds;
    if (seconds <= 0) stopCountdown();
  }, 1000);
}

// ─── Lobby ────────────────────────────────────────────────────────────────────

document.getElementById('btn-create').addEventListener('click', () => {
  document.getElementById('lobby-error').textContent = '';
  socket.emit('create_room');
});

document.getElementById('btn-join').addEventListener('click', () => {
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  document.getElementById('lobby-error').textContent = '';
  if (!code) return;
  socket.emit('join_room', { code });
});

socket.on('room_created', ({ code }) => {
  document.getElementById('room-code-display').textContent = code;
  showOnly('screen-waiting');
});

socket.on('room_error', ({ message }) => {
  document.getElementById('lobby-error').textContent = message;
  const inActiveGame = ['screen-phase1', 'screen-phase2', 'screen-round-result']
    .some(id => !document.getElementById(id).hidden);
  if (!inActiveGame) showOnly('screen-lobby');
});

socket.on('room_expired', () => {
  document.getElementById('lobby-error').textContent = 'Room expired. No one joined in time.';
  showOnly('screen-lobby');
});

// ─── Phase 1 ──────────────────────────────────────────────────────────────────

socket.on('phase1_start', () => {
  document.getElementById('phase1-status').textContent = 'Choose your move!';
  document.querySelectorAll('.rps-btn').forEach(btn => btn.disabled = false);
  startCountdown('phase1-timer', 5);
  showOnly('screen-phase1');
});

document.querySelectorAll('.rps-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    stopCountdown();
    document.querySelectorAll('.rps-btn').forEach(b => b.disabled = true);
    socket.emit('rps_choice', { choice: btn.dataset.choice });
    document.getElementById('phase1-status').textContent = `You chose ${btn.dataset.choice}. Waiting...`;
  });
});

socket.on('phase1_draw', ({ yourChoice, opponentChoice }) => {
  stopCountdown();
  document.getElementById('phase1-status').textContent =
    `Draw! You: ${yourChoice} — Them: ${opponentChoice}. Go again!`;
});

// RPS choices from the current round — shown on the phase 2 screen so both
// players can see the outcome, but without being told who should slap/dodge.
// Working that out from the choices is part of the game.
let phase1YourChoice = null;
let phase1OpponentChoice = null;

socket.on('phase1_result', ({ yourChoice, opponentChoice }) => {
  // Store choices for display during the slap phase.
  // The server deliberately does not send role (attacker/defender) — players
  // must deduce the correct action from the RPS outcome themselves.
  phase1YourChoice = yourChoice;
  phase1OpponentChoice = opponentChoice;
  document.getElementById('phase1-status').textContent =
    `You: ${yourChoice} — Them: ${opponentChoice}.`;
});

// ─── Phase 2 ──────────────────────────────────────────────────────────────────

socket.on('phase2_start', () => {
  const slapBtn  = document.getElementById('btn-slap');
  const dodgeBtn = document.getElementById('btn-dodge');

  // Show both RPS choices so players have the information to work out the
  // correct action — but the game intentionally does not tell them which
  // button to press. That's the skill.
  document.getElementById('phase2-rps-result').textContent =
    `You played ${phase1YourChoice} — They played ${phase1OpponentChoice}`;

  slapBtn.disabled  = false;
  dodgeBtn.disabled = false;

  const sendAction = (action) => {
    slapBtn.disabled  = true;
    dodgeBtn.disabled = true;
    socket.emit('phase2_action', { action, timestamp: Date.now() });
  };

  slapBtn.onclick  = () => sendAction('slap');
  dodgeBtn.onclick = () => sendAction('dodge');

  startCountdown('phase2-timer', 3);
  showOnly('screen-phase2');
});

socket.on('phase2_result', ({ yourAction, opponentAction, yourLives, opponentLives }) => {
  stopCountdown();

  document.getElementById('round-outcome').textContent =
    `You chose: ${yourAction ?? 'none'} — Opponent chose: ${opponentAction ?? 'none'}`;
  document.getElementById('round-lives').textContent =
    `Lives — You: ${yourLives}  Them: ${opponentLives}`;

  showOnly('screen-round-result');
});

// ─── Game Over ────────────────────────────────────────────────────────────────

socket.on('game_over', ({ result, yourLives, opponentLives }) => {
  stopCountdown();

  const resultText = { win: 'You win!', loss: 'You lose.', draw: 'Draw!' }[result] ?? result;
  document.getElementById('gameover-result').textContent = resultText;
  document.getElementById('gameover-lives').textContent =
    `Final lives — You: ${yourLives}  Them: ${opponentLives}`;

  showOnly('screen-gameover');
});

socket.on('opponent_disconnected', () => {
  stopCountdown();
  document.getElementById('gameover-result').textContent = 'Opponent disconnected.';
  document.getElementById('gameover-lives').textContent = '';
  showOnly('screen-gameover');
});

document.getElementById('btn-again').addEventListener('click', () => {
  document.getElementById('lobby-error').textContent = '';
  document.getElementById('input-code').value = '';
  showOnly('screen-lobby');
});
