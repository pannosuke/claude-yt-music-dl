/**
 * Simple File Organizer
 * Organizes music files based on existing embedded metadata only
 * No MusicBrainz API calls - fast and simple reorganization
 */

import { parseFile } from 'music-metadata';
import fg from 'fast-glob';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scan directory and read metadata from all audio files
 */
export async function scanDirectory(sourcePath, progressCallback = null) {
    console.log(`[Simple Organizer] Scanning directory: ${sourcePath}`);

    // Find all audio files
    const audioFiles = await fg(['**/*.{flac,mp3,m4a,aac,ogg,opus,wav,aiff}'], {
        cwd: sourcePath,
        absolute: true,
        onlyFiles: true,
        caseSensitiveMatch: false
    });

    console.log(`[Simple Organizer] Found ${audioFiles.length} audio files`);

    const scannedFiles = [];
    let processedCount = 0;

    for (const filePath of audioFiles) {
        try {
            const metadata = await parseFile(filePath);
            const common = metadata.common;

            // Extract metadata with fallbacks
            const artist = common.artist || common.albumartist || 'Unknown Artist';
            const album = common.album || 'Unknown Album';
            const title = common.title || path.basename(filePath, path.extname(filePath));
            const trackNumber = common.track?.no || null;
            const year = common.year || null;
            const ext = path.extname(filePath);

            scannedFiles.push({
                originalPath: filePath,
                artist,
                album,
                title,
                trackNumber,
                year,
                extension: ext,
                hasMetadata: !!(common.artist && common.album && common.title)
            });

            processedCount++;

            if (progressCallback && processedCount % 10 === 0) {
                progressCallback({
                    type: 'progress',
                    message: `Scanned ${processedCount}/${audioFiles.length} files`,
                    processed: processedCount,
                    total: audioFiles.length
                });
            }

        } catch (error) {
            console.error(`[Simple Organizer] Error reading metadata from ${filePath}:`, error.message);
            // Skip files with read errors
        }
    }

    console.log(`[Simple Organizer] Successfully scanned ${scannedFiles.length} files`);

    // Group files by artist first letter
    const groupedByArtist = groupFilesByArtist(scannedFiles);

    return {
        files: scannedFiles,
        totalFiles: audioFiles.length,
        successfulScans: scannedFiles.length,
        stats: {
            withMetadata: scannedFiles.filter(f => f.hasMetadata).length,
            withoutMetadata: scannedFiles.filter(f => !f.hasMetadata).length
        },
        groupedByArtist
    };
}

/**
 * Group scanned files by artist first letter (A-Z, #)
 */
function groupFilesByArtist(scannedFiles) {
    const groups = {};

    for (const file of scannedFiles) {
        const artist = file.artist;

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
        groups[key].albumCount = new Set(groups[key].files.map(f => f.album)).size;
        groups[key].fileCount = groups[key].files.length;
    }

    return groups;
}

/**
 * Sanitize filename for safe filesystem usage
 */
