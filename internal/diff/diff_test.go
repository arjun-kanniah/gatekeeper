package diff

import (
	"reflect"
	"strings"
	"testing"
)

const sample = `diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1,3 +1,3 @@
 # Tally
-old line
+new line
 end
diff --git a/migrations/002_notes.sql b/migrations/002_notes.sql
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/migrations/002_notes.sql
@@ -0,0 +1,2 @@
+ALTER TABLE expenses ADD COLUMN notes TEXT;
+-- a SQL comment starting with two dashes
diff --git a/tests/old.test.ts b/tests/old.test.ts
deleted file mode 100644
index 4444444..0000000
--- a/tests/old.test.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-it("works", () => {});
--- removed line that starts with two dashes
diff --git a/src/a b.ts b/src/a b.ts
index 5555555..6666666 100644
--- a/src/a b.ts
+++ b/src/a b.ts
@@ -1 +1 @@
-x
\ No newline at end of file
+y
diff --git a/src/old.ts b/src/new.ts
similarity index 90%
rename from src/old.ts
rename to src/new.ts
index 7777777..8888888 100644
--- a/src/old.ts
+++ b/src/new.ts
@@ -1 +1 @@
-export const a = 1;
+export const a = 2;
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..9999999
Binary files /dev/null and b/logo.png differ
`

func TestParse(t *testing.T) {
	files, err := Parse(strings.NewReader(sample))
	if err != nil {
		t.Fatal(err)
	}
	want := []File{
		{Path: "README.md", OldPath: "README.md", Status: Modified, Added: []string{"new line"}, Removed: []string{"old line"}},
		{Path: "migrations/002_notes.sql", OldPath: "migrations/002_notes.sql", Status: Added,
			Added: []string{"ALTER TABLE expenses ADD COLUMN notes TEXT;", "-- a SQL comment starting with two dashes"}},
		{Path: "tests/old.test.ts", OldPath: "tests/old.test.ts", Status: Deleted,
			Removed: []string{`it("works", () => {});`, "-- removed line that starts with two dashes"}},
		{Path: "src/a b.ts", OldPath: "src/a b.ts", Status: Modified, Added: []string{"y"}, Removed: []string{"x"}},
		{Path: "src/new.ts", OldPath: "src/old.ts", Status: Renamed, Added: []string{"export const a = 2;"}, Removed: []string{"export const a = 1;"}},
		{Path: "logo.png", OldPath: "logo.png", Status: Added, Binary: true},
	}
	if len(files) != len(want) {
		t.Fatalf("got %d files, want %d: %+v", len(files), len(want), files)
	}
	for i := range want {
		if !reflect.DeepEqual(files[i], want[i]) {
			t.Errorf("file %d:\n got  %+v\n want %+v", i, files[i], want[i])
		}
	}
}

func TestParseEmpty(t *testing.T) {
	files, err := Parse(strings.NewReader(""))
	if err != nil || len(files) != 0 {
		t.Fatalf("got %v, %v; want no files", files, err)
	}
}

func TestTouchesRename(t *testing.T) {
	f := File{Path: "src/new.ts", OldPath: "migrations/001.sql", Status: Renamed}
	if !f.Touches(func(p string) bool { return strings.HasPrefix(p, "migrations/") }) {
		t.Error("a rename out of migrations/ should count as touching it")
	}
}
