import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConditionGrade } from "../../lib/conditionGrade";

test("parses a Raw condition string", () => {
  assert.deepEqual(parseConditionGrade("Raw NM"), { type: "RAW", condition: "NM" });
});

test("parses Raw case-insensitively with extra whitespace", () => {
  assert.deepEqual(parseConditionGrade("  raw   lp  "), { type: "RAW", condition: "LP" });
});

test("falls back to NM for an unrecognized Raw condition code", () => {
  assert.deepEqual(parseConditionGrade("Raw XX"), { type: "RAW", condition: "NM" });
});

test("parses a graded string into grader + number", () => {
  assert.deepEqual(parseConditionGrade("PSA 10"), { type: "GRADED", grader: "PSA", gradeNumber: "10" });
});

test("parses a graded half-point value", () => {
  assert.deepEqual(parseConditionGrade("BGS 9.5"), { type: "GRADED", grader: "BGS", gradeNumber: "9.5" });
});

test("falls back to Raw NM for unparseable input", () => {
  assert.deepEqual(parseConditionGrade(""), { type: "RAW", condition: "NM" });
});
