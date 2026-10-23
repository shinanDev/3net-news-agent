// Runs the vendored H-MEM conformance suite against the vendored engine.
// Same as: HMEM_IMPL=<abs>/vendor/hmem/src/index.ts npx tsx vendor/hmem/conformance/runner.ts
// (setting the variable here keeps the npm script independent of the shell).

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

process.env["HMEM_IMPL"] ??= resolve("vendor/hmem/src/index.ts");
await import(pathToFileURL(resolve("vendor/hmem/conformance/runner.ts")).href);
