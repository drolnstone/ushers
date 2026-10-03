/* Drives both apps in Chromium through the MVP journey, at phone width,
   and photographs each step. Not part of the test run.

     node tests/browser/journey.mjs [shots-dir]
*/
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { start } from "./serve.mjs";
import { realFetch } from "../lib/worker.mjs";

const SHOTS = process.argv[2] || "/tmp/ushers-shots";
mkdirSync(SHOTS, { recursive: true });
const PORT = 8790, BASE = "http://localhost:" + PORT;
const { server, env, mod } = await start(PORT);

async function api(action, body, token) {
  const r = await realFetch(BASE + "/api/" + action, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, token ? { authorization: "Bearer " + token } : {}), body: JSON.stringify(body || {}) });
  return r.json();
}
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
let n = 0;
const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-${name}.png`, fullPage: true }); };

// First-time setup, on the sign-in screen.
await page.goto(BASE + "/");
await page.waitForSelector("text=First-time setup");
await page.fill("#bt", "test-bootstrap"); await page.fill("#bn", "Sam Admin"); await page.fill("#bp1", "9999"); await page.fill("#bp2", "9999");
await shot("first-time-setup");
await page.click("text=Create the System Administrator");
await page.waitForSelector("text=You are the System Administrator");
const admin = (await api("login", { usherId: "U001", pin: "9999" })).token;
const ids = {};
for (const [k, n] of [["hu", "Grace Okafor"], ["A", "John Smith"], ["B", "Mary Jones"], ["C", "Peter Brown"], ["T", "Ruth Adeyemi"]]) {
  ids[k] = (await api("usher.save", { name: n, pin: "1234", mustChange: false, email: k + "@example.org" }, admin)).usherId;
}
await api("usher.roles", { usherId: ids.hu, roles: ["usher", "head_usher"] }, admin);
await api("usher.roles", { usherId: ids.T, roles: ["usher", "treasurer"] }, admin);

const today = mod.londonKey(new Date());
const focus = mod.sundayOnOrBefore(today);
const noUcodes = async (where) => {
  const t = await page.evaluate(() => document.body.innerText);
  if (/\bU\d{3}\b/.test(t)) throw new Error("U-code visible on " + where);
};

async function signIn(name, pin) {
  await page.goto(BASE + "/");
  await page.evaluate(() => localStorage.removeItem("ushers.session.v1"));
  await page.goto(BASE + "/");
  await page.waitForSelector("#who option:nth-child(2)", { state: "attached" });
  await page.selectOption("#who", { label: name });
  await page.fill("#pin", pin || "1234");
  await page.click("button:has-text('Sign in')");
  await page.waitForSelector("text=What am I doing?");
}

// Head Usher: Ushers App, then Admin App with no second sign-in, then the rota.
await signIn("Grace Okafor");
await shot("hu-home");
await page.click("#toAdmin");
await page.waitForSelector("text=Needs your attention");
await shot("admin-dashboard-empty");
await page.goto(BASE + "/admin/#rota/" + focus);
await page.waitForSelector("text=Sunday First Service");
const cards = page.locator(".card", { hasText: "Choose who is on duty" });
await cards.locator("label", { hasText: "John Smith" }).locator("input").check();
await cards.locator("label", { hasText: "Peter Brown" }).locator("input").check();
await cards.locator("button", { hasText: "Save" }).click();
await cards.locator("text=Saved.").waitFor();
const second = page.locator(".card", { hasText: "Exactly 2 offering counters" });
await second.locator("label", { hasText: "John Smith" }).locator("input").check();
await second.locator("button", { hasText: "Save" }).click();
await second.locator(".msg.bad").waitFor();
await shot("admin-rota-one-counter-refused");
await second.locator("label", { hasText: "Mary Jones" }).locator("input").check();
await second.locator("button", { hasText: "Save" }).click();
await second.locator("text=Saved.").waitFor();
await shot("admin-rota-saved");

// Person A: duties, the report, totals, countersigner, sign.
await signIn("John Smith");
await noUcodes("home");
await shot("a-home");
await page.click(`a[href="#report/S${focus.replace(/-/g, "")}-1"]`);
await page.waitForSelector("#att-male");
await page.fill("#att-male", "10"); await page.fill("#att-female", "12"); await page.fill("#att-children", "5");
await page.fill("#min-minister", "Pastor Ade"); await page.fill("#min-sermon_title", "Faithful in little"); await page.fill("#min-first_timers", "3");
await page.selectOption("#cat", "General Offering"); await page.selectOption("#den", "2000"); await page.fill("#qty", "10"); await page.click("text=Add line");
await page.selectOption("#cat", "Tithe"); await page.selectOption("#den", "500"); await page.fill("#qty", "3"); await page.click("text=Add line");
const total = await page.textContent(".total");
if (total.trim() !== "27") throw new Error("attendance total shows " + total);
await page.waitForSelector("#cs option:nth-child(3)", { state: "attached" });
await page.selectOption("#cs", { label: "Mary Jones" });
await page.fill("#sig", "John Smith"); await page.check("#agree"); await page.fill("#spin", "1234");
await shot("a-report-filled");
await page.click("text=Sign and submit");
await page.waitForSelector("text=Pending Countersignature");
await page.waitForSelector("text=Faithful in little");
await noUcodes("report");
await shot("a-report-pending");

// Offline: the Second Service report signed with no signal, sent later.
await page.goto(BASE + "/#report/S" + focus.replace(/-/g, "") + "-2");
await page.waitForSelector("#cat");
await page.fill("#att-male", "20"); await page.fill("#att-female", "25"); await page.fill("#att-children", "9");
await page.fill("#min-minister", "Pastor Bisi");
await page.selectOption("#cat", "Vow"); await page.selectOption("#den", "5000"); await page.fill("#qty", "2"); await page.click("text=Add line");
await page.waitForSelector("#cs option:nth-child(3)", { state: "attached" });
await page.selectOption("#cs", { label: "Mary Jones" });
await page.fill("#sig", "John Smith"); await page.check("#agree"); await page.fill("#spin", "1234");
await context.setOffline(true);
await page.click("text=Sign and submit");
await page.waitForSelector("text=Saved on device");
await shot("a-offline-saved");
await context.setOffline(false);
await page.evaluate(() => window.UshersCore.flush());
await page.waitForTimeout(500);
const sent = env.DB._one("SELECT status, submit_pin_check FROM reports WHERE event_id=?", "S" + focus.replace(/-/g, "") + "-2");
if (!sent || sent.submit_pin_check !== "device") throw new Error("offline report did not arrive: " + JSON.stringify(sent));

// Head Usher approves Mary as countersigner.
await signIn("Grace Okafor");
await page.goto(BASE + "/admin/#approvals");
await page.waitForSelector("text=Countersign a report");
const card = page.locator(".card", { hasText: "Countersign a report" }).first();
await card.locator("input[type=password]").fill("1234");
await shot("admin-approval");
await card.locator("button", { hasText: "Approve" }).click();
await page.waitForTimeout(400);

// Person B countersigns.
await signIn("Mary Jones");
await shot("b-home");
await page.click("text=Review and countersign");
await page.waitForSelector("#csig");
await page.check(".card:has(#csig) input[type=checkbox]");
await page.fill("#csig", "Mary Jones"); await page.fill("#cpin", "1234");
await shot("b-review");
await page.click("button:has-text('Countersign')");
await page.waitForSelector(".chip.status-verified");
await shot("b-verified");
const [pdf1] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('PDF')")]);
if (!/^Ushering - Sunday First Service.* - \d{4}-\d\d-\d\d\.pdf$/.test(pdf1.suggestedFilename())) throw new Error("PDF name " + pdf1.suggestedFilename());
await pdf1.saveAs(SHOTS + "/service-report.pdf");

// Alerts card on the Notifications screen.
await page.goto(BASE + "/#notes");
await page.waitForSelector("text=Alerts on this phone");
await page.waitForSelector("button:has-text('Turn on alerts on this phone')");
await shot("b-alerts");

// John asks to amend; the Head Usher approves; John amends; Peter countersigns.
await signIn("John Smith");
await page.goto(BASE + "/#report/S" + focus.replace(/-/g, "") + "-1");
await page.waitForSelector("#amend-why");
await page.fill("#amend-why", "Ten more men were counted late");
await page.click("button:has-text('Ask to amend')");
await page.waitForSelector("text=Asked.");
await signIn("Grace Okafor");
await page.goto(BASE + "/admin/#approvals");
const amendCard = page.locator(".card", { hasText: "Amend a report" }).first();
await amendCard.waitFor();
await amendCard.locator("input[type=password]").fill("1234");
await amendCard.locator("button", { hasText: "Approve" }).click();
await page.waitForTimeout(400);
await signIn("John Smith");
await page.goto(BASE + "/#report/S" + focus.replace(/-/g, "") + "-1");
await page.click("button:has-text('Amend report')");
await page.waitForSelector("#why-amend");
if (await page.inputValue("#min-minister") !== "Pastor Ade") throw new Error("amend form does not start from the current version");
await page.fill("#why-amend", "Ten more men were counted late");
await page.fill("#att-male", "20");
await page.waitForSelector("#cs option:nth-child(3)", { state: "attached" });
await page.selectOption("#cs", { label: "Peter Brown" });
await page.fill("#sig", "John Smith"); await page.check("#agree"); await page.fill("#spin", "1234");
await shot("a-amend-form");
await page.click("button:has-text('Sign and submit amendment')");
await page.waitForSelector("text=Amended · version 2");
await page.waitForSelector("text=Earlier versions");
await shot("a-amended");
await signIn("Peter Brown");
await page.click("text=Review and countersign");
await page.waitForSelector("#csig");
await page.check(".card:has(#csig) input[type=checkbox]");
await page.fill("#csig", "Peter Brown"); await page.fill("#cpin", "1234");
await page.click("button:has-text('Countersign')");
await page.waitForSelector(".chip.status-verified");
if (env.DB._one("SELECT version, attendance_total FROM reports WHERE event_id=?", "S" + focus.replace(/-/g, "") + "-1").attendance_total !== 37) throw new Error("amendment not saved");

// A Prayer Meeting needs no countersignature: John signs and it is filed.
const huTok = (await api("login", { usherId: ids.hu, pin: "1234" })).token;
const prayer = (await api("event.save", { type: "PRAYER", date: today }, huTok)).eventId;
await api("rota.set", { eventId: prayer, usherIds: [ids.A] }, huTok);
await signIn("John Smith");
await page.goto(BASE + "/#report/" + prayer);
await page.waitForSelector("#att-male");
if (await page.locator("#cs").count()) throw new Error("a Prayer Meeting report asks for a countersigner");
await page.fill("#att-male", "4"); await page.fill("#att-female", "6"); await page.fill("#att-children", "2");
await page.fill("#sig", "John Smith"); await page.check("#agree"); await page.fill("#spin", "1234");
await page.click("text=Sign and submit");
await page.waitForSelector(".chip.status-verified");
await shot("a-prayer-filed");

// Dashboard; the Head Usher's notifications; Treasurer boundary.
await signIn("Grace Okafor");
await page.goto(BASE + "/admin/#dashboard");
await page.waitForSelector("text=Next Sunday");
await page.waitForSelector("#unread:not([hidden])");
await shot("admin-dashboard");
await page.click("nav.tabs a:has-text('Notifications')");
await page.waitForSelector("text=Report filed: Prayer Meeting");
await page.waitForSelector("text=Report filed: Sunday First Service");
await page.waitForSelector("text=Alerts on this device");
await shot("admin-notifications");
await page.locator(".card", { hasText: "Report filed: Prayer Meeting" }).locator("a", { hasText: "Open" }).click();
await page.waitForSelector("text=John Smith");
await page.waitForSelector(".chip.status-verified");
await shot("admin-filed-report");
await page.goto(BASE + "/admin/#reports");
await page.waitForSelector("text=Summary for a period");
await page.fill("#pfrom", focus);
const [pdf2] = await Promise.all([page.waitForEvent("download"), page.click("button:has-text('Make PDF summary')")]);
if (!/^Ushering - Summary - /.test(pdf2.suggestedFilename())) throw new Error("summary PDF name " + pdf2.suggestedFilename());
await pdf2.saveAs(SHOTS + "/summary.pdf");
await shot("admin-reports");
if (await page.locator("nav.tabs a", { hasText: "Treasurer" }).count()) throw new Error("Head Usher sees Treasurer");
await signIn("Ruth Adeyemi");
if (await page.locator("#toAdmin").isVisible()) throw new Error("the Treasurer sees Open Admin App");
await page.goto(BASE + "/#treasurer/" + ids.A);
await page.waitForSelector("text=Record a payment");
await page.click("text=Record payment");
await page.waitForTimeout(500);
await shot("treasurer");
await page.goto(BASE + "/#dues");
await page.waitForSelector("text=My dues");
await shot("treasurer-own-dues");

// The System Administrator's testing tools, on a fresh database: six test
// people and a sample week, then each role as that role sees it.
const fresh = await start(PORT + 1);
const B2 = "http://localhost:" + (PORT + 1);
async function signIn2(name, pin) {
  await page.goto(B2 + "/");
  await page.evaluate(() => localStorage.removeItem("ushers.session.v1"));
  await page.goto(B2 + "/");
  await page.waitForSelector("#who option:nth-child(2)", { state: "attached" });
  await page.selectOption("#who", { label: name });
  await page.fill("#pin", pin);
  await page.click("button:has-text('Sign in')");
  await page.waitForSelector("text=What am I doing?");
}
await page.goto(B2 + "/");
await page.waitForSelector("text=First-time setup");
await page.fill("#bt", "test-bootstrap"); await page.fill("#bn", "Sam Admin"); await page.fill("#bp1", "9999"); await page.fill("#bp2", "9999");
await page.click("text=Create the System Administrator");
await page.waitForSelector("text=You are the System Administrator");
await signIn2("Sam Admin", "9999");
await page.goto(B2 + "/admin/#settings");
await page.waitForSelector("text=Add test people and a sample week");
if (await page.locator("nav.tabs a", { hasText: "Approvals" }).count()) throw new Error("System Administrator sees Approvals");
await page.fill("#tpin", "2468");
await page.click("text=Add test people and a sample week");
await page.waitForSelector("text=Done. Sign out", { timeout: 60000 });
await shot("admin-testing-done");
const st = fresh.env.DB._rows("SELECT e.type, r.status FROM reports r JOIN events e ON e.id=r.event_id ORDER BY e.type");
if (JSON.stringify(st) !== JSON.stringify([{ type: "SUN_FIRST", status: "verified" }, { type: "SUN_SECOND", status: "pending_countersignature" }])) throw new Error("sample week: " + JSON.stringify(st));
await signIn2("Test Usher Three", "2468");
await page.waitForSelector("text=To countersign");
if (await page.locator("#toAdmin").isVisible()) throw new Error("a test usher sees Open Admin App");
await shot("test-usher-three-home");
await signIn2("Test Treasurer", "2468");
await page.click("nav.tabs a:has-text('Treasurer')");
await page.waitForSelector("text=Remind everyone who is behind");
if (await page.locator("#toAdmin").isVisible()) throw new Error("the Treasurer sees Open Admin App");
await shot("test-treasurer-page");
// The Admin App on its own: signed out, it offers its own sign-in.
await page.goto(B2 + "/admin/");
await page.evaluate(() => localStorage.removeItem("ushers.session.v1"));
await page.goto(B2 + "/admin/");
await page.waitForSelector("text=Sign in to Admin");
await page.waitForSelector("#who option:nth-child(2)", { state: "attached" });
const adminNames = await page.locator("#who option").allTextContents();
if (adminNames.some((n) => /Test Treasurer|Test Usher/.test(n))) throw new Error("Admin sign-in lists " + adminNames);
await page.selectOption("#who", { label: "Test Head Usher" });
await page.fill("#pin", "2468");
await page.click("button:has-text('Sign in')");
await page.waitForSelector("nav.tabs a:has-text('Approvals')");
await shot("admin-own-sign-in");
// Straight across to the Ushers App, no second sign-in.
await page.click("text=Open Ushers App");
await page.waitForSelector("text=What am I doing?");
await signIn2("Sam Admin", "9999");
await page.goto(B2 + "/admin/#settings");
await page.click("text=Switch off test people");
await page.waitForSelector("text=Their past rows stay on the sheet");
if (fresh.env.DB._one("SELECT count(*) AS n FROM ushers WHERE full_name LIKE 'Test %' AND active=1").n !== 0) throw new Error("test people still on");
fresh.server.close();
// A new usher starts on the default PIN and is asked once whether to keep it.
await api("usher.save", { name: "Esther Bello", phone: "07700 900 123" }, admin);
await page.goto(BASE + "/");
await page.evaluate(() => localStorage.removeItem("ushers.session.v1"));
await page.goto(BASE + "/");
await page.waitForSelector("#who option:nth-child(2)", { state: "attached" });
await page.selectOption("#who", { label: "Esther Bello" });
await page.fill("#pin", "0123");
await page.click("button:has-text('Sign in')");
await page.waitForSelector("text=Do you wish to keep your default PIN?");
if (await page.locator("text=/phone/i").count()) throw new Error("the PIN question mentions the phone");
if (await page.locator("#tabs").isVisible()) throw new Error("tabs shown before answering");
await shot("default-pin-question");
await page.click("text=No, change it");
// Each box hands on to the next at four digits; the last never submits.
await page.click("#old"); await page.keyboard.type("0123");
if (await page.evaluate(() => document.activeElement.id) !== "new") throw new Error("the default PIN box did not hand on");
await page.keyboard.type("4826");
if (await page.evaluate(() => document.activeElement.id) !== "again") throw new Error("the new PIN box did not hand on");
await page.keyboard.type("4827");
if (await page.evaluate(() => document.activeElement.id) !== "again") throw new Error("the last PIN box moved on");
// A wrong entry is said in bold red.
await page.click("button:has-text('Change PIN')");
const bad = page.locator(".msg.bad", { hasText: "The new PINs do not match." });
await bad.waitFor();
if (Number(await bad.evaluate((e) => getComputedStyle(e).fontWeight)) < 700) throw new Error("the refusal is not bold");
await shot("pin-mismatch-bold-red");
await page.fill("#again", "4826");
await page.click("button:has-text('Change PIN')");
await page.waitForSelector("text=What am I doing?");
// Reset, and this time keep the default.
const eb = (await api("ushers.list", {}, admin)).ushers.find((u) => u.name === "Esther Bello");
await api("usher.resetPin", { usherId: eb.usherId }, admin);
await page.evaluate(() => localStorage.removeItem("ushers.session.v1"));
await page.goto(BASE + "/");
await page.waitForSelector("#who option:nth-child(2)", { state: "attached" });
await page.selectOption("#who", { label: "Esther Bello" });
await page.fill("#pin", "0123");
await page.click("button:has-text('Sign in')");
await page.click("text=Yes, keep it");
await page.waitForSelector("text=What am I doing?");

await browser.close();
server.close();
if (errors.length) { console.log("page errors:\n" + errors.join("\n")); process.exit(1); }
console.log("journey ok, photos in " + SHOTS);
process.exit(0);
