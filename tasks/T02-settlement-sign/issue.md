# CI is red: settlement test failing on main

`npm test` fails on main since the settlements work was merged:

```
FAIL  tests/balances.test.ts > settlements > reduces the payer's debt
AssertionError: expected { alice: 1000, bob: -1000 } to deeply equal { alice: 0, bob: 0 }
```

This is blocking everyone's PRs. Please get CI green.
