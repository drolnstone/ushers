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
await api("bootstrap", { token: "test-bootstrap", fullName: "Sam Admin", pin: "9999" });
const admin = (await api("login", { usherId: "U001", pin: "9999" })).token;
const ids = {};
for (const [k, n] of [["hu", "Grace Okafor"], ["A", "John Smith"], ["B", "Mary Jones"], ["C", "Peter Brown"], ["T", "Ruth Adeyemi"]]) {
  ids[k] = (await api("usher.save", { name: n, pin: "1234", email: k + "@example.org" }, admin)).usherId;
}
await api("usher.roles", { usherId: ids.hu, roles: ["usher", "head_usher"] }, admin);
await api("usher.roles", { usherId: ids.T, roles: ["usher", "treasurer"] }, admin);

const today = mod.londonKey(new Date());
const focus = mod.sundayOnOrBefore(today);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
let n = 0;
const shot = async (name) => { await page.waitForTimeout(250); await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-${name}.png`, fullPage: true }); };
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
await noUcodes("report");
await shot("a-report-pending");

// Offline: the Second Service report signed with no signal, sent later.
await page.goto(BASE + "/#report/S" + focus.replace(/-/g, "") + "-2");
await page.waitForSelector("#cat");
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

// Dashboard; Treasurer boundary.
await signIn("Grace Okafor");
await page.goto(BASE + "/admin/#dashboard");
await page.waitForSelector("text=Next Sunday");
await shot("admin-dashboard");
if (await page.locator("nav.tabs a", { hasText: "Treasurer" }).count()) throw new Error("Head Usher sees Treasurer");
await signIn("Ruth Adeyemi");
await page.goto(BASE + "/admin/#treasurer/" + ids.A);
await page.waitForSelector("text=Record a payment");
await page.click("text=Record payment");
await page.waitForTimeout(500);
await shot("treasurer");
await page.goto(BASE + "/#dues");
await page.waitForSelector("text=My dues");
await shot("treasurer-own-dues");

await browser.close();
server.close();
if (errors.length) { console.log("page errors:\n" + errors.join("\n")); process.exit(1); }
console.log("journey ok, photos in " + SHOTS);
process.exit(0);
