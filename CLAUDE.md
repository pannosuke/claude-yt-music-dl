# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YouTube Music Playlist Downloader - A web application for downloading YouTube Music playlists in FLAC format, automatically organized by artist and album. Uses yt-dlp for downloading and supports authentication via cookies and PO tokens.

## Prerequisites

- Node.js (v18+)
- yt-dlp installed globally: `pip install yt-dlp` or `brew install yt-dlp`
- FFmpeg (required by yt-dlp for audio conversion): `brew install ffmpeg`

## Development Commands

```bash
# Install dependencies
npm install

# Start the server (development mode with auto-reload)
npm run dev

# Start the server (production mode)
npm start
```

The server runs on http://localhost:3000 and serves the web interface.

## Architecture

### Backend (server.js)
- **Express.js server** handling file uploads and download requests
- **Multer middleware** for handling cookies file uploads (stored temporarily in `uploads/`)
- **Server-Sent Events (SSE)** for real-time progress streaming to the frontend
- **yt-dlp subprocess** spawned with specific arguments for FLAC download and metadata embedding

### Frontend (public/index.html)
- Single-page web interface for:
  - Playlist URL input
  - Output directory path selection
  - Optional cookies file upload (.txt format)
  - Optional PO token input
  - Real-time download progress display
  - Log viewer showing download status

### Download Process Flow
1. User submits form with playlist URL, output path, and optional authentication
2. Backend validates inputs and checks output path exists
3. yt-dlp is spawned with arguments for:
   - Best audio quality extraction
   - FLAC conversion with highest quality
   - File organization: `{artist}/{album}/{track_number} - {title}.flac`
   - Metadata embedding (thumbnail, artist, album, track info)
4. Progress is streamed to frontend via SSE
5. Temporary cookies file is cleaned up after completion

## File Organization

Downloaded files are automatically organized as:
```
{output_path}/
  {artist}/
    {album}/
      01 - Song Title.flac
      02 - Another Song.flac
```

## yt-dlp Key Arguments

The application uses these critical yt-dlp options:
- `--format bestaudio`: Select best audio quality
- `--audio-format flac`: Convert to FLAC
- `--audio-quality 0`: Maximum audio quality
- `--output`: Template for file organization by artist/album
- `--embed-thumbnail`: Embed album art
- `--embed-metadata` / `--add-metadata`: Preserve track information
- `--cookies`: Authentication via browser cookies
- `--extractor-args youtube:po_token`: PO token for additional authentication
