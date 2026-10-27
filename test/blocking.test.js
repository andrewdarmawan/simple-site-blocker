import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeSite,
  parseSites,
  isScheduleActive,
  isBlocking,
  nextChange,
  withDefaults,
} from "../extension/blocking.js";

// 26 October 2026 is a Monday, so day offsets line up with names below.
const DAYS = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
function at(day, time) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2026, 9, 26 + DAYS[day], hours, minutes);
}

const workHours = { enabled: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
const mondayNights = { enabled: true, days: [1], start: "22:00", end: "06:00" };
const allDayMonday = { enabled: true, days: [1], start: "00:00", end: "00:00" };

test("the test calendar starts on a Monday", () => {
  assert.equal(at("mon", "12:00").getDay(), 1);
});

test("normalizeSite reduces input to a bare domain", () => {
  assert.equal(normalizeSite("reddit.com"), "reddit.com");
  assert.equal(normalizeSite("  https://www.Reddit.com/r/all?x=1 "), "reddit.com");
  assert.equal(normalizeSite("old.reddit.com"), "old.reddit.com");
  assert.equal(normalizeSite("*.youtube.com"), "youtube.com");
  assert.equal(normalizeSite("reddit.com:8080"), "reddit.com");
  assert.equal(normalizeSite("bücher.de"), "xn--bcher-kva.de");
});

test("normalizeSite rejects things that aren't websites", () => {
  assert.equal(normalizeSite(""), null);
  assert.equal(normalizeSite("not a site"), null);
  assert.equal(normalizeSite("localhost"), null);
  assert.equal(normalizeSite("*"), null);
});

test("parseSites removes duplicates and reports bad entries", () => {
  const { sites, invalid } = parseSites("reddit.com\nwww.reddit.com, youtube.com\n\nnot a site\n");
  assert.deepEqual(sites, ["reddit.com", "youtube.com"]);
  assert.deepEqual(invalid, ["not a site"]);
});

test("with the schedule off, blocking is always on", () => {
  assert.equal(isScheduleActive({ ...workHours, enabled: false }, at("sun", "03:00")), true);
});

test("a daytime schedule covers the start minute but not the end minute", () => {
  assert.equal(isScheduleActive(workHours, at("mon", "08:59")), false);
  assert.equal(isScheduleActive(workHours, at("mon", "09:00")), true);
  assert.equal(isScheduleActive(workHours, at("mon", "16:59")), true);
  assert.equal(isScheduleActive(workHours, at("mon", "17:00")), false);
  assert.equal(isScheduleActive(workHours, at("sat", "12:00")), false);
});

test("an overnight schedule carries into the next morning", () => {
  assert.equal(isScheduleActive(mondayNights, at("mon", "05:00")), false); // Sunday isn't selected
  assert.equal(isScheduleActive(mondayNights, at("mon", "21:59")), false);
  assert.equal(isScheduleActive(mondayNights, at("mon", "22:00")), true);
  assert.equal(isScheduleActive(mondayNights, at("tue", "05:59")), true);
  assert.equal(isScheduleActive(mondayNights, at("tue", "06:00")), false);
  assert.equal(isScheduleActive(mondayNights, at("tue", "22:00")), false);
});

test("the same start and end time blocks the whole day", () => {
  assert.equal(isScheduleActive(allDayMonday, at("mon", "00:00")), true);
  assert.equal(isScheduleActive(allDayMonday, at("mon", "23:59")), true);
  assert.equal(isScheduleActive(allDayMonday, at("tue", "00:00")), false);
});

test("nothing is blocked when there are no sites", () => {
  assert.equal(isBlocking(withDefaults(), at("mon", "12:00")), false);
  assert.equal(isBlocking(withDefaults({ sites: ["reddit.com"] }), at("mon", "12:00")), true);
});

test("nextChange finds the next start or end", () => {
  assert.deepEqual(nextChange(workHours, at("mon", "08:00")), at("mon", "09:00"));
  assert.deepEqual(nextChange(workHours, at("mon", "09:00")), at("mon", "17:00"));
  assert.deepEqual(nextChange(workHours, at("fri", "18:00")), new Date(2026, 10, 2, 9, 0)); // next Monday
  assert.deepEqual(nextChange(mondayNights, at("mon", "23:00")), at("tue", "06:00"));
  assert.deepEqual(nextChange(allDayMonday, at("mon", "12:00")), at("tue", "00:00"));
});

test("nextChange is null when the state never changes", () => {
  assert.equal(nextChange({ ...workHours, enabled: false }, at("mon", "12:00")), null);
  assert.equal(nextChange({ ...workHours, days: [] }, at("mon", "12:00")), null);
  const everyDayAllDay = { ...allDayMonday, days: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal(nextChange(everyDayAllDay, at("wed", "12:00")), null);
});
