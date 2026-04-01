'use strict';

const Room = require('../room');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lightweight io mock that records every emit call. */
function makeIo() {
  const emitted = [];
  const socketMap = new Map();

  const toTarget = (id) => ({
    emit: (event, data) => emitted.push({ to: id, event, data }),
  });

  const io = {
    to: (id) => toTarget(id),
    sockets: { sockets: socketMap },
    /** All captured emit calls. */
    _emitted: emitted,
    /** Register a socket so destroy() can clear roomCode on it. */
    _register: (socket) => socketMap.set(socket.id, socket),
  };

  return io;
}

/** Return a minimal socket-like object. */
function makeSocket(id) {
  return { id, data: {} };
}

/** Create a room with two players already added, state set to phase2, and
 *  roles assigned (s1 = attacker, s2 = defender unless overridden). */
function setupPhase2({ attackerId = 's1', defenderId = 's2' } = {}) {
  const rooms = new Map();
  const io = makeIo();
  const room = new Room('TEST', io, rooms);
  rooms.set('TEST', room);

  const s1 = makeSocket(attackerId);
  const s2 = makeSocket(defenderId);
  io._register(s1);
  io._register(s2);

  room.addPlayer(s1);
  room.addPlayer(s2);
  room.state = 'phase2';
  room.roles = { attacker: attackerId, defender: defenderId };

  return { room, io };
}

/** Create a room with two players added and state set to phase1. */
function setupPhase1() {
  const rooms = new Map();
  const io = makeIo();
  const room = new Room('TEST', io, rooms);
  rooms.set('TEST', room);

  const s1 = makeSocket('s1');
  const s2 = makeSocket('s2');
  io._register(s1);
  io._register(s2);

  room.addPlayer(s1);
  room.addPlayer(s2);
  room.state = 'phase1';

  return { room, io };
}

// ─── Fake timers ──────────────────────────────────────────────────────────────
// Prevent real setTimeout callbacks from firing between tests.

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('addPlayer', () => {
  test('pushes a player entry with 3 lives and binds roomCode on socket', () => {
    const rooms = new Map();
    const io = makeIo();
    const room = new Room('TEST', io, rooms);
    const socket = makeSocket('s1');

    room.addPlayer(socket);

    expect(room.players).toHaveLength(1);
    expect(room.players[0]).toMatchObject({ socketId: 's1', lives: 3 });
    expect(socket.data.roomCode).toBe('TEST');
  });
});

// ─── Phase 1: RPS ─────────────────────────────────────────────────────────────

describe('receiveRpsChoice', () => {
  test('ignores an invalid choice string', () => {
    const { room } = setupPhase1();
    room.receiveRpsChoice('s1', 'fire');
    expect(room.phase1Choices['s1']).toBeUndefined();
  });

  test('ignores a duplicate submission from the same socket', () => {
    const { room } = setupPhase1();
    room.receiveRpsChoice('s1', 'rock');
    room.receiveRpsChoice('s1', 'paper');
    expect(room.phase1Choices['s1']).toBe('rock');
  });
});

