package glob

import "testing"

func TestMatch(t *testing.T) {
	cases := []struct {
		glob, path string
		want       bool
	}{
		{"src/auth.ts", "src/auth.ts", true},
		{"src/auth.ts", "src/auth.tsx", false},
		{"src/*.ts", "src/app.ts", true},
		{"src/*.ts", "src/lib/app.ts", false},
		{"src/**", "src/lib/app.ts", true},
		{"src/**/*.ts", "src/app.ts", true},
		{"src/**/*.ts", "src/a/b/app.ts", true},
		{"**/*.test.ts", "split.test.ts", true},
		{"**/*.test.ts", "tests/deep/split.test.ts", true},
		{"**/*.test.ts", "tests/split.test.tsx", false},
		{".github/", ".github/workflows/ci.yml", true},
		{".github/", ".githubx/ci.yml", false},
		{"migrations/00?_*.sql", "migrations/002_notes.sql", true},
		{"migrations/00?_*.sql", "migrations/0021_notes.sql", false},
		{"package.json", "tally/package.json", false},
		{"a+b(c).ts", "a+b(c).ts", true}, // regexp metacharacters are literal
	}
	for _, c := range cases {
		if got := Compile(c.glob).Match(c.path); got != c.want {
			t.Errorf("%q matching %q = %v, want %v", c.glob, c.path, got, c.want)
		}
	}
}

func TestSetWhich(t *testing.T) {
	s := CompileAll([]string{"tests/helpers.ts", "src/auth.ts"})
	if g, ok := s.Which("src/auth.ts"); !ok || g != "src/auth.ts" {
		t.Errorf("Which = %q, %v", g, ok)
	}
	if s.Match("src/app.ts") {
		t.Error("src/app.ts should not match")
	}
}
