/**
 * File Organizer Module (Phase 4)
 * Handles moving/copying files to live Plex library with safety features
 */

import fs from 'fs/promises';
import { existsSync, statSync } from 'fs';
import path from 'path';
import { calculateQualityScore } from './plex.js';

// Global rollback history (in-memory for now)
let lastOperationHistory = [];

/**
 * Validate that a path exists and is accessible
 */
export function validatePath(dirPath) {
    if (!dirPath) {
        throw new Error('Path is required');
    }

    if (!existsSync(dirPath)) {
        throw new Error(`Path does not exist: ${dirPath}`);
    }

    const stats = statSync(dirPath);
    if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
    }

    return true;
}

/**
 * Check if a path is writable
 */
export async function isPathWritable(dirPath) {
    try {
        // Try to create a temp file
        const testFile = path.join(dirPath, `.write-test-${Date.now()}`);
        await fs.writeFile(testFile, 'test');
        await fs.unlink(testFile);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Sanitize filename to remove invalid characters
 */
export function sanitizeFilename(filename) {
    if (!filename) return '';

    return filename
        .replace(/[/\\:*?"<>|]/g, '_')  // Replace invalid chars
        .replace(/\s+/g, ' ')            // Normalize whitespace
        .replace(/\.+$/g, '')            // Remove trailing dots
        .trim();
}

/**
 * Generate unique filename if conflict exists
 */
export async function resolveFilenameConflict(destinationPath) {
    if (!existsSync(destinationPath)) {
        return destinationPath;
    }

    const dir = path.dirname(destinationPath);
    const ext = path.extname(destinationPath);
    const basename = path.basename(destinationPath, ext);

    let counter = 1;
    let newPath = destinationPath;

    while (existsSync(newPath)) {
        newPath = path.join(dir, `${basename} (${counter})${ext}`);
        counter++;
    }

    return newPath;
}

/**
 * Move or copy file with safety features
 */
export async function moveOrCopyFile(sourcePath, destinationPath, mode = 'copy', dryRun = false) {
    // Validate source exists
    if (!existsSync(sourcePath)) {
        throw new Error(`Source file does not exist: ${sourcePath}`);
    }

    // Create destination directory if needed
    const destDir = path.dirname(destinationPath);

    if (!dryRun) {
        await fs.mkdir(destDir, { recursive: true });
    }

    // Resolve filename conflicts
    const finalDestPath = await resolveFilenameConflict(destinationPath);

    if (dryRun) {
        // Dry run: just return what would happen
        return {
            success: true,
            action: mode,
            sourcePath,
            destinationPath: finalDestPath,
            conflictResolved: finalDestPath !== destinationPath,
            dryRun: true
        };
    }

    // Actually perform the operation
    if (mode === 'move') {
        await fs.rename(sourcePath, finalDestPath);
    } else {
        await fs.copyFile(sourcePath, finalDestPath);
        // Preserve timestamps
        const stats = await fs.stat(sourcePath);
        await fs.utimes(finalDestPath, stats.atime, stats.mtime);
    }

    return {
        success: true,
        action: mode,
        sourcePath,
        destinationPath: finalDestPath,
        conflictResolved: finalDestPath !== destinationPath,
        dryRun: false
    };
}

/**
 * Compare file quality for upgrade/downgrade detection
 * Returns: 'UPGRADE', 'DOWNGRADE', 'SAME', or 'NO_CONFLICT' (file doesn't exist)
 */
export function compareFileQuality(sourceFile, destFile) {
    // If destination doesn't exist, it's a new file
    if (!destFile || !existsSync(destFile.path)) {
        return 'NO_CONFLICT';
    }

    const sourceScore = calculateQualityScore(sourceFile.codec || sourceFile.format, sourceFile.bitrate);
    const destScore = calculateQualityScore(destFile.codec || destFile.format, destFile.bitrate);

    if (sourceScore > destScore) return 'UPGRADE';
    if (destScore > sourceScore) return 'DOWNGRADE';
    return 'SAME';
}

/**
 * Plan move operations with quality checks
 * @param {Array} files - Files from Phase 3.5 (renamed files with metadata)
 * @param {String} liveLibraryPath - Destination path for live library
 * @param {Array} plexTracks - Optional: Plex library tracks for quality comparison
 * @param {String} mode - 'move' or 'copy'
 * @returns {Object} Move plan with categorized operations
 */
export function planMoveOperations(files, liveLibraryPath, plexTracks = null, mode = 'copy') {
    const plan = {
        newFiles: [],        // Files not in Plex
        upgrades: [],        // Higher quality than Plex version
        downgrades: [],      // Lower quality than Plex version
        sameQuality: [],     // Same quality duplicates
        skipped: [],         // Files to skip
        summary: {
            total: files.length,
            newFiles: 0,
            upgrades: 0,
            downgrades: 0,
            sameQuality: 0,
            skipped: 0
        }
    };

    for (const file of files) {
        try {
            // Build destination path
            const relativePath = path.relative(file.basePath || '', file.path);
            const destinationPath = path.join(liveLibraryPath, relativePath);

            // Check if file exists in Plex library
            let plexMatch = null;
            if (plexTracks && Array.isArray(plexTracks)) {
                // Find matching track in Plex by artist/album/title
                plexMatch = plexTracks.find(track =>
                    normalizeString(track.artist) === normalizeString(file.artist) &&
                    normalizeString(track.album) === normalizeString(file.album) &&
                    normalizeString(track.title) === normalizeString(file.title)
                );
            }

            const operation = {
                sourcePath: file.path,
                destinationPath,
                file,
                plexMatch,
                mode
            };

            if (!plexMatch) {
                // New file not in Plex
                plan.newFiles.push(operation);
                plan.summary.newFiles++;
            } else {
                // Check quality
                const qualityComparison = compareFileQuality(file, plexMatch);

                if (qualityComparison === 'UPGRADE') {
                    plan.upgrades.push({ ...operation, action: 'REPLACE' });
                    plan.summary.upgrades++;
                } else if (qualityComparison === 'DOWNGRADE') {
                    plan.downgrades.push({ ...operation, action: 'SKIP', reason: 'Lower quality than Plex version' });
                    plan.summary.downgrades++;
                } else {
                    plan.sameQuality.push({ ...operation, action: 'SKIP', reason: 'Same quality already in Plex' });
                    plan.summary.sameQuality++;
                }
            }
        } catch (error) {
            plan.skipped.push({
                sourcePath: file.path,
                error: error.message,
                file
            });
            plan.summary.skipped++;
        }
    }

    return plan;
}

/**
 * Execute move operations with progress tracking
 * @param {Array} operations - Operations from planMoveOperations()
 * @param {Boolean} dryRun - If true, don't actually move files
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Array} Results of each operation
 */
export async function executeMoveOperations(operations, dryRun = true, progressCallback = null) {
    const results = [];
    const operationHistory = [];
    let processedCount = 0;

    for (const operation of operations) {
        try {
            const { sourcePath, destinationPath, mode, action } = operation;

            // Skip downgrades and same-quality duplicates
            if (action === 'SKIP') {
                results.push({
                    sourcePath,
                    destinationPath,
                    status: 'skipped',
                    reason: operation.reason || 'Skipped',
                    dryRun
                });

                processedCount++;
                if (progressCallback) {
                    progressCallback({
                        processed: processedCount,
                        total: operations.length,
                        progress: Math.round((processedCount / operations.length) * 100),
                        currentFile: sourcePath,
                        status: 'skipped'
                    });
                }
                continue;
            }

            // Handle upgrades (delete old file, move new one)
            if (action === 'REPLACE' && !dryRun) {
                // Delete old Plex file
                if (operation.plexMatch && operation.plexMatch.path && existsSync(operation.plexMatch.path)) {
                    await fs.unlink(operation.plexMatch.path);
                    operationHistory.push({
                        type: 'delete',
                        path: operation.plexMatch.path
                    });
                }
            }

            // Move or copy the file
            const result = await moveOrCopyFile(sourcePath, destinationPath, mode, dryRun);

            if (!dryRun && result.success) {
                operationHistory.push({
                    type: mode,
                    sourcePath: result.sourcePath,
                    destinationPath: result.destinationPath,
                    timestamp: Date.now()
                });
            }

            results.push({
                ...result,
                status: dryRun ? 'success_dry_run' : 'success',
                action: action || mode
            });

            processedCount++;
            if (progressCallback) {
                progressCallback({
                    processed: processedCount,
                    total: operations.length,
                    progress: Math.round((processedCount / operations.length) * 100),
                    currentFile: sourcePath,
                    status: 'success'
                });
            }

        } catch (error) {
            console.error(`[Organizer] Error processing ${operation.sourcePath}:`, error.message);
            results.push({
                sourcePath: operation.sourcePath,
                destinationPath: operation.destinationPath,
                status: 'error',
                error: error.message,
                dryRun
            });

            processedCount++;
            if (progressCallback) {
                progressCallback({
                    processed: processedCount,
                    total: operations.length,
                    progress: Math.round((processedCount / operations.length) * 100),
                    currentFile: operation.sourcePath,
                    status: 'error',
                    error: error.message
                });
            }
        }
    }

    // Save operation history for rollback
    if (!dryRun && operationHistory.length > 0) {
        lastOperationHistory = operationHistory;
    }

    return results;
}

/**
 * Rollback last move operation
 */
export async function rollbackLastOperation() {
    if (!lastOperationHistory || lastOperationHistory.length === 0) {
        throw new Error('No operation history to rollback');
    }

    const results = [];

    // Reverse the operations
    for (const operation of lastOperationHistory.reverse()) {
        try {
            if (operation.type === 'move') {
                // Move file back to original location
                if (existsSync(operation.destinationPath)) {
                    await fs.rename(operation.destinationPath, operation.sourcePath);
                    results.push({
                        success: true,
                        action: 'restored',
                        path: operation.sourcePath
                    });
                }
            } else if (operation.type === 'copy') {
                // Delete the copied file
                if (existsSync(operation.destinationPath)) {
                    await fs.unlink(operation.destinationPath);
                    results.push({
                        success: true,
                        action: 'deleted',
                        path: operation.destinationPath
                    });
                }
            } else if (operation.type === 'delete') {
                // Can't restore deleted files - warn user
                results.push({
                    success: false,
                    action: 'cannot_restore',
                    path: operation.path,
                    message: 'Deleted files cannot be automatically restored'
                });
            }
        } catch (error) {
            results.push({
                success: false,
                error: error.message,
                path: operation.sourcePath || operation.destinationPath || operation.path
            });
        }
    }

    // Clear history after rollback
    lastOperationHistory = [];

    return results;
}

/**
 * Trigger Plex library refresh
 */
export async function triggerPlexRefresh(serverIp, port, token, libraryId) {
    const url = `http://${serverIp}:${port}/library/sections/${libraryId}/refresh?X-Plex-Token=${token}`;

    try {
        const response = await fetch(url, { method: 'POST' });

        if (response.ok) {
            return {
                success: true,
                message: 'Plex library refresh triggered successfully'
            };
        } else {
            throw new Error(`Plex API returned status ${response.status}`);
        }
    } catch (error) {
        throw new Error(`Failed to trigger Plex refresh: ${error.message}`);
    }
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
