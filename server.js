import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import { scanDirectory, scanLibraryStructure, groupByArtist, generateScanSummary } from './modules/organizer/scanner.js';
import { testConnection, getLibraries, fetchLibraryTracks, compareWithPlex } from './modules/organizer/plex.js';
import { searchArtist, searchRelease, searchRecording, getReleaseDetails, getCacheStats } from './modules/organizer/musicbrainz.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const DEBUG = true;

// Track active downloads
const activeDownloads = new Map();

// Create logs directory and file
await fs.mkdir('logs', { recursive: true });
const logFile = createWriteStream(path.join(__dirname, 'logs', `download-${Date.now()}.log`), { flags: 'a' });

// Enhanced logging function
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  console.log(logMessage);
  logFile.write(logMessage + '\n');
}

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Ensure uploads directory exists
await fs.mkdir('uploads', { recursive: true });

log('Server initialized', 'INFO');

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Cancel download endpoint
app.post('/api/cancel', (req, res) => {
  const { downloadId } = req.body;
  const process = activeDownloads.get(downloadId);

  if (process) {
    log(`Cancelling download ${downloadId}`, 'INFO');
    process.kill('SIGTERM');
    activeDownloads.delete(downloadId);
    res.json({ success: true, message: 'Download cancelled' });
  } else {
    res.status(404).json({ error: 'Download not found' });
  }
});

