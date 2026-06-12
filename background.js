// Refreshes the week cache without the user visiting Google Calendar:
// opens calendar.google.com in a background tab, waits for the content
// script to scan and bump gttDomWeeksAt, then closes the tab.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'gtt-refresh-gcal') return;
  (async () => {
    const { gttGcalPath = '/calendar/u/0/', gttDomWeeksAt = 0 } =
      await chrome.storage.local.get(['gttGcalPath', 'gttDomWeeksAt']);
    // msg.week ("2026/6/8") targets a specific week; default is the current one.
    const weekPath = /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(msg.week || '') ? `r/week/${msg.week}` : 'r/week';
    const tab = await chrome.tabs.create({
      url: `https://calendar.google.com${gttGcalPath}${weekPath}`,
      active: false,
    });

    let finished = false;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      chrome.storage.onChanged.removeListener(listener);
      // Give the scanner a beat to write any trailing updates.
      setTimeout(() => chrome.tabs.remove(tab.id).catch(() => {}), 1500);
      sendResponse({ ok });
    };
    const listener = (changes, area) => {
      if (area === 'local' && (changes.gttDomWeeksAt?.newValue || 0) > gttDomWeeksAt) {
        done(true);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    setTimeout(() => done(false), 20_000); // give up, but still close the tab
  })();
  return true; // keep sendResponse alive for the async work
});
