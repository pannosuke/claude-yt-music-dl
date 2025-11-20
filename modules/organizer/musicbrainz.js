/**
 * MusicBrainz API Integration Module
 * Provides metadata lookups with caching and rate limiting
 */

import { MusicBrainzApi } from 'musicbrainz-api';
import Database from 'better-sqlite3';
import pLimit from 'p-limit';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize MusicBrainz API client
const mbApi = new MusicBrainzApi({
    appName: 'claude-yt-music-dl',
    appVersion: '2.0.0',
    appContactInfo: 'https://github.com/claude-yt-music-dl'
});

// Rate limiter: 1 request per second (MusicBrainz requirement)
const limit = pLimit(1);
const RATE_LIMIT_DELAY = 1000; // 1 second between requests

// Initialize SQLite cache database
const dbPath = path.join(__dirname, '..', '..', 'data', 'musicbrainz-cache.db');
let db = null;

/**
 * Initialize cache database
 */
export function initializeCache() {
    try {
        db = new Database(dbPath);

        // Create cache table
        db.exec(`
            CREATE TABLE IF NOT EXISTS mb_cache (
                query_type TEXT NOT NULL,
                query_key TEXT NOT NULL,
                response TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                PRIMARY KEY (query_type, query_key)
            )
        `);

        // Create index for faster lookups
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_timestamp ON mb_cache(timestamp)
        `);

        console.log('[MusicBrainz] Cache database initialized');
        return true;
    } catch (error) {
        console.error('[MusicBrainz] Failed to initialize cache:', error.message);
        return false;
    }
}

/**
 * Get cached response
 */
function getCachedResponse(queryType, queryKey) {
    if (!db) return null;

    try {
        const stmt = db.prepare('SELECT response, timestamp FROM mb_cache WHERE query_type = ? AND query_key = ?');
        const result = stmt.get(queryType, queryKey);

        if (result) {
            // Cache expires after 30 days
            const age = Date.now() - result.timestamp;
            const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

            if (age < MAX_AGE) {
                console.log(`[MusicBrainz] Cache hit for ${queryType}:${queryKey}`);
                return JSON.parse(result.response);
            } else {
                // Remove expired cache entry
                db.prepare('DELETE FROM mb_cache WHERE query_type = ? AND query_key = ?').run(queryType, queryKey);
            }
        }
    } catch (error) {
        console.error('[MusicBrainz] Cache lookup error:', error.message);
    }

    return null;
}

/**
 * Store response in cache
 */
function cacheResponse(queryType, queryKey, response) {
    if (!db) return;

    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO mb_cache (query_type, query_key, response, timestamp)
            VALUES (?, ?, ?, ?)
        `);

        stmt.run(queryType, queryKey, JSON.stringify(response), Date.now());
        console.log(`[MusicBrainz] Cached response for ${queryType}:${queryKey}`);
    } catch (error) {
        console.error('[MusicBrainz] Cache store error:', error.message);
    }
}

/**
 * Normalize string for comparison
 */
function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase()
        .normalize('NFD') // Decompose combined characters
        .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

/**
 * Calculate similarity score (0-100)
 */
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 100;

    const distance = levenshteinDistance(longer, shorter);
    return Math.round(((longer.length - distance) / longer.length) * 100);
}

/**
 * Search for artist by name
 */
export async function searchArtist(artistName, options = {}) {
    const queryKey = normalizeString(artistName);

    // Check cache first
    const cached = getCachedResponse('artist', queryKey);
    if (cached) return cached;

    // Rate-limited API call
    return limit(async () => {
        try {
            console.log(`[MusicBrainz] Searching for artist: ${artistName}`);

            const response = await mbApi.search('artist', {
                query: artistName,
                limit: options.limit || 5
            });

            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

            // Calculate confidence scores
            const results = response.artists.map(artist => {
                const similarity = calculateSimilarity(
                    normalizeString(artistName),
                    normalizeString(artist.name)
                );

                return {
                    id: artist.id,
                    name: artist.name,
                    sortName: artist['sort-name'],
                    disambiguation: artist.disambiguation || '',
                    type: artist.type || '',
                    country: artist.country || '',
                    confidence: similarity,
                    aliases: artist.aliases || []
                };
            });

            // Sort by confidence
            results.sort((a, b) => b.confidence - a.confidence);

            // Cache response
            cacheResponse('artist', queryKey, results);

            return results;
        } catch (error) {
            console.error('[MusicBrainz] Artist search error:', error.message);
            throw error;
        }
    });
}

/**
 * Search for release (album) by artist and title
 */
export async function searchRelease(artist, album, options = {}) {
    const queryKey = `${normalizeString(artist)}|${normalizeString(album)}`;

    // Check cache first
    const cached = getCachedResponse('release', queryKey);
    if (cached) return cached;

    // Rate-limited API call
    return limit(async () => {
        try {
            console.log(`[MusicBrainz] Searching for release: ${artist} - ${album}`);

            const response = await mbApi.search('release', {
                query: `artist:"${artist}" AND release:"${album}"`,
                limit: options.limit || 5
            });

            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

            // Calculate confidence scores
            const results = response.releases.map(release => {
                const artistSimilarity = calculateSimilarity(
                    normalizeString(artist),
                    normalizeString(release['artist-credit']?.[0]?.name || '')
                );

                const albumSimilarity = calculateSimilarity(
                    normalizeString(album),
                    normalizeString(release.title)
                );

                const confidence = Math.round((artistSimilarity + albumSimilarity) / 2);

                return {
                    id: release.id,
                    title: release.title,
                    artist: release['artist-credit']?.[0]?.name || '',
                    artistId: release['artist-credit']?.[0]?.artist?.id || '',
                    date: release.date || '',
                    country: release.country || '',
                    status: release.status || '',
                    trackCount: release['track-count'] || 0,
                    confidence: confidence,
                    barcode: release.barcode || ''
                };
            });

            // Sort by confidence
            results.sort((a, b) => b.confidence - a.confidence);

            // Cache response
            cacheResponse('release', queryKey, results);

            return results;
        } catch (error) {
            console.error('[MusicBrainz] Release search error:', error.message);
            throw error;
        }
    });
}

