/**
 * YouTube Music Quality Upgrade Engine
 *
 * Fetches 4-5 star rated tracks from Plex, detects low-quality audio,
 * and upgrades them to FLAC from YouTube Music.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { parseFile } from 'music-metadata';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Quality ranking (reuse from Phase 2.5)
const CODEC_QUALITY_RANK = {
    'flac': 1000,
    'alac': 950,
    'ape': 900,
    'wav': 850,
    'aiff': 840,
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
    'm4a': (bitrate) => {
        if (bitrate >= 256) return 680;
        if (bitrate >= 192) return 580;
        if (bitrate >= 128) return 480;
        return 380;
    },
    'ogg': (bitrate) => {
        if (bitrate >= 320) return 650;
        if (bitrate >= 192) return 550;
        return 450;
    },
    'opus': (bitrate) => {
        if (bitrate >= 320) return 650;
        if (bitrate >= 192) return 550;
        return 450;
    },
    'wma': 200,
};

// Upgrade thresholds
const UPGRADE_THRESHOLDS = {
    lowQuality: {
        codecs: ['mp3', 'aac', 'm4a', 'ogg', 'opus', 'wma'],
        maxBitrate: 256  // kbps
    },
    targetQuality: {
        codecs: ['flac', 'alac'],
        minBitrate: 1000  // kbps for FLAC
    }
};

// Initialize upgrade tracking database
let upgradeDb = null;

function initUpgradeDatabase() {
    if (upgradeDb) return upgradeDb;

    const dbPath = path.join(__dirname, '../../data/upgrades.db');
    const dbDir = path.dirname(dbPath);

    // Create data directory if it doesn't exist
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    upgradeDb = new Database(dbPath);

    // Create upgrades table
    upgradeDb.exec(`
        CREATE TABLE IF NOT EXISTS upgrades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT UNIQUE,
            original_codec TEXT,
            original_bitrate INTEGER,
            new_codec TEXT,
            new_bitrate INTEGER,
            upgraded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            plex_rating INTEGER,
            youtube_url TEXT,
            plex_metadata TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_file_path ON upgrades(file_path);
        CREATE INDEX IF NOT EXISTS idx_upgraded_at ON upgrades(upgraded_at);
    `);

    // Add track_key column if it doesn't exist (migration)
    try {
        upgradeDb.exec(`ALTER TABLE upgrades ADD COLUMN track_key TEXT`);
        upgradeDb.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_track_key ON upgrades(track_key)`);
        console.log('[Upgrader] Added track_key column to upgrades table');
    } catch (error) {
        // Column already exists, ignore error
        if (!error.message.includes('duplicate column name')) {
            console.error('[Upgrader] Error adding track_key column:', error);
        }
    }

    console.log('[Upgrader] Database initialized:', dbPath);
    return upgradeDb;
}

/**
 * Calculate quality score for a file
 */
function calculateQualityScore(codec, bitrate) {
    const codecLower = codec.toLowerCase();
    const rankValue = CODEC_QUALITY_RANK[codecLower];

    if (typeof rankValue === 'function') {
        return rankValue(bitrate);
    } else if (typeof rankValue === 'number') {
        return rankValue;
    }

    return 0; // Unknown codec
}

/**
 * Normalize server IP (handle common hostnames)
 */
function normalizeServerIp(serverIp) {
    // Convert common local hostnames to 127.0.0.1
    if (serverIp === 'plex.local' || serverIp === 'localhost') {
        return '127.0.0.1';
    }
    return serverIp;
}

/**
 * Fetch tracks with ratings from Plex Media Server
 */