// Download playlist endpoint
app.post('/api/download', upload.single('cookies'), async (req, res) => {
  const { playlistUrl, outputPath, cookiesPath, poToken } = req.body;
  const downloadId = Date.now().toString();

  log('=== NEW DOWNLOAD REQUEST ===', 'INFO');
  log(`Playlist URL: ${playlistUrl}`, 'DEBUG');
  log(`Output Path: ${outputPath}`, 'DEBUG');
  log(`Cookies Path: ${cookiesPath}`, 'DEBUG');
  log(`PO Token: ${poToken ? 'Provided (' + poToken.substring(0, 10) + '...)' : 'Not provided'}`, 'DEBUG');

  if (!playlistUrl || !outputPath) {
    log('Missing required parameters', 'ERROR');
    return res.status(400).json({ error: 'Playlist URL and output path are required' });
  }

  // Set response headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    if (DEBUG && data.debug) {
      log(data.debug, 'DEBUG');
    }
    // Include downloadId in all progress messages
    res.write(`data: ${JSON.stringify({ ...data, downloadId })}\n\n`);
  };

  try {
    // Verify output path exists
    try {
      await fs.access(outputPath);
      log(`Output path verified: ${outputPath}`, 'DEBUG');
      sendProgress({ debug: `Output path verified: ${outputPath}` });
    } catch (error) {
      log(`Output path does not exist: ${outputPath}`, 'ERROR');
      sendProgress({ error: `Output path does not exist: ${outputPath}` });
      res.end();
      return;
    }

    // Verify cookies file exists if provided
    if (cookiesPath) {
      try {
        await fs.access(cookiesPath);
        log(`Cookies file verified: ${cookiesPath}`, 'DEBUG');
        sendProgress({ debug: `Cookies file verified: ${cookiesPath}` });
      } catch (error) {
        log(`Cookies file not found: ${cookiesPath}`, 'ERROR');
        sendProgress({ error: `Cookies file not found: ${cookiesPath}` });
        res.end();
        return;
      }
    }

    sendProgress({ status: 'Starting download...', progress: 0 });

    // Build yt-dlp command
    // Key insight: YouTube doesn't provide FLAC natively, so we download best audio and convert
    // Using TV client to bypass signature extraction issues
    const args = [
      '-f', 'bestaudio/best',  // Select best audio quality available
      '-x',  // Extract audio only
      '--audio-format', 'flac',  // Convert to FLAC
      '--audio-quality', '0',  // Best quality (0-9, 0 is best)
      '--output', path.join(outputPath, '%(artist)s/%(album)s/%(title)s.%(ext)s'),
      '--add-metadata',  // Add metadata from video
      '--embed-thumbnail',  // Embed thumbnail as artwork
      '--yes-playlist',  // Explicitly download whole playlist
      '--ignore-errors',  // Continue on download errors
      '--no-warnings',  // Reduce output noise
      '--newline',  // Output progress on new lines (better for parsing)
      '--progress',  // Show progress
      '--no-check-certificates',  // Sometimes helps with auth issues
      '--extractor-args', 'youtube:player_client=tv'  // Use TV client to bypass signature issues
    ];

    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
      log('Using cookies file for authentication', 'DEBUG');
    }

    // Don't use PO token - it appears to require special format we don't have
    // if (poToken) {
    //   args.push('--extractor-args', `youtube:po_token=${poToken}`);
    //   log('Using PO token for authentication', 'DEBUG');
    // }

    args.push(playlistUrl);

    const command = `yt-dlp ${args.join(' ')}`;
    log(`Executing command: ${command.substring(0, 200)}...`, 'DEBUG');
    sendProgress({ debug: `Command: yt-dlp with ${args.length} arguments`, progress: 2 });
    sendProgress({ status: 'Fetching playlist information...', progress: 5 });

    const ytdlp = spawn('yt-dlp', args);
    activeDownloads.set(downloadId, ytdlp);

    // Enhanced tracking variables for status dashboard
    let totalTracks = 0;
    let currentTrack = 0;
    let completedTracks = 0;
    let failedTracks = [];
    let unavailableVideos = [];
    let skippedTracks = 0;
    let currentTrackInfo = { artist: '', album: '', title: '' };
    let currentFile = '';
    let downloadedCount = 0;

    ytdlp.stdout.on('data', (data) => {
      const output = data.toString();
      log(`[yt-dlp stdout] ${output}`, 'DEBUG');

      // Send all output to frontend in debug mode
      if (DEBUG) {
        sendProgress({ rawOutput: output.trim() });
      }

      // 1. Extract total tracks from playlist
      const playlistMatch = output.match(/\[youtube:tab\] Playlist [^:]+: Downloading (\d+) items of (\d+)/);
      if (playlistMatch) {
        totalTracks = parseInt(playlistMatch[2]);
        sendProgress({
          totalTracks,
          status: `Found ${totalTracks} tracks in playlist`,
          progress: 5
        });
      }

      // 2. Track current item being downloaded
      const itemMatch = output.match(/\[download\] Downloading item (\d+) of (\d+)/);
      if (itemMatch) {
        currentTrack = parseInt(itemMatch[1]);
        totalTracks = parseInt(itemMatch[2]);
        const remaining = totalTracks - currentTrack;
        sendProgress({
          currentTrack,
          totalTracks,
          remaining,
          status: `Downloading track ${currentTrack} of ${totalTracks}`
        });
      }

      // 3. Extract track title from metadata parser
      const trackTitleMatch = output.match(/\[MetadataParser\] Parsed track from '%\(title\)s': '(.+)'/);
      if (trackTitleMatch) {
        currentTrackInfo.title = trackTitleMatch[1];
      }

      // 4. Extract artist and album from destination path
      if (output.includes('[download] Destination:')) {
        const fileMatch = output.match(/\[download\] Destination: (.+)/);
        if (fileMatch) {
          currentFile = path.basename(fileMatch[1]);
          log(`Downloading file: ${currentFile}`, 'INFO');

          // Try to extract artist/album from path: /path/to/Artist/Album/file.ext
          const pathMatch = fileMatch[1].match(/\/([^\/]+)\/([^\/]+)\/[^\/]+$/);
          if (pathMatch) {
            currentTrackInfo.artist = pathMatch[1];
            currentTrackInfo.album = pathMatch[2];
            log(`Extracted artist: ${currentTrackInfo.artist}, album: ${currentTrackInfo.album}`, 'DEBUG');
            sendProgress({
              currentTrackInfo: {...currentTrackInfo},
              status: `Downloading: ${currentTrackInfo.artist} - ${currentTrackInfo.title || currentFile}`
            });
          }
        }
      }

      // 5. Parse download progress percentages
      if (output.includes('[download]') && output.includes('%')) {
        const percentMatch = output.match(/(\d+\.?\d*)%/);
        if (percentMatch) {
          const percent = parseFloat(percentMatch[1]);
          sendProgress({
            downloadProgress: percent,
            status: `Downloading: ${currentTrackInfo.title || currentFile} (${percent.toFixed(1)}%)`,
            progress: totalTracks > 0 ? Math.min(Math.round((completedTracks / totalTracks) * 100), 99) : Math.min(percent, 99)
          });
        }
      }

      // 6. Track completed tracks (audio extraction)
      if (output.includes('[ExtractAudio]')) {
        completedTracks++;
        downloadedCount++; // Keep for compatibility
        const extractMatch = output.match(/\[ExtractAudio\] Destination: (.+)/);
        if (extractMatch) {
          const fileName = path.basename(extractMatch[1]);
          const progressPercent = totalTracks > 0 ? Math.round((completedTracks / totalTracks) * 100) : 50;
          log(`Processed track ${completedTracks}`, 'INFO');
          sendProgress({
            completedTracks,
            downloadedCount: completedTracks,
            lastCompleted: fileName,
            format: 'FLAC',
            status: `Completed ${completedTracks}${totalTracks > 0 ? ` of ${totalTracks}` : ''} track(s)`,
            progress: Math.min(progressPercent, 99)
          });
        }
      }

      // 7. Track skipped tracks (already downloaded)
      if (output.includes('has already been downloaded')) {
        skippedTracks++;
        completedTracks++; // Count as completed
        downloadedCount++; // Keep for compatibility
        const progressPercent = totalTracks > 0 ? Math.round((completedTracks / totalTracks) * 100) : 50;
        sendProgress({
          skippedTracks,
          completedTracks,
          downloadedCount: completedTracks,
          status: `Skipped ${skippedTracks} already downloaded track(s)`,
          progress: Math.min(progressPercent, 99)
        });
      }
    });

    ytdlp.stderr.on('data', (data) => {
      const output = data.toString();
      log(`[yt-dlp stderr] ${output}`, 'DEBUG');

      // Send all stderr to frontend in debug mode
      if (DEBUG) {
        sendProgress({ rawOutput: `[stderr] ${output.trim()}` });
      }

      // 8. Track unavailable videos count
      const unavailableMatch = output.match(/(\d+) unavailable videos? (?:is|are) hidden/);
      if (unavailableMatch) {
        const unavailableCount = parseInt(unavailableMatch[1]);
        sendProgress({
          unavailableCount,
          warning: `${unavailableCount} unavailable video(s) in playlist`
        });
      }

      // 9. Track individual errors
      if (output.includes('ERROR:')) {
        let errorType = 'unknown';
        let errorMessage = output.trim();

        // Classify error types
        if (output.includes('Video unavailable')) {
          errorType = 'unavailable';
          const videoIdMatch = output.match(/\[youtube\] ([^:]+):/);
          if (videoIdMatch) {
            const videoId = videoIdMatch[1];
            unavailableVideos.push({
              videoId,
              message: errorMessage
            });
          }
        } else if (output.includes('Private video')) {
          errorType = 'private';
        } else if (output.includes('removed by the uploader')) {
          errorType = 'removed';
        } else if (output.includes('403: Forbidden')) {
          errorType = 'forbidden';
        }

        failedTracks.push({
          type: errorType,
          message: errorMessage,
          timestamp: new Date().toISOString()
        });

        log(`yt-dlp error: ${output}`, 'ERROR');
        sendProgress({
          error: errorMessage,
          failedCount: failedTracks.length,
          failedTracks: failedTracks,
          unavailableVideos: unavailableVideos.map(v => v.videoId)
        });
      } else if (output.includes('WARNING:')) {
        log(`yt-dlp warning: ${output}`, 'WARN');
        sendProgress({ warning: output.trim() });
      }
    });

    ytdlp.on('close', async (code) => {
      log(`yt-dlp process exited with code ${code}`, code === 0 ? 'INFO' : 'ERROR');
      activeDownloads.delete(downloadId);

      if (code === 0) {
        log(`Download completed successfully. Total tracks: ${completedTracks}`, 'INFO');
        sendProgress({
          status: 'Download completed successfully!',
          progress: 100,
          completed: true,
          totalTracks,
          completedTracks,
          skippedTracks,
          downloadedCount: completedTracks,
          failedCount: failedTracks.length,
          failedTracks: failedTracks,
          unavailableCount: unavailableVideos.length,
          unavailableVideos: unavailableVideos.map(v => v.videoId)
        });
      } else if (code === null || code === 143 || code === 15) {
        // SIGTERM or killed by user
        log('Download cancelled by user', 'INFO');
        sendProgress({
          status: 'Download cancelled',
          completed: true,
          cancelled: true,
          totalTracks,
          completedTracks,
          failedCount: failedTracks.length,
          failedTracks: failedTracks
        });
      } else {
        log(`Download failed with exit code ${code}`, 'ERROR');
        sendProgress({
          error: `Download failed with exit code ${code}`,
          completed: true,
          totalTracks,
          completedTracks,
          failedCount: failedTracks.length,
          failedTracks: failedTracks
        });
      }
      res.end();
    });

    ytdlp.on('error', async (error) => {
      log(`Failed to start yt-dlp: ${error.message}`, 'ERROR');
      activeDownloads.delete(downloadId);
      sendProgress({
        error: `Failed to start yt-dlp: ${error.message}. Make sure yt-dlp is installed.`,
        completed: true
      });
      res.end();
    });

  } catch (error) {
    log(`Server error: ${error.message}`, 'ERROR');
    log(`Stack trace: ${error.stack}`, 'ERROR');
    sendProgress({
      error: `Server error: ${error.message}`,
      completed: true
    });
    res.end();
  }
});

