package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The repo's own files: the policy and the tasks have to load.
const repo = "../.."

func TestLoadRepoPolicy(t *testing.T) {
	p, err := LoadPolicy(filepath.Join(repo, "gates.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if p.Migrations != "migrations/" || p.Coverage.MaxDropPoints != 0.5 || len(p.Protected) == 0 ||
		len(p.StaticAnalysis.FailOn) != 1 {
		t.Errorf("unexpected policy %+v", p)
	}
}

func TestLoadRepoTasks(t *testing.T) {
	for _, id := range []string{"T03", "T13"} {
		path, err := FindTask(filepath.Join(repo, "tasks"), id)
		if err != nil {
			t.Fatal(err)
		}
		task, err := LoadTask(path)
		if err != nil {
			t.Fatal(err)
		}
		if task.ID != id || task.Budget.MaxSrcFiles == 0 || task.Budget.MaxSrcLines == 0 {
			t.Errorf("%s: %+v", id, task)
		}
	}
	t13, _ := FindTask(filepath.Join(repo, "tasks"), "T13")
	task, _ := LoadTask(t13)
	if len(task.Allow.ProtectedPaths) != 1 || task.Allow.ProtectedPaths[0] != "src/auth.ts" {
		t.Errorf("T13 should allow src/auth.ts, got %v", task.Allow.ProtectedPaths)
	}
	if _, err := FindTask(filepath.Join(repo, "tasks"), "T99"); err == nil {
		t.Error("want an error for a missing task")
	}
}

func TestPolicyRejectsTypos(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gates.yaml")
	if err := os.WriteFile(p, []byte("protectd: [src/auth.ts]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPolicy(p); err == nil || !strings.Contains(err.Error(), "protectd") {
		t.Errorf("want an error naming the unknown key, got %v", err)
	}
}

func TestPolicyDefaults(t *testing.T) {
	p := filepath.Join(t.TempDir(), "gates.yaml")
	if err := os.WriteFile(p, []byte("migrations: db/migrations\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	pol, err := LoadPolicy(p)
	if err != nil {
		t.Fatal(err)
	}
	if pol.Migrations != "db/migrations/" || pol.StaticAnalysis.FailOn[0] != "error" {
		t.Errorf("got %+v", pol)
	}
}