async function fetchPlexTracksWithRatings(serverIp, port, token, libraryId, minRating = 4, progressCallback) {
    try {
        const normalizedIp = normalizeServerIp(serverIp);
        const baseUrl = `http://${normalizedIp}:${port}`;

        if (progressCallback) {
            progressCallback({
                status: 'Fetching library info...',
                progress: 0
            });
        }

        // First request to get total count (type=10 means tracks, not albums)
        const firstUrl = `${baseUrl}/library/sections/${libraryId}/all?type=10&X-Plex-Container-Start=0&X-Plex-Container-Size=1&X-Plex-Token=${token}`;
        const firstResponse = await fetch(firstUrl, {
            headers: { 'Accept': 'application/json' }
        });

        if (!firstResponse.ok) {
            throw new Error(`Plex API error: ${firstResponse.status} ${firstResponse.statusText}`);
        }

        const firstData = await firstResponse.json();
        const totalSize = parseInt(firstData.MediaContainer?.totalSize || '0', 10);

        if (totalSize === 0) {
            throw new Error('No tracks found in library');
        }

        console.log(`[Upgrader] Total tracks in library: ${totalSize}`);

        if (progressCallback) {
            progressCallback({
                status: `Found ${totalSize} tracks in library. Fetching in batches...`,
                progress: 5
            });
        }

        // Fetch all tracks with pagination (500 per page)
        const pageSize = 500;
        const allTracks = [];

        for (let offset = 0; offset < totalSize; offset += pageSize) {
            const fetchProgress = 5 + Math.round((offset / totalSize) * 25);
            if (progressCallback) {
                progressCallback({
                    status: `Fetching tracks ${offset + 1} to ${Math.min(offset + pageSize, totalSize)} of ${totalSize}...`,
                    progress: fetchProgress
                });
            }

            const url = `${baseUrl}/library/sections/${libraryId}/all?type=10&X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${pageSize}&X-Plex-Token=${token}`;
            const response = await fetch(url, {
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Plex API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            if (data.MediaContainer && data.MediaContainer.Metadata) {
                allTracks.push(...data.MediaContainer.Metadata);
            }
        }

        console.log(`[Upgrader] Total tracks fetched: ${allTracks.length}`);

        // Filter by rating
        const ratedTracks = [];
        for (let i = 0; i < allTracks.length; i++) {
            const track = allTracks[i];
            const userRating = track.userRating ? Math.round(track.userRating / 2) : 0; // Convert 0-10 to 0-5

            if (userRating >= minRating) {
                // Extract metadata
                const media = track.Media && track.Media[0];
                const part = media && media.Part && media.Part[0];

                const trackData = {
                    ratingKey: track.ratingKey,
                    artist: track.grandparentTitle || 'Unknown Artist',
                    album: track.parentTitle || 'Unknown Album',
                    title: track.title,
                    year: track.parentYear || track.year,
                    trackNumber: track.index,
                    userRating: userRating,
                    codec: media ? media.audioCodec : 'unknown',
                    bitrate: media ? media.bitrate : 0,
                    filePath: part ? part.file : null,
                    duration: track.duration
                };

                ratedTracks.push(trackData);
            }

            if (i % 100 === 0 && progressCallback) {
                progressCallback({
                    status: `Filtering tracks by rating... (${i}/${allTracks.length})`,
                    progress: 30 + (i / allTracks.length) * 60
                });
            }
        }

        if (progressCallback) {
            progressCallback({
                status: `Found ${ratedTracks.length} tracks rated ${minRating}+ stars`,
                progress: 100,
                completed: true,
                ratedTracks
            });
        }

        console.log(`[Upgrader] Rated tracks (${minRating}+ stars): ${ratedTracks.length}`);
        return ratedTracks;

    } catch (error) {
        console.error('[Upgrader] Error fetching Plex tracks:', error);
        if (progressCallback) {
            progressCallback({
                status: 'Error fetching Plex tracks',
                error: error.message,
                completed: true
            });
        }
        throw error;
    }
}

/**
 * Detect low-quality tracks that are upgrade candidates
 */
function detectLowQuality(tracks) {
    const upgradeCandidates = [];

    for (const track of tracks) {
        const codec = track.codec.toLowerCase();
        const bitrate = track.bitrate;

        // Check if it's a lossy codec
        if (!UPGRADE_THRESHOLDS.lowQuality.codecs.includes(codec)) {
            // Already lossless (FLAC, ALAC, etc.) - skip
            continue;
        }

        // Check bitrate threshold
        if (bitrate >= UPGRADE_THRESHOLDS.maxBitrate && codec !== 'mp3') {
            // High bitrate lossy - might still want to upgrade, but lower priority
        }

        const qualityScore = calculateQualityScore(codec, bitrate);

        upgradeCandidates.push({
            ...track,
            currentQuality: {
                codec: codec.toUpperCase(),
                bitrate: bitrate,
                score: qualityScore
            },
            targetQuality: {
                codec: 'FLAC',
                bitrate: 1411, // CD quality FLAC
                score: 1000
            },
            upgradePriority: 1000 - qualityScore // Lower quality = higher priority
        });
    }

    // Sort by priority (worst quality first)
    upgradeCandidates.sort((a, b) => b.upgradePriority - a.upgradePriority);

    console.log(`[Upgrader] Detected ${upgradeCandidates.length} upgrade candidates`);
    return upgradeCandidates;
}

/**
 * Generate track key from file path (directory + basename without extension)
 */
function getTrackKey(filePath) {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    return path.join(dir, basename);
}

/**
 * Check if track was already upgraded
 */
function isAlreadyUpgraded(filePath) {
    const db = initUpgradeDatabase();
    const trackKey = getTrackKey(filePath);
    const stmt = db.prepare('SELECT * FROM upgrades WHERE track_key = ?');
    const result = stmt.get(trackKey);
    return result !== undefined;
}
/**
 * Copy metadata from original file to new FLAC using FFmpeg
 */
async function copyMetadata(originalPath, newPath, originalMetadata) {
    return new Promise((resolve, reject) => {
        // Create a temporary file path
        const tempPath = newPath + '.temp.flac';

        // Build FFmpeg arguments to copy metadata
        const ffmpegArgs = [
            '-i', newPath,           // Input: new FLAC (without metadata)
            '-i', originalPath,       // Input: original file (with metadata)
            '-map', '0:a',            // Map audio from first input (new FLAC)
            '-map_metadata', '1',     // Map all metadata from second input (original)
            '-c:a', 'copy',           // Copy audio codec (no re-encoding)
            '-y',                     // Overwrite output file
            tempPath                  // Output to temp file
        ];

        console.log(`[Upgrader] Running FFmpeg to copy metadata...`);
        const ffmpeg = spawn('ffmpeg', ffmpegArgs);

        let stderr = '';

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                // Success - replace original new file with temp file
                try {
                    fs.unlinkSync(newPath);
                    fs.renameSync(tempPath, newPath);
                    console.log(`[Upgrader] Metadata copied successfully`);
                    resolve();
                } catch (error) {
                    console.error(`[Upgrader] Error replacing file:`, error);
                    reject(error);
                }
            } else {
                console.error(`[Upgrader] FFmpeg metadata copy failed:`, stderr);
                // Clean up temp file if it exists
                if (fs.existsSync(tempPath)) {
                    fs.unlinkSync(tempPath);
                }
                reject(new Error(`FFmpeg failed with code ${code}`));
            }
        });

        ffmpeg.on('error', (error) => {
            console.error(`[Upgrader] FFmpeg spawn error:`, error);
            reject(error);
        });
    });
}

