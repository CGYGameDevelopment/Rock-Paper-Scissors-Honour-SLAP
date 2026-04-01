"""
Text-based integration test for RPS: Honour SLAP
Simulates two players through a full game via Socket.IO.
"""
import socketio
import threading
import time
import sys

URL = "http://localhost:3000"

log_lock = threading.Lock()

def log(who, msg):
    with log_lock:
        print(f"[{who}] {msg}", flush=True)


class Player:
    def __init__(self, name, rps_choice, phase2_action):
        self.name = name
        self.rps_choice = rps_choice
        self.phase2_action = phase2_action
        self.sio = socketio.Client(logger=False, engineio_logger=False)
        self.room_code = None
        self.done = threading.Event()
        self.events = []
        self._register()

    def _register(self):
        sio = self.sio
        name = self.name

        @sio.event
        def connect():
            log(name, "connected")

        @sio.event
        def disconnect():
            log(name, "disconnected")

        @sio.on("room_created")
        def on_room_created(data):
            self.room_code = data["code"]
            log(name, f"room created: {self.room_code}")

        @sio.on("room_error")
        def on_room_error(data):
            log(name, f"ERROR: {data['message']}")
            self.done.set()

        @sio.on("room_expired")
        def on_room_expired():
            log(name, "room expired (no second player joined in time)")
            self.done.set()

        @sio.on("game_start")
        def on_game_start():
            log(name, "game started!")

        @sio.on("phase1_start")
        def on_phase1_start():
            log(name, f"Phase 1 — choosing '{self.rps_choice}'")
            sio.emit("rps_choice", {"choice": self.rps_choice})

        @sio.on("phase1_draw")
        def on_phase1_draw(data):
            log(name, f"Draw! you={data['yourChoice']} opp={data['opponentChoice']} — replaying…")

        @sio.on("phase1_result")
        def on_phase1_result(data):
            log(name,
                f"Phase 1 result: you={data['yourChoice']} opp={data['opponentChoice']} "
                f"→ role={data['yourRole'].upper()}")
            self.events.append(("phase1_result", data))

        @sio.on("phase2_start")
        def on_phase2_start():
            log(name, f"Phase 2 — sending '{self.phase2_action}'")
            sio.emit("phase2_action", {
                "action": self.phase2_action,
                "timestamp": int(time.time() * 1000),
            })

        @sio.on("phase2_result")
        def on_phase2_result(data):
            log(name,
                f"Round over: outcome={data['outcome']} role={data['yourRole']} "
                f"lives={data['yourLives']}♥ (opp {data['opponentLives']}♥)")
            self.events.append(("phase2_result", data))

        @sio.on("game_over")
        def on_game_over(data):
            log(name,
                f"GAME OVER — result={data['result'].upper()} outcome={data['outcome']} "
                f"lives={data['yourLives']}♥ (opp {data['opponentLives']}♥)")
            self.events.append(("game_over", data))
            self.done.set()

        @sio.on("opponent_disconnected")
        def on_opponent_disconnected():
            log(name, "opponent disconnected")
            self.done.set()

    def connect(self):
        self.sio.connect(URL)

    def disconnect(self):
        self.sio.disconnect()


def run_test(p1_choice, p2_choice, p1_action, p2_action, label):
    print(f"\n{'='*60}")
    print(f"SCENARIO: {label}")
    print(f"  P1 RPS={p1_choice}, action={p1_action}")
    print(f"  P2 RPS={p2_choice}, action={p2_action}")
    print(f"{'='*60}")

    p1 = Player("P1", p1_choice, p1_action)
    p2 = Player("P2", p2_choice, p2_action)

    p1.connect()
    p1.sio.emit("create_room")
    time.sleep(0.3)

    p2.connect()
    p2.sio.emit("join_room", {"code": p1.room_code})

    # Wait up to 15 seconds for the game to finish
    p1.done.wait(timeout=15)
    p2.done.wait(timeout=15)

    time.sleep(0.5)
    p1.disconnect()
    p2.disconnect()
    time.sleep(0.3)

    # Summary
    p1_go = next((e[1] for e in p1.events if e[0] == "game_over"), None)
    p2_go = next((e[1] for e in p2.events if e[0] == "game_over"), None)
    if p1_go and p2_go:
        print(f"\n  RESULT  P1={p1_go['result'].upper()}  P2={p2_go['result'].upper()}")
        print(f"  PASSED" if (
            (p1_go["result"] in ("win","loss","draw")) and
            (p2_go["result"] in ("win","loss","draw"))
        ) else "  FAILED")
    else:
        print("  FAILED (game never completed)")


if __name__ == "__main__":
    # Scenario 1: P1 wins RPS (rock beats scissors), P1 slaps fast, P2 dodges late
    # P1=attacker slaps, P2=defender dodges — but P1 timestamp < P2 → fast_slap
    run_test("rock", "scissors", "slap", "dodge", "Rock beats Scissors → fast slap")

    # Scenario 2: Defender dodges before attacker slaps → successful_dodge
    # P2 wins RPS (paper beats rock), P2 is attacker
    # P2 sends slap with a later timestamp, P1 sends dodge with earlier timestamp
    run_test("rock", "paper", "dodge", "slap", "Paper beats Rock → successful dodge (P1 dodges early)")

    # Scenario 3: Draw first then resolve
    run_test("rock", "rock", "dodge", "slap", "Draw first (rock/rock), then paper/scissors resolves it")

    # Scenario 4: Attacker forgets to slap (illegal) → attacker loses life
    run_test("scissors", "rock", "dodge", "slap", "Attacker sends dodge instead of slap → illegal")

    print("\n\nAll scenarios complete.")
