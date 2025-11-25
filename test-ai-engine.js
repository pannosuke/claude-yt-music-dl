/**
 * Test script for AI Engine
 * Tests artist collaboration parsing with Claude CLI
 */

import { parseArtistWithAI, isClaudeCLIAvailable } from './modules/organizer/ai-engine.js';

console.log('====================================');
console.log('AI Engine Test Suite');
console.log('====================================\n');

// Check if Claude CLI is available
console.log('Checking Claude CLI availability...');
const claudeAvailable = await isClaudeCLIAvailable();
console.log(`Claude CLI: ${claudeAvailable ? '✓ Available' : '✗ Not found'}\n`);

if (!claudeAvailable) {
    console.error('ERROR: Claude CLI is not available. Please install it first.');
    console.error('Installation: npm install -g @anthropic-ai/sdk');
    process.exit(1);
}

// Test cases
const testCases = [
    'Artist A feat. Artist B',
    'Artist A & Artist B',
    'Artist A featuring Artist B & Artist C',
    'Artist A vs Artist B',
    'Artist A with Artist B',
    'Artist A, Artist B, Artist C',
    'Artist A ft. Artist B',
    'Simple Artist',  // No collaboration
    'The Beatles',      // No collaboration
];

console.log('====================================');
console.log('Running Test Cases');
console.log('====================================\n');

for (const testCase of testCases) {
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
console.log('Test Suite Complete');
console.log('====================================');
