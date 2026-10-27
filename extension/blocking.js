// Pure logic shared by the background script, the options page and the tests.
// Nothing in this file touches browser APIs.

export const DEFAULT_SETTINGS = {
  sites: [],
  schedule: {
    enabled: false,
    days: [1, 2, 3, 4, 5], // 0 = Sunday … 6 = Saturday, matching Date.getDay()
    start: "09:00",
    end: "17:00",
  },
};

export function withDefaults(stored = {}) {
  return {
    sites: Array.isArray(stored.sites) ? stored.sites : DEFAULT_SETTINGS.sites,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...stored.schedule },
  };
}

// Turns what someone typed ("https://www.Reddit.com/r/all", "*.youtube.com")
// into the bare domain the blocking rule matches on ("reddit.com"), or null.
export function normalizeSite(input) {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = "http://" + text;

  let host;
  try {
    host = new URL(text).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^\*\./, "").replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

// Splits the textarea contents into unique domains plus the entries that
// weren't recognisable as a website.
export function parseSites(text) {
  const sites = [];
  const invalid = [];
  for (const entry of text.split(/[\n,]/)) {
    if (!entry.trim()) continue;
    const site = normalizeSite(entry);
    if (!site) invalid.push(entry.trim());
    else if (!sites.includes(site)) sites.push(site);
  }
  return { sites, invalid };
}

function toMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

// Whether the schedule says to block at this moment. With the schedule off,
// blocking is always on.
export function isScheduleActive(schedule, now) {
  if (!schedule.enabled) return true;

  const days = new Set(schedule.days);
  const day = now.getDay();
  const minute = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(schedule.start);
  const end = toMinutes(schedule.end);

  if (start === end) return days.has(day); // the whole day
  if (start < end) return days.has(day) && minute >= start && minute < end;
  // Overnight, e.g. 22:00–06:00: the early hours belong to the previous day's block.
  const yesterday = (day + 6) % 7;
  return (days.has(day) && minute >= start) || (days.has(yesterday) && minute < end);
}

export function isBlocking(settings, now) {
  return settings.sites.length > 0 && isScheduleActive(settings.schedule, now);
}

// The next moment the schedule switches on or off, or null if it never does.
// The state can only flip at midnight or at the start or end time, so it's
// enough to check those moments over the coming week.
export function nextChange(schedule, now) {
  if (!schedule.enabled) return null;

  const current = isScheduleActive(schedule, now);
  const times = [0, toMinutes(schedule.start), toMinutes(schedule.end)];
  const candidates = [];
  for (let offset = 0; offset <= 8; offset++) {
    for (const time of times) {
      candidates.push(
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + offset,
          Math.floor(time / 60),
          time % 60,
        ),
      );
    }
  }
  candidates.sort((a, b) => a - b);
  return (
    candidates.find((moment) => moment > now && isScheduleActive(schedule, moment) !== current) ??
    null
  );
}
