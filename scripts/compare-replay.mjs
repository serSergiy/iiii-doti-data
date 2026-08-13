#!/usr/bin/env node
/**
 * Cross-check replay-derived stats against OpenDota for the same matches.
 *
 * The point is calibration: OpenDota's item_uses.madstone_bundle is only a *candidate* for
 * Безумруди. If the replay's own count of item_madstone_bundle events agrees with it
 * exactly, the two are measuring the same thing and the remaining question is just whether
 * that thing is the fantasy stat. If they disagree, one of them is wrong and we know which
 * to distrust.
 *
 * Also reports watchers vs lamps, which no API separates.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPLAY = path.join(ROOT, 'data', 'replay');
const RAW = path.join(ROOT, 'data', 'raw');

// hero_id -> npc_dota_hero_* name, from OpenDota constants (cached).
const cacheFile = path.join(ROOT, 'config', 'heroes.json');
let heroes;
if (fs.existsSync(cacheFile)) {
  heroes = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
} else {
  const r = await fetch('https://api.opendota.com/api/constants/heroes', {
    headers: { 'User-Agent': 'ti2026-fantasy-data/0.1' },
  });
  const data = await r.json();
  heroes = Object.fromEntries(Object.values(data).map((h) => [h.id, h.name]));
  fs.writeFileSync(cacheFile, JSON.stringify(heroes, null, 1));
  console.log(`cached ${Object.keys(heroes).length} hero names -> config/heroes.json\n`);
}

const files = fs.readdirSync(REPLAY).filter((f) => f.endsWith('.json'));
if (!files.length) { console.log('no parsed replays yet'); process.exit(0); }

let agree = 0, disagree = 0, players = 0;
const diffs = [];
let totalWatchers = 0, totalLamps = 0;

for (const f of files) {
  const id = f.replace('.json', '');
  const rep = JSON.parse(fs.readFileSync(path.join(REPLAY, f), 'utf8'));
  const rawFile = path.join(RAW, `${id}.json.gz`);
  if (!fs.existsSync(rawFile)) continue;
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(rawFile)).toString());

  for (const p of raw.players ?? []) {
    const name = heroes[p.hero_id];
    const rs = rep.heroes?.[name];
    if (!rs) continue;
    players++;
    totalWatchers += rs.watchers;
    totalLamps += rs.lamps;

    const od = (p.item_uses || {}).madstone_bundle || 0;
    if (od === rs.madstones) agree++;
    else {
      disagree++;
      diffs.push(`${id} ${String(p.name || p.personaname).padEnd(14)} ${name.replace('npc_dota_hero_', '').padEnd(16)} opendota=${String(od).padEnd(4)} replay=${rs.madstones}`);
    }
  }
}

console.log('=== madstone_bundle: OpenDota item_uses vs replay combat log ===');
console.log(`  matched player-maps: ${players}`);
console.log(`  agree: ${agree}   disagree: ${disagree}`);
if (diffs.length) {
  console.log('\n  disagreements (first 20):');
  for (const d of diffs.slice(0, 20)) console.log('   ', d);
}

console.log('\n=== watchers vs lamps (no API separates these) ===');
console.log(`  ability_capture  (watchers): ${totalWatchers}`);
console.log(`  ability_lamp_use (lamps):    ${totalLamps}`);
console.log(`  ratio lamps/watchers: ${totalWatchers ? (totalLamps / totalWatchers).toFixed(1) : 'n/a'}`);
console.log(`  a source that conflates them would overstate watchers by ${totalWatchers ? ((totalWatchers + totalLamps) / totalWatchers).toFixed(1) : '?'}x`);
