package run

import (
	"path/filepath"
	"testing"

	"github.com/arjun-kanniah/gatekeeper/internal/config"
	"github.com/arjun-kanniah/gatekeeper/internal/gates"
)

// testdata/batch has one run per outcome. See the comments where each is described below.
func evaluateFixture(t *testing.T, run string) Result {
	t.Helper()
	p, err := config.LoadPolicy("testdata/gates.yaml")
	if err != nil {
		t.Fatal(err)
	}
	r, err := Evaluate(filepath.Join("testdata/batch/T13", run), p, "testdata/tasks")
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestEvaluateOutcomes(t *testing.T) {
	cases := []struct {
		run    string
		want   Outcome
		failed []string
		latent int
	}{
		{"A-r1", Accepted, nil, 0},                           // correct; touches src/auth.ts, which T13 allows
		{"B-r1", Escaped, nil, 0},                            // same gates, but a hidden test fails
		{"C-r1", FalseBlock, []string{"protected-paths"}, 0}, // correct, but edits tests/helpers.ts
		{"C-r2", Accepted, nil, 1},                           // only a [latent] hidden test fails
	}
	for _, c := range cases {
		t.Run(c.run, func(t *testing.T) {
			r := evaluateFixture(t, c.run)
			if got := r.Outcome(); got != c.want {
				t.Errorf("outcome %s, want %s (gates %v, truth %+v)", got, c.want, r.Report.Failed(), r.Truth)
			}
			if got := r.Report.Failed(); len(got) != len(c.failed) || (len(got) > 0 && got[0] != c.failed[0]) {
				t.Errorf("failed gates %v, want %v", got, c.failed)
			}
			if len(r.Truth.LatentFailed) != c.latent {
				t.Errorf("latent failures %v, want %d", r.Truth.LatentFailed, c.latent)
			}
			if r.Meta.Task != "T13" || r.Report.Task != "T13" {
				t.Errorf("task %q / %q", r.Meta.Task, r.Report.Task)
			}
		})
	}
}

func TestOptionalInputsSkip(t *testing.T) {
	r := evaluateFixture(t, "A-r1")
	for _, g := range r.Report.Gates {
		switch g.Gate {
		case "coverage", "static-analysis":
			if g.Verdict != gates.Skip {
				t.Errorf("%s: %s, want skip when its input is missing", g.Gate, g.Verdict)
			}
		}
	}
}

func TestFindRuns(t *testing.T) {
	dirs, err := FindRuns("testdata/batch")
	if err != nil {
		t.Fatal(err)
	}
	if len(dirs) != 4 || filepath.Base(dirs[0]) != "A-r1" || filepath.Base(dirs[3]) != "C-r2" {
		t.Errorf("got %v", dirs)
	}
}

func TestLoadNeedsDiff(t *testing.T) {
	if _, err := Load(Paths{}); err == nil {
		t.Error("want an error without a diff")
	}
}

func TestReadTruthNoTests(t *testing.T) {
	if _, err := ReadTruth("testdata/gates.yaml"); err == nil {
		t.Error("want an error for a file that isn't a JUnit report")
	}
}
