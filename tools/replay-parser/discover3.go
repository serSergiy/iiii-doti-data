//go:build discover3

package main

// Discovery pass 3 — targeted.
//
// Pass 2 turned up `ability_capture` and `ability_lamp_use` as distinct combat-log
// abilities, alongside npc_dota_lantern. That is precisely the distinction battlepass.ru
// reported the open APIs get wrong ("watchers conflated with lamp presses, overstated
// ~1.5x") — the game separates them, the APIs do not. If capture events carry a hero
// attribution, the watcher stat is recoverable exactly.
//
// This dumps every event for the four unresolved stats, with attribution, so each mapping
// can be decided on evidence rather than inference.

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"github.com/klauspost/compress/zstd"
)

var probes = []string{"capture", "lamp", "lantern", "lotus", "madstone", "miniboss"}

func interesting(s string) bool {
	l := strings.ToLower(s)
	for _, k := range probes {
		if strings.Contains(l, k) {
			return true
		}
	}
	return false
}

func main() {
	f, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer f.Close()
	dec, err := zstd.NewReader(f)
	if err != nil {
		panic(err)
	}
	defer dec.Close()
	p, err := manta.NewStreamParser(dec)
	if err != nil {
		panic(err)
	}

	look := func(i uint32) string {
		s, _ := p.LookupStringByIndex("CombatLogNames", int32(i))
		return s
	}

	byAbility := map[string]map[string]int{} // ability -> attacker -> count
	itemNames := map[string]bool{}
	minibossDeaths := []string{}

	p.Callbacks.OnCMsgDOTACombatLogEntry(func(m *dota.CMsgDOTACombatLogEntry) error {
		t := m.GetType().String()
		// attacker_name is the acting unit. damage_source_name is only meaningful for
		// damage events — using it for ability casts is why pass 3 first showed
		// dota_unknown for every capture / lamp / madstone event.
		attacker := look(m.GetAttackerName())
		if attacker == "" || attacker == "dota_unknown" {
			if alt := look(m.GetDamageSourceName()); alt != "" && alt != "dota_unknown" {
				attacker = alt
			}
		}
		target := look(m.GetTargetName())
		inflictor := look(m.GetInflictorName())

		if t == "DOTA_COMBATLOG_PURCHASE" || t == "DOTA_COMBATLOG_ITEM" {
			if inflictor != "" {
				itemNames[inflictor] = true
			}
		}

		if interesting(inflictor) || interesting(target) || interesting(attacker) {
			key := inflictor
			if key == "" {
				key = t + "/" + target
			}
			if byAbility[key] == nil {
				byAbility[key] = map[string]int{}
			}
			who := attacker
			if who == "" {
				who = "(none)"
			}
			byAbility[key][who]++
		}

		if t == "DOTA_COMBATLOG_DEATH" && target == "npc_dota_miniboss" {
			// AssistPlayers is the direct evidence for the spec's open question of whether
			// the game credits all participants or only the last hitter.
			minibossDeaths = append(minibossDeaths,
				fmt.Sprintf("t=%.0f killer=%-28s assists=%v",
					m.GetTimestamp(), attacker, m.GetAssistPlayers()))
		}
		return nil
	})

	if err := p.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "parse error:", err)
	}

	fmt.Println("=== events for the unresolved stats, by ability -> who ===")
	var keys []string
	for k := range byAbility {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !interesting(k) {
			continue
		}
		total := 0
		for _, n := range byAbility[k] {
			total += n
		}
		fmt.Printf("\n  %s  (%d events)\n", k, total)
		var who []string
		for w := range byAbility[k] {
			who = append(who, w)
		}
		sort.Slice(who, func(i, j int) bool { return byAbility[k][who[i]] > byAbility[k][who[j]] })
		for i, w := range who {
			if i >= 12 {
				break
			}
			fmt.Printf("      %-34s %d\n", w, byAbility[k][w])
		}
	}

	fmt.Println("\n=== miniboss (tormentor) deaths ===")
	for _, d := range minibossDeaths {
		fmt.Println("  ", d)
	}

	fmt.Println("\n=== all item names seen in PURCHASE/ITEM events (lotus hunt) ===")
	var its []string
	for k := range itemNames {
		its = append(its, k)
	}
	sort.Strings(its)
	fmt.Println("  " + strings.Join(its, "\n  "))
}
