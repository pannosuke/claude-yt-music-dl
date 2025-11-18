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
│   │   └── organizer.css       ✅ Complete (Phases 2-3.5)
│   ├── js/
│   │   ├── router.js           ✅ Complete
│   │   ├── downloader.js       ✅ Complete
│   │   └── organizer.js        ✅ Complete (Phases 2-3.5)
│   └── index.html              ✅ Complete (Phases 1-3.5)
├── modules/
│   ├── downloader/             📁 Created (unused)
│   └── organizer/              📁 Created
│       ├── scanner.js          ✅ Complete (Phase 2)
│       ├── plex.js             ✅ Complete (Phase 2.5)
│       ├── musicbrainz.js      ✅ Complete (Phase 3)
│       ├── matcher.js          ✅ Complete (Phase 3.5)
│       └── organizer.js        ✅ Complete (Phase 4 Backend)
├── server.js                   ✅ Complete (Phases 1-4 Backend)
├── package.json                ✅ Updated to v2.0.0
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

### 🔄 Phase 4: Move to Live Plex Library (IN PROGRESS)
**Status:** 60% Complete - Backend Done, Frontend Pending
**Estimated Time:** 3-4 hours

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

**Overall Progress: 58%** (Phases 1-3.5 Complete)

| Phase | Status | Progress | Files |
|-------|--------|----------|-------|
| Phase 1: UI Architecture | ✅ Complete | 100% | 6 files created |
| Phase 2: File Scanning | ✅ Complete | 100% | 4 files modified |
| Phase 2.5: Plex Integration | ✅ Complete | 100% | 3 files modified |
| Phase 3: MusicBrainz API | ✅ Complete | 100% | 5 files modified |
| Phase 3.5: Auto-Match & Rename | ✅ Complete | 100% | 5 files modified |
| Phase 4: Move to Live Library | ⏳ Planned | 0% | 0 files |
| Phase 5: Real-time Progress | 🔄 Partial | 50% | SSE already implemented |
| Phase 6: Testing & Polish | ⏳ Planned | 0% | 0 files |

**Last Updated:** November 18, 2025
**Version:** 2.0.0-alpha.4
**Next Milestone:** Phase 4 (Move to Live Plex Library)

---

## Quick Reference

### Current State
- ✅ Tab navigation working
- ✅ Downloader module functional
- ✅ File scanning with metadata reading (Phase 2)
- ✅ Plex Media Server integration (Phase 2.5)
- ✅ MusicBrainz API integration (Phase 3)
- ✅ Auto-matching and renaming complete (Phase 3.5)
- ⏳ Move to live library pending (Phase 4)

### Next Steps
1. Start Phase 4: Move to Live Plex Library
2. Create organizer.js backend module
3. Implement /api/organizer/move-to-library endpoint (SSE)
4. Build frontend UI for live library path configuration
5. Implement quality upgrade/downgrade handling

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
