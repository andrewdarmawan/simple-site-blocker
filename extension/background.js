import {
  withDefaults,
  buildRules,
  nextChange,
  isUrlBlocked,
  navigationFilter,
} from "./blocking.js";

const ALARM = "schedule-change";

// Firefox matches requests against these rules itself. The extension is never
// told which requests were blocked.
async function update() {
  const settings = withDefaults(await browser.storage.local.get());
  const now = new Date();

  const existing = await browser.declarativeNetRequest.getDynamicRules();
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: buildRules(settings, now),
  });

  listenForPageChanges(settings.sites);

  await browser.alarms.clear(ALARM);
  const next = settings.sites.length > 0 ? nextChange(settings.schedule, now) : null;
  if (next) browser.alarms.create(ALARM, { when: next.getTime() });
}

// Sites like Instagram switch pages without a full load, which the rules never
// see, so leaving an allowed page wouldn't be blocked. Firefox reports those
// page changes only on blocked sites; reloading the tab lets the rules decide.
async function onPageChange({ tabId, frameId, url }) {
  if (frameId !== 0) return;
  const settings = withDefaults(await browser.storage.local.get());
  if (isUrlBlocked(settings, url, new Date())) await browser.tabs.reload(tabId);
}

// The background page sleeps when idle, and Firefox only wakes it for
// listeners added as it starts, so the site list for the filter is also kept
// where it can be read without waiting.
const SITES_KEY = "page-change-sites";

function listenForPageChanges(sites) {
  browser.webNavigation.onHistoryStateUpdated.removeListener(onPageChange);
  if (sites.length > 0) {
    browser.webNavigation.onHistoryStateUpdated.addListener(onPageChange, navigationFilter(sites));
  }
  localStorage.setItem(SITES_KEY, JSON.stringify(sites));
}

function cachedSites() {
  try {
    const sites = JSON.parse(localStorage.getItem(SITES_KEY));
    return Array.isArray(sites) ? sites : [];
  } catch {
    return [];
  }
}

listenForPageChanges(cachedSites());

// Run updates one at a time so overlapping triggers can't interleave.
let queue = Promise.resolve();
function scheduleUpdate() {
  queue = queue.then(update).catch(console.error);
}

browser.runtime.onInstalled.addListener(scheduleUpdate);
browser.runtime.onStartup.addListener(scheduleUpdate);
browser.storage.onChanged.addListener(scheduleUpdate);
browser.alarms.onAlarm.addListener(scheduleUpdate);
browser.action.onClicked.addListener(() => browser.runtime.openOptionsPage());
