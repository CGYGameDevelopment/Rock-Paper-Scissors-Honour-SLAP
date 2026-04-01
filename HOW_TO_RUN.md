# How to Run & Test This Locally (ELI5)

Think of this project like a **walkie-talkie game**: the server is the radio tower, and each browser tab is a player with their own walkie-talkie. You need to start the tower first, then tune in with two tabs.

---

## Step 0 — Open a terminal

A terminal is the black text window where you type commands.

**Easiest way (opens directly in the project folder):**
1. Open File Explorer and navigate to the `Rock-Paper-Scissors-Honour-SLAP` folder
2. Click the address bar at the top (where it shows the folder path)
3. Type `cmd` and press Enter — a terminal opens already inside the right folder

**Other ways to open a terminal:**
- Press `Windows key + R`, type `cmd`, press Enter
- Press the `Windows key`, type `terminal`, press Enter
- Right-click the Start button → **Terminal**

> If you used the File Explorer trick you're already in the right folder. Otherwise you'll need to navigate there before running any commands.

---

## Step 1 — Make sure you have Node.js installed

Node.js is the engine that runs the server. Open a terminal and type:

```bash
node --version
```

If you see something like `v18.x.x` or higher, you're good. If you get an error, download Node.js from [nodejs.org](https://nodejs.org) and install it.

---

## Step 2 — Install the project's dependencies

Think of this like downloading the spare parts the server needs before it can run. You only ever need to do this once (or again if you clone the repo fresh).

In your terminal, navigate to the project folder and run:

```bash
npm install
```

You'll see a `node_modules` folder appear. That's normal — it's all the spare parts.

---

## Step 3 — Start the server

```bash
npm start
```

You should see something like:

```
Server listening on port 3000
```

The server is now running. Leave this terminal open — closing it shuts the server down.

---

## Step 4 — Open two browser tabs to play

Open your browser and go to:

```
http://localhost:3000
```

Open that same URL in a **second tab** (or a second browser window). You now have two "players".

**To play a game:**
1. In Tab 1, click **Create Room**. You'll see a 4-letter room code (e.g. `KXQT`).
2. In Tab 2, type that code into the box and click **Join Room**.
3. The game starts automatically.

> You can also play across two devices on the same Wi-Fi — just replace `localhost` with your machine's local IP address (e.g. `http://192.168.1.x:3000`).

---

## Step 5 — Run the automated tests

The tests check all the game logic (scoring, lives, phase transitions) without needing a browser. Open a **new terminal** (keep the server running in the other one, or stop it — the tests don't need it) and run:

```bash
npm test
```

Jest will run all the tests in the `tests/` folder and print a pass/fail report. Green = good.

---

## Quick reference

| What you want to do | Command |
| :--- | :--- |
| Install dependencies (first time) | `npm install` |
| Start the game server | `npm start` |
| Run automated tests | `npm test` |
| Open the game | Browser → `http://localhost:3000` |

---

## Troubleshooting

**Port already in use?** Something else is running on port 3000. Either stop that process, or start the server on a different port:
```bash
PORT=4000 npm start
```
Then open `http://localhost:4000` instead.

**Page won't load?** Make sure you ran `npm start` and the terminal says "listening". Also check you're visiting `http://` not `https://`.

**Tests failing?** Run `npm install` first to make sure all dev dependencies (like Jest) are installed.
