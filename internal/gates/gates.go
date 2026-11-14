// Package gates applies release gates to a change: a parsed diff plus the outputs of the tools
// that already ran on it. Each gate is a pure function of its inputs, so it's fast and testable.
package gates

import (
	"fmt"
	"regexp"
	"slices"
	"strings"

	"github.com/arjun-kanniah/gatekeeper/internal/config"
	"github.com/arjun-kanniah/gatekeeper/internal/diff"
	"github.com/arjun-kanniah/gatekeeper/internal/glob"
	"github.com/arjun-kanniah/gatekeeper/internal/inputs"
)

// Verdict is a gate's outcome.
type Verdict string

const (
	Pass Verdict = "pass"
	Fail Verdict = "fail"
	Skip Verdict = "skip" // the gate's input wasn't provided, or it doesn't apply
)

// Result is one gate's verdict and the evidence for it.
type Result struct {
	Gate     string   `json:"gate"`
	Verdict  Verdict  `json:"verdict"`
	Summary  string   `json:"summary"`
	Evidence []string `json:"evidence,omitempty"`
}

// Report is every gate's result. Verdict is fail if any gate failed.
type Report struct {
	Verdict Verdict  `json:"verdict"`
	Task    string   `json:"task,omitempty"`
	Gates   []Result `json:"gates"`
}

// Failed returns the names of the gates that failed.
func (r Report) Failed() []string {
	var out []string
	for _, g := range r.Gates {
		if g.Verdict == Fail {
			out = append(out, g.Gate)
		}
	}
	return out
}

// Inputs is what the gates judge. A nil pointer (or HaveSARIF false) means that input wasn't
// provided, and the gate that needs it is skipped rather than passed.
type Inputs struct {
	Files        []diff.File
	Visible      *inputs.JUnit
	BaseCoverage *float64
	HeadCoverage *float64
	Findings     []inputs.Finding
	HaveSARIF    bool
}

// Names lists the gates in the order they run.
var Names = []string{
	"has-change", "tests-pass", "tests-not-weakened", "coverage", "diff-size",
	"protected-paths", "migrations", "dependencies", "secrets", "static-analysis",
}

// Run applies every gate.
func Run(p config.Policy, t config.Task, in Inputs) Report {
	tests := glob.CompileAll(p.Tests)
	source := glob.CompileAll(p.Source)
	r := Report{Task: t.ID, Gates: []Result{
		HasChange(in.Files, source),
		TestsPass(in.Visible),
		TestsNotWeakened(in.Files, tests),
		Coverage(in.BaseCoverage, in.HeadCoverage, p.Coverage.MaxDropPoints),
		DiffSize(in.Files, source, t.Budget.MaxSrcFiles, t.Budget.MaxSrcLines),
		ProtectedPaths(in.Files, p.Protected, t.Allow.ProtectedPaths),
		Migrations(in.Files, p.Migrations, t.Allow.NewMigrations),
		Dependencies(in.Files, glob.CompileAll(p.DependencyFiles), t.Allow.NewDependencies),
		Secrets(in.Files),
		StaticAnalysis(in.Findings, in.HaveSARIF, in.Files, p.StaticAnalysis.FailOn),
	}}
	r.Verdict = Pass
	if len(r.Failed()) > 0 {
		r.Verdict = Fail
	}
	return r
}

// HasChange fails when the change touches no source file: an agent that gave up, or changed
// only docs and tests, hasn't resolved anything.
func HasChange(files []diff.File, source glob.Set) Result {
	r := Result{Gate: "has-change"}
	n := 0
	for _, f := range files {
		if f.Touches(source.Match) {
			n++
		}
	}
	if n == 0 {
		r.Verdict = Fail
		r.Summary = fmt.Sprintf("no source files changed (%d files in the diff)", len(files))
		return r
	}
	r.Verdict = Pass
	r.Summary = fmt.Sprintf("%d source files changed", n)
	return r
}

