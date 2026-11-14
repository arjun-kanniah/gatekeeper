package inputs

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, name, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestReadJUnit(t *testing.T) {
	p := write(t, "junit.xml", `<?xml version="1.0"?>
<testsuites tests="4" failures="1">
  <testsuite name="tests/a.test.ts">
    <testcase classname="tests/a.test.ts" name="a &gt; passes"></testcase>
    <testcase classname="tests/a.test.ts" name="a &gt; fails"><failure message="boom"/></testcase>
    <testcase classname="tests/a.test.ts" name="a &gt; errors"><error message="x"/></testcase>
    <testcase classname="tests/a.test.ts" name="a &gt; skipped"><skipped/></testcase>
  </testsuite>
</testsuites>`)
	j, err := ReadJUnit(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(j.Cases) != 4 {
		t.Fatalf("got %d cases, want 4", len(j.Cases))
	}
	failed := j.Failed()
	if len(failed) != 2 || failed[0].Name != "a > fails" || failed[1].Name != "a > errors" {
		t.Errorf("failed = %+v", failed)
	}
	if !j.Cases[3].Skipped {
		t.Error("the fourth case should be skipped")
	}
}

func TestReadJUnitBareSuite(t *testing.T) {
	p := write(t, "junit.xml", `<testsuite name="s"><testcase name="t"/></testsuite>`)
	j, err := ReadJUnit(p)
	if err != nil || len(j.Cases) != 1 || j.Cases[0].Suite != "s" {
		t.Fatalf("got %+v, %v", j, err)
	}
}

func TestLinePct(t *testing.T) {
	p := write(t, "c.json", `{"total":{"lines":{"total":453,"covered":431,"pct":95.14}}}`)
	if got, err := LinePct(p); err != nil || got != 95.14 {
		t.Fatalf("got %v, %v", got, err)
	}
	p = write(t, "c.json", `{"total":{"lines":{"pct":"Unknown"}}}`)
	if _, err := LinePct(p); err == nil {
		t.Fatal("want an error for a non-numeric pct")
	}
}

func TestReadSARIF(t *testing.T) {
	p := write(t, "r.sarif", `{"runs":[{"tool":{"driver":{"rules":[{"id":"r1","defaultConfiguration":{"level":"error"}}]}},
	  "results":[
	    {"ruleId":"r1","message":{"text":"bad"},"locations":[{"physicalLocation":{"artifactLocation":{"uri":"src/a.ts"},"region":{"startLine":3}}}]},
	    {"ruleId":"r2","message":{"text":"meh"}},
	    {"ruleId":"r2","level":"note","message":{"text":"fyi"}}
	  ]}]}`)
	fs, err := ReadSARIF(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(fs) != 3 || fs[0].Level != "error" || fs[0].Path != "src/a.ts" || fs[0].Line != 3 ||
		fs[1].Level != "warning" || fs[2].Level != "note" {
		t.Errorf("got %+v", fs)
	}
}
