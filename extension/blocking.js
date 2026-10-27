// Pure logic shared by the background script, the options page and the tests.
// Nothing in this file touches browser APIs.

export const DEFAULT_SETTINGS = {
  sites: [],
  allowed: [],
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
    allowed: Array.isArray(stored.allowed) ? stored.allowed : DEFAULT_SETTINGS.allowed,
    schedule: { ...DEFAULT_SETTINGS.schedule, ...stored.schedule },
  };
}

function parseUrl(input) {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = "http://" + text;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname
    .replace(/^\*\./, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return { host, path: url.pathname };
}

// Turns what someone typed ("https://www.Reddit.com/r/all", "*.youtube.com")
// into the bare domain the blocking rule matches on ("reddit.com"), or null.
export function normalizeSite(input) {
  return parseUrl(input)?.host ?? null;
}

// Turns an exception someone typed ("https://www.instagram.com/direct/")
// into a domain plus an optional path ("instagram.com/direct"), or null.
// Query strings and fragments are dropped.
export function normalizeAllowed(input) {
  const parsed = parseUrl(input);
  if (!parsed) return null;
  const path = parsed.path.replace(/\/+$/, "");
  return parsed.host + path;
}

// Splits textarea contents into unique entries plus the ones that weren't
// recognisable as a website.
function parseList(text, normalize) {
  const entries = [];
  const invalid = [];
  for (const entry of text.split(/[\n,]/)) {
    if (!entry.trim()) continue;
    const normalized = normalize(entry);
    if (!normalized) invalid.push(entry.trim());
    else if (!entries.includes(normalized)) entries.push(normalized);
  }
  return { entries, invalid };
}

export function parseSites(text) {
  const { entries, invalid } = parseList(text, normalizeSite);
  return { sites: entries, invalid };
}

export function parseAllowed(text) {
  const { entries, invalid } = parseList(text, normalizeAllowed);
  return { allowed: entries, invalid };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A regular expression matching every URL an exception covers: the domain and
// its subdomains, and when there's a path, that page and everything under it.
// "instagram.com/direct" matches /direct and /direct/inbox but not /directory.
export function allowedPattern(entry) {
  const slash = entry.indexOf("/");
  const host = slash === -1 ? entry : entry.slice(0, slash);
  const path = slash === -1 ? "" : entry.slice(slash);
  return `^https?://([^/?#]*\\.)?${escapeRegex(host)}(:[0-9]+)?${escapeRegex(path)}([/?#]|$)`;
}

const BLOCK_RULE_ID = 1;

// The declarativeNetRequest rules for these settings at this moment. Firefox
// applies the highest priority match, so exceptions win over the block.
export function buildRules(settings, now) {
  if (!isBlocking(settings, now)) return [];
  const resourceTypes = ["main_frame"];
  return [
    {
      id: BLOCK_RULE_ID,
      priority: 1,
      action: { type: "block" },
      condition: { requestDomains: settings.sites, resourceTypes },
    },
    ...settings.allowed.map((entry, index) => ({
      id: BLOCK_RULE_ID + 1 + index,
      priority: 2,
      action: { type: "allow" },
      condition: { regexFilter: allowedPattern(entry), resourceTypes },
    })),
  ];
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
