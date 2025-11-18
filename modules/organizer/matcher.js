/**
 * Auto-Match & Rename Engine
 * Batch matches scanned files to MusicBrainz metadata and generates rename previews
 */

import { searchRecording, searchRelease } from './musicbrainz.js';
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

    for (const file of files) {
        try {
            // Extract metadata from file (provided by scanner)
            const artist = file.artist || '';
            const album = file.album || '';
            const title = file.title || '';

            // Skip files without basic metadata
            if (!artist || !title) {
                results.push({
                    filePath: file.path,
                    status: 'skipped',
                    reason: 'Missing artist or title metadata',
                    confidence: 0,
                    originalMetadata: { artist, album, title },
                    mbMatch: null
                });
                processedCount++;
                if (progressCallback) {
                    progressCallback({
                        processed: processedCount,
                        total: files.length,
                        progress: Math.round((processedCount / files.length) * 100),
                        currentFile: file.path
                    });
                }
                continue;
            }

            // Search MusicBrainz for recording
            console.log(`[Matcher] Searching MusicBrainz: ${artist} - ${album} - ${title}`);
            const mbResults = await searchRecording(artist, album, title, { limit: 1 });

            if (mbResults && mbResults.length > 0) {
                const topMatch = mbResults[0];

                // Categorize by confidence
                let category = 'manual';
                if (topMatch.confidence >= CONFIDENCE_THRESHOLDS.AUTO_APPROVE) {
                    category = 'auto_approve';
                } else if (topMatch.confidence >= CONFIDENCE_THRESHOLDS.REVIEW) {
                    category = 'review';
                }

                results.push({
                    filePath: file.path,
                    status: 'matched',
                    confidence: topMatch.confidence,
                    category: category,
                    originalMetadata: { artist, album, title },
                    mbMatch: {
                        artist: topMatch.artist,
                        artistId: topMatch.artistId,
                        title: topMatch.title,
                        recordingId: topMatch.id,
                        releases: topMatch.releases,
                        length: topMatch.length
                    },
                    fileInfo: {
                        format: file.format,
                        codec: file.codec,
                        bitrate: file.bitrate,
                        trackNumber: file.trackNumber,
                        year: file.year
                    }
                });
            } else {
                // No match found
                results.push({
                    filePath: file.path,
                    status: 'no_match',
                    reason: 'No MusicBrainz matches found',
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
                    progress: Math.round((processedCount / files.length) * 100),
                    currentFile: file.path
                });
            }

        } catch (error) {
            console.error(`[Matcher] Error matching file ${file.path}:`, error.message);
            results.push({
                filePath: file.path,
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
                    progress: Math.round((processedCount / files.length) * 100),
                    currentFile: file.path,
                    error: error.message
                });
            }
        }
    }

    return results;
}

/**
 * Generate Plex-compliant file path from MusicBrainz match
 * Format: {artist}/{album}/{track_number} - {title}.{ext}
 * @param {Object} matchResult - Match result from batchMatchFiles()
 * @param {String} basePath - Base directory path for renamed files
 * @returns {Object} Rename preview with before/after paths
 */
export function generateRenamePath(matchResult, basePath) {
    const { filePath, mbMatch, fileInfo, originalMetadata } = matchResult;

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

    // Track number (pad with leading zero)
    const trackNum = fileInfo?.trackNumber || 1;
    const trackNumPadded = String(trackNum).padStart(2, '0');

    // File extension
    const ext = path.extname(filePath);

    // Build Plex-compliant path
    let albumFolder = albumSafe;
    if (year) {
        albumFolder = `${albumSafe} (${year})`;
    }

    const newFilename = `${trackNumPadded} - ${titleSafe}${ext}`;
    const newPath = path.join(basePath, artistSafe, albumFolder, newFilename);

    return {
        originalPath: filePath,
        proposedPath: newPath,
        artist: artistSafe,
        album: albumFolder,
        filename: newFilename,
        changed: filePath !== newPath
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
 * Execute file rename operations
 * @param {Array} renameItems - Items to rename (from generateRenamePreviews)
 * @param {Boolean} dryRun - If true, don't actually rename files
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Array} Results of rename operations
 */
export async function executeRename(renameItems, dryRun = true, progressCallback = null) {
    const results = [];
    let processedCount = 0;

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
                const destDir = path.dirname(proposedPath);

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
