/**
 * Metadata Updater Module
 * Updates audio file metadata tags after folder/file renames
 * Supports FLAC (via metaflac) and MP3/M4A/AAC/OGG (via ffmpeg)
 */

import fg from 'fast-glob';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs/promises';

// Supported audio formats
const FLAC_EXTENSIONS = ['.flac'];
const FFMPEG_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav'];
const ALL_AUDIO_EXTENSIONS = [...FLAC_EXTENSIONS, ...FFMPEG_EXTENSIONS];
const AUDIO_GLOB = `**/*.{${ALL_AUDIO_EXTENSIONS.map(e => e.slice(1)).join(',')}}`;

/**
 * Run a command with proper argument escaping (no shell interpretation)
 * @param {string} command - Command to run
 * @param {string[]} args - Array of arguments
 * @returns {Promise<string>} stdout output
 */
function runCommand(command, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr || `${command} exited with code ${code}`));
            }
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Run metaflac command with proper argument escaping (no shell interpretation)
 * @param {string[]} args - Array of arguments for metaflac
 * @returns {Promise<void>}
 */
function runMetaflac(args) {
    return runCommand('metaflac', args);
}

/**
 * Update metadata in an MP3/M4A/etc file using ffmpeg
 * @param {string} filePath - Path to audio file
 * @param {Object} metadata - Metadata to update {artist, albumArtist, album, title, year, track}
 * @returns {Promise<boolean>} Success status
 */
async function updateMetadataWithFFmpeg(filePath, metadata) {
    const ext = path.extname(filePath).toLowerCase();
    const tempPath = filePath + '.tmp' + ext;

    // Build ffmpeg metadata arguments
    const metadataArgs = [];

    if (metadata.artist !== undefined) {
        metadataArgs.push('-metadata', `artist=${metadata.artist}`);
    }
    if (metadata.albumArtist !== undefined) {
        metadataArgs.push('-metadata', `album_artist=${metadata.albumArtist}`);
    }
    if (metadata.album !== undefined) {
        metadataArgs.push('-metadata', `album=${metadata.album}`);
    }
    if (metadata.title !== undefined) {
        metadataArgs.push('-metadata', `title=${metadata.title}`);
    }
    if (metadata.year !== undefined && metadata.year) {
        metadataArgs.push('-metadata', `date=${metadata.year}`);
    }
    if (metadata.track !== undefined && metadata.track) {
        metadataArgs.push('-metadata', `track=${metadata.track}`);
    }

    if (metadataArgs.length === 0) {
        return false; // No metadata to update
    }

    try {
        // ffmpeg -i input.mp3 -c copy -metadata artist="New Artist" output.mp3
        const args = [
            '-i', filePath,
            '-c', 'copy',  // Copy streams without re-encoding
            ...metadataArgs,
            '-y',  // Overwrite output file
            tempPath
        ];

        await runCommand('ffmpeg', args);

        // Replace original with temp file
        await fs.unlink(filePath);
        await fs.rename(tempPath, filePath);

        return true;
    } catch (error) {
        // Clean up temp file if it exists
        try {
            await fs.unlink(tempPath);
        } catch {
            // Ignore cleanup errors
        }
        throw error;
    }
}

/**
 * Check if a file is a FLAC file
 */
