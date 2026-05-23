chrome.action.onClicked.addListener(function(tab) {
  // Only inject into top frame — content.js will read child iframes itself
  chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    files: ['content.js']
  });
});
