const { NOTION_API_KEY, DATABASE_ID } = config;

async function checkNotionStatus() {
  const notionStatusEl = document.getElementById('notionStatus');
  try {
    chrome.runtime.sendMessage({ type: 'CHECK_NOTION_STATUS' }, (response) => {
      if (response.error) {
        notionStatusEl.textContent = '❌ Notion is not reachable';
        notionStatusEl.style.color = '#c62828';
      } else {
        if (response.isAvailable) {
          notionStatusEl.textContent = '✅ Notion is reachable';
          notionStatusEl.style.color = '#2e7d32';
        } else {
          notionStatusEl.textContent = '❌ Notion is not reachable';
          notionStatusEl.style.color = '#c62828';
        }
      }
    });
  } catch (error) {
    console.error('Notion connection error:', error);
    notionStatusEl.textContent = '❌ Notion is not reachable (Network Error)';
    notionStatusEl.style.color = '#c62828';
  }
}


// Update queue display
async function updateQueueDisplay() {
  const { saveQueue = [] } = await chrome.storage.local.get(['saveQueue']);
  const queueCount = document.getElementById('queueCount');
  const queueItems = document.getElementById('queueItems');
  
  if (saveQueue.length === 0) {
    queueCount.textContent = 'Queue is empty';
    queueItems.innerHTML = '';
  } else {
    queueCount.textContent = `${saveQueue.length} item(s) in queue`;
    queueItems.innerHTML = saveQueue
      .map(item => `
        <div class="queue-item">
          <div class="queue-item-title">${item.title || 'Untitled'}</div>
          <div class="queue-item-details">
            URL: ${item.url}<br>
            Added: ${new Date(item.timestamp).toLocaleString()}<br>
            Has Image: ${item.image ? '✓' : '✗'}<br>
            Description: ${item.description ? '✓' : '✗'}
          </div>
        </div>
      `)
      .join('');
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', async function() {
  // Automatically trigger save when popup opens
  const timestamp = new Date().toISOString();
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  
  // Send save request immediately
  chrome.runtime.sendMessage({
    type: 'SAVE_TO_QUEUE',
    payload: {
      url: tab.url,
      timestamp: timestamp
    }
  }, async (response) => {
    // Update status
    const statusEl = document.getElementById('status');
    if (response.error) {
      statusEl.textContent = response.message;
      statusEl.style.color = '#c62828';
      // Don't auto-close if there's an error - let user see the queue
    } else {
      statusEl.textContent = response.message;
      statusEl.style.color = '#2e7d32';
      
      // Check if Notion is available before auto-closing
      chrome.runtime.sendMessage({ type: 'CHECK_NOTION_STATUS' }, (notionResponse) => {
        if (notionResponse.isAvailable) {
          // Only auto-close if Notion is available and save was successful
          setTimeout(() => {
            window.close();
          }, 2000);
        }
        // Otherwise, keep popup open to show queue status
      });
    }

    // Update queue count if available
    if (response.queueLength !== undefined) {
      const queueCount = document.getElementById('queueCount');
      queueCount.textContent = `${response.queueLength} item(s) in queue`;
    }
  });

  // Update displays
  await updateQueueDisplay();
  await checkNotionStatus();
});

// Add a manual close button for when popup stays open
document.addEventListener('DOMContentLoaded', function() {
  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  closeButton.className = 'close-button';
  closeButton.addEventListener('click', () => window.close());
  document.querySelector('.container').appendChild(closeButton);
});

// Process queue button handler
document.getElementById('processQueue').addEventListener('click', async () => {
  const status = document.getElementById('status');
  status.textContent = 'Processing queue...';
  status.style.backgroundColor = '#fff3e0';
  status.style.color = '#e65100';
  
  try {
    chrome.runtime.sendMessage({ type: 'PROCESS_QUEUE' }, response => {
      if (response.error) {
        status.textContent = response.message;
        status.style.backgroundColor = '#ffebee';
        status.style.color = '#c62828';
      } else {
        status.textContent = response.message;
        status.style.backgroundColor = '#e8f5e9';
        status.style.color = '#2e7d32';
      }
      updateQueueDisplay();
      checkNotionStatus();
    });
  } catch (error) {
    status.textContent = 'Error processing queue: ' + error.message;
    status.style.backgroundColor = '#ffebee';
    status.style.color = '#c62828';
  }
});

// Update display when popup opens or when storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.saveQueue) {
    updateQueueDisplay();
  }
});

