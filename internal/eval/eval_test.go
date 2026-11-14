package eval

import (
	"bytes"
	"strings"
	"testing"

	"github.com/arjun-kanniah/gatekeeper/internal/gates"
	"github.com/arjun-kanniah/gatekeeper/internal/run"
)

func result(dir, setup string, failedGates []string, hiddenFailed []string, latent bool) run.Result {
	valid := true
	r := run.Result{Dir: "batch/" + dir, Meta: run.Meta{Setup: setup, Valid: &valid}}
	r.Report.Verdict = gates.Pass
	for _, g := range gates.Names {
		v := gates.Pass
		for _, f := range failedGates {
			if f == g {
				v = gates.Fail
				r.Report.Verdict = gates.Fail
			}
		}
		r.Report.Gates = append(r.Report.Gates, gates.Result{Gate: g, Verdict: v})
	}
	r.Truth.Failed = hiddenFailed
	r.Truth.Correct = len(hiddenFailed) == 0
	if latent {
		r.Truth.LatentFailed = []string{"[latent] x"}
	}
	return r
}

func TestSummarize(t *testing.T) {
	bad := []string{"hidden: x"}
	invalid := result("T01/C-r1", "C", nil, nil, false)
	f := false
	invalid.Meta.Valid = &f
	s := Summarize([]run.Result{
		result("T01/A-r1", "A", nil, nil, false),                                  // accepted
		result("T01/A-r2", "A", nil, bad, false),                                  // escaped
		result("T02/A-r1", "A", []string{"diff-size"}, nil, false),                // blocked, correct
		result("T02/B-r1", "B", []string{"diff-size", "coverage"}, nil, true),     // blocked by two
		result("T03/B-r1", "B", []string{"has-change", "tests-pass"}, bad, false), // caught
		invalid,
	}, "batch")

	if got, want := s.Total, (Matrix{Runs: 5, Accepted: 1, Escaped: 1, FalseBlock: 2, Caught: 1}); got != want {
		t.Errorf("total %+v, want %+v", got, want)
	}
	if got := s.BySetup["A"]; got.Runs != 3 || got.Escaped != 1 {
		t.Errorf("setup A %+v", got)
	}
	if s.Latent["B"] != 1 {
		t.Errorf("latent %v", s.Latent)
	}
	stats := map[string]GateStats{}
	for _, g := range s.Gates {
		stats[g.Gate] = g
	}
	if g := stats["diff-size"]; g.Failed != 2 || g.FalseBlocks != 2 || g.OnlyBlocker != 1 || g.Catches != 0 {
		t.Errorf("diff-size %+v", g)
	}
	if g := stats["has-change"]; g.Catches != 1 || g.FalseBlocks != 0 {
		t.Errorf("has-change %+v", g)
	}
	if len(s.Invalid) != 1 || s.Invalid[0] != "T01/C-r1" {
		t.Errorf("invalid %v", s.Invalid)
	}
	if len(s.Cases) != 4 || s.Cases[0].Outcome != string(run.Escaped) || s.Cases[0].Run != "T01/A-r2" {
		t.Errorf("cases %+v", s.Cases)
	}

	var buf bytes.Buffer
	s.WriteText(&buf)
	for _, want := range []string{"ESCAPED", "blocked-correct", "escaped         T01/A-r2", "Left out"} {
		if !strings.Contains(buf.String(), want) {
			t.Errorf("text output lacks %q:\n%s", want, buf.String())
		}
	}
}
