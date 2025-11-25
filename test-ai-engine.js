/**
 * Test script for AI Engine
 * Tests artist collaboration parsing with Claude CLI
 */

import { parseArtistWithAI, parseAlbumWithAI, parseTrackWithAI, isClaudeCLIAvailable } from './modules/organizer/ai-engine.js';

console.log('====================================');
console.log('AI Engine Test Suite');
console.log('====================================\n');

// Check if Claude CLI is available
console.log('Checking Claude CLI availability...');
const claudeAvailable = await isClaudeCLIAvailable();
console.log(`Claude CLI: ${claudeAvailable ? '✓ Available' : '✗ Not found'}\n`);

if (!claudeAvailable) {
    console.warn('WARNING: Claude CLI is not available. Tests will use fallback parser.');
    console.warn('This is expected behavior - the fallback parser is the primary method.\n');
}

// Artist test cases
const artistTestCases = [
    'Artist A feat. Artist B',
    'Artist A & Artist B',
    'Artist A featuring Artist B & Artist C',
    'Artist A vs Artist B',
    'Artist A with Artist B',
    'Artist A, Artist B, Artist C',
    'Artist A ft. Artist B',
    'Simple Artist',  // No collaboration
    'The Beatles',    // No collaboration
];

// Album test cases
const albumTestCases = [
    'Greatest Hits (feat. Artist B)',
    'The Album & Artist C',
    'Live at Venue (with Artist D)',
    'Remixes (feat. DJ X & Producer Y)',
    'Album Title ft. Artist E',
    'Simple Album',    // No collaboration
    'Abbey Road',      // No collaboration
];

// Track test cases
const trackTestCases = [
    'Song Title (feat. Artist B)',
    'Another Song feat. Artist C & Artist D',
    'Track Name (with Artist E)',
    'My Song ft. Artist F',
    'Dance Track (feat. Vocalist G)',
    'Simple Track',    // No collaboration
    'Hey Jude',        // No collaboration
];

console.log('====================================');
console.log('Running Artist Test Cases');
console.log('====================================\n');

for (const testCase of artistTestCases) {
    console.log(`\nTest: "${testCase}"`);
    console.log('-'.repeat(50));

    try {
        const result = await parseArtistWithAI(testCase);

        console.log(`Primary:    "${result.primary}"`);
        console.log(`Featured:   [${result.featured.map(f => `"${f}"`).join(', ')}]`);
        console.log(`Full:       "${result.full}"`);
        console.log(`Confidence: ${result.confidence}%`);

        // Validate result
        if (result.primary && result.featured !== undefined && result.confidence >= 0) {
            console.log('Status:     ✓ PASS');
        } else {
            console.log('Status:     ✗ FAIL - Invalid response structure');
        }

    } catch (error) {
        console.log(`Status:     ✗ FAIL - ${error.message}`);
    }
}

console.log('\n====================================');
console.log('Running Album Test Cases');
console.log('====================================\n');

for (const testCase of albumTestCases) {
    console.log(`\nTest: "${testCase}"`);
    console.log('-'.repeat(50));

    try {
        const result = await parseAlbumWithAI(testCase);

        console.log(`Primary:    "${result.primary}"`);
        console.log(`Featured:   [${result.featured.map(f => `"${f}"`).join(', ')}]`);
        console.log(`Full:       "${result.full}"`);
        console.log(`Confidence: ${result.confidence}%`);

        // Validate result
        if (result.primary && result.featured !== undefined && result.confidence >= 0) {
            console.log('Status:     ✓ PASS');
        } else {
            console.log('Status:     ✗ FAIL - Invalid response structure');
        }

    } catch (error) {
        console.log(`Status:     ✗ FAIL - ${error.message}`);
    }
}

console.log('\n====================================');
console.log('Running Track Test Cases');
console.log('====================================\n');

for (const testCase of trackTestCases) {
    console.log(`\nTest: "${testCase}"`);
    console.log('-'.repeat(50));

    try {
        const result = await parseTrackWithAI(testCase);

        console.log(`Primary:    "${result.primary}"`);
        console.log(`Featured:   [${result.featured.map(f => `"${f}"`).join(', ')}]`);
        console.log(`Full:       "${result.full}"`);
        console.log(`Confidence: ${result.confidence}%`);

        // Validate result
        if (result.primary && result.featured !== undefined && result.confidence >= 0) {
            console.log('Status:     ✓ PASS');
        } else {
            console.log('Status:     ✗ FAIL - Invalid response structure');
        }

    } catch (error) {
        console.log(`Status:     ✗ FAIL - ${error.message}`);
    }
}

console.log('\n====================================');
console.log('Test Suite Complete');
console.log('====================================');
