// background.js
const NOTION_API_URL = 'https://api.notion.com/v1/pages';
const NOTION_API_KEY = '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';
const DATABASE_ID = '13428a1b08338026bf6ce092a74a1d61';
 


let queue = [];
let isProcessing = false;
let lastNotionStatus = false;

// Load queue from storage on startup
chrome.storage.local.get(['saveQueue'], (result) => {
  if (result.saveQueue) {
    queue = result.saveQueue;
    console.log('Loaded queue from storage:', queue);
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SAVE_TO_QUEUE') {
    handleSaveRequest(request.payload).then(sendResponse);
    return true;
  } else if (request.type === 'PROCESS_QUEUE') {
    processQueue().then(() => {
      sendResponse({ message: 'Queue processing complete' });
    }).catch(error => {
      sendResponse({ error: true, message: error.message });
    });
    return true;
  }
});

// Get page description
async function getPageDescription(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const metaDesc = document.querySelector('meta[name="description"]')?.content 
          || document.querySelector('meta[property="og:description"]')?.content
          || document.querySelector('meta[name="twitter:description"]')?.content;
        
        if (metaDesc) return metaDesc;

        // Fallback to first paragraph or meaningful text
        const firstParagraph = document.querySelector('p')?.textContent;
        return firstParagraph || '';
      }
    });
    return result[0].result;
  } catch (error) {
    console.error('Error getting description:', error);
    return '';
  }
}

// Get page image
async function getPageImage(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Helper function to check if URL is valid
        const isValidImageUrl = (url) => {
          if (!url) return false;
          try {
            new URL(url);
          } catch {
            return false;
          }
          return /\.(jpg|jpeg|png|webp|gif|svg)($|\?)/i.test(url) ||
                 url.includes('image') ||
                 url.startsWith('data:image/');
        };

        // Get image based on priority
        const selectors = [
          'meta[property="og:image"]',
          'meta[property="og:image:url"]',
          'meta[name="twitter:image"]',
          'meta[name="twitter:image:src"]',
          'meta[property="article:image"]',
          'script[type="application/ld+json"]',
          'img'
        ];

        let bestImage = null;
        let maxSize = 0;

        for (const selector of selectors) {
          if (selector === 'img') {
            const images = document.querySelectorAll('img');
            images.forEach(img => {
              const area = img.naturalWidth * img.naturalHeight;
              if (area > maxSize && isValidImageUrl(img.src) && !img.src.includes('icon')) {
                maxSize = area;
                bestImage = img.src;
              }
            });
          } else if (selector.includes('ld+json')) {
            const scripts = document.querySelectorAll(selector);
            for (const script of scripts) {
              try {
                const data = JSON.parse(script.textContent);
                const findImage = (obj) => {
                  if (!obj) return null;
                  if (typeof obj === 'object') {
                    if (obj.image && isValidImageUrl(obj.image)) return obj.image;
                    for (const key in obj) {
                      const found = findImage(obj[key]);
                      if (found) return found;
                    }
                  }
                  return null;
                };
                const schemaImage = findImage(data);
                if (schemaImage) {
                  bestImage = schemaImage;
                  break;
                }
              } catch (e) {}
            }
          } else {
            const meta = document.querySelector(selector);
            const content = meta?.content || meta?.getAttribute('src');
            if (content && isValidImageUrl(content)) {
              bestImage = content;
              break;
            }
          }
        }
        return bestImage;
      }
    });
    return result[0].result;
  } catch (error) {
    console.error('Error getting image:', error);
    return null;
  }
}

