/* global chrome */
'use strict';

// Service worker for Auction Pricing Assistant (Manifest V3)
// Handles extension lifecycle events and relays batch estimation requests.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  }
});

// Relay BATCH_ESTIMATE_VISIBLE to the active auction tab
chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'BATCH_ESTIMATE_VISIBLE' });
});