/**
 * Search YouTube Music for a track
 * Primary: Use Plex metadata
 * Fallback: Use MusicBrainz-verified metadata
 */
async function searchYouTubeMusicForTrack(track, cookies, poToken, useMusicBrainz = false) {
    try {
        // Build search query - simplified to avoid confusion from album names
        // Strategy: Use artist + title only, without album name
        let searchQuery;
        if (useMusicBrainz && track.mbMetadata) {
            // Use MusicBrainz-verified metadata
            searchQuery = `${track.mbMetadata.artist} ${track.mbMetadata.title}`;
        } else {
            // Use Plex metadata
            searchQuery = `${track.artist} ${track.title}`;
        }

        console.log(`[Upgrader] Searching YouTube Music: "${searchQuery}"`);

        // Use simple search query (just artist + title) for better accuracy
        // Adding keywords like "topic official audio" actually hurts results for obscure/Japanese artists
        // Use yt-dlp to search with duration filtering
        // Get top 10 results for better filtering options
        const ytDlpArgs = [
            'ytsearch10:' + searchQuery,
            '--get-id',
            '--get-title',
            '--get-duration',
            '--no-playlist',
            '--extractor-args', 'youtube:player_client=tv_embedded'
        ];

        if (cookies) {
            ytDlpArgs.push('--cookies', cookies);
        }

        // Don't use PO token - it requires CLIENT.CONTEXT+PO_TOKEN format which is complex to obtain
        // The cookies should be sufficient for search authentication
        // if (poToken) {
        //     ytDlpArgs.push('--extractor-args', `youtube:po_token=${poToken}`);
        // }

        return new Promise((resolve, reject) => {
            const ytDlp = spawn('yt-dlp', ytDlpArgs);

            let stdout = '';
            let stderr = '';

            ytDlp.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            ytDlp.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            ytDlp.on('close', (code) => {
                if (code === 0) {
                    const lines = stdout.trim().split('\n').filter(line => line.length > 0);

                    // Parse results - format is: title, id, duration (repeated in groups of 3)
                    // Note: --get-id comes before --get-duration in output!
                    const results = [];
                    for (let i = 0; i + 2 < lines.length; i += 3) {
                        const title = lines[i];
                        const videoId = lines[i + 1]; // Video ID
                        const duration = lines[i + 2]; // Format: MM:SS or HH:MM:SS

                        // Parse duration to seconds
                        const durationParts = duration.split(':').map(Number);
                        let seconds = 0;
                        if (durationParts.length === 3) {
                            // HH:MM:SS
                            seconds = durationParts[0] * 3600 + durationParts[1] * 60 + durationParts[2];
                        } else if (durationParts.length === 2) {
                            // MM:SS
                            seconds = durationParts[0] * 60 + durationParts[1];
                        }

                        // Calculate quality score for ranking
                        let score = 0;

                        // Boost "Official Audio" in title
                        if (title.toLowerCase().includes('official audio')) {
                            score += 5;
                        }

                        // Penalize live versions, covers, remixes
                        const lowerTitle = title.toLowerCase();
                        if (lowerTitle.includes('live')) score -= 10;
                        if (lowerTitle.includes('cover')) score -= 10;
                        if (lowerTitle.includes('remix')) score -= 10;
                        if (lowerTitle.includes('karaoke')) score -= 10;

                        results.push({ title, duration, durationSeconds: seconds, videoId, score });
                    }

                    // Filter out videos longer than 15 minutes (900 seconds)
                    const filtered = results.filter(r => r.durationSeconds > 0 && r.durationSeconds <= 900);

                    if (filtered.length > 0) {
                        // Sort by score (highest first), then pick the best
                        filtered.sort((a, b) => b.score - a.score);
                        const best = filtered[0];
                        const url = `https://www.youtube.com/watch?v=${best.videoId}`;

                        console.log(`[Upgrader] Found ${filtered.length} results under 15 min`);
                        console.log(`[Upgrader] Selected (score: ${best.score}): ${best.title}`);
                        console.log(`[Upgrader] Duration: ${best.duration}`);
                        console.log(`[Upgrader] URL: ${url}`);
                        resolve({ url, title: best.title, videoId: best.videoId });
                    } else if (results.length > 0) {
                        // No results passed filter, warn and use first result anyway
                        const best = results[0];
                        const url = `https://www.youtube.com/watch?v=${best.videoId}`;
                        console.log(`[Upgrader] WARNING: All results over 15 min! Using first: ${best.title} (${best.duration})`);
                        resolve({ url, title: best.title, videoId: best.videoId });
                    } else {
                        resolve(null); // No results found
                    }
                } else {
                    console.error('[Upgrader] yt-dlp search error:', stderr);
                    reject(new Error(`yt-dlp search failed: ${stderr}`));
                }
            });
        });

    } catch (error) {
        console.error('[Upgrader] Error searching YouTube Music:', error);
        throw error;
    }
}

