/**
 * Auto-Match & Rename Engine
 * Batch matches scanned files to MusicBrainz metadata and generates rename previews
 */

import { searchRecording, searchRelease, searchArtist } from './musicbrainz.js';
import { isRomaji, generateJapaneseSearchVariants } from './romaji-converter.js';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Confidence thresholds for match categorization
 */
const CONFIDENCE_THRESHOLDS = {
    AUTO_APPROVE: 90,    // ≥90%: Auto-approve
    REVIEW: 70,          // 70-89%: Manual review required
    MANUAL: 0            // <70%: Manual search required
};

/**
 * Normalize string for filename safety
 */
function sanitizeFilename(str) {
    if (!str) return '';

    // Remove or replace invalid OS filename characters
    return str
        .replace(/[/\\:*?"<>|]/g, '_')  // Replace invalid chars with underscore
        .replace(/\s+/g, ' ')            // Normalize whitespace
        .replace(/\.+$/g, '')            // Remove trailing dots
        .trim();
}

/**
 * Batch match scanned files to MusicBrainz
 * @param {Array} files - Array of file objects from scanner (with metadata)
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Array} Match results with confidence scores
 */
export async function batchMatchFiles(files, progressCallback = null) {
    const results = [];
    let processedCount = 0;

    //Group files by album for efficient matching
    const albumGroups = new Map();

    for (const file of files) {
        // Extract metadata - handle both flat and nested structures
        const metadata = file.metadata || file;
        const artist = metadata.artist || file.folderArtist || 'Unknown';
        const album = metadata.album || file.folderAlbum || 'Unknown';
        const title = metadata.title || file.fileName || 'Unknown';

        // Ensure filePath is always present - critical for rename operations
        const filePath = file.filePath || file.path;
        if (!filePath) {
            console.error('[Matcher] WARNING: File missing filePath. File keys:', Object.keys(file).join(', '));
            console.error('[Matcher] WARNING: File.filePath:', file.filePath, 'File.path:', file.path);
        }

        const albumKey = `${artist}|||${album}`.toLowerCase();

        if (!albumGroups.has(albumKey)) {
            albumGroups.set(albumKey, {
                artist,
                album,
                files: [],
                albumMatched: false,
                albumMatch: null
            });
        }

        albumGroups.get(albumKey).files.push({
            ...file,
            filePath: file.filePath, // Preserve absolute path from scanner
            relativePath: file.relativePath, // Preserve relative path from scanner
            artist,
            album,
            title,
            // Preserve fields needed for path reconstruction (fallback)
            fileName: file.fileName,
            folderArtist: file.folderArtist,
            folderAlbum: file.folderAlbum
        });
    }

    console.log(`[Matcher] Grouped ${files.length} files into ${albumGroups.size} albums`);

    // Step 1: Match albums first
    const matchedAlbums = new Map();
    let albumsProcessed = 0;

    for (const [albumKey, albumGroup] of albumGroups) {
        const { artist, album } = albumGroup;

        console.log(`[Matcher] Matching album: ${artist} - ${album}`);

        try {
            // Try matching the album
            let albumResults = await searchRelease(artist, album, { limit: 1 });
            let bestAlbumMatch = albumResults && albumResults.length > 0 ? albumResults[0] : null;
            let albumSearchMethod = 'original';

            // If album doesn't match, try Japanese variants
            if (!bestAlbumMatch || bestAlbumMatch.confidence < CONFIDENCE_THRESHOLDS.REVIEW) {
                const hasRomaji = isRomaji(artist) || isRomaji(album);

                if (hasRomaji) {
                    console.log(`[Matcher] Album has romaji, trying Japanese variants...`);
                    const variants = generateJapaneseSearchVariants({ artist, album, title: '' });

                    for (let i = 1; i < variants.length; i++) {
                        const variant = variants[i];
                        console.log(`[Matcher] Trying album variant: ${variant.artist} - ${variant.album}`);

                        const variantResults = await searchRelease(variant.artist, variant.album, { limit: 1 });

                        if (variantResults && variantResults.length > 0) {
                            const variantMatch = variantResults[0];

                            if (!bestAlbumMatch || variantMatch.confidence > bestAlbumMatch.confidence) {
                                bestAlbumMatch = variantMatch;
                                albumSearchMethod = i === 1 ? 'hiragana' : 'katakana';
                                console.log(`[Matcher] Found better album match with ${albumSearchMethod}: ${variantMatch.confidence}%`);

                                if (variantMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            if (bestAlbumMatch && bestAlbumMatch.confidence >= CONFIDENCE_THRESHOLDS.REVIEW) {
                matchedAlbums.set(albumKey, {
                    match: bestAlbumMatch,
                    searchMethod: albumSearchMethod
                });
                console.log(`[Matcher] Album matched: ${artist} - ${album} (${bestAlbumMatch.confidence}% confidence)`);
            } else {
                console.log(`[Matcher] Album not matched (skipping ${albumGroup.files.length} tracks): ${artist} - ${album}`);
            }
        } catch (error) {
            console.error(`[Matcher] Error matching album ${artist} - ${album}:`, error.message);
        }

        albumsProcessed++;
        if (progressCallback) {
            progressCallback({
                processed: albumsProcessed,
                total: albumGroups.size,
                progress: Math.round((albumsProcessed / albumGroups.size) * 50), // First 50% for albums
                currentFile: `Album: ${artist} - ${album}`
            });
        }
    }

    console.log(`[Matcher] Matched ${matchedAlbums.size}/${albumGroups.size} albums`);

    // Step 1.5: Normalize album names - use canonical release for albums with same MusicBrainz ID
    const releaseIdMap = new Map(); // Map of MusicBrainz release ID -> [albumKeys]

    for (const [albumKey, albumMatchInfo] of matchedAlbums) {
        const releaseId = albumMatchInfo.match.id;
        if (!releaseIdMap.has(releaseId)) {
            releaseIdMap.set(releaseId, []);
        }
        releaseIdMap.get(releaseId).push(albumKey);
    }

    // For each MusicBrainz release that has multiple album keys, choose canonical version
    for (const [releaseId, albumKeys] of releaseIdMap) {
        if (albumKeys.length > 1) {
            // Count files per album key to find the most common one
            const fileCounts = albumKeys.map(key => ({
                key,
                fileCount: albumGroups.get(key).files.length,
                matchInfo: matchedAlbums.get(key)
            }));

            // Sort by file count descending
            fileCounts.sort((a, b) => b.fileCount - a.fileCount);

            // Use the match with the most files as canonical
            const canonicalMatch = fileCounts[0].matchInfo;

            console.log(`[Matcher] Normalizing album: Found ${albumKeys.length} variants for MusicBrainz release ${releaseId}`);
            console.log(`[Matcher] Using canonical version: ${canonicalMatch.match.title} (${fileCounts[0].fileCount} files)`);

            // Update all variants to use the canonical match
            for (const albumKey of albumKeys) {
                matchedAlbums.set(albumKey, canonicalMatch);
            }
        }
    }

    // Step 2: Match tracks only for matched albums
    for (const [albumKey, albumGroup] of albumGroups) {
        const albumMatchInfo = matchedAlbums.get(albumKey);

        // Skip entire album if album didn't match
        if (!albumMatchInfo) {
            for (const file of albumGroup.files) {
                results.push({
                    filePath: file.filePath || file.path,
                    relativePath: file.relativePath,
                    fileName: file.fileName,
                    folderArtist: file.folderArtist,
                    folderAlbum: file.folderAlbum,
                    status: 'skipped',
                    reason: `Album not matched in MusicBrainz: ${albumGroup.artist} - ${albumGroup.album}`,
                    confidence: 0,
                    category: 'manual',
                    originalMetadata: {
                        artist: file.artist,
                        album: file.album,
                        title: file.title
                    },
                    mbMatch: null
                });

                processedCount++;
                if (progressCallback) {
                    progressCallback({
                        processed: processedCount,
                        total: files.length,
                        progress: 50 + Math.round((processedCount / files.length) * 50), // Second 50% for tracks
                        currentFile: file.filePath || file.path
                    });
                }
            }
            continue;
        }

        // Match tracks within this album
        for (const file of albumGroup.files) {
            try {
                const { artist, album, title } = file;

                // Skip files without title
                if (!title || title === 'Unknown') {
                    results.push({
                        filePath: file.filePath || file.path,
                        fileName: file.fileName,
                        folderArtist: file.folderArtist,
                        folderAlbum: file.folderAlbum,
                        status: 'skipped',
                        reason: 'Missing title metadata',
                        confidence: 0,
                        category: 'manual',
                        originalMetadata: { artist, album, title },
                        mbMatch: null
                    });
                    processedCount++;
                    if (progressCallback) {
                        progressCallback({
                            processed: processedCount,
                            total: files.length,
                            progress: 50 + Math.round((processedCount / files.length) * 50),
                            currentFile: file.filePath || file.path
                        });
                    }
                    continue;
                }

                // Search MusicBrainz for recording
                console.log(`[Matcher] Searching MusicBrainz: ${artist} - ${album} - ${title}`);
                let mbResults = await searchRecording(artist, album, title, { limit: 1 });
                let bestMatch = mbResults && mbResults.length > 0 ? mbResults[0] : null;
                let searchMethod = albumMatchInfo.searchMethod; // Inherit from album match

                // If no match found or low confidence, try Japanese variants if romaji detected
                if ((!bestMatch || bestMatch.confidence < CONFIDENCE_THRESHOLDS.REVIEW)) {
                    const hasRomaji = isRomaji(title);

                    if (hasRomaji) {
                        console.log(`[Matcher] Track title has romaji, generating Japanese variants...`);
                        const variants = generateJapaneseSearchVariants({ artist, album, title });

                        // Try each variant (skip first as it's the original)
                        for (let i = 1; i < variants.length; i++) {
                            const variant = variants[i];
                            console.log(`[Matcher] Trying variant ${i}: ${variant.artist} - ${variant.album} - ${variant.title}`);

                            const variantResults = await searchRecording(
                                variant.artist,
                                variant.album,
                                variant.title,
                                { limit: 1 }
                            );

                            if (variantResults && variantResults.length > 0) {
                                const variantMatch = variantResults[0];

                                // Use this variant if it's better than current best
                                if (!bestMatch || variantMatch.confidence > bestMatch.confidence) {
                                    bestMatch = variantMatch;
                                    searchMethod = i === 1 ? 'hiragana' : 'katakana';
                                    console.log(`[Matcher] Found better match with ${searchMethod}: ${variantMatch.confidence}% confidence`);

                                    // If we found a high-confidence match, no need to try more
                                    if (variantMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }

                if (bestMatch) {
                    // Categorize by confidence
                    let category = 'manual';
                    if (bestMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                        category = 'auto_approve';
                    } else if (bestMatch.confidence >= CONFIDENCE_THRESHOLDS.REVIEW) {
                        category = 'review';
                    }

                    const fileMetadata = file.metadata || {};
                    results.push({
                        filePath: file.filePath || file.path,
                        relativePath: file.relativePath,
                        fileName: file.fileName,
                        folderArtist: file.folderArtist,
                        folderAlbum: file.folderAlbum,
                        status: 'matched',
                        confidence: bestMatch.confidence,
                        category: category,
                        originalMetadata: { artist, album, title },
                        searchMethod: searchMethod, // Track which method found the match
                        mbMatch: {
                            artist: bestMatch.artist,
                            artistId: bestMatch.artistId,
                            title: bestMatch.title,
                            recordingId: bestMatch.id,
                            releases: bestMatch.releases,
                            length: bestMatch.length
                        },
                        fileInfo: {
                            format: fileMetadata.format || file.fileExtension,
                            codec: fileMetadata.codec,
                            bitrate: fileMetadata.bitrate,
                            trackNumber: fileMetadata.track,
                            year: fileMetadata.year
                        }
                    });
                } else {
                    // No match found even after trying variants
                    results.push({
                        filePath: file.filePath || file.path,
                        relativePath: file.relativePath,
                        fileName: file.fileName,
                        folderArtist: file.folderArtist,
                        folderAlbum: file.folderAlbum,
                        status: 'no_match',
                        reason: 'No MusicBrainz matches found (tried Japanese variants if applicable)',
                        confidence: 0,
                        category: 'manual',
                        originalMetadata: { artist, album, title },
                        mbMatch: null
                    });
                }

                processedCount++;
                if (progressCallback) {
                    progressCallback({
                        processed: processedCount,
                        total: files.length,
                        progress: 50 + Math.round((processedCount / files.length) * 50),
                        currentFile: file.filePath || file.path
                    });
                }

            } catch (error) {
                console.error(`[Matcher] Error matching file ${file.filePath || file.path}:`, error.message);
                results.push({
                    filePath: file.filePath || file.path,
                    fileName: file.fileName,
                    folderArtist: file.folderArtist,
                    folderAlbum: file.folderAlbum,
                    status: 'error',
                    reason: error.message,
                    confidence: 0,
                    category: 'manual',
                    originalMetadata: {
                        artist: file.artist || '',
                        album: file.album || '',
                        title: file.title || ''
                    },
                    mbMatch: null
                });

                processedCount++;
                if (progressCallback) {
                    progressCallback({
                        processed: processedCount,
                        total: files.length,
                        progress: 50 + Math.round((processedCount / files.length) * 50),
                        currentFile: file.filePath || file.path,
                        error: error.message
                    });
                }
            }
        }
    }

    return results;
}

/**
 * Extract track number from filename
 * Supports formats like: "01 - Title.flac", "01. Title.mp3", "Track 01.flac"
 * @param {String} filename - The filename to parse
 * @returns {Number|null} Track number or null if not found
 */
function extractTrackNumberFromFilename(filename) {
    if (!filename) return null;

    // Remove file extension
    const nameWithoutExt = path.basename(filename, path.extname(filename));

    // Pattern 1: "01 - Title" or "01. Title" or "01 Title"
    const pattern1 = /^(\d{1,3})\s*[-.\s]/;
    const match1 = nameWithoutExt.match(pattern1);
    if (match1) {
        const trackNum = parseInt(match1[1], 10);
        if (trackNum > 0 && trackNum < 100) return trackNum;
    }

    // Pattern 2: "Track 01" or "track01"
    const pattern2 = /track\s*(\d{1,3})/i;
    const match2 = nameWithoutExt.match(pattern2);
    if (match2) {
        const trackNum = parseInt(match2[1], 10);
        if (trackNum > 0 && trackNum < 100) return trackNum;
    }

    return null;
}

/**
 * Generate Plex-compliant file path from MusicBrainz match
 * Format: {artist}/{album}/{track_number} - {title}.{ext}
 * @param {Object} matchResult - Match result from batchMatchFiles()
 * @param {String} basePath - Base directory path for renamed files
 * @returns {Object} Rename preview with before/after paths
 */
export function generateRenamePath(matchResult, basePath) {
    const { mbMatch, fileInfo, originalMetadata } = matchResult;

    // Use filePath directly (should always be present now)
    let actualFilePath = matchResult.filePath;

    // Fallback: try using relativePath if filePath is missing
    if (!actualFilePath && matchResult.relativePath) {
        console.log('[generateRenamePath] filePath missing, using relativePath');
        actualFilePath = path.join(basePath, matchResult.relativePath);
    }

    // Last resort: reconstruct from components
    if (!actualFilePath && matchResult.fileName) {
        console.log('[generateRenamePath] Reconstructing file path from components');
        const pathParts = [basePath];
        if (matchResult.folderArtist) {
            pathParts.push(matchResult.folderArtist);
        }
        if (matchResult.folderAlbum) {
            pathParts.push(matchResult.folderAlbum);
        }
        pathParts.push(matchResult.fileName);
        actualFilePath = path.join(...pathParts);
        console.log('[generateRenamePath] Reconstructed path:', actualFilePath);
    }

    if (!actualFilePath) {
        console.error('[generateRenamePath] ERROR: Missing file path and cannot reconstruct!');
        console.error('[generateRenamePath] matchResult keys:', Object.keys(matchResult));
        throw new Error(`Missing file path in match result. Keys present: ${Object.keys(matchResult).join(', ')}`);
    }

    // Use MusicBrainz data if available, fallback to original metadata
    const artist = mbMatch?.artist || originalMetadata.artist;
    const title = mbMatch?.title || originalMetadata.title;

    // Get album from MusicBrainz releases (use first release if available)
    let album = originalMetadata.album;
    let year = fileInfo?.year || '';

    if (mbMatch && mbMatch.releases && mbMatch.releases.length > 0) {
        const primaryRelease = mbMatch.releases[0];
        album = primaryRelease.title;

        // Extract year from release date (format: YYYY-MM-DD)
        if (primaryRelease.date) {
            const yearMatch = primaryRelease.date.match(/^(\d{4})/);
            if (yearMatch) {
                year = yearMatch[1];
            }
        }
    }

    // Sanitize components
    const artistSafe = sanitizeFilename(artist);
    const albumSafe = sanitizeFilename(album);
    const titleSafe = sanitizeFilename(title);

    // Track number extraction (try multiple sources)
    let trackNum = null;

    // 1. Try extracting from filename (e.g., "01 - Title.flac")
    trackNum = extractTrackNumberFromFilename(matchResult.fileName);

    // 2. If not found in filename, try file metadata
    if (!trackNum && fileInfo?.trackNumber) {
        trackNum = fileInfo.trackNumber;
    }

    // 3. If still not found, omit track number (will use title only)
    const trackNumPadded = trackNum ? String(trackNum).padStart(2, '0') : null;

    // File extension
    const ext = path.extname(actualFilePath);

    // Build Plex-compliant path
    let albumFolder = albumSafe;
    if (year) {
        albumFolder = `${albumSafe} (${year})`;
    }

    // Build filename - include track number only if we found one
    const newFilename = trackNumPadded
        ? `${trackNumPadded} - ${titleSafe}${ext}`
        : `${titleSafe}${ext}`;
    const newPath = path.join(basePath, artistSafe, albumFolder, newFilename);

    return {
        originalPath: actualFilePath,
        proposedPath: newPath,
        artist: artistSafe,
        album: albumFolder,
        filename: newFilename,
        changed: actualFilePath !== newPath
    };
}

/**
 * Generate rename previews for all matched files
 * @param {Array} matchResults - Results from batchMatchFiles()
 * @param {String} basePath - Base directory for renamed files
 * @returns {Array} Rename previews grouped by category
 */
export function generateRenamePreviews(matchResults, basePath) {
    const previews = {
        auto_approve: [],
        review: [],
        manual: [],
        skipped: [],
        summary: {
            totalFiles: matchResults.length,
            autoApprove: 0,
            review: 0,
            manual: 0,
            skipped: 0
        }
    };

    for (const result of matchResults) {
        if (result.status === 'skipped' || result.status === 'error' || result.status === 'no_match') {
            previews.skipped.push({
                ...result,
                renamePreview: null
            });
            previews.summary.skipped++;
            continue;
        }

        const renamePreview = generateRenamePath(result, basePath);
        const previewItem = {
            ...result,
            renamePreview
        };

        if (result.category === 'auto_approve') {
            previews.auto_approve.push(previewItem);
            previews.summary.autoApprove++;
        } else if (result.category === 'review') {
            previews.review.push(previewItem);
            previews.summary.review++;
        } else {
            previews.manual.push(previewItem);
            previews.summary.manual++;
        }
    }

    return previews;
}

/**
 * Clean up empty directories recursively up to a base path
 * @param {String} dirPath - Directory to check and potentially remove
 * @param {String} basePath - Don't remove directories above this level
 */
async function cleanupEmptyDirectory(dirPath, basePath) {
    try {
        // Don't clean up the base path itself or paths above it
        if (!dirPath.startsWith(basePath) || dirPath === basePath) {
            return;
        }

        const entries = await fs.readdir(dirPath);

        // If directory is empty, remove it
        if (entries.length === 0) {
            console.log(`[Matcher] Removing empty directory: ${dirPath}`);
            await fs.rmdir(dirPath);

            // Recursively check parent directory
            const parentDir = path.dirname(dirPath);
            await cleanupEmptyDirectory(parentDir, basePath);
        }
    } catch (error) {
        // Ignore errors (directory might not be empty or might not exist)
        console.log(`[Matcher] Could not clean up directory ${dirPath}: ${error.message}`);
    }
}

/**
 * Execute file rename operations
 * @param {Array} renameItems - Items to rename (from generateRenamePreviews)
 * @param {Boolean} dryRun - If true, don't actually rename files
 * @param {Boolean} cleanupEmptyDirs - If true, remove empty directories after renaming
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Array} Results of rename operations
 */
export async function executeRename(renameItems, dryRun = true, cleanupEmptyDirs = true, progressCallback = null) {
    const results = [];
    let processedCount = 0;
    const sourceDirsToCleanup = new Set(); // Track source directories for cleanup

    for (const item of renameItems) {
        try {
            const { renamePreview } = item;

            if (!renamePreview || !renamePreview.changed) {
                results.push({
                    originalPath: item.filePath,
                    proposedPath: renamePreview?.proposedPath || item.filePath,
                    status: 'skipped',
                    message: 'No changes needed',
                    dryRun
                });
                processedCount++;
                if (progressCallback) {
                    progressCallback({
                        processed: processedCount,
                        total: renameItems.length,
                        progress: Math.round((processedCount / renameItems.length) * 100),
                        currentFile: item.filePath,
                        status: 'skipped'
                    });
                }
                continue;
            }

            const { originalPath, proposedPath } = renamePreview;

            if (dryRun) {
                // Dry-run mode: Just validate paths
                const fileExists = existsSync(originalPath);
                const destDir = path.dirname(proposedPath);

                results.push({
                    originalPath,
                    proposedPath,
                    status: fileExists ? 'success_dry_run' : 'error',
                    message: fileExists
                        ? `[DRY RUN] Would rename to ${proposedPath}`
                        : `Source file does not exist: ${originalPath}`,
                    dryRun: true
                });
            } else {
                // Actually rename the file
                const sourceDir = path.dirname(originalPath);
                const destDir = path.dirname(proposedPath);

                // Track source directory for cleanup (only if moving to a different directory)
                if (cleanupEmptyDirs && sourceDir !== destDir) {
                    sourceDirsToCleanup.add(sourceDir);
                }

                // Create destination directory if it doesn't exist
                await fs.mkdir(destDir, { recursive: true });

                // Check if destination file already exists
                if (existsSync(proposedPath)) {
                    // Add suffix to avoid overwriting
                    let counter = 1;
                    let newProposedPath = proposedPath;
                    const ext = path.extname(proposedPath);
                    const baseName = proposedPath.slice(0, -ext.length);

                    while (existsSync(newProposedPath)) {
                        newProposedPath = `${baseName} (${counter})${ext}`;
                        counter++;
                    }

                    // Rename with new path
                    await fs.rename(originalPath, newProposedPath);
                    results.push({
                        originalPath,
                        proposedPath: newProposedPath,
                        status: 'success_with_suffix',
                        message: `Renamed successfully (added suffix to avoid conflict)`,
                        dryRun: false
                    });
                } else {
                    // Rename normally
                    await fs.rename(originalPath, proposedPath);
                    results.push({
                        originalPath,
                        proposedPath,
                        status: 'success',
                        message: 'Renamed successfully',
                        dryRun: false
                    });
                }
            }

            processedCount++;
            if (progressCallback) {
                progressCallback({
                    processed: processedCount,
                    total: renameItems.length,
                    progress: Math.round((processedCount / renameItems.length) * 100),
                    currentFile: originalPath,
                    status: 'success'
                });
            }

        } catch (error) {
            console.error(`[Matcher] Rename error for ${item.filePath}:`, error.message);
            results.push({
                originalPath: item.filePath,
                proposedPath: item.renamePreview?.proposedPath || item.filePath,
                status: 'error',
                message: error.message,
                dryRun
            });

            processedCount++;
            if (progressCallback) {
                progressCallback({
                    processed: processedCount,
                    total: renameItems.length,
                    progress: Math.round((processedCount / renameItems.length) * 100),
                    currentFile: item.filePath,
                    status: 'error',
                    error: error.message
                });
            }
        }
    }

    // Clean up empty directories if requested and not in dry-run mode
    if (cleanupEmptyDirs && !dryRun && sourceDirsToCleanup.size > 0) {
        console.log(`[Matcher] Cleaning up ${sourceDirsToCleanup.size} potential empty directories...`);

        // Find a common base path (use the first item's directory as reference)
        const firstDir = Array.from(sourceDirsToCleanup)[0];
        const basePath = path.dirname(path.dirname(firstDir)); // Go up two levels to get to the music root

        // Clean up each source directory
        for (const dirPath of sourceDirsToCleanup) {
            await cleanupEmptyDirectory(dirPath, basePath);
        }

        console.log(`[Matcher] Directory cleanup complete`);
    }

    return results;
}

/**
 * Get match statistics for a batch of match results
 */
export function getMatchStatistics(matchResults) {
    const stats = {
        total: matchResults.length,
        matched: 0,
        noMatch: 0,
        skipped: 0,
        errors: 0,
        byCategory: {
            auto_approve: 0,
            review: 0,
            manual: 0
        },
        byConfidence: {
            high: 0,      // ≥90%
            medium: 0,    // 70-89%
            low: 0        // <70%
        }
    };

    for (const result of matchResults) {
        if (result.status === 'matched') {
            stats.matched++;
            if (result.category) {
                stats.byCategory[result.category]++;
            }
            if (result.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                stats.byConfidence.high++;
            } else if (result.confidence >= CONFIDENCE_THRESHOLDS.REVIEW) {
                stats.byConfidence.medium++;
            } else {
                stats.byConfidence.low++;
            }
        } else if (result.status === 'no_match') {
            stats.noMatch++;
        } else if (result.status === 'skipped') {
            stats.skipped++;
        } else if (result.status === 'error') {
            stats.errors++;
        }
    }

    return stats;
}

/**
 * ========================================
 * THREE-PHASE MUSICBRAINZ MATCHING SYSTEM
 * ========================================
 *
 * New matching strategy that separates artist, album, and track matching
 * into three distinct phases for better control and error correction.
 */

/**
 * Phase 1: Match Artists
 * Extract unique artists from files and match them to MusicBrainz
 *
 * @param {Array} files - Array of file objects from scanner
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Array} Artist match results with confidence scores
 */
export async function matchArtists(files, progressCallback = null) {
    const results = [];

    // Extract unique artists from files
    const artistMap = new Map();

    for (const file of files) {
        const metadata = file.metadata || file;
        const artist = metadata.artist || file.folderArtist || 'Unknown Artist';
        const folderArtist = file.folderArtist || artist; // Track actual folder name

        if (!artistMap.has(artist.toLowerCase())) {
            artistMap.set(artist.toLowerCase(), {
                artist,
                originalName: artist,
                folderName: folderArtist, // Store actual folder name on disk
                fileCount: 0,
                files: []
            });
        }

        const artistData = artistMap.get(artist.toLowerCase());
        artistData.fileCount++;
        artistData.files.push(file);

        // Update folderName if this file has a different folder (handles inconsistencies)
        if (file.folderArtist && !artistData.folderName) {
            artistData.folderName = file.folderArtist;
        }
    }

    console.log(`[Matcher] Phase 1: Matching ${artistMap.size} unique artists from ${files.length} files`);

    let processedCount = 0;
    const totalArtists = artistMap.size;

    // Match each unique artist to MusicBrainz
    for (const [artistKey, artistData] of artistMap) {
        try {
            const { artist } = artistData;

            console.log(`[Matcher] Searching artist: ${artist}`);

            // Search MusicBrainz for artist
            let artistResults = await searchArtist(artist, { limit: 1 });
            let bestMatch = artistResults && artistResults.length > 0 ? artistResults[0] : null;
            let searchMethod = 'original';

            // If artist doesn't match well, try Japanese variants
            if (!bestMatch || bestMatch.confidence < CONFIDENCE_THRESHOLDS.REVIEW) {
                const hasRomaji = isRomaji(artist);

                if (hasRomaji) {
                    console.log(`[Matcher] Artist has romaji, trying Japanese variants...`);
                    const variants = generateJapaneseSearchVariants({ artist, album: '', title: '' });

                    for (let i = 1; i < variants.length; i++) {
                        const variant = variants[i];
                        console.log(`[Matcher] Trying artist variant: ${variant.artist}`);

                        const variantResults = await searchArtist(variant.artist, { limit: 1 });

                        if (variantResults && variantResults.length > 0) {
                            const variantMatch = variantResults[0];

                            if (!bestMatch || variantMatch.confidence > bestMatch.confidence) {
                                bestMatch = variantMatch;
                                searchMethod = i === 1 ? 'hiragana' : 'katakana';
                                console.log(`[Matcher] Found better artist match with ${searchMethod}: ${variantMatch.confidence}%`);

                                if (variantMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Categorize based on confidence
            let category = 'manual';
            let status = 'matched';

            if (bestMatch) {
                if (bestMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                    category = 'auto_approve';
                } else if (bestMatch.confidence >= CONFIDENCE_THRESHOLDS.REVIEW) {
                    category = 'review';
                } else {
                    category = 'manual';
                }
            } else {
                status = 'no_match';
                category = 'manual';
            }

            results.push({
                originalArtist: artist,
                folderName: artistData.folderName, // Actual folder name on disk
                mbMatch: bestMatch ? {
                    artist: bestMatch.artist,
                    mbid: bestMatch.id,
                    sortName: bestMatch.sortName,
                    disambiguation: bestMatch.disambiguation
                } : null,
                confidence: bestMatch ? bestMatch.confidence : 0,
                category,
                status,
                searchMethod,
                fileCount: artistData.fileCount,
                files: artistData.files, // Include file list for rename operation
                accepted: category === 'auto_approve', // Auto-accept high confidence
                skipped: false,
                manualOverride: false
            });

            console.log(`[Matcher] Artist ${artist}: ${status} (${bestMatch ? bestMatch.confidence : 0}% confidence, ${artistData.fileCount} files)`);

        } catch (error) {
            console.error(`[Matcher] Error matching artist ${artistData.artist}:`, error.message);
            results.push({
                originalArtist: artistData.artist,
                folderName: artistData.folderName,
                mbMatch: null,
                confidence: 0,
                category: 'manual',
                status: 'error',
                error: error.message,
                fileCount: artistData.fileCount,
                files: artistData.files,
                accepted: false,
                skipped: false,
                manualOverride: false
            });
        }

        processedCount++;
        if (progressCallback) {
            progressCallback({
                processed: processedCount,
                total: totalArtists,
                progress: Math.round((processedCount / totalArtists) * 100),
                currentArtist: artistData.artist
            });
        }
    }

    console.log(`[Matcher] Phase 1 complete: Matched ${results.filter(r => r.status === 'matched').length}/${totalArtists} artists`);

    return results;
}

/**
 * Phase 2: Match Albums
 * Using corrected artist names from Phase 1, match albums to MusicBrainz
 *
 * @param {Array} files - Array of file objects from scanner
 * @param {Array} artistMatches - Results from Phase 1 (matchArtists)
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Array} Album match results with confidence scores
 */
export async function matchAlbums(files, artistMatches, progressCallback = null) {
    const results = [];

    // Create artist lookup map from Phase 1 results
    const artistLookup = new Map();
    const skippedArtists = new Set();

    for (const artistMatch of artistMatches) {
        // Track skipped artists
        if (artistMatch.skipped || !artistMatch.mbMatch) {
            skippedArtists.add(artistMatch.originalArtist.toLowerCase());
            continue;
        }

        // Use accepted artist name (either from MusicBrainz or manual override)
        const correctedArtist = artistMatch.manualOverride
            ? artistMatch.mbMatch.artist
            : (artistMatch.accepted ? artistMatch.mbMatch.artist : artistMatch.originalArtist);

        artistLookup.set(artistMatch.originalArtist.toLowerCase(), correctedArtist);
    }

    console.log(`[Matcher] Phase 2: Filtering out ${skippedArtists.size} skipped artist(s)`);

    // Group files by album (using corrected artist names)
    const albumMap = new Map();

    for (const file of files) {
        const metadata = file.metadata || file;
        const originalArtist = metadata.artist || file.folderArtist || 'Unknown Artist';

        // Skip files from artists that were skipped in Phase 1
        if (skippedArtists.has(originalArtist.toLowerCase())) {
            console.log(`[Matcher] Skipping file from skipped artist: ${originalArtist}`);
            continue;
        }

        const album = metadata.album || file.folderAlbum || 'Unknown Album';

        // Use corrected artist name from Phase 1, or original if not found
        const artist = artistLookup.get(originalArtist.toLowerCase()) || originalArtist;

        const albumKey = `${artist}|||${album}`.toLowerCase();

        if (!albumMap.has(albumKey)) {
            albumMap.set(albumKey, {
                artist,
                originalArtist,
                album,
                fileCount: 0,
                files: []
            });
        }

        const albumData = albumMap.get(albumKey);
        albumData.fileCount++;
        albumData.files.push(file);
    }

    console.log(`[Matcher] Phase 2: Matching ${albumMap.size} unique albums from ${files.length} files`);

    let processedCount = 0;
    const totalAlbums = albumMap.size;

    // Match each unique album to MusicBrainz
    for (const [albumKey, albumData] of albumMap) {
        try {
            const { artist, album, originalArtist } = albumData;

            console.log(`[Matcher] Searching album: ${artist} - ${album}`);

            // Search MusicBrainz for album
            let albumResults = await searchRelease(artist, album, { limit: 1 });
            let bestMatch = albumResults && albumResults.length > 0 ? albumResults[0] : null;
            let searchMethod = 'original';

            // If album doesn't match well, try Japanese variants
            if (!bestMatch || bestMatch.confidence < CONFIDENCE_THRESHOLDS.REVIEW) {
                const hasRomaji = isRomaji(artist) || isRomaji(album);

                if (hasRomaji) {
                    console.log(`[Matcher] Album has romaji, trying Japanese variants...`);
                    const variants = generateJapaneseSearchVariants({ artist, album, title: '' });

                    for (let i = 1; i < variants.length; i++) {
                        const variant = variants[i];
                        console.log(`[Matcher] Trying album variant: ${variant.artist} - ${variant.album}`);

                        const variantResults = await searchRelease(variant.artist, variant.album, { limit: 1 });

                        if (variantResults && variantResults.length > 0) {
                            const variantMatch = variantResults[0];

                            if (!bestMatch || variantMatch.confidence > bestMatch.confidence) {
                                bestMatch = variantMatch;
                                searchMethod = i === 1 ? 'hiragana' : 'katakana';
                                console.log(`[Matcher] Found better album match with ${searchMethod}: ${variantMatch.confidence}%`);

                                if (variantMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Categorize based on confidence
            let category = 'manual';
            let status = 'matched';

            if (bestMatch) {
                if (bestMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                    category = 'auto_approve';
                } else if (bestMatch.confidence >= CONFIDENCE_THRESHOLDS.REVIEW) {
                    category = 'review';
                } else {
                    category = 'manual';
                }
            } else {
                status = 'no_match';
                category = 'manual';
            }

            results.push({
                originalArtist,
                correctedArtist: artist,
                originalAlbum: album,
                mbMatch: bestMatch ? {
                    artist: bestMatch.artist,
                    album: bestMatch.title,
                    year: bestMatch.year,
                    mbid: bestMatch.id
                } : null,
                confidence: bestMatch ? bestMatch.confidence : 0,
                category,
                status,
                searchMethod,
                fileCount: albumData.fileCount,
                accepted: category === 'auto_approve',
                skipped: false,
                manualOverride: false
            });

            console.log(`[Matcher] Album ${artist} - ${album}: ${status} (${bestMatch ? bestMatch.confidence : 0}% confidence, ${albumData.fileCount} files)`);

        } catch (error) {
            console.error(`[Matcher] Error matching album ${albumData.artist} - ${albumData.album}:`, error.message);
            results.push({
                originalArtist: albumData.originalArtist,
                correctedArtist: albumData.artist,
                originalAlbum: albumData.album,
                mbMatch: null,
                confidence: 0,
                category: 'manual',
                status: 'error',
                error: error.message,
                fileCount: albumData.fileCount,
                accepted: false,
                skipped: false,
                manualOverride: false
            });
        }

        processedCount++;
        if (progressCallback) {
            progressCallback({
                processed: processedCount,
                total: totalAlbums,
                progress: Math.round((processedCount / totalAlbums) * 100),
                currentAlbum: `${albumData.artist} - ${albumData.album}`
            });
        }
    }

    console.log(`[Matcher] Phase 2 complete: Matched ${results.filter(r => r.status === 'matched').length}/${totalAlbums} albums`);

    return results;
}

/**
 * Phase 3: Match Tracks
 * Using corrected artist and album names from Phases 1 & 2, match individual tracks
 *
 * @param {Array} files - Array of file objects from scanner
 * @param {Array} artistMatches - Results from Phase 1 (matchArtists)
 * @param {Array} albumMatches - Results from Phase 2 (matchAlbums)
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Array} Track match results (same format as batchMatchFiles)
 */
export async function matchTracks(files, artistMatches, albumMatches, progressCallback = null) {
    const results = [];

    // Create artist lookup map and track skipped artists
    const artistLookup = new Map();
    const skippedArtists = new Set();

    for (const artistMatch of artistMatches) {
        if (artistMatch.skipped || !artistMatch.mbMatch) {
            skippedArtists.add(artistMatch.originalArtist.toLowerCase());
            continue;
        }

        const correctedArtist = artistMatch.manualOverride
            ? artistMatch.mbMatch.artist
            : (artistMatch.accepted ? artistMatch.mbMatch.artist : artistMatch.originalArtist);

        artistLookup.set(artistMatch.originalArtist.toLowerCase(), correctedArtist);
    }

    // Create album lookup map and track skipped albums
    const albumLookup = new Map();
    const skippedAlbums = new Set();

    for (const albumMatch of albumMatches) {
        const key = `${albumMatch.originalArtist}|||${albumMatch.originalAlbum}`.toLowerCase();

        if (albumMatch.skipped || !albumMatch.mbMatch) {
            skippedAlbums.add(key);
            continue;
        }

        albumLookup.set(key, albumMatch.mbMatch);
    }

    console.log(`[Matcher] Phase 3: Filtering out ${skippedArtists.size} skipped artist(s) and ${skippedAlbums.size} skipped album(s)`);
    console.log(`[Matcher] Phase 3: Matching ${files.length} individual tracks`);

    let processedCount = 0;
    let skippedCount = 0;

    // Match each file to MusicBrainz recording
    for (const file of files) {
        try {
            const metadata = file.metadata || file;
            const originalArtist = metadata.artist || file.folderArtist || 'Unknown Artist';
            const originalAlbum = metadata.album || file.folderAlbum || 'Unknown Album';

            // Skip files from skipped artists
            if (skippedArtists.has(originalArtist.toLowerCase())) {
                console.log(`[Matcher] Skipping track from skipped artist: ${originalArtist}`);
                skippedCount++;
                processedCount++;
                if (progressCallback) {
                    progressCallback({
                        processed: processedCount,
                        total: files.length,
                        progress: Math.round((processedCount / files.length) * 100),
                        currentFile: file.filePath || file.path
                    });
                }
                continue;
            }

            // Skip files from skipped albums
            const albumKey = `${originalArtist}|||${originalAlbum}`.toLowerCase();
            if (skippedAlbums.has(albumKey)) {
                console.log(`[Matcher] Skipping track from skipped album: ${originalArtist} - ${originalAlbum}`);
                skippedCount++;
                processedCount++;
                if (progressCallback) {
                    progressCallback({
                        processed: processedCount,
                        total: files.length,
                        progress: Math.round((processedCount / files.length) * 100),
                        currentFile: file.filePath || file.path
                    });
                }
                continue;
            }

            const title = metadata.title || file.fileName || 'Unknown';

            // Get corrected names from Phases 1 & 2
            const artist = artistLookup.get(originalArtist.toLowerCase()) || originalArtist;
            const albumMatch = albumLookup.get(albumKey);
            const album = albumMatch ? albumMatch.album : originalAlbum;

            console.log(`[Matcher] Searching track: ${artist} - ${album} - ${title}`);

            // Search MusicBrainz for recording
            let trackResults = await searchRecording(artist, album, title, { limit: 1 });
            let bestMatch = trackResults && trackResults.length > 0 ? trackResults[0] : null;
            let searchMethod = 'original';

            // If track doesn't match well, try Japanese variants
            if (!bestMatch || bestMatch.confidence < CONFIDENCE_THRESHOLDS.REVIEW) {
                const hasRomaji = isRomaji(artist) || isRomaji(album) || isRomaji(title);

                if (hasRomaji) {
                    console.log(`[Matcher] Track has romaji, trying Japanese variants...`);
                    const variants = generateJapaneseSearchVariants({ artist, album, title });

                    for (let i = 1; i < variants.length; i++) {
                        const variant = variants[i];
                        console.log(`[Matcher] Trying track variant: ${variant.artist} - ${variant.album} - ${variant.title}`);

                        const variantResults = await searchRecording(variant.artist, variant.album, variant.title, { limit: 1 });

                        if (variantResults && variantResults.length > 0) {
                            const variantMatch = variantResults[0];

                            if (!bestMatch || variantMatch.confidence > bestMatch.confidence) {
                                bestMatch = variantMatch;
                                searchMethod = i === 1 ? 'hiragana' : 'katakana';
                                console.log(`[Matcher] Found better track match with ${searchMethod}: ${variantMatch.confidence}%`);

                                if (variantMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Categorize based on confidence
            let category = 'manual';
            let status = 'matched';

            if (bestMatch) {
                if (bestMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                    category = 'auto_approve';
                } else if (bestMatch.confidence >= CONFIDENCE_THRESHOLDS.REVIEW) {
                    category = 'review';
                } else {
                    category = 'manual';
                }
            } else {
                status = 'no_match';
                category = 'manual';
            }

            results.push({
                filePath: file.filePath || file.path,
                relativePath: file.relativePath,
                fileName: file.fileName,
                folderArtist: file.folderArtist,
                folderAlbum: file.folderAlbum,
                status,
                confidence: bestMatch ? bestMatch.confidence : 0,
                category,
                originalMetadata: {
                    artist: originalArtist,
                    album: originalAlbum,
                    title
                },
                correctedMetadata: {
                    artist,
                    album,
                    title
                },
                searchMethod,
                mbMatch: bestMatch ? {
                    artist: bestMatch.artist,
                    album: bestMatch.album,
                    title: bestMatch.title,
                    year: bestMatch.year,
                    trackNumber: bestMatch.trackNumber,
                    mbid: bestMatch.id
                } : null,
                fileInfo: file,
                accepted: category === 'auto_approve',
                skipped: false,
                manualOverride: false
            });

        } catch (error) {
            console.error(`[Matcher] Error matching track ${file.filePath}:`, error.message);
            results.push({
                filePath: file.filePath || file.path,
                relativePath: file.relativePath,
                fileName: file.fileName,
                folderArtist: file.folderArtist,
                folderAlbum: file.folderAlbum,
                status: 'error',
                confidence: 0,
                category: 'manual',
                error: error.message,
                mbMatch: null,
                fileInfo: file,
                accepted: false,
                skipped: false,
                manualOverride: false
            });
        }

        processedCount++;
        if (progressCallback) {
            progressCallback({
                processed: processedCount,
                total: files.length,
                progress: Math.round((processedCount / files.length) * 100),
                currentFile: file.filePath || file.path
            });
        }
    }

    const matchedCount = results.filter(r => r.status === 'matched').length;
    console.log(`[Matcher] Phase 3 complete: Matched ${matchedCount}/${files.length} tracks`);
    if (skippedCount > 0) {
        console.log(`[Matcher] Skipped ${skippedCount} track(s) from skipped artists/albums`);
    }

    return results;
}
