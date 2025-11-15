# YouTube Music Playlist Downloader

A web-based application for downloading YouTube Music playlists in high-quality FLAC format, automatically organized by artist and album.

## Features

- Download entire YouTube Music playlists in FLAC format
- Automatic file organization by artist and album
- Web-based interface with real-time progress tracking
- Support for authentication via cookies and PO tokens
- Embedded metadata and album artwork
- High-quality audio extraction

## Prerequisites

Before running this application, ensure you have:

1. **Node.js** (v18 or higher)
   ```bash
   # Check your Node.js version
   node --version
   ```

2. **yt-dlp** - YouTube downloader
   ```bash
   # Install via pip
   pip install yt-dlp

   # Or via Homebrew (macOS)
   brew install yt-dlp
   ```

3. **FFmpeg** - Required for audio conversion
   ```bash
   # macOS
   brew install ffmpeg

   # Ubuntu/Debian
   sudo apt install ffmpeg

   # Windows (via Chocolatey)
   choco install ffmpeg
   ```

## Installation

1. Clone or download this repository

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

## Usage

1. Start the server:
   ```bash
   npm start
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

2. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

3. Fill in the form:
   - **Playlist URL**: Your YouTube Music playlist URL (e.g., `https://music.youtube.com/playlist?list=...`)
   - **Output Directory**: Full path where files should be saved (e.g., `/Users/yourname/Music/Downloads`)
   - **Cookies File** (optional): Browser cookies exported as a .txt file for authentication
   - **PO Token** (optional): Additional authentication token if required

4. Click "Start Download" and monitor the progress in real-time

## File Organization

Downloaded files are automatically organized in the following structure:

```
{Output Directory}/
├── Artist Name/
│   ├── Album Name/
│   │   ├── 01 - Track Title.flac
│   │   ├── 02 - Another Track.flac
│   │   └── ...
│   └── Another Album/
│       └── ...
└── Another Artist/
    └── ...
```

## Authentication

### Why You Might Need Authentication

YouTube may require authentication for:
- Age-restricted content
- Private or unlisted playlists
- Geographic restrictions
- Rate limiting prevention

### Getting Browser Cookies

Use a browser extension to export your cookies:
- **Chrome/Edge**: "Get cookies.txt LOCALLY" or "cookies.txt"
- **Firefox**: "cookies.txt"

1. Install the extension
2. Navigate to YouTube Music while logged in
3. Export cookies for `youtube.com`
4. Save as a .txt file
5. Upload via the web interface

### PO Token

If you encounter authentication issues even with cookies, you may need a PO token. Check yt-dlp documentation for the latest method to obtain this.

## Troubleshooting

### "Failed to start yt-dlp"
- Ensure yt-dlp is installed: `yt-dlp --version`
- Make sure it's in your system PATH

### "Output path does not exist"
- Verify the directory path is correct and exists
- Use absolute paths (e.g., `/Users/name/Music` not `~/Music`)

### Download fails or gets stuck
- Try providing cookies from your browser
- Check if the playlist is public and accessible
- Ensure you have enough disk space
- Check yt-dlp is up to date: `pip install --upgrade yt-dlp`

### Audio quality issues
- Ensure FFmpeg is installed properly
- Check that the source audio quality is high enough

## Technical Details

- **Backend**: Node.js with Express
- **Downloader**: yt-dlp
- **Audio Format**: FLAC (lossless, highest quality)
- **Progress Tracking**: Server-Sent Events (SSE)
- **File Upload**: Multer

## License

MIT

## Disclaimer

This tool is for personal use only. Respect copyright laws and YouTube's Terms of Service. Only download content you have the right to download.