/**
 * Search for recording (track) by artist, album, and title
 */
export async function searchRecording(artist, album, title, options = {}) {
    const queryKey = `${normalizeString(artist)}|${normalizeString(album)}|${normalizeString(title)}`;

    // Check cache first
    const cached = getCachedResponse('recording', queryKey);
    if (cached) return cached;

    // Rate-limited API call
    return limit(async () => {
        try {
            console.log(`[MusicBrainz] Searching for recording: ${artist} - ${album} - ${title}`);

            const query = `artist:"${artist}" AND release:"${album}" AND recording:"${title}"`;

            const response = await mbApi.search('recording', {
                query: query,
                limit: options.limit || 5
            });

            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

            // Calculate confidence scores
            const results = response.recordings.map(recording => {
                const artistSimilarity = calculateSimilarity(
                    normalizeString(artist),
                    normalizeString(recording['artist-credit']?.[0]?.name || '')
                );

                const titleSimilarity = calculateSimilarity(
                    normalizeString(title),
                    normalizeString(recording.title)
                );

                // Check if album matches in any of the releases
                let albumSimilarity = 0;
                if (recording.releases && recording.releases.length > 0) {
                    const albumMatches = recording.releases.map(release =>
                        calculateSimilarity(normalizeString(album), normalizeString(release.title))
                    );
                    albumSimilarity = Math.max(...albumMatches);
                }

                const confidence = Math.round((artistSimilarity + titleSimilarity + albumSimilarity) / 3);

                return {
                    id: recording.id,
                    title: recording.title,
                    artist: recording['artist-credit']?.[0]?.name || '',
                    artistId: recording['artist-credit']?.[0]?.artist?.id || '',
                    length: recording.length || null,
                    releases: recording.releases?.map(r => ({
                        id: r.id,
                        title: r.title,
                        date: r.date || ''
                    })) || [],
                    confidence: confidence
                };
            });

            // Sort by confidence
            results.sort((a, b) => b.confidence - a.confidence);

            // Cache response
            cacheResponse('recording', queryKey, results);

            return results;
        } catch (error) {
            console.error('[MusicBrainz] Recording search error:', error.message);
            throw error;
        }
    });
}

/**
 * Get detailed release information including tracks
 */
export async function getReleaseDetails(releaseId) {
    const queryKey = releaseId;

    // Check cache first
    const cached = getCachedResponse('release-details', queryKey);
    if (cached) return cached;

    // Rate-limited API call
    return limit(async () => {
        try {
            console.log(`[MusicBrainz] Fetching release details: ${releaseId}`);

            const response = await mbApi.lookup('release', releaseId, ['artists', 'recordings']);

            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY));

            // Cache response
            cacheResponse('release-details', queryKey, response);

            return response;
        } catch (error) {
            console.error('[MusicBrainz] Release details error:', error.message);
            throw error;
        }
    });
}

/**
 * Clear old cache entries (older than 30 days)
 */
export function clearOldCache() {
    if (!db) return 0;

    try {
        const MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
        const cutoffTime = Date.now() - MAX_AGE;

        const stmt = db.prepare('DELETE FROM mb_cache WHERE timestamp < ?');
        const result = stmt.run(cutoffTime);

        console.log(`[MusicBrainz] Cleared ${result.changes} old cache entries`);
        return result.changes;
    } catch (error) {
        console.error('[MusicBrainz] Cache cleanup error:', error.message);
        return 0;
    }
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
    if (!db) return null;

    try {
        const totalStmt = db.prepare('SELECT COUNT(*) as total FROM mb_cache');
        const total = totalStmt.get().total;

        const byTypeStmt = db.prepare(`
            SELECT query_type, COUNT(*) as count
            FROM mb_cache
            GROUP BY query_type
        `);
        const byType = byTypeStmt.all();

        return {
            total,
            byType: byType.reduce((acc, row) => {
                acc[row.query_type] = row.count;
                return acc;
            }, {})
        };
    } catch (error) {
        console.error('[MusicBrainz] Cache stats error:', error.message);
        return null;
    }
}

/**
 * Clear all cache entries and reset database
 */
export function clearCache() {
    if (!db) {
        console.log('[MusicBrainz] No cache database to clear');
        return { success: false, message: 'Cache database not initialized' };
    }

    try {
        // Delete all records from the cache table
        const stmt = db.prepare('DELETE FROM mb_cache');
        const result = stmt.run();

        // Vacuum the database to reclaim space
        db.exec('VACUUM');

        console.log(`[MusicBrainz] Cleared all ${result.changes} cache entries`);
        return {
            success: true,
            cleared: result.changes,
            message: `Cleared ${result.changes} cache entries`
        };
    } catch (error) {
        console.error('[MusicBrainz] Cache clear error:', error.message);
        return {
            success: false,
            message: `Failed to clear cache: ${error.message}`
        };
    }
}

// Initialize cache on module load
initializeCache();
