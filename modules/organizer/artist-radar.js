/**
 * Artist Radar & Discovery Dashboard
 *
 * Monitors rated artists for new releases and missing albums.
 * Allows ignoring unwanted releases (singles already on albums, etc.)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Artist rating tier configurations (from roadmap)
const RATING_TIERS = {
    5: { scanFrequency: 'daily', newReleaseWindow: 30, trackMajorAlbums: true, trackAllAlbums: true },
    4: { scanFrequency: 'weekly', newReleaseWindow: 60, trackMajorAlbums: true, trackAllAlbums: true },
    3: { scanFrequency: 'monthly', newReleaseWindow: 90, trackMajorAlbums: true, trackAllAlbums: false },
    2: { scanFrequency: 'quarterly', newReleaseWindow: 180, trackMajorAlbums: true, trackAllAlbums: false },
    1: { scanFrequency: 'never', newReleaseWindow: 0, trackMajorAlbums: false, trackAllAlbums: false }
};

/**
 * Normalize server IP (handle common hostnames like plex.local)
 */
function normalizeServerIp(serverIp) {
    if (serverIp === 'plex.local' || serverIp === 'localhost') {
        return '127.0.0.1';
    }
    return serverIp;
}

/**
 * Make HTTP request to Plex API
 */
function plexRequest(serverIp, port, path, token) {
    return new Promise((resolve, reject) => {
        const normalizedIp = normalizeServerIp(serverIp);
        const separator = path.includes('?') ? '&' : '?';
        const url = `http://${normalizedIp}:${port}${path}${separator}X-Plex-Token=${token}`;

        http.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error(`Failed to parse JSON: ${error.message}`));
                    }
                } else {
                    reject(new Error(`Plex API returned status ${res.statusCode}`));
                }
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

// Initialize radar database
let radarDb = null;

function initRadarDatabase() {
    if (radarDb) return radarDb;

    const dbPath = path.join(__dirname, '../../data/radar.db');
    const dbDir = path.dirname(dbPath);

    // Create data directory if it doesn't exist
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    radarDb = new Database(dbPath);

    // Create tables
    radarDb.exec(`
        CREATE TABLE IF NOT EXISTS ignored_releases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_name TEXT NOT NULL,
            release_title TEXT NOT NULL,
            release_mbid TEXT,
            release_type TEXT,
            ignored_at INTEGER NOT NULL,
            UNIQUE(artist_name, release_title)
        );

        CREATE TABLE IF NOT EXISTS artist_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_name TEXT NOT NULL UNIQUE,
            artist_mbid TEXT,
            rating INTEGER NOT NULL,
            last_scanned INTEGER NOT NULL,
            discography_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plex_albums_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_name TEXT NOT NULL,
            album_title TEXT NOT NULL,
            cached_at INTEGER NOT NULL,
            UNIQUE(artist_name, album_title)
        );

        CREATE INDEX IF NOT EXISTS idx_artist_name ON ignored_releases(artist_name);
        CREATE INDEX IF NOT EXISTS idx_release_mbid ON ignored_releases(release_mbid);
        CREATE INDEX IF NOT EXISTS idx_artist_cache_name ON artist_cache(artist_name);
        CREATE INDEX IF NOT EXISTS idx_plex_albums_artist ON plex_albums_cache(artist_name);
    `);

    console.log('[Artist Radar] Database initialized');
    return radarDb;
}

/**
 * Fetch all rated artists from Plex with their ratings
 */
async function fetchRatedArtists(plexConfig) {
    const { serverIp, port, token, libraryKey } = plexConfig;

    try {
        // Fetch all artists from the library
        const data = await plexRequest(serverIp, port, `/library/sections/${libraryKey}/all?type=8`, token);
        const artists = data.MediaContainer.Metadata || [];

        // Filter for rated artists only
        const ratedArtists = artists
            .filter(artist => artist.userRating)
            .map(artist => {
                // Extract MusicBrainz ID from Plex Guid array
                let mbid = null;
                if (artist.Guid && Array.isArray(artist.Guid)) {
                    const mbGuid = artist.Guid.find(g => g.id && g.id.startsWith('mbid://'));
                    if (mbGuid) {
                        mbid = mbGuid.id.replace('mbid://', '');
                    }
                }

                return {
                    name: artist.title,
                    rating: Math.round(artist.userRating / 2), // Convert from 10-point to 5-star scale
                    ratingKey: artist.ratingKey,
                    mbid: mbid
                };
            });

        console.log(`[Artist Radar] Found ${ratedArtists.length} rated artists`);
        return ratedArtists;
    } catch (error) {
        console.error(`[Artist Radar] Error fetching rated artists:`, error);
        throw error;
    }
}

