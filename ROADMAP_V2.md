# Version 2.0.0 Roadmap - Music Library Organizer

## Overview

Version 2.0.0 transforms this application from a single-purpose YouTube Music downloader into a comprehensive music management suite with two modules:

1. **Module 1: YouTube Music Downloader** (Existing - Complete)
2. **Module 2: Music Library Organizer** (New - In Development)

## Project Goals

### Primary Objective
Create a comprehensive music management pipeline that downloads YouTube Music playlists OR processes existing offline music libraries, matches tracks against MusicBrainz metadata database, renames files to Plex standards, checks for duplicates/quality conflicts with live Plex library, and moves organized files to the live Plex library folder.

### Two-Path Workflow

**Path 1: YouTube Music Download**
```
YouTube Playlist → Download (FLAC) → Match MusicBrainz → Rename Files → Compare Plex Library → Move to Live Library
```

**Path 2: Offline Library Organization**
```
Offline Music Folder → Scan Files → Match MusicBrainz → Rename Files → Compare Plex Library → Move to Live Library
```

**End Goal:** Get all music (downloaded or existing) matched with accurate metadata, renamed to Plex standards, deduplicated against live Plex library, and moved to the live Plex library folder for seamless playback.

### Key Requirements
- Support both Western and Japanese music databases (MusicBrainz)
- Process large music libraries efficiently (chunked/alphabetical processing)
- Maintain safety with dry-run mode and backup recommendations
- Real-time progress updates via Server-Sent Events
- Plex Media Server compatibility as the primary standard
- Prevent duplicate additions and quality downgrades
- Enable quality upgrades (replace MP3 with FLAC when available)

---

## Architecture

### Technology Stack

**Frontend:**
- Hash-based routing for tab navigation
- Modular CSS/JS architecture
- Server-Sent Events (SSE) for real-time updates

**Backend:**
- Express.js REST API
- MusicBrainz API for metadata lookups
- AcoustID/Chromaprint for audio fingerprinting
- SQLite for local API response caching

**Libraries:**
- `music-metadata` - Read/write ID3/FLAC tags
- `fast-glob` - Efficient directory scanning
- `musicbrainz-api` - Western + Japanese music database
- `p-limit` - Concurrency control
- `better-sqlite3` - Local caching database

### File Structure

```
claude-yt-music-dl/
├── public/
│   ├── css/
│   │   ├── shared.css          ✅ Complete
│   │   ├── downloader.css      ✅ Complete
│   │   ├── organizer.css       ✅ Complete (Phases 2-3.5)
│   │   ├── upgrader.css        ✅ Complete (Phase 5)
│   │   └── radar.css           ✅ Complete (Phase 8)
│   ├── js/
│   │   ├── router.js           ✅ Complete
│   │   ├── downloader.js       ✅ Complete
│   │   ├── organizer.js        ✅ Complete (Phases 2-3.5)
│   │   ├── upgrader.js         ✅ Complete (Phase 5)
│   │   └── radar.js            ✅ Complete (Phase 8)
│   └── index.html              ✅ Complete (Phases 1-8)
├── modules/
│   ├── downloader/             📁 Created (unused)
│   └── organizer/              📁 Created
│       ├── scanner.js          ✅ Complete (Phase 2)
│       ├── plex.js             ✅ Complete (Phase 2.5)
│       ├── musicbrainz.js      ✅ Complete (Phase 3)
│       ├── matcher.js          ✅ Complete (Phase 3.5)
│       ├── organizer.js        ✅ Complete (Phase 4 Backend)
│       ├── upgrader.js         ✅ Complete (Phase 5)
│       ├── metadata-updater.js ✅ Complete (Metadata editing)
│       ├── romaji-converter.js ✅ Complete (Japanese support)
│       └── artist-radar.js     ✅ Complete (Phase 8)
├── server.js                   ✅ Complete (Phases 1-8 Backend)
├── package.json                ✅ Updated to v2.0.0
├── data/
│   ├── musicbrainz-cache.db    ✅ SQLite cache (Phase 3)
│   └── plex-albums.db          ✅ Plex album cache (Phase 2.5)
└── ROADMAP_V2.md               ✅ This file
```

---

## Plex Media Server Standards

### Required Folder Structure
```
Music/
└── Artist Name/
    └── Album Name (Year)/
        ├── 01 - Track Title.flac
        ├── 02 - Track Title.flac
        └── cover.jpg
```

### Naming Conventions
- **Artists**: Proper capitalization, no extra characters
- **Albums**: Include year in parentheses: `Album Name (2024)`
- **Tracks**: `{track_number} - {title}.{ext}` format
- **Japanese**: Romanization using Modified Revised Hepburn standard

### Metadata Requirements
- Embedded ID3/FLAC tags (artist, album, title, year, track number)
- Album artwork embedded in files
- Genre tags (optional but recommended)

---

## Implementation Phases

### ✅ Phase 1: UI Architecture & Navigation (COMPLETE)
**Status:** Complete
**Completed:** Nov 15, 2025

**Deliverables:**
- ✅ Hash-based tab navigation system ([router.js](public/js/router.js))
- ✅ Modular CSS architecture (shared, downloader, organizer)
- ✅ Modular JavaScript architecture
- ✅ Refactored downloader into Module 1
- ✅ Created placeholder UI for Module 2
- ✅ Updated package.json to v2.0.0

**Files Created:**
- `public/css/shared.css`
- `public/css/downloader.css`
- `public/css/organizer.css`
- `public/js/router.js`
- `public/js/downloader.js`
- `public/js/organizer.js`
- `public/index.html` (refactored)

**Testing:**
- ✅ Server running on localhost:3000
- ✅ Tab navigation functional
- ✅ Downloader module preserves all v1.1.0 features
- ✅ Organizer tab displays placeholder

---

### ✅ Phase 2: File Scanning & Metadata Reading (COMPLETE)
**Status:** 100% Complete
**Estimated Time:** 2-3 hours
**Time Spent:** ~2 hours
**Completed:** Nov 15, 2025

**Goals:**
- Scan music directory recursively for audio files
- Read existing metadata from files (ID3/FLAC tags)
- Extract folder structure and filenames
- Identify files that need reorganization
- Implement two-phase scanning (structure scan → deep scan)
- Support alphabetical chunking by artist name

