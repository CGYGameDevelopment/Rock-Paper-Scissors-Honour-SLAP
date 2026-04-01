# Project Scope: Rock, Paper, Scissors: Honour SLAP (Web Multiplayer)

## 1. Project Overview

*Rock, Paper, Scissors: Honour SLAP* is a fast-paced, web-based 2D multiplayer game combining the strategic luck of **Rock, Paper, Scissors (RPS)** with a high-tension, reflex-based **Slaps** phase. The game focuses on psychological pressure and reaction speed.

---

## 2. Core Gameplay Loop

The game is played in rounds. Each round consists of two distinct phases played in sequence.

### Phase 1: The Initiative (Rock, Paper, Scissors)

**Objective:** Determine player roles for Phase 2.

**Mechanism:**
- Each player has **5 seconds** to select Rock, Paper, or Scissors.
- Standard RPS rules determine the winner.

**Outcomes:**

| Result | Effect |
| :----- | :----- |
| Win    | Player becomes the **Attacker** in Phase 2 |
| Loss   | Player becomes the **Defender** in Phase 2 |
| Draw   | Phase 1 repeats until a winner is found |

---

### Phase 2: The Action (Slaps)

**Objective:** Score points or bait the opponent into a violation.

**Roles:**
- **Attacker** — legal move is **Slap**
- **Defender** — legal move is **Dodge**

#### Timing & Timeout

- Each player has **3 seconds** to act in Phase 2.
- Failing to act within 3 seconds is treated as an **illegal move** for that player's role (same penalty as actively choosing the wrong action).

#### Scoring & Violation Rules

| Scenario | Condition | Result |
| :------- | :-------- | :----- |
| **Illegal Move** | Attacker selects Dodge | **Attacker −1 life** |
| **Illegal Move** | Attacker does nothing within 3s | **Attacker −1 life** |
| **Illegal Move** | Defender selects Slap | **Defender −1 life** |
| **Illegal Move** | Defender does nothing within 3s | **Defender −1 life** |
| **Clean Hit** | Attacker slaps; Defender does nothing within 3s | **Defender −1 life** |
| **Fast Slap** | Attacker slaps at `t1`, Defender dodges at `t2` where `t2 > t1` | **Defender −1 life** |
| **Successful Dodge** | Attacker slaps at `t1`, Defender dodges at `t2` where `t2 < t1` | **Neutral — no lives lost** |
| **Double Illegal** | Both players act illegally — both timeout, both choose the wrong action, or any mix of wrong action and timeout | **Both −1 life** |

> **Note:** "Defender does nothing within 3s" appears in both *Illegal Move* and *Clean Hit*. These are the same event — the distinction is flavour only. The outcome (Defender −1 life) is identical.

#### Timing Logic

The server compares the exact millisecond timestamps of incoming action packets during Phase 2:

- If `t_slap < t_dodge` → Slap lands → Defender loses a life.
- If `t_dodge < t_slap` → Dodge succeeds → No lives lost.
- Illegal moves (wrong action or timeout) are resolved independently of timing.

**Round Transition:** After Phase 2 resolves, the game returns to Phase 1 for the next round.

---

## 3. Win Condition

Each player starts with **3 lives**. A player who loses all 3 lives loses the match. There is no round limit — the match ends only when a player reaches 0 lives.

---

## 4. Technical Architecture

> The stack below was suggested as a starting point and is open to change.

### Frontend (Client)

- **Framework:** Plain HTML5/CSS3 with Canvas API. Chosen over Phaser.js because it has no dependencies, no installation, and requires no prior framework knowledge — the right fit for a hobby project.
- **Input:** Desktop-first. Primary inputs are Space/Arrow keys and Mouse. Touch support is a future consideration only.
- **Visuals:** 2D hand sprites with distinct animations for:
  - Slap
  - Dodge
  - Error/Flinch (illegal move feedback)

### Backend (Server)

- **Technology:** Node.js with Socket.io.
- **Authority Model:** Each client is trusted as the source of truth for its own inputs. Cheating prevention is explicitly out of scope.
- **Timestamping:** Timestamps are **client-provided** and embedded in the action packet payload. The server uses these values directly to compare `t_slap` vs `t_dodge`. Fairness across network latency is accepted as a known trade-off given cheat prevention is out of scope.
- **Phase Transitions:** Phase 2 begins **immediately** after Phase 1 resolves — no server-orchestrated delay. Recognising your role (Attacker or Defender) quickly from the RPS outcome is an intentional skill element.
- **Disconnection:** If a player disconnects at any point during a match, they **forfeit** immediately. The opponent wins the match.
- **Matchmaking:** **Friend-based only.** Players share a room code/URL with a specific friend. No random or public matchmaking — this is a small hobby game.
- **Room codes:** Four random uppercase letters (e.g. `KXQT`).
- **Room expiry:** An unjoined room expires after **3 minutes**. Once a match ends, the room is destroyed — players must create a new room for a rematch.

---

## 5. UI Requirements

> **UI design and implementation is deferred.** No UI work should begin until explicitly scoped.

---

## 6. Out of Scope (for now)

- Cheat prevention / server-side validation of inputs
- Accounts, authentication, or persistent stats
- Spectator mode
- Mobile-specific UI/UX design
- UI implementation

---

## 7. Open Questions

> All questions resolved. None outstanding.
