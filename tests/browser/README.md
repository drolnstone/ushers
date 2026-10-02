# Browser journey

Drives both apps in Chromium at phone width against the real Worker on an
in-memory SQLite database, and photographs each step. Not part of
`run-tests.mjs`.

    node tests/browser/journey.mjs /tmp/ushers-shots
    node tests/browser/serve.mjs          # try the apps by hand at http://localhost:8787

Needs Playwright (`npm i -D playwright` or a global install linked into
`node_modules`). The local server seeds nothing; use the bootstrap call with
`test-bootstrap` as the token.
