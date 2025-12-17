/**
 * AI Engine for Music Organizer
 * Uses Claude CLI for intelligent artist parsing and matching assistance
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse artist name to extract primary artist and featured artists
 * Handles collaboration syntax like "feat.", "featuring", "&", "with", "vs", etc.
 *
 * @param {string} artistString - Raw artist string (e.g., "Artist A feat. Artist B & Artist C")
 * @returns {Promise<{primary: string, featured: string[], full: string, confidence: number}>}
 */
export async function parseArtistWithAI(artistString) {
    console.log(`[AI Engine] Parsing artist: "${artistString}"`);

    // Quick check - if no collaboration keywords, return as-is
    const collabKeywords = ['feat.', 'feat', 'featuring', 'ft.', 'ft', '&', 'and', 'with', 'vs', 'vs.', 'versus', ','];
    const hasCollaboration = collabKeywords.some(keyword =>
        artistString.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasCollaboration) {
        console.log(`[AI Engine] No collaboration keywords detected, returning as-is`);
        return {
            primary: artistString.trim(),
            featured: [],
            full: artistString.trim(),
            confidence: 100
        };
    }

    // Construct prompt for Claude CLI
    const prompt = `You are a music metadata parser. Parse this artist name and extract:
1. Primary artist (the main/first artist)
2. Featured artists (any collaborators)

Artist name: "${artistString}"

Examples:
- "Artist A feat. Artist B" → primary: "Artist A", featured: ["Artist B"]
- "Artist A & Artist B" → primary: "Artist A", featured: ["Artist B"]
- "Artist A, Artist B, Artist C" → primary: "Artist A", featured: ["Artist B", "Artist C"]
- "Artist A vs Artist B" → primary: "Artist A", featured: ["Artist B"]
- "Artist A with Artist B" → primary: "Artist A", featured: ["Artist B"]

Respond ONLY with valid JSON in this exact format (no markdown, no explanations):
{"primary": "Artist Name", "featured": ["Artist 1", "Artist 2"], "confidence": 95}

Confidence should be 0-100 based on how clear the parsing was.`;

    try {
        const result = await callClaudeCLI(prompt);

        // Parse JSON response
        const parsed = JSON.parse(result);

        // Validate response structure
        if (!parsed.primary || !Array.isArray(parsed.featured)) {
            throw new Error('Invalid AI response structure');
        }

        console.log(`[AI Engine] Parsed: primary="${parsed.primary}", featured=[${parsed.featured.join(', ')}], confidence=${parsed.confidence}`);

        return {
            primary: parsed.primary.trim(),
            featured: parsed.featured.map(f => f.trim()),
            full: artistString.trim(),
            confidence: parsed.confidence || 80
        };

    } catch (error) {
        console.error(`[AI Engine] Error parsing with AI: ${error.message}`);
        console.log(`[AI Engine] Falling back to simple parsing`);

        // Fallback: simple heuristic parsing
        return fallbackParse(artistString);
    }
}

/**
 * Parse album name to extract primary album and featured artists
 * Handles collaboration syntax like "(feat. X)", "(with X)", "& Artist", etc.
 *
 * @param {string} albumString - Raw album string (e.g., "Greatest Hits (feat. Artist B)")
 * @returns {Promise<{primary: string, featured: string[], full: string, confidence: number}>}
 */