// Get page content
async function getPageContent(tabId) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Helper to clean text
        const cleanText = (text) => {
          return text.replace(/\s+/g, ' ').trim();
        };

        // Helper to check if element is visible
        const isVisible = (element) => {
          const style = window.getComputedStyle(element);
          return style.display !== 'none' && 
                 style.visibility !== 'hidden' && 
                 style.opacity !== '0' &&
                 element.offsetWidth > 0;
        };

        // Get main content container
        const mainContent = document.querySelector('article, [role="main"], main, .content') || document.body;
        
        let content = [];
        
        // Get all headings and their following content
        const headings = mainContent.querySelectorAll('h1, h2, h3, h4, h5, h6');
        headings.forEach(heading => {
          if (!isVisible(heading)) return;
          
          const headingText = cleanText(heading.textContent);
          if (headingText.length < 3) return; // Skip very short headings
          
          // Get content until next heading
          let currentElement = heading.nextElementSibling;
          let sectionContent = [];
          
          while (currentElement && !currentElement.matches('h1, h2, h3, h4, h5, h6')) {
            if (currentElement.matches('p, ul, ol') && isVisible(currentElement)) {
              const text = cleanText(currentElement.textContent);
              if (text.length > 30) { // Skip very short paragraphs
                sectionContent.push(text);
              }
            }
            currentElement = currentElement.nextElementSibling;
          }
          
          if (sectionContent.length > 0) {
            content.push({
              type: 'heading',
              text: headingText,
              level: parseInt(heading.tagName[1])
            });
            sectionContent.forEach(text => {
              content.push({
                type: 'paragraph',
                text: text
              });
            });
          }
        });

        // If no headings found or content is too short, fallback to paragraphs
        if (content.length < 2) {
          const paragraphs = Array.from(mainContent.querySelectorAll('p'))
            .filter(p => isVisible(p))
            .map(p => cleanText(p.textContent))
            .filter(text => text.length > 50)
            .slice(0, 5) // Limit to first 5 substantial paragraphs
            .map(text => ({
              type: 'paragraph',
              text: text
            }));
          
          content = paragraphs;
        }

        // Limit total content length while preserving structure
        let totalLength = 0;
        const maxLength = 2000;
        content = content.filter(item => {
          if (totalLength >= maxLength) return false;
          totalLength += item.text.length;
          if (totalLength > maxLength) {
            item.text = item.text.slice(0, maxLength - (totalLength - item.text.length));
          }
          return true;
        });

        return content;
      }
    });
    return result[0].result;
  } catch (error) {
    console.error('Error getting content:', error);
    return [];
  }
}

// Handle save request
async function handleSaveRequest(data) {
  try {
    const notionAvailable = await isNotionReachable();
    console.log('Notion availability:', notionAvailable);

    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    
    // Get page metadata
    const metadata = {
      url: data.url,
      title: tab.title,
      timestamp: data.timestamp
    };

    // Only try to get additional metadata if we can reach the page
    try {
      const description = await getPageDescription(tab.id);
      const image = await getPageImage(tab.id);
      const content = await getPageContent(tab.id);
      metadata.description = description;
      metadata.image = image;
      metadata.content = content;
    } catch (error) {
      console.warn('Error getting metadata:', error);
    }
    
    console.log('Adding to queue:', metadata);
    
    // Add to queue if Notion is not available
    if (!notionAvailable) {
      queue.push(metadata);
      await chrome.storage.local.set({ saveQueue: queue });
      return {
        message: 'Added to queue (Notion not reachable)',
        queueLength: queue.length
      };
    }

    // Try to save directly if Notion is available
    try {
      await saveToNotion(metadata);
      return {
        message: 'Saved directly to Notion',
        queueLength: queue.length
      };
    } catch (error) {
      // If direct save fails, add to queue
      queue.push(metadata);
      await chrome.storage.local.set({ saveQueue: queue });
      return {
        message: 'Added to queue (Save failed)',
        queueLength: queue.length
      };
    }
  } catch (error) {
    console.error('Error in handleSaveRequest:', error);
    // Always queue if there's an error
    queue.push({
      url: data.url,
      title: tab?.title || 'Unknown',
      timestamp: data.timestamp
    });
    await chrome.storage.local.set({ saveQueue: queue });
    return {
      message: 'Added to queue (Error occurred)',
      queueLength: queue.length,
      error: true
    };
  }
}

// Process queue
async function processQueue() {
  if (isProcessing || queue.length === 0) {
    console.log('Queue processing skipped:', isProcessing ? 'already processing' : 'queue empty');
    return;
  }
  
  console.log('Starting queue processing, items:', queue.length);
  isProcessing = true;

  try {
    const notionResponse = await fetch('https://api.notion.com/v1/databases/' + DATABASE_ID, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28'
      }
    });

    if (!notionResponse.ok) {
      const errorData = await notionResponse.text();
      console.error('Notion API error:', errorData);
      isProcessing = false;
      return;
    }

    while (queue.length > 0) {
      const item = queue[0];
      try {
        console.log('Processing item:', item.title);
        await saveToNotion(item);
        
        // Only remove from queue if save was successful
        queue.shift();
        await chrome.storage.local.set({ saveQueue: queue });
        console.log('Queue updated, remaining items:', queue.length);
      } catch (error) {
        console.error('Error saving item to Notion:', error);
        // Wait before trying again
        await new Promise(resolve => setTimeout(resolve, 5000));
        isProcessing = false;
        return;
      }
    }
  } catch (error) {
    console.error('Queue processing error:', error);
  } finally {
    isProcessing = false;
  }
}
// Add this helper function at the top level
async function isValidImageUrl(url) {
  if (!url) return false;
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const contentType = response.headers.get('content-type');
    return contentType && contentType.startsWith('image/');
  } catch (error) {
    console.log('Image validation failed:', error);
    return false;
  }
}

