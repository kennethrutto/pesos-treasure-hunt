/* Wipes the Pop Up edition's runs so that board can start again from empty.
 *
 *   node --env-file=.env.local scripts/reset-hunt.mjs --yes
 *
 * One table, named below rather than looked up: this runs as plain node on
 * the host and cannot import lib/huntBoards.ts. Point TABLE at whichever
 * edition you mean to empty, and check it against RUN_TABLES in
 * lib/huntDb.ts before running it.
 *
 * Launch Day is not something this touches, and that matters more than it
 * used to. Its runs are in `hunt_runs` — the table the hunt was first built
 * on — which now holds both the 378 finishers it closed with and every run
 * made since it reopened. This script used to empty exactly that table,
 * which is why it names the one it empties.
 *
 * `hunt_players` is deliberately left alone, because a handle is *derived*
 * from the player id rather than drawn at random — the same visitor gets the
 * same name back either way, and the table only exists so the unique index
 * can arbitrate a collision. Deleting it would re-run that arbitration and
 * could hand a name someone has already been shown to a different person.
 *
 * The `--yes` flag is not ceremony. This is the one operation in the
 * codebase with no undo and no backup of its own, and it is most likely to
 * be run by someone pasting a half-remembered command between rounds of a
 * live hunt.
 *
 * On the cPanel host the database listens on localhost only, so this has to
 * run *there* — or from an IP allowed through cPanel's Remote MySQL. With
 * neither, the equivalent is one line in phpMyAdmin:
 *
 *   TRUNCATE hunt_runs_pop_up;
 */

import mysql from "mysql2/promise";

/** Must match this edition's entry in RUN_TABLES, lib/huntDb.ts. */
const BOARD = "Pop Up";
const TABLE = "hunt_runs_pop_up";

const required = ["HUNT_DB_HOST", "HUNT_DB_USER", "HUNT_DB_NAME"];
const missing = required.filter((k) => !process.env[k]);

if (missing.length) {
  console.error(
    `Not configured — missing ${missing.join(", ")}.\n` +
      "This needs the same HUNT_DB_* variables the app runs with, and the\n" +
      "database only accepts connections from the host it lives on.",
  );
  process.exit(1);
}

if (!process.argv.includes("--yes")) {
  console.error(
    `This deletes every ${BOARD} run for every player, permanently.\n` +
      "Launch Day is not touched. Re-run with --yes if that is what you want.",
  );
  process.exit(1);
}

const db = await mysql.createConnection({
  host: process.env.HUNT_DB_HOST,
  port: Number(process.env.HUNT_DB_PORT ?? 3306),
  user: process.env.HUNT_DB_USER,
  password: process.env.HUNT_DB_PASSWORD ?? "",
  database: process.env.HUNT_DB_NAME,
});

try {
  const before = await countRuns();

  if (before == null) {
    /* The app creates the table on its first request after a restart, so a
     * deploy nobody has opened yet has nothing here to clear. */
    console.log(
      `${process.env.HUNT_DB_NAME}: ${TABLE} does not exist yet. Nothing has ` +
        `been run on ${BOARD}, so there is nothing to clear.`,
    );
  } else {
    console.log(
      `${process.env.HUNT_DB_NAME}.${TABLE} (${BOARD}): ` +
        `${before.runs} run(s) by ${before.players} player(s).`,
    );

    /* TRUNCATE resets AUTO_INCREMENT and is the faster of the two, but it is
     * refused on a table involved in a foreign key on some MySQL builds —
     * every runs table is a child of hunt_players. DELETE does the same job
     * with a transaction log behind it, so it is the fallback rather than
     * the default. */
    try {
      await db.query(`TRUNCATE TABLE ${TABLE}`);
    } catch (err) {
      console.log(`TRUNCATE refused (${err.code ?? err.message}) — deleting.`);
      await db.query(`DELETE FROM ${TABLE}`);
    }

    const [[after]] = await db.query(`SELECT COUNT(*) AS runs FROM ${TABLE}`);
    console.log(
      after.runs === 0
        ? `Cleared. The ${BOARD} boards are empty and every player can run all five again. Launch Day is untouched.`
        : `Something is still there: ${after.runs} row(s) remain.`,
    );
  }
} finally {
  await db.end();
}

async function countRuns() {
  try {
    const [[row]] = await db.query(
      `SELECT COUNT(*) AS runs, COUNT(DISTINCT player_id) AS players FROM ${TABLE}`,
    );
    return row;
  } catch (err) {
    if (err.code === "ER_NO_SUCH_TABLE") return null;
    throw err;
  }
}
