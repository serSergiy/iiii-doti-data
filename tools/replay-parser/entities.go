//go:build !discover && !discover2 && !discover3 && !discover4 && !discover5

package main

// Entity-level extraction for the two stats the combat log cannot provide.
//
// LOTUSES — INCOMPLETE, per-player attribution does not work yet.
//
// The combat log only records famangos being EATEN (ITEM/HEAL), and purchase_log only
// records the MERGED results, so neither counts what was collected. Every famango does
// exist as an entity, and counting the SMALL tier avoids double-counting merges (three
// smalls are destroyed to create a Great).
//
// But the owner cannot be read off the item. Measured over one match: m_iPlayerOwnerID is
// the CONSTANT 1 on 265 of 269 famango entities, and m_hOwnerEntity / m_nOwnerId / m_hOwner
// are nil on all 269. Only m_iTeamNum varies (2 radiant / 3 dire / 4 unassigned). So the
// entity knows its side but not its player.
//
// Correct route, not yet built: track each hero entity's inventory (m_hItems[0..N]) and
// credit the hero whose inventory a famango handle first appears in. Team-level totals are
// available now; per-player is not.
//
// WATCHERS — the click/completion distinction is confirmed, the completion signal is not.
//
// ability_lamp_use targets npc_dota_lantern and fires on the CLICK; the watcher is not taken
// until the channel finishes, which is why clicks (20.5 on the pinned maps) exceed the
// client's number (16.5). Separately confirmed: ability_capture targets
// #DOTA_OutpostName_North, so it is OUTPOSTS and not watchers at all.
//
// The hoped-for completion signal was CDOTA_NPC_Lantern flipping m_iTeamNum away from the
// neutral 5. It never fired in a full match, so either lanterns do not change team on
// capture or the state lives elsewhere. Unresolved.

import (
	"fmt"
	"strings"

	"github.com/dotabuff/manta"
)

type entityStats struct {
	// Lotus pickups per hero, by tier. Credited from the HERO's inventory, which is the
	// only place the picker is recoverable — see the note above.
	LotusByHero map[string]map[string]int `json:"lotusByHero"`
	LotusTotal  int                       `json:"lotusEntitiesCredited"`
	LotusSeen   int                       `json:"lotusEntitiesSeen"`
	// Madstone bundles credited to the hero whose inventory they FIRST entered,
	// plus the charges those bundles carried.
	MadstoneByHero        map[string]int `json:"madstoneBundlesByHero"`
	MadstoneChargesByHero map[string]int `json:"madstoneChargesByHero"`
	// Every +1 of charge on a bundle is one madstone COLLECTED. Credited to whichever
	// hero was holding that bundle at the time, which is the literal reading of
	// "за зібраний лютит".
	MadstoneGainedByHero map[string]int `json:"madstoneGainedByHero"`

	finish func() `json:"-"`
}

var famangoClass = map[string]string{
	"CDOTA_Item_Famango":        "small",
	"CDOTA_Item_GreatFamango":   "great",
	"CDOTA_Item_GreaterFamango": "greater",
}

// Madstone bundles. item_uses counts the USE, but the official stat is "за зібраний
// лютит" — per madstone COLLECTED. A bundle can be handed to an ally, so the user is not
// necessarily the collector. Crediting the FIRST inventory an entity enters gives the
// collector, which is what the stat asks for.
const madstoneClass = "CDOTA_Item_MadstoneBundle"

// trackEntities wires the entity callbacks and returns the accumulating stats.
func trackEntities(p *manta.Parser) *entityStats {
	st := &entityStats{
		LotusByHero:           map[string]map[string]int{},
		MadstoneByHero:        map[string]int{},
		MadstoneChargesByHero: map[string]int{},
		MadstoneGainedByHero:  map[string]int{},
	}

	famTier := map[int32]string{} // famango entity index -> tier
	madIdx := map[int32]int{}     // madstone bundle entity index -> last charge count seen
	madOwner := map[int32]string{} // bundle entity index -> hero currently holding it
	credited := map[int32]bool{}  // credited exactly once, to the first inventory it enters

	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		cn := e.GetClassName()
		if t, ok := famangoClass[cn]; ok {
			famTier[e.GetIndex()] = t
			return nil
		}
		if cn == madstoneClass {
			idx := e.GetIndex()
			ch := -1
			if v := e.Get("m_iCurrentCharges"); v != nil {
				switch n := v.(type) {
				case int32:
					ch = int(n)
				case uint32:
					ch = int(n)
				}
			}
			if ch < 0 {
				return nil
			}
			prev, seen := madIdx[idx]
			if seen && ch > prev {
				// charges only ever rise by collection; a use lowers them.
				if h := madOwner[idx]; h != "" {
					st.MadstoneGainedByHero[h] += ch - prev
				}
			} else if !seen && ch > 0 {
				if h := madOwner[idx]; h != "" {
					st.MadstoneGainedByHero[h] += ch
				}
			}
			madIdx[idx] = ch
			return nil
		}
		if !strings.HasPrefix(cn, "CDOTA_Unit_Hero_") {
			return nil
		}
		hero := strings.TrimPrefix(cn, "CDOTA_Unit_Hero_")
		// 6 inventory + 3 backpack + stash + neutral; scan generously.
		for i := 0; i < 19; i++ {
			v := e.Get(fmt.Sprintf("m_hItems.%04d", i))
			if v == nil {
				continue
			}
			var h uint32
			switch n := v.(type) {
			case uint32:
				h = n
			case int32:
				h = uint32(n)
			default:
				continue
			}
			if h == 0 || h == 0xFFFFFF {
				continue
			}
			// A Source 2 handle carries the entity index in its low 14 bits.
			idx := int32(h & 0x3FFF)
			if ch, isMad := madIdx[idx]; isMad {
				madOwner[idx] = hero // keep current holder for charge attribution
				if !credited[idx] {
					credited[idx] = true
					st.MadstoneByHero[hero]++
					if ch < 1 {
						ch = 1
					}
					st.MadstoneChargesByHero[hero] += ch
					st.MadstoneGainedByHero[hero] += ch
				}
				continue
			}
			tier, isFam := famTier[idx]
			if !isFam || credited[idx] {
				continue
			}
			credited[idx] = true
			if st.LotusByHero[hero] == nil {
				st.LotusByHero[hero] = map[string]int{}
			}
			st.LotusByHero[hero][tier]++
		}
		return nil
	})
	// Counts are finalised by the caller after Start(); expose the maps for that.
	st.finish = func() {
		st.LotusSeen = len(famTier)
		st.LotusTotal = len(credited)
	}
	return st
}
