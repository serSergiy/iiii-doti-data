//go:build discover5

package main

// Discovery pass 5 — entity level, because the combat log is exhausted.
//
// Pass 4 established that the combat log only ever records CONSUMPTION (famango ITEM/HEAL)
// and the CAST of a lamp (ability_lamp_use -> npc_dota_lantern), never acquisition or
// channel completion. Both remaining stats therefore have to come from entity state:
//
//   LOTUSES  — a famango item entity changing owner into a player's inventory.
//   WATCHERS — a lantern entity flipping team, which is what a COMPLETED capture does.
//              (Clicks are already counted; the client's number is lower, so interrupted
//              channels must not count.)
//
// This dumps the classes and the fields available on each, so the tracking can be written
// against what actually exists rather than a guess.

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/dotabuff/manta"
	"github.com/klauspost/compress/zstd"
)

func main() {
	f, _ := os.Open(os.Args[1])
	defer f.Close()
	dec, _ := zstd.NewReader(f)
	defer dec.Close()
	p, _ := manta.NewStreamParser(dec)

	classes := map[string]int{}
	fields := map[string]map[string]string{} // class -> field -> sample
	ownerChanges := map[string]int{}

	interesting := func(cn string) bool {
		l := strings.ToLower(cn)
		return strings.Contains(l, "famango") || strings.Contains(l, "lantern") ||
			strings.Contains(l, "lotus") || strings.Contains(l, "watcher") ||
			strings.Contains(l, "outpost")
	}

	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		cn := e.GetClassName()
		if !interesting(cn) {
			return nil
		}
		classes[cn]++
		if fields[cn] == nil {
			fields[cn] = map[string]string{}
			for k, v := range e.Map() {
				fields[cn][k] = fmt.Sprintf("%v", v)
			}
		}
		if op&manta.EntityOpUpdated != 0 {
			// Owner/team transitions are the acquisition + capture signals.
			for _, key := range []string{"m_hOwnerEntity", "m_iTeamNum", "m_hOwner", "m_iCurrentCharges"} {
				if v := e.Get(key); v != nil {
					ownerChanges[cn+"."+key+"="+fmt.Sprintf("%v", v)]++
				}
			}
		}
		return nil
	})

	if err := p.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "parse error:", err)
	}

	fmt.Println("=== matching entity classes (times seen) ===")
	var cs []string
	for k := range classes {
		cs = append(cs, k)
	}
	sort.Strings(cs)
	for _, c := range cs {
		fmt.Printf("  %-46s %d\n", c, classes[c])
	}

	fmt.Println("\n=== fields available per class ===")
	for _, c := range cs {
		fmt.Printf("  %s\n", c)
		var ks []string
		for k := range fields[c] {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		for _, k := range ks {
			fmt.Printf("      %-44s = %s\n", k, fields[c][k])
		}
	}

	fmt.Println("\n=== observed owner/team/charge values on updates (top 25) ===")
	type kv struct {
		k string
		n int
	}
	var all []kv
	for k, n := range ownerChanges {
		all = append(all, kv{k, n})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].n > all[j].n })
	for i, e := range all {
		if i >= 25 {
			break
		}
		fmt.Printf("  [%5d] %s\n", e.n, e.k)
	}
}
