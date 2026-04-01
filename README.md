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

Friend-based only — no public matchmaking. One player creates a room and shares the 4-letter code with their friend. Unjoined rooms expire after 3 minutes.

## Tech Stack

- **Server:** Node.js, Express, Socket.io
- **Client:** Plain HTML5/CSS3/JavaScript

## Running the Server

```bash
npm install
npm start
```

The server runs on port `3000` by default. Set the `PORT` environment variable to override.

## License

CC BY-NC-ND 4.0 — free for personal use, no modifications, no commercial use. See [LICENSE](LICENSE).