// TestsPass fails when any visible test fails, or when no tests ran at all.
func TestsPass(j *inputs.JUnit) Result {
	r := Result{Gate: "tests-pass"}
	if j == nil {
		r.Verdict, r.Summary = Skip, "no JUnit report given"
		return r
	}
	failed := j.Failed()
	switch {
	case len(j.Cases) == 0:
		r.Verdict, r.Summary = Fail, "the JUnit report has no tests"
	case len(failed) > 0:
		r.Verdict = Fail
		r.Summary = fmt.Sprintf("%d of %d tests failed", len(failed), len(j.Cases))
		for _, c := range failed {
			r.Evidence = append(r.Evidence, c.Suite+": "+c.Name)
		}
	default:
		r.Verdict = Pass
		r.Summary = fmt.Sprintf("%d tests, none failed", len(j.Cases))
	}
	return r
}

var (
	// A line that declares a test or suite, or makes an assertion.
	testLine = regexp.MustCompile(`\b(it|test|describe|suite)(\.\w+)*\s*\(|\bexpect(\.\w+)*\s*\(|\bassert(\.\w+)*\s*\(`)
	// Ways to stop a test from running, or to make the suite run only some tests.
	skipLine = regexp.MustCompile(`\b(it|test|describe|suite)\.(skip|only|todo|fails|skipIf|runIf)\b|\bx(it|test|describe)\s*\(|\bf(it|describe)\s*\(`)
)

// TestsNotWeakened fails when a test file is deleted (or renamed out of the test paths), when a
// test or assertion line in an existing test file is removed or rewritten, or when a skip,
// .only or .todo is added anywhere in the tests. Adding tests is always fine, and so is any
// other edit, such as extending an import line.
func TestsNotWeakened(files []diff.File, tests glob.Set) Result {
	r := Result{Gate: "tests-not-weakened"}
	for _, f := range files {
		wasTest, isTest := tests.Match(f.OldPath), tests.Match(f.Path)
		if !wasTest && !isTest {
			continue
		}
		switch {
		case f.Status == diff.Deleted && wasTest:
			r.Evidence = append(r.Evidence, "deleted "+f.OldPath)
			continue
		case wasTest && !isTest:
			r.Evidence = append(r.Evidence, fmt.Sprintf("moved %s out of the test paths, to %s", f.OldPath, f.Path))
			continue
		}
		// A removed test or assertion line that comes back unchanged (moved within the file)
		// doesn't count.
		added := map[string]int{}
		for _, l := range f.Added {
			added[strings.TrimSpace(l)]++
		}
		for _, l := range f.Removed {
			t := strings.TrimSpace(l)
			if added[t] > 0 {
				added[t]--
				continue
			}
			if testLine.MatchString(t) {
				r.Evidence = append(r.Evidence, fmt.Sprintf("%s: removed or rewrote %q", f.Path, clip(t)))
			}
		}
		for _, l := range f.Added {
			if t := strings.TrimSpace(l); skipLine.MatchString(t) && !strings.HasPrefix(t, "//") {
				r.Evidence = append(r.Evidence, fmt.Sprintf("%s: added %q", f.Path, clip(t)))
			}
		}
	}
	if len(r.Evidence) > 0 {
		r.Verdict = Fail
		r.Summary = fmt.Sprintf("%d test removals, rewrites or skips", len(r.Evidence))
	} else {
		r.Verdict, r.Summary = Pass, "no tests removed, rewritten or skipped"
	}
	return r
}

// Coverage fails when line coverage drops by more than maxDrop percentage points.
func Coverage(base, head *float64, maxDrop float64) Result {
	r := Result{Gate: "coverage"}
	if base == nil || head == nil {
		r.Verdict, r.Summary = Skip, "base and head coverage not both given"
		return r
	}
	drop := *base - *head
	r.Summary = fmt.Sprintf("line coverage %.2f%% → %.2f%% (allowed drop %.2f points)", *base, *head, maxDrop)
	r.Verdict = Pass
	// Round to hundredths first so float noise can't fail a drop of exactly maxDrop.
	if round2(drop) > round2(maxDrop) {
		r.Verdict = Fail
	}
	return r
}

// DiffSize fails when the change touches more source files or lines than the task's budget.
// Only paths matching the policy's source globs count.
func DiffSize(files []diff.File, source glob.Set, maxFiles, maxLines int) Result {
	r := Result{Gate: "diff-size"}
	n, lines := 0, 0
	for _, f := range files {
		if f.Binary || !f.Touches(source.Match) {
			continue
		}
		n++
		lines += f.Lines()
		r.Evidence = append(r.Evidence, fmt.Sprintf("%s: +%d -%d", f.Path, len(f.Added), len(f.Removed)))
	}
	r.Summary = fmt.Sprintf("%d source files, %d lines", n, lines)
	if maxFiles == 0 && maxLines == 0 {
		r.Verdict = Skip
		r.Summary += "; the task sets no budget"
		return r
	}
	r.Summary += fmt.Sprintf(" (budget %d files, %d lines)", maxFiles, maxLines)
	r.Verdict = Pass
	if (maxFiles > 0 && n > maxFiles) || (maxLines > 0 && lines > maxLines) {
		r.Verdict = Fail
	}
	return r
}

