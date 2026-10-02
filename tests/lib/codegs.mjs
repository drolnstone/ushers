/* Loads Code.gs into a sandbox with Apps Script faked (tests/lib/gas.mjs).
   Same approach as the Driver App's tests/lib/codegs.mjs. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { makeGas } from "./gas.mjs";

export function loadCodeGs(root, opts) {
  const gas = makeGas(opts || {});
  const ctx = vm.createContext(Object.assign({ console, JSON, Date, Math, Object, Array, String, Number, RegExp, Error }, gas.globals));
  new vm.Script(readFileSync(join(root, "Code.gs"), "utf8"), { filename: "Code.gs" }).runInContext(ctx);
  return { gas, ctx };
}