export async function parseAlbumWithAI(albumString) {
    console.log(`[AI Engine] Parsing album: "${albumString}"`);

    // Quick check - if no collaboration keywords, return as-is
    const collabKeywords = ['feat.', 'feat', 'featuring', 'ft.', 'ft', '&', 'and', 'with', 'vs', 'vs.', 'versus', ',', '(', ')'];
    const hasCollaboration = collabKeywords.some(keyword =>
        albumString.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasCollaboration) {
        console.log(`[AI Engine] No collaboration keywords detected in album, returning as-is`);
        return {
            primary: albumString.trim(),
            featured: [],
            full: albumString.trim(),
            confidence: 100
        };
    }

    // Construct prompt for Claude CLI
    const prompt = `You are a music metadata parser. Parse this album name and extract:
1. Primary album title (the main title without featured artists)
2. Featured artists (any collaborators mentioned in parentheses or with keywords)

Album name: "${albumString}"

Examples:
- "Greatest Hits (feat. Artist B)" → primary: "Greatest Hits", featured: ["Artist B"]
- "The Album & Artist C" → primary: "The Album", featured: ["Artist C"]
- "Live at Venue (with Artist D)" → primary: "Live at Venue", featured: ["Artist D"]
- "Remixes, Artist E Edition" → primary: "Remixes", featured: ["Artist E"]

Respond ONLY with valid JSON in this exact format (no markdown, no explanations):
{"primary": "Album Title", "featured": ["Artist 1", "Artist 2"], "confidence": 95}

Confidence should be 0-100 based on how clear the parsing was.`;

    try {
        const result = await callClaudeCLI(prompt);

        // Parse JSON response
        const parsed = JSON.parse(result);

        // Validate response structure
        if (!parsed.primary || !Array.isArray(parsed.featured)) {
            throw new Error('Invalid AI response structure');
        }

        console.log(`[AI Engine] Album parsed: primary="${parsed.primary}", featured=[${parsed.featured.join(', ')}], confidence=${parsed.confidence}`);

        return {
            primary: parsed.primary.trim(),
            featured: parsed.featured.map(f => f.trim()),
            full: albumString.trim(),
            confidence: parsed.confidence || 80
        };

    } catch (error) {
        console.error(`[AI Engine] Error parsing album with AI: ${error.message}`);
        console.log(`[AI Engine] Falling back to simple album parsing`);

        // Fallback: simple heuristic parsing for albums
        return fallbackParseAlbum(albumString);
    }
}

/**
 * Parse track name to extract primary track title and featured artists
 * Handles collaboration syntax like "(feat. X)", "feat.", "&", "with", etc.
 *
 * @param {string} trackString - Raw track string (e.g., "Song Title (feat. Artist B)")
 * @returns {Promise<{primary: string, featured: string[], full: string, confidence: number}>}
 */
export async function parseTrackWithAI(trackString) {
    console.log(`[AI Engine] Parsing track: "${trackString}"`);

    // Quick check - if no collaboration keywords, return as-is
    const collabKeywords = ['feat.', 'feat', 'featuring', 'ft.', 'ft', '&', 'and', 'with', 'vs', 'vs.', 'versus', ',', '(', ')'];
    const hasCollaboration = collabKeywords.some(keyword =>
        trackString.toLowerCase().includes(keyword.toLowerCase())
    );

    if (!hasCollaboration) {
        console.log(`[AI Engine] No collaboration keywords detected in track, returning as-is`);
        return {
            primary: trackString.trim(),
            featured: [],
            full: trackString.trim(),
            confidence: 100
        };
    }

    // Construct prompt for Claude CLI
    const prompt = `You are a music metadata parser. Parse this track name and extract:
1. Primary track title (the main title without featured artists)
2. Featured artists (any collaborators)

Track name: "${trackString}"

Examples:
- "Song Title (feat. Artist B)" → primary: "Song Title", featured: ["Artist B"]
- "Another Song feat. Artist C & Artist D" → primary: "Another Song", featured: ["Artist C", "Artist D"]
- "Track Name (with Artist E)" → primary: "Track Name", featured: ["Artist E"]
- "My Song ft. Artist F" → primary: "My Song", featured: ["Artist F"]

Respond ONLY with valid JSON in this exact format (no markdown, no explanations):
{"primary": "Track Title", "featured": ["Artist 1", "Artist 2"], "confidence": 95}

Confidence should be 0-100 based on how clear the parsing was.`;

    try {
        const result = await callClaudeCLI(prompt);

        // Parse JSON response
        const parsed = JSON.parse(result);

        // Validate response structure
        if (!parsed.primary || !Array.isArray(parsed.featured)) {
            throw new Error('Invalid AI response structure');
        }

        console.log(`[AI Engine] Track parsed: primary="${parsed.primary}", featured=[${parsed.featured.join(', ')}], confidence=${parsed.confidence}`);

        return {
            primary: parsed.primary.trim(),
            featured: parsed.featured.map(f => f.trim()),
            full: trackString.trim(),
            confidence: parsed.confidence || 80
        };

    } catch (error) {
        console.error(`[AI Engine] Error parsing track with AI: ${error.message}`);
        console.log(`[AI Engine] Falling back to simple track parsing`);

        // Fallback: simple heuristic parsing for tracks
        return fallbackParseTrack(trackString);
    }
}

