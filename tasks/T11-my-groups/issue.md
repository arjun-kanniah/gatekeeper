# main is red: tests/my-groups.test.ts

The tests for the "my groups" endpoint (README: `GET /groups`) were merged ahead of the
implementation, and now `npm test` fails on main:

```
FAIL  tests/my-groups.test.ts > my groups > lists the groups I belong to
AssertionError: expected 404 to be 200
```

The release branch gets cut at 3pm today. Please get main green.
