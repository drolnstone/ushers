# 05. Plain words, held by a test

**Why.** Asim's rule from Minibus: "Prompts and instructions only. Never
any essays and stories." Minibus keeps every phrase it cut in a test
(`57-plain-alerts.mjs`) so none comes back, and since w2.51.0 checks that
each label says what is behind it (`61-words-match.mjs`).

**Size.** Small. Pages and Worker strings. Bump app and server versions.

## Files
- `server/worker.js`, `index.html`, `admin/index.html`, `shared/core.js`.
- New `tests/suites/05-words.mjs`.

## Steps
1. **Sweep** for sentences that explain the app rather than the duty.
   Known examples (search the quoted text):
   - `"This phone will be told the moment anything new arrives."` in
     `push.what`: the test alert becomes title "Test.", body "".
   - `"saved on this phone — waiting for connection"` and
     `"Saved on device — waiting for connection. It will be sent automatically."`:
     keep the fact, cut the promise, e.g. "Saved on this phone. Not sent yet."
   - `"Asked. You will be told when it is decided."`: "Asked."
   - `"Their reports and dues stay on the record. You can bring them back by ticking Active."`: cut or "Reports and dues kept."
   Keep the faded "e.g." placeholders; they are samples, not explanation.
2. **Banned list**: put every cut phrase in the test; the test fails if any
   appears again in the pages or the Worker.
3. **Words match**: a test that walks `STATUS_LABELS` and each
   notification title made in the Worker and checks it against its
   record's state. At minimum:
   - "Report not yet submitted" is only sent when no report exists or it
     is a draft (already true in `clockTick`; pin it).
   - "Verified" only for a report whose status is verified.
   - "Pending Countersignature" never on a non-Sunday-service event.
4. Ask nothing new of Asim; show before → after in the PR body so he can
   veto any line.

## Acceptance checks
- Each line in the PR body's before → after table is gone from the code.
- Putting any banned phrase back makes the test fail.
- Tests READY.