// Quick structure scan endpoint (Music Organizer Module - Phase 1)
app.post('/api/scan/structure', async (req, res) => {
  const { musicPath } = req.body;

  log('=== NEW STRUCTURE SCAN REQUEST ===', 'INFO');
  log(`Music Path: ${musicPath}`, 'DEBUG');

  if (!musicPath) {
    log('Missing required parameter: musicPath', 'ERROR');
    return res.status(400).json({ error: 'Music path is required' });
  }

  // Set response headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    if (DEBUG && data.debug) {
      log(data.debug, 'DEBUG');
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Verify music path exists
    try {
      await fs.access(musicPath);
      log(`Music path verified: ${musicPath}`, 'DEBUG');
      sendProgress({ debug: `Music path verified: ${musicPath}` });
    } catch (error) {
      log(`Music path does not exist: ${musicPath}`, 'ERROR');
      sendProgress({ error: `Music path does not exist: ${musicPath}` });
      res.end();
      return;
    }

    sendProgress({ status: 'Starting structure scan...', progress: 0 });

    // Quick scan of directory structure
    const structure = await scanLibraryStructure(musicPath, (progressData) => {
      sendProgress(progressData);
    });

    log(`Structure scan completed. Found ${structure.artists.length} artists`, 'INFO');

    // Simplify groupedByLetter to avoid JSON serialization issues
    // Only send counts, not the full artist object arrays
    const simplifiedGroups = {};
    for (const letter in structure.groupedByLetter) {
      const group = structure.groupedByLetter[letter];
      simplifiedGroups[letter] = {
        letter: group.letter,
        artistCount: group.artistCount,
        albumCount: group.albumCount,
        looseFileCount: group.looseFileCount
        // Don't send the full artist list to avoid JSON issues
      };
    }

    // Send final results
    sendProgress({
      status: 'Structure scan completed!',
      progress: 100,
      completed: true,
      structure: {
        totalArtists: structure.artists.length,
        totalAlbums: structure.totalAlbums,
        totalLooseFiles: structure.totalLooseFiles,
        groupedByLetter: simplifiedGroups
      }
    });

    res.end();

  } catch (error) {
    log(`Structure scan error: ${error.message}`, 'ERROR');
    log(`Stack trace: ${error.stack}`, 'ERROR');
    sendProgress({
      error: `Structure scan error: ${error.message}`,
      completed: true
    });
    res.end();
  }
});

