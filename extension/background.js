import { withDefaults, isBlocking, nextChange } from "./blocking.js";

const RULE_ID = 1;
const ALARM = "schedule-change";

// Firefox matches requests against this rule itself. The extension is never
// told which pages you visit or which requests were blocked.
async function update() {
  const settings = withDefaults(await browser.storage.local.get());
  const now = new Date();

  const addRules = isBlocking(settings, now)
    ? [
        {
          id: RULE_ID,
          action: { type: "block" },
          condition: { requestDomains: settings.sites, resourceTypes: ["main_frame"] },
        },
      ]
    : [];
  await browser.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [RULE_ID], addRules });

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