function sanitizeFilename(name) {
    // Replace invalid filesystem characters
    return name
        .replace(/[/\\:*?"<>|]/g, '_')  // Replace invalid chars with underscore
        .replace(/\s+/g, ' ')            // Normalize whitespace
        .trim();
}

/**
 * Generate Plex-compliant file path from metadata
 */
function generatePlexPath(file, destinationRoot) {
    const artist = sanitizeFilename(file.artist);
    const album = sanitizeFilename(file.album);
    const title = sanitizeFilename(file.title);

    // Format track number with leading zero if present
    let filename;
    if (file.trackNumber) {
        const trackNum = String(file.trackNumber).padStart(2, '0');
        filename = `${trackNum} - ${title}${file.extension}`;
    } else {
        filename = `${title}${file.extension}`;
    }

    // Build path: {destination}/{Artist}/{Album}/{TrackNumber} - {Title}.ext
    const newPath = path.join(destinationRoot, artist, album, filename);

    return newPath;
}

/**
 * Preview organization - show before/after paths
 */
export function previewOrganization(scannedFiles, destinationPath) {
    console.log(`[Simple Organizer] Generating preview for ${scannedFiles.length} files`);

    const preview = scannedFiles.map(file => {
        const newPath = generatePlexPath(file, destinationPath);

        return {
            originalPath: file.originalPath,
            newPath: newPath,
            artist: file.artist,
            album: file.album,
            title: file.title,
            trackNumber: file.trackNumber,
            hasMetadata: file.hasMetadata,
            willMove: true  // All files will be moved
        };
    });

    // Group by artist and album for better display
    const grouped = preview.reduce((acc, item) => {
        const key = `${item.artist}|||${item.album}`;
        if (!acc[key]) {
            acc[key] = {
                artist: item.artist,
                album: item.album,
                files: []
            };
        }
        acc[key].files.push(item);
        return acc;
    }, {});

    return {
        preview,
        grouped: Object.values(grouped),
        stats: {
            totalFiles: preview.length,
            uniqueArtists: new Set(preview.map(p => p.artist)).size,
            uniqueAlbums: new Set(preview.map(p => `${p.artist}|||${p.album}`)).size,
            filesWithMetadata: preview.filter(p => p.hasMetadata).length,
            filesWithoutMetadata: preview.filter(p => !p.hasMetadata).length
        }
    };
}

/**
 * Execute organization - move/copy files to new structure
 */
export async function executeOrganization(previewData, options = {}, progressCallback = null) {
    const { dryRun = false, mode = 'copy' } = options;  // mode: 'copy' or 'move'

    console.log(`[Simple Organizer] ${dryRun ? 'DRY RUN' : 'EXECUTING'} organization (${mode} mode)`);
    console.log(`[Simple Organizer] Processing ${previewData.length} files`);

    const results = {
        successful: [],
        failed: [],
        skipped: []
    };

    for (let i = 0; i < previewData.length; i++) {
        const item = previewData[i];

        try {
            if (progressCallback) {
                progressCallback({
                    type: 'progress',
                    message: `Processing ${i + 1}/${previewData.length}: ${path.basename(item.originalPath)}`,
                    processed: i + 1,
                    total: previewData.length,
                    currentFile: path.basename(item.originalPath)
                });
            }

            // Skip if source and destination are the same
            if (item.originalPath === item.newPath) {
                results.skipped.push({
                    ...item,
                    reason: 'Source and destination are identical'
                });
                continue;
            }

            if (!dryRun) {
                // Create destination directory
                const destDir = path.dirname(item.newPath);
                if (!fs.existsSync(destDir)) {
                    fs.mkdirSync(destDir, { recursive: true });
                }

                // Check if destination file already exists
                if (fs.existsSync(item.newPath)) {
                    // Add suffix to avoid overwriting
                    let counter = 1;
                    let newPath = item.newPath;
                    const ext = path.extname(newPath);
                    const base = newPath.slice(0, -ext.length);

                    while (fs.existsSync(newPath)) {
                        newPath = `${base} (${counter})${ext}`;
                        counter++;
                    }

                    item.newPath = newPath;
                    console.log(`[Simple Organizer] File exists, using: ${path.basename(newPath)}`);
                }

                // Copy or move the file
                if (mode === 'copy') {
                    fs.copyFileSync(item.originalPath, item.newPath);
                } else if (mode === 'move') {
                    fs.renameSync(item.originalPath, item.newPath);
                }

                console.log(`[Simple Organizer] ${mode === 'copy' ? 'Copied' : 'Moved'}: ${path.basename(item.originalPath)} → ${item.newPath}`);
            }

            results.successful.push(item);

        } catch (error) {
            console.error(`[Simple Organizer] Error processing ${item.originalPath}:`, error.message);
            results.failed.push({
                ...item,
                error: error.message
            });
        }
    }

    const summary = {
        dryRun,
        mode,
        successful: results.successful.length,
        failed: results.failed.length,
        skipped: results.skipped.length,
        total: previewData.length
    };

    console.log(`[Simple Organizer] ${dryRun ? 'DRY RUN' : 'EXECUTION'} complete:`, summary);

    return {
        results,
        summary
    };
}

export default {
    scanDirectory,
    previewOrganization,
    executeOrganization
};
