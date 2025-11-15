# Version 2.0.0 Roadmap - Music Library Organizer

## Overview

Version 2.0.0 transforms this application from a single-purpose YouTube Music downloader into a comprehensive music management suite with two modules:

1. **Module 1: YouTube Music Downloader** (Existing - Complete)
2. **Module 2: Music Library Organizer** (New - In Development)

## Project Goals

### Primary Objective
Create a Plex Media Server-optimized music library organizer that automatically corrects folder structures, filenames, and metadata using public music databases (MusicBrainz).

### Key Requirements
- Support both Western and Japanese music databases
- Process large music libraries efficiently (chunked/alphabetical processing)
- Maintain safety with dry-run mode and backup recommendations
- Real-time progress updates via Server-Sent Events
- Plex Media Server compatibility as the primary standard

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
│   │   └── organizer.css       🚧 Placeholder
│   ├── js/
│   │   ├── router.js           ✅ Complete
│   │   ├── downloader.js       ✅ Complete
│   │   └── organizer.js        🚧 Placeholder
│   └── index.html              ✅ Complete (Tab UI)
├── modules/
│   ├── downloader/             📁 Created (unused)
│   └── organizer/              📁 Created (empty)
│       ├── scanner.js          ⏳ Planned
│       ├── matcher.js          ⏳ Planned
│       ├── organizer.js        ⏳ Planned
│       └── cache.js            ⏳ Planned
├── server.js                   ✅ Complete (v1.1.0)
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

### 🚧 Phase 2: File Scanning & Metadata Reading (IN PROGRESS)
**Status:** Not Started
**Estimated Time:** 2-3 hours

**Goals:**
- Scan music directory recursively for audio files
- Read existing metadata from files (ID3/FLAC tags)
- Extract folder structure and filenames
- Identify files that need reorganization

**Tasks:**
- [ ] Create `modules/organizer/scanner.js` backend module
- [ ] Implement directory scanning with `fast-glob`
- [ ] Read metadata using `music-metadata`
- [ ] Identify Plex standard violations
- [ ] Create `/api/scan` endpoint
- [ ] Build organizer frontend form (directory input, scan button)
- [ ] Display scan results in UI (total files, issues found)
- [ ] Add SSE progress updates for scanning

**Deliverables:**
- Backend scanner module
- API endpoint for scanning
- Frontend scan interface
- Progress tracking UI

**Success Criteria:**
- Can scan directories with 1000+ files efficiently
- Correctly identifies audio files (FLAC, MP3, M4A, etc.)
- Extracts metadata without errors
- Reports scan progress in real-time

---

### ⏳ Phase 3: MusicBrainz API Integration (PLANNED)
**Status:** Not Started
**Estimated Time:** 3-4 hours

**Goals:**
- Integrate MusicBrainz API for metadata lookups
- Support Western and Japanese music
- Implement rate limiting (1 request/second)
- Cache results in SQLite database

**Tasks:**
- [ ] Create `modules/organizer/matcher.js` backend module
- [ ] Implement MusicBrainz API client with rate limiting
- [ ] Add AcoustID fingerprinting for accurate matching
- [ ] Create SQLite cache database
- [ ] Implement cache lookup/storage
- [ ] Add confidence scoring for matches
- [ ] Handle Japanese romanization
- [ ] Create `/api/match` endpoint

**Deliverables:**
- MusicBrainz integration module
- SQLite caching system
- Match confidence scoring algorithm
- Japanese music support

**Success Criteria:**
- Successfully queries MusicBrainz API
- Respects 1 req/sec rate limit
- Caches responses to minimize API calls
- Matches Japanese music correctly
- Confidence scores are accurate

**Rate Limiting Strategy:**
- Use `p-limit` to enforce 1 request/second
- Queue requests for processing
- Show queue status in UI

---

### ⏳ Phase 4: File Matching Logic (PLANNED)
**Status:** Not Started
**Estimated Time:** 2-3 hours

**Goals:**
- Match scanned files to MusicBrainz database
- Calculate confidence scores
- Handle uncertain matches gracefully
- Support manual review for low-confidence matches

**Tasks:**
- [ ] Implement file-to-metadata matching algorithm
- [ ] Calculate confidence scores (0-100%)
- [ ] Set confidence threshold (default: 80%)
- [ ] Create UI for reviewing uncertain matches
- [ ] Allow manual artist/album/track selection
- [ ] Display proposed changes before applying
- [ ] Show side-by-side comparison (current vs. proposed)

**Deliverables:**
- Matching algorithm with confidence scoring
- Manual review interface
- Change preview UI

**Success Criteria:**
- High-confidence matches (>80%) are accurate
- Low-confidence matches are flagged for review
- User can approve/reject individual changes
- No false positives on well-tagged files

**Matching Strategy:**
1. Try metadata-based matching first (artist + album + title)
2. Fall back to audio fingerprinting if metadata is poor
3. Use filename parsing as last resort
4. Flag for manual review if confidence < threshold

---

### ⏳ Phase 5: Safe File Operations (PLANNED)
**Status:** Not Started
**Estimated Time:** 3-4 hours

**Goals:**
- Implement dry-run mode (preview changes)
- Rename/move files safely
- Handle edge cases (duplicate filenames, special characters)
- Provide rollback capability

**Tasks:**
- [ ] Create `modules/organizer/organizer.js` backend module
- [ ] Implement dry-run mode (no actual changes)
- [ ] Create safe rename/move functions
- [ ] Handle filename conflicts (add suffix)
- [ ] Sanitize filenames (remove invalid characters)
- [ ] Create backup/rollback system
- [ ] Add `/api/organize` endpoint
- [ ] Implement progress tracking per file

**Deliverables:**
- File operations module
- Dry-run mode
- Conflict resolution
- Rollback capability

**Success Criteria:**
- Dry-run accurately predicts changes
- No data loss during operations
- Handles edge cases gracefully
- Can rollback failed operations

**Safety Features:**
- **Dry-run first:** Always preview before applying
- **Conflict resolution:** Add (1), (2), etc. to duplicates
- **Validation:** Check destination paths exist
- **Logging:** Record all operations for audit
- **Rollback:** Maintain operation history for undo

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

#### `POST /api/scan`
**Purpose:** Scan music directory for files
**Request:**
```json
{
  "musicPath": "/path/to/music"
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

**Overall Progress: 14%**

| Phase | Status | Progress | Files |
|-------|--------|----------|-------|
| Phase 1: UI Architecture | ✅ Complete | 100% | 6 files created |
| Phase 2: File Scanning | 🚧 Not Started | 0% | 0 files |
| Phase 3: MusicBrainz API | ⏳ Planned | 0% | 0 files |
| Phase 4: File Matching | ⏳ Planned | 0% | 0 files |
| Phase 5: File Operations | ⏳ Planned | 0% | 0 files |
| Phase 6: Progress Updates | ⏳ Planned | 0% | 0 files |
| Phase 7: Testing & Polish | ⏳ Planned | 0% | 0 files |

**Last Updated:** November 15, 2025
**Version:** 2.0.0-alpha.1
**Next Milestone:** Phase 2 - File Scanning & Metadata Reading

---

## Quick Reference

### Current State
- ✅ Tab navigation working
- ✅ Downloader module functional
- ✅ Organizer placeholder created
- 🚧 Organizer functionality pending

### Next Steps
1. Start Phase 2: File Scanning
2. Create scanner.js backend module
3. Implement /api/scan endpoint
4. Build frontend scan interface

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
- [public/js/organizer.js](public/js/organizer.js:1) - Organizer module (placeholder)

---

*This roadmap is a living document and will be updated as development progresses.*
