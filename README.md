# pe$os treasure hunt

A maze game built into the [pe$os worldwide](https://pesosworldwide.com/hunt) store to launch the blueprint collection. Every player gets a pe$os community name, each hunt is five mazes with its own live leaderboard, and each maze can be played only once.

- **launch day:** 399 players, 378 to the finish
- **pop-up:** 72 players, 55 to the finish

This is the hunt taken out of the store's codebase, shared with pe$os's permission. The store's own layout, cart and checkout are left out.

## How it works

- **Next.js 16 and React 19**, with the mazes drawn in **three.js** through react-three-fiber.
- **Mazes from a seed** (`lib/maze.ts`): every player in a hunt gets the same five mazes, generated, not stored.
- **Runs the browser can't fake** (`lib/huntSession.ts`, `app/api/hunt/*`): the server issues a signed token naming the player, the maze and the moment it started. A finish is accepted only with a valid token, for that player, in an open hunt, no faster than the maze can physically be run and no longer than the token has existed.
- **Live leaderboards** (`lib/huntStore.ts`, `components/hunt/useLiveBoard.ts`) on MySQL.
- **Practice mode:** with no database or no secret, the hunt still plays and records nothing.

## Run it

```bash
npm install
cp .env.example .env.local   # leave it empty for practice mode
npm run dev                  # then open localhost:3000/hunt
```

Built by Kenneth Rutto, lead developer at pe$os worldwide.