function isFlacFile(filePath) {
    return FLAC_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

/**
 * Check if a file is supported by ffmpeg
 */
function isFFmpegFile(filePath) {
    return FFMPEG_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

/**
 * Update artist metadata in all audio files within a folder or single file
 * @param {string} folderOrFilePath - Path to artist folder or single audio file
 * @param {string} newArtist - New artist name to write to metadata
 * @param {Object} options - Options { isSingleFile: boolean }
 * @returns {Promise<number>} Number of files updated
 */
export async function updateArtistMetadata(folderOrFilePath, newArtist, options = {}) {
    let files = [];

    if (options.isSingleFile) {
        // Single file mode: update just this file
        files = [folderOrFilePath];
    } else {
        // Folder mode: find all audio files in the folder (FLAC, MP3, M4A, etc.)
        files = await fg(AUDIO_GLOB, {
            cwd: folderOrFilePath,
            absolute: true,
            onlyFiles: true
        });
    }

    console.log(`[Metadata] Found ${files.length} audio files to update artist metadata`);
    let updatedCount = 0;

    for (const filePath of files) {
        try {
            if (isFlacFile(filePath)) {
                // Use metaflac for FLAC files (preserves all metadata, no re-encoding)
                await runMetaflac(['--remove-tag=ARTIST', filePath]);
                await runMetaflac([`--set-tag=ARTIST=${newArtist}`, filePath]);
                await runMetaflac(['--remove-tag=ALBUMARTIST', filePath]);
                await runMetaflac([`--set-tag=ALBUMARTIST=${newArtist}`, filePath]);
            } else if (isFFmpegFile(filePath)) {
                // Use ffmpeg for MP3/M4A/etc files
                await updateMetadataWithFFmpeg(filePath, {
                    artist: newArtist,
                    albumArtist: newArtist
                });
            } else {
                console.log(`[Metadata] Skipping unsupported format: ${path.basename(filePath)}`);
                continue;
            }

            console.log(`[Metadata] Updated artist in: ${path.basename(filePath)}`);
            updatedCount++;
        } catch (error) {
            console.error(`[Metadata] Failed to update ${path.basename(filePath)}: ${error.message}`);
            // Continue processing other files
        }
    }

    return updatedCount;
}

/**
 * Update album metadata in all audio files within a folder
 * @param {string} folderPath - Path to album folder
 * @param {string} newAlbum - New album name to write to metadata
 * @returns {Promise<number>} Number of files updated
 */
export async function updateAlbumMetadata(folderPath, newAlbum) {
    const files = await fg(AUDIO_GLOB, {
        cwd: folderPath,
        absolute: true,
        onlyFiles: true
    });

    console.log(`[Metadata] Found ${files.length} audio files to update album metadata`);
    let updatedCount = 0;

    for (const filePath of files) {
        try {
            if (isFlacFile(filePath)) {
                // Use metaflac for FLAC files
                await runMetaflac(['--remove-tag=ALBUM', filePath]);
                await runMetaflac([`--set-tag=ALBUM=${newAlbum}`, filePath]);
            } else if (isFFmpegFile(filePath)) {
                // Use ffmpeg for MP3/M4A/etc files
                await updateMetadataWithFFmpeg(filePath, { album: newAlbum });
            } else {
                console.log(`[Metadata] Skipping unsupported format: ${path.basename(filePath)}`);
                continue;
            }

            console.log(`[Metadata] Updated album in: ${path.basename(filePath)}`);
            updatedCount++;
        } catch (error) {
            console.error(`[Metadata] Failed to update ${path.basename(filePath)}: ${error.message}`);
        }
    }

    return updatedCount;
}

/**
 * Update track metadata for a single file
 * @param {string} filePath - Path to audio file
 * @param {Object} metadata - Metadata to update {artist, albumArtist, album, title, year, track}
 * @returns {Promise<boolean>} Success status
 */
export async function updateTrackMetadata(filePath, metadata) {
    try {
        if (isFlacFile(filePath)) {
            // Use metaflac for FLAC files
            if (metadata.artist !== undefined) {
                await runMetaflac(['--remove-tag=ARTIST', filePath]);
                await runMetaflac([`--set-tag=ARTIST=${metadata.artist}`, filePath]);
            }

            if (metadata.albumArtist !== undefined) {
                await runMetaflac(['--remove-tag=ALBUMARTIST', filePath]);
                await runMetaflac([`--set-tag=ALBUMARTIST=${metadata.albumArtist}`, filePath]);
            }

            if (metadata.album !== undefined) {
                await runMetaflac(['--remove-tag=ALBUM', filePath]);
                await runMetaflac([`--set-tag=ALBUM=${metadata.album}`, filePath]);
            }

            if (metadata.title !== undefined) {
                await runMetaflac(['--remove-tag=TITLE', filePath]);
                await runMetaflac([`--set-tag=TITLE=${metadata.title}`, filePath]);
            }

            if (metadata.year !== undefined && metadata.year) {
                await runMetaflac(['--remove-tag=DATE', filePath]);
                await runMetaflac([`--set-tag=DATE=${metadata.year}`, filePath]);
            }

            if (metadata.track !== undefined && metadata.track) {
                await runMetaflac(['--remove-tag=TRACKNUMBER', filePath]);
                await runMetaflac([`--set-tag=TRACKNUMBER=${metadata.track}`, filePath]);
            }
        } else if (isFFmpegFile(filePath)) {
            // Use ffmpeg for MP3/M4A/etc files
            await updateMetadataWithFFmpeg(filePath, metadata);
        } else {
            console.log(`[Metadata] Skipping unsupported format: ${path.basename(filePath)}`);
            return false;
        }

        console.log(`[Metadata] Updated track: ${path.basename(filePath)}`);
        return true;
    } catch (error) {
        console.error(`[Metadata] Failed to update ${path.basename(filePath)}: ${error.message}`);
        return false;
    }
}