/**
 * Get cached artist data if still fresh
 */
function getCachedArtist(artistName, rating) {
    const db = initRadarDatabase();
    const tierConfig = RATING_TIERS[rating];

    // Calculate scan frequency in milliseconds
    const scanIntervals = {
        'daily': 24 * 60 * 60 * 1000,
        'weekly': 7 * 24 * 60 * 60 * 1000,
        'monthly': 30 * 24 * 60 * 60 * 1000,
        'quarterly': 90 * 24 * 60 * 60 * 1000,
        'never': Infinity
    };

    const interval = scanIntervals[tierConfig.scanFrequency];
    const now = Date.now();

    const stmt = db.prepare('SELECT * FROM artist_cache WHERE artist_name = ?');
    const cached = stmt.get(artistName);

    if (!cached) {
        return null;
    }

    // Check if cache is still fresh based on rating tier
    const timeSinceLastScan = now - cached.last_scanned;
    if (timeSinceLastScan < interval) {
        console.log(`[Artist Radar] Using cached discography for ${artistName} (scanned ${Math.floor(timeSinceLastScan / (24 * 60 * 60 * 1000))} days ago)`);
        return {
            discography: JSON.parse(cached.discography_json),
            mbid: cached.artist_mbid
        };
    }

    return null;
}

/**
 * Save artist discography to cache
 */
function cacheArtistDiscography(artistName, rating, discography, artistMbid = null) {
    const db = initRadarDatabase();
    const now = Date.now();

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO artist_cache (artist_name, artist_mbid, rating, last_scanned, discography_json, created_at)
        VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM artist_cache WHERE artist_name = ?), ?))
    `);

    stmt.run(artistName, artistMbid, rating, now, JSON.stringify(discography), artistName, now);
    console.log(`[Artist Radar] Cached discography for ${artistName} (${discography.length} releases)`);
}

/**
 * Update artist rating in cache (when rating changes in Plex)
 */
function updateArtistRating(artistName, newRating) {
    const db = initRadarDatabase();
    const stmt = db.prepare('UPDATE artist_cache SET rating = ? WHERE artist_name = ?');
    stmt.run(newRating, artistName);
}

/**
 * Get cached Plex albums for an artist
 */
function getCachedPlexAlbums(artistName) {
    const db = initRadarDatabase();
    const stmt = db.prepare('SELECT album_title FROM plex_albums_cache WHERE artist_name = ?');
    const rows = stmt.all(artistName);
    return rows.map(row => row.album_title);
}

/**
 * Cache Plex albums for an artist
 */
function cachePlexAlbums(artistName, albums) {
    const db = initRadarDatabase();

    // Clear existing cache for this artist
    const deleteStmt = db.prepare('DELETE FROM plex_albums_cache WHERE artist_name = ?');
    deleteStmt.run(artistName);

    // Insert new albums
    const insertStmt = db.prepare('INSERT INTO plex_albums_cache (artist_name, album_title, cached_at) VALUES (?, ?, ?)');
    const now = Date.now();

    for (const album of albums) {
        insertStmt.run(artistName, album, now);
    }
}

/**
 * Fetch complete discography for an artist from MusicBrainz (with caching)
 */
async function fetchMusicBrainzDiscography(artistName, rating, artistMbid = null) {
    // Check cache first
    const cached = getCachedArtist(artistName, rating);
    if (cached) {
        return cached.discography;
    }

    // Not cached or stale - fetch from MusicBrainz
    const { MusicBrainzApi } = await import('musicbrainz-api');
    const mbApi = new MusicBrainzApi({
        appName: 'yt-music-dl',
        appVersion: '2.0.0',
        appContactInfo: 'claude-yt-music-dl'
    });

    try {
        let artistId = artistMbid;

        // If no MBID provided, search for artist by name
        if (!artistId) {
            const artistSearch = await mbApi.search('artist', { query: artistName, limit: 1 });

            if (!artistSearch.artists || artistSearch.artists.length === 0) {
                console.log(`[Artist Radar] No MusicBrainz match for: ${artistName}`);
                return [];
            }

            const artist = artistSearch.artists[0];
            artistId = artist.id;
            console.log(`[Artist Radar] Found artist by name search: ${artistName} (${artistId})`);
        } else {
            console.log(`[Artist Radar] Using Plex-provided MBID for ${artistName}: ${artistId}`);
        }

        // Search for release groups by this artist
        const releaseGroupSearch = await mbApi.search('release-group', {
            artist: artistId,
            limit: 100
        });

        if (!releaseGroupSearch['release-groups']) {
            return [];
        }

        // Map to simplified structure
        const discography = releaseGroupSearch['release-groups'].map(rg => ({
            title: rg.title,
            mbid: rg.id,
            type: rg['primary-type'] || 'Unknown',
            secondaryTypes: rg['secondary-types'] || [],
            releaseDate: rg['first-release-date'] || null
        }));

        console.log(`[Artist Radar] Fetched ${discography.length} releases for ${artistName} from MusicBrainz`);

        // Cache the results
        cacheArtistDiscography(artistName, rating, discography, artistId);

        return discography;
    } catch (error) {
        console.error(`[Artist Radar] Error fetching MusicBrainz data for ${artistName}:`, error);
        return [];
    }
}

/**
 * Fetch all tracks by an artist from Plex
 */
async function fetchArtistTracks(plexConfig, artistRatingKey) {
    const { serverIp, port, token } = plexConfig;

    try {
        const data = await plexRequest(serverIp, port, `/library/metadata/${artistRatingKey}/allLeaves`, token);
        const tracks = data.MediaContainer.Metadata || [];

        // Extract unique albums
        const albums = [...new Set(tracks.map(t => t.parentTitle))].filter(Boolean);

        return { tracks, albums };
    } catch (error) {
        console.error(`[Artist Radar] Error fetching tracks:`, error);
        return { tracks: [], albums: [] };
    }
}

/**
 * Get all ignored releases
 */
function getIgnoredReleases() {
    const db = initRadarDatabase();
    const stmt = db.prepare('SELECT * FROM ignored_releases ORDER BY ignored_at DESC');
    return stmt.all();
}

/**
 * Check if a release is ignored
 */
function isReleaseIgnored(artistName, releaseTitle) {
    const db = initRadarDatabase();
    const stmt = db.prepare('SELECT id FROM ignored_releases WHERE artist_name = ? AND release_title = ?');
    const result = stmt.get(artistName, releaseTitle);
    return !!result;
}

/**
 * Add a release to ignore list
 */
function ignoreRelease(artistName, releaseTitle, releaseMbid = null, releaseType = null) {
    const db = initRadarDatabase();
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO ignored_releases (artist_name, release_title, release_mbid, release_type, ignored_at)
        VALUES (?, ?, ?, ?, ?)
    `);

    const ignoredAt = Date.now();
    stmt.run(artistName, releaseTitle, releaseMbid, releaseType, ignoredAt);

    console.log(`[Artist Radar] Ignored: ${artistName} - ${releaseTitle}`);
    return { success: true, ignoredAt };
}

