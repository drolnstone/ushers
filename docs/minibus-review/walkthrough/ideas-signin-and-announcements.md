# Ideas: the sign-in screen, and announcements

5 October 2026. These are ideas for discussion. Nothing has been built.

---

## A. The sign-in screen

### Ushers today, in both apps
- You choose a name from a list, type your PIN, then tap **Sign in**. (`index.html:77`, `admin/index.html:105`)
- Nothing jumps to the PIN box after you choose a name.
- Nothing signs you in when you type the 4th digit, and the Enter key does nothing.
- The phone doesn't remember who you are. You have to find your name every time.
- The name list arrives only after the server answers, so with poor signal the list starts empty.
- A wrong PIN leaves the digits in the box.

### What Minibus does
This is in `coord/index.html:950-1060` and `:3550`, and in the driver app at `index.html:8985`.
- **The PIN box appears only once a name is chosen.** It takes the cursor straight away, and the focus happens inside the name-change itself so that an **iPhone opens the number keypad**. A focus made a moment later is one iPhones refuse to open the keypad for.
- **Four digits, a short pause (0.6 s), and you're in.** No button needed. Enter also works.
- **The last name is remembered on the phone**, and the name list is kept on the phone, so the screen is ready instantly, with the cursor already in the PIN box.
- **Only digits go in.** Anything else is stripped as you type.
- **No signal is not a wrong PIN.** It says "No signal", not "wrong PIN".

### Proposed for Ushers
1. **Remember me on this phone.** Your name is already chosen when you open the app, with a small "Not you?" link beside it.
2. **The cursor jumps to the PIN box** as soon as a name is chosen, and the number keypad opens on an iPhone.
3. **Auto-enter on the 4th digit**, after a short pause, so a wrong last digit can still be corrected. The Sign in button stays for anyone who prefers it.
4. **A wrong PIN clears the box** and puts the cursor back. "Wrong PIN. 2 tries left."
5. **The name list is kept on the phone**, so it shows at once even with poor signal.
6. **Type to find your name** (filter as you type) once the list is long. Useful when there are 40+ ushers.
7. **The same behaviour in both apps.** Every PIN box (signing a report, countersigning, approving) also auto-enters on the 4th digit, with the cursor already in the box.
8. *Later idea:* **Face ID / fingerprint** ("passkey") instead of the PIN on your own phone. This needs more thought, because the PIN is also your signature on reports.

---

## B. Announcements and repeating events

### Already there
**Admin → Message** sends a title and message to every active usher. It arrives in the app's Notifications, as a phone alert, and by email (`server/worker.js:1809`, `admin/index.html:616`). The basic "type it, press send, it goes to everybody" exists today.

### What could be added

**1. Repeating events in the calendar**
These would be rules in Settings, made automatically like Thanksgiving Sunday is today:
- **Prayer Meeting**: first Saturday of every month, 17:00.
- **Retreat**: first Saturday of September, once a year (or a date range, e.g. Fri–Sun).
- Any other pattern: "every 2nd Sunday", "last Friday", "every Wednesday".

The events then show on Home and in the rota like any other event. Ushers can be put on duty for them, and they get a report if their type needs one.

**2. A reminder pattern, per event type**
The Head Usher sets it once and it repeats by itself. For example:

| Event | Reminders |
|---|---|
| Prayer Meeting (monthly) | Sunday before (after service) · Saturday 09:00 · Saturday 16:00 |
| Retreat (yearly) | 6 weeks before · 2 weeks · 1 week · day before |

- Each reminder goes to **everybody** (or to a chosen group). It arrives in the app, as a phone alert, and by email if alerts are off. Each one goes once only.
- The wording is filled in by itself, for example "Prayer meeting this Saturday, 5pm."
- The pattern can be changed or paused in Settings.

**3. A better Message screen (Admin → Announcements)**
- **Who:** Everybody · on duty this Sunday · First Service team · counters · Head Ushers · chosen people.
- **When:** Send now · **Send later** (a date and time) · **Repeat** (e.g. first Saturday monthly).
- **Pin to Home:** the announcement stays at the top of everyone's Home until a date, e.g. "Retreat 5–7 Sept: register by 20 Aug".
- **Templates:** reuse last month's prayer-meeting message with one tap.
- **Preview** shows how the phone alert will read (the bold title line first).

**4. Who has seen it**
"Seen by 23 of 31", with the names of those who haven't. The Head Usher can then tap **Remind those who haven't seen it**.

**5. "I'll be there" / "Can't make it"** (for the retreat, or a special service)
- One tap from the announcement.
- The Admin App shows the count and names.
- People who haven't answered get one reminder before the deadline.

**6. A calendar file**
Every announcement for an event carries **Add to my calendar** (an .ics with its own alarm). The prayer meeting then sits in each person's phone calendar, repeating monthly.

**7. Quiet hours**
Nothing non-urgent buzzes phones between 21:00 and 08:00. Anything sent then is held until 08:00, and it still shows in the app straight away.

**8. Things to decide**
- Who may send announcements: Head Usher and Assistant only (as today), or the System Administrator too?
- Should repeating reminders also go by email to everyone, or only to people with alerts off (as today)?

---

## Suggested order
1. **Sign-in:** remember me, cursor jump, auto-enter on 4 digits, wrong PIN clears. One small PR, both apps.
2. **Repeating events** (first-Saturday prayer meeting, September retreat) **with a reminder pattern.**
3. **Announcements:** send later, pin to Home, choose who, seen by.
4. **RSVP and calendar file**, when the retreat comes round.

---

## C. Install to phone (added 5 October 2026, evening)

### Ushers today
- No install offer at all. There's no "Add to your phone" sheet and no Install button on Android.
- On an iPhone in Safari, turning alerts on says: "tap Share, then Add to Home Screen" (`shared/core.js:493`, `:536`). That's the only mention of installing.
- The server doesn't know who has installed the app.

### What Minibus does (`index.html:9919-10071`, `sunday/index.html:1646`)
- **Android/Chrome:** a one-tap **Install** button using the phone's own install prompt (`beforeinstallprompt`). It's hidden once installed.
- **iPhone:** a sheet with the steps: Share, Add to Home Screen, then open from there.
- **On a first visit the install offer comes first**, then the alerts question. The two used to race, and the install offer was never seen.
- Once the app is opened from the Home Screen (`display-mode: standalone`), nothing is offered.
- Minibus does **not** track who has installed. Ushers could go one better.

### Proposed for Ushers
1. **"Add Ushers to your phone"** sheet after sign-in, whenever the app is open in a browser tab and not installed. Android gets the one-tap Install button. iPhone gets the 3 steps with pictures (Share icon, Add to Home Screen, open from Home Screen). "Not now" hides it until the next time the app is opened, as the alerts question does today.
2. **Order:** install first, then turn on alerts. On an iPhone, alerts don't work until the app is installed.
3. **The server records it.** Each sign-in or open sends "installed: yes/no" for that phone, so the server knows who has installed on at least one phone.
4. **Admin → Ushers marks "Not installed"** beside "Alerts off", with a count: "Installed: 24 of 31".
5. **Reminders for those not installed:** a notification and email with the steps, at most once a week, stopping once they've installed. Admin → Ushers gets a **Send install steps** button for one person or for everyone not yet installed.
6. **Check everything** on the sheet lists "Not installed: …" under *Still to do*, not as a fault.
7. **A one-page "How to install" guide** (PDF or a page in the app) to share on WhatsApp at onboarding, with iPhone and Android pictures.
8. **The Admin App** gets its own install offer, with its own aubergine icon, so a Head Usher can have both apps on their Home Screen.
