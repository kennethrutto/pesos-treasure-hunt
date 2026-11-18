import { hash32 } from "@/lib/hash32";

/* Handles are issued, not typed.
 *
 * Nobody picks their own name at the gate of the garden — you are given one
 * on the way in and it is yours from then on. That is partly the pleasure of
 * it, and partly the reason there is no profanity filter, no impersonation
 * and no empty-string edge case on a public leaderboard: the only names that
 * can ever appear are the ones in these two lists.
 *
 * The cadence is borrowed from the old nickname generators — one descriptor,
 * one role, both shouted. The words themselves are ours; nothing here is
 * lifted from anyone else's list.
 *
 * ── Derived, not drawn ──────────────────────────────────────────────────
 * A name is a pure function of the player id. The generators this imitates
 * work the same way: the same input always gives back the same name, which
 * is what makes it feel like a thing you *are* rather than a thing you were
 * dealt. Three consequences, all of them useful:
 *
 *   - Your name can be computed without reading the database, so the hunt
 *     can greet you by name even in practice mode.
 *   - It survives a wiped leaderboard. Clear hunt_players and everyone
 *     comes back as who they were.
 *   - There is nothing to store to *know* it. The table records it only so
 *     the unique index can arbitrate the rare collision.
 *
 * Pure and list-driven so the pool can be counted and tested, and so a word
 * that reads badly next to another can simply be deleted.
 */

const DESCRIPTORS = [
  // Metals and stone — Iron Lung, Golden Arms, Stonefingers, Bobby Steels.
  "IRON", "GOLDEN", "OBSIDIAN", "CHROME", "GRANITE", "PLATINUM", "BRONZE",
  "MARBLE", "STEEL", "COBALT", "LEADEN", "RAZOR",
  // Stealth — the half of the register that does the work over a dark maze.
  "MIDNIGHT", "SHADOW", "PHANTOM", "SILENT", "HOLLOW", "SMOKING", "VEILED",
  "UNSEEN", "CREEPING", "SUNKEN",
  // Menace, stated plainly.
  "RUTHLESS", "LETHAL", "SAVAGE", "VICIOUS", "MERCILESS", "RELENTLESS",
  "FEARLESS", "RECKLESS", "LAWLESS", "GODLESS", "WICKED", "FERAL",
  // Rank and divinity — Sun God, Universal God, Ruler Zig-Zag-Zig Allah.
  "SUPREME", "IMPERIAL", "SOVEREIGN", "ETERNAL", "IMMORTAL", "DIVINE",
  "ANOINTED", "EXALTED", "NOBLE",
  // Weather and heat.
  "THUNDER", "TEMPEST", "SCORCHED", "FROZEN", "BLAZING", "GLACIAL",
  // Blood and dark colour.
  "CRIMSON", "SCARLET", "EBONY", "ASHEN", "SABLE", "BLACKENED",
  // Temperament — the still ones read as the most dangerous.
  "PATIENT", "SOLEMN", "RESTLESS", "BITTER", "LUCID", "VAGRANT",
  // Cosmic.
  "ATOMIC", "COSMIC", "ASTRAL", "SOLAR", "LUNAR", "VOID",
] as const;

const ROLES = [
  // The plainly lethal.
  "ASSASSIN", "EXECUTIONER", "ENFORCER", "DESTROYER", "CONQUEROR",
  "DOMINATOR", "MENACE", "MARAUDER", "PREDATOR", "REAPER",
  // Outlaws.
  "RENEGADE", "OUTLAW", "DESPERADO", "BANDIT", "MERCENARY", "SMUGGLER",
  "CORSAIR", "BRIGAND",
  // Kung fu and the temple — Shaolin, The Abbott, High Chief.
  "ABBOT", "MONK", "DISCIPLE", "SENSEI", "SHOGUN", "SAMURAI", "RONIN",
  "WARLORD", "MASTA", "SIFU",
  // The occult — Wizard, Warlock, Prophet all sit in this tradition.
  "ORACLE", "PROPHET", "MYSTIC", "WARLOCK", "SORCERER", "ALCHEMIST",
  "DIVINER", "SEER",
  // Professions made menacing — The Chef, The Architect, The Scientist.
  "ARCHITECT", "SURGEON", "CHEMIST", "SPECIALIST", "MECHANIC", "ENGINEER",
  "CHEF", "SCRIBE",
  // Authority.
  "SENTINEL", "WARDEN", "INSPECTOR", "MAGISTRATE", "TRIBUNE", "MARSHAL",
  // The dead.
  "SPECTRE", "REVENANT", "WRAITH", "SHADE", "HAUNT",
  // Thrones — Corleone, Lex Diamonds, the mafia-and-monarchy half.
  "MONARCH", "EMPEROR", "PHARAOH", "SULTAN", "KHAN", "BARON", "DUKE",
  "CONSUL",
  // Animals that hunt.
  "MAMBA", "VIPER", "PANTHER", "JACKAL", "FALCON", "SCORPION", "RAVEN",
  // Mind — The Genius, Mastermind, The Scientist.
  "MASTERMIND", "STRATEGIST", "TACTICIAN", "GENIUS",
] as const;

/** The name belonging to a player id.
 *
 * The two words are hashed under different prefixes rather than sliced out
 * of one number: 52 and 42 share a factor, so deriving both from a single
 * hash visibly correlates them and some pairings would never appear.
 *
 * `variant` walks to the next candidate when a name is already taken. It is
 * part of the input, so the resulting name is just as stable as the first
 * choice was. */
export function nameFor(playerId: string, variant = 0): string {
  const d = DESCRIPTORS[hash32(`d${variant}:${playerId}`) % DESCRIPTORS.length];
  const r = ROLES[hash32(`r${variant}:${playerId}`) % ROLES.length];
  return `${d} ${r}`;
}

/** This player's name, stepped along until it is one nobody else holds.
 *
 * `taken` is asked rather than the whole table being read, so this stays one
 * indexed lookup per attempt. After enough collisions it stops walking and
 * appends a number — the pool is large, but an endless retry loop is not a
 * thing to leave in a request path. */
export async function assignName(
  playerId: string,
  taken: (name: string) => Promise<boolean>,
): Promise<string> {
  for (let variant = 0; variant < 12; variant++) {
    const candidate = nameFor(playerId, variant);
    if (!(await taken(candidate))) return candidate;
  }
  const base = nameFor(playerId, 0);
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base} ${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  // Vanishingly unlikely; a name is still better than an error.
  return `${base} ${Date.now().toString(36).toUpperCase().slice(-4)}`;
}