**Tasks:**
- [x] Create `modules/organizer/scanner.js` backend module
- [x] Implement directory scanning with `fast-glob`
- [x] Read metadata using `music-metadata`
- [x] Identify Plex standard violations
- [x] Create `/api/scan/structure` endpoint (Phase 1: quick structure scan)
- [x] Create `/api/scan` endpoint (Phase 2: deep scan with metadata)
- [x] Implement alphabetical grouping (A-Z, #)
- [x] Add artist letter filtering for deep scans
- [x] Build organizer frontend form (directory input, scan button)
- [x] Add drag-and-drop support for folder path
- [x] Display structure scan results with alphabetical grid
- [x] Add letter selection UI (click to select/deselect)
- [x] Add "Deep Scan Selected" and "Deep Scan All" buttons
- [x] Add SSE progress updates for scanning
- [x] Add cancel button for scanning operations
- [x] Fix JSON serialization issues with large datasets
- [x] Complete deep scan results display UI
- [x] Add grouping by artist for scan results
- [x] Display compliance issues breakdown
- [x] Add file list with metadata preview (expandable by letter group)

**Deliverables:**
- ✅ Backend scanner module ([modules/organizer/scanner.js](modules/organizer/scanner.js:1))
- ✅ API endpoints for structure scan and deep scan
- ✅ Frontend structure scan interface with alphabetical grid
- ✅ Progress tracking UI with SSE
- ✅ Cancellation support with AbortController
- ✅ Deep scan results display with expandable file lists

**Success Criteria:**
- ✅ Can scan directories with 1000+ files efficiently
- ✅ Correctly identifies audio files (FLAC, MP3, M4A, etc.)
- ✅ Extracts metadata without errors
- ✅ Reports scan progress in real-time
- ✅ Alphabetical grouping works correctly
- ✅ Letter filtering for deep scan works
- ✅ Deep scan results are displayed clearly with expandable details

---

### ✅ Phase 2.5: Plex Media Server Integration (COMPLETE)
**Status:** 100% Complete
**Estimated Time:** 3-4 hours
**Time Spent:** ~3 hours
**Completed:** Nov 17, 2025

**Goals:**
- Connect to Plex Media Server API to interrogate existing music library
- Fetch all tracks with metadata (artist, album, title, codec, bitrate, file path)
- Compare offline scanned files against Plex library for duplicate detection
- Implement quality comparison logic (FLAC > ALAC > 320kbps MP3 > lower bitrates)
- Provide conflict resolution UI for duplicates and quality downgrades

**Why This Phase:**
This phase bridges the gap between scanning the offline folder (Phase 2) and organizing files (Phase 4+). By interrogating the live Plex library first, we can:
1. **Prevent duplicates** - Don't add tracks already in Plex
2. **Prevent quality downgrades** - Don't replace FLAC with MP3
3. **Enable smart upgrades** - Replace MP3 with FLAC when available
4. **Future-proof for Module 3** - Lay groundwork for ratings/play count interrogation

**Tasks:**

**Backend (modules/organizer/plex.js):**
- [x] Create `modules/organizer/plex.js` backend module
- [x] Implement Plex authentication (X-Plex-Token)
- [x] Add Plex server connection testing endpoint
- [x] Fetch all library sections (identify Music library ID)
- [x] Fetch all tracks from Music library with full metadata
- [x] Parse track metadata (artist, album, title, year, track number)
- [x] Extract media info (codec, bitrate, channels, sample rate)
- [x] Extract file paths for each track
- [x] Build in-memory index of Plex library (artist+album+title → track)
- [x] Implement duplicate detection logic (fuzzy matching on metadata)
- [x] Implement quality comparison logic with codec ranking
- [x] Create `/api/plex/connect` endpoint (test connection)
- [x] Create `/api/plex/libraries` endpoint (list music libraries)
- [x] Create `/api/plex/fetch` endpoint (fetch library with SSE progress)
- [x] Create `/api/plex/compare` endpoint (compare offline vs Plex)

**Frontend (public/js/organizer.js):**
- [x] Add Plex settings form fields (server IP, port, token)
- [x] Add "Connect to Plex" button with connection testing
- [x] Add "Fetch Plex Library" button
- [x] Display Plex library statistics (total artists, albums, tracks)
- [x] Add "Compare with Plex" button (after deep scan completes)
- [x] Display comparison results with categorized conflicts:
  - ✅ **Safe to Add** - Not in Plex library
  - ⚠️ **Duplicates** - Already exists in Plex
  - 🔼 **Quality Upgrades** - Better quality than Plex version
  - 🔽 **Quality Downgrades** - Worse quality than Plex version
- [x] Add conflict resolution UI with action buttons:
  - "Keep Plex Version" (skip offline file)
  - "Replace with New" (delete Plex, add offline)
  - "Keep Both" (add as duplicate with suffix)
  - "Skip File" (ignore for now)
- [x] Save comparison results to localStorage for later review

**Deliverables:**
- Plex API integration module
- Connection testing functionality
- Library fetching with progress tracking
- Duplicate detection engine
- Quality comparison engine (codec ranking)
- Conflict resolution UI

**Success Criteria:**
- Successfully connects to Plex Media Server
- Fetches complete music library metadata
- Detects exact duplicates (same artist/album/title)
- Detects near-duplicates (fuzzy matching with Levenshtein distance)
- Correctly ranks audio quality (FLAC > ALAC > MP3 320kbps > MP3 256kbps > MP3 128kbps)
- Provides clear conflict resolution options
- Does not accidentally delete or overwrite Plex library files

**Plex API Endpoints Used:**

1. **Test Connection:**
   ```
   GET http://{ip}:{port}/?X-Plex-Token={token}
   Returns: Server info (name, version, platform)
   ```

2. **Get Library Sections:**
   ```
   GET http://{ip}:{port}/library/sections?X-Plex-Token={token}
   Returns: List of libraries with IDs and types
   Find: type="artist" for Music library
   ```

3. **Get All Tracks:**
   ```
   GET http://{ip}:{port}/library/sections/{sectionId}/all?X-Plex-Token={token}
   Returns: XML/JSON with all tracks in library
   Fields: title, originalTitle, grandparentTitle (artist), parentTitle (album),
           index (track number), year, media array with codec/bitrate
   ```

4. **Get Track Metadata:**
   ```
   GET http://{ip}:{port}/library/metadata/{ratingKey}?X-Plex-Token={token}
   Returns: Detailed metadata for specific track including file path via Media.Part.file
   ```

**Quality Ranking Algorithm:**

```javascript
const CODEC_QUALITY_RANK = {
  'flac': 1000,        // Lossless - highest quality
  'alac': 950,         // Apple Lossless
  'ape': 900,          // Monkey's Audio (lossless)
  'wav': 850,          // Uncompressed (large files)
  'aiff': 840,         // Uncompressed (large files)
  'mp3': (bitrate) => {
    if (bitrate >= 320) return 700;
    if (bitrate >= 256) return 600;
    if (bitrate >= 192) return 500;
    if (bitrate >= 128) return 400;
    return 300;
  },
  'aac': (bitrate) => {
    if (bitrate >= 256) return 680;
    if (bitrate >= 192) return 580;
    if (bitrate >= 128) return 480;
    return 380;
  },
  'm4a': (bitrate) => { /* same as aac */ },
  'ogg': (bitrate) => {
    if (bitrate >= 320) return 650;
    if (bitrate >= 192) return 550;
    return 450;
  },
  'opus': (bitrate) => { /* same as ogg */ },
  'wma': 200,          // Low quality
};

function compareQuality(fileA, fileB) {
  const scoreA = calculateQualityScore(fileA.codec, fileA.bitrate);
  const scoreB = calculateQualityScore(fileB.codec, fileB.bitrate);

  if (scoreA > scoreB) return 'A_BETTER';      // fileA is higher quality
  if (scoreB > scoreA) return 'B_BETTER';      // fileB is higher quality
  return 'EQUAL';
}
```

**Duplicate Detection Algorithm:**

```javascript
// Exact match
function isExactDuplicate(offlineTrack, plexTrack) {
  return normalizeString(offlineTrack.artist) === normalizeString(plexTrack.artist) &&
         normalizeString(offlineTrack.album) === normalizeString(plexTrack.album) &&
         normalizeString(offlineTrack.title) === normalizeString(plexTrack.title);
}

// Fuzzy match with Levenshtein distance
function isFuzzyDuplicate(offlineTrack, plexTrack, threshold = 0.85) {
  const artistSimilarity = levenshteinSimilarity(offlineTrack.artist, plexTrack.artist);
  const albumSimilarity = levenshteinSimilarity(offlineTrack.album, plexTrack.album);
  const titleSimilarity = levenshteinSimilarity(offlineTrack.title, plexTrack.title);

  const avgSimilarity = (artistSimilarity + albumSimilarity + titleSimilarity) / 3;
  return avgSimilarity >= threshold;
}

function normalizeString(str) {
  return str.toLowerCase()
    .replace(/[^\w\s]/g, '')  // Remove punctuation
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
}
```

**Conflict Categories:**

1. **Safe to Add** (Green ✅)
   - Track not found in Plex library
   - Action: Proceed with organization and add to Plex

2. **Exact Duplicate** (Yellow ⚠️)
   - Exact metadata match in Plex
   - Action: Skip file (don't add to Plex)

3. **Quality Upgrade** (Blue 🔼)
   - Duplicate exists but offline version is higher quality
   - Example: Plex has MP3 128kbps, offline has FLAC
   - Action: Offer to replace Plex version

4. **Quality Downgrade** (Red 🔽)
   - Duplicate exists but offline version is lower quality
   - Example: Plex has FLAC, offline has MP3 128kbps
   - Action: Warn user, recommend skipping

5. **Same Quality Duplicate** (Yellow ⚠️)
   - Duplicate with identical quality
   - Action: Skip or keep both with filename suffix

**UI Mockup:**

```
┌─────────────────────────────────────────────────────────────┐
│ Plex Media Server Settings                                  │
├─────────────────────────────────────────────────────────────┤
│ Server IP:    [192.168.1.100      ] Port: [32400]          │
│ X-Plex-Token: [************************]  [Test Connection]│
│                                                             │
│ Status: ✅ Connected to "MyPlexServer" (v1.40.1.8227)       │
│                                                             │
│ [Fetch Plex Library]  [Compare with Offline Scan]          │
├─────────────────────────────────────────────────────────────┤
│ Plex Library Stats:                                         │
│ • 2,142 Artists                                             │
│ • 8,456 Albums                                              │
│ • 98,234 Tracks                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Comparison Results                                          │
├─────────────────────────────────────────────────────────────┤
│ ✅ Safe to Add:           1,234 tracks                      │
│ ⚠️  Exact Duplicates:       456 tracks                      │
│ 🔼 Quality Upgrades:        89 tracks (MP3 → FLAC)         │
│ 🔽 Quality Downgrades:      23 tracks (FLAC → MP3)         │
│ ⚠️  Same Quality Dupes:     12 tracks                       │
├─────────────────────────────────────────────────────────────┤
│ [View Safe to Add] [Review Upgrades] [Review Downgrades]   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Quality Upgrades (89 tracks)                                │
├─────────────────────────────────────────────────────────────┤
│ Artist Name - Album Name - Track Title                      │
│ Plex: MP3 128kbps → Offline: FLAC 1411kbps                 │
│ [Replace in Plex] [Keep Plex Version] [Skip]               │
├─────────────────────────────────────────────────────────────┤
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘
```

**Security & Safety:**
- Never delete files from Plex library without explicit user confirmation
- All Plex operations are read-only in Phase 2.5 (no writes to Plex database)
- File replacement happens in Phase 5 (File Operations) with dry-run mode
- Log all Plex API calls for debugging
- Validate X-Plex-Token before making requests
- Handle network errors gracefully

**Dependencies:**
- No new dependencies needed (use native `fetch` or `https` module)
- Alternative: `@plex/plex-api` npm package (optional, for easier integration)

**Future Enhancements (Post-Phase 2.5):**
- Plex API write operations (delete tracks, trigger library refresh)
- Fetch ratings, play counts, and user metadata
- Support for multiple Plex libraries
- Smart playlist integration
- Automatic Plex library refresh after organization

---

### ✅ Phase 3: MusicBrainz API Integration (COMPLETE)
**Status:** 100% Complete
**Estimated Time:** 3-4 hours
**Time Spent:** ~3 hours
**Completed:** Nov 17, 2025

**Goals:**
- Integrate MusicBrainz API for metadata lookups
- Support Western and Japanese music
- Implement rate limiting (1 request/second)
- Cache results in SQLite database

**Tasks:**
- [x] Create `modules/organizer/musicbrainz.js` backend module
- [x] Implement MusicBrainz API client with rate limiting
- [x] Create SQLite cache database with 30-day TTL
- [x] Implement cache lookup/storage
- [x] Add confidence scoring for matches (Levenshtein distance)
- [x] Handle Japanese romanization (NFD normalization + diacritic removal)
- [x] Create `/api/musicbrainz/search-artist` endpoint
- [x] Create `/api/musicbrainz/search-release` endpoint
- [x] Create `/api/musicbrainz/search-recording` endpoint
- [x] Create `/api/musicbrainz/release-details` endpoint
- [x] Create `/api/musicbrainz/cache-stats` endpoint
- [x] Add frontend search UI for artist/release/recording
- [x] Add result display with confidence badges

**Deliverables:**
- ✅ MusicBrainz integration module ([modules/organizer/musicbrainz.js](modules/organizer/musicbrainz.js:1))
- ✅ SQLite caching system (data/musicbrainz-cache.db)
- ✅ Match confidence scoring algorithm (0-100% using Levenshtein distance)
- ✅ Japanese music support (tested with YOASOBI)
- ✅ Frontend search UI with forms and results display
- ✅ 5 REST API endpoints

**Success Criteria:**
- ✅ Successfully queries MusicBrainz API
- ✅ Respects 1 req/sec rate limit with p-limit
- ✅ Caches responses to minimize API calls (30-day TTL)
- ✅ Matches Japanese music correctly (Unicode support)
- ✅ Confidence scores are accurate (100% for Coldplay, YOASOBI)

**Rate Limiting Strategy:**
- ✅ Use `p-limit` to enforce 1 request/second
- ✅ Queue requests for processing
- ✅ 1-second delay between API calls

---

### ✅ Phase 3.5: Auto-Match & Rename Engine (COMPLETE)
**Status:** 100% Complete
**Estimated Time:** 4-5 hours
**Time Spent:** ~4 hours
**Completed:** November 18, 2025

**Goals:**
- Automatically match scanned files to MusicBrainz database in batch
- Calculate confidence scores for each match
- Implement confidence-based workflows (auto-approve, review, manual)
- Preview renamed file structure before execution
- Execute file renaming with dry-run mode
- Support manual override for low-confidence matches

**Why This Phase:**
This is the **critical missing piece** that connects file scanning (Phase 2) with file organization (Phase 4). Without auto-matching and renaming:
- Users would have to manually search MusicBrainz for every file (Phase 3 UI)
- No batch processing capability
- No way to rename files to Plex standards

With Phase 3.5, the workflow becomes:
1. **Scan folder** → Get list of files with existing metadata
2. **Auto-match** → Batch search MusicBrainz for all files
3. **Review matches** → See confidence scores, approve/reject/edit
4. **Preview renames** → See before/after file paths
5. **Execute rename** → Apply changes (dry-run first)
6. **Ready for Phase 4** → Move to live Plex library

**Confidence Thresholds:**
- **≥90% confidence**: Auto-approve (green badge)
- **70-89% confidence**: Manual review required (yellow badge)
- **<70% confidence**: Manual search required (red badge)

**Tasks:**

**Backend (modules/organizer/matcher.js):**
- [x] Create `modules/organizer/matcher.js` backend module
- [x] Implement batch file-to-MusicBrainz matching algorithm
  - [x] Extract artist/album/title from existing file metadata
  - [x] Search MusicBrainz for each file using searchRecording()
  - [x] Calculate confidence scores (reuse Levenshtein from musicbrainz.js)
  - [x] Cache MusicBrainz responses per file
- [x] Create `/api/matcher/batch-match` endpoint (SSE progress)
  - [x] Input: Array of scanned files
  - [x] Output: SSE stream with match results + confidence scores
- [x] Implement rename preview generator
  - [x] Input: MusicBrainz match data
  - [x] Output: Proposed file path following Plex standards
  - [x] Format: `{artist}/{album (year)}/{track_number} - {title}.{ext}`
- [x] Create `/api/matcher/preview-rename` endpoint
  - [x] Show before/after file paths
  - [x] Group by confidence category
- [x] Create `/api/matcher/execute-rename` endpoint
  - [x] Support dry-run mode (no actual file operations)
  - [x] Rename files using fs.rename()
  - [x] Handle errors gracefully (permissions, file locks)
  - [x] SSE progress updates per file

**Frontend (public/js/organizer.js):**
- [x] Add "Auto-Match to MusicBrainz" button (after deep scan)
- [x] Display batch matching progress (files processed, matches found)
- [x] Show match results grouped by confidence:
  - [x] ✅ **Auto-Approved** (≥90%): Artist - Album - Title (confidence badge)
  - [x] ⚠️ **Review Required** (70-89%): Artist - Album - Title (confidence badge)
  - [x] ❌ **Manual Search** (<70%): Artist - Album - Title (confidence badge)
- [x] Add filter buttons for match results (all, auto_approve, review, manual, skipped)
- [x] Add "Preview Renames" button
- [x] Display rename preview table:
  - [x] Current path
  - [x] Proposed path (following Plex standards)
  - [x] Limited to 50 items for performance
- [x] Add "Execute Rename (Dry-Run)" button
- [x] Add "Execute Rename (Apply Changes)" button
- [x] Display rename execution progress with SSE
- [x] Show success/error messages per file

**Deliverables:**
- ✅ Batch matching algorithm
- ✅ Confidence-based categorization
- ✅ Rename preview generator (Plex-compliant paths)
- ✅ Rename execution engine with dry-run mode
- ✅ Frontend UI for reviewing, approving, and executing
- ✅ SSE progress tracking for batch operations

**Success Criteria:**
- ✅ Batch matches 100+ files efficiently
- ✅ High-confidence matches (≥90%) are accurate
- ✅ Low-confidence matches are flagged for review
- ✅ User can approve/reject/edit individual matches
- ✅ Rename preview accurately reflects Plex standards
- ✅ Dry-run mode works correctly (no actual file changes)
- ✅ Execute rename works without data loss
- ✅ No false positives on well-tagged files

**Matching Strategy:**
1. **Extract metadata from file** (Phase 2 already provides this)
2. **Search MusicBrainz** using artist + album + title
3. **Calculate confidence** using Levenshtein distance
4. **Categorize by confidence** (90%+, 70-89%, <70%)
5. **Allow manual override** for low-confidence matches
6. **Generate rename preview** using MusicBrainz data
7. **Execute rename** with dry-run option

**Plex-Compliant File Path Format:**
```
{artist}/{album}/{track_number} - {title}.{ext}

Example:
Coldplay/A Head Full of Dreams (2015)/01 - A Head Full of Dreams.flac
YOASOBI/THE BOOK (2021)/03 - 夜に駆ける.flac
```

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│ Auto-Match to MusicBrainz                                   │
├─────────────────────────────────────────────────────────────┤
│ [Start Batch Match]  [Cancel]                               │
│                                                             │
│ Progress: 234 / 523 files matched (45%)                     │
│ ████████████░░░░░░░░░░░░░░░░░                              │
├─────────────────────────────────────────────────────────────┤
│ Match Results:                                              │
│ • ✅ Auto-Approved (≥90%): 412 files                        │
│ • ⚠️  Review Required (70-89%): 89 files                    │
│ • ❌ Manual Search (<70%): 22 files                         │
│                                                             │
│ [View Auto-Approved] [Review Matches] [View Manual]        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Review Required (89 files)                                  │
├─────────────────────────────────────────────────────────────┤
│ File: /music/Artist/Album/track.flac                        │
│ MusicBrainz Match: Artist Name - Album Name - Track Title  │
│ Confidence: 85% ⚠️                                          │
│                                                             │
│ [✅ Approve] [✏️ Edit Match] [⏭️ Skip]                     │
├─────────────────────────────────────────────────────────────┤
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Rename Preview (501 files)                                  │
├─────────────────────────────────────────────────────────────┤
│ Current:  /music/artist name/album/01 track.flac           │
│ Proposed: /music/Artist Name/Album Name (2024)/01 - Track  │
│           Title.flac                                        │
│ Status: ✅ Approved                                         │
├─────────────────────────────────────────────────────────────┤
│ ...                                                         │
│                                                             │
│ [🔍 Execute Rename (Dry-Run)] [✅ Execute Rename (Apply)]  │
└─────────────────────────────────────────────────────────────┘
```

---

### ✅ Phase 3.75: Manual Review & Override Interface (COMPLETE)
**Status:** 100% Complete
**Estimated Time:** 2-3 hours
**Time Spent:** ~2 hours
**Completed:** November 18, 2025
**Priority:** HIGH (Was blocking Phase 4 testing)

---

### 🔄 Phase 3.8: Three-Phase MusicBrainz Matching Strategy (IN PROGRESS)
**Status:** Backend & Frontend Complete - Testing Required
**Estimated Time:** 3-4 hours
**Time Spent:** ~3 hours
**Started:** November 18, 2025
**Priority:** HIGH (Better UX for metadata matching)

**Rationale:**
The original single-phase batch matching had a critical flaw: if an artist name was incorrect, ALL albums and tracks from that artist would also be wrong. This three-phase approach allows fixing errors at each level before they cascade:

1. **Phase 1: Match Artists** - Fix artist names first
2. **Phase 2: Match Albums** - Albums inherit corrected artist names
3. **Phase 3: Match Tracks** - Tracks inherit corrected artist AND album names

**Benefits:**
- Granular control over matching process
- Fix artist-level errors before they affect 100+ tracks
- Easier to review and correct matches at each level
- Prevents cascading errors from incorrect metadata
- Better user experience with sequential workflow

**Architecture:**

```
┌─────────────────────────────────────────────────────────┐
│ Phase 1: Match Artists                                  │
│ - Extract unique artists from all files                 │
│ - Match each artist to MusicBrainz                      │
│ - Show artist matches with file counts                  │
│ - Accept/Edit/Search/Skip each artist                   │
│ - Save corrected artist names                           │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 2: Match Albums                                   │
│ - Group files by album using corrected artist names     │
│ - Match albums to MusicBrainz releases                  │
│ - Show album matches with track counts                  │
│ - Accept/Edit/Search/Skip each album                    │
│ - Save corrected album names                            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│ Phase 3: Match Tracks                                   │
│ - Match individual tracks using corrected metadata      │
│ - Show track matches with full metadata                 │
│ - Accept/Edit/Search/Skip each track                    │
│ - Ready for rename preview                              │
└─────────────────────────────────────────────────────────┘
```

**Implementation:**

**Backend (modules/organizer/matcher.js):**
- [x] `matchArtists(files, progressCallback)` - Extract unique artists, match to MusicBrainz
- [x] `matchAlbums(files, artistMatches, progressCallback)` - Match albums using corrected artists
- [x] `matchTracks(files, artistMatches, albumMatches, progressCallback)` - Match tracks with full context
- [x] Each function returns results with confidence scores and status
- [x] Japanese variant support in all three phases
- [x] Artist/album lookup maps for applying corrections

**Backend (server.js):**
- [x] `POST /api/matcher/match-artists` - Phase 1 endpoint with SSE
- [x] `POST /api/matcher/match-albums` - Phase 2 endpoint with SSE
- [x] `POST /api/matcher/match-tracks` - Phase 3 endpoint with SSE
- [x] Progress streaming for all three phases
- [x] Statistics calculation (auto-approve, review, manual counts)

**Frontend (public/index.html):**
- [x] Three sequential buttons: "Phase 1: Match Artists", "Phase 2: Match Albums", "Phase 3: Match Tracks"
- [x] Phase 2 and 3 buttons start disabled
- [x] Buttons unlock progressively as each phase completes
- [x] Visual styling change from secondary to primary when unlocked

**Frontend (public/js/organizer.js):**
- [x] State variables: `artistMatchResults`, `albumMatchResults`
- [x] Event listeners for three phase buttons
- [x] `handleMatchArtists()` - Execute Phase 1, enable Phase 2 on completion
- [x] `handleMatchAlbums()` - Execute Phase 2, enable Phase 3 on completion
- [x] `handleMatchTracks()` - Execute Phase 3, show output directory config
- [x] `displayArtistMatchResults()` - Show artist matches with file counts
- [x] `displayAlbumMatchResults()` - Show album matches with track counts
- [x] Reuse existing `displayMatchResults()` for Phase 3 tracks

**UI Flow:**
```
┌─────────────────────────────────────────────────────────┐
│ [Phase 1: Match Artists] (enabled)                      │
│ [Phase 2: Match Albums] (disabled - locked)             │
│ [Phase 3: Match Tracks] (disabled - locked)             │
└─────────────────────────────────────────────────────────┘
                ↓ Click Phase 1
┌─────────────────────────────────────────────────────────┐
│ Artist Match Results:                                   │
│ ✓ AUTO-APPROVE: XG (90% - 4 files)                     │
│ ⚠️ REVIEW: BABYMETAL (85% - 12 files) [Accept][Search] │
│ ❌ MANUAL: Unknown Artist (0% - 3 files) [Search][Edit]│
└─────────────────────────────────────────────────────────┘
                ↓ Review and fix artist matches
┌─────────────────────────────────────────────────────────┐
│ [Phase 1: Match Artists] (completed ✓)                  │
│ [Phase 2: Match Albums] (enabled - unlocked!)           │
│ [Phase 3: Match Tracks] (disabled - locked)             │
└─────────────────────────────────────────────────────────┘
                ↓ Click Phase 2
                ... (repeat for albums and tracks)
```

**Tasks:**

**Testing:**
- [ ] Test Phase 1 with small dataset (4-10 artists)
- [ ] Verify artist matches display correctly
- [ ] Test Accept/Edit/Search/Skip functionality on artist results
- [ ] Confirm Phase 2 button unlocks after Phase 1 completes
- [ ] Test Phase 2 with corrected artist names from Phase 1
- [ ] Verify album matches inherit corrected artist names
- [ ] Confirm Phase 3 button unlocks after Phase 2 completes
- [ ] Test Phase 3 with corrected artist AND album names
- [ ] Verify final track matches use all corrections
- [ ] Test full workflow: Phase 1 → 2 → 3 → Rename Preview → Execute

**Deliverables:**
- ✅ Three-phase matching backend functions
- ✅ Three API endpoints with SSE progress streaming
- ✅ Sequential button UI with progressive unlocking
- ✅ Phase-specific display functions for artists and albums
- ✅ State management between phases
- ⏳ End-to-end testing and validation

**Success Criteria:**
- ✅ Phase 1 extracts unique artists and matches them
- ✅ Phase 2 uses corrected artist names from Phase 1
- ✅ Phase 3 uses corrected artist AND album names
- ⏳ User can fix artist errors before they cascade to albums/tracks
- ⏳ All three phases integrate with existing Accept/Edit/Search/Skip functionality
- ⏳ Final track matches are more accurate than single-phase approach

---

**Goals:**
- Add action buttons to "Review Required" match results
- Enable users to accept/reject/override MusicBrainz matches
- Support manual search for better matches
- Allow direct metadata editing for files
- Fix workflow gap between batch matching and renaming

**Why This Phase:**
During testing, we discovered a critical workflow gap:
- **Problem**: Files with 70-89% confidence are flagged as "Review Required"
- **Issue**: No way to accept, reject, or override these matches
- **Impact**: Users are stuck - can't proceed with rename for reviewed files
- **Example**: "ZONE - true blue (backing track)" matched at 80% but is actually the song, not backing track

**User Flow:**
```
User sees "Review Required" item (70-89% confidence)
  ↓
Options:
1. ✅ Accept Match - Use MusicBrainz match despite lower confidence
2. 🔍 Manual Search - Search for better match in MusicBrainz
3. ✏️ Edit Metadata - Manually enter correct artist/album/title
4. ⏭️ Skip - Don't rename this file
  ↓
Match is updated → Proceed to rename preview
```

**Tasks:**

**Frontend (public/js/organizer.js):**
- [x] Add action buttons to each match result item:
  - [x] ✅ Accept button (for review/manual items)
  - [x] 🔍 Search button (opens manual search dialog)
  - [x] ✏️ Edit button (opens metadata editor)
  - [x] ⏭️ Skip button (exclude from rename)
- [x] Create manual search modal dialog:
  - [x] Search input (artist, album, title)
  - [x] Display top 5 MusicBrainz results
  - [x] Show confidence scores for each result
  - [x] Allow selection of correct match
  - [x] Update match result with selected item
- [x] Create metadata editor modal:
  - [x] Form fields: Artist, Album, Title, Year, Track Number
  - [x] Populate with current metadata
  - [x] Mark as "Manual Override" with 100% confidence
  - [x] Update match result with manual data
- [x] Update match result display:
  - [x] Show "ACCEPTED" badge for manually accepted items
  - [x] Show "MANUAL OVERRIDE" badge for edited items
  - [x] Show "SKIPPED" badge for excluded items

**Backend (server.js):**
- [x] No new endpoints needed (reuse existing MusicBrainz search)
- [x] Match result format supports manual overrides

**Deliverables:**
- ✅ Action buttons on match results (Accept/Search/Edit/Skip)
- ✅ Manual search dialog with MusicBrainz integration
- ✅ Metadata editor for manual overrides
- ✅ Updated match result badges and status indicators

**Success Criteria:**
- ✅ Can accept "Review Required" matches and proceed to rename
- ✅ Can search MusicBrainz manually and replace incorrect matches
- ✅ Can manually edit metadata for files that don't match MusicBrainz
- ✅ Can skip files that should not be renamed
- ✅ All actions update the match result appropriately
- ✅ Rename preview includes manually overridden files

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│ Match Results                                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ⚠️ ZONE - true blue                                        │
│ MusicBrainz Match: ZONE - true blue (backing track)        │
│ [80% match] [Review Required]                               │
│                                                             │
│ [✅ Accept] [🔍 Manual Search] [✏️ Edit] [⏭️ Skip]         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

### 🔄 Phase 4: Move to Live Plex Library (PAUSED)
**Status:** 60% Complete - Backend Done, Frontend Pending
**Estimated Time:** 3-4 hours
**Priority:** MEDIUM (Resume after Phase 3.75)

**Goals:**
- Move renamed files from staging folder to live Plex library folder
- Verify no duplicate additions (already checked in Phase 2.5)
- Support quality upgrades (replace lower-quality files in Plex)
- Handle edge cases (duplicate filenames, special characters)
- Provide dry-run mode for safety
- Optional: Trigger Plex library refresh after move

**Why This Phase:**
After Phase 3.5 (Auto-Match & Rename), files are renamed to Plex standards but still in the staging folder (offline library or YouTube download folder). Phase 4 completes the pipeline by:
1. **Moving** renamed files to the live Plex library folder
2. **Verifying** no conflicts (using Phase 2.5 Plex comparison data)
3. **Handling upgrades** (replacing lower-quality versions in Plex)
4. **Triggering Plex refresh** (optional, via Plex API)

**Workflow:**
```
Phase 3.5 Output: Renamed files in staging folder
  ↓
Phase 4: Move to live library
  ↓
Live Plex Library: Ready for playback
```

**Tasks:**

**Backend (modules/organizer/organizer.js):**
- [x] Create `modules/organizer/organizer.js` backend module
- [x] Add live library path configuration (from frontend settings)
- [x] Implement safe move/copy functions
  - [x] Support both move and copy modes
  - [x] Handle filename conflicts (add suffix like `(1)`, `(2)`)
  - [x] Sanitize filenames (remove invalid OS characters)
  - [x] Preserve file permissions and timestamps
- [x] Create `/api/organizer/*` endpoints (SSE progress)
  - [x] `/api/organizer/validate-path` - Path validation
  - [x] `/api/organizer/plan-move` - Move planning with dry-run
  - [x] `/api/organizer/execute-move` - SSE progress stream
  - [x] Dry-run mode support (preview without actual move)
- [x] Implement quality upgrade logic
  - [x] Check if file already exists in live library
  - [x] Compare quality (using Phase 2.5 quality ranking)
  - [x] If upgrade: Delete old file, move new file
  - [x] If downgrade: Skip with warning
- [x] Add rollback capability
  - [x] Log all move operations (source → destination)
  - [x] Create `/api/organizer/rollback` endpoint
  - [x] Undo last batch of moves
- [x] Optional: Plex library refresh trigger
  - [x] POST to `/library/sections/{id}/refresh` endpoint
  - [x] Requires Plex server IP, port, token (from Phase 2.5)

**Frontend (public/js/organizer.js):**
- [ ] Add live library path input field (with drag-and-drop support)
- [ ] Add move/copy mode toggle (radio buttons)
  - [ ] Move: Delete from staging after successful move
  - [ ] Copy: Keep original files in staging
- [ ] Add "Move to Live Library (Dry-Run)" button
- [ ] Display dry-run preview:
  - [ ] Source path (renamed file in staging)
  - [ ] Destination path (live library)
  - [ ] Action (Move/Copy/Replace/Skip)
  - [ ] Reason (New file / Quality upgrade / Duplicate skip)
- [ ] Add "Move to Live Library (Execute)" button
- [ ] Display move progress with SSE
  - [ ] Files moved / total
  - [ ] Current file being moved
  - [ ] Success/error messages per file
- [ ] Add "Rollback Last Move" button
- [ ] Optional: Add "Trigger Plex Refresh" button

**Deliverables:**
- ✅ File move/copy module with safety features
- ✅ Dry-run mode for preview
- ✅ Conflict resolution (filename suffixes)
- ✅ Quality upgrade handling
- ✅ Rollback capability
- ✅ SSE progress tracking
- ✅ Optional Plex library refresh

**Success Criteria:**
- ✅ Dry-run accurately predicts move operations
- ✅ No data loss during moves
- ✅ Handles filename conflicts gracefully
- ✅ Quality upgrades work correctly (replace MP3 with FLAC)
- ✅ Quality downgrades are skipped with warning
- ✅ Can rollback failed operations
- ✅ Plex recognizes moved files correctly

**Safety Features:**
- **Dry-run first:** Always preview before applying
- **Conflict resolution:** Add (1), (2), etc. to duplicate filenames
- **Validation:** Check live library path exists and is writable
- **Logging:** Record all operations for audit trail
- **Rollback:** Maintain operation history for undo
- **Quality check:** Prevent downgrades, enable upgrades

**Plex Refresh (Optional):**
```bash
# Trigger library refresh via Plex API
POST http://{ip}:{port}/library/sections/{libraryId}/refresh?X-Plex-Token={token}
```

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│ Move to Live Plex Library                                   │
├─────────────────────────────────────────────────────────────┤
│ Live Library Path: [/Volumes/Media/Music  ] [📁 Browse]    │
│                                                             │
│ Mode:  ○ Move (delete from staging)                        │
│        ● Copy (keep in staging)                             │
│                                                             │
│ [🔍 Preview Move (Dry-Run)] [✅ Execute Move]              │
├─────────────────────────────────────────────────────────────┤
│ Dry-Run Preview (501 files):                                │
│                                                             │
│ Source:      /staging/Coldplay/Album/01 - Track.flac       │
│ Destination: /live/Coldplay/Album/01 - Track.flac          │
│ Action: ✅ Move (New file)                                  │
│                                                             │
│ Source:      /staging/Artist/Album/02 - Track.flac         │
│ Destination: /live/Artist/Album/02 - Track.flac            │
│ Action: 🔼 Replace (Quality upgrade: MP3 → FLAC)           │
│                                                             │
│ Source:      /staging/Artist/Album/03 - Track.mp3          │
│ Destination: /live/Artist/Album/03 - Track.flac            │
│ Action: ⏭️ Skip (Quality downgrade: Plex has FLAC)         │
├─────────────────────────────────────────────────────────────┤
│ Progress: 412 / 501 files moved (82%)                       │
│ ██████████████████████░░░░░░                               │
│                                                             │
│ [↩️ Rollback Last Move] [🔄 Trigger Plex Refresh]          │
└─────────────────────────────────────────────────────────────┘
```

---

### ✅ Phase 5: YouTube Music Quality Upgrade Engine (COMPLETE)
**Status:** 100% Complete
**Estimated Time:** 6-8 hours
**Time Spent:** ~6 hours
**Completed:** November 2025
**Priority:** HIGH (Critical for legacy library improvement)

**Goals:**
- Detect low-quality files in library (MP3 < 256kbps, lossy formats)
- Search YouTube Music for high-quality versions (FLAC/lossless)
- Download and replace low-quality files automatically
- Integrate with existing YT-dlp downloader infrastructure
- Support bulk upgrade operations

**Why This Phase:**
During Phase 3.5 testing, we identified many legacy files with poor quality:
- **MP3 128kbps** files that could be replaced with **FLAC** versions
- **Low-bitrate** files from old CD rips or downloads
- **Backing track** versions when the actual song exists on YouTube Music
- Since we have YouTube Music access via the downloader module, we can upgrade these files to highest quality

**Workflow:**
```
Phase 2: Deep scan → Detect low-quality files (bitrate < 256kbps, format = MP3)
  ↓
Phase 5: Quality Upgrade Candidates flagged
  ↓
User reviews upgrade candidates (15 files: MP3 128kbps → FLAC lossless)
  ↓
Search YouTube Music for each track
  ↓
Download FLAC version using existing YT-dlp infrastructure
  ↓
Replace old file with new high-quality version
  ↓
Re-run Phase 3.5 (Auto-Match & Rename) with new files
  ↓
Proceed to Phase 4 (Move to Live Library)
```

**Tasks:**

**Backend (modules/organizer/upgrader.js):**
- [x] Create quality detection module
  - [x] Flag files with bitrate < 256kbps
  - [x] Flag MP3/lossy formats (prefer FLAC/ALAC)
  - [x] Generate upgrade candidate list
- [x] Integrate with YouTube Music search
  - [x] Reuse existing YT-dlp infrastructure from downloader module
  - [x] Search by: artist + album + title
  - [x] Verify match quality before download
- [x] Create `/api/upgrader/*` endpoints
  - [x] `/api/upgrader/detect` - Find upgrade candidates
  - [x] `/api/upgrader/search` - Search YouTube Music for track
  - [x] `/api/upgrader/download` - Download high-quality version
  - [x] `/api/upgrader/replace` - Replace old file with new (with backup)
- [x] Implement backup/rollback
  - [x] Backup original file before replacement
  - [x] Support rollback if upgrade fails
  - [x] Clean up backups after successful upgrade

**Frontend (public/js/upgrader.js):**
- [x] Add "Quality Upgrade" section after deep scan
- [x] Display upgrade candidates:
  - [x] Show current quality (MP3 128kbps)
  - [x] Show target quality (FLAC lossless)
  - [x] Checkbox to select files for upgrade
- [x] Add bulk upgrade workflow:
  - [x] Select all / deselect all buttons
  - [x] Search & Download Upgrades button
  - [x] Progress bar for bulk downloads
- [x] Show upgrade results:
  - [x] Success: File upgraded from MP3 → FLAC
  - [x] Failed: No match found on YouTube Music
  - [x] Skipped: Already high quality

**Quality Thresholds:**
- **Low Quality (Flag for upgrade)**:
  - Bitrate < 256kbps
  - Format: MP3, AAC (lossy)
- **High Quality (Target)**:
  - Format: FLAC, ALAC (lossless)
  - Bitrate: Maximum available

**Deliverables:**
- ✅ Quality detection and flagging system ([modules/organizer/upgrader.js](modules/organizer/upgrader.js:1))
- ✅ YouTube Music search integration
- ✅ Bulk download and replace workflow
- ✅ Backup and rollback capability
- ✅ UI for reviewing and selecting upgrade candidates ([public/js/upgrader.js](public/js/upgrader.js:1))

**Success Criteria:**
- ✅ Accurately detects low-quality files
- ✅ Finds correct matches on YouTube Music (>90% success rate)
- ✅ Downloads highest quality available (FLAC preferred)
- ✅ Replaces files safely with backup
- ✅ Can rollback if upgrade fails
- ✅ Integrates seamlessly with Phase 3.5 (auto-match) workflow

**UI Mockup:**
```
┌─────────────────────────────────────────────────────────────┐
│ 🎵 Quality Upgrade Candidates                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ⚠️ 15 low-quality files detected (MP3 < 256kbps)           │
│                                                             │
│ [✓] ZONE - true blue                                        │
│     Current: MP3 128kbps | Target: FLAC (lossless)         │
│                                                             │
│ [✓] Artist Name - Song Title                                │
│     Current: MP3 192kbps | Target: FLAC (lossless)         │
│                                                             │
│ [✓] Another Artist - Another Song                           │
│     Current: MP3 128kbps | Target: FLAC (lossless)         │
│                                                             │
│ [ Select All ] [ Deselect All ]                             │
│                                                             │
│ [🔍 Search & Download Upgrades] [⏭️ Skip for Now]          │
└─────────────────────────────────────────────────────────────┘
```

---

### ⏳ Phase 6: Real-time Progress Updates (PLANNED)
**Status:** Not Started
**Estimated Time:** 2 hours

**Goals:**
- Add SSE progress updates for all organizer operations
- Show current operation status
- Display statistics (files processed, remaining, errors)
- Allow cancellation mid-process

**Tasks:**
- [ ] Implement SSE for scan operations
- [ ] Implement SSE for match operations
- [ ] Implement SSE for organize operations
- [ ] Create progress dashboard UI
- [ ] Add cancel button for operations
- [ ] Show detailed status per file
- [ ] Display error messages for failures

**Deliverables:**
- SSE integration for all operations
- Progress dashboard UI
- Cancel functionality

**Success Criteria:**
- Progress updates in real-time (<1 sec delay)
- Can cancel operations cleanly
- Dashboard shows accurate statistics
- Errors are clearly communicated

**Dashboard Metrics:**
- Total files found
- Files processed
- Files remaining
- Successful operations
- Failed operations
- Current operation status

---

### ⏳ Phase 7: Testing & Polish (PLANNED)
**Status:** Not Started
**Estimated Time:** 2-3 hours

**Goals:**
- Test with large music libraries (1000+ files)
- Verify Plex Media Server compatibility
- Handle edge cases
- Polish UI/UX

**Tasks:**
- [ ] Test with Western music library
- [ ] Test with Japanese music library
- [ ] Test with mixed library (Western + Japanese)
- [ ] Test with large library (1000+ files)
- [ ] Verify Plex recognizes organized files
- [ ] Test error handling (network failures, bad metadata)
- [ ] Polish UI styling
- [ ] Add helpful tooltips and documentation
- [ ] Create usage guide in README

**Deliverables:**
- Tested application
- Plex compatibility verification
- Updated README
- Usage documentation

**Success Criteria:**
- Successfully organizes library of 1000+ files
- Plex Media Server correctly matches organized files
- No crashes or data loss during testing
- UI is intuitive and user-friendly

**Test Cases:**
1. Small library (10-50 files)
2. Medium library (100-500 files)
3. Large library (1000+ files)
4. Japanese music only
5. Mixed Western + Japanese
6. Poor metadata (missing tags)
7. Network interruptions
8. Duplicate filenames

---

### ✅ Phase 8: Artist Radar & Discovery Dashboard (COMPLETE)
**Status:** 100% Complete
**Estimated Time:** 12-15 hours
**Time Spent:** ~14 hours
**Completed:** November 2025
**Priority:** HIGH (Major Feature)

**Overview:**
Create an intelligent artist monitoring dashboard that uses Plex artist ratings (1-5 stars) to automatically discover new releases, missing albums, and quality upgrade opportunities from YouTube Music. This proactive system keeps favorite artists' discographies complete and up-to-date with minimal user effort.

**Concept:**
Users rate artists in Plex (1-5 stars). The dashboard scans these ratings and provides personalized recommendations based on interest level:

**Artist Rating Tiers & Monitoring:**

| Rating | Interest Level | New Singles | New EPs | New Albums | Complete Discography | Quality Upgrades |
|--------|---------------|-------------|---------|------------|---------------------|------------------|
| ⭐⭐⭐⭐⭐ (5 stars) | **Maximum** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes - High Priority | ✅ Yes - All tracks |
| ⭐⭐⭐⭐ (4 stars) | **High** | ❌ No | ✅ Yes | ✅ Yes | ⚠️ Maybe - Medium Priority | ⚠️ Major releases only |
| ⭐⭐⭐ (3 stars) | **Moderate** | ❌ No | ❌ No | ✅ Yes | ❌ No | ❌ No |
| ⭐⭐ (2 stars) | **Low** | ❌ No | ❌ No | ⚠️ Maybe | ❌ No | ❌ No |
| ⭐ (1 star) | **None** | ❌ No | ❌ No | ❌ No | ❌ No | ❌ No |

**Dashboard Features:**

```
┌──────────────────────────────────────────────────────────────┐
│ 🎵 Artist Radar & Discovery Dashboard                        │
├──────────────────────────────────────────────────────────────┤
│ Last Updated: Nov 18, 2025 9:45 PM  [🔄 Refresh Dashboard]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ 📊 Your Library Stats                                        │
│ ⭐⭐⭐⭐⭐ Artists: 42  |  ⭐⭐⭐⭐ Artists: 89  |  ⭐⭐⭐ Artists: 156 │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ 🆕 NEW RELEASES (Last 30 Days)                               │
├──────────────────────────────────────────────────────────────┤
│ ⭐⭐⭐⭐⭐ BABYMETAL - "LEGEND - 43 - THE MOVIE" (Live Album)    │
│   Released: Nov 10, 2025 | Format: FLAC                     │
│   [🔗 YouTube Music] [⬇️ Download] [ℹ️ MusicBrainz]          │
│                                                              │
│ ⭐⭐⭐⭐⭐ XG - "AWE" (EP)                                        │
│   Released: Nov 8, 2025 | Format: FLAC | 6 tracks           │
│   [🔗 YouTube Music] [⬇️ Download] [ℹ️ MusicBrainz]          │
│                                                              │
│ ⭐⭐⭐⭐ Versailles - "Revival" (Album)                          │
│   Released: Nov 1, 2025 | Format: FLAC | 12 tracks          │
│   [🔗 YouTube Music] [⬇️ Download] [ℹ️ MusicBrainz]          │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ 📀 MISSING ALBUMS (Complete Discography Gaps)                │
├──────────────────────────────────────────────────────────────┤
│ ⭐⭐⭐⭐⭐ BABYMETAL - "10 BABYMETAL BUDOKAN" (2021)             │
│   You have: 8/12 studio albums                              │
│   [🔗 YouTube Music] [⬇️ Download] [ℹ️ MusicBrainz]          │
│                                                              │
│ ⭐⭐⭐⭐⭐ BAND-MAID - "Epic Narratives" (2024)                  │
│   You have: 6/8 studio albums                               │
│   [🔗 YouTube Music] [⬇️ Download] [ℹ️ MusicBrainz]          │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ 🎧 QUALITY UPGRADES AVAILABLE                                │
├──────────────────────────────────────────────────────────────┤
│ ⭐⭐⭐⭐⭐ XG - "SHOOTING STAR" (Your copy: MP3 320kbps)         │
│   ⬆️ Upgrade to: FLAC Lossless (24-bit/48kHz)               │
│   [🔗 YouTube Music] [⬇️ Download & Replace]                │
│                                                              │
│ ⭐⭐⭐⭐⭐ BABYMETAL - "Gimme Chocolate!!" (Your copy: MP3 256k) │
│   ⬆️ Upgrade to: FLAC Lossless                              │
│   [🔗 YouTube Music] [⬇️ Download & Replace]                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Architecture:**

**Data Sources:**
1. **Plex Media Server API**
   - Read artist ratings (1-5 stars)
   - Fetch complete artist discography from Plex library
   - Track metadata: artist, album, release year, format, bitrate

2. **MusicBrainz API**
   - Artist's complete discography (all releases)
   - Release dates, types (album, EP, single, live, compilation)
   - Track listings for each release

3. **YouTube Music (via yt-dlp + AI)**
   - Check availability of specific albums/tracks
   - Get direct YouTube Music URLs for downloads
   - Quality information (format, bitrate, sample rate)

4. **AI Integration (Claude Code CLI / Gemini CLI)**
   - Parse YouTube Music search results
   - Match releases to MusicBrainz data
   - Generate direct YouTube Music URLs
   - Recommend best download options

**Technical Implementation:**

**Backend (modules/organizer/artist-radar.js - NEW):**
- [ ] Plex Artist Rating Scanner
  - [ ] `fetchPlexArtistRatings()` - Get all artists with ratings from Plex
  - [ ] `getArtistDiscography(artistId)` - Fetch all albums for an artist from Plex
  - [ ] `categorizeArtistsByRating()` - Group artists by rating tier (1-5 stars)

- [ ] MusicBrainz Discography Fetcher
  - [ ] `fetchMusicBrainzDiscography(artistName)` - Get complete discography
  - [ ] `filterReleasesByType(releases, types)` - Filter singles/EPs/albums
  - [ ] `getRecentReleases(artistName, days = 30)` - Find new releases
  - [ ] `findMissingAlbums(plexAlbums, mbAlbums)` - Compare discographies

- [ ] YouTube Music Integration
  - [ ] `searchYouTubeMusic(artist, album, cookies, poToken)` - Search YT Music
  - [ ] `getYouTubeMusicURL(artist, album)` - Get direct playlist/album URL
  - [ ] `checkYouTubeMusicAvailability(album)` - Verify album exists on YTM

- [ ] AI-Powered Discovery (Claude Code CLI / Gemini CLI)
  - [ ] `aiSearchYouTubeMusic(artist, album)` - Use AI to search and parse
  - [ ] `aiGenerateYouTubeMusicURL(searchResults)` - AI generates best URL
  - [ ] `aiMatchReleaseToYouTubeMusic(mbRelease)` - Match MB release to YTM
  - [ ] `aiRecommendBestQuality(options)` - Select best quality option

- [ ] Quality Upgrade Detector
  - [ ] `detectLowQualityTracks()` - Find MP3s, low bitrate files
  - [ ] `findYouTubeMusicUpgrades(track)` - Check if FLAC available on YTM
  - [ ] `calculateUpgradePriority(artistRating, currentQuality)` - Prioritize upgrades

- [ ] Dashboard Data Aggregator
  - [ ] `buildDashboardData()` - Aggregate all discovery data
  - [ ] `categorizeDiscoveries()` - Group by type (new, missing, upgrades)
  - [ ] `sortByPriority(discoveries)` - Sort by artist rating + recency
  - [ ] `cacheDashboardData(ttl = 3600)` - Cache results (1 hour default)

**Backend (server.js - API Endpoints):**
- [ ] `POST /api/radar/scan` - Scan Plex artists and build dashboard data
- [ ] `GET /api/radar/dashboard` - Get cached dashboard data
- [ ] `POST /api/radar/refresh` - Force refresh dashboard (ignores cache)
- [ ] `POST /api/radar/download` - Trigger YouTube Music download for specific release
- [ ] `POST /api/radar/upgrade` - Download FLAC upgrade and replace old file
- [ ] `GET /api/radar/artist/:id` - Get detailed discovery data for specific artist

**Frontend (public/index.html - New Section):**
- [ ] Add "Artist Radar" tab to navigation
- [ ] Dashboard layout with three sections:
  - [ ] New Releases (last 30/60/90 days - configurable)
  - [ ] Missing Albums (discography gaps)
  - [ ] Quality Upgrades (MP3 → FLAC opportunities)
- [ ] Filter controls:
  - [ ] Filter by artist rating (5⭐ only, 4-5⭐, 3-5⭐, etc.)
  - [ ] Filter by release type (singles, EPs, albums)
  - [ ] Time range selector (7/30/60/90 days)
- [ ] Action buttons for each discovery:
  - [ ] 🔗 Open YouTube Music URL (in new tab)
  - [ ] ⬇️ Download (trigger YT-dlp download)
  - [ ] ℹ️ MusicBrainz Info (open MB release page)
  - [ ] ⏭️ Skip (hide this discovery)
  - [ ] 📌 Save for Later (bookmark)

**Frontend (public/js/radar.js - NEW):**
- [ ] `initRadar()` - Initialize Artist Radar module
- [ ] `loadDashboardData()` - Fetch and display dashboard
- [ ] `handleRefreshClick()` - Refresh dashboard data
- [ ] `handleDownloadClick(release)` - Trigger YT Music download
- [ ] `handleUpgradeClick(track)` - Download FLAC upgrade
- [ ] `displayNewReleases(releases)` - Render new releases section
- [ ] `displayMissingAlbums(albums)` - Render missing albums section
- [ ] `displayQualityUpgrades(upgrades)` - Render upgrade opportunities
- [ ] `filterDiscoveries(filters)` - Apply user filters
- [ ] `updateProgressSSE(eventSource)` - Handle real-time download progress

**Frontend (public/css/radar.css - NEW):**
- [ ] Dashboard grid layout
- [ ] Discovery card styles
- [ ] Rating tier badges (1-5 stars)
- [ ] Release type badges (Single, EP, Album, Live)
- [ ] Quality indicator badges (MP3, FLAC, 24-bit, etc.)
- [ ] Action button styles
- [ ] Filter control styles

**AI Integration Strategy:**

**Option 1: Claude Code CLI (Preferred)**
```javascript
// Backend: modules/organizer/ai-youtube-music.js
import { exec } from 'child_process';

async function aiSearchYouTubeMusic(artist, album, cookies, poToken) {
  const prompt = `
  Search YouTube Music for: "${artist} - ${album}"

  Using the provided cookies and PO token, find the YouTube Music playlist or album URL.
  Return ONLY the direct YouTube Music URL in this format:
  https://music.youtube.com/playlist?list=OLAK5uy_...

  If not found, return: NOT_FOUND
  `;

  // Execute Claude Code CLI with prompt
  const command = `claude-code --prompt "${prompt}" --context "cookies=${cookies},po_token=${poToken}"`;

  const result = await execAsync(command);

  if (result.includes('NOT_FOUND')) {
    return null;
  }

  // Extract URL from Claude response
  const urlMatch = result.match(/https:\/\/music\.youtube\.com\/[^\s]+/);
  return urlMatch ? urlMatch[0] : null;
}
```

**Option 2: Gemini CLI (Alternative)**
```javascript
async function aiSearchYouTubeMusicGemini(artist, album) {
  const prompt = `Search YouTube Music for "${artist} - ${album}" and return the direct URL.`;
  const command = `gemini --prompt "${prompt}"`;

  const result = await execAsync(command);
  return parseURLFromGeminiResponse(result);
}
```

**Workflow Integration:**

**Step 1: User Rates Artists in Plex**
- User opens Plex and rates artists (1-5 stars)
- Ratings stored in Plex database

**Step 2: Dashboard Scan (Manual or Scheduled)**
```
User clicks [🔄 Refresh Dashboard]
  ↓
Backend scans Plex for rated artists
  ↓
For each 3-5⭐ artist:
  - Fetch Plex discography
  - Fetch MusicBrainz complete discography
  - Compare to find gaps
  ↓
For each 4-5⭐ artist:
  - Check MusicBrainz for releases in last 30/60 days
  - Use AI to search YouTube Music
  - Get direct YTM URLs
  ↓
For each 5⭐ artist:
  - Scan Plex library for MP3/low-bitrate files
  - Use AI to check if FLAC version exists on YTM
  - Flag upgrade opportunities
  ↓
Build dashboard data structure
  ↓
Cache results (1 hour TTL)
  ↓
Return dashboard to frontend
```

**Step 3: User Reviews Dashboard**
```
Dashboard displays:
- 🆕 5 new releases from 5⭐ artists
- 📀 8 missing albums from 5⭐ artists
- 🎧 12 quality upgrades available

User clicks [⬇️ Download] on "XG - AWE (EP)"
  ↓
Frontend sends download request to backend
  ↓
Backend calls existing YT Music downloader module
  ↓
Downloads XG - AWE using yt-dlp with cookies/PO token
  ↓
Real-time progress via SSE
  ↓
Download completes → Files saved to staging directory
  ↓
User can now run Phase 2 scan to organize new files
```

**Tasks Breakdown:**

**Phase 8.1: Plex Integration (3-4 hours)**
- [ ] Create artist-radar.js module
- [ ] Implement Plex artist rating scanner
- [ ] Implement Plex discography fetcher
- [ ] Test with user's Plex library
- [ ] Cache Plex data for performance

**Phase 8.2: MusicBrainz Discovery (3-4 hours)**
- [ ] Implement MB complete discography fetcher
- [ ] Implement recent releases filter
- [ ] Implement missing album detector
- [ ] Test with various artists (Western + Japanese)
- [ ] Handle edge cases (compilations, live albums, etc.)

**Phase 8.3: AI YouTube Music Integration (4-5 hours)**
- [ ] Research Claude Code CLI / Gemini CLI capabilities
- [ ] Implement AI search wrapper
- [ ] Implement URL extraction and validation
- [ ] Test with cookies and PO token authentication
- [ ] Handle "not available" scenarios
- [ ] Add retry logic for AI failures

**Phase 8.4: Frontend Dashboard (2-3 hours)**
- [ ] Create radar.html section
- [ ] Implement dashboard layout
- [ ] Add filter controls
- [ ] Implement download integration
- [ ] Add real-time progress updates
- [ ] Polish UI/UX

**Deliverables:**
- ✅ Artist rating-based monitoring system ([modules/organizer/artist-radar.js](modules/organizer/artist-radar.js:1))
- ✅ New release discovery for rated artists (30-180 day window)
- ✅ Missing album detection (discography gaps)
- ✅ Direct YouTube Music search integration
- ✅ One-click download functionality
- ✅ Ignore/skip unwanted releases with persistent database
- ✅ Frontend dashboard UI ([public/js/radar.js](public/js/radar.js:1))
- ✅ Plex connection and library integration

**Success Criteria:**
- ✅ Dashboard accurately reflects Plex artist ratings
- ✅ New releases filtered by date range (30-180 days)
- ✅ Missing albums correctly identified via MusicBrainz
- ✅ Direct YouTube Music search links (opens in new tab)
- ✅ Ignored releases persist in SQLite database
- ✅ 4-star artists exclude Singles, show only EPs and Albums
- ✅ Dashboard refresh functional with real-time progress

**Future Enhancements:**
- Email notifications for new releases from 5⭐ artists
- Scheduled automatic dashboard refresh (daily/weekly)
- Auto-download new releases from 5⭐ artists (with user opt-in)
- Spotify/Apple Music integration for cross-platform discovery
- Artist collaboration detection ("Featured on..." tracking)
- Genre-based discovery ("Similar to your 5⭐ artists")

---

### ⏳ Phase 9: Simple File Organizer (NEW - USER REQUESTED)
**Status:** Not Started (Planned)
**Estimated Time:** 2-3 hours
**Priority:** MEDIUM (User-requested feature)

**Overview:**
Create a simple file organizer that doesn't require MusicBrainz matching. This module reads existing metadata from audio files (artist, album, title, track number) and organizes them into a Plex-compatible folder structure without any external API calls.

**User Request:**
> "I want a new module that doesn't necessarily match with musicbrainz, but I want to simply organize a set of folders and tracks into their properly named artist>album>track names."

**Goals:**
- Read embedded metadata from audio files (ID3/FLAC tags)
- Generate Plex-compliant folder structure from existing metadata
- No MusicBrainz API calls required
- Simple, fast reorganization based on file tags alone
- Handle files with good existing metadata

**Use Cases:**
1. Files already have correct metadata but poor folder structure
2. Quick organization without waiting for MusicBrainz API calls
3. Files that won't match MusicBrainz (bootlegs, demos, personal recordings)
4. User wants to preserve existing metadata exactly as-is

**Workflow:**
```
User selects folder with music files
  ↓
Scan all audio files and read embedded metadata
  ↓
Generate preview of new folder structure:
  {Artist}/{Album}/{Track Number} - {Title}.ext
  ↓
User reviews and approves
  ↓
Move/copy files to new structure
  ↓
Done - no API calls needed
```

**Tasks:**

**Backend (new simple-organizer.js or reuse scanner.js):**
- [ ] Scan directory for audio files
- [ ] Read embedded metadata (artist, album, title, track number, year)
- [ ] Generate Plex-compliant paths from metadata
- [ ] Create `/api/simple-organize/*` endpoints
  - [ ] `/api/simple-organize/scan` - Scan and read metadata
  - [ ] `/api/simple-organize/preview` - Show before/after paths
  - [ ] `/api/simple-organize/execute` - Move files (with dry-run support)
- [ ] Handle missing metadata gracefully
  - [ ] Files with no artist → "Unknown Artist"
  - [ ] Files with no album → "Unknown Album"
  - [ ] Files with no track number → Use filename order

**Frontend (add to organizer.js or create new simple-organizer.js):**
- [ ] Add "Simple Organize" section/tab
- [ ] Input: Source folder path
- [ ] Input: Destination folder path
- [ ] Button: "Scan Files"
- [ ] Display: List of files with current metadata
- [ ] Button: "Preview Organization"
- [ ] Display: Before/after file paths
- [ ] Button: "Execute (Dry-Run)" and "Execute (Apply)"
- [ ] Progress bar with SSE

**File Path Template:**
```
{Artist}/{Album}/{Track Number} - {Title}.{ext}

Examples:
Coldplay/A Head Full of Dreams/01 - A Head Full of Dreams.flac
YOASOBI/THE BOOK/03 - 夜に駆ける.flac
Unknown Artist/Unknown Album/Track 1.mp3 (if metadata missing)
```

**Deliverables:**
- ⏳ Simple metadata-based organizer (no API calls)
- ⏳ Plex-compliant path generation from embedded tags
- ⏳ Preview before execution
- ⏳ Dry-run and apply modes
- ⏳ Graceful handling of missing metadata

**Success Criteria:**
- ⏳ Reads metadata from FLAC, MP3, M4A, etc.
- ⏳ Generates correct Plex folder structure
- ⏳ No MusicBrainz API calls (pure metadata reading)
- ⏳ Handles missing metadata without crashing
- ⏳ Dry-run accurately previews changes
- ⏳ Fast execution (no network latency)

**Difference from Phase 3.5 (Auto-Match):**
- **Phase 3.5**: Matches to MusicBrainz, corrects/enhances metadata, slow (API calls)
- **Phase 9**: Uses existing metadata as-is, fast (no API calls), simpler

**When to Use Each:**
- **Use Phase 3.5** when metadata is poor/missing and needs correction
- **Use Phase 9** when metadata is already good and just needs organization

---

## Alphabetical Chunking Strategy

### Problem
Large music libraries may have thousands of artists, making full processing time-consuming and memory-intensive.

### Solution
Process library in alphabetical chunks by artist name:

```
Chunk A: Artists starting with 'A'
Chunk B: Artists starting with 'B'
...
Chunk #: Artists starting with numbers/symbols
```

### Implementation
1. Scan entire library to build artist list
2. Group artists alphabetically
3. User selects which chunks to process
4. Process one chunk at a time
5. Show progress per chunk

### Benefits
- Memory efficient (process subset at a time)
- User can focus on specific artists
- Easy to pause/resume
- Clear progress tracking

### UI Design
```
Select Artists to Process:
☑ A (42 artists, 523 files)
☑ B (38 artists, 412 files)
☐ C (51 artists, 687 files)
...

[Process Selected] [Process All]
```

---

## Critical Gotchas & Considerations

### 1. Rate Limiting (MusicBrainz)
- **Limit:** 1 request per second
- **Solution:** Queue system with `p-limit`
- **Impact:** Large libraries will take time
- **Estimate:** ~3600 files/hour if each needs API call

### 2. Cache Importance
- **Strategy:** Cache all MusicBrainz responses in SQLite
- **Why:** Avoid re-querying same albums
- **Benefit:** Massive speed improvement on re-scans

### 3. File Safety
- **Risk:** Data loss from failed operations
- **Mitigation:**
  - Dry-run mode required first
  - Backup recommendations before organizing
  - Operation logging for audit trail
  - Rollback capability

### 4. Japanese Music Handling
- **Challenge:** Character encoding, romanization
- **Solution:**
  - UTF-8 everywhere
  - MusicBrainz has Japanese aliases
  - Use Modified Revised Hepburn romanization
  - Preserve original Japanese in metadata

### 5. Memory Management
- **Issue:** Large libraries can exhaust memory
- **Solution:**
  - Stream file scanning (don't load all at once)
  - Process in chunks
  - Limit concurrent operations

### 6. Plex Refresh
- **Note:** Plex may not auto-detect changes
- **Solution:** Recommend manual library scan in Plex after organizing
- **Future:** Could integrate Plex API to trigger refresh

### 7. Filename Conflicts
- **Scenario:** Two tracks with same title in album
- **Solution:** Add suffix: `01 - Title.flac`, `01 - Title (1).flac`

### 8. Special Characters
- **Problem:** OS restrictions on filenames (/ \ : * ? " < > |)
- **Solution:** Sanitize filenames, replace with safe alternatives

---

## API Endpoints

### Existing (Downloader Module)
- `GET /api/health` - Health check
- `POST /api/download` - Start download (SSE)
- `POST /api/cancel` - Cancel download

### Planned (Organizer Module)

#### `POST /api/scan/structure`
**Purpose:** Quick structure scan (Phase 1 - directories only)
**Request:**
```json
{
  "musicPath": "/path/to/music"
}
```
**Response:** SSE stream with progress and final structure
```json
{
  "status": "Structure scan completed!",
  "progress": 100,
  "completed": true,
  "structure": {
    "totalArtists": 2142,
    "totalAlbums": 8456,
    "totalLooseFiles": 234,
    "groupedByLetter": {
      "A": { "artistCount": 98, "albumCount": 234, "looseFileCount": 5 },
      "B": { "artistCount": 76, "albumCount": 198, "looseFileCount": 2 }
    }
  }
}
```

#### `POST /api/scan`
**Purpose:** Deep scan music directory for files (Phase 2 - with metadata)
**Request:**
```json
{
  "musicPath": "/path/to/music",
  "artistLetters": ["A", "B", "C"]  // Optional: filter by artist letters
}
```
**Response:** SSE stream with progress
```json
{
  "status": "Scanning...",
  "filesFound": 523,
  "progress": 45
}
```

#### `POST /api/plex/connect`
**Purpose:** Test Plex server connection
**Request:**
```json
{
  "serverIp": "192.168.1.100",
  "port": 32400,
  "token": "your-plex-token"
}
```
**Response:**
```json
{
  "success": true,
  "server": {
    "name": "MyPlexServer",
    "version": "1.40.1.8227",
    "platform": "Linux"
  }
}
```

#### `POST /api/plex/libraries`
**Purpose:** Get list of Plex music libraries
**Request:**
```json
{
  "serverIp": "192.168.1.100",
  "port": 32400,
  "token": "your-plex-token"
}
```
**Response:**
```json
{
  "libraries": [
    {
      "id": 2,
      "name": "Music",
      "type": "artist",
      "trackCount": 98234
    }
  ]
}
```

#### `POST /api/plex/fetch`
**Purpose:** Fetch all tracks from Plex music library
**Request:**
```json
{
  "serverIp": "192.168.1.100",
  "port": 32400,
  "token": "your-plex-token",
  "libraryId": 2
}
```
**Response:** SSE stream with progress
```json
{
  "status": "Fetching tracks...",
  "progress": 45,
  "tracksFound": 44305
}
```

#### `POST /api/plex/compare`
**Purpose:** Compare offline scan results with Plex library
**Request:**
```json
{
  "offlineTracks": [...],  // Array of scanned offline tracks
  "plexTracks": [...]      // Array of Plex library tracks
}
```
**Response:**
```json
{
  "safeToAdd": 1234,
  "exactDuplicates": 456,
  "qualityUpgrades": 89,
  "qualityDowngrades": 23,
  "sameQualityDupes": 12,
  "conflicts": [
    {
      "offlineTrack": {...},
      "plexTrack": {...},
      "category": "QUALITY_UPGRADE",
      "recommendation": "REPLACE"
    }
  ]
}
```

#### `POST /api/match`
**Purpose:** Match scanned files to MusicBrainz
**Request:**
```json
{
  "files": ["file1.flac", "file2.flac"],
  "chunk": "A"
}
```
**Response:** SSE stream with matches
```json
{
  "file": "file1.flac",
  "match": {
    "artist": "Artist Name",
    "album": "Album Name (2024)",
    "title": "Track Title",
    "confidence": 95
  }
}
```

#### `POST /api/organize`
**Purpose:** Apply file reorganization
**Request:**
```json
{
  "changes": [
    {
      "source": "/old/path/file.flac",
      "destination": "/new/path/Artist/Album (2024)/01 - Title.flac"
    }
  ],
  "dryRun": true
}
```
**Response:** SSE stream with results
```json
{
  "file": "file.flac",
  "status": "success",
  "message": "Moved to /new/path/..."
}
```

#### `POST /api/cancel-organize`
**Purpose:** Cancel ongoing organization
**Request:**
```json
{
  "operationId": "1234567890"
}
```
**Response:**
```json
{
  "success": true,
  "message": "Organization cancelled"
}
```

---

## Dependencies Status

### Installed ✅
- `express` - ^4.18.2
- `multer` - ^1.4.5-lts.1
- `cors` - ^2.8.5
- `music-metadata` - ^11.10.0
- `fast-glob` - ^3.3.3
- `musicbrainz-api` - ^0.26.0
- `p-limit` - ^7.2.0
- `better-sqlite3` - ^12.4.1

### Needed ⏳
None - all dependencies installed

---

## Performance Targets

### Scanning
- **Target:** 1000 files/minute
- **Method:** Streaming with `fast-glob`
- **Bottleneck:** Disk I/O

### Matching
- **Target:** 1 file/second (MusicBrainz rate limit)
- **Optimization:** Cache hits = instant
- **Estimate:** First scan slow, subsequent scans fast

### Organization
- **Target:** 100 files/minute
- **Bottleneck:** File I/O (rename/move operations)
- **Optimization:** Batch operations where possible

---

## Future Enhancements (Post-v2.0.0)

### v2.1.0 Ideas
- Plex API integration for auto-refresh
- Support for other media servers (Jellyfin, Emby)
- Automatic album artwork download
- Lyrics embedding
- Duplicate file detection

### v2.2.0 Ideas
- Multi-language UI support
- Custom naming templates
- Bulk metadata editing
- Export/import organization presets

### v3.0.0 Ideas
- Desktop application (Electron)
- Cloud storage integration
- Automated music quality upgrades
- Machine learning for match improvement

---

## Release Checklist

### Before v2.0.0 Release
- [ ] All Phase 1-7 tasks complete
- [ ] Tested with Western music library
- [ ] Tested with Japanese music library
- [ ] Tested with 1000+ file library
- [ ] Plex compatibility verified
- [ ] README updated with organizer documentation
- [ ] All dependencies documented
- [ ] Known issues documented
- [ ] Git commit with detailed message
- [ ] GitHub release created
- [ ] Tag v2.0.0 created

### Documentation Updates Needed
- [ ] Update README.md with organizer usage
- [ ] Add screenshots of both modules
- [ ] Document Plex standards
- [ ] Add troubleshooting guide
- [ ] Include example workflows

---

## Progress Summary

**Overall Progress: 88%** (Phases 1-5, 8 Complete | Phase 3.8, 4, 6, 7 Remaining)

| Phase | Status | Progress | Files |
|-------|--------|----------|-------|
| Phase 1: UI Architecture | ✅ Complete | 100% | 6 files created |
| Phase 2: File Scanning | ✅ Complete | 100% | 4 files modified |
| Phase 2.5: Plex Integration | ✅ Complete | 100% | 3 files modified |
| Phase 3: MusicBrainz API | ✅ Complete | 100% | 5 files modified |
| Phase 3.5: Auto-Match & Rename | ✅ Complete | 100% | 5 files modified |
| Phase 3.75: Manual Review & Override | ✅ Complete | 100% | 2 files modified |
| **Phase 3.8: Three-Phase Matching** | **🔄 Testing** | **95%** | **Backend & Frontend complete** |
| Phase 4: Move to Live Library | ⏸️ Paused | 60% | Backend complete, resume after 3.8 |
| **Phase 5: YT Music Quality Upgrade** | **✅ Complete** | **100%** | **upgrader.js (backend + frontend)** |
| Phase 6: Real-time Progress | 🔄 Partial | 50% | SSE already implemented |
| Phase 7: Testing & Polish | ⏳ Planned | 0% | 0 files |
| **Phase 8: Artist Radar Dashboard** | **✅ Complete** | **100%** | **artist-radar.js + radar.js + radar.css** |

**Last Updated:** November 23, 2025
**Version:** 2.0.0-beta.1
**Next Milestone:** Test Three-Phase MusicBrainz Matching, complete Phase 4, then move to v2.0.0 release candidate

---

## Quick Reference

### Current State
- ✅ Tab navigation working
- ✅ Downloader module functional
- ✅ File scanning with metadata reading (Phase 2)
- ✅ Plex Media Server integration (Phase 2.5)
- ✅ MusicBrainz API integration (Phase 3)
- ✅ Auto-matching and renaming complete (Phase 3.5)
- ✅ Manual review interface complete (Phase 3.75)
- ✅ **YouTube Music Quality Upgrader complete** (Phase 5)
- ✅ **Artist Radar & Discovery Dashboard complete** (Phase 8)
- 🔄 **Three-phase matching strategy** - Refactor to Artists → Albums → Tracks (Phase 3.8)
- ⏸️ Move to live library paused (Phase 4) - Resume after matching refactor

### Next Steps
1. **🚧 CURRENT: Test Three-Phase MusicBrainz Matching (Phase 3.8)**
   - ✅ Backend implementation complete (matcher.js)
   - ✅ API endpoints complete (server.js)
   - ✅ Frontend UI complete (organizer.js + index.html)
   - ⏳ End-to-end testing required
   - Test with small dataset first (4-10 artists)
   - Verify button unlocking works correctly
   - Test Accept/Edit/Search/Skip integration
2. **Resume Phase 4: Move to Live Plex Library**
   - Backend complete, frontend UI remaining
   - Integrate with three-phase workflow
3. **NEW: Phase 9: Simple File Organizer (User Requested)**
   - No MusicBrainz matching required
   - Read existing metadata from audio files
   - Organize into Artist/Album/Track structure
   - Simple metadata-based organization
4. **Complete v2.0.0 Core Features**
   - Phase 6: Real-time Progress Updates (mostly done via SSE)
   - Phase 7: Testing & Polish
   - Final release candidate

### Testing the App
```bash
npm start
# Open http://localhost:3000
# Click "Music Organizer" tab
```

### Key Files to Know
- [server.js](server.js:1) - Main backend server
- [public/index.html](public/index.html:1) - Main UI with tabs
- [public/js/router.js](public/js/router.js:1) - Navigation system
- [public/js/organizer.js](public/js/organizer.js:1) - Organizer module frontend
- [modules/organizer/scanner.js](modules/organizer/scanner.js:1) - File scanning
- [modules/organizer/plex.js](modules/organizer/plex.js:1) - Plex integration
- [modules/organizer/musicbrainz.js](modules/organizer/musicbrainz.js:1) - MusicBrainz API
- [modules/organizer/matcher.js](modules/organizer/matcher.js:1) - Auto-matching & renaming

---

*This roadmap is a living document and will be updated as development progresses.*
