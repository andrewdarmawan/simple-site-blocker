import { withDefaults, buildRules, nextChange } from "./blocking.js";

const ALARM = "schedule-change";

// Firefox matches requests against these rules itself. The extension is never
// told which pages you visit or which requests were blocked.
async function update() {
  const settings = withDefaults(await browser.storage.local.get());
  const now = new Date();

  const existing = await browser.declarativeNetRequest.getDynamicRules();
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: buildRules(settings, now),
  });

  await browser.alarms.clear(ALARM);
  const next = settings.sites.length > 0 ? nextChange(settings.schedule, now) : null;
  if (next) browser.alarms.create(ALARM, { when: next.getTime() });
}

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
