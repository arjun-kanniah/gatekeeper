// Package run loads one run directory written by runner/run-local.sh, applies the gates, and
// reads the hidden tests' verdict, the ground truth the gates are scored against.
package run

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/arjun-kanniah/gatekeeper/internal/config"
	"github.com/arjun-kanniah/gatekeeper/internal/diff"
	"github.com/arjun-kanniah/gatekeeper/internal/gates"
	"github.com/arjun-kanniah/gatekeeper/internal/inputs"
)

// Files in a run directory, as the runner names them.
const (
	DiffFile         = "diff.patch"
	VisibleJUnitFile = "visible-junit.xml"
	BaseCoverageFile = "base-coverage.json"
	HeadCoverageFile = "head-coverage.json"
	SARIFFile        = "semgrep.sarif"
	HiddenJUnitFile  = "hidden-junit.xml"
	MetaFile         = "meta.json"
)

// LatentTag marks a hidden test that checks a pre-existing bug the issue only points at. Its
// failure is reported separately, not counted as a defect in the change.
const LatentTag = "[latent]"

// Meta is the part of the runner's meta.json used here.
type Meta struct {
	Task    string  `json:"task"`
	Setup   string  `json:"setup"`
	Run     int     `json:"run"`
	Model   string  `json:"model"`
	CostUSD float64 `json:"costUsd"`
	Valid   *bool   `json:"valid"`
}

// Paths says where each input is. An empty path means the input isn't provided.
type Paths struct {
	Diff, VisibleJUnit, BaseCoverage, HeadCoverage, SARIF string
}

// InDir returns the paths of the inputs that exist in a run directory.
func InDir(dir string) Paths {
	p := func(name string) string {
		path := filepath.Join(dir, name)
		if _, err := os.Stat(path); err != nil {
			return ""
		}
		return path
	}
	return Paths{Diff: p(DiffFile), VisibleJUnit: p(VisibleJUnitFile), BaseCoverage: p(BaseCoverageFile),
		HeadCoverage: p(HeadCoverageFile), SARIF: p(SARIFFile)}
}

// Load reads the inputs. The diff is required; the others are optional, and a gate whose input
// is missing reports skip.
func Load(p Paths) (gates.Inputs, error) {
	var in gates.Inputs
	if p.Diff == "" {
		return in, errors.New("no diff given")
	}
	f, err := os.Open(p.Diff)
	if err != nil {
		return in, err
	}
	defer f.Close()
	if in.Files, err = diff.Parse(f); err != nil {
		return in, fmt.Errorf("%s: %w", p.Diff, err)
	}
	if p.VisibleJUnit != "" {
		j, err := inputs.ReadJUnit(p.VisibleJUnit)
		if err != nil {
			return in, err
		}
		in.Visible = &j
	}
	if p.BaseCoverage != "" && p.HeadCoverage != "" {
		base, err := inputs.LinePct(p.BaseCoverage)
		if err != nil {
			return in, err
		}
		head, err := inputs.LinePct(p.HeadCoverage)
		if err != nil {
			return in, err
		}
		in.BaseCoverage, in.HeadCoverage = &base, &head
	}
	if p.SARIF != "" {
		if in.Findings, err = inputs.ReadSARIF(p.SARIF); err != nil {
			return in, err
		}
		in.HaveSARIF = true
	}
	return in, nil
}

// Truth is what the hidden tests say about a run.
type Truth struct {
	Correct      bool     // no hidden test failed, apart from [latent] ones
	Failed       []string // failing hidden tests, not counting [latent] ones
	LatentFailed []string // failing [latent] hidden tests
}

// ReadTruth reads the hidden tests' JUnit report.
func ReadTruth(path string) (Truth, error) {
	j, err := inputs.ReadJUnit(path)
	if err != nil {
		return Truth{}, err
	}
	if len(j.Cases) == 0 {
		return Truth{}, fmt.Errorf("%s: no hidden tests ran", path)
	}
	var t Truth
	for _, c := range j.Failed() {
		if strings.Contains(c.Name, LatentTag) {
			t.LatentFailed = append(t.LatentFailed, c.Name)
		} else {
			t.Failed = append(t.Failed, c.Name)
		}
	}
	t.Correct = len(t.Failed) == 0
	return t, nil
}

// Result is one run: the gate report and the truth.
type Result struct {
	Dir    string
	Meta   Meta
	Report gates.Report
	Truth  Truth
}

// Outcome places a run in the confusion matrix.
type Outcome string

const (
	Accepted   Outcome = "accepted"        // gates pass, hidden tests pass
	Escaped    Outcome = "escaped"         // gates pass, hidden tests fail: the number that matters
	FalseBlock Outcome = "blocked-correct" // gates fail, hidden tests pass: noise, or a rule broken by a correct change
	Caught     Outcome = "caught"          // gates fail, hidden tests fail
)

// Outcome compares the gate verdict with the truth.
func (r Result) Outcome() Outcome {
	pass := r.Report.Verdict == gates.Pass
	switch {
	case pass && r.Truth.Correct:
		return Accepted
	case pass:
		return Escaped
	case r.Truth.Correct:
		return FalseBlock
	default:
		return Caught
	}
}

// Evaluate loads a run directory, finds its task under tasksDir, applies the gates and reads
// the truth.
func Evaluate(dir string, policy config.Policy, tasksDir string) (Result, error) {
	r := Result{Dir: dir}
	b, err := os.ReadFile(filepath.Join(dir, MetaFile))
	if err != nil {
		return r, err
	}
	if err := json.Unmarshal(b, &r.Meta); err != nil {
		return r, fmt.Errorf("%s: %w", filepath.Join(dir, MetaFile), err)
	}
	taskPath, err := config.FindTask(tasksDir, r.Meta.Task)
	if err != nil {
		return r, err
	}
	task, err := config.LoadTask(taskPath)
	if err != nil {
		return r, err
	}
	in, err := Load(InDir(dir))
	if err != nil {
		return r, fmt.Errorf("%s: %w", dir, err)
	}
	r.Report = gates.Run(policy, task, in)
	r.Truth, err = ReadTruth(filepath.Join(dir, HiddenJUnitFile))
	return r, err
}

// FindRuns returns every directory under batch that holds a finished run (a meta.json), in
// lexical order.
func FindRuns(batch string) ([]string, error) {
	var dirs []string
	err := filepath.WalkDir(batch, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && d.Name() == MetaFile {
			dirs = append(dirs, filepath.Dir(path))
		}
		return nil
	})
	return dirs, err
}
