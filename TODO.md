# To Do

> **Server is complete** (`server.js` + `room.js`). All work below is client-side only.

---

## Client

### Setup
- [x] Create `client/index.html`
- [x] Create `client/style.css`
- [x] Create `client/game.js`
- [x] Connect to server via Socket.io client (`socket = io()`)

### Lobby
- [x] Create room screen — button emits `create_room` → listen for `room_created` (`{ code }`) → display the 4-letter code
- [x] Join room screen — text input + submit emits `join_room` (`{ code }`)
- [x] Handle `room_error` (`{ message }`) — show error text on lobby screen
- [x] Handle `room_expired` — notify user the room timed out (3-minute expiry)
- [x] Waiting screen — shown after `room_created`, before `game_start` arrives

### Phase 1 — RPS
- [x] Listen for `phase1_start` → show Rock / Paper / Scissors buttons + 5-second countdown
- [x] On selection emit `rps_choice` (`{ choice: 'rock'|'paper'|'scissors' }`)
- [x] Handle `phase1_draw` (`{ yourChoice, opponentChoice }`) — show both choices, restart countdown automatically (server re-emits `phase1_start`)
- [x] Handle `phase1_result` (`{ yourChoice, opponentChoice, yourRole: 'attacker'|'defender' }`) — show both choices and reveal role; Phase 2 starts immediately after

### Phase 2 — Slap / Dodge
- [x] Listen for `phase2_start` → show single action button based on role (`yourRole` from `phase1_result`): **Slap** for attacker, **Dodge** for defender; 3-second countdown
- [x] On button press emit `phase2_action` (`{ action: 'slap'|'dodge', timestamp: Date.now() }`)
- [x] Handle `phase2_result` (`{ outcome, yourRole, yourAction, opponentAction, yourLives, opponentLives }`) — show round outcome and updated lives, then wait for next `phase1_start`
  - Possible `outcome` values: `fast_slap`, `successful_dodge`, `attacker_illegal`, `defender_illegal`, `double_illegal`

### End of Match
- [x] Handle `game_over` (`{ result: 'win'|'loss'|'draw', outcome, yourLives, opponentLives }`) — show final result and a play-again button (reconnects to lobby)
- [x] Handle `opponent_disconnected` — show a message and return to lobby

### Display
- [x] Lives display (plain text, update from `yourLives` in `phase2_result` / `game_over`)
- [x] Status/message area (single text line showing current state, outcome, errors)