/**
 * Call Claude CLI with a prompt and return the response
 * @param {string} prompt - The prompt to send to Claude
 * @returns {Promise<string>} - Claude's response
 */
async function callClaudeCLI(prompt, timeout = 10000) {
    return new Promise((resolve, reject) => {
        // Use full path to claude CLI and inherit environment
        const claudePath = process.env.CLAUDE_PATH || '/Users/eric/.npm-global/bin/claude';
        const claude = spawn(claudePath, ['-p', prompt], {
            stdio: ['ignore', 'pipe', 'pipe'],  // Close stdin to prevent hanging
            env: { ...process.env, PATH: `${process.env.PATH}:/Users/eric/.npm-global/bin:/usr/local/bin` },
            detached: false
        });

        let stdout = '';
        let stderr = '';
        let timeoutHandle = null;

        // Set timeout
        timeoutHandle = setTimeout(() => {
            claude.kill('SIGKILL');  // Use SIGKILL for forceful termination
            reject(new Error(`Claude CLI timeout after ${timeout / 1000}s`));
        }, timeout);

        claude.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        claude.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        claude.on('close', (code) => {
            clearTimeout(timeoutHandle);

            if (code !== 0) {
                reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
            } else {
                // Clean up response - remove markdown code blocks if present
                let cleaned = stdout.trim();

                // Remove markdown JSON code blocks if present
                if (cleaned.startsWith('```json')) {
                    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                } else if (cleaned.startsWith('```')) {
                    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
                }

                resolve(cleaned.trim());
            }
        });

        claude.on('error', (err) => {
            clearTimeout(timeoutHandle);
            reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
        });
    });
}

/**
 * Fallback parser when AI fails
 * Simple heuristic-based parsing
 */
function fallbackParse(artistString) {
    console.log(`[AI Engine] Using fallback parser for: "${artistString}"`);

    const original = artistString.trim();

    // Try to split on common collaboration patterns
    const patterns = [
        /\s+feat\.?\s+/i,
        /\s+featuring\s+/i,
        /\s+ft\.?\s+/i,
        /\s+with\s+/i,
        /\s+vs\.?\s+/i,
        /\s+versus\s+/i,
        /\s+&\s+/,
        /\s*,\s*/
    ];

    for (const pattern of patterns) {
        if (pattern.test(original)) {
            const parts = original.split(pattern);
            const primary = parts[0].trim();
            const featured = parts.slice(1).map(p => p.trim()).filter(p => p.length > 0);

            return {
                primary,
                featured,
                full: original,
                confidence: 60  // Lower confidence for fallback
            };
        }
    }

    // No collaboration detected
    return {
        primary: original,
        featured: [],
        full: original,
        confidence: 50  // Low confidence since we couldn't parse properly
    };
}

/**
 * Fallback parser for album names when AI fails
 * Simple heuristic-based parsing
 */
