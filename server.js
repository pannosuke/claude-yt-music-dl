import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';

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
app.use(express.json());
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

app.listen(PORT, () => {
  log(`Server running on http://localhost:${PORT}`, 'INFO');
  log('Make sure yt-dlp is installed: pip install yt-dlp', 'INFO');
  log(`Debug mode: ${DEBUG ? 'ENABLED' : 'DISABLED'}`, 'INFO');
  log(`Log file: ${path.join(__dirname, 'logs', 'download-*.log')}`, 'INFO');
});
