'use strict';

const PHASE1_DURATION_MS = 5000;
const PHASE2_DURATION_MS = 3000;
const RPS_CHOICES = ['rock', 'paper', 'scissors'];

// What each choice beats
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = [];       // [{ socketId, lives }]
    this.state = 'waiting'; // waiting | phase1 | phase2 | resolving | finished
    this.expiryTimer = null;
    this.phaseTimer = null;
    this.phase1Choices = {}; // { socketId: 'rock'|'paper'|'scissors' }
    this.phase2Actions = {}; // { socketId: { action: 'slap'|'dodge', timestamp: number } }
    this.roles = {};         // { attacker: socketId, defender: socketId }
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  addPlayer(socket) {
    this.players.push({ socketId: socket.id, lives: 3 });
    socket.data.roomCode = this.code;
  }

  // ─── Phase 1: Rock, Paper, Scissors ──────────────────────────────────────

  startPhase1() {
    this.state = 'phase1';
    this.phase1Choices = {};
    this.io.to(this.code).emit('phase1_start');

    // If a player hasn't chosen after 5s, assign them a random choice so
    // the game never stalls.
    this.phaseTimer = setTimeout(() => {
      for (const player of this.players) {
        if (!this.phase1Choices[player.socketId]) {
          const random = RPS_CHOICES[Math.floor(Math.random() * RPS_CHOICES.length)];
          this.phase1Choices[player.socketId] = random;
        }
      }
      this.resolvePhase1();
    }, PHASE1_DURATION_MS);
  }

  receiveRpsChoice(socketId, choice) {
    if (!RPS_CHOICES.includes(choice)) return;
    if (this.phase1Choices[socketId]) return; // ignore duplicate submissions
    this.phase1Choices[socketId] = choice;

    if (Object.keys(this.phase1Choices).length === this.players.length) {
      clearTimeout(this.phaseTimer);
      this.resolvePhase1();
    }
  }

  resolvePhase1() {
    const [p1, p2] = this.players;
    const c1 = this.phase1Choices[p1.socketId];
    const c2 = this.phase1Choices[p2.socketId];

    let attacker, defender;

    if (BEATS[c1] === c2) {
      attacker = p1.socketId;
      defender = p2.socketId;
    } else if (BEATS[c2] === c1) {
      attacker = p2.socketId;
      defender = p1.socketId;
    } else {
      // Draw — tell each player what was chosen and repeat
      for (const player of this.players) {
        const opponent = this.players.find(p => p.socketId !== player.socketId);
        this.io.to(player.socketId).emit('phase1_draw', {
          yourChoice: this.phase1Choices[player.socketId],
          opponentChoice: this.phase1Choices[opponent.socketId],
        });
      }
      this.startPhase1();
      return;
    }

    this.roles = { attacker, defender };

    // Tell each player their role and what was chosen — then Phase 2 begins
    // immediately; the client must react to their role without delay.
    for (const player of this.players) {
      const opponent = this.players.find(p => p.socketId !== player.socketId);
      this.io.to(player.socketId).emit('phase1_result', {
        yourChoice: this.phase1Choices[player.socketId],
        opponentChoice: this.phase1Choices[opponent.socketId],
        yourRole: player.socketId === attacker ? 'attacker' : 'defender',
      });
    }

    this.startPhase2();
  }

  // ─── Phase 2: Slaps ───────────────────────────────────────────────────────

  startPhase2() {
    this.state = 'phase2';
    this.phase2Actions = {};
    this.io.to(this.code).emit('phase2_start');

    this.phaseTimer = setTimeout(() => this.resolvePhase2(), PHASE2_DURATION_MS);
  }

  receivePhase2Action(socketId, action, timestamp) {
    if (!['slap', 'dodge'].includes(action)) return;
    if (this.phase2Actions[socketId]) return; // ignore duplicate submissions
    this.phase2Actions[socketId] = { action, timestamp };

    if (Object.keys(this.phase2Actions).length === this.players.length) {
      clearTimeout(this.phaseTimer);
      this.resolvePhase2();
    }
  }

  resolvePhase2() {
    this.state = 'resolving';

    const { attacker, defender } = this.roles;
    const attackerAction = this.phase2Actions[attacker] || null;
    const defenderAction = this.phase2Actions[defender] || null;

    // A player is illegal if they timed out or chose the wrong action.
    const attackerIllegal = !attackerAction || attackerAction.action !== 'slap';
    const defenderIllegal = !defenderAction || defenderAction.action !== 'dodge';

    let attackerLosesLife = false;
    let defenderLosesLife = false;
    let outcome;

    if (attackerIllegal && defenderIllegal) {
      // Covers: both timeout, attacker dodges + defender slaps, any mix of
      // wrong-action and timeout between the two players.
      attackerLosesLife = true;
      defenderLosesLife = true;
      outcome = 'double_illegal';
    } else if (attackerIllegal) {
      attackerLosesLife = true;
      outcome = 'attacker_illegal';
    } else if (defenderIllegal) {
      // Covers both "Clean Hit" (defender timed out) and "Defender slaps"
      // — the outcome is identical: defender -1 life.
      defenderLosesLife = true;
      outcome = 'defender_illegal';
    } else {
      // Both acted legally — compare client-provided timestamps.
      // DELIBERATE DESIGN: timestamps are client-side so that felt reaction
      // time drives the outcome rather than server clock skew, which would
      // unfairly penalise high-latency players. Accepted trade-off: a client
      // can spoof their timestamp to win every fast-slap comparison.
      // t_slap < t_dodge → slap lands (Fast Slap)
      // t_dodge < t_slap → dodge succeeds (Successful Dodge, no lives lost)
      if (attackerAction.timestamp < defenderAction.timestamp) {
        defenderLosesLife = true;
        outcome = 'fast_slap';
      } else {
        outcome = 'successful_dodge';
      }
    }

    const attackerPlayer = this.players.find(p => p.socketId === attacker);
    const defenderPlayer = this.players.find(p => p.socketId === defender);

    if (attackerLosesLife) attackerPlayer.lives--;
    if (defenderLosesLife) defenderPlayer.lives--;

    const matchOver = attackerPlayer.lives <= 0 || defenderPlayer.lives <= 0;

    if (matchOver) {
      this.state = 'finished';
      const isDraw = attackerPlayer.lives <= 0 && defenderPlayer.lives <= 0;

      for (const player of this.players) {
        const opponent = this.players.find(p => p.socketId !== player.socketId);
        let result;
        if (isDraw) result = 'draw';
        else if (player.lives <= 0) result = 'loss';
        else result = 'win';

        this.io.to(player.socketId).emit('game_over', {
          result,
          outcome,
          yourLives: player.lives,
          opponentLives: opponent.lives,
        });
      }
    } else {
      // Inform each player of the round result then go straight back to Phase 1.
      for (const player of this.players) {
        const opponent = this.players.find(p => p.socketId !== player.socketId);
        this.io.to(player.socketId).emit('phase2_result', {
          outcome,
          yourRole: player.socketId === attacker ? 'attacker' : 'defender',
          yourAction: this.phase2Actions[player.socketId]?.action ?? null,
          opponentAction: this.phase2Actions[opponent.socketId]?.action ?? null,
          yourLives: player.lives,
          opponentLives: opponent.lives,
        });
      }
      this.startPhase1();
    }
  }

  // ─── Teardown ─────────────────────────────────────────────────────────────

  destroy() {
    clearTimeout(this.expiryTimer);
    clearTimeout(this.phaseTimer);
    for (const player of this.players) {
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) socket.data.roomCode = null;
    }
    this.state = 'finished';
  }
}

module.exports = Room;
