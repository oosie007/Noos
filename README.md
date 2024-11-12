# Notion Save Queue Chrome Extension

A Chrome extension that allows you to save websites to Notion, with offline queue support when Notion is not reachable.

## Features

- Save websites to Notion database
- Queue system for offline/VPN scenarios
- Automatic queue processing when Notion becomes available
- Metadata extraction (title, description, images)
- Status monitoring for Notion availability

## Installation

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

## Configuration

1. Create a Notion integration and get your API key
2. Create a Notion database with the following properties:
   - Title (title)
   - URL (url)
   - Description (rich_text)
   - Image (url)
   - Saved Date (date)
   - Timestamp (date)
3. Update the `NOTION_API_KEY` and `DATABASE_ID` in the code

## Development

The extension consists of:
- `background/background.js`: Background service worker
- `popup/popup.js`: Popup UI logic
- `popup/popup.html`: Popup UI layout
- `manifest.json`: Extension configuration

## Usage

1. Click the extension icon to open the popup
2. Click "Save to Queue" to save the current page
3. If Notion is reachable, the page will be saved immediately
4. If Notion is not reachable, the page will be queued
5. Queue processes automatically when Notion becomes available

## License

MIT
