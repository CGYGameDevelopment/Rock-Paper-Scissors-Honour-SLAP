'use strict';

const PHASE1_DURATION_MS = 5000;
const PHASE2_DURATION_MS = 3000;
const RPS_CHOICES = ['rock', 'paper', 'scissors'];
const MAX_DRAWS = 5;

// What each choice beats
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

class Room {
  constructor(code, io, rooms) {
    this.code = code;
    this.io = io;
    this.rooms = rooms;
    this.players = [];       // [{ socketId, lives }]
    this.state = 'waiting'; // waiting | phase1 | phase2 | resolving | finished
    this.expiryTimer = null;
    this.phaseTimer = null;
    this.roundTimer = null;
    this.phase1Choices = {}; // { socketId: 'rock'|'paper'|'scissors' }
    this.phase2Actions = {}; // { socketId: { action: 'slap'|'dodge', timestamp: number } }
    this.roles = {};         // { attacker: socketId, defender: socketId }
    this.drawCount = 0;
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  addPlayer(socket) {
    this.players.push({ socketId: socket.id, lives: 3 });
    socket.data.roomCode = this.code;
  }

  // ─── Phase 1: Rock, Paper, Scissors ──────────────────────────────────────

  startPhase1(newRound = false) {
    this.state = 'phase1';
    this.phase1Choices = {};
    if (newRound) this.drawCount = 0;
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
      // Draw — tell each player what was chosen and repeat (up to MAX_DRAWS times)
      this.drawCount++;
      for (const player of this.players) {
        const opponent = this.players.find(p => p.socketId !== player.socketId);
        this.io.to(player.socketId).emit('phase1_draw', {
          yourChoice: this.phase1Choices[player.socketId],
          opponentChoice: this.phase1Choices[opponent.socketId],
        });
      }
      if (this.drawCount >= MAX_DRAWS) {
        // Force random role assignment so the game can never stall indefinitely.
        this.drawCount = 0;
        const shuffled = [...this.players].sort(() => Math.random() - 0.5);
        attacker = shuffled[0].socketId;
        defender = shuffled[1].socketId;
        // fall through to role assignment below
      } else {
        this.roundTimer = setTimeout(() => this.startPhase1(), 2000);
        return;
      }
    }

    this.roles = { attacker, defender };

    // Tell each player what was chosen in RPS — Phase 2 follows immediately.
    // Roles (attacker / defender) are deliberately NOT sent to clients: part of
    // the game's skill is each player deducing from the RPS outcome whether they
    // should slap or dodge, and acting on that quickly.
    for (const player of this.players) {
      const opponent = this.players.find(p => p.socketId !== player.socketId);
      this.io.to(player.socketId).emit('phase1_result', {
        yourChoice: this.phase1Choices[player.socketId],
        opponentChoice: this.phase1Choices[opponent.socketId],
        // yourRole intentionally omitted — server-side only
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
      this.destroy();
    } else {
      // Inform each player of the round result then go straight back to Phase 1.
      for (const player of this.players) {
        const opponent = this.players.find(p => p.socketId !== player.socketId);
        this.io.to(player.socketId).emit('phase2_result', {
          outcome,
          // yourRole intentionally omitted — roles stay server-side only
          yourAction: this.phase2Actions[player.socketId]?.action ?? null,
          opponentAction: this.phase2Actions[opponent.socketId]?.action ?? null,
          yourLives: player.lives,
          opponentLives: opponent.lives,
        });
      }
      this.roundTimer = setTimeout(() => this.startPhase1(true), 2000);
    }
  }

  // ─── Teardown ─────────────────────────────────────────────────────────────

  destroy() {
    clearTimeout(this.expiryTimer);
    clearTimeout(this.phaseTimer);
    clearTimeout(this.roundTimer);
    for (const player of this.players) {
      const socket = this.io.sockets.sockets.get(player.socketId);
      if (socket) socket.data.roomCode = null;
    }
    this.state = 'finished';
    this.rooms.delete(this.code);
  }
}

module.exports = Room;
