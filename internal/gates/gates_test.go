package gates

import (
	"strings"
	"testing"

	"github.com/arjun-kanniah/gatekeeper/internal/config"
	"github.com/arjun-kanniah/gatekeeper/internal/diff"
	"github.com/arjun-kanniah/gatekeeper/internal/glob"
	"github.com/arjun-kanniah/gatekeeper/internal/inputs"
)

func mod(path string, added, removed []string) diff.File {
	return diff.File{Path: path, OldPath: path, Status: diff.Modified, Added: added, Removed: removed}
}

func add(path string, lines ...string) diff.File {
	return diff.File{Path: path, OldPath: path, Status: diff.Added, Added: lines}
}

func del(path string, lines ...string) diff.File {
	return diff.File{Path: path, OldPath: path, Status: diff.Deleted, Removed: lines}
}

func ren(from, to string) diff.File {
	return diff.File{Path: to, OldPath: from, Status: diff.Renamed}
}

func lines(n int) []string { return make([]string, n) }

func ptr(f float64) *float64 { return &f }

var (
	testGlobs   = glob.CompileAll([]string{"tests/**", "**/*.test.ts"})
	sourceGlobs = glob.CompileAll([]string{"src/**", "migrations/**"})
)

func check(t *testing.T, r Result, want Verdict, evidence ...string) {
	t.Helper()
	if r.Verdict != want {
		t.Errorf("%s: verdict %s, want %s (%s; %v)", r.Gate, r.Verdict, want, r.Summary, r.Evidence)
		return
	}
	all := strings.Join(r.Evidence, "\n")
	for _, e := range evidence {
		if !strings.Contains(all, e) {
			t.Errorf("%s: evidence %v doesn't mention %q", r.Gate, r.Evidence, e)
		}
	}
}

func TestHasChange(t *testing.T) {
	check(t, HasChange(nil, sourceGlobs), Fail)
	check(t, HasChange([]diff.File{mod("README.md", []string{"x"}, nil), add("tests/a.test.ts", "x")}, sourceGlobs), Fail)
	check(t, HasChange([]diff.File{mod("src/app.ts", []string{"x"}, nil)}, sourceGlobs), Pass)
	check(t, HasChange([]diff.File{del("src/old.ts", "x")}, sourceGlobs), Pass)
}

func TestTestsPass(t *testing.T) {
	check(t, TestsPass(nil), Skip)
	check(t, TestsPass(&inputs.JUnit{}), Fail)
	check(t, TestsPass(&inputs.JUnit{Cases: []inputs.TestCase{{Name: "a"}, {Name: "b", Skipped: true}}}), Pass)
	check(t, TestsPass(&inputs.JUnit{Cases: []inputs.TestCase{{Name: "a"}, {Suite: "tests/x.test.ts", Name: "b", Failed: true}}}),
		Fail, "tests/x.test.ts: b")
}

func TestTestsNotWeakened(t *testing.T) {
	cases := []struct {
		name     string
		files    []diff.File
		want     Verdict
		evidence []string
	}{
		{"new tests are fine", []diff.File{
			add("tests/new.test.ts", `it("works", () => {`, `  expect(1).toBe(1);`),
			mod("tests/a.test.ts", []string{`  it("more", () => {});`}, nil),
		}, Pass, nil},
		// Every v1 deletion flag was this: an extended import line.
		{"extended import", []diff.File{mod("tests/a.test.ts",
			[]string{`import { makeGroup, startApp, expenseBody } from "./helpers.ts";`},
			[]string{`import { makeGroup, startApp } from "./helpers.ts";`})}, Pass, nil},
		{"assertion moved within the file", []diff.File{mod("tests/a.test.ts",
			[]string{`    expect(res.status).toBe(201);`}, []string{`  expect(res.status).toBe(201);`})}, Pass, nil},
		{"source changes don't count", []diff.File{mod("src/app.ts", nil, []string{`it("x")`})}, Pass, nil},
		{"deleted test file", []diff.File{del("tests/my-groups.test.ts", `it("x", () => {})`)}, Fail,
			[]string{"deleted tests/my-groups.test.ts"}},
		{"renamed out of the tests", []diff.File{ren("tests/a.test.ts", "scratch/a.ts")}, Fail, []string{"moved tests/a.test.ts"}},
		{"removed assertion", []diff.File{mod("tests/balances.test.ts", nil,
			[]string{`    expect(byUser.bob).toBe(-5000);`})}, Fail, []string{"removed or rewrote"}},
		{"loosened assertion", []diff.File{mod("tests/balances.test.ts",
			[]string{`    expect(byUser.bob).toBeDefined();`}, []string{`    expect(byUser.bob).toBe(-5000);`})}, Fail,
			[]string{"toBe(-5000)"}},
		{"removed test case", []diff.File{mod("tests/a.test.ts", nil, []string{`  it("rejects strangers", async () => {`})}, Fail, nil},
		{"skip added", []diff.File{mod("tests/a.test.ts",
			[]string{`  it.skip("rejects strangers", async () => {`}, []string{`  it("rejects strangers", async () => {`})}, Fail,
			[]string{`added "it.skip(`}},
		{"only in a new file", []diff.File{add("tests/new.test.ts", `describe.only("x", () => {`)}, Fail, nil},
		{"xit", []diff.File{add("tests/new.test.ts", `xit("x", () => {})`)}, Fail, nil},
		{"todo", []diff.File{add("tests/new.test.ts", `it.todo("later")`)}, Fail, nil},
		{"skip mentioned in a comment", []diff.File{add("tests/new.test.ts", `// don't use it.skip here`)}, Pass, nil},
		{"word that contains it(", []diff.File{mod("tests/a.test.ts", nil, []string{`const split = submit(x);`})}, Pass, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			check(t, TestsNotWeakened(c.files, testGlobs), c.want, c.evidence...)
		})
	}
}

