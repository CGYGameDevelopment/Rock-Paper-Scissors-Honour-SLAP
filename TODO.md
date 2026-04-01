# To Do

## Client

### Setup
- [ ] Create `client/index.html`
- [ ] Create `client/style.css`
- [ ] Create `client/game.js`
- [ ] Connect to server via Socket.io client

### Lobby
- [ ] Create room screen (button → displays room code)
- [ ] Join room screen (code input + submit)
- [ ] Room expiry feedback (notify user when room expires)
- [ ] Waiting screen (after creating room, before opponent joins)

### Phase 1 — RPS
- [ ] Display Rock / Paper / Scissors options
- [ ] 5-second countdown timer
- [ ] Send `rps_choice` to server on selection
- [ ] Handle `phase1_draw` (show both choices, restart)
- [ ] Handle `phase1_result` (show both choices, reveal roles)

### Phase 2 — Slap / Dodge
- [ ] Display correct action button for role (Slap or Dodge)
- [ ] 3-second countdown timer
- [ ] Send `phase2_action` with client timestamp to server
- [ ] Handle `phase2_result` (show outcome, lives remaining)

### End of Match
- [ ] Handle `game_over` (show result, lives, play-again option)
- [ ] Handle `opponent_disconnected`

### Visuals
- [ ] Hand sprite — idle
- [ ] Hand sprite — Slap animation
- [ ] Hand sprite — Dodge animation
- [ ] Hand sprite — Error/Flinch animation (illegal move feedback)
- [ ] Lives display
