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
import { searchArtist, searchRelease, searchRecording, getReleaseDetails, getCacheStats, clearCache } from './modules/organizer/musicbrainz.js';
import { batchMatchFiles, generateRenamePreviews, executeRename, getMatchStatistics, matchArtists, matchAlbums } from './modules/organizer/matcher.js';
import { validatePath, isPathWritable, planMoveOperations, executeMoveOperations, rollbackLastOperation, triggerPlexRefresh } from './modules/organizer/organizer.js';

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
      '--embed-thumbnail',  // Embed thumbnail as cover art
      '--convert-thumbnails', 'jpg',  // Convert WebP to JPG (FLAC-compatible)
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

        // Cleanup: Remove leftover JPG thumbnails and empty NA folders
        try {
          const fg = (await import('fast-glob')).default;

          // Find and remove JPG files next to FLAC files
          const jpgFiles = await fg('**/*.jpg', { cwd: outputPath, absolute: true });
          for (const jpgFile of jpgFiles) {
            const flacFile = jpgFile.replace(/\.jpg$/, '.flac');
            if (await fs.access(flacFile).then(() => true).catch(() => false)) {
              await fs.unlink(jpgFile);
              log(`Cleaned up thumbnail: ${path.basename(jpgFile)}`, 'DEBUG');
            }
          }

          // Remove NA folder if it exists and is empty
          const naFolder = path.join(outputPath, 'NA');
          if (await fs.access(naFolder).then(() => true).catch(() => false)) {
            try {
              await fs.rmdir(naFolder, { recursive: true });
              log('Cleaned up NA folder', 'DEBUG');
            } catch (err) {
              log(`Could not remove NA folder: ${err.message}`, 'DEBUG');
            }
          }
        } catch (cleanupError) {
          log(`Cleanup error: ${cleanupError.message}`, 'WARN');
        }

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
        // Include file data needed for batch match and display
        files: group.files.map(f => ({
          filePath: f.filePath,
          relativePath: f.relativePath,
          fileName: f.fileName,
          folderArtist: f.folderArtist,
          folderAlbum: f.folderAlbum,
          // Flatten metadata for batch match compatibility
          artist: f.metadata?.artist || '',
          albumArtist: f.metadata?.albumArtist || '',
          album: f.metadata?.album || '',
          title: f.metadata?.title || '',
          format: f.metadata?.format || '',
          codec: f.metadata?.codec || '',
          bitrate: f.metadata?.bitrate || 0,
          trackNumber: f.metadata?.trackNumber || 0,
          year: f.metadata?.year || 0,
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

// GET endpoint for manual search (Phase 3.75)
app.get('/api/musicbrainz/recording', async (req, res) => {
  const { artist, album, title } = req.query;

  log('=== MUSICBRAINZ RECORDING SEARCH (GET) ===', 'INFO');
  log(`Artist: ${artist}, Album: ${album || 'N/A'}, Title: ${title}`, 'DEBUG');

  if (!artist || !title) {
    log('Missing required parameters', 'ERROR');
    return res.status(400).json({ error: 'Artist and title are required' });
  }

  try {
    const results = await searchRecording(artist, album || '', title);
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

app.post('/api/musicbrainz/clear-cache', async (req, res) => {
  log('=== MUSICBRAINZ CLEAR CACHE REQUEST ===', 'INFO');

  try {
    const result = clearCache();

    if (result.success) {
      log(`Successfully cleared ${result.cleared} cache entries`, 'INFO');
      res.json(result);
    } else {
      log(`Failed to clear cache: ${result.message}`, 'ERROR');
      res.status(500).json(result);
    }
  } catch (error) {
    log(`Cache clear error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message,
      message: `Failed to clear cache: ${error.message}`
    });
  }
});

// ========================================
// MATCHER ENDPOINTS (Phase 3.5)
// ========================================

/**
 * POST /api/matcher/batch-match
 * Batch match scanned files to MusicBrainz with SSE progress
 */
app.post('/api/matcher/batch-match', async (req, res) => {
  log('=== BATCH MATCH REQUEST ===', 'INFO');

  const { files } = req.body;

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid files array'
    });
  }

  log(`Batch matching ${files.length} files to MusicBrainz`, 'INFO');

  // DEBUG: Log first file to see what fields are present
  if (files.length > 0) {
    log(`DEBUG: First file keys: ${Object.keys(files[0]).join(', ')}`, 'INFO');
    log(`DEBUG: First file filePath: ${files[0].filePath}`, 'INFO');
    log(`DEBUG: First file path: ${files[0].path}`, 'INFO');
    log(`DEBUG: First file structure: ${JSON.stringify(files[0], null, 2)}`, 'INFO');
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const matchResults = await batchMatchFiles(files, (progress) => {
      // Send progress updates via SSE
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        ...progress
      })}\n\n`);
    });

    // Get statistics
    const stats = getMatchStatistics(matchResults);

    // Send completion message
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      results: matchResults,
      stats: stats,
      message: `Batch matching complete! Matched ${stats.matched}/${stats.total} files`
    })}\n\n`);

    res.end();
    log(`Batch matching complete: ${stats.matched}/${stats.total} files matched`, 'INFO');

  } catch (error) {
    log(`Batch match error: ${error.message}`, 'ERROR');
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
});

/**
 * ========================================
 * THREE-PHASE MUSICBRAINZ MATCHING ENDPOINTS
 * ========================================
 */

/**
 * POST /api/matcher/match-artists
 * Phase 1: Match unique artists to MusicBrainz with SSE progress
 */
app.post('/api/matcher/match-artists', async (req, res) => {
  log('=== PHASE 1: MATCH ARTISTS REQUEST ===', 'INFO');

  const { files } = req.body;

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid files array'
    });
  }

  log(`Phase 1: Matching artists from ${files.length} files`, 'INFO');

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const artistResults = await matchArtists(files, (progress) => {
      // Send progress updates via SSE
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        ...progress
      })}\n\n`);
    });

    // Calculate statistics
    const stats = {
      total: artistResults.length,
      autoApprove: artistResults.filter(r => r.category === 'auto_approve').length,
      review: artistResults.filter(r => r.category === 'review').length,
      manual: artistResults.filter(r => r.category === 'manual').length,
      errors: artistResults.filter(r => r.status === 'error').length
    };

    // Send completion message
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      results: artistResults,
      stats: stats,
      message: `Phase 1 complete! Matched ${stats.autoApprove + stats.review}/${stats.total} artists`
    })}\n\n`);

    res.end();
    log(`Phase 1 complete: ${stats.autoApprove + stats.review}/${stats.total} artists matched`, 'INFO');

  } catch (error) {
    log(`Phase 1 error: ${error.message}`, 'ERROR');
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/matcher/match-albums
 * Phase 2: Match albums using corrected artist names with SSE progress
 */
app.post('/api/matcher/match-albums', async (req, res) => {
  log('=== PHASE 2: MATCH ALBUMS REQUEST ===', 'INFO');

  const { files, artistMatches } = req.body;

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid files array'
    });
  }

  if (!artistMatches || !Array.isArray(artistMatches)) {
    return res.status(400).json({
      success: false,
      error: 'Missing artistMatches from Phase 1'
    });
  }

  log(`Phase 2: Matching albums from ${files.length} files using ${artistMatches.length} artist matches`, 'INFO');

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const albumResults = await matchAlbums(files, artistMatches, (progress) => {
      // Send progress updates via SSE
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        ...progress
      })}\n\n`);
    });

    // Calculate statistics
    const stats = {
      total: albumResults.length,
      autoApprove: albumResults.filter(r => r.category === 'auto_approve').length,
      review: albumResults.filter(r => r.category === 'review').length,
      manual: albumResults.filter(r => r.category === 'manual').length,
      errors: albumResults.filter(r => r.status === 'error').length
    };

    // Send completion message
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      results: albumResults,
      stats: stats,
      message: `Phase 2 complete! Matched ${stats.autoApprove + stats.review}/${stats.total} albums`
    })}\n\n`);

    res.end();
    log(`Phase 2 complete: ${stats.autoApprove + stats.review}/${stats.total} albums matched`, 'INFO');

  } catch (error) {
    log(`Phase 2 error: ${error.message}`, 'ERROR');
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/matcher/preview-rename
 * Generate rename previews for matched files
 */
app.post('/api/matcher/preview-rename', async (req, res) => {
  log('=== RENAME PREVIEW REQUEST ===', 'INFO');

  const { matchResults, basePath } = req.body;

  if (!matchResults || !Array.isArray(matchResults)) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid matchResults array'
    });
  }

  if (!basePath) {
    return res.status(400).json({
      success: false,
      error: 'Missing basePath for rename previews'
    });
  }

  try {
    log(`Generating rename previews for ${matchResults.length} files (basePath: ${basePath})`, 'INFO');

    // Debug: Log first match result to see structure
    if (matchResults.length > 0) {
      log(`DEBUG: First match result keys: ${Object.keys(matchResults[0]).join(', ')}`, 'INFO');
      log(`DEBUG: First match result structure: ${JSON.stringify(matchResults[0], null, 2)}`, 'INFO');
    }

    const previews = generateRenamePreviews(matchResults, basePath);

    log(`Rename previews generated: ${previews.summary.autoApprove} auto-approve, ${previews.summary.review} review, ${previews.summary.manual} manual`, 'INFO');

    res.json({
      success: true,
      previews: previews
    });

  } catch (error) {
    log(`Rename preview error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/matcher/execute-rename
 * Execute file rename operations with SSE progress
 */