/**
 * Download FLAC from YouTube Music and replace original file
 */
async function downloadAndReplace(track, youtubeUrl, cookies, poToken, progressCallback) {
    try {
        const originalPath = track.filePath;
        const originalDir = path.dirname(originalPath);
        const originalExt = path.extname(originalPath);
        const originalBasename = path.basename(originalPath, originalExt);
        const newPath = path.join(originalDir, originalBasename + '.flac');

        console.log(`[Upgrader] Downloading FLAC for: ${track.artist} - ${track.title}`);
        console.log(`[Upgrader] Original: ${originalPath}`);
        console.log(`[Upgrader] New path: ${newPath}`);

        // Read metadata from original file BEFORE downloading
        // We'll preserve this metadata instead of using YouTube's metadata
        const originalMetadata = await parseFile(originalPath);
        console.log(`[Upgrader] Preserving original metadata: ${track.artist} - ${track.title} (${track.album})`);

        // yt-dlp arguments for FLAC download (NO metadata embedding from YouTube)
        const ytDlpArgs = [
            youtubeUrl,
            '--extract-audio',  // Extract audio and convert to specified format
            '--format', 'bestaudio',
            '--audio-format', 'flac',
            '--audio-quality', '0',
            '--output', newPath, // Direct path with .flac extension
            '--no-playlist',
            '--extractor-args', 'youtube:player_client=tv_embedded',
            '--no-embed-thumbnail', // Skip thumbnail embedding
            '--prefer-ffmpeg', // Prefer FFmpeg for conversion
            '--no-post-overwrites' // Don't overwrite metadata
        ];

        if (cookies) {
            ytDlpArgs.push('--cookies', cookies);
        }

        // Don't use PO token - it requires CLIENT.CONTEXT+PO_TOKEN format which is complex to obtain
        // The tv_embedded player client and cookies should be sufficient for authentication
        // if (poToken) {
        //     ytDlpArgs.push('--extractor-args', `youtube:po_token=${poToken}`);
        // }

        return new Promise((resolve, reject) => {
            const ytDlp = spawn('yt-dlp', ytDlpArgs);
            let stderrOutput = '';

            ytDlp.stdout.on('data', (data) => {
                const output = data.toString();
                console.log('[yt-dlp]', output);

                if (progressCallback) {
                    // Parse download progress
                    const progressMatch = output.match(/(\d+\.?\d*)%/);
                    if (progressMatch) {
                        progressCallback({
                            status: `Downloading: ${track.title}`,
                            progress: parseFloat(progressMatch[1]),
                            track: track.title
                        });
                    }
                }
            });

            ytDlp.stderr.on('data', (data) => {
                const output = data.toString();
                stderrOutput += output;
                console.log('[yt-dlp stderr]', output);

                if (progressCallback) {
                    const progressMatch = output.match(/(\d+\.?\d*)%/);
                    if (progressMatch) {
                        progressCallback({
                            status: `Downloading: ${track.title}`,
                            progress: parseFloat(progressMatch[1]),
                            track: track.title
                        });
                    }
                }
            });

            ytDlp.on('close', async (code) => {
                if (code === 0) {
                    try {
                        // Verify FLAC file was created
                        if (!fs.existsSync(newPath)) {
                            throw new Error(`FLAC file not created: ${newPath}`);
                        }

                        // Read metadata from downloaded FLAC file
                        const newMetadata = await parseFile(newPath);
                        const newBitrate = newMetadata.format.bitrate ? Math.round(newMetadata.format.bitrate / 1000) : 1411;

                        // Verify it's actually FLAC format
                        if (newMetadata.format.container !== 'FLAC') {
                            throw new Error(`Downloaded file is not FLAC format: ${newMetadata.format.container}`);
                        }

                        console.log(`[Upgrader] Successfully downloaded FLAC: ${newPath}`);

                        // Copy metadata from original file to new FLAC using FFmpeg
                        console.log(`[Upgrader] Copying metadata from original file...`);
                        await copyMetadata(originalPath, newPath, originalMetadata);
                        console.log(`[Upgrader] Metadata copied successfully`);

                        // Delete original file and any related files (PNG, WebP, etc.)
                        if (fs.existsSync(originalPath) && originalPath !== newPath) {
                            fs.unlinkSync(originalPath);
                            console.log(`[Upgrader] Deleted original file: ${originalPath}`);
                        }

                        // Clean up other files with the same basename (images and temp audio files)
                        const baseName = originalBasename;
                        const directory = originalDir;
                        const relatedExtensions = ['.png', '.webp', '.jpg', '.jpeg', '.webm', '.opus', '.m4a', '.part'];

                        for (const ext of relatedExtensions) {
                            const relatedPath = path.join(directory, baseName + ext);
                            if (fs.existsSync(relatedPath)) {
                                fs.unlinkSync(relatedPath);
                                console.log(`[Upgrader] Deleted related file: ${relatedPath}`);
                            }
                        }

                        // Record upgrade in database
                        const db = initUpgradeDatabase();
                        const trackKey = getTrackKey(originalPath);
                        const stmt = db.prepare(`
                            INSERT OR REPLACE INTO upgrades (
                                file_path, track_key, original_codec, original_bitrate,
                                new_codec, new_bitrate, plex_rating, youtube_url,
                                plex_metadata
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        `);

                        stmt.run(
                            newPath,
                            trackKey,
                            track.currentQuality.codec,
                            track.currentQuality.bitrate,
                            'FLAC',
                            newBitrate,
                            track.userRating,
                            youtubeUrl,
                            JSON.stringify({ artist: track.artist, album: track.album, title: track.title })
                        );

                        console.log(`[Upgrader] Successfully upgraded: ${newPath}`);

                        if (progressCallback) {
                            progressCallback({
                                status: 'Download complete',
                                progress: 100,
                                completed: true,
                                success: true,
                                newPath
                            });
                        }

                        resolve({
                            success: true,
                            originalPath,
                            newPath,
                            newBitrate
                        });
                    } catch (error) {
                        console.error('[Upgrader] Error processing downloaded file:', error);
                        reject(error);
                    }
                } else {
                    // Extract last few lines of stderr for more helpful error message
                    const errorLines = stderrOutput.trim().split('\n').slice(-3).join(' | ');
                    const errorMsg = errorLines || `yt-dlp download failed with code ${code}`;
                    const error = new Error(errorMsg);
                    console.error('[Upgrader]', error);
                    console.error('[Upgrader] Full stderr:', stderrOutput);

                    if (progressCallback) {
                        progressCallback({
                            status: 'Download failed',
                            error: errorMsg,
                            completed: true,
                            success: false
                        });
                    }

                    reject(error);
                }
            });
        });

    } catch (error) {
        console.error('[Upgrader] Error in downloadAndReplace:', error);
        throw error;
    }
}

/**
 * Get upgrade statistics
 */
function getUpgradeStats() {
    const db = initUpgradeDatabase();

    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM upgrades');
    const totalResult = totalStmt.get();
    const totalUpgrades = totalResult.count;

    const recentStmt = db.prepare(`
        SELECT COUNT(*) as count
        FROM upgrades
        WHERE upgraded_at >= datetime('now', '-30 days')
    `);
    const recentResult = recentStmt.get();
    const recentUpgrades = recentResult.count;

    return {
        totalUpgrades,
        recentUpgrades
    };
}

export {
    fetchPlexTracksWithRatings,
    detectLowQuality,
    isAlreadyUpgraded,
    searchYouTubeMusicForTrack,
    downloadAndReplace,
    calculateQualityScore,
    getUpgradeStats,
    initUpgradeDatabase
};