describe('resolvePhase1 — role assignment', () => {
  test.each([
    ['rock', 'scissors', 's1', 's2'],
    ['scissors', 'paper', 's1', 's2'],
    ['paper', 'rock', 's1', 's2'],
    ['scissors', 'rock', 's2', 's1'],
    ['rock', 'paper', 's2', 's1'],
    ['paper', 'scissors', 's2', 's1'],
  ])('s1=%s vs s2=%s → attacker=%s, defender=%s', (c1, c2, expectedAttacker, expectedDefender) => {
    const { room, io } = setupPhase1();
    room.receiveRpsChoice('s1', c1);
    room.receiveRpsChoice('s2', c2);

    expect(room.roles.attacker).toBe(expectedAttacker);
    expect(room.roles.defender).toBe(expectedDefender);

    const results = io._emitted.filter(e => e.event === 'phase1_result');
    const s1r = results.find(e => e.to === 's1');
    expect(s1r.data.yourRole).toBe(expectedAttacker === 's1' ? 'attacker' : 'defender');
    expect(s1r.data.yourChoice).toBe(c1);
    expect(s1r.data.opponentChoice).toBe(c2);
  });

  test('draw emits phase1_draw to both players and increments drawCount', () => {
    const { room, io } = setupPhase1();
    room.receiveRpsChoice('s1', 'rock');
    room.receiveRpsChoice('s2', 'rock');

    const draws = io._emitted.filter(e => e.event === 'phase1_draw');
    expect(draws).toHaveLength(2);
    expect(draws.find(e => e.to === 's1').data.yourChoice).toBe('rock');
    expect(draws.find(e => e.to === 's2').data.yourChoice).toBe('rock');
    expect(room.drawCount).toBe(1);
    expect(room.state).toBe('phase1'); // restarted
  });
});

// ─── Phase 2: Slap / Dodge ────────────────────────────────────────────────────

describe('receivePhase2Action', () => {
  test('ignores an invalid action type', () => {
    const { room } = setupPhase2();
    room.receivePhase2Action('s1', 'punch', 100);
    expect(room.phase2Actions['s1']).toBeUndefined();
  });

  test('ignores a duplicate submission from the same socket', () => {
    const { room } = setupPhase2();
    room.receivePhase2Action('s1', 'slap', 100);
    room.receivePhase2Action('s1', 'dodge', 50);
    expect(room.phase2Actions['s1']).toMatchObject({ action: 'slap', timestamp: 100 });
  });
});

describe('resolvePhase2 — outcomes', () => {
  test('fast_slap: attacker timestamp < defender timestamp → defender loses a life', () => {
    const { room, io } = setupPhase2();
    room.receivePhase2Action('s1', 'slap', 100);
    room.receivePhase2Action('s2', 'dodge', 200);

    const round = io._emitted.find(e => e.event === 'phase2_result' && e.to === 's2');
    expect(round.data.outcome).toBe('fast_slap');
    expect(room.players.find(p => p.socketId === 's2').lives).toBe(2);
    expect(room.players.find(p => p.socketId === 's1').lives).toBe(3);
  });

  test('successful_dodge: defender timestamp < attacker timestamp → no lives lost', () => {
    const { room, io } = setupPhase2();
    room.receivePhase2Action('s1', 'slap', 200);
    room.receivePhase2Action('s2', 'dodge', 100);

    const round = io._emitted.find(e => e.event === 'phase2_result');
    expect(round.data.outcome).toBe('successful_dodge');
    expect(room.players[0].lives).toBe(3);
    expect(room.players[1].lives).toBe(3);
  });

  test('attacker_illegal: attacker sends dodge → attacker loses a life', () => {
    const { room, io } = setupPhase2();
    room.receivePhase2Action('s1', 'dodge', 100);
    room.receivePhase2Action('s2', 'dodge', 200);

    const round = io._emitted.find(e => e.event === 'phase2_result');
    expect(round.data.outcome).toBe('attacker_illegal');
    expect(room.players.find(p => p.socketId === 's1').lives).toBe(2);
    expect(room.players.find(p => p.socketId === 's2').lives).toBe(3);
  });

  test('defender_illegal: defender sends slap → defender loses a life', () => {
    const { room, io } = setupPhase2();
    room.receivePhase2Action('s1', 'slap', 100);
    room.receivePhase2Action('s2', 'slap', 200);

    const round = io._emitted.find(e => e.event === 'phase2_result');
    expect(round.data.outcome).toBe('defender_illegal');
    expect(room.players.find(p => p.socketId === 's2').lives).toBe(2);
    expect(room.players.find(p => p.socketId === 's1').lives).toBe(3);
  });

  test('double_illegal: both send wrong actions → both lose a life', () => {
    const { room, io } = setupPhase2();
    room.receivePhase2Action('s1', 'dodge', 100); // attacker dodges
    room.receivePhase2Action('s2', 'slap', 200);  // defender slaps

    const round = io._emitted.find(e => e.event === 'phase2_result');
    expect(round.data.outcome).toBe('double_illegal');
    expect(room.players[0].lives).toBe(2);
    expect(room.players[1].lives).toBe(2);
  });

  test('double_illegal: both time out (no actions submitted) → both lose a life', () => {
    const { room, io } = setupPhase2();
    room.resolvePhase2();

    const round = io._emitted.find(e => e.event === 'phase2_result');
    expect(round.data.outcome).toBe('double_illegal');
    expect(room.players[0].lives).toBe(2);
    expect(room.players[1].lives).toBe(2);
  });
});