// Deep scan music library endpoint (Music Organizer Module - Phase 2)
app.post('/api/scan', async (req, res) => {
  const { musicPath, artistLetters } = req.body;

  log('=== NEW DEEP SCAN REQUEST ===', 'INFO');
  log(`Music Path: ${musicPath}`, 'DEBUG');
  if (artistLetters) {
    log(`Artist Letters Filter: ${artistLetters.join(', ')}`, 'DEBUG');
  }

  if (!musicPath) {
    log('Missing required parameter: musicPath', 'ERROR');
    return res.status(400).json({ error: 'Music path is required' });
  }

  // Set response headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    if (DEBUG && data.debug) {
      log(data.debug, 'DEBUG');
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Verify music path exists
    try {
      await fs.access(musicPath);
      log(`Music path verified: ${musicPath}`, 'DEBUG');
      sendProgress({ debug: `Music path verified: ${musicPath}` });
    } catch (error) {
      log(`Music path does not exist: ${musicPath}`, 'ERROR');
      sendProgress({ error: `Music path does not exist: ${musicPath}` });
      res.end();
      return;
    }

    sendProgress({ status: 'Starting deep scan...', progress: 0 });

    // Scan directory with progress callbacks
    // Pass artist letters filter if provided
    const options = {};
    if (artistLetters && artistLetters.length > 0) {
      options.artistLetters = artistLetters;
    }

    const scannedFiles = await scanDirectory(musicPath, (progressData) => {
      sendProgress(progressData);
    }, options);

    // Generate summary statistics
    const summary = generateScanSummary(scannedFiles);

    // Group files by artist for alphabetical processing
    const groupedByArtist = groupByArtist(scannedFiles);

    log(`Scan completed. Found ${scannedFiles.length} files`, 'INFO');

    // Simplify groupedByArtist to avoid JSON serialization issues
    // Only send essential data, store full file data separately
    const simplifiedGroupedByArtist = {};
    for (const letter in groupedByArtist) {
      const group = groupedByArtist[letter];
      simplifiedGroupedByArtist[letter] = {
        letter: group.letter,
        artistCount: group.artistCount,
        fileCount: group.fileCount,
        artists: Array.from(group.artists),
        // Include minimal file data for display
        files: group.files.map(f => ({
          fileName: f.fileName,
          folderArtist: f.folderArtist,
          metadata: {
            artist: f.metadata?.artist || '',
            albumArtist: f.metadata?.albumArtist || '',
            album: f.metadata?.album || '',
            title: f.metadata?.title || '',
            format: f.metadata?.format || ''
          },
          compliance: {
            isCompliant: f.compliance?.isCompliant || false,
            issues: f.compliance?.issues || []
          }
        }))
      };
    }

    // Send final results with simplified data
    sendProgress({
      status: 'Scan completed successfully!',
      progress: 100,
      completed: true,
      summary,
      groupedByArtist: simplifiedGroupedByArtist
    });

    res.end();

  } catch (error) {
    log(`Scan error: ${error.message}`, 'ERROR');
    log(`Stack trace: ${error.stack}`, 'ERROR');
    sendProgress({
      error: `Scan error: ${error.message}`,
      completed: true
    });
    res.end();
  }
});