function fallbackParseAlbum(albumString) {
    console.log(`[AI Engine] Using fallback parser for album: "${albumString}"`);

    const original = albumString.trim();

    // Check for parentheses first (most common for albums)
    const parenMatch = original.match(/^(.+?)\s*\((?:feat\.?|featuring|ft\.?|with)\s+(.+?)\)$/i);
    if (parenMatch) {
        const primary = parenMatch[1].trim();
        const featured = parenMatch[2].split(/\s*[&,]\s*/).map(f => f.trim()).filter(f => f.length > 0);
        console.log(`[AI Engine] Album parsed (parentheses): primary="${primary}", featured=[${featured.join(', ')}]`);
        return {
            primary,
            featured,
            full: original,
            confidence: 70
        };
    }

    // Try to split on common collaboration patterns
    const patterns = [
        /\s+feat\.?\s+/i,
        /\s+featuring\s+/i,
        /\s+ft\.?\s+/i,
        /\s+with\s+/i,
        /\s+&\s+/,
        /\s*,\s*/
    ];

    for (const pattern of patterns) {
        if (pattern.test(original)) {
            const parts = original.split(pattern);
            const primary = parts[0].trim();
            const featured = parts.slice(1).map(p => p.trim()).filter(p => p.length > 0);

            console.log(`[AI Engine] Album parsed (pattern): primary="${primary}", featured=[${featured.join(', ')}]`);
            return {
                primary,
                featured,
                full: original,
                confidence: 60
            };
        }
    }

    // No collaboration detected
    console.log(`[AI Engine] Album has no clear collaboration pattern, returning as-is`);
    return {
        primary: original,
        featured: [],
        full: original,
        confidence: 50
    };
}

/**
 * Fallback parser for track names when AI fails
 * Simple heuristic-based parsing
 */
function fallbackParseTrack(trackString) {
    console.log(`[AI Engine] Using fallback parser for track: "${trackString}"`);

    const original = trackString.trim();

    // Check for parentheses first (most common for tracks)
    const parenMatch = original.match(/^(.+?)\s*\((?:feat\.?|featuring|ft\.?|with)\s+(.+?)\)$/i);
    if (parenMatch) {
        const primary = parenMatch[1].trim();
        const featured = parenMatch[2].split(/\s*[&,]\s*/).map(f => f.trim()).filter(f => f.length > 0);
        console.log(`[AI Engine] Track parsed (parentheses): primary="${primary}", featured=[${featured.join(', ')}]`);
        return {
            primary,
            featured,
            full: original,
            confidence: 70
        };
    }

    // Try to split on common collaboration patterns
    const patterns = [
        /\s+feat\.?\s+/i,
        /\s+featuring\s+/i,
        /\s+ft\.?\s+/i,
        /\s+with\s+/i,
        /\s+vs\.?\s+/i,
        /\s+versus\s+/i,
        /\s+&\s+/,
        /\s*,\s*/
    ];

    for (const pattern of patterns) {
        if (pattern.test(original)) {
            const parts = original.split(pattern);
            const primary = parts[0].trim();
            const featured = parts.slice(1).map(p => p.trim()).filter(p => p.length > 0);

            console.log(`[AI Engine] Track parsed (pattern): primary="${primary}", featured=[${featured.join(', ')}]`);
            return {
                primary,
                featured,
                full: original,
                confidence: 60
            };
        }
    }

    // No collaboration detected
    console.log(`[AI Engine] Track has no clear collaboration pattern, returning as-is`);
    return {
        primary: original,
        featured: [],
        full: original,
        confidence: 50
    };
}

/**
 * Check if Claude CLI is available
 * @returns {Promise<boolean>}
 */
export async function isClaudeCLIAvailable() {
    try {
        const result = await new Promise((resolve, reject) => {
            const claude = spawn('which', ['claude']);

            claude.on('close', (code) => {
                resolve(code === 0);
            });

            claude.on('error', () => {
                resolve(false);
            });
        });

        if (result) {
            console.log('[AI Engine] Claude CLI is available');
        } else {
            console.warn('[AI Engine] Claude CLI not found in PATH');
        }

        return result;
    } catch (error) {
        console.warn('[AI Engine] Error checking Claude CLI availability:', error.message);
        return false;
    }
}

/**
 * AI-powered artist matching (fallback when MusicBrainz fails)
 * Analyzes artist name and suggests corrections or alternatives
 *
 * @param {string} artistName - Original artist name from metadata
 * @param {Array<Object>} files - Sample files from this artist for context
 * @returns {Promise<{suggested: string, confidence: number, reasoning: string}>}
 */
