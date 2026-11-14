// Package inputs reads the tool outputs the gates judge: JUnit XML, Istanbul/Vitest
// coverage-summary.json and SARIF. Gatekeeper never runs these tools itself.
package inputs

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"os"
)

// TestCase is one test from a JUnit report.
type TestCase struct {
	Suite   string
	Name    string
	Failed  bool // a <failure> or an <error>
	Skipped bool
}

// JUnit is a parsed JUnit report.
type JUnit struct {
	Cases []TestCase
}

// Failed returns the failing test cases.
func (j JUnit) Failed() []TestCase {
	var out []TestCase
	for _, c := range j.Cases {
		if c.Failed {
			out = append(out, c)
		}
	}
	return out
}

type junitCase struct {
	Classname string     `xml:"classname,attr"`
	Name      string     `xml:"name,attr"`
	Failures  []struct{} `xml:"failure"`
	Errors    []struct{} `xml:"error"`
	Skipped   *struct{}  `xml:"skipped"`
}

type junitSuite struct {
	Name   string       `xml:"name,attr"`
	Cases  []junitCase  `xml:"testcase"`
	Suites []junitSuite `xml:"testsuite"`
}

// ReadJUnit reads a JUnit XML file. Both a <testsuites> root and a bare <testsuite> work.
func ReadJUnit(path string) (JUnit, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return JUnit{}, err
	}
	var root junitSuite
	if err := xml.Unmarshal(b, &root); err != nil {
		return JUnit{}, fmt.Errorf("%s: %w", path, err)
	}
	var j JUnit
	var walk func(s junitSuite)
	walk = func(s junitSuite) {
		for _, c := range s.Cases {
			suite := c.Classname
			if suite == "" {
				suite = s.Name
			}
			j.Cases = append(j.Cases, TestCase{
				Suite: suite, Name: c.Name,
				Failed:  len(c.Failures) > 0 || len(c.Errors) > 0,
				Skipped: c.Skipped != nil,
			})
		}
		for _, sub := range s.Suites {
			walk(sub)
		}
	}
	walk(root)
	return j, nil
}

// LinePct reads the total line coverage percentage from a coverage-summary.json.
func LinePct(path string) (float64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	var s struct {
		Total struct {
			Lines struct {
				Pct json.Number `json:"pct"`
			} `json:"lines"`
		} `json:"total"`
	}
	if err := json.Unmarshal(b, &s); err != nil {
		return 0, fmt.Errorf("%s: %w", path, err)
	}
	pct, err := s.Total.Lines.Pct.Float64()
	if err != nil {
		return 0, fmt.Errorf("%s: total.lines.pct is %q, not a number", path, s.Total.Lines.Pct)
	}
	return pct, nil
}

// Finding is one SARIF result.
type Finding struct {
	Rule    string
	Level   string // error, warning, note or none
	Message string
	Path    string
	Line    int
}

// ReadSARIF reads every result from every run in a SARIF file. A result without its own level
// takes its rule's default level, and "warning" if that isn't set either, as SARIF specifies.
func ReadSARIF(path string) ([]Finding, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc struct {
		Runs []struct {
			Tool struct {
				Driver struct {
					Rules []struct {
						ID     string `json:"id"`
						Config struct {
							Level string `json:"level"`
						} `json:"defaultConfiguration"`
					} `json:"rules"`
				} `json:"driver"`
			} `json:"tool"`
			Results []struct {
				RuleID  string `json:"ruleId"`
				Level   string `json:"level"`
				Message struct {
					Text string `json:"text"`
				} `json:"message"`
				Locations []struct {
					Physical struct {
						Artifact struct {
							URI string `json:"uri"`
						} `json:"artifactLocation"`
						Region struct {
							StartLine int `json:"startLine"`
						} `json:"region"`
					} `json:"physicalLocation"`
				} `json:"locations"`
			} `json:"results"`
		} `json:"runs"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	var out []Finding
	for _, run := range doc.Runs {
		defaults := map[string]string{}
		for _, r := range run.Tool.Driver.Rules {
			defaults[r.ID] = r.Config.Level
		}
		for _, r := range run.Results {
			f := Finding{Rule: r.RuleID, Level: r.Level, Message: r.Message.Text}
			if f.Level == "" {
				f.Level = defaults[r.RuleID]
			}
			if f.Level == "" {
				f.Level = "warning"
			}
			if len(r.Locations) > 0 {
				f.Path = r.Locations[0].Physical.Artifact.URI
				f.Line = r.Locations[0].Physical.Region.StartLine
			}
			out = append(out, f)
		}
	}
	return out, nil
}