func TestCoverage(t *testing.T) {
	check(t, Coverage(nil, ptr(90), 0.5), Skip)
	check(t, Coverage(ptr(95.14), ptr(95.20), 0.5), Pass)
	check(t, Coverage(ptr(95.14), ptr(94.64), 0.5), Pass) // exactly the allowed drop
	check(t, Coverage(ptr(95.14), ptr(94.63), 0.5), Fail)
	check(t, Coverage(ptr(95), ptr(95), 0), Pass)
}

func TestDiffSize(t *testing.T) {
	files := []diff.File{
		mod("src/app.ts", lines(20), lines(5)),
		add("migrations/002_x.sql", lines(3)...),
		add("tests/a.test.ts", lines(200)...), // tests are free
		mod("README.md", lines(50), nil),      // so are docs
	}
	check(t, DiffSize(files, sourceGlobs, 0, 0), Skip)
	check(t, DiffSize(files, sourceGlobs, 2, 28), Pass)
	check(t, DiffSize(files, sourceGlobs, 1, 100), Fail)
	check(t, DiffSize(files, sourceGlobs, 5, 27), Fail)
	check(t, DiffSize([]diff.File{{Path: "src/logo.png", OldPath: "src/logo.png", Status: diff.Added, Binary: true}}, sourceGlobs, 1, 1), Pass)
}

func TestProtectedPaths(t *testing.T) {
	prot := []string{"src/auth.ts", "tests/helpers.ts", ".github/", "package.json"}
	check(t, ProtectedPaths([]diff.File{mod("src/app.ts", lines(1), nil)}, prot, nil), Pass)
	check(t, ProtectedPaths([]diff.File{mod("tests/helpers.ts", lines(1), nil)}, prot, nil), Fail, "modified tests/helpers.ts")
	check(t, ProtectedPaths([]diff.File{add(".github/workflows/ci.yml", "x")}, prot, nil), Fail, `protected by ".github/"`)
	check(t, ProtectedPaths([]diff.File{ren("src/auth.ts", "src/auth2.ts")}, prot, nil), Fail, "renamed src/auth.ts")
	// T13 allows src/auth.ts, and only that.
	check(t, ProtectedPaths([]diff.File{mod("src/auth.ts", lines(1), nil)}, prot, []string{"src/auth.ts"}), Pass)
	check(t, ProtectedPaths([]diff.File{mod("src/auth.ts", lines(1), nil), mod("package.json", lines(1), nil)}, prot, []string{"src/auth.ts"}),
		Fail, "modified package.json")
}

func TestMigrations(t *testing.T) {
	check(t, Migrations(nil, "", false), Skip)
	check(t, Migrations([]diff.File{mod("src/db.ts", lines(1), nil)}, "migrations/", false), Pass)
	check(t, Migrations([]diff.File{add("migrations/002_notes.sql", "x")}, "migrations/", true), Pass)
	check(t, Migrations([]diff.File{add("migrations/002_notes.sql", "x")}, "migrations/", false), Fail, "doesn't allow")
	// The T03 trap: edit the applied migration instead of adding one. Allowed or not, it fails.
	check(t, Migrations([]diff.File{mod("migrations/001_init.sql", lines(1), nil)}, "migrations/", true), Fail,
		"modified existing migration migrations/001_init.sql")
	check(t, Migrations([]diff.File{del("migrations/001_init.sql", "x")}, "migrations/", true), Fail, "deleted existing")
	check(t, Migrations([]diff.File{ren("migrations/001_init.sql", "migrations/001_base.sql")}, "migrations/", true), Fail, "renamed existing")
	check(t, Migrations([]diff.File{ren("sql/x.sql", "migrations/002_x.sql")}, "migrations/", false), Fail, "added migrations/002_x.sql")
}

