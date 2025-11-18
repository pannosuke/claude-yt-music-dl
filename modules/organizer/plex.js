/**
 * Plex Media Server Integration Module
 * Connects to Plex API to fetch music library data and compare with offline files
 */

import https from 'https';
import http from 'http';

/**
 * Quality ranking for audio codecs and bitrates
 */
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
    'wma': 200
};

/**
 * Make HTTP request to Plex API
 */
function plexRequest(serverIp, port, path, token, useHttps = false) {
    return new Promise((resolve, reject) => {
        const protocol = useHttps ? https : http;
        // Check if path already has query params and use appropriate separator
        const separator = path.includes('?') ? '&' : '?';
        const url = `${useHttps ? 'https' : 'http'}://${serverIp}:${port}${path}${separator}X-Plex-Token=${token}`;

        // Debug logging
        console.log('[Plex Request] URL:', url);

        const options = {
            headers: {
                'Accept': 'application/json'
            }
        };

        protocol.get(url, options, (res) => {
            let data = '';

            console.log('[Plex Request] Status Code:', res.statusCode);
            console.log('[Plex Request] Headers:', res.headers);

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 200) {
                    console.log('[Plex Request] Response preview:', data.substring(0, 200));
                    try {
                        const parsed = JSON.parse(data);
                        resolve(parsed);
                    } catch (error) {
                        console.error('[Plex Request] JSON parse error:', error.message);
                        console.error('[Plex Request] Raw data:', data.substring(0, 500));
                        reject(new Error(`Failed to parse JSON: ${error.message}`));
                    }
                } else {
                    console.error('[Plex Request] Non-200 status:', res.statusCode);
                    console.error('[Plex Request] Response body:', data.substring(0, 500));
                    reject(new Error(`Plex API returned status ${res.statusCode}`));
                }
            });
        }).on('error', (error) => {
            console.error('[Plex Request] HTTP error:', error);
            reject(error);
        });
    });
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
 * Test connection to Plex server
 */
