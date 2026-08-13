import fs from 'node:fs';

/**
 * Write JSON only if the content actually changed, ignoring `generatedAt`.
 *
 * Without this, the timestamp alone makes every file differ on every run, so a 15-minute
 * cron commits ~96 times a day with no data change. That destroys the one thing this
 * storage design buys: a `git log -p` where every entry is a real change you can point at
 * when the engine disagrees with an in-client score.
 *
 * @returns {boolean} true if the file was written
 */
export function writeIfChanged(file, obj, pretty = false) {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* absent or corrupt */ }

  if (prev) {
    const a = JSON.stringify({ ...prev, generatedAt: null });
    const b = JSON.stringify({ ...obj, generatedAt: null });
    if (a === b) return false; // identical but for the clock — leave the file alone
  }
  fs.writeFileSync(file, pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj));
  return true;
}
