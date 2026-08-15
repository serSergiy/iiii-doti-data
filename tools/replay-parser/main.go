//go:build !discover && !discover2 && !discover3 && !discover4 && !discover5

package main

// Production replay parser. Extracts the stats no API exposes, per hero, as JSON.
//
// Recovered here (see docs/FINDINGS.md for the discovery trail):
//   watchers   ability_capture      — the real "watchers taken". APIs conflate this with
//                                     lamps; the replay keeps them separate.
//   lamps      ability_lamp_use     — emitted so the conflation is measurable, not guessed.
//   madstones  item_madstone_bundle — per-hero, to validate OpenDota's item_uses count.
//   tormentor  npc_dota_miniboss deaths — both the last hitter AND every hero who damaged
//                                     it, because the spec says the game credits all
//                                     participants and the combat log's assist list is
//                                     empty for miniboss kills.
//
// NOT recovered: lotus pickups. They appear nowhere in the combat log — the only lotus
// strings are item_lotus_orb (an unrelated item). They would need entity-level work on
// CDOTA_BaseNPC_LotusPool.
//
// Attribution note: use attacker_name, NOT damage_source_name. The latter is only
// meaningful for damage events and resolves to dota_unknown for ability casts, which is
// what made the first discovery pass look like attribution was impossible.

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"github.com/klauspost/compress/zstd"
)

type heroStats struct {
	Watchers            int `json:"watchers"`
	Lamps               int `json:"lamps"`
	Madstones           int `json:"madstones"`
	TormentorKills      int `json:"tormentorKills"`
	TormentorDamageSeen int `json:"tormentorParticipation"` // damaged a tormentor that later died
}

type output struct {
	MatchID       string                `json:"matchId"`
	ParserVersion int                   `json:"parserVersion"`
	Entities      *entityStats          `json:"entities"`
	// The game's own per-player counters. Authoritative — supersedes every heuristic here.
	GameStats map[int]*gameStat `json:"gameStats"`
	Heroes        map[string]*heroStats `json:"heroes"`
	TormentorLog  []tormentorEvent      `json:"tormentorLog"`
	Notes         map[string]string     `json:"notes"`
}

type tormentorEvent struct {
	Time      int      `json:"time"`
	Killer    string   `json:"killer"`
	Damagers  []string `json:"damagers"`
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: parse <replay.dem.bz2> [out.json]")
		os.Exit(2)
	}
	in := os.Args[1]
	out := ""
	if len(os.Args) > 2 {
		out = os.Args[2]
	}

	f, err := os.Open(in)
	must(err)
	defer f.Close()
	dec, err := zstd.NewReader(f)
	must(err)
	defer dec.Close()
	p, err := manta.NewStreamParser(dec)
	must(err)

	look := func(i uint32) string {
		s, _ := p.LookupStringByIndex("CombatLogNames", int32(i))
		return s
	}
	isHero := func(s string) bool { return strings.HasPrefix(s, "npc_dota_hero_") }

	heroes := map[string]*heroStats{}
	get := func(h string) *heroStats {
		if heroes[h] == nil {
			heroes[h] = &heroStats{}
		}
		return heroes[h]
	}

	ents := trackEntities(p)
	gs := trackGameStats(p)

	// Heroes that have damaged the currently-alive tormentor. Reset on each death, so a
	// second tormentor does not inherit the first one's damage list.
	pending := map[string]bool{}
	var log []tormentorEvent

	p.Callbacks.OnCMsgDOTACombatLogEntry(func(m *dota.CMsgDOTACombatLogEntry) error {
		t := m.GetType().String()
		attacker := look(m.GetAttackerName())
		target := look(m.GetTargetName())
		inflictor := look(m.GetInflictorName())

		if !isHero(attacker) && t != "DOTA_COMBATLOG_DEATH" {
			return nil
		}

		switch {
		case inflictor == "ability_capture":
			get(attacker).Watchers++
		case inflictor == "ability_lamp_use":
			get(attacker).Lamps++
		case inflictor == "item_madstone_bundle" && t == "DOTA_COMBATLOG_ITEM":
			get(attacker).Madstones++
		}

		if target == "npc_dota_miniboss" {
			if t == "DOTA_COMBATLOG_DAMAGE" && isHero(attacker) {
				pending[attacker] = true
			}
			if t == "DOTA_COMBATLOG_DEATH" {
				var damagers []string
				for h := range pending {
					get(h).TormentorDamageSeen++
					damagers = append(damagers, h)
				}
				if isHero(attacker) {
					get(attacker).TormentorKills++
				}
				log = append(log, tormentorEvent{
					Time: int(m.GetTimestamp()), Killer: attacker, Damagers: damagers,
				})
				pending = map[string]bool{}
			}
		}
		return nil
	})

	if err := p.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "parse error (partial results kept):", err)
	}
	ents.finish()

	base := filepath.Base(in)
	matchID := strings.SplitN(strings.TrimSuffix(base, ".dem.bz2"), "_", 2)[0]

	res := output{
		MatchID:       matchID,
		ParserVersion: 3,
		Entities:      ents,
		GameStats:     gs,
		Heroes:        heroes,
		TormentorLog:  log,
		Notes: map[string]string{
			"lotus":     "NOT RECOVERABLE from the combat log — no lotus pickup events exist. Needs entity-level work on CDOTA_BaseNPC_LotusPool.",
			"watchers":  "ability_capture. Distinct from ability_lamp_use, which is what the open APIs conflate it with.",
			"tormentor": "tormentorKills = last hitter. tormentorParticipation = damaged a tormentor that then died; the combat log's assist list is empty for these, so participation is derived from damage.",
		},
	}

	b, err := json.MarshalIndent(res, "", " ")
	must(err)
	if out == "" {
		fmt.Println(string(b))
	} else {
		must(os.WriteFile(out, b, 0o644))
		fmt.Printf("%s -> %s (%d heroes)\n", base, filepath.Base(out), len(heroes))
	}
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}