export async function matchArtistWithAI(artistName, files = []) {
    console.log(`[AI Engine] Attempting AI match for artist: "${artistName}"`);

    // Gather context from sample files
    const sampleSize = Math.min(5, files.length);
    const sampleFiles = files.slice(0, sampleSize);
    const trackTitles = sampleFiles
        .map(f => {
            const metadata = f.metadata || f;
            return metadata.title || f.fileName || '';
        })
        .filter(t => t && t !== 'Unknown')
        .slice(0, 5);

    const albumTitles = [...new Set(sampleFiles
        .map(f => {
            const metadata = f.metadata || f;
            return metadata.album || f.folderAlbum || '';
        })
        .filter(a => a && a !== 'Unknown' && a !== 'Unknown Album')
    )].slice(0, 3);

    const prompt = `You are a music metadata expert. A music file organizer couldn't find a match for this artist in MusicBrainz. Your task is to suggest the correct artist name or identify if this is a valid artist.

Artist name: "${artistName}"

Sample tracks from this artist:
${trackTitles.length > 0 ? trackTitles.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'No track titles available'}

Sample albums:
${albumTitles.length > 0 ? albumTitles.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'No album titles available'}

Analyze this information and determine:
1. Is this a real artist name or a placeholder/metadata error?
2. If it's a metadata error, what's the likely correct artist name based on the track/album context?
3. Could this be a typo, romanization variant, or alternate spelling?
4. If it seems like a compilation or "Various Artists" situation

Respond ONLY with valid JSON in this exact format (no markdown, no explanations):
{
  "isValid": true/false,
  "suggested": "Suggested Artist Name (or original if valid)",
  "confidence": 0-100,
  "reasoning": "Brief explanation of your analysis"
}

Examples:
- If artistName is "NA" or "Unknown" → isValid: false, suggest based on track analysis
- If artistName is a typo like "Beatels" → suggest "The Beatles"
- If artistName is romaji variant → suggest proper spelling if identifiable
- If artistName seems correct → suggested: same as original, isValid: true`;

    try {
        const result = await callClaudeCLI(prompt, 60000); // 60s timeout for AI artist matching
        const parsed = JSON.parse(result);

        // Validate response structure
        if (typeof parsed.isValid !== 'boolean' || !parsed.suggested || typeof parsed.confidence !== 'number') {
            throw new Error('Invalid AI response structure');
        }

        console.log(`[AI Engine] AI artist match: "${artistName}" → "${parsed.suggested}" (${parsed.confidence}% confidence)`);
        console.log(`[AI Engine] Reasoning: ${parsed.reasoning}`);

        return parsed;

    } catch (error) {
        console.error(`[AI Engine] AI artist matching failed: ${error.message}`);
        // Return original artist with low confidence
        return {
            isValid: false,
            suggested: artistName,
            confidence: 0,
            reasoning: `AI matching failed: ${error.message}`
        };
    }
}

/**
 * AI-powered album matching (fallback when MusicBrainz fails)
 * Analyzes track names to identify the album
 *
 * @param {string} artistName - Artist name (corrected if possible)
 * @param {string} albumName - Original album name from metadata
 * @param {Array<Object>} files - Track files from this album for context
 * @returns {Promise<{suggested: string, confidence: number, reasoning: string}>}
 */