// Save to Notion
async function saveToNotion(data) {
  console.log('Saving to Notion:', data);
  
  // Build children array
  const children = [];

  // Add image block if URL exists
  if (data.image) {
    try {
      children.push({
        object: 'block',
        type: 'image',
        image: {
          type: 'external',
          external: {
            url: data.image
          }
        }
      });

      // Add a spacing paragraph after image
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: []
        }
      });
    } catch (error) {
      console.log('Error adding image to page content:', error);
    }
  }

  const pageData = {
    parent: { database_id: DATABASE_ID },
    properties: {
      Title: {
        title: [
          {
            text: {
              content: data.title || 'Untitled'
            }
          }
        ]
      },
      url: {
        url: data.url || ''
      },
      description: {
        rich_text: [
          {
            text: {
              content: (data.description || '').slice(0, 2000)
            }
          }
        ]
      },
      'saved date': {
        date: {
          start: new Date(data.timestamp).toISOString()
        }
      }
    },
    children: children
  };

  try {
    const response = await fetch(NOTION_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(pageData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Notion API error:', errorText);
      throw new Error(`Failed to save to Notion: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error in saveToNotion:', error);
    throw error;
  }
}

// Check Notion status and process queue
async function checkNotionAndProcess() {
  try {
    const notionAvailable = await isNotionReachable();
    console.log('Checking Notion status:', notionAvailable, 'Last status:', lastNotionStatus, 'Queue length:', queue.length);
    
    if (notionAvailable !== lastNotionStatus || (notionAvailable && queue.length > 0)) {
      console.log('Notion status changed or queue needs processing');
      lastNotionStatus = notionAvailable;
      
      // Update popup status if possible
      try {
        chrome.runtime.sendMessage({
          type: 'NOTION_STATUS_UPDATE',
          status: notionAvailable
        });
      } catch (e) {
        // Popup might not be open, ignore error
      }
      
      if (notionAvailable && queue.length > 0) {
        console.log('Processing queue because Notion is available');
        await processQueue();
      }
    }
  } catch (error) {
    console.error('Status check failed:', error);
    lastNotionStatus = false;
  }
}

// Set up periodic checks
setInterval(checkNotionAndProcess, 5000); // Check every 5 seconds

// Check on startup
chrome.runtime.onStartup.addListener(() => {
  checkNotionAndProcess();
});

// Listen for network status changes
chrome.tabs.onActivated.addListener(() => {
  if (queue.length > 0) {
    console.log('Tab activated with items in queue, checking Notion status');
    checkNotionAndProcess();
  }
});

// Monitor storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.saveQueue) {
    console.log('Queue updated:', {
      oldValue: changes.saveQueue.oldValue,
      newValue: changes.saveQueue.newValue
    });
  }
});

async function fetchWithTimeout(url, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function isNotionReachable() {
  try {
    // First check if notion.so is reachable
    try {
      const websiteResponse = await fetchWithTimeout('https://www.notion.so', {
        method: 'HEAD',
        mode: 'no-cors' // Important for cross-origin requests
      }, 5000);
      
      if (!websiteResponse.type === 'opaque') {
        console.log('Notion website not reachable');
        return false;
      }
    } catch (error) {
      console.log('Notion website not reachable:', error);
      return false;
    }

    // Then check API access
    const apiResponse = await fetchWithTimeout('https://api.notion.com/v1/databases/' + DATABASE_ID, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28'
      }
    }, 5000);

    const isAvailable = apiResponse.ok;
    console.log('Notion API check result:', isAvailable);
    return isAvailable;
  } catch (error) {
    console.log('Notion not reachable:', error);
    return false;
  }
}

