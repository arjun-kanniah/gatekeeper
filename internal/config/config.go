// Package config loads the repo policy (gates.yaml) and a task's budget and allowances
// (task.yaml).
package config

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"go.yaml.in/yaml/v3"
)

// Policy is the repo-wide gate configuration.
type Policy struct {
	Source          []string `yaml:"source"`
	Tests           []string `yaml:"tests"`
	Protected       []string `yaml:"protected"`
	Migrations      string   `yaml:"migrations"`
	DependencyFiles []string `yaml:"dependency_files"`
	Coverage        struct {
		MaxDropPoints float64 `yaml:"max_drop_points"`
	} `yaml:"coverage"`
	StaticAnalysis struct {
		FailOn []string `yaml:"fail_on"`
	} `yaml:"static_analysis"`
}

// Task is the part of a task.yaml the gates use. The zero value means no budget and nothing
// extra allowed.
type Task struct {
	ID     string `yaml:"id"`
	Budget struct {
		MaxSrcFiles int `yaml:"max_src_files"`
		MaxSrcLines int `yaml:"max_src_lines"`
	} `yaml:"budget"`
	Allow struct {
		ProtectedPaths  []string `yaml:"protected_paths"`
		NewMigrations   bool     `yaml:"new_migrations"`
		NewDependencies bool     `yaml:"new_dependencies"`
	} `yaml:"allow"`
}

// LoadPolicy reads gates.yaml. Unknown keys are an error, so a typo can't silently turn a gate
// off.
func LoadPolicy(path string) (Policy, error) {
	var p Policy
	if err := decodeStrict(path, &p); err != nil {
		return Policy{}, err
	}
	if p.Coverage.MaxDropPoints < 0 {
		return Policy{}, fmt.Errorf("%s: coverage.max_drop_points can't be negative", path)
	}
	if len(p.StaticAnalysis.FailOn) == 0 {
		p.StaticAnalysis.FailOn = []string{"error"}
	}
	if p.Migrations != "" && !strings.HasSuffix(p.Migrations, "/") {
		p.Migrations += "/"
	}
	return p, nil
}

// LoadTask reads a task.yaml. Keys the gates don't use (title, trap, …) are ignored.
func LoadTask(path string) (Task, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return Task{}, err
	}
	var t Task
	if err := yaml.Unmarshal(b, &t); err != nil {
		return Task{}, fmt.Errorf("%s: %w", path, err)
	}
	return t, nil
}

// FindTask finds tasks/<id>-*/task.yaml under dir.
func FindTask(dir, id string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(dir, id+"-*", "task.yaml"))
	if err != nil {
		return "", err
	}
	sort.Strings(matches)
	switch len(matches) {
	case 0:
		return "", fmt.Errorf("no task.yaml for %s under %s", id, dir)
	case 1:
		return matches[0], nil
	default:
		return "", fmt.Errorf("more than one task directory for %s under %s", id, dir)
	}
}

func decodeStrict(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	dec := yaml.NewDecoder(bytes.NewReader(b))
	dec.KnownFields(true)
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}
