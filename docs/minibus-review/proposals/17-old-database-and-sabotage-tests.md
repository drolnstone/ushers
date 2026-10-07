# 17. Old-database test and sabotage checks

From the walkthrough, section 3 (old database) and 4.10 (sabotage).

**Why.**
- Minibus's `05-migration.mjs` lesson: always test against a database
  older than the code. The Worker adds tables and columns on first call
  (`schema` setting check, search `setting(env, "schema") === SERVER_VERSION`).
  Ushers `50-new.mjs` does this for amendments only.
- Minibus's `tests/browser/sabotage.mjs` takes each fix back out of a
  scratch copy and checks the test written for it goes red, so a test that
  passes for the wrong reason is caught.

**Size.** Small (old database) and medium (sabotage). Tests only, no
version bump.

## Part A. Old database (do now)
- Keep a fixture `tests/fixtures/schema-v0.3.0.sql` (the schema as it was
  at an earlier release: `git show <tag-or-commit>:server/schema.sql`).
- New suite `04-old-database.mjs`: load the old schema with a few rows
  (an usher, an event, a report, a push sub), then run the current Worker:
  sign in, open Home, submit a report, read notifications.
- Each release that changes `schema.sql` refreshes nothing: the fixture
  stays old on purpose. Add a newer one only when the old one is no
  longer a possible live state.
- Accept: deleting an `ALTER TABLE … ADD COLUMN` line from the Worker's
  upgrade code makes the suite fail.

## Part B. Sabotage (later, once there are a few real fixes to guard)
- `tests/browser/sabotage.mjs`: a list of `{ file, find, replace, suite }`,
  each undoing one past fix (e.g. brief 01's removal notice). For each,
  copy the repo to a temp folder, apply the replace, run that suite, and
  expect it to fail.
- Accept: every entry goes red; a mis-written test that stays green is
  reported by name.
