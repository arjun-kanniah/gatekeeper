// Package eval scores the gates over a batch of runs: a confusion matrix per setup (gate
// verdict against the hidden tests) and, per gate, how often it caught a defect and how often it
// blocked a correct change.
package eval

import (
	"fmt"
	"io"
	"path/filepath"
	"slices"
	"sort"
	"strings"

	"github.com/arjun-kanniah/gatekeeper/internal/gates"
	"github.com/arjun-kanniah/gatekeeper/internal/run"
)

// Matrix counts runs by outcome.
type Matrix struct {
	Runs       int `json:"runs"`
	Accepted   int `json:"accepted"`
	Caught     int `json:"caught"`
	Escaped    int `json:"escaped"`
	FalseBlock int `json:"blockedCorrect"`
}

func (m *Matrix) add(o run.Outcome) {
	m.Runs++
	switch o {
	case run.Accepted:
		m.Accepted++
	case run.Caught:
		m.Caught++
	case run.Escaped:
		m.Escaped++
	case run.FalseBlock:
		m.FalseBlock++
	}
}

// GateStats is how one gate did across the batch.
type GateStats struct {
	Gate string `json:"gate"`
	// Failed: runs where this gate failed. Catches: those where the hidden tests also failed.
	// FalseBlocks: those where the hidden tests passed. For a test-based gate that's noise; for a
	// policy gate it's usually a rule broken by a change that still behaves correctly.
	Failed      int `json:"failed"`
	Catches     int `json:"catches"`
	FalseBlocks int `json:"blockedCorrect"`
	// OnlyBlocker: correct changes this gate alone blocked.
	OnlyBlocker int `json:"onlyBlocker"`
	Skipped     int `json:"skipped"`
}

// Case is one run worth looking at: an escape, a catch or a false block.
type Case struct {
	Run         string   `json:"run"`
	Outcome     string   `json:"outcome"`
	GatesFailed []string `json:"gatesFailed,omitempty"`
	HiddenFails []string `json:"hiddenFailed,omitempty"`
}

// Summary is the whole evaluation.
type Summary struct {
	Total   Matrix            `json:"total"`
	BySetup map[string]Matrix `json:"bySetup"`
	Gates   []GateStats       `json:"gates"`
	Latent  map[string]int    `json:"latentLeftBySetup"`
	Cases   []Case            `json:"cases"`
	Invalid []string          `json:"invalidRuns,omitempty"`
}

// Summarize scores a batch. Runs the runner marked invalid are listed and left out.
func Summarize(results []run.Result, batch string) Summary {
	s := Summary{BySetup: map[string]Matrix{}, Latent: map[string]int{}}
	stats := map[string]*GateStats{}
	for _, g := range gates.Names {
		stats[g] = &GateStats{Gate: g}
	}
	for _, r := range results {
		name := r.Dir
		if rel, err := filepath.Rel(batch, r.Dir); err == nil {
			name = rel
		}
		if r.Meta.Valid != nil && !*r.Meta.Valid {
			s.Invalid = append(s.Invalid, name)
			continue
		}
		o := r.Outcome()
		s.Total.add(o)
		m := s.BySetup[r.Meta.Setup]
		m.add(o)
		s.BySetup[r.Meta.Setup] = m
		if len(r.Truth.LatentFailed) > 0 {
			s.Latent[r.Meta.Setup]++
		}
		failed := r.Report.Failed()
		for _, g := range r.Report.Gates {
			st := stats[g.Gate]
			switch g.Verdict {
			case gates.Skip:
				st.Skipped++
			case gates.Fail:
				st.Failed++
				if r.Truth.Correct {
					st.FalseBlocks++
					if len(failed) == 1 {
						st.OnlyBlocker++
					}
				} else {
					st.Catches++
				}
			}
		}
		if o != run.Accepted {
			s.Cases = append(s.Cases, Case{Run: name, Outcome: string(o), GatesFailed: failed, HiddenFails: r.Truth.Failed})
		}
	}
	for _, g := range gates.Names {
		s.Gates = append(s.Gates, *stats[g])
	}
	order := map[string]int{string(run.Escaped): 0, string(run.FalseBlock): 1, string(run.Caught): 2}
	sort.SliceStable(s.Cases, func(i, j int) bool { return order[s.Cases[i].Outcome] < order[s.Cases[j].Outcome] })
	return s
}

// WriteText prints the summary as tables.
func (s Summary) WriteText(w io.Writer) {
	fmt.Fprintln(w, "Gate verdict against the hidden tests")
	fmt.Fprintln(w)
	fmt.Fprintf(w, "%-7s %5s %9s %7s %8s %16s  %s\n", "setup", "runs", "accepted", "caught", "ESCAPED", "blocked-correct", "latent-left")
	setups := make([]string, 0, len(s.BySetup))
	for k := range s.BySetup {
		setups = append(setups, k)
	}
	slices.Sort(setups)
	row := func(name string, m Matrix, latent int) {
		fmt.Fprintf(w, "%-7s %5d %9d %7d %8d %16d  %d\n", name, m.Runs, m.Accepted, m.Caught, m.Escaped, m.FalseBlock, latent)
	}
	totalLatent := 0
	for _, k := range setups {
		row(k, s.BySetup[k], s.Latent[k])
		totalLatent += s.Latent[k]
	}
	row("all", s.Total, totalLatent)
	fmt.Fprintln(w)
	fmt.Fprintln(w, "The hidden tests judge behaviour only. blocked-correct means the change behaved correctly")
	fmt.Fprintln(w, "and a gate still failed: noise for a test-based gate, but for a policy gate (scope,")
	fmt.Fprintln(w, "protected paths, migrations, dependencies) usually a real rule broken. Read the evidence.")

	fmt.Fprintln(w)
	fmt.Fprintln(w, "Per gate (catches: failed on a wrong change; blocked-correct: failed on a correct one)")
	fmt.Fprintln(w)
	fmt.Fprintf(w, "%-20s %7s %8s %16s %13s %8s\n", "gate", "failed", "catches", "blocked-correct", "only-blocker", "skipped")
	for _, g := range s.Gates {
		fmt.Fprintf(w, "%-20s %7d %8d %16d %13d %8d\n", g.Gate, g.Failed, g.Catches, g.FalseBlocks, g.OnlyBlocker, g.Skipped)
	}

	if len(s.Cases) > 0 {
		fmt.Fprintln(w)
		fmt.Fprintln(w, "Runs that weren't simply accepted")
		fmt.Fprintln(w)
		for _, c := range s.Cases {
			detail := "gates: " + orNone(c.GatesFailed)
			if len(c.HiddenFails) > 0 {
				detail += fmt.Sprintf("; %d hidden tests failed", len(c.HiddenFails))
			}
			fmt.Fprintf(w, "%-15s %-14s %s\n", c.Outcome, c.Run, detail)
		}
	}
	if len(s.Invalid) > 0 {
		fmt.Fprintf(w, "\nLeft out (the runner marked them invalid): %s\n", strings.Join(s.Invalid, ", "))
	}
}

func orNone(xs []string) string {
	if len(xs) == 0 {
		return "none failed"
	}
	return strings.Join(xs, ", ")
}