// ProtectedPaths fails when the change touches a protected path the task doesn't allow.
func ProtectedPaths(files []diff.File, protected, allowed []string) Result {
	r := Result{Gate: "protected-paths"}
	prot, allow := glob.CompileAll(protected), glob.CompileAll(allowed)
	for _, f := range files {
		for _, p := range uniq(f.OldPath, f.Path) {
			if g, ok := prot.Which(p); ok && !allow.Match(p) {
				r.Evidence = append(r.Evidence, fmt.Sprintf("%s %s (protected by %q)", verb(f.Status), p, g))
			}
		}
	}
	if len(r.Evidence) > 0 {
		r.Verdict, r.Summary = Fail, fmt.Sprintf("%d protected paths changed", len(r.Evidence))
	} else {
		r.Verdict, r.Summary = Pass, "no protected paths changed"
	}
	if len(allowed) > 0 {
		r.Summary += "; the task allows " + strings.Join(allowed, ", ")
	}
	return r
}

// Migrations fails when an existing migration is changed, deleted or renamed (they're
// append-only), or a new one is added when the task doesn't allow schema changes.
func Migrations(files []diff.File, dir string, allowNew bool) Result {
	r := Result{Gate: "migrations"}
	if dir == "" {
		r.Verdict, r.Summary = Skip, "no migrations directory configured"
		return r
	}
	in := func(p string) bool { return strings.HasPrefix(p, dir) }
	added := 0
	for _, f := range files {
		switch {
		case f.Status == diff.Added && in(f.Path):
			added++
			if !allowNew {
				r.Evidence = append(r.Evidence, "added "+f.Path+" (the task doesn't allow schema changes)")
			}
		case f.Status == diff.Renamed && in(f.Path) && !in(f.OldPath):
			added++ // moved in from elsewhere: a new migration
			if !allowNew {
				r.Evidence = append(r.Evidence, "added "+f.Path+" (the task doesn't allow schema changes)")
			}
		case in(f.OldPath):
			r.Evidence = append(r.Evidence, verb(f.Status)+" existing migration "+f.OldPath)
		}
	}
	if len(r.Evidence) > 0 {
		r.Verdict, r.Summary = Fail, fmt.Sprintf("%d migration problems", len(r.Evidence))
	} else {
		r.Verdict, r.Summary = Pass, fmt.Sprintf("existing migrations unchanged; %d added", added)
	}
	return r
}

var (
	// "name": "version-like" in package.json.
	depLine = regexp.MustCompile(`^\s*"([^"]+)"\s*:\s*"((?:\^|~|>|<|=|\*|\d|workspace:|npm:|file:|link:|git\+|git:|github:|https?:|latest$|next$)[^"]*)"`)
	// "node_modules/name": { in package-lock.json.
	lockLine = regexp.MustCompile(`^\s*"((?:[^"]*/)?node_modules/[^"]+)"\s*:\s*\{`)
	// package.json keys with version-like values that aren't dependencies.
	notDeps = map[string]bool{"version": true, "node": true, "npm": true, "pnpm": true, "yarn": true, "packageManager": true}
)

