//go:build discover

package main

// Discovery pass. Answers "where in the replay do lotus / watcher / madstone / tormentor
// live?" before we commit to a parsing strategy — none of them is a documented field, and
// guessing wrong costs a full re-parse of every replay.
//
// Dumps three things, keyword-filtered:
//   1. the CombatLogNames string table  (entity/ability names the combat log references)
//   2. every distinct entity class name
//   3. every distinct entity FIELD name  (this is where per-player counters live)
//
// Run: docker compose equivalent in scripts/parse-replays.sh, or
//   go run -tags discover . <replay.dem.bz2>

import (
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/dotabuff/manta"
	"github.com/klauspost/compress/zstd"
)

var keywords = []string{"lotus", "watcher", "madstone", "miniboss", "tormentor", "outpost", "gem", "bounty", "roshan", "twin"}

func matches(s string) bool {
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
		fmt.Fprintln(os.Stderr, "usage: discover <replay.dem.bz2>")
		os.Exit(2)
	}
	f, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer f.Close()

	// Despite the .dem.bz2 name Valve still serves, the payload is zstd — magic bytes
	// 28 b5 2f, and PBDEMS2 once decompressed. bzip2 fails with "bad magic value".
	dec, err := zstd.NewReader(f)
	if err != nil {
		panic(err)
	}
	defer dec.Close()

	p, err := manta.NewStreamParser(dec)
	if err != nil {
		panic(err)
	}

	classes := map[string]int{}
	fields := map[string]string{} // field name -> example value
	hits := map[string]bool{}

	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		cn := e.GetClassName()
		classes[cn]++
		if matches(cn) {
			hits["CLASS "+cn] = true
		}
		// Field names are stable per class; sampling creation events is enough and keeps
		// this from being O(every delta in the match).
		if op&manta.EntityOpCreated != 0 {
			for k, v := range e.Map() {
				if matches(k) {
					fields[cn+"."+k] = fmt.Sprintf("%v", v)
				}
			}
		}
		return nil
	})

	if err := p.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "parse error:", err)
	}

	fmt.Println("=== entity classes matching keywords ===")
	var ks []string
	for k := range hits {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	for _, k := range ks {
		fmt.Println(" ", k)
	}

	fmt.Println("\n=== entity FIELDS matching keywords ===")
	ks = ks[:0]
	for k := range fields {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	for _, k := range ks {
		fmt.Printf("  %-70s = %s\n", k, fields[k])
	}

	fmt.Println("\n=== all entity classes seen (count) ===")
	type kv struct {
		k string
		n int
	}
	var all []kv
	for k, n := range classes {
		all = append(all, kv{k, n})
	}
	sort.Slice(all, func(i, j int) bool { return all[i].n > all[j].n })
	for i, e := range all {
		if i >= 60 {
			fmt.Printf("  ... and %d more classes\n", len(all)-60)
			break
		}
		fmt.Printf("  %-60s %d\n", e.k, e.n)
	}
}
