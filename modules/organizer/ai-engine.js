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
 * Call Claude CLI with a prompt and return the response
 * @param {string} prompt - The prompt to send to Claude
 * @returns {Promise<string>} - Claude's response
 */
async function callClaudeCLI(prompt, timeout = 10000) {
    return new Promise((resolve, reject) => {
        const claude = spawn('claude', ['-p', prompt], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let timeoutHandle = null;

        // Set timeout
        timeoutHandle = setTimeout(() => {
            claude.kill('SIGTERM');
            reject(new Error('Claude CLI timeout after 10s'));
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

export default {
    parseArtistWithAI,
    isClaudeCLIAvailable
};
