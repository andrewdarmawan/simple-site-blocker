import {
  DEFAULT_SETTINGS,
  withDefaults,
  parseSites,
  isBlocking,
  nextChange,
} from "./blocking.js";

const form = document.getElementById("form");
const sitesField = document.getElementById("sites");
const scheduleFields = document.getElementById("schedule");
const dayBoxes = [...form.elements.day];
const startField = document.getElementById("start");
const endField = document.getElementById("end");
const statusLine = document.getElementById("status");
const message = document.getElementById("message");

let saved = withDefaults();

function formatMoment(moment, now) {
  const time = moment.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (moment.toDateString() === now.toDateString()) return time;
  return `${moment.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

function showStatus() {
  const now = new Date();
  const count = saved.sites.length;
  const next = nextChange(saved.schedule, now);
  const blocking = isBlocking(saved, now);
  let text;

  if (count === 0) {
    text = "No sites added yet.";
  } else if (blocking) {
    const sites = `${count} site${count === 1 ? "" : "s"}`;
    text = next ? `Blocking ${sites} until ${formatMoment(next, now)}.` : `Blocking ${sites}.`;
  } else {
    text = next ? `Not blocking right now. Starts ${formatMoment(next, now)}.` : "Not blocking.";
  }
  statusLine.textContent = text;
  statusLine.classList.toggle("on", blocking);
}

function syncScheduleFields() {
  scheduleFields.disabled = form.elements.when.value !== "schedule";
}

async function load() {
  saved = withDefaults(await browser.storage.local.get());
  sitesField.value = saved.sites.join("\n");
  form.elements.when.value = saved.schedule.enabled ? "schedule" : "always";
  for (const box of dayBoxes) box.checked = saved.schedule.days.includes(Number(box.value));
  startField.value = saved.schedule.start;
  endField.value = saved.schedule.end;
  syncScheduleFields();
  showStatus();
}

form.addEventListener("change", (event) => {
  if (event.target.name === "when") syncScheduleFields();
  message.textContent = "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { sites, invalid } = parseSites(sitesField.value);
  const schedule = {
    enabled: form.elements.when.value === "schedule",
    days: dayBoxes.filter((box) => box.checked).map((box) => Number(box.value)),
    start: startField.value || DEFAULT_SETTINGS.schedule.start,
    end: endField.value || DEFAULT_SETTINGS.schedule.end,
  };

  if (schedule.enabled && schedule.days.length === 0) {
    message.textContent = "Pick at least one day, or choose Always.";
    return;
  }

  saved = { sites, schedule };
  await browser.storage.local.set(saved);
  sitesField.value = sites.join("\n");
  message.textContent =
    invalid.length > 0
      ? `Saved. Skipped ${invalid.map((entry) => `“${entry}”`).join(", ")}: not a website address.`
      : "Saved.";
  showStatus();
});

load();
setInterval(showStatus, 30_000);
