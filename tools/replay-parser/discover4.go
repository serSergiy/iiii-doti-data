//go:build discover4

package main

// Discovery pass 4 — two targeted questions.
//
// 1. WATCHERS. `ability_lamp_use` fires on the CLICK; a watcher is not taken until the
//    channel completes. On the pinned maps lamps total 20.5 and the client implies 16.5,
//    so ~4 were interrupted. We need the completion signal, not the cast. Candidates: a
//    modifier applied on success, or a second event type on the same ability.
//
// 2. LOTUSES. item_uses counts what was EATEN and purchase_log only records the MERGED
//    items (3 small -> great, 3 great -> greater), so neither counts what was collected.
//    Dump every event that touches a famango, by type, to find the acquisition signal.
//
// Prints per-hero tallies so the numbers can go straight against the banner targets.

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"github.com/klauspost/compress/zstd"
)

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
	look := func(i uint32) string { s, _ := p.LookupStringByIndex("CombatLogNames", int32(i)); return s }
	isHero := func(s string) bool { return strings.HasPrefix(s, "npc_dota_hero_") }

	// question 1: everything mentioning lamp / lantern / watcher / capture, by (type, inflictor)
	lampShapes := map[string]int{}
	lampByHero := map[string]map[string]int{} // hero -> "type/inflictor" -> n

	// question 2: everything mentioning famango, by (type, inflictor)
	famShapes := map[string]int{}
	famByHero := map[string]map[string]int{}

	add := func(m map[string]map[string]int, hero, key string) {
		if m[hero] == nil {
			m[hero] = map[string]int{}
		}
		m[hero][key]++
	}

	p.Callbacks.OnCMsgDOTACombatLogEntry(func(m *dota.CMsgDOTACombatLogEntry) error {
		t := strings.TrimPrefix(m.GetType().String(), "DOTA_COMBATLOG_")
		attacker := look(m.GetAttackerName())
		target := look(m.GetTargetName())
		inflictor := look(m.GetInflictorName())
		blob := strings.ToLower(attacker + " " + target + " " + inflictor)

		if strings.Contains(blob, "lamp") || strings.Contains(blob, "lantern") ||
			strings.Contains(blob, "watcher") || strings.Contains(blob, "capture") {
			key := fmt.Sprintf("%s | i=%s | t=%s", t, inflictor, target)
			lampShapes[key]++
			if isHero(attacker) {
				add(lampByHero, attacker, t+"/"+inflictor)
			}
		}
		if strings.Contains(blob, "famango") {
			key := fmt.Sprintf("%s | i=%s", t, inflictor)
			famShapes[key]++
			if isHero(attacker) {
				add(famByHero, attacker, t+"/"+inflictor)
			}
		}
		return nil
	})

	if err := p.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "parse error:", err)
	}

	dump := func(title string, shapes map[string]int, byHero map[string]map[string]int) {
		fmt.Printf("\n=== %s ===\n", title)
		var ks []string
		for k := range shapes {
			ks = append(ks, k)
		}
		sort.Slice(ks, func(i, j int) bool { return shapes[ks[i]] > shapes[ks[j]] })
		for _, k := range ks {
			fmt.Printf("  [%4d] %s\n", shapes[k], k)
		}
		fmt.Println("  --- per hero ---")
		var hs []string
		for h := range byHero {
			hs = append(hs, h)
		}
		sort.Strings(hs)
		for _, h := range hs {
			var parts []string
			var kk []string
			for k := range byHero[h] {
				kk = append(kk, k)
			}
			sort.Strings(kk)
			for _, k := range kk {
				parts = append(parts, fmt.Sprintf("%s=%d", k, byHero[h][k]))
			}
			fmt.Printf("    %-30s %s\n", strings.TrimPrefix(h, "npc_dota_hero_"), strings.Join(parts, "  "))
		}
	}

	dump("WATCHER / LAMP events", lampShapes, lampByHero)
	dump("FAMANGO events", famShapes, famByHero)
}
