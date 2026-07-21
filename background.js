// background.js

// Open side panel when extension icon clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Keep queue state globally
let globalQueueState = {
  running: false,
  sites: [],
  currentIndex: 0,
  activeTabId: null,
  currentInterval: null,
  activeProfile: null,
  injectionAttempts: {}
};

// Listen for commands from side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startQueue') {
    chrome.storage.local.get(['activeProfile'], (result) => {
      globalQueueState.activeProfile = result.activeProfile;
      globalQueueState.running = true;
      globalQueueState.sites = request.sites;
      globalQueueState.currentIndex = 0;
      globalQueueState.injectionAttempts = {};
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
    skipCurrentSite();
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
    notifyPanel('complete', 'All targets processed');
    return;
  }

  const url = globalQueueState.sites[globalQueueState.currentIndex];

  chrome.tabs.create({ url: url, active: true }, (tab) => {
    globalQueueState.activeTabId = tab.id;
    globalQueueState.injectionAttempts[tab.id] = 0;
    
    notifyPanel('opened', `Opened [${globalQueueState.currentIndex + 1}/${globalQueueState.sites.length}]: ${url}`);

    // First wait for page to fully load, then inject form data
    const pageLoadTimeout = setTimeout(() => {
      if (globalQueueState.activeTabId === tab.id && globalQueueState.activeProfile) {
        console.log("Injecting form data after page load");
        injectFormData(tab.id, globalQueueState.activeProfile);
      }
    }, 2000);

    // Multiple injection attempts at different times
    const injectionTimes = [3000, 4500, 6000, 8000];
    
    injectionTimes.forEach((delay) => {
      setTimeout(() => {
        if (globalQueueState.activeTabId === tab.id && globalQueueState.activeProfile) {
          injectFormData(tab.id, globalQueueState.activeProfile);
        }
      }, delay);
    });

    // Monitor tab closure
    globalQueueState.currentInterval = setInterval(() => {
      chrome.tabs.get(tab.id, (t) => {
        if (chrome.runtime.lastError || !t) {
          // Tab closed by user or extension
          clearInterval(globalQueueState.currentInterval);
          clearTimeout(pageLoadTimeout);
          globalQueueState.currentInterval = null;
          globalQueueState.activeTabId = null;

          notifyPanel('closed', 'Target closed, waiting...');

          // Wait 10 seconds then next
          setTimeout(() => {
            if (globalQueueState.running) {
              globalQueueState.currentIndex++;
              processQueue();
            }
          }, 10000);
        }
      });
    }, 1000);

    // Failsafe: if tab stays open too long, skip it
    setTimeout(() => {
      if (globalQueueState.activeTabId === tab.id && globalQueueState.running) {
        console.log("Tab open too long, force closing");
        chrome.tabs.remove(tab.id).catch(() => {});
      }
    }, 120000);
  });
}

function injectFormData(tabId, profileData) {
  try {
    const cleanProfile = {};
    for (const key in profileData) {
      if (profileData.hasOwnProperty(key) && profileData[key]) {
        cleanProfile[key] = profileData[key];
      }
    }

    console.log("Injecting form data into tab", tabId);

    chrome.tabs.sendMessage(tabId, {
      action: 'fillForm',
      identityData: cleanProfile
    }, (response) => {
      if (response && response.status) {
        console.log("Form injection response:", response);
      }
    });
  } catch (error) {
    console.error("Error injecting form data:", error);
  }
}

function skipCurrentSite() {
  if (globalQueueState.activeTabId) {
    if (globalQueueState.currentInterval) {
      clearInterval(globalQueueState.currentInterval);
      globalQueueState.currentInterval = null;
    }

    chrome.tabs.remove(globalQueueState.activeTabId).catch(() => {});
    globalQueueState.activeTabId = null;

    notifyPanel('skipped', 'Target skipped, moving to next...');
    globalQueueState.currentIndex++;

    setTimeout(() => {
      if (globalQueueState.running) {
        processQueue();
      }
    }, 500);
  } else {
    notifyPanel('skipped', 'No active target to skip, moving to next...');
    globalQueueState.currentIndex++;
    if (globalQueueState.running) {
      processQueue();
    }
  }
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

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "fillResult") {
    console.log("Fill result from tab", sender.tab.id, ":", request);
  }
});
