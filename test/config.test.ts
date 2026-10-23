import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { boolEnv, intEnv, optionalIntEnv, sourceKind } from "../src/config.ts";

const NAMES = ["TEST_INT", "SOURCE"];
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

test("empty or blank values count as not set", () => {
  for (const value of ["", "   "]) {
    process.env["TEST_INT"] = value;
    assert.equal(intEnv("TEST_INT", 8), 8);
    assert.equal(optionalIntEnv("TEST_INT"), undefined);
    process.env["SOURCE"] = value;
    assert.equal(sourceKind(), "stub");
  }
});

test("unset values fall back to the default", () => {
  delete process.env["TEST_INT"];
  assert.equal(intEnv("TEST_INT", 3), 3);
  assert.equal(optionalIntEnv("TEST_INT"), undefined);
});

test("set values are parsed", () => {
  process.env["TEST_INT"] = " 100 ";
  assert.equal(intEnv("TEST_INT", 3), 100);
  assert.equal(optionalIntEnv("TEST_INT"), 100);
});

test("boolean values: empty falls back, true/false parsed, others rejected", () => {
  process.env["TEST_INT"] = "";
  assert.equal(boolEnv("TEST_INT", true), true);
  process.env["TEST_INT"] = " FALSE ";
  assert.equal(boolEnv("TEST_INT", true), false);
  process.env["TEST_INT"] = "true";
  assert.equal(boolEnv("TEST_INT", false), true);
  process.env["TEST_INT"] = "yes";
  assert.throws(() => boolEnv("TEST_INT", true), /TEST_INT must be "true" or "false"/);
});

test("invalid values are rejected with the variable name only", () => {
  for (const value of ["0", "-1", "1.5", "abc"]) {
    process.env["TEST_INT"] = value;
    assert.throws(() => intEnv("TEST_INT", 3), /^Error: environment variable TEST_INT must be a positive integer$/);
  }
  process.env["SOURCE"] = "other";
  assert.throws(() => sourceKind(), /SOURCE must be/);
});