export async function matchAlbumWithAI(artistName, albumName, files = []) {
    console.log(`[AI Engine] Attempting AI match for album: "${artistName} - ${albumName}"`);

    // Gather track context
    const trackTitles = files
        .map(f => {
            const metadata = f.metadata || f;
            return metadata.title || f.fileName || '';
        })
        .filter(t => t && t !== 'Unknown')
        .slice(0, 10); // Use up to 10 tracks for album identification

    const prompt = `You are a music metadata expert. A music file organizer couldn't find a match for this album in MusicBrainz. Your task is to identify the correct album name by analyzing the track listing.

Artist: "${artistName}"
Album name: "${albumName}"

Track listing:
${trackTitles.length > 0 ? trackTitles.map((t, i) => `${i + 1}. ${t}`).join('\n') : 'No track titles available'}

Analyze this information and determine:
1. Is this a real album or a placeholder folder (like "Unknown Album", "NA", "Disc 1", etc.)?
2. Based on the track names, can you identify what album this is?
3. Could the album name be a typo, romanization variant, or alternate release name?
4. Does the track listing suggest this is a compilation, greatest hits, or live album?

Respond ONLY with valid JSON in this exact format (no markdown, no explanations):
{
  "isValid": true/false,
  "suggested": "Suggested Album Name (or original if valid)",
  "confidence": 0-100,
  "reasoning": "Brief explanation of your analysis",
  "albumType": "studio/compilation/live/single/unknown"
}

Examples:
- If albumName is "Unknown Album" and tracks are from "Abbey Road" → suggest "Abbey Road"
- If albumName is partial match → suggest full correct name
- If tracks don't match a single album → suggest it's a compilation
- If albumName seems correct → suggested: same as original, isValid: true`;

    try {
        const result = await callClaudeCLI(prompt, 90000); // 90s timeout for AI album matching
        const parsed = JSON.parse(result);

        // Validate response structure
        if (typeof parsed.isValid !== 'boolean' || !parsed.suggested || typeof parsed.confidence !== 'number') {
            throw new Error('Invalid AI response structure');
        }

        console.log(`[AI Engine] AI album match: "${albumName}" → "${parsed.suggested}" (${parsed.confidence}% confidence)`);
        console.log(`[AI Engine] Reasoning: ${parsed.reasoning}`);

        return parsed;

    } catch (error) {
        console.error(`[AI Engine] AI album matching failed: ${error.message}`);
        // Return original album with low confidence
        return {
            isValid: false,
            suggested: albumName,
            confidence: 0,
            reasoning: `AI matching failed: ${error.message}`,
            albumType: 'unknown'
        };
    }
}

/**
 * Custom Claude query for user-provided prompts
 * Used by the "Ask Claude" button to get custom AI analysis
 *
 * @param {string} entityType - 'artist' or 'album'
 * @param {string} entityName - Original artist/album name
 * @param {string} userPrompt - Custom user question/hint
 * @param {Array} files - Associated audio files
 * @returns {Promise<{success: boolean, response: string, suggested?: string}>}
 */
export async function askClaudeCustom(entityType, entityName, userPrompt, files = []) {
    console.log(`[AI Engine] Custom Claude query for ${entityType}: "${entityName}"`);
    console.log(`[AI Engine] User prompt: "${userPrompt}"`);

    // Build context from file metadata
    let context = '';
    if (files.length > 0) {
        const tracks = files.slice(0, 5).map(f => {
            const parts = [];
            if (f.metadata?.title) parts.push(`Title: ${f.metadata.title}`);
            if (f.metadata?.album) parts.push(`Album: ${f.metadata.album}`);
            if (f.metadata?.artist) parts.push(`Artist: ${f.metadata.artist}`);
            return parts.length > 0 ? parts.join(', ') : f.fileName;
        });

        context = `\nSample tracks:\n${tracks.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
    }

    const prompt = `You are helping organize a music library. The user has a ${entityType} named "${entityName}" that couldn't be matched in MusicBrainz database.

${context}

User's question/hint: ${userPrompt}

Please provide:
1. Your analysis
2. If applicable, a suggested corrected name for the ${entityType}

Respond in JSON format:
{
    "analysis": "your detailed analysis here",
    "suggested": "corrected name if you can identify it, or null if you need more info",
    "confidence": 0-100
}`;

    try {
        const response = await callClaudeCLI(prompt, 60000); // 60 second timeout for custom queries
        const parsed = JSON.parse(response);

        return {
            success: true,
            analysis: parsed.analysis,
            suggested: parsed.suggested || null,
            confidence: parsed.confidence || 0
        };
    } catch (error) {
        console.error(`[AI Engine] Custom query failed: ${error.message}`);
        return {
            success: false,
            analysis: `Failed to get Claude response: ${error.message}`,
            suggested: null
        };
    }
}

export default {
    parseArtistWithAI,
    parseAlbumWithAI,
    parseTrackWithAI,
    isClaudeCLIAvailable,
    matchArtistWithAI,
    matchAlbumWithAI,
    askClaudeCustom
};
