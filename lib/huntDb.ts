import "server-only";

import mysql from "mysql2/promise";

import type { HuntBoardId } from "@/lib/huntBoards";

/* The hunt's own database.
 *
 * MySQL on the same cPanel account that already runs WordPress — the server
 * is there, it is backed up with the host, and unlike a file on disk it is
 * still correct when Passenger decides to run more than one worker. That
 * last point is the whole reason this is not a JSON file: two people
 * finishing in the same second is exactly the case a file-backed store
 * loses, and it loses it silently.
 *
 * It is *not* the WooCommerce database. Nothing here touches WordPress
 * tables; it is a separate schema with tables of its own, so a WordPress
 * migration or plugin cannot take the leaderboard with it.
 *
 * Not configured is a supported state. Locally, and on a deploy that has not
 * had its credentials added yet, `getPool` returns null and the hunt runs in
 * practice mode: playable, but nothing recorded and no maze withheld. A
 * treasure hunt page that 500s because a database is missing would be worse
 * than one that quietly cannot rank you.
 */

/* Each board's runs, in a table of its own.
 *
 * `hunt_runs` is Launch Day's. It is the table the hunt was built on and it
 * keeps its name, so the board it holds is exactly the one that finished,
 * untouched by the season after it — and a rollback to an older build still
 * finds it where that build expects. A new season is a new table rather than
 * a new column because nothing about starting one should ALTER a table that
 * holds somebody's result, on a host with no shell to repair one from.
 *
 * `fk` is per table because MySQL scopes a constraint name to the whole
 * database, not to its table: a second CREATE naming fk_run_player fails,
 * and a failed statement here is the entire hunt dropping to practice mode.
 *
 * The table names are interpolated into SQL, which is safe only because they
 * come from here by a typed key. A board arriving on a request is checked
 * with isHuntBoardId before it gets near one.
 *
 * Players are not per board. A handle is the visitor's for every season, so
 * there is one hunt_players and every runs table points at it. */
const RUN_TABLES: Record<HuntBoardId, { table: string; fk: string }> = {
  "launch-day": { table: "hunt_runs", fk: "fk_run_player" },
  "pop-up": { table: "hunt_runs_pop_up", fk: "fk_pop_up_run_player" },
};

export function runsTable(board: HuntBoardId): string {
  return RUN_TABLES[board].table;
}

const DDL = [
  /* Names are issued by the server from a fixed pool, so UNIQUE is what
   * makes "you are SILENT ORACLE" true rather than approximate — two people
   * sharing a name on a public board is the one thing that would make it
   * meaningless. */
  `CREATE TABLE IF NOT EXISTS hunt_players (
     id          CHAR(32)     NOT NULL,
     name        VARCHAR(32)  NOT NULL,
     created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_name (name)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  /* UNIQUE (player_id, seed_index) is doing two jobs at once, and both of
   * them are requirements rather than niceties: it is what stops a maze
   * being run twice, and it is what keeps one person from filling a board
   * with their own attempts. Enforced here rather than in the route,
   * because two requests racing each other pass an application-level check
   * and still lose to the index.
   *
   * Per table, so per board: having run a maze on Launch Day does not stop
   * anyone running it on Pop Up, which is the whole of starting a season. */
  ...Object.values(RUN_TABLES).map(
    ({ table, fk }) => `CREATE TABLE IF NOT EXISTS ${table} (
     id          BIGINT       NOT NULL AUTO_INCREMENT,
     player_id   CHAR(32)     NOT NULL,
     seed_index  TINYINT      NOT NULL,
     ms          INT UNSIGNED NOT NULL,
     created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (id),
     UNIQUE KEY uniq_player_maze (player_id, seed_index),
     KEY idx_board (seed_index, ms),
     CONSTRAINT ${fk} FOREIGN KEY (player_id)
       REFERENCES hunt_players (id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ),
];

let pool: mysql.Pool | null = null;
let ready: Promise<mysql.Pool | null> | null = null;

function configured() {
  return Boolean(
    process.env.HUNT_DB_HOST &&
      process.env.HUNT_DB_USER &&
      process.env.HUNT_DB_NAME,
  );
}

/** The pool, or null when the hunt has no database configured.
 *
 * The schema is created on first use rather than by a migration step. There
 * is no migration runner on this host and no shell to run one from — the
 * deploy is an archive upload and a restart — so the alternative is a SQL
 * file someone has to remember to paste into phpMyAdmin exactly once. */
export function getHuntPool(): Promise<mysql.Pool | null> {
  if (ready) return ready;

  ready = (async () => {
    if (!configured()) return null;
    try {
      pool = mysql.createPool({
        host: process.env.HUNT_DB_HOST,
        port: Number(process.env.HUNT_DB_PORT ?? 3306),
        user: process.env.HUNT_DB_USER,
        password: process.env.HUNT_DB_PASSWORD ?? "",
        database: process.env.HUNT_DB_NAME,
        waitForConnections: true,
        // Shared hosting caps concurrent connections per user, and
        // WordPress is already using some of them.
        connectionLimit: 4,
        charset: "utf8mb4_general_ci",
      });
      for (const statement of DDL) await pool.query(statement);
      await ensureNameIndex(pool);
      return pool;
    } catch (err) {
      console.error(
        "hunt: database unavailable, falling back to practice mode:",
        err instanceof Error ? err.message : err,
      );
      pool = null;
      return null;
    }
  })();

  return ready;
}

/* CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
 * a schema added after the first deploy would never appear. MySQL has no
 * CREATE INDEX IF NOT EXISTS, hence the information_schema lookup. */
async function ensureNameIndex(p: mysql.Pool) {
  const [rows] = await p.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'hunt_players'
        AND INDEX_NAME = 'uniq_name'`,
  );
  if (Number(rows[0]?.n ?? 0) > 0) return;
  try {
    await p.query(`ALTER TABLE hunt_players ADD UNIQUE KEY uniq_name (name)`);
  } catch (err) {
    // Duplicate names already stored: leave the index off rather than
    // failing every request, and say so loudly enough to be fixed by hand.
    console.error(
      "hunt: could not add the unique name index:",
      err instanceof Error ? err.message : err,
    );
  }
}