/**
 * Remove a release from ignore list
 */
function unignoreRelease(id) {
    const db = initRadarDatabase();
    const stmt = db.prepare('DELETE FROM ignored_releases WHERE id = ?');
    stmt.run(id);

    console.log(`[Artist Radar] Unignored release ID: ${id}`);
    return { success: true };
}

/**
 * Build dashboard data: new releases and missing albums
 */
async function buildDashboard(plexConfig, progressCallback = null) {
    const allRatedArtists = await fetchRatedArtists(plexConfig);

    // Apply rating filter from plexConfig (default: 'all')
    const ratingFilter = plexConfig.ratingFilter || 'all';
    let ratedArtists = allRatedArtists;

    if (ratingFilter !== 'all') {
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

    const newReleases = [];
    const missingAlbums = [];
    let cacheHits = 0;
    let cacheMisses = 0;

    for (let i = 0; i < ratedArtists.length; i++) {
        const artist = ratedArtists[i];

        if (progressCallback) {
            progressCallback({
                type: 'progress',
                message: `Scanning ${artist.name} (${i + 1}/${ratedArtists.length})`,
                current: i + 1,
                total: ratedArtists.length
            });
        }

        // Skip 1-star artists (never scan)
        if (artist.rating === 1) {
            continue;
        }

        const tierConfig = RATING_TIERS[artist.rating];

        // Check if we can use cached discography
        const cached = getCachedArtist(artist.name, artist.rating);
        if (cached) {
            cacheHits++;
        } else {
            cacheMisses++;
        }

        // Fetch MusicBrainz discography (with caching, using Plex-provided MBID if available)
        const discography = await fetchMusicBrainzDiscography(artist.name, artist.rating, artist.mbid);

        // Fetch existing Plex tracks
        const { albums: plexAlbums } = await fetchArtistTracks(plexConfig, artist.ratingKey);

        // Cache Plex albums for future comparisons
        cachePlexAlbums(artist.name, plexAlbums);

        // Find the earliest studio album release date for this artist
        const studioAlbums = discography.filter(r => r.type === 'Album' && r.releaseDate);
        const earliestAlbumDate = studioAlbums.length > 0
            ? studioAlbums.reduce((earliest, album) => {
                const albumDate = new Date(album.releaseDate);
                return albumDate < earliest ? albumDate : earliest;
            }, new Date(studioAlbums[0].releaseDate))
            : null;

        // Process each release
        for (const release of discography) {
            // Skip if ignored
            if (isReleaseIgnored(artist.name, release.title)) {
                continue;
            }

            // Filter out Singles/EPs released before the first studio album
            if (earliestAlbumDate && release.releaseDate) {
                const releaseDate = new Date(release.releaseDate);
                if ((release.type === 'Single' || release.type === 'EP') && releaseDate < earliestAlbumDate) {
                    console.log(`[Artist Radar] Filtering out ${release.type} "${release.title}" by ${artist.name} (released before first album)`);
                    continue;
                }
            }

            // Skip live albums and compilations for missing albums section
            const isLiveOrCompilation = release.secondaryTypes.includes('Live') ||
                                       release.secondaryTypes.includes('Compilation');

            // Check if in library
            const inLibrary = plexAlbums.some(album =>
                album.toLowerCase() === release.title.toLowerCase()
            );

            if (!inLibrary) {
                // Check if it's a new release
                if (release.releaseDate) {
                    const releaseDate = new Date(release.releaseDate);
                    const daysAgo = Math.floor((Date.now() - releaseDate.getTime()) / (1000 * 60 * 60 * 24));

                    if (daysAgo <= tierConfig.newReleaseWindow) {
                        newReleases.push({
                            artist: artist.name,
                            artistRating: artist.rating,
                            title: release.title,
                            releaseDate: release.releaseDate,
                            daysAgo,
                            type: release.type,
                            mbid: release.mbid
                        });
                        continue; // Don't add to missing albums if it's new
                    }
                }

                // Add to missing albums (if not live/compilation for lower tiers)
                if (tierConfig.trackAllAlbums || (!isLiveOrCompilation && tierConfig.trackMajorAlbums)) {
                    // Only include studio albums and major EPs
                    if (release.type === 'Album' || release.type === 'EP') {
                        missingAlbums.push({
                            artist: artist.name,
                            artistRating: artist.rating,
                            title: release.title,
                            releaseDate: release.releaseDate || 'Unknown',
                            type: release.type,
                            mbid: release.mbid
                        });
                    }
                }
            }
        }

        // Rate limit to avoid MusicBrainz throttling (1 request per second)
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Sort new releases by date (newest first)
    newReleases.sort((a, b) => new Date(b.releaseDate) - new Date(a.releaseDate));

    // Sort missing albums by artist rating, then release date
    missingAlbums.sort((a, b) => {
        if (a.artistRating !== b.artistRating) {
            return b.artistRating - a.artistRating; // Higher ratings first
        }
        return new Date(b.releaseDate) - new Date(a.releaseDate); // Newer first
    });

    const cacheHitRate = ratedArtists.length > 0 ? Math.round((cacheHits / (cacheHits + cacheMisses)) * 100) : 0;

    console.log(`[Artist Radar] Scan complete: ${newReleases.length} new releases, ${missingAlbums.length} missing albums`);
    console.log(`[Artist Radar] Cache performance: ${cacheHits} hits, ${cacheMisses} misses (${cacheHitRate}% hit rate)`);
    console.log(`[Artist Radar] Sample new releases:`, newReleases.slice(0, 3));
    console.log(`[Artist Radar] Sample missing albums:`, missingAlbums.slice(0, 3));

    if (progressCallback) {
        progressCallback({
            type: 'progress',
            message: `Found ${newReleases.length} new releases and ${missingAlbums.length} missing albums (${cacheHits} cached, ${cacheMisses} scanned)`
        });
    }

    return { newReleases, missingAlbums, cacheStats: { hits: cacheHits, misses: cacheMisses, hitRate: cacheHitRate } };
}

export default {
    initRadarDatabase,
    fetchRatedArtists,
    fetchMusicBrainzDiscography,
    fetchArtistTracks,
    getIgnoredReleases,
    isReleaseIgnored,
    ignoreRelease,
    unignoreRelease,
    buildDashboard
};