// Dependencies fails when a dependency is added to a package manifest or lockfile and the task
// doesn't allow it. A version change to an existing dependency isn't flagged here; the
// protected-paths gate already covers the manifests.
func Dependencies(files []diff.File, depFiles glob.Set, allowNew bool) Result {
	r := Result{Gate: "dependencies"}
	var found []string
	for _, f := range files {
		if !depFiles.Match(f.Path) {
			continue
		}
		re, isLock := depLine, strings.HasSuffix(f.Path, "-lock.json")
		if isLock {
			re = lockLine
		}
		removed := map[string]bool{}
		for _, l := range f.Removed {
			if m := re.FindStringSubmatch(l); m != nil {
				removed[m[1]] = true
			}
		}
		for _, l := range f.Added {
			m := re.FindStringSubmatch(l)
			if m == nil || removed[m[1]] || (!isLock && notDeps[m[1]]) {
				continue
			}
			found = append(found, fmt.Sprintf("%s: %s", f.Path, m[1]))
		}
	}
	r.Evidence = found
	switch {
	case len(found) == 0:
		r.Verdict, r.Summary = Pass, "no new dependencies"
	case allowNew:
		r.Verdict, r.Summary = Pass, fmt.Sprintf("%d new dependencies, which the task allows", len(found))
	default:
		r.Verdict, r.Summary = Fail, fmt.Sprintf("%d new dependencies", len(found))
	}
	return r
}

type secretPattern struct {
	name string
	re   *regexp.Regexp
}

var secretPatterns = []secretPattern{
	{"Anthropic API key", regexp.MustCompile(`sk-ant-[A-Za-z0-9_\-]{20,}`)},
	{"OpenAI API key", regexp.MustCompile(`\bsk-(?:proj-)?[A-Za-z0-9_\-]{32,}`)},
	{"AWS access key ID", regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`)},
	{"GitHub token", regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}`)},
	{"Google API key", regexp.MustCompile(`\bAIza[0-9A-Za-z_\-]{35}\b`)},
	{"Slack token", regexp.MustCompile(`\bxox[baprs]-[A-Za-z0-9\-]{10,}`)},
	{"private key", regexp.MustCompile(`-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----`)},
	{"credential assignment", regexp.MustCompile(`(?i)(?:api[_-]?key|secret|token|passw(?:or)?d)\w*["']?\s*[:=]\s*["']([A-Za-z0-9/+_\-]{24,})["']`)},
}

// Secrets fails when an added line looks like a credential. The evidence names the file and
// the kind of secret, never the value.
func Secrets(files []diff.File) Result {
	r := Result{Gate: "secrets"}
	for _, f := range files {
		if f.Binary {
			continue
		}
		for i, l := range f.Added {
			for _, p := range secretPatterns {
				if p.re.MatchString(l) {
					r.Evidence = append(r.Evidence, fmt.Sprintf("%s, added line %d: looks like a %s", f.Path, i+1, p.name))
					break
				}
			}
		}
	}
	if len(r.Evidence) > 0 {
		r.Verdict, r.Summary = Fail, fmt.Sprintf("%d possible secrets added", len(r.Evidence))
	} else {
		r.Verdict, r.Summary = Pass, "no secrets found in added lines"
	}
	return r
}

// StaticAnalysis fails on a SARIF finding at a blocking level in a file the change touched.
// Findings in untouched files predate the change and aren't its fault.
func StaticAnalysis(findings []inputs.Finding, have bool, files []diff.File, failOn []string) Result {
	r := Result{Gate: "static-analysis"}
	if !have {
		r.Verdict, r.Summary = Skip, "no SARIF report given"
		return r
	}
	changed := map[string]bool{}
	for _, f := range files {
		if f.Status != diff.Deleted {
			changed[f.Path] = true
		}
	}
	blocking := 0
	for _, f := range findings {
		if !changed[strings.TrimPrefix(f.Path, "./")] {
			continue
		}
		if slices.Contains(failOn, f.Level) {
			blocking++
			r.Evidence = append(r.Evidence, fmt.Sprintf("%s:%d %s (%s): %s", f.Path, f.Line, f.Rule, f.Level, clip(f.Message)))
		}
	}
	r.Summary = fmt.Sprintf("%d findings, %d blocking, in changed files", len(findings), blocking)
	r.Verdict = Pass
	if blocking > 0 {
		r.Verdict = Fail
	}
	return r
}

func verb(s diff.Status) string {
	switch s {
	case diff.Added:
		return "added"
	case diff.Deleted:
		return "deleted"
	case diff.Renamed:
		return "renamed"
	default:
		return "modified"
	}
}

func uniq(a, b string) []string {
	if a == b {
		return []string{a}
	}
	return []string{a, b}
}

func clip(s string) string {
	if len(s) > 100 {
		return s[:97] + "..."
	}
	return s
}

func round2(x float64) float64 {
	if x < 0 {
		return -round2(-x)
	}
	return float64(int64(x*100+0.5)) / 100
}
