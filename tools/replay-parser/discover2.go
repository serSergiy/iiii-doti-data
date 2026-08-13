//go:build discover2

package main

// Discovery pass 2 — the combat log.
//
// Pass 1 found lotus/madstone/tormentor entity CLASSES but no per-player counters, and no
// watcher entity at all. So these stats are events, not fields. The combat log is where
// Dota records "player X picked up Y" / "player X killed Y", and it is the only place a
// per-player attribution can come from.
//
// Dumps: every distinct combat log type with counts, plus every distinct name string the
// log references, keyword-filtered. Also writes the full class + name lists to /w/tmp so
// nothing is lost to terminal truncation.

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
	"github.com/klauspost/compress/zstd"
)

var keywords = []string{"lotus", "watcher", "madstone", "miniboss", "tormentor", "outpost", "twin", "gate"}

func hit(s string) bool {
	l := strings.ToLower(s)
	for _, k := range keywords {
		if strings.Contains(l, k) {
			return true
		}
	}
	return false
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: discover2 <replay.dem.bz2>")
		os.Exit(2)
	}
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

	types := map[string]int{}
	names := map[string]bool{}
	interesting := map[string]int{} // "TYPE | attacker | target | inflictor" -> count
	allNames := map[string]bool{}

	look := func(i uint32) string {
		s, ok := p.LookupStringByIndex("CombatLogNames", int32(i))
		if !ok {
			return ""
		}
		return s
	}

	p.Callbacks.OnCMsgDOTACombatLogEntry(func(m *dota.CMsgDOTACombatLogEntry) error {
		t := m.GetType().String()
		types[t]++

		attacker := look(m.GetDamageSourceName())
		target := look(m.GetTargetName())
		inflictor := look(m.GetInflictorName())
		value := m.GetValue()

		for _, n := range []string{attacker, target, inflictor} {
			if n != "" {
				allNames[n] = true
			}
			if n != "" && hit(n) {
				names[n] = true
				key := fmt.Sprintf("%-42s a=%-28s t=%-28s i=%-24s v=%d", t, attacker, target, inflictor, value)
				interesting[key]++
			}
		}
		return nil
	})

	if err := p.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "parse error:", err)
	}

	fmt.Println("=== combat log types (count) ===")
	var ts []string
	for k := range types {
		ts = append(ts, k)
	}
	sort.Slice(ts, func(i, j int) bool { return types[ts[i]] > types[ts[j]] })
	for _, k := range ts {
		fmt.Printf("  %-52s %d\n", k, types[k])
	}

	fmt.Println("\n=== names matching keywords ===")
	var ns []string
	for k := range names {
		ns = append(ns, k)
	}
	sort.Strings(ns)
	for _, k := range ns {
		fmt.Println("  ", k)
	}

	fmt.Println("\n=== combat log entries involving those names ===")
	var is []string
	for k := range interesting {
		is = append(is, k)
	}
	sort.Slice(is, func(i, j int) bool { return interesting[is[i]] > interesting[is[j]] })
	for i, k := range is {
		if i >= 45 {
			fmt.Printf("  ... and %d more distinct shapes\n", len(is)-45)
			break
		}
		fmt.Printf("  [%4d] %s\n", interesting[k], k)
	}

	// Full name list to disk — the answer for "watchers" may be a string we did not guess.
	var an []string
	for k := range allNames {
		an = append(an, k)
	}
	sort.Strings(an)
	_ = os.WriteFile("/w/tmp-combatlog-names.txt", []byte(strings.Join(an, "\n")), 0o644)
	fmt.Printf("\nwrote %d distinct combat-log names to tmp-combatlog-names.txt\n", len(an))
}
