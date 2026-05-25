chrome.action.onClicked.addListener(function(tab) {
  // Content script auto-injects via manifest content_scripts.
  // Click just signals the already-running script to toggle the panel.
  chrome.tabs.sendMessage(tab.id, { action: 'togglePanel' }, function() {
    if (chrome.runtime.lastError) {}
  });
});
