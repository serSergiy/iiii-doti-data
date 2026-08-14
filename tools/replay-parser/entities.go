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
	"github.com/dotabuff/manta"
)

type entityStats struct {
	// lotuses, by dota player id 0-9
	LotusPickups map[int]int `json:"lotusPickups"`
	LotusByTier  map[int]map[string]int `json:"lotusByTier"`
	// watcher captures that actually COMPLETED, by team (2 radiant / 3 dire)
	LanternCapturesByTeam map[int]int `json:"lanternCapturesByTeam"`
}

var famangoClass = map[string]string{
	"CDOTA_Item_Famango":        "small",
	"CDOTA_Item_GreatFamango":   "great",
	"CDOTA_Item_GreaterFamango": "greater",
}

func intOf(e *manta.Entity, key string) (int, bool) {
	v := e.Get(key)
	if v == nil {
		return 0, false
	}
	switch n := v.(type) {
	case int32:
		return int(n), true
	case uint32:
		return int(n), true
	case int:
		return n, true
	case uint64:
		return int(n), true
	case int64:
		return int(n), true
	}
	return 0, false
}

// trackEntities wires the entity callbacks and returns the accumulating stats.
func trackEntities(p *manta.Parser) *entityStats {
	st := &entityStats{
		LotusPickups:          map[int]int{},
		LotusByTier:           map[int]map[string]int{},
		LanternCapturesByTeam: map[int]int{},
	}
	// handle -> last seen team, so only genuine transitions count.
	lanternTeam := map[int32]int{}
	// famango entity handle -> already counted, so an entity is a pickup exactly once.
	credited := map[int32]bool{}

	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		cn := e.GetClassName()

		if tier, ok := famangoClass[cn]; ok {
			// The owner is NOT set at creation — it lands in a later update, so crediting
			// only on Created silently loses almost every pickup. Credit each entity once,
			// the first time it has a real owner.
			idx := e.GetIndex()
			if credited[idx] {
				return nil
			}
			owner, ok := intOf(e, "m_iPlayerOwnerID")
			if !ok || owner < 0 || owner > 9 {
				return nil // still on the ground
			}
			credited[idx] = true
			charges, ok := intOf(e, "m_iCurrentCharges")
			if !ok || charges < 1 {
				charges = 1
			}
			if st.LotusByTier[owner] == nil {
				st.LotusByTier[owner] = map[string]int{}
			}
			st.LotusByTier[owner][tier] += charges
			// Only the SMALL tier is a pickup; the larger tiers are merge products.
			if tier == "small" {
				st.LotusPickups[owner] += charges
			}
			return nil
		}

		if cn == "CDOTA_NPC_Lantern" {
			team, ok := intOf(e, "m_iTeamNum")
			if !ok {
				return nil
			}
			idx := e.GetIndex()
			prev, seen := lanternTeam[idx]
			lanternTeam[idx] = team
			// 5 is the neutral/unowned state; 2 and 3 are the two sides.
			if seen && prev != team && (team == 2 || team == 3) {
				st.LanternCapturesByTeam[team]++
			}
			return nil
		}
		return nil
	})
	return st
}