app.post('/api/matcher/execute-rename', async (req, res) => {
  log('=== EXECUTE RENAME REQUEST ===', 'INFO');

  const { renameItems, dryRun = true, cleanupEmptyDirs = true } = req.body;

  if (!renameItems || !Array.isArray(renameItems)) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid renameItems array'
    });
  }

  log(`Executing rename for ${renameItems.length} files (dryRun: ${dryRun}, cleanupEmptyDirs: ${cleanupEmptyDirs})`, 'INFO');

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const results = await executeRename(renameItems, dryRun, cleanupEmptyDirs, (progress) => {
      // Send progress updates via SSE
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        ...progress
      })}\n\n`);
    });

    // Calculate statistics
    const successCount = results.filter(r => r.status === 'success' || r.status === 'success_dry_run').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;

    // Send completion message
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      results: results,
      summary: {
        total: results.length,
        success: successCount,
        errors: errorCount,
        skipped: skippedCount
      },
      message: dryRun
        ? `[DRY RUN] Preview complete: ${successCount} files would be renamed`
        : `Rename complete: ${successCount} files renamed successfully, ${errorCount} errors`
    })}\n\n`);

    res.end();
    log(`Rename execution complete: ${successCount} success, ${errorCount} errors, ${skippedCount} skipped`, 'INFO');

  } catch (error) {
    log(`Execute rename error: ${error.message}`, 'ERROR');
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
});

