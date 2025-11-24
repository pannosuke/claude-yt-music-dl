/**
 * Simple File Organizer Frontend
 * Metadata-only organization without MusicBrainz matching
 */

(function() {
'use strict';

// State variables
let scannedFiles = null;
let groupedByArtist = null;
let selectedGroups = new Set();
let previewData = null;

/**
 * Initialize the Simple Organizer module
 */
function initSimpleOrganizer() {
    console.log('[Simple Organizer] Initializing module');

    // Load saved settings from localStorage
    loadSettings();

    // Setup event listeners
    const scanBtn = document.getElementById('simpleOrgScanBtn');
    const previewBtn = document.getElementById('simpleOrgPreviewBtn');
    const executeBtn = document.getElementById('simpleOrgExecuteBtn');

    if (scanBtn) {
        scanBtn.addEventListener('click', handleScan);
    }

    if (previewBtn) {
        previewBtn.addEventListener('click', handlePreview);
    }

    if (executeBtn) {
        executeBtn.addEventListener('click', handleExecute);
    }

    // Show the module
    const module = document.getElementById('module-simple-organizer');
    if (module) {
        module.classList.add('active');
    }
}

/**
 * Load settings from localStorage
 */
function loadSettings() {
    const sourcePath = localStorage.getItem('simpleOrgSourcePath');
    const destPath = localStorage.getItem('simpleOrgDestPath');
    const mode = localStorage.getItem('simpleOrgMode');

    if (sourcePath) document.getElementById('simpleOrgSourcePath').value = sourcePath;
    if (destPath) document.getElementById('simpleOrgDestPath').value = destPath;
    if (mode) document.getElementById('simpleOrgMode').value = mode;
}

/**
 * Save settings to localStorage
 */
function saveSettings() {
    const sourcePath = document.getElementById('simpleOrgSourcePath').value.trim();
    const destPath = document.getElementById('simpleOrgDestPath').value.trim();
    const mode = document.getElementById('simpleOrgMode').value;

    localStorage.setItem('simpleOrgSourcePath', sourcePath);
    localStorage.setItem('simpleOrgDestPath', destPath);
    localStorage.setItem('simpleOrgMode', mode);
}

/**
 * Handle scan button click
 */
async function handleScan() {
    const sourcePath = document.getElementById('simpleOrgSourcePath').value.trim();

    if (!sourcePath) {
        alert('Please enter a source directory');
        return;
    }

    saveSettings();

    // Reset state
    scannedFiles = null;
    previewData = null;

    // Disable buttons
    document.getElementById('simpleOrgScanBtn').disabled = true;
    document.getElementById('simpleOrgPreviewBtn').disabled = true;
    document.getElementById('simpleOrgExecuteBtn').disabled = true;

    // Show progress
    const progressDiv = document.getElementById('simpleOrgScanProgress');
    const resultsDiv = document.getElementById('simpleOrgScanResults');
    const previewDiv = document.getElementById('simpleOrgPreview');
    const executeResultsDiv = document.getElementById('simpleOrgExecuteResults');

    progressDiv.style.display = 'block';
    progressDiv.innerHTML = '<p>Starting scan...</p>';
    resultsDiv.style.display = 'none';
    previewDiv.style.display = 'none';
    executeResultsDiv.style.display = 'none';

    try {
        const response = await fetch('/api/simple-organize/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sourcePath })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));

                    if (data.type === 'progress') {
                        progressDiv.innerHTML = `<p>${data.status || 'Scanning...'}</p>`;
                    } else if (data.type === 'complete') {
                        scannedFiles = data.scanResults.files;
                        groupedByArtist = data.scanResults.groupedByArtist;

                        const stats = data.scanResults.stats;
                        const totalFiles = data.scanResults.totalFiles;
                        const successfulScans = data.scanResults.successfulScans;

                        // Show results
                        progressDiv.style.display = 'none';
                        resultsDiv.style.display = 'block';

                        resultsDiv.querySelector('.scan-stats').innerHTML = `
                            <div class="stat-card">
                                <div class="stat-label">Total Files Found</div>
                                <div class="stat-value">${totalFiles}</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Successfully Scanned</div>
                                <div class="stat-value">${successfulScans}</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">With Metadata</div>
                                <div class="stat-value">${stats.withMetadata}</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Missing Metadata</div>
                                <div class="stat-value">${stats.withoutMetadata}</div>
                            </div>
                        `;

                        // Display alphabetical groups
                        displayAlphabetGroups(groupedByArtist);

                        // Enable scan button, but not preview yet (need to select groups first)
                        document.getElementById('simpleOrgScanBtn').disabled = false;

                        console.log('[Simple Organizer] Scan complete:', data.scanResults);
                    } else if (data.type === 'error') {
                        progressDiv.innerHTML = `<p class="error-message">Error: ${data.error}</p>`;
                        document.getElementById('simpleOrgScanBtn').disabled = false;
                    }
                }
            }
        }

    } catch (error) {
        progressDiv.innerHTML = `<p class="error-message">Scan error: ${error.message}</p>`;
        document.getElementById('simpleOrgScanBtn').disabled = false;
    }
}

