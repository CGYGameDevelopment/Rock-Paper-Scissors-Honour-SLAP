'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Room = require('./room');

const app = express();
app.use(express.static('client'));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.ALLOWED_ORIGIN || false },
});

// All active rooms, keyed by 3-digit code.
const rooms = new Map();

const ROOM_EXPIRY_MS = 3 * 60 * 1000; // 3 minutes

function generateCode() {
  for (let i = 0; i < 10; i++) {
    const code = String(Math.floor(100 + Math.random() * 900));
    if (!rooms.has(code)) return code;
  }
  return null;
}

function getRoomForSocket(socket) {
  return rooms.get(socket.data.roomCode) || null;
}

// ─── Connection ──────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  // ── Create Room ────────────────────────────────────────────────────────────
  // Client asks to create a new room. Server generates a 4-letter code,
  // registers the room, and starts the 3-minute expiry clock.

  socket.on('create_room', () => {
    // Prevent a socket from owning multiple rooms simultaneously.
    if (socket.data.roomCode) {
      return socket.emit('room_error', { message: 'You are already in a room.' });
    }

    const code = generateCode();
    if (!code) {
      return socket.emit('room_error', { message: 'Could not generate a room code. Try again.' });
    }
    const room = new Room(code, io, rooms);
    rooms.set(code, room);

    room.addPlayer(socket);
    socket.join(code);
    socket.emit('room_created', { code });

    // Destroy the room if the second player never shows up.
    room.expiryTimer = setTimeout(() => {
      if (room.state === 'waiting') {
        socket.emit('room_expired');
        room.destroy();
      }
    }, ROOM_EXPIRY_MS);
  });

  // ── Join Room ──────────────────────────────────────────────────────────────
  // Client provides a 3-digit code. Server validates and starts the match.

  socket.on('join_room', (data) => {
    if (!data || typeof data !== 'object') return;
    let { code } = data;
    if (typeof code !== 'string') return;
    code = code.trim();

    if (socket.data.roomCode) {
      return socket.emit('room_error', { message: 'You are already in a room.' });
    }

    const room = rooms.get(code);

    if (!room) {
      return socket.emit('room_error', { message: 'Room not found.' });
    }
    if (room.state !== 'waiting') {
      return socket.emit('room_error', { message: 'Game already in progress.' });
    }
    if (room.players.some(p => p.socketId === socket.id)) {
      return socket.emit('room_error', { message: 'You created this room.' });
    }

    clearTimeout(room.expiryTimer);
    room.addPlayer(socket);
    socket.join(code);

    // Both players are in — start the game.
    room.startPhase1(true);
  });

  // ── Phase 1: RPS choice ────────────────────────────────────────────────────

  socket.on('rps_choice', (data) => {
    if (!data || typeof data !== 'object') return;
    const { choice } = data;
    const room = getRoomForSocket(socket);
    if (!room || room.state !== 'phase1') return;
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
    room.receivePhase2Action(socket.id, action, timestamp);
  });

  // ── Disconnect ─────────────────────────────────────────────────────────────
  // Any disconnect during an active match is treated as a forfeit.

  socket.on('disconnect', () => {
    const room = getRoomForSocket(socket);
    if (!room) return;

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
  console.log(`RPS: Honour SLAP server running on port ${PORT}`);
});