// ========================================
// ORGANIZER ENDPOINTS (Phase 4)
// ========================================

/**
 * POST /api/organizer/rename-artists
 * Rename artist folders based on Phase 1 matching results
 */
app.post('/api/organizer/rename-artists', async (req, res) => {
  log('=== RENAME ARTISTS REQUEST ===', 'INFO');

  const { musicPath, renames } = req.body;

  if (!musicPath || !renames || !Array.isArray(renames)) {
    return res.status(400).json({
      success: false,
      error: 'Missing musicPath or renames array'
    });
  }

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { updateArtistMetadata } = await import('./modules/organizer/metadata-updater.js');

    let renamedCount = 0;
    let metadataUpdatedCount = 0;
    const errors = [];

    for (const rename of renames) {
      // CRITICAL: Use folderName (actual folder on disk), not originalArtist (metadata name)
      const folderToRename = rename.folderName || rename.originalArtist;
      const oldPath = path.join(musicPath, folderToRename);
      const newPath = path.join(musicPath, rename.newArtist);

      log(`Attempting rename: "${folderToRename}" → "${rename.newArtist}"`, 'DEBUG');

      try {
        // Check if old path exists
        await fs.access(oldPath);

        let folderRenamed = false;
        let targetPath = oldPath;

        // Check if rename is needed (folder name different from new artist name)
        if (folderToRename !== rename.newArtist) {
          // Check if new path already exists
          try {
            await fs.access(newPath);
            log(`Target folder already exists: ${newPath}`, 'WARN');
            errors.push(`${rename.newArtist} folder already exists`);
            continue;
          } catch {
            // New path doesn't exist - good!
          }

          // Perform rename
          await fs.rename(oldPath, newPath);
          log(`Renamed folder: ${oldPath} → ${newPath}`, 'INFO');
          renamedCount++;
          folderRenamed = true;
          targetPath = newPath;
        } else {
          // Folder name is already correct, but metadata may still need updating
          log(`Folder name already correct: ${folderToRename}`, 'DEBUG');
          targetPath = oldPath; // Use existing path for metadata update
        }

        // Update metadata in all files within the folder (even if folder wasn't renamed)
        try {
          const updated = await updateArtistMetadata(targetPath, rename.newArtist);
          metadataUpdatedCount += updated;
          log(`Updated metadata in ${updated} files`, 'INFO');
        } catch (metaError) {
          log(`Failed to update metadata: ${metaError.message}`, 'WARN');
          errors.push(`${rename.newArtist}: metadata update failed - ${metaError.message}`);
        }
      } catch (error) {
        log(`Rename error for ${folderToRename}: ${error.message}`, 'ERROR');
        errors.push(`${folderToRename}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      renamedCount,
      metadataUpdatedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `Renamed ${renamedCount} artist folder(s), updated metadata in ${metadataUpdatedCount} files`
    });
  } catch (error) {
    log(`Artist rename error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/organizer/rename-albums
 * Rename album folders based on Phase 2 matching results
 */
app.post('/api/organizer/rename-albums', async (req, res) => {
  log('=== RENAME ALBUMS REQUEST ===', 'INFO');

  const { musicPath, renames } = req.body;

  if (!musicPath || !renames || !Array.isArray(renames)) {
    return res.status(400).json({
      success: false,
      error: 'Missing musicPath or renames array'
    });
  }

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { updateAlbumMetadata, updateArtistMetadata } = await import('./modules/organizer/metadata-updater.js');

    let renamedCount = 0;
    let metadataUpdatedCount = 0;
    const errors = [];

    for (const rename of renames) {
      // Use actual folder names for the rename operation
      const artistFolder = rename.folderArtist || rename.originalArtist;
      const albumFolder = rename.folderAlbum || rename.originalAlbum;
      const oldPath = path.join(musicPath, artistFolder, albumFolder);
      const newArtistFolder = rename.newArtist;
      const newAlbumFolder = rename.newAlbum;
      const newPath = path.join(musicPath, newArtistFolder, newAlbumFolder);

      log(`Attempting album rename: "${artistFolder}/${albumFolder}" → "${newArtistFolder}/${newAlbumFolder}"`, 'DEBUG');

      try {
        // Check if old path exists
        await fs.access(oldPath);

        // Ensure new artist folder exists
        const newArtistPath = path.join(musicPath, newArtistFolder);
        try {
          await fs.access(newArtistPath);
        } catch {
          // Create new artist folder if it doesn't exist
          await fs.mkdir(newArtistPath, { recursive: true });
          log(`Created artist folder: ${newArtistPath}`, 'INFO');
        }

        // Check if rename is needed (old path !== new path)
        const needsRename = oldPath !== newPath;
        let targetPath = newPath;

        if (needsRename) {
          // Check if new album path already exists
          try {
            await fs.access(newPath);
            log(`Target album folder already exists: ${newPath}`, 'WARN');
            errors.push(`${newArtistFolder}/${newAlbumFolder} folder already exists`);
            continue;
          } catch {
            // New path doesn't exist - good!
          }

          // Perform rename
          await fs.rename(oldPath, newPath);
          log(`Renamed album folder: ${oldPath} → ${newPath}`, 'INFO');
          renamedCount++;
        } else {
          // No rename needed - folder already has correct name
          log(`Album folder already correct: ${newPath}`, 'INFO');
          targetPath = oldPath; // Use existing path for metadata update
        }

        // Update metadata in all files (whether renamed or not)
        try {
          // Update both artist and album metadata for all tracks
          const artistUpdated = await updateArtistMetadata(targetPath, rename.newArtist);
          const albumUpdated = await updateAlbumMetadata(targetPath, rename.newAlbum);

          metadataUpdatedCount += Math.max(artistUpdated, albumUpdated); // Avoid double-counting same files
          log(`Updated metadata in ${Math.max(artistUpdated, albumUpdated)} files (artist + album tags)`, 'INFO');
        } catch (metaError) {
          log(`Failed to update metadata: ${metaError.message}`, 'WARN');
          errors.push(`${newArtistFolder}/${newAlbumFolder}: metadata update failed - ${metaError.message}`);
        }

        // If artist also changed, try to clean up old artist folder if empty
        if (artistFolder !== newArtistFolder) {
          try {
            const oldArtistPath = path.join(musicPath, artistFolder);
            const remainingContents = await fs.readdir(oldArtistPath);
            if (remainingContents.length === 0) {
              await fs.rmdir(oldArtistPath);
              log(`Removed empty artist folder: ${oldArtistPath}`, 'INFO');
            }
          } catch (cleanupError) {
            log(`Could not clean up old artist folder: ${cleanupError.message}`, 'DEBUG');
          }
        }
      } catch (error) {
        log(`Rename error for ${artistFolder}/${albumFolder}: ${error.message}`, 'ERROR');
        errors.push(`${artistFolder}/${albumFolder}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      renamedCount,
      metadataUpdatedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `Renamed ${renamedCount} album folder(s), updated metadata in ${metadataUpdatedCount} files`
    });
  } catch (error) {
    log(`Album rename error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/organizer/validate-path
 * Validate that a path exists and is writable
 */
app.post('/api/organizer/validate-path', async (req, res) => {
  log('=== VALIDATE PATH REQUEST ===', 'INFO');

  const { path: dirPath } = req.body;

  if (!dirPath) {
    return res.status(400).json({
      success: false,
      error: 'Path is required'
    });
  }

  try {
    validatePath(dirPath);
    const writable = await isPathWritable(dirPath);

    res.json({
      success: true,
      exists: true,
      writable,
      message: writable ? 'Path is valid and writable' : 'Path exists but is not writable'
    });
  } catch (error) {
    log(`Path validation error: ${error.message}`, 'ERROR');
    res.json({
      success: false,
      exists: false,
      writable: false,
      error: error.message
    });
  }
});

/**
 * POST /api/organizer/plan-move
 * Plan move operations with quality checks
 */
app.post('/api/organizer/plan-move', async (req, res) => {
  log('=== PLAN MOVE REQUEST ===', 'INFO');

  const { files, liveLibraryPath, plexTracks, mode = 'copy' } = req.body;

  if (!files || !Array.isArray(files)) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid files array'
    });
  }

  if (!liveLibraryPath) {
    return res.status(400).json({
      success: false,
      error: 'Missing live library path'
    });
  }

  try {
    // Validate path
    validatePath(liveLibraryPath);
    const writable = await isPathWritable(liveLibraryPath);

    if (!writable) {
      return res.status(400).json({
        success: false,
        error: 'Live library path is not writable'
      });
    }

    log(`Planning move for ${files.length} files (mode: ${mode})`, 'INFO');

    const plan = planMoveOperations(files, liveLibraryPath, plexTracks, mode);

    log(`Move plan: ${plan.summary.newFiles} new, ${plan.summary.upgrades} upgrades, ${plan.summary.downgrades} downgrades`, 'INFO');

    res.json({
      success: true,
      plan
    });

  } catch (error) {
    log(`Plan move error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/organizer/execute-move
 * Execute move operations with SSE progress
 */
app.post('/api/organizer/execute-move', async (req, res) => {
  log('=== EXECUTE MOVE REQUEST ===', 'INFO');

  const { operations, dryRun = true, cleanupEmptyDirs = true } = req.body;

  if (!operations || !Array.isArray(operations)) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid operations array'
    });
  }

  log(`Executing move for ${operations.length} operations (dryRun: ${dryRun}, cleanupEmptyDirs: ${cleanupEmptyDirs})`, 'INFO');

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const results = await executeMoveOperations(operations, dryRun, cleanupEmptyDirs, (progress) => {
      // Send progress updates via SSE
      res.write(`data: ${JSON.stringify({
        type: 'progress',
        ...progress
      })}\n\n`);
    });

    // Calculate statistics
    const successCount = results.filter(r => r.status === 'success' || r.status === 'success_dry_run').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const skippedCount = results.filter(r => r.status === 'skipped').length;

    // Send completion message
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      results: results,
      summary: {
        total: results.length,
        success: successCount,
        errors: errorCount,
        skipped: skippedCount
      },
      message: dryRun
        ? `[DRY RUN] Preview complete: ${successCount} files would be moved`
        : `Move complete: ${successCount} files moved successfully, ${errorCount} errors`
    })}\n\n`);

    res.end();
    log(`Move execution complete: ${successCount} success, ${errorCount} errors, ${skippedCount} skipped`, 'INFO');

  } catch (error) {
    log(`Execute move error: ${error.message}`, 'ERROR');
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error.message
    })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/organizer/rollback
 * Rollback last move operation
 */
app.post('/api/organizer/rollback', async (req, res) => {
  log('=== ROLLBACK REQUEST ===', 'INFO');

  try {
    const results = await rollbackLastOperation();

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    log(`Rollback complete: ${successCount} operations restored, ${failedCount} failed`, 'INFO');

    res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        restored: successCount,
        failed: failedCount
      },
      message: `Rollback complete: ${successCount} operations restored`
    });

  } catch (error) {
    log(`Rollback error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/organizer/plex-library-path
 * Get filesystem path for a Plex library
 */
app.post('/api/organizer/plex-library-path', async (req, res) => {
  log('=== PLEX LIBRARY PATH REQUEST ===', 'INFO');

  const { serverIp, port, token, libraryId } = req.body;

  if (!serverIp || !port || !token || !libraryId) {
    return res.status(400).json({
      success: false,
      error: 'Server IP, port, token, and library ID are required'
    });
  }

  try {
    const { getLibraryDetails } = await import('./modules/organizer/plex.js');
    const libraryDetails = await getLibraryDetails(serverIp, port, token, libraryId);

    log(`Library path fetched: ${libraryDetails.primaryPath}`, 'INFO');

    res.json({
      success: true,
      ...libraryDetails
    });

  } catch (error) {
    log(`Plex library path error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/organizer/plex-refresh
 * Trigger Plex library refresh
 */
app.post('/api/organizer/plex-refresh', async (req, res) => {
  log('=== PLEX REFRESH REQUEST ===', 'INFO');

  const { serverIp, port, token, libraryId } = req.body;

  if (!serverIp || !port || !token || !libraryId) {
    return res.status(400).json({
      success: false,
      error: 'Server IP, port, token, and library ID are required'
    });
  }

  try {
    const result = await triggerPlexRefresh(serverIp, port, token, libraryId);

    log('Plex library refresh triggered successfully', 'INFO');

    res.json(result);

  } catch (error) {
    log(`Plex refresh error: ${error.message}`, 'ERROR');
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