/**
 * Handle preview button click
 */
async function handlePreview() {
    const destPath = document.getElementById('simpleOrgDestPath').value.trim();

    if (!destPath) {
        alert('Please enter a destination directory');
        return;
    }

    if (!groupedByArtist || Object.keys(groupedByArtist).length === 0) {
        alert('No scanned files. Please scan first.');
        return;
    }

    if (selectedGroups.size === 0) {
        alert('Please select at least one letter group to organize.');
        return;
    }

    saveSettings();

    // Filter files to only include selected groups
    const selectedFiles = [];
    for (const letter of selectedGroups) {
        if (groupedByArtist[letter]) {
            selectedFiles.push(...groupedByArtist[letter].files);
        }
    }

    console.log('[Simple Organizer] Generating preview for', selectedFiles.length, 'files from', selectedGroups.size, 'groups');

    // Disable buttons
    document.getElementById('simpleOrgPreviewBtn').disabled = true;

    const previewDiv = document.getElementById('simpleOrgPreview');
    previewDiv.style.display = 'block';
    previewDiv.querySelector('.preview-stats').innerHTML = '<p>Generating preview...</p>';

    try {
        const response = await fetch('/api/simple-organize/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: selectedFiles,
                destinationPath: destPath
            })
        });

        const result = await response.json();

        if (result.success) {
            previewData = result.preview;

            // Show preview stats
            previewDiv.querySelector('.preview-stats').innerHTML = `
                <p><strong>${previewData.length} files</strong> will be organized</p>
                <p>Format: <code>{Artist}/{Album}/{TrackNumber} - {Title}.ext</code></p>
            `;

            // Render preview table
            const tbody = document.querySelector('#simpleOrgPreviewTable tbody');
            tbody.innerHTML = previewData.map(item => `
                <tr>
                    <td title="${item.originalPath}">${truncatePath(item.originalPath, 60)}</td>
                    <td>→</td>
                    <td title="${item.newPath}">${truncatePath(item.newPath, 60)}</td>
                </tr>
            `).join('');

            // Enable execute button
            document.getElementById('simpleOrgPreviewBtn').disabled = false;
            document.getElementById('simpleOrgExecuteBtn').disabled = false;

            console.log('[Simple Organizer] Preview generated:', previewData.length, 'items');

        } else {
            previewDiv.querySelector('.preview-stats').innerHTML = `<p class="error-message">Error: ${result.error}</p>`;
            document.getElementById('simpleOrgPreviewBtn').disabled = false;
        }

    } catch (error) {
        previewDiv.querySelector('.preview-stats').innerHTML = `<p class="error-message">Preview error: ${error.message}</p>`;
        document.getElementById('simpleOrgPreviewBtn').disabled = false;
    }
}

/**
 * Handle execute button click
 */
