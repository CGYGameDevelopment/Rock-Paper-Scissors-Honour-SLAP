'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Room = require('./room');
const {
  ROOM_EXPIRY_MS,
  CODE_LENGTH,
  CODE_CHARS,
  CODE_GEN_ATTEMPTS,
} = require('./config');

const app = express();
app.use(express.static('client'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.ALLOWED_ORIGIN || false },
});

// All active rooms, keyed by 4-letter code.
const rooms = new Map();

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function generateCode() {
  for (let i = 0; i < CODE_GEN_ATTEMPTS; i++) {
    const code = Array.from(
      { length: CODE_LENGTH },
      () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join('');
    if (!rooms.has(code)) return code;
  }
  return null;
}

function getRoomForSocket(socket) {
  return rooms.get(socket.data.roomCode) || null;
}

// ─── Connection ──────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  log(`connect   ${socket.id}`);

  // ── Create Room ────────────────────────────────────────────────────────────

  socket.on('create_room', () => {
    if (socket.data.roomCode) {
      log(`create_room rejected: ${socket.id} already in room ${socket.data.roomCode}`);
      return socket.emit('room_error', { message: 'You are already in a room.' });
    }

    const code = generateCode();
    if (!code) {
      log(`create_room failed: no code available (rooms: ${rooms.size})`);
      return socket.emit('room_error', { message: 'Could not generate a room code. Try again.' });
    }

    const room = new Room(code, io, rooms);
    rooms.set(code, room);
    room.addPlayer(socket);
    socket.join(code);
    socket.emit('room_created', { code });
    log(`create_room ${code} by ${socket.id}`);

    // Destroy the room if the second player never shows up.
    room.expiryTimer = setTimeout(() => {
      if (room.state === 'waiting') {
        log(`room ${code} expired (no second player joined)`);
        socket.emit('room_expired');
        room.destroy();
      }
    }, ROOM_EXPIRY_MS);
  });

  // ── Join Room ──────────────────────────────────────────────────────────────

  socket.on('join_room', (data) => {
    if (!data || typeof data !== 'object') return;
    let { code } = data;
    if (typeof code !== 'string') return;
    code = code.trim();

    // Validate format: must be exactly 4 uppercase letters.
    if (!/^[A-Z]{4}$/.test(code)) {
      log(`join_room rejected: invalid code format "${code}" from ${socket.id}`);
      return socket.emit('room_error', { message: 'Room code must be 4 uppercase letters (e.g. KXQT).' });
    }

    if (socket.data.roomCode) {
      log(`join_room rejected: ${socket.id} already in room ${socket.data.roomCode}`);
      return socket.emit('room_error', { message: 'You are already in a room.' });
    }

    const room = rooms.get(code);

    if (!room) {
      log(`join_room rejected: room ${code} not found (requested by ${socket.id})`);
      return socket.emit('room_error', { message: 'Room not found.' });
    }
    if (room.state !== 'waiting') {
      log(`join_room rejected: room ${code} already in state "${room.state}"`);
      return socket.emit('room_error', { message: 'Game already in progress.' });
    }
    if (room.players.some(p => p.socketId === socket.id)) {
      return socket.emit('room_error', { message: 'You created this room.' });
    }

    clearTimeout(room.expiryTimer);
    room.addPlayer(socket);
    socket.join(code);
    log(`join_room ${code} by ${socket.id} — starting game`);

    // Both players are in — start the game.
    room.startPhase1(true);
  });

  // ── Phase 1: RPS choice ────────────────────────────────────────────────────

  socket.on('rps_choice', (data) => {
    if (!data || typeof data !== 'object') return;
    const { choice } = data;
    const room = getRoomForSocket(socket);
    if (!room || room.state !== 'phase1') return;
    log(`rps_choice room=${room.code} socket=${socket.id} choice=${choice}`);
    room.receiveRpsChoice(socket.id, choice);
  });

  // ── Phase 2: Slap/Dodge action ─────────────────────────────────────────────
  // `timestamp` is client-provided (Date.now() at the moment the player acts).

  socket.on('phase2_action', (data) => {
    if (!data || typeof data !== 'object') return;
    const { action, timestamp } = data;
    const room = getRoomForSocket(socket);
    if (!room || room.state !== 'phase2') return;
    if (typeof timestamp !== 'number') return;
    log(`phase2_action room=${room.code} socket=${socket.id} action=${action} ts=${timestamp}`);
    room.receivePhase2Action(socket.id, action, timestamp);
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────

  socket.on('disconnect', () => {
    const room = getRoomForSocket(socket);
    if (!room) {
      log(`disconnect ${socket.id} (no room)`);
      return;
    }

    log(`disconnect ${socket.id} from room ${room.code} (state: ${room.state})`);
    const opponent = room.players.find(p => p.socketId !== socket.id);

    if (room.state !== 'waiting' && room.state !== 'finished') {
      if (opponent) {
        io.to(opponent.socketId).emit('opponent_disconnected');
      }
    }

    room.destroy();
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  log(`RPS: Honour SLAP server running on port ${PORT}`);
});