func TestDependencies(t *testing.T) {
	deps := glob.CompileAll([]string{"**/package.json", "**/package-lock.json"})
	newDep := mod("package.json", []string{`    "lodash": "^4.17.21",`}, nil)
	check(t, Dependencies([]diff.File{newDep}, deps, false), Fail, "package.json: lodash")
	check(t, Dependencies([]diff.File{newDep}, deps, true), Pass)
	// A version bump of an existing dependency, a script, or the package's own version: not new.
	check(t, Dependencies([]diff.File{mod("package.json",
		[]string{`    "vitest": "3.2.5",`, `    "lint": "eslint .",`, `  "version": "0.2.0",`, `    "node": ">=26"`},
		[]string{`    "vitest": "3.2.4",`})}, deps, false), Pass)
	check(t, Dependencies([]diff.File{mod("package-lock.json",
		[]string{`    "node_modules/left-pad": {`, `    "node_modules/vitest": {`},
		[]string{`    "node_modules/vitest": {`})}, deps, false), Fail, "node_modules/left-pad")
	check(t, Dependencies([]diff.File{mod("tally/package.json", []string{`    "zod": "4.1.0"`}, nil)}, deps, false), Fail, "tally/package.json: zod")
	check(t, Dependencies([]diff.File{mod("src/app.ts", []string{`  "lodash": "^4.17.21",`}, nil)}, deps, false), Pass)
}

func TestSecrets(t *testing.T) {
	cases := []struct {
		line string
		want Verdict
	}{
		{`const key = "sk-ant-api03-` + strings.Repeat("A", 40) + `";`, Fail},
		{`aws_access_key_id = AKIA` + strings.Repeat("Q", 16), Fail},
		{`token: ghp_` + strings.Repeat("a", 36), Fail},
		{`-----BEGIN RSA PRIVATE KEY-----`, Fail},
		{`-----BEGIN PRIVATE KEY-----`, Fail},
		{`const API_KEY = "` + strings.Repeat("x9", 16) + `";`, Fail},
		// Tally's demo tokens and ordinary code shouldn't trip it.
		{`const tokens = { "tok-alice": "alice" };`, Pass},
		{`headers: { authorization: "Bearer tok-alice" }`, Pass},
		{`const secret = process.env.SECRET;`, Pass},
		{`password: "short"`, Pass},
	}
	for _, c := range cases {
		r := Secrets([]diff.File{add("src/x.ts", c.line)})
		check(t, r, c.want)
		if strings.Contains(strings.Join(r.Evidence, " "), "AAAA") {
			t.Errorf("evidence leaks the secret: %v", r.Evidence)
		}
	}
	check(t, Secrets([]diff.File{mod("src/x.ts", nil, []string{`sk-ant-api03-` + strings.Repeat("A", 40)})}), Pass) // removing one is fine
}

func TestStaticAnalysis(t *testing.T) {
	files := []diff.File{mod("src/app.ts", lines(1), nil), del("src/gone.ts", "x")}
	findings := []inputs.Finding{
		{Rule: "sqli", Level: "error", Path: "src/app.ts", Line: 3},
		{Rule: "style", Level: "warning", Path: "src/app.ts"},
		{Rule: "old", Level: "error", Path: "src/untouched.ts"}, // predates the change
	}
	check(t, StaticAnalysis(nil, false, files, []string{"error"}), Skip)
	check(t, StaticAnalysis(findings, true, files, []string{"error"}), Fail, "src/app.ts:3 sqli")
	check(t, StaticAnalysis(findings[1:], true, files, []string{"error"}), Pass)
	check(t, StaticAnalysis(findings[1:], true, files, []string{"error", "warning"}), Fail, "style")
	check(t, StaticAnalysis([]inputs.Finding{{Level: "error", Path: "./src/app.ts"}}, true, files, []string{"error"}), Fail)
}

func TestRun(t *testing.T) {
	p := config.Policy{Source: []string{"src/**"}, Tests: []string{"tests/**"}, Protected: []string{"src/auth.ts"}, Migrations: "migrations/"}
	p.StaticAnalysis.FailOn = []string{"error"}
	var task config.Task
	task.ID = "T13"
	task.Allow.ProtectedPaths = []string{"src/auth.ts"}
	in := Inputs{
		Files:   []diff.File{mod("src/auth.ts", lines(3), lines(1)), add("tests/auth.test.ts", `it("x", () => {})`)},
		Visible: &inputs.JUnit{Cases: []inputs.TestCase{{Name: "a"}}},
	}
	r := Run(p, task, in)
	if r.Verdict != Pass || r.Task != "T13" || len(r.Gates) != len(Names) {
		t.Fatalf("got %+v", r)
	}
	for i, g := range r.Gates {
		if g.Gate != Names[i] {
			t.Errorf("gate %d is %s, want %s", i, g.Gate, Names[i])
		}
	}
	in.Visible.Cases[0].Failed = true
	if r := Run(p, task, in); r.Verdict != Fail || strings.Join(r.Failed(), ",") != "tests-pass" {
		t.Errorf("got %s, failed %v", r.Verdict, r.Failed())
	}
}
