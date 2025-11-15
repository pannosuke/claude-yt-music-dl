/**
 * Music Library Scanner Module
 * Scans directories for audio files and reads their metadata
 */

import fg from 'fast-glob';
import { parseFile } from 'music-metadata';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * Supported audio file extensions
 */
const AUDIO_EXTENSIONS = ['flac', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'wma'];

/**
 * Scan a directory for audio files
 * @param {string} musicPath - Path to music directory
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Promise<Array>} Array of scanned file objects
 */
export async function scanDirectory(musicPath, progressCallback = () => {}) {
    try {
        // Verify directory exists
        await fs.access(musicPath);

        progressCallback({
            status: 'Scanning directory for audio files...',
            progress: 0
        });

        // Build glob pattern for audio files
        const patterns = AUDIO_EXTENSIONS.map(ext => `**/*.${ext}`);

        // Scan for audio files
        const files = await fg(patterns, {
            cwd: musicPath,
            absolute: true,
            caseSensitiveMatch: false,
            onlyFiles: true,
            stats: true
        });

        progressCallback({
            status: `Found ${files.length} audio file(s)`,
            filesFound: files.length,
            progress: 10
        });

        if (files.length === 0) {
            return [];
        }

        // Process files and read metadata
        const scannedFiles = [];
        const total = files.length;

        for (let i = 0; i < total; i++) {
            const filePath = files[i].path;
            const fileStats = files[i].stats;

            try {
                const fileData = await processAudioFile(filePath, fileStats, musicPath);
                scannedFiles.push(fileData);

                // Send progress update every 10 files or at the end
                if ((i + 1) % 10 === 0 || i === total - 1) {
                    const progress = Math.min(10 + Math.round((i + 1) / total * 80), 90);
                    progressCallback({
                        status: `Processing file ${i + 1} of ${total}...`,
                        filesProcessed: i + 1,
                        filesTotal: total,
                        progress,
                        currentFile: path.basename(filePath)
                    });
                }
            } catch (error) {
                // Log error but continue processing
                progressCallback({
                    warning: `Failed to read metadata for ${path.basename(filePath)}: ${error.message}`
                });
            }
        }

        progressCallback({
            status: `Scan complete: ${scannedFiles.length} file(s) processed`,
            filesProcessed: scannedFiles.length,
            progress: 100
        });

        return scannedFiles;

    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`Directory not found: ${musicPath}`);
        } else if (error.code === 'EACCES') {
            throw new Error(`Permission denied: ${musicPath}`);
        }
        throw error;
    }
}

/**
 * Process a single audio file and extract metadata
 * @param {string} filePath - Absolute path to audio file
 * @param {Object} fileStats - File stats from fast-glob
 * @param {string} musicPath - Root music directory
 * @returns {Promise<Object>} File data with metadata
 */
async function processAudioFile(filePath, fileStats, musicPath) {
    // Parse metadata from audio file
    const metadata = await parseFile(filePath);

    // Extract folder structure relative to music root
    const relativePath = path.relative(musicPath, filePath);
    const pathParts = path.dirname(relativePath).split(path.sep);

    // Try to extract artist/album from folder structure
    let folderArtist = null;
    let folderAlbum = null;

    if (pathParts.length >= 2) {
        // Typical structure: Artist/Album/Track.flac
        folderArtist = pathParts[pathParts.length - 2];
        folderAlbum = pathParts[pathParts.length - 1];
    } else if (pathParts.length === 1 && pathParts[0] !== '.') {
        // Structure: Album/Track.flac or Artist/Track.flac
        folderArtist = pathParts[0];
    }

    // Extract metadata tags
    const tags = metadata.common || {};

    return {
        // File info
        filePath,
        fileName: path.basename(filePath),
        fileSize: fileStats.size,
        fileExtension: path.extname(filePath).slice(1).toLowerCase(),
        relativePath,

        // Folder structure
        folderArtist,
        folderAlbum,
        folderPath: path.dirname(relativePath),

        // Metadata from file
        metadata: {
            title: tags.title || null,
            artist: tags.artist || null,
            albumArtist: tags.albumartist || null,
            album: tags.album || null,
            year: tags.year || null,
            track: tags.track?.no || null,
            trackTotal: tags.track?.of || null,
            disk: tags.disk?.no || null,
            diskTotal: tags.disk?.of || null,
            genre: tags.genre?.[0] || null,
            duration: metadata.format?.duration || null,
            bitrate: metadata.format?.bitrate || null,
            sampleRate: metadata.format?.sampleRate || null,
            hasArtwork: (tags.picture?.length || 0) > 0
        },

        // Plex compliance flags
        compliance: analyzePlexCompliance(
            filePath,
            relativePath,
            folderArtist,
            folderAlbum,
            tags
        )
    };
}

/**
 * Analyze if file structure and metadata comply with Plex standards
 * @param {string} filePath - Full file path
 * @param {string} relativePath - Path relative to music root
 * @param {string} folderArtist - Artist from folder structure
 * @param {string} folderAlbum - Album from folder structure
 * @param {Object} tags - Metadata tags from file
 * @returns {Object} Compliance analysis
 */
