// Command gatekeeper applies release gates to a change written by a coding agent, and measures
// how well those gates work against hidden acceptance tests.
//
//	gatekeeper check --run runs/<batch>/T03/A-r1 --tasks tasks
//	gatekeeper check --diff change.patch --junit junit.xml --task task.yaml
//	gatekeeper eval runs/<batch>
//
// check exits 0 when every gate passes, 1 when a gate fails, and 2 on a usage or input error,
// so it works as an ordinary CI step.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/arjun-kanniah/gatekeeper/internal/config"
	"github.com/arjun-kanniah/gatekeeper/internal/eval"
	"github.com/arjun-kanniah/gatekeeper/internal/gates"
	"github.com/arjun-kanniah/gatekeeper/internal/run"
)

const usage = `gatekeeper applies release gates to a change and measures how well they work.

Usage:
  gatekeeper check [flags]          gate one change; exit 1 if any gate fails
  gatekeeper eval [flags] <batch>   score the gates over a batch of runs against the hidden tests

Run "gatekeeper <command> -h" for the flags.
`

func main() {
	os.Exit(run_(os.Args[1:], os.Stdout, os.Stderr))
}

// errUsage marks an error that should print the command's flags.
var errUsage = errors.New("usage")

func run_(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	var err error
	var failed bool
	switch args[0] {
	case "check":
		failed, err = check(args[1:], stdout, stderr)
	case "eval":
		err = evaluate(args[1:], stdout, stderr)
	case "-h", "-help", "--help", "help":
		fmt.Fprint(stdout, usage)
		return 0
	default:
		fmt.Fprintf(stderr, "gatekeeper: unknown command %q\n\n%s", args[0], usage)
		return 2
	}
	switch {
	case errors.Is(err, flag.ErrHelp):
		return 0
	case err != nil:
		if !errors.Is(err, errUsage) {
			fmt.Fprintln(stderr, "gatekeeper:", err)
		}
		return 2
	case failed:
		return 1
	}
	return 0
}

func check(args []string, stdout, stderr io.Writer) (bool, error) {
	fs := flag.NewFlagSet("check", flag.ContinueOnError)
	fs.SetOutput(stderr)
	runDir := fs.String("run", "", "a run directory from runner/run-local.sh; fills in every input below that exists in it, and the task from meta.json")
	var p run.Paths
	fs.StringVar(&p.Diff, "diff", "", "the change, as `git diff` output (required unless --run)")
	fs.StringVar(&p.VisibleJUnit, "junit", "", "JUnit XML from the test run")
	fs.StringVar(&p.BaseCoverage, "base-coverage", "", "coverage-summary.json before the change")
	fs.StringVar(&p.HeadCoverage, "head-coverage", "", "coverage-summary.json after the change")
	fs.StringVar(&p.SARIF, "sarif", "", "SARIF from a static-analysis tool such as Semgrep")
	policyPath := fs.String("config", "gates.yaml", "the repo's gate policy")
	taskPath := fs.String("task", "", "task.yaml with the change's budget and allowances")
	tasksDir := fs.String("tasks", "tasks", "with --run: where to find tasks/<id>-*/task.yaml")
	format := fs.String("format", "text", "text or json")
	if err := fs.Parse(args); err != nil {
		return false, err
	}
	if fs.NArg() > 0 {
		return false, fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	if *format != "text" && *format != "json" {
		return false, fmt.Errorf("--format must be text or json, not %q", *format)
	}
	if *runDir != "" {
		found := run.InDir(*runDir)
		fill := func(dst *string, src string) {
			if *dst == "" {
				*dst = src
			}
		}
		fill(&p.Diff, found.Diff)
		fill(&p.VisibleJUnit, found.VisibleJUnit)
		fill(&p.BaseCoverage, found.BaseCoverage)
		fill(&p.HeadCoverage, found.HeadCoverage)
		fill(&p.SARIF, found.SARIF)
		if *taskPath == "" {
			var meta run.Meta
			if b, err := os.ReadFile(filepath.Join(*runDir, run.MetaFile)); err == nil && json.Unmarshal(b, &meta) == nil && meta.Task != "" {
				path, err := config.FindTask(*tasksDir, meta.Task)
				if err != nil {
					return false, err
				}
				*taskPath = path
			}
		}
	}
	if p.Diff == "" {
		fs.Usage()
		return false, fmt.Errorf("%w: --diff or --run is required", errUsage)
	}
	policy, err := config.LoadPolicy(*policyPath)
	if err != nil {
		return false, err
	}
	var task config.Task
	if *taskPath != "" {
		if task, err = config.LoadTask(*taskPath); err != nil {
			return false, err
		}
	}
	in, err := run.Load(p)
	if err != nil {
		return false, err
	}
	report := gates.Run(policy, task, in)
	if *format == "json" {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		if err := enc.Encode(report); err != nil {
			return false, err
		}
	} else {
		writeReport(stdout, report)
	}
	return report.Verdict == gates.Fail, nil
}

func writeReport(w io.Writer, r gates.Report) {
	title := "gatekeeper"
	if r.Task != "" {
		title += " · " + r.Task
	}
	fmt.Fprintf(w, "%s: %s\n\n", title, strings.ToUpper(string(r.Verdict)))
	for _, g := range r.Gates {
		fmt.Fprintf(w, "  %-4s %-20s %s\n", g.Verdict, g.Gate, g.Summary)
		if g.Verdict == gates.Fail {
			for _, e := range g.Evidence {
				fmt.Fprintf(w, "         - %s\n", e)
			}
		}
	}
}

func evaluate(args []string, stdout, stderr io.Writer) error {
	fs := flag.NewFlagSet("eval", flag.ContinueOnError)
	fs.SetOutput(stderr)
	policyPath := fs.String("config", "gates.yaml", "the repo's gate policy")
	tasksDir := fs.String("tasks", "tasks", "where to find tasks/<id>-*/task.yaml")
	format := fs.String("format", "text", "text or json")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 1 {
		fs.Usage()
		return fmt.Errorf("%w: give one batch directory", errUsage)
	}
	if *format != "text" && *format != "json" {
		return fmt.Errorf("--format must be text or json, not %q", *format)
	}
	batch := fs.Arg(0)
	policy, err := config.LoadPolicy(*policyPath)
	if err != nil {
		return err
	}
	dirs, err := run.FindRuns(batch)
	if err != nil {
		return err
	}
	if len(dirs) == 0 {
		return fmt.Errorf("no runs (no meta.json) under %s", batch)
	}
	results := make([]run.Result, 0, len(dirs))
	for _, d := range dirs {
		r, err := run.Evaluate(d, policy, *tasksDir)
		if err != nil {
			return err
		}
		results = append(results, r)
	}
	s := eval.Summarize(results, batch)
	if *format == "json" {
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(s)
	}
	s.WriteText(stdout)
	return nil
}
