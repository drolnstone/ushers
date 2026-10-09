/* Opening the Worker's own address in a browser shows it is up, as the
   Driver App's does, instead of an error. Asim found the difference: the
   Minibus address answered 200 on its own, the Ushers one only with
   /api/health on the end. */

import { Suite } from "../lib/t.mjs";
import { loadWorker, makeEnv } from "../lib/worker.mjs";

export default async function ({ root }) {
  const { mod } = await loadWorker(root);
  const s = new Suite("the Worker's bare address");
  const env = makeEnv(root);
  const get = async (path) => {
    const res = await mod.default.fetch(new Request("https://ushers-api.example" + path, { method: "GET" }), env, { waitUntil() {} });
    return { status: res.status, body: await res.json() };
  };

  for (const path of ["/", "/api", "/api/", "/api/health"]) {
    s.test(path + " answers 200 with the server's version", async (a) => {
      const r = await get(path);
      a.eq(r.status, 200);
      a.eq(r.body.ok, true);
      a.eq(r.body.server, mod.SERVER_VERSION);
    });
  }

  s.test("and names nobody, since anybody can open it", async (a) => {
    const r = await get("/");
    a.eq(r.body.people, undefined);
  });

  s.test("anything else is still not found, and other actions still need POST", async (a) => {
    a.eq((await get("/something")).status, 404);
    a.eq((await get("/api/nonsense")).status, 404);
    a.eq((await get("/api/home")).status, 405);
  });

  return s;
}
