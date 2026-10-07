# 04. Faster sign-in

**Why.** Today both apps: choose a name, type the PIN, tap Sign in. Nothing
remembers the name, the cursor does not move to the PIN, the 4th digit
does nothing, a wrong PIN stays in the box, and the name list is empty
until the server answers. Minibus (`coord/index.html` around lines
950-1060, driver `index.html` around 8985) does all of these.

**Size.** Small to medium. Pages only. Bump `APP_VERSION` and `CACHE`.

## Files
- `index.html`: `function signIn()` (the `who`, `pin`, `go` elements and
  `C.api("people")`).
- `admin/index.html`: its sign-in (search `"Sign in"`).
- `shared/core.js`: add the shared helpers below, next to `rememberPin`.
- `tests/browser/journey.mjs` and a unit suite if the helpers are pure.

## Steps
1. **Shared helper** in `shared/core.js`: `C.pinBox(input, onFour)` that
   strips non-digits on `input`, and when the value reaches 4 digits waits
   600 ms and calls `onFour()` unless the value changed. Enter also calls
   it. Use it on every PIN box: sign-in, sign and submit, countersign,
   approve, change PIN.
2. **Remember the name**: on a successful login store the usher id under
   a key such as `ushers.lastWho` (use the `C.store` wrapper, which already
   survives private mode). On the next sign-in, select it and show a
   small "Not you?" link that clears it.
3. **Cache the list**: store the last `people` answer and paint it at once;
   replace it when the server answers.
4. **Focus**: call `pin.focus()` inside the `change` handler of `who`
   itself, not in a timeout, so an iPhone opens the number pad.
5. **Wrong PIN**: clear the box, focus it, keep the "n tries left" message.
6. **No signal** stays "No connection…", never a wrong-PIN message (it is
   already a separate branch; keep it).
7. The Sign in button stays.
7a. **Type to find your name**: once the list passes about 15 names, a
   filter box above it narrows the list as you type.
8. Do the same in `admin/index.html`, sharing the helpers.

## Later, not in this PR
Face ID or fingerprint (a passkey) instead of the PIN on your own phone.
Needs thought first, because the PIN is also the signature on reports.

## Acceptance checks
- Second visit on the same phone: the name is already chosen and the
  cursor is in the PIN box.
- Typing 4 digits signs in after a short pause, with no tap.
- Letters typed into a PIN box do not appear.
- A wrong PIN empties the box and shows tries left.
- With the server unreachable, the cached names still show.
- Countersign and approve PIN boxes also auto-enter.
- With 40 names, typing "jo" leaves only names containing "jo".
- Tests READY; browser journey still passes.
