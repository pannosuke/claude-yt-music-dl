/**
 * Metadata Updater Module
 * Updates audio file metadata tags after folder/file renames
 */

import fg from 'fast-glob';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Update artist metadata in all audio files within a folder
 * @param {string} folderPath - Path to artist folder
 * @param {string} newArtist - New artist name to write to metadata
 * @returns {Promise<number>} Number of files updated
 */
export async function updateArtistMetadata(folderPath, newArtist) {
    // Find all FLAC files in the folder
    const files = await fg('**/*.flac', {
        cwd: folderPath,
        absolute: true,
        onlyFiles: true
    });

    let updatedCount = 0;

    for (const filePath of files) {
        try {
            // Use metaflac (part of flac package) to update artist tag
            // This preserves all other metadata and doesn't re-encode
            await execAsync(`metaflac --remove-tag=ARTIST "${filePath}"`);
            await execAsync(`metaflac --set-tag=ARTIST="${newArtist}" "${filePath}"`);

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
    const files = await fg('**/*.flac', {
        cwd: folderPath,
        absolute: true,
        onlyFiles: true
    });

    let updatedCount = 0;

    for (const filePath of files) {
        try {
            await execAsync(`metaflac --remove-tag=ALBUM "${filePath}"`);
            await execAsync(`metaflac --set-tag=ALBUM="${newAlbum}" "${filePath}"`);

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
 * @param {Object} metadata - Metadata to update {artist, album, title, year, track}
 * @returns {Promise<boolean>} Success status
 */
export async function updateTrackMetadata(filePath, metadata) {
    try {
        const commands = [];

        // Remove existing tags
        if (metadata.artist !== undefined) {
            commands.push(`metaflac --remove-tag=ARTIST "${filePath}"`);
            commands.push(`metaflac --set-tag=ARTIST="${metadata.artist}" "${filePath}"`);
        }

        if (metadata.album !== undefined) {
            commands.push(`metaflac --remove-tag=ALBUM "${filePath}"`);
            commands.push(`metaflac --set-tag=ALBUM="${metadata.album}" "${filePath}"`);
        }

        if (metadata.title !== undefined) {
            commands.push(`metaflac --remove-tag=TITLE "${filePath}"`);
            commands.push(`metaflac --set-tag=TITLE="${metadata.title}" "${filePath}"`);
        }

        if (metadata.year !== undefined && metadata.year) {
            commands.push(`metaflac --remove-tag=DATE "${filePath}"`);
            commands.push(`metaflac --set-tag=DATE="${metadata.year}" "${filePath}"`);
        }

        if (metadata.track !== undefined && metadata.track) {
            commands.push(`metaflac --remove-tag=TRACKNUMBER "${filePath}"`);
            commands.push(`metaflac --set-tag=TRACKNUMBER="${metadata.track}" "${filePath}"`);
        }

        // Execute all commands
        for (const cmd of commands) {
            await execAsync(cmd);
        }

        console.log(`[Metadata] Updated track: ${path.basename(filePath)}`);
        return true;
    } catch (error) {
        console.error(`[Metadata] Failed to update ${path.basename(filePath)}: ${error.message}`);
        return false;
    }
}
