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
import { fetchPlexTracksWithRatings, detectLowQuality, isAlreadyUpgraded, searchYouTubeMusicForTrack, downloadAndReplace, getUpgradeStats, initUpgradeDatabase } from './modules/organizer/upgrader.js';
import { askClaudeCustom } from './modules/organizer/ai-engine.js';
import artistRadar from './modules/organizer/artist-radar.js';
import simpleOrganizer from './modules/organizer/simple-organizer.js';

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
// Disable caching for static files during development
app.use(express.static('public', {
    maxAge: 0,
    etag: false,
    lastModified: false
}));

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
      '--output', path.join(outputPath, '%(album_artist,artist)s/%(album)s/%(title)s.%(ext)s'),
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

          // Post-process: Add ALBUMARTIST tag to all FLAC files
          // YouTube Music doesn't provide ALBUMARTIST, but Plex needs it to avoid "Various Artists"
          // Use the artist folder name as ALBUMARTIST (folder structure: Artist/Album/track.flac)
          sendProgress({ status: 'Post-processing: Adding ALBUMARTIST tags for Plex compatibility...', progress: 98 });
          const flacFiles = await fg('**/*.flac', { cwd: outputPath, absolute: true });
          let albumArtistUpdated = 0;

          for (const flacFile of flacFiles) {
            try {
              const relativePath = path.relative(outputPath, flacFile);
              const pathParts = relativePath.split(path.sep);

              // Only process files in Artist/Album/track.flac structure
              if (pathParts.length >= 2) {
                const artistFolder = pathParts[0]; // The artist folder name is the album artist

                // Use spawn to avoid shell escaping issues
                const { spawn: spawnSync } = await import('child_process');
                await new Promise((resolve, reject) => {
                  const proc = spawnSync('metaflac', [`--set-tag=ALBUMARTIST=${artistFolder}`, flacFile], {
                    stdio: ['ignore', 'pipe', 'pipe']
                  });
                  proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`metaflac exit ${code}`)));
                  proc.on('error', reject);
                });
                albumArtistUpdated++;
              }
            } catch (metaErr) {
              log(`Failed to add ALBUMARTIST to ${path.basename(flacFile)}: ${metaErr.message}`, 'WARN');
            }
          }

          if (albumArtistUpdated > 0) {
            log(`Added ALBUMARTIST tag to ${albumArtistUpdated} files for Plex compatibility`, 'INFO');
          }

          // Remove NA folder ONLY if it exists and is truly empty
          // IMPORTANT: Never delete if it contains files - they may have artist info in filenames
          const naFolder = path.join(outputPath, 'NA');
          if (await fs.access(naFolder).then(() => true).catch(() => false)) {
            try {
              // Check if folder is actually empty before deleting
              const naContents = await fs.readdir(naFolder);
              if (naContents.length === 0) {
                await fs.rmdir(naFolder);
                log('Cleaned up empty NA folder', 'DEBUG');
              } else {
                log(`NA folder contains ${naContents.length} items - preserving for manual processing`, 'INFO');
              }
            } catch (err) {
              log(`Could not check/remove NA folder: ${err.message}`, 'DEBUG');
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

    // Placeholder folders that should be handled specially (move files individually, not rename folder)
    const PLACEHOLDER_FOLDERS = ['NA', 'Unknown Artist', 'Unknown', 'Various Artists', 'N/A'];

    let renamedCount = 0;
    let metadataUpdatedCount = 0;
    let filesMoved = 0;
    const errors = [];

    // Group renames by source folder to detect placeholder folders with multiple artists
    const renamesByFolder = {};
    for (const rename of renames) {
      const folderName = rename.folderName || rename.originalArtist;
      if (!renamesByFolder[folderName]) {
        renamesByFolder[folderName] = [];
      }
      renamesByFolder[folderName].push(rename);
    }

    for (const rename of renames) {
      // CRITICAL: Use folderName (actual folder on disk), not originalArtist (metadata name)
      const folderToRename = rename.folderName || rename.originalArtist;
      const oldPath = path.join(musicPath, folderToRename);
      const newPath = path.join(musicPath, rename.newArtist);

      // Check if this is a placeholder folder
      const isPlaceholderFolder = PLACEHOLDER_FOLDERS.includes(folderToRename);
      const hasMultipleArtists = renamesByFolder[folderToRename] && renamesByFolder[folderToRename].length > 1;

      log(`Attempting rename: "${folderToRename}" → "${rename.newArtist}" (placeholder: ${isPlaceholderFolder}, multipleArtists: ${hasMultipleArtists})`, 'DEBUG');

      try {
        // Check if old path exists
        await fs.access(oldPath);

        // SPECIAL HANDLING: Placeholder folders with multiple artists
        // Move files individually instead of renaming the folder
        if (isPlaceholderFolder && hasMultipleArtists) {
          log(`Placeholder folder "${folderToRename}" contains multiple artists - moving files individually`, 'INFO');

          // For placeholder folders, we expect files in subdirectories (like NA/NA/)
          // Scan for audio files and move them to the new artist folder
          const fg = (await import('fast-glob')).default;
          const audioFiles = await fg('**/*.{flac,mp3,m4a,aac,ogg,opus,wav}', {
            cwd: oldPath,
            absolute: false,
            onlyFiles: true
          });

          log(`Found ${audioFiles.length} audio files in placeholder folder`, 'DEBUG');

          // Helper function to extract artist from filename (format: "Artist - Track.flac")
          const extractArtistFromFilename = (filepath) => {
            const filename = path.basename(filepath, path.extname(filepath));
            const dashIndex = filename.indexOf(' - ');
            if (dashIndex > 0) {
              return filename.substring(0, dashIndex).trim();
            }
            return '';
          };

          // Filter files that belong to this artist (based on metadata or filename)
          const { parseFile } = await import('music-metadata');
          let movedForThisArtist = 0;

          for (const relativeFilePath of audioFiles) {
            const fullFilePath = path.join(oldPath, relativeFilePath);

            try {
              // Try multiple methods to determine the artist for this file
              const metadata = await parseFile(fullFilePath);
              const metadataArtist = metadata.common?.artist || '';
              const filenameArtist = extractArtistFromFilename(relativeFilePath);

              // Check if this file matches the artist we're processing
              // Priority: 1) metadata artist, 2) filename artist, 3) filename contains artist name
              const isMatch =
                (metadataArtist && metadataArtist === rename.originalArtist) ||
                (filenameArtist && filenameArtist === rename.originalArtist) ||
                (filenameArtist && filenameArtist === rename.newArtist) ||
                relativeFilePath.includes(rename.originalArtist) ||
                relativeFilePath.includes(rename.newArtist);

              if (isMatch) {
                log(`Match found! File: "${path.basename(relativeFilePath)}" | Metadata: "${metadataArtist}" | Filename: "${filenameArtist}" | Target: "${rename.newArtist}"`, 'DEBUG');

                // Create target artist folder if it doesn't exist
                const targetArtistPath = path.join(musicPath, rename.newArtist);
                await fs.mkdir(targetArtistPath, { recursive: true });

                // Move file to artist folder as a loose track
                const fileName = path.basename(fullFilePath);
                const targetFilePath = path.join(targetArtistPath, fileName);

                await fs.rename(fullFilePath, targetFilePath);
                log(`Moved file from placeholder: ${relativeFilePath} → ${rename.newArtist}/${fileName}`, 'INFO');

                // Update metadata in the moved file
                try {
                  await updateArtistMetadata(targetFilePath, rename.newArtist, { isSingleFile: true });
                  metadataUpdatedCount++;
                } catch (metaError) {
                  log(`Failed to update metadata for ${fileName}: ${metaError.message}`, 'WARN');
                }

                movedForThisArtist++;
                filesMoved++;
              }
            } catch (fileError) {
              log(`Error processing file ${relativeFilePath}: ${fileError.message}`, 'WARN');
            }
          }

          log(`Moved ${movedForThisArtist} files for artist "${rename.newArtist}"`, 'INFO');
          continue; // Skip normal folder rename logic
        }

        // NORMAL HANDLING: Regular folders or placeholder folders with single artist
        let folderRenamed = false;
        let targetPath = oldPath;

        // Check if rename is needed (folder name different from new artist name)
        if (folderToRename !== rename.newArtist) {
          // Check if new path already exists
          let targetExists = false;
          try {
            await fs.access(newPath);
            targetExists = true;
          } catch {
            // New path doesn't exist
          }

          if (targetExists) {
            // TARGET EXISTS: Merge contents instead of renaming
            log(`Target folder "${rename.newArtist}" already exists - merging contents from "${folderToRename}"`, 'INFO');

            try {
              // Get all subdirectories (albums) in the source folder
              const sourceEntries = await fs.readdir(oldPath, { withFileTypes: true });
              let mergedCount = 0;

              for (const entry of sourceEntries) {
                const sourcePath = path.join(oldPath, entry.name);
                const destPath = path.join(newPath, entry.name);

                if (entry.isDirectory()) {
                  // Check if album folder already exists in target
                  let albumExists = false;
                  try {
                    await fs.access(destPath);
                    albumExists = true;
                  } catch {
                    // Album doesn't exist in target - can move directly
                  }

                  if (albumExists) {
                    // Album folder exists - need to merge files inside
                    log(`Album "${entry.name}" exists in both folders - merging files`, 'INFO');
                    const albumFiles = await fs.readdir(sourcePath, { withFileTypes: true });
                    for (const file of albumFiles) {
                      if (file.isFile()) {
                        const sourceFile = path.join(sourcePath, file.name);
                        let destFile = path.join(destPath, file.name);

                        // Check if file exists and add suffix if needed
                        try {
                          await fs.access(destFile);
                          // File exists - add suffix
                          const ext = path.extname(file.name);
                          const baseName = path.basename(file.name, ext);
                          destFile = path.join(destPath, `${baseName}_merged${ext}`);
                          log(`File conflict - renaming to: ${path.basename(destFile)}`, 'WARN');
                        } catch {
                          // File doesn't exist - good
                        }

                        await fs.rename(sourceFile, destFile);
                        mergedCount++;
                      }
                    }

                    // Try to remove the now-empty album folder in source
                    try {
                      await fs.rmdir(sourcePath);
                      log(`Removed empty album folder: ${entry.name}`, 'DEBUG');
                    } catch {
                      // Folder not empty or other error - leave it
                    }
                  } else {
                    // Move entire album folder to target
                    await fs.rename(sourcePath, destPath);
                    log(`Moved album folder: ${entry.name}`, 'INFO');
                    mergedCount++;
                  }
                } else if (entry.isFile()) {
                  // Move loose files directly
                  let destFile = destPath;
                  try {
                    await fs.access(destFile);
                    const ext = path.extname(entry.name);
                    const baseName = path.basename(entry.name, ext);
                    destFile = path.join(newPath, `${baseName}_merged${ext}`);
                  } catch {
                    // File doesn't exist - good
                  }
                  await fs.rename(sourcePath, destFile);
                  mergedCount++;
                }
              }

              // Try to remove the now-empty source folder
              try {
                await fs.rmdir(oldPath);
                log(`Removed empty source folder: ${folderToRename}`, 'INFO');
              } catch (rmErr) {
                log(`Could not remove source folder (may not be empty): ${rmErr.message}`, 'WARN');
              }

              log(`Merged ${mergedCount} items from "${folderToRename}" into "${rename.newArtist}"`, 'INFO');
              targetPath = newPath;
              renamedCount++; // Count as a successful operation

            } catch (mergeError) {
              log(`Merge failed: ${mergeError.message}`, 'ERROR');
              errors.push(`${folderToRename}: merge failed - ${mergeError.message}`);
              continue;
            }
          } else {
            // TARGET DOESN'T EXIST: Simple rename
            await fs.rename(oldPath, newPath);
            log(`Renamed folder: ${oldPath} → ${newPath}`, 'INFO');
            renamedCount++;
            folderRenamed = true;
            targetPath = newPath;
          }
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
 * Returns SSE stream for real-time progress updates
 */
app.post('/api/organizer/rename-albums', async (req, res) => {
  log('=== RENAME ALBUMS REQUEST (SSE) ===', 'INFO');

  const { musicPath, renames } = req.body;

  if (!musicPath || !renames || !Array.isArray(renames)) {
    return res.status(400).json({
      success: false,
      error: 'Missing musicPath or renames array'
    });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Helper to send SSE events
  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { updateTrackMetadata } = await import('./modules/organizer/metadata-updater.js');
    const { parseFile } = await import('music-metadata');
    const fg = (await import('fast-glob')).default;

    let renamedCount = 0;
    let metadataUpdatedCount = 0;
    let trackFilesRenamed = 0;
    const errors = [];
    const totalAlbums = renames.length;

    // Send initial progress
    sendProgress({
      type: 'start',
      totalAlbums,
      message: `Starting to process ${totalAlbums} album(s)...`
    });

    // Helper: Sanitize filename (remove invalid characters)
    const sanitizeFilename = (str) => {
      if (!str) return '';
      return str
        .replace(/[/\\:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/\.+$/g, '')
        .trim();
    };

    for (let albumIndex = 0; albumIndex < renames.length; albumIndex++) {
      const rename = renames[albumIndex];
      // Use actual folder names for the rename operation
      const artistFolder = rename.folderArtist || rename.originalArtist;
      const albumFolder = rename.folderAlbum || rename.originalAlbum;

      // Handle loose albums (albums not under an artist folder)
      // If artistFolder is null/undefined/empty, album is at root level
      const isLooseAlbum = !artistFolder || artistFolder === '';
      const oldPath = isLooseAlbum
        ? path.join(musicPath, albumFolder)  // Loose album at root
        : path.join(musicPath, artistFolder, albumFolder);  // Normal: under artist folder

      const newArtistFolder = rename.newArtist;
      const newAlbumFolder = rename.newAlbum;
      const newPath = path.join(musicPath, newArtistFolder, newAlbumFolder);

      const displayOldPath = isLooseAlbum ? albumFolder : `${artistFolder}/${albumFolder}`;
      log(`Attempting album ${isLooseAlbum ? 'move' : 'rename'}: "${displayOldPath}" → "${newArtistFolder}/${newAlbumFolder}"`, 'DEBUG');

      // Send album progress
      sendProgress({
        type: 'album',
        current: albumIndex + 1,
        total: totalAlbums,
        artist: newArtistFolder,
        album: newAlbumFolder,
        phase: 'starting',
        message: `Processing album ${albumIndex + 1}/${totalAlbums}: ${newArtistFolder} - ${newAlbumFolder}`
      });

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
        // Check if it's just a case change (same path case-insensitively)
        const isCaseChangeOnly = needsRename && oldPath.toLowerCase() === newPath.toLowerCase();
        let targetPath = newPath;

        if (needsRename) {
          if (isCaseChangeOnly) {
            // Case change on macOS: rename via temp folder to work around case-insensitive filesystem
            const tempPath = oldPath + '_temp_rename_' + Date.now();
            await fs.rename(oldPath, tempPath);
            await fs.rename(tempPath, newPath);
            log(`Renamed album folder (case change): ${oldPath} → ${newPath}`, 'INFO');
            renamedCount++;
          } else {
            // Check if new album path already exists (different folder)
            try {
              await fs.access(newPath);
              // Check if it's actually the same folder we're trying to rename
              // (this can happen on case-insensitive filesystems)
              const oldStat = await fs.stat(oldPath).catch(() => null);
              const newStat = await fs.stat(newPath).catch(() => null);

              if (oldStat && newStat && oldStat.ino === newStat.ino) {
                // Same inode - it's the same folder, just different case
                // Rename via temp folder
                const tempPath = oldPath + '_temp_rename_' + Date.now();
                await fs.rename(oldPath, tempPath);
                await fs.rename(tempPath, newPath);
                log(`Renamed album folder (same inode): ${oldPath} → ${newPath}`, 'INFO');
                renamedCount++;
              } else {
                // Actually different folder - can't overwrite, but still process source folder
                log(`Target album folder already exists (different folder): ${newPath}`, 'WARN');
                log(`Will still update metadata and rename tracks in source folder: ${oldPath}`, 'INFO');
                // Update the SOURCE folder since we can't move/merge to target
                targetPath = oldPath;
              }
            } catch {
              // New path doesn't exist - good! Perform normal rename
              await fs.rename(oldPath, newPath);
              log(`Renamed album folder: ${oldPath} → ${newPath}`, 'INFO');
              renamedCount++;
            }
          }
        } else {
          // No rename needed - folder already has correct name
          log(`Album folder already correct: ${newPath}`, 'INFO');
          targetPath = oldPath; // Use existing path for metadata update
        }

        // Process track files: rename based on title metadata and update metadata if needed
        try {
          const audioFiles = await fg('**/*.{flac,mp3,m4a,aac,ogg,opus,wav}', {
            cwd: targetPath,
            absolute: true,
            onlyFiles: true
          });

          const totalTracks = audioFiles.length;
          log(`Found ${totalTracks} audio files to potentially rename in ${targetPath}`, 'DEBUG');

          // Send progress: starting track processing
          sendProgress({
            type: 'album',
            current: albumIndex + 1,
            total: totalAlbums,
            artist: newArtistFolder,
            album: newAlbumFolder,
            phase: 'tracks',
            trackCount: totalTracks,
            message: `Processing ${totalTracks} track(s): ${newArtistFolder} - ${newAlbumFolder}`
          });

          for (let trackIndex = 0; trackIndex < audioFiles.length; trackIndex++) {
            const filePath = audioFiles[trackIndex];
            try {
              // Read metadata from file
              const metadata = await parseFile(filePath);
              const title = metadata.common?.title;
              const trackNum = metadata.common?.track?.no;
              const currentArtist = metadata.common?.artist;
              const currentAlbumArtist = metadata.common?.albumartist;
              const currentAlbum = metadata.common?.album;

              if (!title) {
                log(`Skipping file without title metadata: ${path.basename(filePath)}`, 'DEBUG');
                continue;
              }

              // Build new filename: "01 - Title.ext" or "Title.ext" if no track number
              const ext = path.extname(filePath);
              const sanitizedTitle = sanitizeFilename(title);
              const newFilename = trackNum
                ? `${String(trackNum).padStart(2, '0')} - ${sanitizedTitle}${ext}`
                : `${sanitizedTitle}${ext}`;
              const newFilePath = path.join(path.dirname(filePath), newFilename);

              // Track the final path for metadata update (may be original or renamed)
              let finalFilePath = filePath;
              let wasRenamed = false;

              // Rename file if filename is different
              if (filePath !== newFilePath) {
                // Check if target already exists
                try {
                  await fs.access(newFilePath);
                  log(`Target file already exists, skipping rename: ${newFilename}`, 'WARN');
                  // Don't rename, but still update metadata on the original file
                } catch {
                  // Target doesn't exist - good! Rename the file
                  await fs.rename(filePath, newFilePath);
                  log(`Renamed track file: ${path.basename(filePath)} → ${newFilename}`, 'INFO');
                  trackFilesRenamed++;
                  finalFilePath = newFilePath;
                  wasRenamed = true;
                }
              }

              // Check if metadata needs updating (skip if already correct)
              const artistNeedsUpdate = currentArtist !== rename.newArtist;
              const albumArtistNeedsUpdate = currentAlbumArtist !== rename.newArtist;
              const albumNeedsUpdate = currentAlbum !== rename.newAlbum;
              const needsMetadataUpdate = artistNeedsUpdate || albumArtistNeedsUpdate || albumNeedsUpdate;

              if (needsMetadataUpdate) {
                try {
                  await updateTrackMetadata(finalFilePath, {
                    title: title,
                    artist: rename.newArtist,
                    albumArtist: rename.newArtist,
                    album: rename.newAlbum,
                    track: trackNum || null
                  });
                  log(`Updated track metadata: ${path.basename(finalFilePath)}`, 'DEBUG');
                } catch (trackMetaErr) {
                  log(`Failed to update track metadata: ${trackMetaErr.message}`, 'WARN');
                }
              } else if (!wasRenamed) {
                log(`Skipping ${path.basename(finalFilePath)} - filename and metadata already correct`, 'DEBUG');
              }
            } catch (fileError) {
              log(`Error processing track file ${path.basename(filePath)}: ${fileError.message}`, 'WARN');
            }
          }
        } catch (trackRenameError) {
          log(`Failed to rename track files: ${trackRenameError.message}`, 'WARN');
          errors.push(`${newArtistFolder}/${newAlbumFolder}: track file rename failed - ${trackRenameError.message}`);
        }

        // If artist also changed (and not a loose album), try to clean up old artist folder if empty
        // IMPORTANT: Never delete placeholder folders like "NA", "Unknown Artist", etc. - they may contain unprocessed files
        const placeholderFolders = ['NA', 'Unknown Artist', 'Unknown', 'Various Artists', 'N/A'];
        const isPlaceholderFolder = placeholderFolders.includes(artistFolder);

        if (!isLooseAlbum && !isPlaceholderFolder && artistFolder !== newArtistFolder) {
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
        } else if (isPlaceholderFolder) {
          log(`Skipping cleanup of placeholder folder: ${artistFolder} (may contain unprocessed files)`, 'DEBUG');
        }
      } catch (error) {
        log(`${isLooseAlbum ? 'Move' : 'Rename'} error for ${displayOldPath}: ${error.message}`, 'ERROR');
        errors.push(`${displayOldPath}: ${error.message}`);
      }
    }

    // Send completion event
    sendProgress({
      type: 'complete',
      success: true,
      renamedCount,
      metadataUpdatedCount,
      trackFilesRenamed,
      errors: errors.length > 0 ? errors : undefined,
      message: `Renamed ${renamedCount} album folder(s), ${trackFilesRenamed} track file(s), updated metadata in ${metadataUpdatedCount} files`
    });
    res.end();
  } catch (error) {
    log(`Album rename error: ${error.message}`, 'ERROR');
    // Send error event
    sendProgress({
      type: 'error',
      success: false,
      error: error.message
    });
    res.end();
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

/**
 * POST /api/organizer/ask-claude
 * Custom Claude AI query for user prompts
 */
app.post('/api/organizer/ask-claude', async (req, res) => {
  log('=== ASK CLAUDE REQUEST ===', 'INFO');

  const { entityType, entityName, userPrompt, files } = req.body;

  if (!entityType || !entityName || !userPrompt) {
    return res.status(400).json({
      success: false,
      error: 'Entity type, name, and user prompt are required'
    });
  }

  if (entityType !== 'artist' && entityType !== 'album') {
    return res.status(400).json({
      success: false,
      error: 'Entity type must be "artist" or "album"'
    });
  }

  try {
    log(`Asking Claude about ${entityType}: "${entityName}"`, 'INFO');
    log(`User prompt: "${userPrompt}"`, 'DEBUG');

    const result = await askClaudeCustom(entityType, entityName, userPrompt, files || []);

    log('Claude response received', 'INFO');

    // Handle failed Claude response (e.g., timeout)
    if (!result.success) {
      return res.json({
        success: false,
        error: result.analysis || 'Claude failed to respond'
      });
    }

    // Wrap the result so frontend can access data.result.analysis
    res.json({
      success: true,
      result: {
        analysis: result.analysis,
        suggested: result.suggested,
        confidence: result.confidence
      }
    });

  } catch (error) {
    log(`Ask Claude error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ========================================
 * PHASE 5: YOUTUBE MUSIC QUALITY UPGRADE ENGINE
 * ========================================
 */

// Initialize upgrade database on startup
initUpgradeDatabase();

/**
 * POST /api/upgrader/fetch-rated-tracks
 * Fetch tracks with ratings from Plex (SSE stream)
 */
app.post('/api/upgrader/fetch-rated-tracks', async (req, res) => {
  log('=== FETCH RATED TRACKS REQUEST ===', 'INFO');

  const { serverIp, port, token, libraryId, minRating } = req.body;

  if (!serverIp || !port || !token || !libraryId) {
    return res.status(400).json({
      success: false,
      error: 'Server IP, port, token, and library ID are required'
    });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const ratedTracks = await fetchPlexTracksWithRatings(
      serverIp,
      port,
      token,
      libraryId,
      minRating || 4,
      sendProgress
    );

    res.end();

  } catch (error) {
    log(`Fetch rated tracks error: ${error.message}`, 'ERROR');
    sendProgress({
      status: 'Error fetching rated tracks',
      error: error.message,
      completed: true
    });
    res.end();
  }
});

/**
 * POST /api/upgrader/detect
 * Detect low-quality upgrade candidates
 */
app.post('/api/upgrader/detect', async (req, res) => {
  log('=== DETECT UPGRADE CANDIDATES REQUEST ===', 'INFO');

  const { tracks } = req.body;

  if (!tracks || !Array.isArray(tracks)) {
    return res.status(400).json({
      success: false,
      error: 'Tracks array is required'
    });
  }

  try {
    const candidates = detectLowQuality(tracks);

    // Filter out already upgraded tracks
    const newCandidates = candidates.filter(track => !isAlreadyUpgraded(track.filePath));

    log(`Detected ${newCandidates.length} new upgrade candidates (${candidates.length - newCandidates.length} already upgraded)`, 'INFO');

    res.json({
      success: true,
      candidates: newCandidates,
      alreadyUpgraded: candidates.length - newCandidates.length
    });

  } catch (error) {
    log(`Detect candidates error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/upgrader/search-youtube
 * Search YouTube Music for a track
 */
app.post('/api/upgrader/search-youtube', async (req, res) => {
  log('=== YOUTUBE MUSIC SEARCH REQUEST ===', 'INFO');

  const { track, cookies, poToken, useMusicBrainz } = req.body;

  if (!track) {
    return res.status(400).json({
      success: false,
      error: 'Track data is required'
    });
  }

  try {
    const result = await searchYouTubeMusicForTrack(
      track,
      cookies,
      poToken,
      useMusicBrainz || false
    );

    if (result) {
      log(`Found YouTube Music match: ${result.title}`, 'INFO');
      res.json({
        success: true,
        result
      });
    } else {
      log('No YouTube Music match found', 'INFO');
      res.json({
        success: false,
        message: 'No match found on YouTube Music'
      });
    }

  } catch (error) {
    log(`YouTube Music search error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/upgrader/download-upgrade
 * Download FLAC and replace original file (SSE stream)
 */
app.post('/api/upgrader/download-upgrade', async (req, res) => {
  log('=== DOWNLOAD UPGRADE REQUEST ===', 'INFO');

  const { track, youtubeUrl, cookies, poToken } = req.body;

  log(`Track: ${track?.artist} - ${track?.title}`, 'DEBUG');
  log(`YouTube URL: ${youtubeUrl}`, 'DEBUG');
  log(`Cookies path: ${cookies || 'NOT PROVIDED'}`, 'DEBUG');
  log(`PO Token: ${poToken ? 'Provided (' + poToken.substring(0, 10) + '...)' : 'NOT PROVIDED'}`, 'DEBUG');

  if (!track || !youtubeUrl) {
    return res.status(400).json({
      success: false,
      error: 'Track data and YouTube URL are required'
    });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await downloadAndReplace(
      track,
      youtubeUrl,
      cookies,
      poToken,
      sendProgress
    );

    log(`Successfully upgraded: ${result.newPath}`, 'INFO');
    res.end();

  } catch (error) {
    log(`Download upgrade error: ${error.message}`, 'ERROR');
    sendProgress({
      status: 'Error downloading upgrade',
      error: error.message,
      completed: true,
      success: false
    });
    res.end();
  }
});

/**
 * GET /api/upgrader/stats
 * Get upgrade statistics
 */
app.get('/api/upgrader/stats', async (req, res) => {
  log('=== UPGRADE STATS REQUEST ===', 'INFO');

  try {
    const stats = getUpgradeStats();

    log(`Upgrade stats: ${stats.totalUpgrades} total, ${stats.recentUpgrades} recent`, 'INFO');

    res.json({
      success: true,
      stats
    });

  } catch (error) {
    log(`Get stats error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/radar/scan
 * Scan rated artists and build dashboard data
 */
app.post('/api/radar/scan', async (req, res) => {
  log('=== ARTIST RADAR SCAN REQUEST ===', 'INFO');

  const { serverIp, port, token, libraryKey, ratingFilter } = req.body;

  if (!serverIp || !port || !token || !libraryKey) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: serverIp, port, token, libraryKey'
    });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    artistRadar.initRadarDatabase();

    const plexConfig = { serverIp, port, token, libraryKey, ratingFilter: ratingFilter || 'all' };

    const dashboard = await artistRadar.buildDashboard(plexConfig, sendProgress);

    console.log('[Server] Dashboard returned:', {
      newReleasesCount: dashboard.newReleases.length,
      missingAlbumsCount: dashboard.missingAlbums.length
    });

    // Store results in memory for the /api/radar/results endpoint
    global.radarLastResults = {
      newReleases: dashboard.newReleases,
      missingAlbums: dashboard.missingAlbums,
      timestamp: Date.now()
    };

    // Send only counts via SSE (not the full arrays - too large!)
    const completeData = {
      type: 'complete',
      newReleasesCount: dashboard.newReleases.length,
      missingAlbumsCount: dashboard.missingAlbums.length
    };

    console.log('[Server] Sending complete event with counts:', completeData);

    sendProgress(completeData);

    res.end();

  } catch (error) {
    log(`Radar scan error: ${error.message}`, 'ERROR');
    sendProgress({
      type: 'error',
      message: error.message
    });
    res.end();
  }
});

/**
 * GET /api/radar/results
 * Get the last scan results
 */
app.get('/api/radar/results', async (req, res) => {
  log('=== GET RADAR RESULTS REQUEST ===', 'INFO');

  try {
    if (!global.radarLastResults) {
      return res.status(404).json({
        success: false,
        error: 'No scan results available. Please run a scan first.'
      });
    }

    res.json({
      success: true,
      newReleases: global.radarLastResults.newReleases,
      missingAlbums: global.radarLastResults.missingAlbums,
      timestamp: global.radarLastResults.timestamp
    });

  } catch (error) {
    log(`Get radar results error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/radar/ignored
 * Get all ignored releases
 */
app.get('/api/radar/ignored', async (req, res) => {
  log('=== GET IGNORED RELEASES REQUEST ===', 'INFO');

  try {
    artistRadar.initRadarDatabase();

    // Support compilationsOnly query parameter
    const compilationsOnly = req.query.compilationsOnly === 'true';
    const ignored = artistRadar.getIgnoredReleases(compilationsOnly);

    res.json({
      success: true,
      ignored
    });

  } catch (error) {
    log(`Get ignored releases error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/radar/ignore
 * Add a release to ignore list
 */
app.post('/api/radar/ignore', async (req, res) => {
  log('=== IGNORE RELEASE REQUEST ===', 'INFO');

  const { artistName, releaseTitle, releaseMbid, releaseType } = req.body;

  if (!artistName || !releaseTitle) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: artistName, releaseTitle'
    });
  }

  try {
    artistRadar.initRadarDatabase();
    const result = artistRadar.ignoreRelease(artistName, releaseTitle, releaseMbid, releaseType);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    log(`Ignore release error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/radar/compilations
 * Find compilation opportunities for rated artists
 */
app.post('/api/radar/compilations', async (req, res) => {
  log('=== COMPILATION OPPORTUNITIES SCAN REQUEST ===', 'INFO');

  const { serverIp, port, token, libraryKey, ratingFilter } = req.body;

  if (!serverIp || !port || !token || !libraryKey) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: serverIp, port, token, libraryKey'
    });
  }

  try {
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Fetch rated artists first
    const allRatedArtists = await artistRadar.fetchRatedArtists({ serverIp, port, token, libraryKey });

    // Apply rating filter
    let ratedArtists = allRatedArtists;
    if (ratingFilter && ratingFilter !== 'all') {
      ratedArtists = allRatedArtists.filter(artist => {
        if (ratingFilter === '5') {
          return artist.rating === 5;
        } else if (ratingFilter === '4-5') {
          return artist.rating >= 4;
        } else if (ratingFilter === '3-5') {
          return artist.rating >= 3;
        } else if (ratingFilter === '2-5') {
          return artist.rating >= 2;
        }
        return true;
      });
    }

    log(`Starting compilation scan for ${ratedArtists.length} artists`, 'INFO');

    // Send progress callback
    const progressCallback = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Find compilation opportunities
    const opportunities = await artistRadar.findCompilationOpportunities(
      { serverIp, port, token, libraryKey },
      ratedArtists,
      progressCallback
    );

    log(`Compilation scan complete: ${opportunities.length} opportunities found`, 'INFO');

    // Store results in global memory
    global.radarCompilationOpportunities = {
      opportunities,
      timestamp: Date.now()
    };

    // Send completion event
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      message: 'Compilation scan complete',
      opportunitiesCount: opportunities.length
    })}\n\n`);

    res.end();

  } catch (error) {
    log(`Compilation scan error: ${error.message}`, 'ERROR');
    res.write(`data: ${JSON.stringify({
      type: 'error',
      message: error.message
    })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/radar/compilations
 * Get the last compilation scan results
 */
app.get('/api/radar/compilations', async (req, res) => {
  log('=== GET COMPILATION OPPORTUNITIES REQUEST ===', 'INFO');

  try {
    if (!global.radarCompilationOpportunities) {
      return res.status(404).json({
        success: false,
        error: 'No compilation scan results available. Please run a scan first.'
      });
    }

    res.json({
      success: true,
      opportunities: global.radarCompilationOpportunities.opportunities,
      timestamp: global.radarCompilationOpportunities.timestamp
    });

  } catch (error) {
    log(`Get compilation opportunities error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /api/radar/ignore/:id
 * Remove a release from ignore list
 */
app.delete('/api/radar/ignore/:id', async (req, res) => {
  log('=== UNIGNORE RELEASE REQUEST ===', 'INFO');

  const id = parseInt(req.params.id);

  if (isNaN(id)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid ID'
    });
  }

  try {
    artistRadar.initRadarDatabase();
    const result = artistRadar.unignoreRelease(id);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {
    log(`Unignore release error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/radar/find-duplicates
 * Find duplicate tracks in Plex library that would be replaced by a compilation
 */
app.post('/api/radar/find-duplicates', async (req, res) => {
  log('=== FIND DUPLICATES REQUEST ===', 'INFO');

  const { serverIp, port, token, artistName, releaseMbid, releaseTitle } = req.body;

  if (!serverIp || !port || !token || !artistName || !releaseMbid) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: serverIp, port, token, artistName, releaseMbid'
    });
  }

  try {
    // Normalize server IP (convert plex.local to 127.0.0.1)
    const normalizedIp = serverIp === 'plex.local' || serverIp === 'localhost' ? '127.0.0.1' : serverIp;

    const plexConfig = {
      serverIp: normalizedIp,
      port,
      token
    };

    log(`Finding duplicates for ${artistName} - ${releaseTitle} (MBID: ${releaseMbid})`, 'INFO');

    const result = await artistRadar.findCompilationDuplicates(plexConfig, artistName, releaseMbid);

    if (result.error) {
      return res.json({
        success: false,
        error: result.error,
        compilationTracks: result.compilationTracks
      });
    }

    res.json({
      success: true,
      artist: result.artist,
      compilationTracks: result.compilationTracks,
      duplicates: result.duplicates,
      releaseTitle
    });

  } catch (error) {
    log(`Find duplicates error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/radar/delete-duplicates
 * Permanently delete duplicate files from filesystem
 */
app.post('/api/radar/delete-duplicates', async (req, res) => {
  log('=== DELETE DUPLICATES REQUEST ===', 'INFO');

  const { filePaths } = req.body;

  if (!filePaths || !Array.isArray(filePaths) || filePaths.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: filePaths (array)'
    });
  }

  try {
    log(`Deleting ${filePaths.length} duplicate files`, 'INFO');

    const result = await artistRadar.deleteDuplicateFiles(filePaths);

    res.json({
      success: true,
      deleted: result.deleted.length,
      failed: result.failed.length,
      emptyAlbumsRemoved: result.emptyAlbumsRemoved.length,
      details: result
    });

  } catch (error) {
    log(`Delete duplicates error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/radar/replace-tracks
 * Move tracks to recycle bin (for compilation replacement)
 */
app.post('/api/radar/replace-tracks', async (req, res) => {
  log('=== REPLACE TRACKS REQUEST ===', 'INFO');

  const { serverIp, port, token, trackKeys, artist, compilation } = req.body;

  if (!serverIp || !port || !token || !trackKeys || !Array.isArray(trackKeys)) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters'
    });
  }

  try {
    // Normalize server IP (convert plex.local to 127.0.0.1)
    const normalizedIp = serverIp === 'plex.local' || serverIp === 'localhost' ? '127.0.0.1' : serverIp;

    const plexConfig = {
      serverIp: normalizedIp,
      port,
      token
    };

    // Fetch file paths for all track keys
    const { fetchLibraryTracks } = await import('./modules/organizer/plex.js');

    log(`Fetching file paths for ${trackKeys.length} tracks`, 'INFO');

    const filePaths = [];
    for (const key of trackKeys) {
      try {
        // Construct Plex URL for specific track (must include Accept header for JSON)
        const trackUrl = `http://${normalizedIp}:${port}/library/metadata/${key}?X-Plex-Token=${token}`;
        log(`Fetching track metadata: ${trackUrl.replace(token, '***')}`, 'DEBUG');

        const response = await fetch(trackUrl, {
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          log(`Plex returned ${response.status} for track ${key}`, 'ERROR');
          continue;
        }

        const data = await response.json();
        log(`Plex response for ${key}: ${JSON.stringify(data).substring(0, 200)}...`, 'DEBUG');

        if (data.MediaContainer && data.MediaContainer.Metadata && data.MediaContainer.Metadata[0]) {
          const track = data.MediaContainer.Metadata[0];
          if (track.Media && track.Media[0] && track.Media[0].Part && track.Media[0].Part[0]) {
            const filePath = track.Media[0].Part[0].file;
            filePaths.push(filePath);
            log(`Found file: ${filePath}`, 'DEBUG');
          } else {
            log(`Track ${key} has no Media/Part info: ${JSON.stringify(track.Media)}`, 'WARN');
          }
        } else {
          log(`Track ${key} response missing MediaContainer/Metadata`, 'WARN');
        }
      } catch (error) {
        log(`Error fetching track ${key}: ${error.message}`, 'ERROR');
      }
    }

    if (filePaths.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No file paths found for provided track keys'
      });
    }

    log(`Deleting ${filePaths.length} files permanently`, 'INFO');

    // Permanently delete files (user has backups)
    let deletedCount = 0;
    const emptyAlbumsRemoved = [];

    for (const filePath of filePaths) {
      try {
        // Check if file exists
        await fs.access(filePath);

        // Delete the file permanently
        await fs.unlink(filePath);
        deletedCount++;
        log(`Deleted: ${filePath}`, 'INFO');

        // Check if parent album folder is now empty
        const albumFolder = path.dirname(filePath);
        try {
          const remainingFiles = await fs.readdir(albumFolder);
          const audioFiles = remainingFiles.filter(f =>
            ['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.wav'].includes(path.extname(f).toLowerCase())
          );

          if (audioFiles.length === 0) {
            // Remove empty album folder and any remaining non-audio files
            await fs.rm(albumFolder, { recursive: true });
            log(`Removed empty album folder: ${albumFolder}`, 'INFO');
            emptyAlbumsRemoved.push(albumFolder);

            // Check if artist folder is now empty
            const artistFolder = path.dirname(albumFolder);
            try {
              const remainingAlbums = await fs.readdir(artistFolder);
              if (remainingAlbums.length === 0) {
                await fs.rm(artistFolder, { recursive: true });
                log(`Removed empty artist folder: ${artistFolder}`, 'INFO');
              }
            } catch (e) {
              // Artist folder check failed, ignore
            }
          }
        } catch (e) {
          // Album folder check failed, ignore
        }
      } catch (error) {
        log(`Error deleting file: ${filePath} - ${error.message}`, 'ERROR');
      }
    }

    res.json({
      success: true,
      movedCount: deletedCount,  // Keep same name for compatibility
      deletedCount,
      emptyAlbumsRemoved: emptyAlbumsRemoved.length,
      totalRequested: trackKeys.length
    });

  } catch (error) {
    log(`Replace tracks error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * ========================================
 * PHASE 9: SIMPLE FILE ORGANIZER
 * ========================================
 */

/**
 * POST /api/simple-organize/scan
 * Scan directory and read metadata from audio files (SSE stream)
 */
app.post('/api/simple-organize/scan', async (req, res) => {
  log('=== SIMPLE ORGANIZER SCAN REQUEST ===', 'INFO');

  const { sourcePath } = req.body;

  if (!sourcePath) {
    return res.status(400).json({
      success: false,
      error: 'Source path is required'
    });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Verify source path exists
    try {
      await fs.access(sourcePath);
      log(`Source path verified: ${sourcePath}`, 'DEBUG');
    } catch (error) {
      log(`Source path does not exist: ${sourcePath}`, 'ERROR');
      sendProgress({
        type: 'error',
        error: `Source path does not exist: ${sourcePath}`
      });
      res.end();
      return;
    }

    sendProgress({
      type: 'progress',
      status: 'Starting scan...',
      progress: 0
    });

    const scanResults = await simpleOrganizer.scanDirectory(sourcePath, (progressData) => {
      sendProgress({
        type: 'progress',
        ...progressData
      });
    });

    log(`Scan complete: ${scanResults.successfulScans}/${scanResults.totalFiles} files scanned`, 'INFO');

    // Store scan results for preview generation
    global.simpleOrganizerLastScan = {
      scanResults,
      sourcePath,
      timestamp: Date.now()
    };

    sendProgress({
      type: 'complete',
      scanResults,
      message: `Scanned ${scanResults.successfulScans} files successfully`
    });

    res.end();

  } catch (error) {
    log(`Simple organizer scan error: ${error.message}`, 'ERROR');
    sendProgress({
      type: 'error',
      error: error.message
    });
    res.end();
  }
});

/**
 * POST /api/simple-organize/preview
 * Generate preview of file organization
 */
app.post('/api/simple-organize/preview', async (req, res) => {
  log('=== SIMPLE ORGANIZER PREVIEW REQUEST ===', 'INFO');

  const { files, destinationPath } = req.body;

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Files array is required'
    });
  }

  if (!destinationPath) {
    return res.status(400).json({
      success: false,
      error: 'Destination path is required'
    });
  }

  try {
    // Verify destination path exists
    try {
      await fs.access(destinationPath);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: `Destination path does not exist: ${destinationPath}`
      });
    }

    log(`Generating preview for ${files.length} files`, 'INFO');

    const preview = simpleOrganizer.previewOrganization(files, destinationPath);

    log(`Preview generated: ${preview.length} items`, 'INFO');

    res.json({
      success: true,
      preview
    });

  } catch (error) {
    log(`Preview generation error: ${error.message}`, 'ERROR');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/simple-organize/execute
 * Execute file organization with SSE progress
 */
app.post('/api/simple-organize/execute', async (req, res) => {
  log('=== SIMPLE ORGANIZER EXECUTE REQUEST ===', 'INFO');

  const { previewData, dryRun = true, mode = 'copy' } = req.body;

  if (!previewData || !Array.isArray(previewData)) {
    return res.status(400).json({
      success: false,
      error: 'Preview data array is required'
    });
  }

  log(`Executing organization for ${previewData.length} files (dryRun: ${dryRun}, mode: ${mode})`, 'INFO');

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const results = await simpleOrganizer.executeOrganization(
      previewData,
      { dryRun, mode },
      (progressData) => {
        sendProgress({
          type: 'progress',
          ...progressData
        });
      }
    );

    log(`Organization complete: ${results.summary.successful} successful, ${results.summary.failed} failed, ${results.summary.skipped} skipped`, 'INFO');

    sendProgress({
      type: 'complete',
      results: results.results,
      summary: results.summary,
      message: dryRun
        ? `[DRY RUN] Preview complete: ${results.summary.successful} files would be ${mode === 'copy' ? 'copied' : 'moved'}`
        : `Organization complete: ${results.summary.successful} files ${mode === 'copy' ? 'copied' : 'moved'} successfully`
    });

    res.end();

  } catch (error) {
    log(`Execute organization error: ${error.message}`, 'ERROR');
    sendProgress({
      type: 'error',
      error: error.message
    });
    res.end();
  }
});

app.listen(PORT, () => {
  log(`Server running on http://localhost:${PORT}`, 'INFO');
  log('Make sure yt-dlp is installed: pip install yt-dlp', 'INFO');
  log(`Debug mode: ${DEBUG ? 'ENABLED' : 'DISABLED'}`, 'INFO');
  log(`Log file: ${path.join(__dirname, 'logs', 'download-*.log')}`, 'INFO');
});