describe('resolvePhase2 — game over', () => {
  test('emits game_over with win/loss when one player reaches 0 lives', () => {
    const { room, io } = setupPhase2();
    room.players.find(p => p.socketId === 's2').lives = 1;

    room.receivePhase2Action('s1', 'slap', 100);
    room.receivePhase2Action('s2', 'dodge', 200); // fast_slap → s2 at 0 lives

    const gameOver = io._emitted.filter(e => e.event === 'game_over');
    expect(gameOver).toHaveLength(2);
    expect(gameOver.find(e => e.to === 's1').data.result).toBe('win');
    expect(gameOver.find(e => e.to === 's2').data.result).toBe('loss');
  });

  test('emits game_over with draw when both players reach 0 lives simultaneously', () => {
    const { room, io } = setupPhase2();
    room.players[0].lives = 1; // attacker
    room.players[1].lives = 1; // defender

    // double_illegal → both lose last life
    room.receivePhase2Action('s1', 'dodge', 100);
    room.receivePhase2Action('s2', 'slap', 200);

    const gameOver = io._emitted.filter(e => e.event === 'game_over');
    expect(gameOver).toHaveLength(2);
    expect(gameOver[0].data.result).toBe('draw');
    expect(gameOver[1].data.result).toBe('draw');
  });

  test('game_over payload includes correct lives and outcome', () => {
    const { room, io } = setupPhase2();
    room.players.find(p => p.socketId === 's2').lives = 1;

    room.receivePhase2Action('s1', 'slap', 50);
    room.receivePhase2Action('s2', 'dodge', 300);

    const s1Event = io._emitted.find(e => e.event === 'game_over' && e.to === 's1');
    expect(s1Event.data).toMatchObject({
      outcome: 'fast_slap',
      yourLives: 3,
      opponentLives: 0,
    });
  });

  test('room is removed from map and state becomes finished after game over', () => {
    const rooms = new Map();
    const io = makeIo();
    const room = new Room('TEST', io, rooms);
    rooms.set('TEST', room);

    const s1 = makeSocket('s1');
    const s2 = makeSocket('s2');
    io._register(s1);
    io._register(s2);
    room.addPlayer(s1);
    room.addPlayer(s2);
    room.state = 'phase2';
    room.roles = { attacker: 's1', defender: 's2' };

    room.players.find(p => p.socketId === 's2').lives = 1;
    room.receivePhase2Action('s1', 'slap', 100);
    room.receivePhase2Action('s2', 'dodge', 200);

    expect(rooms.has('TEST')).toBe(false);
    expect(room.state).toBe('finished');
  });
});

// ─── Destroy ──────────────────────────────────────────────────────────────────

describe('destroy', () => {
  test('removes the room from the rooms map, clears roomCode on sockets, sets state to finished', () => {
    const rooms = new Map();
    const io = makeIo();
    const room = new Room('TEST', io, rooms);
    rooms.set('TEST', room);

    const s1 = makeSocket('s1');
    io._register(s1);
    room.addPlayer(s1);

    room.destroy();

    expect(rooms.has('TEST')).toBe(false);
    expect(s1.data.roomCode).toBeNull();
    expect(room.state).toBe('finished');
  });
});
