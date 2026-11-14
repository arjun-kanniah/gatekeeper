package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

const fixtures = "../../internal/run/testdata"

func cli(args ...string) (int, string, string) {
	var out, errOut bytes.Buffer
	code := run_(args, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestCheckExitCodes(t *testing.T) {
	common := []string{"--config", fixtures + "/gates.yaml", "--tasks", fixtures + "/tasks"}
	cases := []struct {
		run  string
		code int
		want string
	}{
		{"A-r1", 0, "PASS"},
		{"B-r1", 0, "PASS"}, // check can't see the hidden tests; that's what eval is for
		{"C-r1", 1, "modified tests/helpers.ts"},
	}
	for _, c := range cases {
		code, out, errOut := cli(append([]string{"check", "--run", fixtures + "/batch/T13/" + c.run}, common...)...)
		if code != c.code || !strings.Contains(out, c.want) {
			t.Errorf("%s: exit %d, want %d; output:\n%s%s", c.run, code, c.code, out, errOut)
		}
	}
}

func TestCheckExplicitInputsJSON(t *testing.T) {
	dir := fixtures + "/batch/T13/C-r1"
	code, out, errOut := cli("check", "--config", fixtures+"/gates.yaml", "--diff", dir+"/diff.patch",
		"--junit", dir+"/visible-junit.xml", "--format", "json")
	if code != 1 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	var r struct {
		Verdict string
		Gates   []struct{ Gate, Verdict string }
	}
	if err := json.Unmarshal([]byte(out), &r); err != nil {
		t.Fatal(err, out)
	}
	// Without a task, src/auth.ts isn't allowed either, and there's no budget.
	verdicts := map[string]string{}
	for _, g := range r.Gates {
		verdicts[g.Gate] = g.Verdict
	}
	if r.Verdict != "fail" || verdicts["protected-paths"] != "fail" || verdicts["diff-size"] != "skip" {
		t.Errorf("got %+v", r)
	}
}

func TestUsageErrors(t *testing.T) {
	for _, args := range [][]string{
		nil,
		{"frobnicate"},
		{"check"},
		{"check", "--diff", "nope.patch", "--config", fixtures + "/gates.yaml"},
		{"check", "--diff", "x", "--format", "yaml"},
		{"eval"},
		{"eval", fixtures + "/tasks", "--config", fixtures + "/gates.yaml"}, // flags after the arg
	} {
		if code, _, _ := cli(args...); code != 2 {
			t.Errorf("%v: exit %d, want 2", args, code)
		}
	}
	if code, out, _ := cli("help"); code != 0 || !strings.Contains(out, "gatekeeper check") {
		t.Errorf("help: exit %d", code)
	}
}

func TestEval(t *testing.T) {
	code, out, errOut := cli("eval", "--config", fixtures+"/gates.yaml", "--tasks", fixtures+"/tasks", fixtures+"/batch")
	if code != 0 {
		t.Fatalf("exit %d: %s", code, errOut)
	}
	for _, want := range []string{"escaped         T13/B-r1", "blocked-correct T13/C-r1"} {
		if !strings.Contains(out, want) {
			t.Errorf("output lacks %q:\n%s", want, out)
		}
	}
}