function analyzePlexCompliance(filePath, relativePath, folderArtist, folderAlbum, tags) {
    const issues = [];
    const fileName = path.basename(filePath);
    const pathParts = path.dirname(relativePath).split(path.sep);

    // Check folder structure depth
    // Plex expects: Artist/Album/Track.ext
    if (pathParts.length < 2 || pathParts[0] === '.') {
        issues.push({
            type: 'folder_structure',
            severity: 'error',
            message: 'File not in Artist/Album folder structure'
        });
    }

    // Check if album folder has year in parentheses
    if (folderAlbum && !folderAlbum.match(/\(\d{4}\)/)) {
        issues.push({
            type: 'album_year',
            severity: 'warning',
            message: 'Album folder missing year in format "Album (YYYY)"'
        });
    }

    // Check track number in filename
    // Plex prefers: "01 - Title.ext" or "01. Title.ext"
    if (!fileName.match(/^\d{1,2}\s*[-\.]\s*/)) {
        issues.push({
            type: 'track_number',
            severity: 'warning',
            message: 'Filename missing track number prefix (e.g., "01 - ")'
        });
    }

    // Check essential metadata
    if (!tags.title) {
        issues.push({
            type: 'metadata',
            severity: 'error',
            message: 'Missing title metadata'
        });
    }

    if (!tags.artist && !tags.albumartist) {
        issues.push({
            type: 'metadata',
            severity: 'error',
            message: 'Missing artist metadata'
        });
    }

    if (!tags.album) {
        issues.push({
            type: 'metadata',
            severity: 'error',
            message: 'Missing album metadata'
        });
    }

    if (!tags.track?.no) {
        issues.push({
            type: 'metadata',
            severity: 'warning',
            message: 'Missing track number metadata'
        });
    }

    // Check folder/metadata consistency
    if (folderArtist && tags.artist && folderArtist !== tags.artist && folderArtist !== tags.albumartist) {
        issues.push({
            type: 'consistency',
            severity: 'warning',
            message: `Folder artist "${folderArtist}" doesn't match metadata artist "${tags.artist || tags.albumartist}"`
        });
    }

    if (folderAlbum && tags.album) {
        // Remove year from folder name for comparison
        const folderAlbumClean = folderAlbum.replace(/\s*\(\d{4}\)\s*$/, '').trim();
        if (folderAlbumClean !== tags.album) {
            issues.push({
                type: 'consistency',
                severity: 'warning',
                message: `Folder album "${folderAlbumClean}" doesn't match metadata album "${tags.album}"`
            });
        }
    }

    return {
        isCompliant: issues.filter(i => i.severity === 'error').length === 0,
        issues,
        needsReorganization: issues.length > 0
    };
}

/**
 * Group scanned files by artist for alphabetical processing
 * @param {Array} scannedFiles - Array of scanned file objects
 * @returns {Object} Files grouped by artist first letter
 */
export function groupByArtist(scannedFiles) {
    const groups = {};

    for (const file of scannedFiles) {
        // Use metadata artist first, fall back to folder artist
        const artist = file.metadata.artist || file.metadata.albumArtist || file.folderArtist || 'Unknown';

        // Get first character (uppercase)
        let firstChar = artist.charAt(0).toUpperCase();

        // Group numbers and special characters together
        if (!/[A-Z]/.test(firstChar)) {
            firstChar = '#';
        }

        if (!groups[firstChar]) {
            groups[firstChar] = {
                letter: firstChar,
                artists: new Set(),
                files: []
            };
        }

        groups[firstChar].artists.add(artist);
        groups[firstChar].files.push(file);
    }

    // Convert artists Set to Array and add counts
    for (const key in groups) {
        groups[key].artists = Array.from(groups[key].artists);
        groups[key].artistCount = groups[key].artists.length;
        groups[key].fileCount = groups[key].files.length;
    }

    return groups;
}

/**
 * Generate scan summary statistics
 * @param {Array} scannedFiles - Array of scanned file objects
 * @returns {Object} Summary statistics
 */
export function generateScanSummary(scannedFiles) {
    const summary = {
        totalFiles: scannedFiles.length,
        compliantFiles: 0,
        filesNeedingReorganization: 0,
        issuesByType: {},
        artistCount: 0,
        albumCount: 0,
        formats: {},
        totalSize: 0,
        totalDuration: 0
    };

    const uniqueArtists = new Set();
    const uniqueAlbums = new Set();

    for (const file of scannedFiles) {
        // Count compliance
        if (file.compliance.isCompliant) {
            summary.compliantFiles++;
        }
        if (file.compliance.needsReorganization) {
            summary.filesNeedingReorganization++;
        }

        // Count issues by type
        for (const issue of file.compliance.issues) {
            if (!summary.issuesByType[issue.type]) {
                summary.issuesByType[issue.type] = 0;
            }
            summary.issuesByType[issue.type]++;
        }

        // Track unique artists and albums
        const artist = file.metadata.artist || file.metadata.albumArtist || file.folderArtist;
        if (artist) uniqueArtists.add(artist);

        const album = file.metadata.album || file.folderAlbum;
        if (album) uniqueAlbums.add(album);

        // Count formats
        const format = file.fileExtension.toUpperCase();
        summary.formats[format] = (summary.formats[format] || 0) + 1;

        // Sum size and duration
        summary.totalSize += file.fileSize;
        if (file.metadata.duration) {
            summary.totalDuration += file.metadata.duration;
        }
    }

    summary.artistCount = uniqueArtists.size;
    summary.albumCount = uniqueAlbums.size;

    return summary;
}
