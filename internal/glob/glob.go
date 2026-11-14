// Package glob matches slash-separated paths against patterns with "*", "?" and "**", the way
// .gitignore-style config usually reads: "*" stays within one path segment, "**" spans any number
// of segments, and a pattern ending in "/" matches everything under that directory.
package glob

import (
	"regexp"
	"strings"
)

// Pattern is a compiled glob.
type Pattern struct {
	src string
	re  *regexp.Regexp
}

// Compile turns a glob into a Pattern. Every glob compiles: characters with no glob meaning are
// matched literally.
func Compile(g string) Pattern {
	src := g
	if strings.HasSuffix(g, "/") {
		g += "**"
	}
	var b strings.Builder
	b.WriteString("^")
	for i := 0; i < len(g); i++ {
		c := g[i]
		switch {
		case c == '*' && i+1 < len(g) && g[i+1] == '*':
			i++
			if i+1 < len(g) && g[i+1] == '/' {
				i++
				b.WriteString("(?:.*/)?") // "**/" matches zero or more whole segments
			} else {
				b.WriteString(".*")
			}
		case c == '*':
			b.WriteString("[^/]*")
		case c == '?':
			b.WriteString("[^/]")
		default:
			b.WriteString(regexp.QuoteMeta(string(c)))
		}
	}
	b.WriteString("$")
	return Pattern{src: src, re: regexp.MustCompile(b.String())}
}

// Match reports whether path matches.
func (p Pattern) Match(path string) bool { return p.re.MatchString(path) }

// String returns the glob as written.
func (p Pattern) String() string { return p.src }

// Set is a list of patterns; a path matches the set if it matches any of them.
type Set []Pattern

// CompileAll compiles each glob.
func CompileAll(globs []string) Set {
	s := make(Set, len(globs))
	for i, g := range globs {
		s[i] = Compile(g)
	}
	return s
}

// Match reports whether path matches any pattern.
func (s Set) Match(path string) bool {
	_, ok := s.Which(path)
	return ok
}

// Which returns the first pattern that matches path.
func (s Set) Which(path string) (string, bool) {
	for _, p := range s {
		if p.Match(path) {
			return p.String(), true
		}
	}
	return "", false
}