async function handleExecute() {
    if (!previewData || previewData.length === 0) {
        alert('No preview data. Please generate preview first.');
        return;
    }

    const mode = document.getElementById('simpleOrgMode').value;

    const confirmMsg = mode === 'move'
        ? `⚠️ MOVE MODE: This will remove original files after organizing.\n\nProceed with organizing ${previewData.length} files?`
        : `Proceed with organizing ${previewData.length} files? (Original files will be kept)`;

    if (!confirm(confirmMsg)) {
        return;
    }

    // Disable buttons
    document.getElementById('simpleOrgScanBtn').disabled = true;
    document.getElementById('simpleOrgPreviewBtn').disabled = true;
    document.getElementById('simpleOrgExecuteBtn').disabled = true;

    // Show progress
    const progressDiv = document.getElementById('simpleOrgExecuteProgress');
    const resultsDiv = document.getElementById('simpleOrgExecuteResults');

    progressDiv.style.display = 'block';
    progressDiv.innerHTML = '<p>Starting organization...</p>';
    resultsDiv.style.display = 'none';

    try {
        const response = await fetch('/api/simple-organize/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                previewData,
                dryRun: false,
                mode
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));

                    if (data.type === 'progress') {
                        progressDiv.innerHTML = `<p>${data.status || 'Processing...'}</p>`;
                    } else if (data.type === 'complete') {
                        const summary = data.summary;

                        // Show results
                        progressDiv.style.display = 'none';
                        resultsDiv.style.display = 'block';

                        resultsDiv.innerHTML = `
                            <h3>Organization Complete!</h3>
                            <div class="result-summary">
                                <div class="stat-card success">
                                    <div class="stat-label">Successful</div>
                                    <div class="stat-value">${summary.successful}</div>
                                </div>
                                <div class="stat-card failed">
                                    <div class="stat-label">Failed</div>
                                    <div class="stat-value">${summary.failed}</div>
                                </div>
                                <div class="stat-card skipped">
                                    <div class="stat-label">Skipped</div>
                                    <div class="stat-value">${summary.skipped}</div>
                                </div>
                            </div>
                            <p class="success-message">${data.message}</p>
                        `;

                        // Re-enable scan button for new operations
                        document.getElementById('simpleOrgScanBtn').disabled = false;

                        console.log('[Simple Organizer] Organization complete:', summary);
                    } else if (data.type === 'error') {
                        progressDiv.innerHTML = `<p class="error-message">Error: ${data.error}</p>`;
                        document.getElementById('simpleOrgScanBtn').disabled = false;
                        document.getElementById('simpleOrgPreviewBtn').disabled = false;
                        document.getElementById('simpleOrgExecuteBtn').disabled = false;
                    }
                }
            }
        }

    } catch (error) {
        progressDiv.innerHTML = `<p class="error-message">Execution error: ${error.message}</p>`;
        document.getElementById('simpleOrgScanBtn').disabled = false;
        document.getElementById('simpleOrgPreviewBtn').disabled = false;
        document.getElementById('simpleOrgExecuteBtn').disabled = false;
    }
}

/**
 * Display alphabetical artist groups
 */
function displayAlphabetGroups(groupedByArtist) {
    const resultsDiv = document.getElementById('simpleOrgScanResults');

    // Create or get groups container
    let groupsContainer = document.getElementById('simpleOrgGroups');
    if (!groupsContainer) {
        groupsContainer = document.createElement('div');
        groupsContainer.id = 'simpleOrgGroups';
        groupsContainer.style.display = 'none';
        resultsDiv.appendChild(groupsContainer);
    }

    // Clear previous groups
    groupsContainer.innerHTML = '<h3>Select Artist Groups to Organize</h3><p class="subtitle">Click letter groups to select/deselect them</p><div class="group-grid" id="simpleOrgGroupGrid"></div>';
    groupsContainer.style.display = 'block';

    const groupGrid = document.getElementById('simpleOrgGroupGrid');

    // Sort letters
    const sortedLetters = Object.keys(groupedByArtist).sort();

    let groupsHTML = '';
    for (const letter of sortedLetters) {
        const group = groupedByArtist[letter];
        groupsHTML += `
            <div class="group-card" data-letter="${letter}">
                <div class="letter">${letter}</div>
                <div class="stats">
                    ${group.artistCount} artist${group.artistCount !== 1 ? 's' : ''}<br>
                    ${group.albumCount} album${group.albumCount !== 1 ? 's' : ''}<br>
                    ${group.fileCount} file${group.fileCount !== 1 ? 's' : ''}
                </div>
            </div>
        `;
    }

    groupGrid.innerHTML = groupsHTML;

    // Add click handlers for group selection
    const groupCards = groupGrid.querySelectorAll('.group-card');
    groupCards.forEach(card => {
        card.addEventListener('click', () => {
            const letter = card.getAttribute('data-letter');
            if (selectedGroups.has(letter)) {
                selectedGroups.delete(letter);
                card.classList.remove('selected');
            } else {
                selectedGroups.add(letter);
                card.classList.add('selected');
            }
            updatePreviewButton();
        });
    });

    // Reset selected groups
    selectedGroups.clear();
    updatePreviewButton();
}

/**
 * Update preview button state based on selected groups
 */
function updatePreviewButton() {
    const previewBtn = document.getElementById('simpleOrgPreviewBtn');
    if (selectedGroups.size > 0) {
        previewBtn.disabled = false;
        previewBtn.textContent = `2. Preview Organization (${selectedGroups.size} group${selectedGroups.size !== 1 ? 's' : ''})`;
    } else {
        previewBtn.disabled = true;
        previewBtn.textContent = '2. Preview Organization';
    }
}

/**
 * Truncate path for display
 */
function truncatePath(path, maxLength) {
    if (path.length <= maxLength) return path;

    const parts = path.split('/');
    if (parts.length <= 3) return path;

    // Show first part (root) and last 2 parts (album/file)
    return `${parts[0]}/.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

// Register route with router (expose initSimpleOrganizer to global scope)
window.initSimpleOrganizer = initSimpleOrganizer;

})();

// Register route with router
router.register('simple-organizer', window.initSimpleOrganizer);