// Plex connection test endpoint (Music Organizer Module - Phase 2.5)
app.post('/api/plex/connect', async (req, res) => {
  const { serverIp, port, token } = req.body;

  log('=== NEW PLEX CONNECTION TEST ===', 'INFO');
  log(`Server IP: ${serverIp}`, 'DEBUG');
  log(`Port: ${port}`, 'DEBUG');
  log(`Token: ${token ? 'Provided (' + token.substring(0, 10) + '...)' : 'Not provided'}`, 'DEBUG');

  if (!serverIp || !port || !token) {
    log('Missing required parameters', 'ERROR');
    return res.status(400).json({ error: 'Server IP, port, and token are required' });
  }

  try {
    const result = await testConnection(serverIp, port, token);
    log(`Connection test result: ${result.success ? 'SUCCESS' : 'FAILED'}`, result.success ? 'INFO' : 'ERROR');
    res.json(result);
  } catch (error) {
    log(`Connection test error: ${error.message}`, 'ERROR');
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Plex libraries list endpoint (Music Organizer Module - Phase 2.5)
app.post('/api/plex/libraries', async (req, res) => {
  const { serverIp, port, token } = req.body;

  log('=== NEW PLEX LIBRARIES REQUEST ===', 'INFO');
  log(`Server IP: ${serverIp}`, 'DEBUG');
  log(`Port: ${port}`, 'DEBUG');

  if (!serverIp || !port || !token) {
    log('Missing required parameters', 'ERROR');
    return res.status(400).json({ error: 'Server IP, port, and token are required' });
  }

  try {
    const libraries = await getLibraries(serverIp, port, token);
    log(`Found ${libraries.length} music libraries`, 'INFO');
    res.json({ success: true, libraries });
  } catch (error) {
    log(`Libraries fetch error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Plex library fetch endpoint with SSE progress (Music Organizer Module - Phase 2.5)
app.post('/api/plex/fetch', async (req, res) => {
  const { serverIp, port, token, libraryId } = req.body;

  log('=== NEW PLEX FETCH REQUEST ===', 'INFO');
  log(`Server IP: ${serverIp}`, 'DEBUG');
  log(`Port: ${port}`, 'DEBUG');
  log(`Library ID: ${libraryId}`, 'DEBUG');

  if (!serverIp || !port || !token || !libraryId) {
    log('Missing required parameters', 'ERROR');
    return res.status(400).json({ error: 'Server IP, port, token, and library ID are required' });
  }

  // Set response headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    if (DEBUG && data.debug) {
      log(data.debug, 'DEBUG');
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendProgress({ status: 'Connecting to Plex...', progress: 0 });

    const tracks = await fetchLibraryTracks(serverIp, port, token, libraryId, (progressData) => {
      sendProgress(progressData);
    });

    log(`Fetched ${tracks.length} tracks from Plex library`, 'INFO');

    // Send final results
    sendProgress({
      status: 'Plex library fetched successfully!',
      progress: 100,
      completed: true,
      tracks
    });

    res.end();

  } catch (error) {
    log(`Plex fetch error: ${error.message}`, 'ERROR');
    log(`Stack trace: ${error.stack}`, 'ERROR');
    sendProgress({
      error: `Plex fetch error: ${error.message}`,
      completed: true
    });
    res.end();
  }
});

// Plex comparison endpoint (Music Organizer Module - Phase 2.5)
app.post('/api/plex/compare', async (req, res) => {
  const { offlineTracks, plexTracks } = req.body;

  log('=== NEW PLEX COMPARISON REQUEST ===', 'INFO');
  log(`Offline tracks: ${offlineTracks?.length || 0}`, 'DEBUG');
  log(`Plex tracks: ${plexTracks?.length || 0}`, 'DEBUG');

  if (!offlineTracks || !plexTracks) {
    log('Missing required parameters', 'ERROR');
    return res.status(400).json({ error: 'Offline tracks and Plex tracks are required' });
  }

  // Set response headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    if (DEBUG && data.debug) {
      log(data.debug, 'DEBUG');
    }
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    sendProgress({ status: 'Starting comparison...', progress: 0 });

    const results = compareWithPlex(offlineTracks, plexTracks, (progressData) => {
      sendProgress(progressData);
    });

    log(`Comparison complete. Safe to add: ${results.safeToAdd}, Upgrades: ${results.qualityUpgrades}, Downgrades: ${results.qualityDowngrades}`, 'INFO');

    // Send final results
    sendProgress({
      status: 'Comparison completed!',
      progress: 100,
      completed: true,
      results
    });

    res.end();

  } catch (error) {
    log(`Comparison error: ${error.message}`, 'ERROR');
    log(`Stack trace: ${error.stack}`, 'ERROR');
    sendProgress({
      error: `Comparison error: ${error.message}`,
      completed: true
    });
    res.end();
  }
});

// MusicBrainz search endpoints (Music Organizer Module - Phase 3)
app.post('/api/musicbrainz/search-artist', async (req, res) => {
  const { artist } = req.body;

  log('=== NEW MUSICBRAINZ ARTIST SEARCH ===', 'INFO');
  log(`Artist: ${artist}`, 'DEBUG');

  if (!artist) {
    log('Missing artist parameter', 'ERROR');
    return res.status(400).json({ error: 'Artist name is required' });
  }

  try {
    const results = await searchArtist(artist);
    log(`Found ${results.length} artist matches`, 'INFO');
    res.json({ success: true, results });
  } catch (error) {
    log(`MusicBrainz artist search error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/musicbrainz/search-release', async (req, res) => {
  const { artist, album } = req.body;

  log('=== NEW MUSICBRAINZ RELEASE SEARCH ===', 'INFO');
  log(`Artist: ${artist}, Album: ${album}`, 'DEBUG');

  if (!artist || !album) {
    log('Missing required parameters', 'ERROR');
    return res.status(400).json({ error: 'Artist and album are required' });
  }

  try {
    const results = await searchRelease(artist, album);
    log(`Found ${results.length} release matches`, 'INFO');
    res.json({ success: true, results });
  } catch (error) {
    log(`MusicBrainz release search error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/musicbrainz/search-recording', async (req, res) => {
  const { artist, album, title } = req.body;

  log('=== NEW MUSICBRAINZ RECORDING SEARCH ===', 'INFO');
  log(`Artist: ${artist}, Album: ${album}, Title: ${title}`, 'DEBUG');

  if (!artist || !album || !title) {
    log('Missing required parameters', 'ERROR');
    return res.status(400).json({ error: 'Artist, album, and title are required' });
  }

  try {
    const results = await searchRecording(artist, album, title);
    log(`Found ${results.length} recording matches`, 'INFO');
    res.json({ success: true, results });
  } catch (error) {
    log(`MusicBrainz recording search error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/musicbrainz/release-details', async (req, res) => {
  const { releaseId } = req.body;

  log('=== NEW MUSICBRAINZ RELEASE DETAILS REQUEST ===', 'INFO');
  log(`Release ID: ${releaseId}`, 'DEBUG');

  if (!releaseId) {
    log('Missing release ID', 'ERROR');
    return res.status(400).json({ error: 'Release ID is required' });
  }

  try {
    const details = await getReleaseDetails(releaseId);
    log(`Fetched details for release ${releaseId}`, 'INFO');
    res.json({ success: true, details });
  } catch (error) {
    log(`MusicBrainz release details error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/musicbrainz/cache-stats', async (req, res) => {
  log('=== MUSICBRAINZ CACHE STATS REQUEST ===', 'INFO');

  try {
    const stats = getCacheStats();
    res.json({ success: true, stats });
  } catch (error) {
    log(`Cache stats error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  log(`Server running on http://localhost:${PORT}`, 'INFO');
  log('Make sure yt-dlp is installed: pip install yt-dlp', 'INFO');
  log(`Debug mode: ${DEBUG ? 'ENABLED' : 'DISABLED'}`, 'INFO');
  log(`Log file: ${path.join(__dirname, 'logs', 'download-*.log')}`, 'INFO');
});
