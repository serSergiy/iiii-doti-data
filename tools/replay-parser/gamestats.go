//go:build !discover && !discover2 && !discover3 && !discover4 && !discover5 && !diag

package main

// THE GAME'S OWN per-player counters, read straight out of CDOTA_DataRadiant /
// CDOTA_DataDire -> m_vecDataTeam[playerIndex].
//
// This supersedes every heuristic in this parser. The fields are named exactly as the
// official fantasy glossary names the stats:
//
//	m_iLotusesTaken      ЗІБРАНО ЛОТУСІВ    (no API field, no combat-log event)
//	m_iWatchersTaken     ЗАХОПЛЕНІ СПОГЛЯДАЧІ (completed captures, not lamp clicks)
//	m_nAcquiredMadstone  ЗІБРАНИЙ ЛЮТИТ     (acquired, not bundle uses)
//
// Fantasy POINTS cannot be in the replay — they depend on each viewer's banner — but the
// underlying quantities are, and those are what we could not derive.
//
// m_iPlayerSteamID sits in the same struct, so attribution needs no hero-name matching.

import (
	"fmt"

	"github.com/dotabuff/manta"
)

const steamIDBase = 76561197960265728

// gameStat is one player's counters as the game itself tallies them.
type gameStat struct {
	AccountID       int     `json:"accountId"`
	PlayerID        int     `json:"playerId"`
	LotusesTaken    int     `json:"lotusesTaken"`
	WatchersTaken   int     `json:"watchersTaken"`
	AcquiredMadstone int    `json:"acquiredMadstone"`
	TormentorKills  int     `json:"tormentorKills"`
	SmokesUsed      int     `json:"smokesUsed"`
	RunePickups     int     `json:"runePickups"`
	CampsStacked    int     `json:"campsStacked"`
	ObserverWards   int     `json:"observerWardsPlaced"`
	WardsDestroyed  int     `json:"wardsDestroyed"`
	CourierKills    int     `json:"courierKills"`
	RoshanKills     int     `json:"roshanKills"`
	TowerKills      int     `json:"towerKills"`
	LastHits        int     `json:"lastHits"`
	Denies          int     `json:"denies"`
	Stuns           float32 `json:"stuns"`
}

// intFields maps the JSON-facing name to the entity field suffix.
var intFields = map[string]func(*gameStat) *int{
	"m_iLotusesTaken":        func(g *gameStat) *int { return &g.LotusesTaken },
	"m_iWatchersTaken":       func(g *gameStat) *int { return &g.WatchersTaken },
	"m_nAcquiredMadstone":    func(g *gameStat) *int { return &g.AcquiredMadstone },
	"m_iTormentorKills":      func(g *gameStat) *int { return &g.TormentorKills },
	"m_iSmokesUsed":          func(g *gameStat) *int { return &g.SmokesUsed },
	"m_iRunePickups":         func(g *gameStat) *int { return &g.RunePickups },
	"m_iCampsStacked":        func(g *gameStat) *int { return &g.CampsStacked },
	"m_iObserverWardsPlaced": func(g *gameStat) *int { return &g.ObserverWards },
	"m_iWardsDestroyed":      func(g *gameStat) *int { return &g.WardsDestroyed },
	"m_iCourierKills":        func(g *gameStat) *int { return &g.CourierKills },
	"m_iRoshanKills":         func(g *gameStat) *int { return &g.RoshanKills },
	"m_iTowerKills":          func(g *gameStat) *int { return &g.TowerKills },
	"m_iLastHitCount":        func(g *gameStat) *int { return &g.LastHits },
	"m_iDenyCount":           func(g *gameStat) *int { return &g.Denies },
}

func asInt(v any) (int, bool) {
	switch n := v.(type) {
	case int32:
		return int(n), true
	case uint32:
		return int(n), true
	case int64:
		return int(n), true
	case uint64:
		return int(n), true
	}
	return 0, false
}

// trackGameStats keeps the LAST value seen for each counter, which is the end-of-game
// total. Counters only rise, so last-seen is also the maximum.
func trackGameStats(p *manta.Parser) map[int]*gameStat {
	out := map[int]*gameStat{} // playerID -> stats

	get := func(pid int) *gameStat {
		if out[pid] == nil {
			out[pid] = &gameStat{PlayerID: pid}
		}
		return out[pid]
	}

	p.OnEntity(func(e *manta.Entity, op manta.EntityOp) error {
		cn := e.GetClassName()
		if cn != "CDOTA_DataRadiant" && cn != "CDOTA_DataDire" {
			return nil
		}
		// Radiant occupies player slots 0-4 and Dire 5-9; the array is indexed the same
		// way in both entities, so read all ten and let the steam id decide who is real.
		for i := 0; i < 24; i++ {
			pre := fmt.Sprintf("m_vecDataTeam.%04d.", i)

			sid, ok := asInt(e.Get(pre + "m_iPlayerSteamID"))
			if !ok || sid <= steamIDBase {
				continue
			}
			pid, ok := asInt(e.Get(pre + "m_nPlayerID"))
			if !ok || pid < 0 || pid > 23 {
				continue
			}
			g := get(pid)
			g.AccountID = sid - steamIDBase

			for field, ptr := range intFields {
				if v, ok := asInt(e.Get(pre + field)); ok && v > *ptr(g) {
					*ptr(g) = v
				}
			}
			if v := e.Get(pre + "m_fStuns"); v != nil {
				if f, ok := v.(float32); ok && f > g.Stuns {
					g.Stuns = f
				}
			}
		}
		return nil
	})
	return out
}
