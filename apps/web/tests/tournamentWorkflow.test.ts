import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationLabel, tournamentNextStep } from "../lib/tournamentWorkflow";
import type { Tournament } from "../lib/types";

const event = (overrides: Partial<Tournament> = {}): Tournament => ({
  id: "cup", name: "Cup", game: null, location: null, description: null,
  status: "UPCOMING", startDate: "2026-10-27T12:00:00Z", endDate: null,
  format: "SINGLE_ELIMINATION", bestOf: 3, finalBestOf: null,
  lateMinutes: 15, rosterMin: 3, rosterMax: 5, maxTeams: 8,
  registrationOpen: true, thirdPlaceMatch: false, grandFinalReset: true,
  bracketStatus: "NONE", ...overrides,
});

test("capacity and lifecycle override the registration toggle", () => {
  assert.equal(registrationLabel(event(), 7), "เปิดรับสมัคร");
  assert.equal(registrationLabel(event(), 8), "ทีมครบแล้ว");
  assert.equal(registrationLabel(event({ registrationOpen: false }), 2), "ปิดรับสมัคร");
  assert.equal(registrationLabel(event({ bracketStatus: "LIVE" }), 2), "ปิดรับสมัคร");
  assert.equal(registrationLabel(event({ status: "COMPLETED" }), 2), "สิ้นสุดการรับสมัคร");
  assert.equal(registrationLabel(event({ maxTeams: null }), 100), "เปิดรับสมัคร");
  assert.equal(registrationLabel(event({ entryMode: "SOLO" }), 2), "สุ่มทีมแล้ว / ปิดรับสมัคร");
});

test("team preparation guides organizers to existing controls", () => {
  assert.equal(tournamentNextStep(event({ registrationOpen: false }), 0).target, "settings");
  assert.equal(tournamentNextStep(event(), 1).target, "register");
  for (const format of ["SINGLE_ELIMINATION", "DOUBLE_ELIMINATION", "ROUND_ROBIN"] as const) {
    assert.equal(tournamentNextStep(event({ format }), 2).target, "bracket");
    assert.match(tournamentNextStep(event({ format, bracketStatus: "DRAFT" }), 2).label, /ยืนยัน/);
  }
});

test("solo draws must be confirmed before guiding organizers to seed", () => {
  const solo = event({ entryMode: "SOLO" });
  assert.equal(tournamentNextStep(solo, 2, false).target, "draw");
  assert.equal(tournamentNextStep(solo, 2, true).target, "bracket");
  const closed = event({ entryMode: "SOLO", registrationOpen: false });
  assert.equal(tournamentNextStep(closed, 0).target, "settings");
  assert.equal(tournamentNextStep(closed, 0, false, 6).target, "draw");
  assert.equal(tournamentNextStep(event({ entryMode: "SOLO", bracketStatus: "LIVE" }), 2).target, "bracket");
});

test("free-form and finished events retain their own result workflows", () => {
  assert.equal(tournamentNextStep(event({ format: null }), 0).target, "results");
  assert.equal(tournamentNextStep(event({ format: null, status: "COMPLETED" }), 2).target, "register");
  assert.equal(tournamentNextStep(event({ bracketStatus: "DONE" }), 2).target, "bracket");
});
