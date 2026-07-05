# Rock, Paper, Scissors: Honour SLAP

A fast-paced 2-player web game combining Rock, Paper, Scissors with a reflex-based slap phase.

## Gameplay

Each round has two phases:

1. **RPS (5 seconds)** — Both players pick Rock, Paper, or Scissors. The winner becomes the Attacker; the loser becomes the Defender. Draws repeat Phase 1 until a winner is found.

2. **Slap (3 seconds)** — The Attacker must Slap; the Defender must Dodge. Timing determines the outcome:
   - Attacker slaps before the Defender dodges → Defender loses a life.
   - Defender dodges before the Attacker slaps → No lives lost.
   - Either player acts illegally (wrong move or timeout) → That player loses a life.
   - Both act illegally → Both lose a life.

Each player starts with **3 lives**. First to 0 lives loses.

## Multiplayer

Friend-based only — no public matchmaking. One player creates a room and shares the 4-letter code (or the invite link, e.g. `http://localhost:3000/?room=KXQT`) with their friend. Opening an invite link joins the room automatically. Unjoined rooms expire after 3 minutes.

## Controls

| Phase | Mouse | Keyboard |
| :---- | :---- | :------- |
| Throw | Click Rock / Paper / Scissors | `←` Rock, `↑` Paper, `→` Scissors |
| Slap  | Click SLAP / DODGE | `←` Slap, `→` Dodge |

Sound effects are generated in the browser (no audio files) — toggle them with the speaker button in the corner.

## Tech Stack

- **Server:** Node.js, Express, Socket.io
- **Client:** Plain HTML5/CSS3/JavaScript — no build step required

## Project Structure

```
server.js       — Express + Socket.io server, event routing
room.js         — Room state, game logic, phase transitions
config.js       — Timings, room rules, starting lives
client/
  index.html    — Game UI (lobby, phases, results)
  style.css     — Arcade theme, animations
  game.js       — Socket.io client, UI logic, WebAudio sound
tests/
  room.test.js  — Jest tests for the game logic
```

## Running Locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser tabs or on two devices on the same network. The server runs on port `3000` by default. Set the `PORT` environment variable to override.

## License

CC BY-NC-ND 4.0 — free for personal use, no modifications, no commercial use. See [LICENSE](LICENSE).
