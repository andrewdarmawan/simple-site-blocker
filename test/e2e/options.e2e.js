// End-to-end check in a real headless Firefox: install the extension, add a
// site on the options page, and confirm Firefox refuses to load it.
//
// Needs Firefox and geckodriver. Point FIREFOX_BIN and GECKODRIVER at them if
// they aren't on PATH. Run with `npm run test:e2e` (about 15 seconds).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";

const EXTENSION = fileURLToPath(new URL("../../extension", import.meta.url));
const HOSTS = ["blocked.test", "old.blocked.test", "allowed.test"];

let server;
let port;
let build;
let driver;
let optionsTab;
let pageTab;
const served = new Set();

// Marionette refuses to navigate to moz-extension:// pages, but it can drive
// one that is already open. So the test build carries
// one extra background script that opens the options page itself as soon as
// it's installed. Extension pages count as privileged, so Firefox also needs
// -remote-allow-system-access before the driver may touch that tab.
function testBuild() {
  const dir = mkdtempSync(path.join(tmpdir(), "ssb-e2e-"));
  cpSync(EXTENSION, dir, { recursive: true });
  writeFileSync(
    path.join(dir, "e2e-open-options.js"),
    "browser.runtime.onInstalled.addListener(() => browser.runtime.openOptionsPage());\n",
  );
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.background.scripts.push("e2e-open-options.js");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return dir;
}

async function waitForOptionsTab() {
  await driver.wait(async () => {
    for (const handle of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(handle);
      if ((await driver.getCurrentUrl()).startsWith("moz-extension://")) return handle;
    }
    return false;
  }, 10000, "options page never opened");
  return driver.getWindowHandle();
}

// Loads a site in the page tab. True if the page came from our local server,
// false if Firefox never asked the server for it. A blocked load never
// finishes, so the driver doesn't wait for page loads and this polls instead.
async function loads(host) {
  await driver.switchTo().window(pageTab);
  await driver.get("about:blank");
  served.delete(host);
  await driver.get(`http://${host}:${port}/`);
  try {
    await driver.wait(until.titleIs(`LOADED ${host}`), 3000);
    return true;
  } catch {
    assert.equal(served.has(host), false, `${host} was requested but did not render`);
    return false;
  }
}

async function saveSites(text) {
  await driver.switchTo().window(optionsTab);
  const box = await driver.findElement(By.id("sites"));
  await box.clear();
  await box.sendKeys(text);
  await driver.findElement(By.css('input[name="when"][value="always"]')).click();
  await driver.findElement(By.css("button[type=submit]")).click();
  await driver.wait(until.elementTextMatches(driver.findElement(By.id("message")), /^Saved/), 5000);
  // Saving writes storage; the background script then swaps the block rule.
  await driver.sleep(500);
  return driver.findElement(By.id("status")).getText();
}

before(async () => {
  server = createServer((req, res) => {
    const host = req.headers.host.split(":")[0];
    served.add(host);
    res.setHeader("Content-Type", "text/html");
    res.end(`<title>LOADED ${host}</title><h1>Loaded ${host}</h1>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;

  const options = new firefox.Options()
    .setPageLoadStrategy("none")
    .addArguments("-headless", "-remote-allow-system-access")
    .setPreference("network.proxy.type", 0)
    .setPreference("network.dns.localDomains", HOSTS.join(","));
  if (process.env.FIREFOX_BIN) options.setBinary(process.env.FIREFOX_BIN);
  const service = new firefox.ServiceBuilder(process.env.GECKODRIVER);

  driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build();

  build = testBuild();
  await driver.installAddon(build, true);
  optionsTab = await waitForOptionsTab();
  await driver.wait(until.elementLocated(By.id("sites")), 5000);
  // Firefox may have reused the blank start tab for the options page.
  await driver.switchTo().newWindow("tab");
  pageTab = await driver.getWindowHandle();
});

after(async () => {
  await driver?.quit();
  server?.close();
  if (build) rmSync(build, { recursive: true, force: true });
});

test("sites load before anything is blocked", async () => {
  assert.equal(await loads("blocked.test"), true);
  assert.equal(await loads("allowed.test"), true);
});

test("a site added on the options page is blocked, with its subdomains", async () => {
  const status = await saveSites("https://www.Blocked.test/some/page");
  assert.match(status, /^Blocking 1 site/);

  await driver.switchTo().window(optionsTab);
  const saved = await driver.findElement(By.id("sites")).getAttribute("value");
  assert.equal(saved, "blocked.test");

  assert.equal(await loads("blocked.test"), false);
  assert.equal(await loads("old.blocked.test"), false);
  assert.equal(await loads("allowed.test"), true);
});

test("clearing the list unblocks the site", async () => {
  await saveSites("");
  assert.equal(await loads("blocked.test"), true);
});
