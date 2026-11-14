// Package diff parses the unified diff that `git diff` prints, keeping what the gates need: each
// file's path and status, and its added and removed lines.
package diff

import (
	"bufio"
	"fmt"
	"io"
	"strings"
)

// Status is how a file changed, using git's letters.
type Status string

const (
	Added    Status = "A"
	Modified Status = "M"
	Deleted  Status = "D"
	Renamed  Status = "R"
)

// File is one file in the diff.
type File struct {
	Path    string // the path after the change; for a deleted file, the path it had
	OldPath string // the path before the change; differs from Path only for a rename
	Status  Status
	Binary  bool
	Added   []string // added lines, without the leading "+"
	Removed []string // removed lines, without the leading "-"
}

// Touches reports whether the change affects path, before or after (so a rename out of a
// protected directory still counts).
func (f File) Touches(match func(string) bool) bool {
	return match(f.Path) || (f.OldPath != "" && match(f.OldPath))
}

// Parse reads a diff produced by `git diff` (with or without rename detection).
func Parse(r io.Reader) ([]File, error) {
	var files []File
	var cur *File
	inHunk := false
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "diff --git ") {
			a, b, err := splitHeader(strings.TrimPrefix(line, "diff --git "))
			if err != nil {
				return nil, err
			}
			files = append(files, File{Path: b, OldPath: a, Status: Modified})
			cur = &files[len(files)-1]
			inHunk = false
			continue
		}
		if cur == nil {
			continue // anything before the first file header
		}
		if inHunk {
			switch {
			case strings.HasPrefix(line, "+"):
				cur.Added = append(cur.Added, line[1:])
				continue
			case strings.HasPrefix(line, "-"):
				cur.Removed = append(cur.Removed, line[1:])
				continue
			case strings.HasPrefix(line, " "), line == "", strings.HasPrefix(line, `\`):
				continue // context, or "\ No newline at end of file"
			}
			inHunk = false // a header line: the hunk is over
		}
		switch {
		case strings.HasPrefix(line, "@@"):
			inHunk = true
		case strings.HasPrefix(line, "new file mode"):
			cur.Status = Added
		case strings.HasPrefix(line, "deleted file mode"):
			cur.Status = Deleted
		case strings.HasPrefix(line, "rename from "):
			cur.Status = Renamed
			cur.OldPath = strings.TrimPrefix(line, "rename from ")
		case strings.HasPrefix(line, "rename to "):
			cur.Path = strings.TrimPrefix(line, "rename to ")
		case strings.HasPrefix(line, "Binary files "), line == "GIT binary patch":
			cur.Binary = true
		}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	for i := range files {
		if files[i].Status != Renamed {
			files[i].OldPath = files[i].Path
		}
	}
	return files, nil
}

// splitHeader splits "a/x b/x" into its two paths. Paths with spaces are ambiguous in this line,
// but a non-rename has the same path on both sides, so split at the middle in that case.
func splitHeader(s string) (string, string, error) {
	if !strings.HasPrefix(s, "a/") {
		return "", "", fmt.Errorf("unexpected diff header %q", s)
	}
	if n := len(s); n%2 == 1 {
		half := (n - 1) / 2
		if s[half] == ' ' && s[half+1:half+3] == "b/" && s[2:half] == s[half+3:] {
			return s[2:half], s[half+3:], nil
		}
	}
	i := strings.Index(s, " b/")
	if i < 0 {
		return "", "", fmt.Errorf("unexpected diff header %q", s)
	}
	return s[2:i], s[i+3:], nil
}

// Lines is the number of added plus removed lines, as `git diff --numstat` counts them.
func (f File) Lines() int { return len(f.Added) + len(f.Removed) }