export async function testConnection(serverIp, port, token) {
    try {
        const normalizedIp = normalizeServerIp(serverIp);
        const response = await plexRequest(normalizedIp, port, '/', token);

        if (response.MediaContainer) {
            return {
                success: true,
                server: {
                    name: response.MediaContainer.friendlyName || 'Unknown',
                    version: response.MediaContainer.version || 'Unknown',
                    platform: response.MediaContainer.platform || 'Unknown'
                }
            };
        }

        throw new Error('Invalid response from Plex server');
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get all library sections from Plex
 */
export async function getLibraries(serverIp, port, token) {
    try {
        const normalizedIp = normalizeServerIp(serverIp);
        const response = await plexRequest(normalizedIp, port, '/library/sections', token);

        if (response.MediaContainer && response.MediaContainer.Directory) {
            const libraries = [];

            for (const dir of response.MediaContainer.Directory) {
                if (dir.type === 'artist') {
                    // Fetch actual track count by querying the library with size=1
                    let trackCount = 0;
                    try {
                        const countResponse = await plexRequest(
                            normalizedIp,
                            port,
                            `/library/sections/${dir.key}/all?type=10&X-Plex-Container-Start=0&X-Plex-Container-Size=1`,
                            token
                        );
                        trackCount = parseInt(countResponse.MediaContainer?.totalSize || '0', 10);
                    } catch (err) {
                        console.warn(`Failed to fetch track count for library ${dir.title}:`, err.message);
                    }

                    libraries.push({
                        id: dir.key,
                        name: dir.title,
                        type: dir.type,
                        trackCount
                    });
                }
            }

            return libraries;
        }

        return [];
    } catch (error) {
        throw new Error(`Failed to fetch libraries: ${error.message}`);
    }
}

/**
 * Fetch all tracks from a music library (with pagination support)
 */
export async function fetchLibraryTracks(serverIp, port, token, libraryId, progressCallback = () => {}) {
    try {
        const normalizedIp = normalizeServerIp(serverIp);

        progressCallback({
            status: 'Fetching library info...',
            progress: 5
        });

        // First request to get total count (type=10 means tracks, not albums)
        const firstResponse = await plexRequest(normalizedIp, port, `/library/sections/${libraryId}/all?type=10&X-Plex-Container-Start=0&X-Plex-Container-Size=1`, token);

        if (!firstResponse.MediaContainer) {
            throw new Error('Invalid response from Plex');
        }

        const totalSize = parseInt(firstResponse.MediaContainer.totalSize || '0', 10);

        if (totalSize === 0) {
            throw new Error('No tracks found in library');
        }

        progressCallback({
            status: `Found ${totalSize} tracks in library. Fetching in batches...`,
            progress: 10
        });

        // Fetch all tracks with pagination (500 per page)
        const pageSize = 500;
        const allRawTracks = [];

        for (let offset = 0; offset < totalSize; offset += pageSize) {
            const fetchProgress = 10 + Math.round((offset / totalSize) * 40);
            progressCallback({
                status: `Fetching tracks ${offset + 1} to ${Math.min(offset + pageSize, totalSize)} of ${totalSize}...`,
                progress: fetchProgress
            });

            const response = await plexRequest(
                normalizedIp,
                port,
                `/library/sections/${libraryId}/all?type=10&X-Plex-Container-Start=${offset}&X-Plex-Container-Size=${pageSize}`,
                token
            );

            if (response.MediaContainer && response.MediaContainer.Metadata) {
                allRawTracks.push(...response.MediaContainer.Metadata);
            }
        }

        const totalTracks = allRawTracks.length;

        progressCallback({
            status: `Processing ${totalTracks} tracks...`,
            progress: 50
        });

        const tracks = [];

        for (let i = 0; i < allRawTracks.length; i++) {
            const track = allRawTracks[i];

            // Report progress every 100 tracks
            if (i % 100 === 0) {
                progressCallback({
                    status: `Processing track ${i + 1} of ${totalTracks}...`,
                    progress: 50 + Math.round((i / totalTracks) * 40)
                });
            }

            const processedTrack = {
                ratingKey: track.ratingKey,
                title: track.title,
                artist: track.grandparentTitle || 'Unknown Artist',
                album: track.parentTitle || 'Unknown Album',
                year: track.year || null,
                trackNumber: track.index || null,
                duration: track.duration || null,
                // Media info
                codec: null,
                bitrate: null,
                filePath: null
            };

            // Extract codec and bitrate from Media array
            if (track.Media && track.Media.length > 0) {
                const media = track.Media[0];
                processedTrack.codec = media.audioCodec || null;
                processedTrack.bitrate = media.bitrate || null;

                // Extract file path
                if (media.Part && media.Part.length > 0) {
                    processedTrack.filePath = media.Part[0].file || null;
                }
            }

            tracks.push(processedTrack);
        }

        progressCallback({
            status: `Fetched ${tracks.length} tracks from Plex`,
            progress: 100,
            tracksFound: tracks.length
        });

        return tracks;
    } catch (error) {
        throw new Error(`Failed to fetch tracks: ${error.message}`);
    }
}

/**
 * Calculate quality score for a track
 */
function calculateQualityScore(codec, bitrate) {
    if (!codec) return 0;

    const codecLower = codec.toLowerCase();
    const rank = CODEC_QUALITY_RANK[codecLower];

    if (typeof rank === 'function') {
        return rank(bitrate || 128);
    }

    return rank || 0;
}

/**
 * Compare quality between two tracks
 */
export function compareQuality(fileA, fileB) {
    const scoreA = calculateQualityScore(fileA.codec, fileA.bitrate);
    const scoreB = calculateQualityScore(fileB.codec, fileB.bitrate);

    if (scoreA > scoreB) return 'A_BETTER';
    if (scoreB > scoreA) return 'B_BETTER';
    return 'EQUAL';
}

/**
 * Normalize string for comparison
 */
function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
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
 * Calculate similarity score (0-1) between two strings
 */
function levenshteinSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
}

/**
 * Check if two tracks are exact duplicates
 */
function isExactDuplicate(offlineTrack, plexTrack) {
    return normalizeString(offlineTrack.artist) === normalizeString(plexTrack.artist) &&
           normalizeString(offlineTrack.album) === normalizeString(plexTrack.album) &&
           normalizeString(offlineTrack.title) === normalizeString(plexTrack.title);
}

/**
 * Check if two tracks are fuzzy duplicates
 */
function isFuzzyDuplicate(offlineTrack, plexTrack, threshold = 0.85) {
    const artistSimilarity = levenshteinSimilarity(
        normalizeString(offlineTrack.artist),
        normalizeString(plexTrack.artist)
    );
    const albumSimilarity = levenshteinSimilarity(
        normalizeString(offlineTrack.album),
        normalizeString(plexTrack.album)
    );
    const titleSimilarity = levenshteinSimilarity(
        normalizeString(offlineTrack.title),
        normalizeString(plexTrack.title)
    );

    const avgSimilarity = (artistSimilarity + albumSimilarity + titleSimilarity) / 3;
    return avgSimilarity >= threshold;
}

/**
 * Compare offline scanned files with Plex library
 */
export function compareWithPlex(offlineTracks, plexTracks, progressCallback = () => {}) {
    const results = {
        safeToAdd: 0,
        exactDuplicates: 0,
        qualityUpgrades: 0,
        qualityDowngrades: 0,
        sameQualityDupes: 0,
        conflicts: []
    };

    progressCallback({
        status: 'Comparing tracks with Plex library...',
        progress: 10
    });

    // Build index of Plex tracks for faster lookups
    const plexIndex = new Map();
    for (const plexTrack of plexTracks) {
        const key = `${normalizeString(plexTrack.artist)}|${normalizeString(plexTrack.album)}|${normalizeString(plexTrack.title)}`;
        plexIndex.set(key, plexTrack);
    }

    const totalOffline = offlineTracks.length;

    for (let i = 0; i < totalOffline; i++) {
        const offlineTrack = offlineTracks[i];

        // Report progress every 50 tracks
        if (i % 50 === 0) {
            progressCallback({
                status: `Comparing track ${i + 1} of ${totalOffline}...`,
                progress: 10 + Math.round((i / totalOffline) * 80)
            });
        }

        // First check for exact match
        const key = `${normalizeString(offlineTrack.artist)}|${normalizeString(offlineTrack.album)}|${normalizeString(offlineTrack.title)}`;
        let matchedPlexTrack = plexIndex.get(key);
        let matchType = matchedPlexTrack ? 'exact' : null;

        // If no exact match, try fuzzy matching
        if (!matchedPlexTrack) {
            for (const plexTrack of plexTracks) {
                if (isFuzzyDuplicate(offlineTrack, plexTrack)) {
                    matchedPlexTrack = plexTrack;
                    matchType = 'fuzzy';
                    break;
                }
            }
        }

        if (!matchedPlexTrack) {
            // No match found - safe to add
            results.safeToAdd++;
            results.conflicts.push({
                offlineTrack,
                plexTrack: null,
                category: 'SAFE_TO_ADD',
                matchType: null,
                recommendation: 'ADD'
            });
        } else {
            // Match found - compare quality
            const qualityComparison = compareQuality(
                { codec: offlineTrack.format, bitrate: offlineTrack.bitrate },
                { codec: matchedPlexTrack.codec, bitrate: matchedPlexTrack.bitrate }
            );

            if (qualityComparison === 'A_BETTER') {
                results.qualityUpgrades++;
                results.conflicts.push({
                    offlineTrack,
                    plexTrack: matchedPlexTrack,
                    category: 'QUALITY_UPGRADE',
                    matchType,
                    recommendation: 'REPLACE'
                });
            } else if (qualityComparison === 'B_BETTER') {
                results.qualityDowngrades++;
                results.conflicts.push({
                    offlineTrack,
                    plexTrack: matchedPlexTrack,
                    category: 'QUALITY_DOWNGRADE',
                    matchType,
                    recommendation: 'SKIP'
                });
            } else {
                results.sameQualityDupes++;
                results.conflicts.push({
                    offlineTrack,
                    plexTrack: matchedPlexTrack,
                    category: 'SAME_QUALITY_DUPLICATE',
                    matchType,
                    recommendation: 'SKIP'
                });
            }

            if (matchType === 'exact') {
                results.exactDuplicates++;
            }
        }
    }

    progressCallback({
        status: 'Comparison complete',
        progress: 100
    });

    return results;
}
