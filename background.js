// background.js

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

let globalQueueState = {
  running: false,
  sites: [],
  currentIndex: 0,
  activeTabId: null,
  currentInterval: null,
  activeProfile: null
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startQueue') {
    chrome.storage.local.get(['activeProfile'], (result) => {
      globalQueueState.activeProfile = result.activeProfile;
      globalQueueState.running = true;
      globalQueueState.sites = request.sites;
      globalQueueState.currentIndex = 0;
      processQueue();
      sendResponse({ status: 'started' });
    });
    return true;
  }

  if (request.action === 'stopQueue') {
    globalQueueState.running = false;
    if (globalQueueState.activeTabId) {
      chrome.tabs.remove(globalQueueState.activeTabId).catch(() => {});
    }
    if (globalQueueState.currentInterval) {
      clearInterval(globalQueueState.currentInterval);
      globalQueueState.currentInterval = null;
    }
    globalQueueState.activeTabId = null;
    sendResponse({ status: 'stopped' });
    return true;
  }

  if (request.action === 'skipCurrent') {
    if (globalQueueState.activeTabId) {
      chrome.tabs.remove(globalQueueState.activeTabId).catch(() => {});
      globalQueueState.activeTabId = null;
      if (globalQueueState.currentInterval) {
        clearInterval(globalQueueState.currentInterval);
        globalQueueState.currentInterval = null;
      }
      notifyPanel('skipped', 'Skipped to next target');
      globalQueueState.currentIndex++;
      setTimeout(() => processQueue(), 500);
    }
    sendResponse({ status: 'skipped' });
    return true;
  }

  if (request.action === 'getStatus') {
    sendResponse({
      running: globalQueueState.running,
      current: globalQueueState.currentIndex + 1,
      total: globalQueueState.sites.length,
      currentUrl: globalQueueState.sites[globalQueueState.currentIndex] || 'none'
    });
    return true;
  }

  return true;
});

function processQueue() {
  if (!globalQueueState.running) return;

  if (globalQueueState.currentIndex >= globalQueueState.sites.length) {
    globalQueueState.running = false;
    notifyPanel('complete', 'All targets completed!');
    return;
  }

  const url = globalQueueState.sites[globalQueueState.currentIndex];
  console.log(`[BACKGROUND] Opening site ${globalQueueState.currentIndex + 1}/${globalQueueState.sites.length}: ${url}`);

  chrome.tabs.create({ url: url, active: true }, (tab) => {
    globalQueueState.activeTabId = tab.id;
    notifyPanel('opened', `[${globalQueueState.currentIndex + 1}/${globalQueueState.sites.length}] ${url}`);

    // Wait 1.5 seconds for page to load, then inject
    setTimeout(() => {
      if (globalQueueState.activeTabId === tab.id && globalQueueState.activeProfile) {
        console.log(`[BACKGROUND] Injecting data into tab ${tab.id}`);
        injectAndFill(tab.id);
      }
    }, 1500);

    // Check if tab is closed every 1 second
    globalQueueState.currentInterval = setInterval(() => {
      chrome.tabs.get(tab.id, (t) => {
        if (chrome.runtime.lastError || !t) {
          clearInterval(globalQueueState.currentInterval);
          globalQueueState.currentInterval = null;
          globalQueueState.activeTabId = null;

          notifyPanel('closed', 'Tab closed, waiting 10 seconds...');

          setTimeout(() => {
            if (globalQueueState.running) {
              globalQueueState.currentIndex++;
              processQueue();
            }
          }, 10000);
        }
      });
    }, 1000);

    // Force close after 120 seconds
    setTimeout(() => {
      if (globalQueueState.activeTabId === tab.id) {
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    }, 120000);
  });
}

function injectAndFill(tabId) {
  chrome.tabs.sendMessage(tabId, {
    action: 'fillForm',
    data: globalQueueState.activeProfile
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.log(`[BACKGROUND] Error sending message:`, chrome.runtime.lastError);
    }
  });
}

function notifyPanel(type, message) {
  chrome.runtime.sendMessage({
    type: 'queueUpdate',
    updateType: type,
    message: message,
    current: globalQueueState.currentIndex + 1,
    total: globalQueueState.sites.length
  }).catch(() => {});
}
