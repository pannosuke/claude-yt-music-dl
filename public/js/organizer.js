/**
 * Music Library Organizer Module
 * Organizes music files for optimal Plex Media Server compatibility
 */

// Module state
let scanData = null;
let structureData = null; // Structure scan results
let selectedGroups = new Set();
let currentScanController = null;

// Plex integration state
let plexConnectionData = null; // { serverIp, port, token }
let plexLibraries = null;
let selectedLibraryId = null;
let plexTracks = null;
let comparisonResults = null;
let currentFilterCategory = 'all';

// DOM elements
const organizerElements = {
    form: null,
    scanBtn: null,
    cancelScanBtn: null,
    deepScanSelectedBtn: null,
    deepScanAllBtn: null,
    musicPathInput: null,
    progressContainer: null,
    progressBar: null,
    progressText: null,
    logContainer: null,
    resultsContainer: null,
    newScanBtn: null,
    summaryTotalFiles: null,
    summaryCompliantFiles: null,
    summaryNeedsFix: null,
    summaryArtists: null,
    summaryAlbums: null,
    issuesBreakdown: null,
    issuesListEl: null,
    formatList: null,
    groupGrid: null
};

/**
 * Initialize the organizer module
 */
function initOrganizer() {
    // Cache DOM elements
    organizerElements.form = document.getElementById('scanForm');
    organizerElements.scanBtn = document.getElementById('scanBtn');
    organizerElements.cancelScanBtn = document.getElementById('cancelScanBtn');
    organizerElements.musicPathInput = document.getElementById('musicPath');
    organizerElements.progressContainer = document.getElementById('scanProgressContainer');
    organizerElements.progressBar = document.getElementById('scanProgressBar');
    organizerElements.progressText = document.getElementById('scanProgressText');
    organizerElements.logContainer = document.getElementById('scanLogContainer');
    organizerElements.resultsContainer = document.getElementById('scanResults');
    organizerElements.newScanBtn = document.getElementById('newScanBtn');
    organizerElements.summaryTotalFiles = document.getElementById('summaryTotalFiles');
    organizerElements.summaryCompliantFiles = document.getElementById('summaryCompliantFiles');
    organizerElements.summaryNeedsFix = document.getElementById('summaryNeedsFix');
    organizerElements.summaryArtists = document.getElementById('summaryArtists');
    organizerElements.summaryAlbums = document.getElementById('summaryAlbums');
    organizerElements.issuesBreakdown = document.getElementById('issuesBreakdown');
    organizerElements.issuesListEl = document.getElementById('issuesList');
    organizerElements.formatList = document.getElementById('formatList');
    organizerElements.groupGrid = document.getElementById('groupGrid');
    organizerElements.deepScanSelectedBtn = document.getElementById('deepScanSelectedBtn');
    organizerElements.deepScanAllBtn = document.getElementById('deepScanAllBtn');

    // Load saved settings
    loadSavedPath();

    // Setup event listeners
    organizerElements.form.addEventListener('submit', handleScanSubmit);
    organizerElements.newScanBtn.addEventListener('click', resetScan);
    organizerElements.cancelScanBtn.addEventListener('click', handleCancelScan);
    organizerElements.deepScanSelectedBtn.addEventListener('click', () => handleDeepScan(false));
    organizerElements.deepScanAllBtn.addEventListener('click', () => handleDeepScan(true));

    // Add drag and drop support for folders
    setupDragAndDrop();

    // Show the module
    const module = document.getElementById('module-organizer');
    if (module) {
        module.classList.add('active');
    }
}

/**
 * Load saved music path from localStorage
 */
function loadSavedPath() {
    const savedPath = localStorage.getItem('musicPath');
    if (savedPath && organizerElements.musicPathInput) {
        organizerElements.musicPathInput.value = savedPath;
    }
}

/**
 * Save music path to localStorage
 */
function savePath(musicPath) {
    localStorage.setItem('musicPath', musicPath);
}

/**
 * Add a log entry
 */
function addScanLog(message, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logEntry.textContent = `[${timestamp}] ${message}`;
    organizerElements.logContainer.appendChild(logEntry);
    organizerElements.logContainer.scrollTop = organizerElements.logContainer.scrollHeight;
    console.log(`[${type.toUpperCase()}] ${message}`);
}

/**
 * Update scan progress
 */
function updateScanProgress(percent, text) {
    organizerElements.progressBar.style.width = percent + '%';
    organizerElements.progressText.textContent = text;
}

/**
 * Reset scan form for new scan
 */
function resetScan() {
    // Cancel any ongoing scan
    if (currentScanController) {
        currentScanController.abort();
        currentScanController = null;
    }

    // Hide results
    organizerElements.resultsContainer.classList.remove('active');

    // Show form
    organizerElements.form.style.display = 'block';

    // Reset state
    scanData = null;
    selectedGroups.clear();

    // Re-enable scan button
    organizerElements.scanBtn.disabled = false;
    organizerElements.scanBtn.textContent = 'Scan Library';

    // Hide cancel button
    organizerElements.cancelScanBtn.style.display = 'none';

    // Clear progress
    organizerElements.progressContainer.style.display = 'none';
    organizerElements.logContainer.innerHTML = '';
}

/**
 * Handle scan cancellation
 */
function handleCancelScan() {
    if (currentScanController) {
        addScanLog('Cancelling scan...', 'warning');
        currentScanController.abort();
        currentScanController = null;

        // Reset UI
        organizerElements.scanBtn.disabled = false;
        organizerElements.scanBtn.textContent = 'Scan Library';
        organizerElements.cancelScanBtn.style.display = 'none';
        updateScanProgress(100, 'Scan cancelled by user');
    }
}

/**
 * Display structure scan results (Phase 1)
 */
function displayStructureResults(structure) {
    // Update summary cards with structure data
    organizerElements.summaryTotalFiles.textContent = '--';
    organizerElements.summaryCompliantFiles.textContent = '--';
    organizerElements.summaryNeedsFix.textContent = structure.totalLooseFiles || 0;
    organizerElements.summaryArtists.textContent = structure.totalArtists;
    organizerElements.summaryAlbums.textContent = structure.totalAlbums;

    // Hide issues breakdown for structure scan
    organizerElements.issuesBreakdown.style.display = 'none';

    // Hide format list for structure scan
    organizerElements.formatList.innerHTML = '<span class="format-badge">Structure Scan - No file metadata</span>';

    // Display alphabetical groups with enhanced info
    displayStructureGroups(structure.groupedByLetter);

    // Show results section
    organizerElements.resultsContainer.classList.add('active');

    // Hide form
    organizerElements.form.style.display = 'none';
}

/**
 * Display deep scan results (Phase 2)
 */
function displayScanResults(data) {
    scanData = data;

    // Update summary cards
    organizerElements.summaryTotalFiles.textContent = data.summary.totalFiles;
    organizerElements.summaryCompliantFiles.textContent = data.summary.compliantFiles;
    organizerElements.summaryNeedsFix.textContent = data.summary.filesNeedingReorganization;
    organizerElements.summaryArtists.textContent = data.summary.artistCount;
    organizerElements.summaryAlbums.textContent = data.summary.albumCount;

    // Display issues breakdown if there are issues
    if (Object.keys(data.summary.issuesByType).length > 0) {
        organizerElements.issuesBreakdown.style.display = 'block';

        let issuesHTML = '';
        for (const [type, count] of Object.entries(data.summary.issuesByType)) {
            const typeName = type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            issuesHTML += `
                <div class="issue-type">
                    <span class="type-name">${typeName}</span>
                    <span class="count">${count}</span>
                </div>
            `;
        }
        organizerElements.issuesListEl.innerHTML = issuesHTML;
    }

    // Display format distribution
    if (Object.keys(data.summary.formats).length > 0) {
        let formatsHTML = '';
        for (const [format, count] of Object.entries(data.summary.formats)) {
            formatsHTML += `<span class="format-badge">${format} (${count})</span>`;
        }
        organizerElements.formatList.innerHTML = formatsHTML;
    }

    // Display alphabetical groups
    displayArtistGroups(data.groupedByArtist);

    // Show results section
    organizerElements.resultsContainer.classList.add('active');

    // Hide form
    organizerElements.form.style.display = 'none';
}

/**
 * Display structure groups (alphabetical) with selection capability
 */
function displayStructureGroups(groupedByLetter) {
    let groupsHTML = '';

    // Sort by letter
    const sortedLetters = Object.keys(groupedByLetter).sort();

    for (const letter of sortedLetters) {
        const group = groupedByLetter[letter];
        const looseInfo = group.looseFileCount > 0 ? `<br>${group.looseFileCount} loose file${group.looseFileCount !== 1 ? 's' : ''}` : '';
        groupsHTML += `
            <div class="group-card" data-letter="${letter}">
                <div class="letter">${letter}</div>
                <div class="stats">
                    ${group.artistCount} artist${group.artistCount !== 1 ? 's' : ''}<br>
                    ${group.albumCount} album${group.albumCount !== 1 ? 's' : ''}${looseInfo}
                </div>
            </div>
        `;
    }

    organizerElements.groupGrid.innerHTML = groupsHTML;

    // Add click handlers to group cards for selection
    const groupCards = organizerElements.groupGrid.querySelectorAll('.group-card');
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
            updateDeepScanButtons();
        });
    });

    // Show deep scan buttons
    updateDeepScanButtons();
}

/**
 * Display artist groups (alphabetical) - deep scan results
 * Now includes expandable file lists with metadata
 */
function displayArtistGroups(groupedByArtist) {
    let groupsHTML = '';

    // Sort by letter
    const sortedLetters = Object.keys(groupedByArtist).sort();

    for (const letter of sortedLetters) {
        const group = groupedByArtist[letter];
        const artistsList = Array.from(group.artists).sort();

        groupsHTML += `
            <div class="group-card expandable" data-letter="${letter}">
                <div class="letter">${letter}</div>
                <div class="stats">
                    ${group.artistCount} artist${group.artistCount !== 1 ? 's' : ''}<br>
                    ${group.fileCount} file${group.fileCount !== 1 ? 's' : ''}
                </div>
            </div>
        `;
    }

    organizerElements.groupGrid.innerHTML = groupsHTML;

    // Add click handlers to expand/collapse groups
    const groupCards = organizerElements.groupGrid.querySelectorAll('.group-card');
    groupCards.forEach(card => {
        card.addEventListener('click', () => toggleArtistGroup(card));
    });
}

/**
 * Toggle artist group expansion to show file details
 */
function toggleArtistGroup(card) {
    const letter = card.getAttribute('data-letter');

    // Check if already expanded
    const existingDetails = card.nextElementSibling;
    if (existingDetails && existingDetails.classList.contains('group-details')) {
        // Collapse
        existingDetails.remove();
        card.classList.remove('expanded');
        return;
    }

    // Expand - show file details
    if (!scanData || !scanData.groupedByArtist || !scanData.groupedByArtist[letter]) {
        return;
    }

    const group = scanData.groupedByArtist[letter];
    const artists = Array.from(group.artists).sort();

    let detailsHTML = '<div class="group-details">';

    // Show each artist's files
    for (const artist of artists) {
        const artistFiles = group.files.filter(f => {
            const fileArtist = f.metadata.artist || f.metadata.albumArtist || f.folderArtist || 'Unknown';
            return fileArtist === artist;
        });

        if (artistFiles.length === 0) continue;

        detailsHTML += `
            <div class="artist-section">
                <h4 class="artist-name">${artist} (${artistFiles.length} file${artistFiles.length !== 1 ? 's' : ''})</h4>
                <div class="file-list">
        `;

        for (const file of artistFiles) {
            const fileName = file.fileName;
            const album = file.metadata.album || 'Unknown Album';
            const title = file.metadata.title || fileName;
            const format = file.metadata.format || 'Unknown';
            const isCompliant = file.compliance.isCompliant;
            const issuesCount = file.compliance.issues.length;

            detailsHTML += `
                <div class="file-item ${isCompliant ? 'compliant' : 'needs-fix'}">
                    <div class="file-info">
                        <div class="file-title">${title}</div>
                        <div class="file-meta">
                            <span class="format-badge">${format}</span>
                            <span class="album-name">${album}</span>
                        </div>
                    </div>
                    <div class="file-status">
                        ${isCompliant ?
                            '<span class="status-badge compliant">✓ Compliant</span>' :
                            `<span class="status-badge needs-fix">⚠ ${issuesCount} issue${issuesCount !== 1 ? 's' : ''}</span>`
                        }
                    </div>
                </div>
            `;
        }

        detailsHTML += `
                </div>
            </div>
        `;
    }

    detailsHTML += '</div>';

    // Insert after the card
    card.insertAdjacentHTML('afterend', detailsHTML);
    card.classList.add('expanded');
}

/**
 * Update deep scan button visibility and state
 */
function updateDeepScanButtons() {
    if (!organizerElements.deepScanSelectedBtn || !organizerElements.deepScanAllBtn) {
        return;
    }

    // Show the button container
    const buttonContainer = document.getElementById('deepScanButtons');
    if (buttonContainer) {
        buttonContainer.style.display = 'block';
    }

    if (selectedGroups.size > 0) {
        organizerElements.deepScanSelectedBtn.style.display = 'inline-block';
        organizerElements.deepScanSelectedBtn.textContent = `Deep Scan Selected (${selectedGroups.size})`;
    } else {
        organizerElements.deepScanSelectedBtn.style.display = 'none';
    }

    organizerElements.deepScanAllBtn.style.display = 'inline-block';
}

/**
 * Handle deep scan (selected letters or all)
 */
async function handleDeepScan(scanAll = false) {
    const musicPath = organizerElements.musicPathInput.value.trim();
    const letters = scanAll ? null : Array.from(selectedGroups);

    if (!scanAll && letters.length === 0) {
        addScanLog('Please select at least one letter group to scan', 'warning');
        return;
    }

    const scanType = scanAll ? 'all artists' : `selected letters (${letters.join(', ')})`;
    addScanLog(`Starting deep scan of ${scanType}...`, 'info');

    // Create AbortController for this scan
    currentScanController = new AbortController();

    // Show progress container
    organizerElements.progressContainer.style.display = 'block';
    organizerElements.logContainer.innerHTML = '';
    organizerElements.cancelScanBtn.style.display = 'inline-block';
    organizerElements.deepScanSelectedBtn.disabled = true;
    organizerElements.deepScanAllBtn.disabled = true;

    try {
        const body = { musicPath };
        if (!scanAll) {
            body.artistLetters = letters;
        }

        const response = await fetch('http://localhost:3000/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: currentScanController.signal
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');

            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));

                        // Update progress
                        if (data.progress !== undefined) {
                            updateScanProgress(data.progress, data.status || organizerElements.progressText.textContent);
                        }

                        // Log messages
                        if (data.status) {
                            addScanLog(data.status, 'info');
                        }
                        if (data.debug) {
                            addScanLog(data.debug, 'debug');
                        }
                        if (data.error) {
                            addScanLog(data.error, 'error');
                        }
                        if (data.warning) {
                            addScanLog(data.warning, 'warning');
                        }

                        // Log scan progress details
                        if (data.filesFound !== undefined) {
                            addScanLog(`Found ${data.filesFound} audio files`, 'info');
                        }

                        if (data.filesProcessed !== undefined && data.filesTotal !== undefined) {
                            addScanLog(`Processing ${data.filesProcessed} of ${data.filesTotal}: ${data.currentFile || ''}`, 'debug');
                        }

                        // Display results when completed
                        if (data.completed) {
                            organizerElements.cancelScanBtn.style.display = 'none';
                            organizerElements.deepScanSelectedBtn.disabled = false;
                            organizerElements.deepScanAllBtn.disabled = false;
                            currentScanController = null;

                            if (data.summary) {
                                addScanLog(`Deep scan completed! ${data.summary.totalFiles} files processed.`, 'success');
                                displayScanResults(data);
                                // Initialize Plex and MusicBrainz integrations after deep scan
                                initPlexIntegration();
                                initMusicBrainzIntegration();
                            }
                        }
                    } catch (parseError) {
                        console.error('[Deep Scan] JSON parse error:', parseError);
                        console.error('[Deep Scan] Failed to parse line:', line);
                        addScanLog(`Parse error: ${parseError.message}`, 'error');
                    }
                }
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            addScanLog('Deep scan cancelled by user', 'warning');
        } else {
            addScanLog(`Error: ${error.message}`, 'error');
        }
        organizerElements.cancelScanBtn.style.display = 'none';
        organizerElements.deepScanSelectedBtn.disabled = false;
        organizerElements.deepScanAllBtn.disabled = false;
        currentScanController = null;
    }
}

/**
 * Setup drag and drop support for the music path input
 */
function setupDragAndDrop() {
    const input = organizerElements.musicPathInput;

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        input.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Highlight input when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        input.addEventListener(eventName, () => {
            input.style.borderColor = '#667eea';
            input.style.backgroundColor = '#f0f4ff';
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        input.addEventListener(eventName, () => {
            input.style.borderColor = '#e1e8ed';
            input.style.backgroundColor = 'white';
        }, false);
    });

    // Handle dropped files/folders
    input.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const items = dt.items;

        if (items) {
            // Loop through items to find directories
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry && entry.isDirectory) {
                        // Get the full path from the dropped item
                        // Note: entry.fullPath gives us the relative path only
                        // We need to ask the user for the full system path
                        const folderName = entry.name;

                        const fullPath = prompt(
                            `You dropped the folder: "${folderName}"\n\n` +
                            `Please enter the FULL path to this folder:\n` +
                            `(e.g., /Users/yourname/Music/${folderName} or C:\\Users\\yourname\\Music\\${folderName})`,
                            ''
                        );

                        if (fullPath) {
                            input.value = fullPath;
                            savePath(fullPath);
                        }
                        break;
                    }
                }
            }
        }
    }, false);
}

/**
 * Handle scan form submission (Phase 1: Structure Scan)
 */
async function handleScanSubmit(e) {
    e.preventDefault();

    const musicPath = organizerElements.musicPathInput.value.trim();

    // Save path to localStorage
    savePath(musicPath);

    addScanLog(`Starting structure scan of: ${musicPath}`, 'info');

    // Create AbortController for this scan
    currentScanController = new AbortController();

    // Show progress container
    organizerElements.progressContainer.style.display = 'block';
    organizerElements.logContainer.innerHTML = '';
    organizerElements.scanBtn.disabled = true;
    organizerElements.scanBtn.textContent = 'Scanning Structure...';
    organizerElements.cancelScanBtn.style.display = 'inline-block';

    try {
        const response = await fetch('http://localhost:3000/api/scan/structure', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ musicPath }),
            signal: currentScanController.signal
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));

                    // Update progress
                    if (data.progress !== undefined) {
                        updateScanProgress(data.progress, data.status || organizerElements.progressText.textContent);
                    }

                    // Log status messages
                    if (data.status) {
                        addScanLog(data.status, 'info');
                    }

                    if (data.debug) {
                        addScanLog(data.debug, 'debug');
                    }

                    if (data.error) {
                        addScanLog(data.error, 'error');
                    }

                    if (data.warning) {
                        addScanLog(data.warning, 'warning');
                    }

                    // Log scan progress details
                    if (data.filesFound !== undefined) {
                        addScanLog(`Found ${data.filesFound} audio files`, 'info');
                    }

                    if (data.filesProcessed !== undefined && data.filesTotal !== undefined) {
                        addScanLog(`Processing ${data.filesProcessed} of ${data.filesTotal}: ${data.currentFile || ''}`, 'debug');
                    }

                    // Display results when completed
                    if (data.completed) {
                        organizerElements.scanBtn.disabled = false;
                        organizerElements.scanBtn.textContent = 'Scan Library';
                        organizerElements.cancelScanBtn.style.display = 'none';
                        currentScanController = null;

                        if (data.structure) {
                            // Structure scan completed
                            addScanLog(`Structure scan completed! Found ${data.structure.totalArtists} artists.`, 'success');
                            structureData = data.structure;
                            displayStructureResults(data.structure);
                        } else if (data.summary) {
                            // Deep scan completed
                            addScanLog(`Deep scan completed! ${data.summary.totalFiles} files processed.`, 'success');
                            displayScanResults(data);
                            // Initialize Plex and MusicBrainz integrations after deep scan
                            initPlexIntegration();
                            initMusicBrainzIntegration();
                        }
                    }
                }
            }
        }
    } catch (error) {
        // Handle abort differently from other errors
        if (error.name === 'AbortError') {
            addScanLog('Scan cancelled by user', 'warning');
        } else {
            addScanLog(`Error: ${error.message}`, 'error');
        }
        organizerElements.scanBtn.disabled = false;
        organizerElements.scanBtn.textContent = 'Scan Library';
        organizerElements.cancelScanBtn.style.display = 'none';
        currentScanController = null;
    }
}

/**
 * ================================================================================
 * PLEX INTEGRATION (Phase 2.5)
 * ================================================================================
 */

/**
 * Initialize Plex integration after deep scan completes
 */
function initPlexIntegration() {
    console.log('[Plex] Initializing Plex integration...');
    console.log('[Plex] scanData:', scanData);

    // Get Plex DOM elements
    const plexSection = document.getElementById('plexSection');
    const plexConnectForm = document.getElementById('plexConnectForm');
    const connectionStatus = document.getElementById('connectionStatus');
    const plexLibraryPanel = document.getElementById('plexLibraryPanel');
    const fetchLibraryBtn = document.getElementById('fetchLibraryBtn');
    const newComparisonBtn = document.getElementById('newComparisonBtn');
    const exportReportBtn = document.getElementById('exportReportBtn');

    console.log('[Plex] plexSection element:', plexSection);
    console.log('[Plex] scanData exists:', !!scanData);

    // Show Plex section after successful deep scan
    if (plexSection && scanData) {
        console.log('[Plex] Showing Plex section');
        plexSection.style.display = 'block';
        addScanLog('Plex integration enabled - scroll down to connect', 'info');
    } else {
        console.warn('[Plex] Cannot show Plex section. plexSection:', !!plexSection, 'scanData:', !!scanData);
    }

    // Setup Plex event listeners
    if (plexConnectForm) {
        plexConnectForm.addEventListener('submit', handlePlexConnect);
    }

    if (fetchLibraryBtn) {
        fetchLibraryBtn.addEventListener('click', handleFetchLibrary);
    }

    if (newComparisonBtn) {
        newComparisonBtn.addEventListener('click', resetPlexComparison);
    }

    if (exportReportBtn) {
        exportReportBtn.addEventListener('click', exportComparisonReport);
    }

    // Setup filter buttons
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const filter = e.target.dataset.filter;
            setConflictFilter(filter);
        });
    });

    // Load saved Plex settings from localStorage
    loadPlexSettings();
}

/**
 * Load saved Plex settings from localStorage
 */
function loadPlexSettings() {
    const savedIp = localStorage.getItem('plexServerIp');
    const savedPort = localStorage.getItem('plexPort');
    const savedToken = localStorage.getItem('plexToken');

    if (savedIp) document.getElementById('plexServerIp').value = savedIp;
    if (savedPort) document.getElementById('plexPort').value = savedPort;
    if (savedToken) document.getElementById('plexToken').value = savedToken;
}

/**
 * Save Plex settings to localStorage
 */
function savePlexSettings(serverIp, port, token) {
    localStorage.setItem('plexServerIp', serverIp);
    localStorage.setItem('plexPort', port);
    localStorage.setItem('plexToken', token);
}

/**
 * Handle Plex connection test
 */
async function handlePlexConnect(e) {
    e.preventDefault();

    const serverIp = document.getElementById('plexServerIp').value.trim();
    const port = document.getElementById('plexPort').value.trim();
    const token = document.getElementById('plexToken').value.trim();

    const connectionStatus = document.getElementById('connectionStatus');
    const connectBtn = document.getElementById('plexConnectBtn');

    if (!serverIp || !port || !token) {
        showConnectionStatus('error', 'Please fill in all fields');
        return;
    }

    connectBtn.disabled = true;
    connectBtn.textContent = 'Testing...';
    connectionStatus.style.display = 'block';
    connectionStatus.className = 'connection-status info';
    connectionStatus.textContent = 'Testing connection to Plex server...';

    try {
        const response = await fetch('http://localhost:3000/api/plex/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverIp, port, token })
        });

        const result = await response.json();

        if (result.success) {
            plexConnectionData = { serverIp, port, token };
            savePlexSettings(serverIp, port, token);
            showConnectionStatus('success', `Connected to ${result.server.name} (${result.server.version})`);

            // Fetch libraries
            await fetchLibraries();
        } else {
            showConnectionStatus('error', `Connection failed: ${result.error}`);
        }
    } catch (error) {
        showConnectionStatus('error', `Error: ${error.message}`);
    } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Test Connection';
    }
}

/**
 * Show connection status message
 */
function showConnectionStatus(type, message) {
    const connectionStatus = document.getElementById('connectionStatus');
    connectionStatus.style.display = 'block';
    connectionStatus.className = `connection-status ${type}`;
    connectionStatus.textContent = message;
}

/**
 * Fetch Plex libraries
 */
async function fetchLibraries() {
    if (!plexConnectionData) return;

    const { serverIp, port, token } = plexConnectionData;

    try {
        const response = await fetch('http://localhost:3000/api/plex/libraries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverIp, port, token })
        });

        const result = await response.json();

        if (result.success && result.libraries.length > 0) {
            plexLibraries = result.libraries;
            displayLibraries(result.libraries);
        } else {
            showConnectionStatus('warning', 'No music libraries found on this Plex server');
        }
    } catch (error) {
        showConnectionStatus('error', `Failed to fetch libraries: ${error.message}`);
    }
}

/**
 * Display Plex music libraries
 */
function displayLibraries(libraries) {
    const libraryList = document.getElementById('libraryList');
    const plexLibraryPanel = document.getElementById('plexLibraryPanel');

    libraryList.innerHTML = '';

    libraries.forEach(library => {
        const card = document.createElement('div');
        card.className = 'library-card';
        card.innerHTML = `
            <input type="radio" name="library" value="${library.id}" id="library-${library.id}">
            <label for="library-${library.id}">
                <strong>${library.name}</strong>
                <span class="library-count">${library.trackCount} tracks</span>
            </label>
        `;

        card.querySelector('input').addEventListener('change', (e) => {
            selectedLibraryId = e.target.value;
            document.getElementById('fetchLibraryBtn').style.display = 'inline-block';
        });

        libraryList.appendChild(card);
    });

    plexLibraryPanel.style.display = 'block';
}

/**
 * Handle fetch library tracks
 */
async function handleFetchLibrary() {
    if (!selectedLibraryId || !plexConnectionData) return;

    const { serverIp, port, token } = plexConnectionData;
    const fetchBtn = document.getElementById('fetchLibraryBtn');
    const progressContainer = document.getElementById('plexProgressContainer');
    const progressBar = document.getElementById('plexProgressBar');
    const progressText = document.getElementById('plexProgressText');

    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching...';
    progressContainer.style.display = 'block';

    try {
        const response = await fetch('http://localhost:3000/api/plex/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverIp, port, token, libraryId: selectedLibraryId })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');

            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));

                        if (data.progress !== undefined) {
                            progressBar.style.width = data.progress + '%';
                        }

                        if (data.status) {
                            progressText.textContent = data.status;
                        }

                        if (data.completed && data.tracks) {
                            plexTracks = data.tracks;
                            addScanLog(`Fetched ${data.tracks.length} tracks from Plex library`, 'success');

                            // Now compare with offline library
                            await compareLibraries();
                        }

                        if (data.error) {
                            addScanLog(`Plex fetch error: ${data.error}`, 'error');
                        }
                    } catch (parseError) {
                        console.error('[Plex Fetch] JSON parse error:', parseError);
                        console.error('[Plex Fetch] Failed to parse line:', line.substring(0, 200));
                    }
                }
            }
        }
    } catch (error) {
        addScanLog(`Error fetching Plex library: ${error.message}`, 'error');
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = 'Fetch Library Tracks';
        progressContainer.style.display = 'none';
    }
}

/**
 * Compare offline library with Plex library
 */
async function compareLibraries() {
    if (!scanData || !plexTracks) {
        addScanLog('Missing scan data or Plex tracks', 'error');
        return;
    }

    // Convert scanData to format expected by backend
    const offlineTracks = [];
    for (const letter in scanData.groupedByArtist) {
        const group = scanData.groupedByArtist[letter];
        for (const file of group.files) {
            offlineTracks.push({
                artist: file.metadata?.artist || file.folderArtist || 'Unknown',
                album: file.metadata?.album || 'Unknown',
                title: file.metadata?.title || file.fileName,
                format: file.metadata?.format || 'unknown',
                bitrate: file.metadata?.bitrate || null
            });
        }
    }

    addScanLog(`Comparing ${offlineTracks.length} offline tracks with ${plexTracks.length} Plex tracks...`, 'info');

    const progressContainer = document.getElementById('plexProgressContainer');
    const progressBar = document.getElementById('plexProgressBar');
    const progressText = document.getElementById('plexProgressText');

    progressContainer.style.display = 'block';
    progressText.textContent = 'Comparing libraries...';

    try {
        const response = await fetch('http://localhost:3000/api/plex/compare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ offlineTracks, plexTracks })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = JSON.parse(line.slice(6));

                    if (data.progress !== undefined) {
                        progressBar.style.width = data.progress + '%';
                    }

                    if (data.status) {
                        progressText.textContent = data.status;
                    }

                    if (data.completed && data.results) {
                        comparisonResults = data.results;
                        displayComparisonResults(data.results);
                        addScanLog('Comparison complete!', 'success');
                    }

                    if (data.error) {
                        addScanLog(`Comparison error: ${data.error}`, 'error');
                    }
                }
            }
        }
    } catch (error) {
        addScanLog(`Error comparing libraries: ${error.message}`, 'error');
    } finally {
        progressContainer.style.display = 'none';
    }
}

/**
 * Display comparison results
 */
function displayComparisonResults(results) {
    // Update summary statistics
    document.getElementById('statSafeToAdd').textContent = results.safeToAdd;
    document.getElementById('statUpgrades').textContent = results.qualityUpgrades;
    document.getElementById('statDowngrades').textContent = results.qualityDowngrades;
    document.getElementById('statDuplicates').textContent = results.sameQualityDupes;

    // Display conflicts table
    displayConflictsTable(results.conflicts);

    // Show results panel
    document.getElementById('comparisonResults').style.display = 'block';
}

/**
 * Display conflicts table
 */
function displayConflictsTable(conflicts) {
    const tbody = document.getElementById('conflictsTableBody');
    tbody.innerHTML = '';

    const filteredConflicts = currentFilterCategory === 'all'
        ? conflicts
        : conflicts.filter(c => c.category === currentFilterCategory);

    filteredConflicts.forEach(conflict => {
        const row = document.createElement('tr');
        row.className = `conflict-row ${conflict.category.toLowerCase().replace(/_/g, '-')}`;
        row.dataset.category = conflict.category;

        const offlineQuality = conflict.offlineTrack.format
            ? `${conflict.offlineTrack.format}${conflict.offlineTrack.bitrate ? ` (${conflict.offlineTrack.bitrate}kbps)` : ''}`
            : 'Unknown';

        const plexQuality = conflict.plexTrack
            ? `${conflict.plexTrack.codec || 'Unknown'}${conflict.plexTrack.bitrate ? ` (${conflict.plexTrack.bitrate}kbps)` : ''}`
            : '--';

        const statusBadge = getStatusBadge(conflict.category);
        const recommendationBadge = getRecommendationBadge(conflict.recommendation);

        row.innerHTML = `
            <td>${conflict.offlineTrack.artist}</td>
            <td>${conflict.offlineTrack.album}</td>
            <td>${conflict.offlineTrack.title}</td>
            <td>${offlineQuality}</td>
            <td>${plexQuality}</td>
            <td>${statusBadge}</td>
            <td>${recommendationBadge}</td>
        `;

        tbody.appendChild(row);
    });
}

/**
 * Get status badge HTML
 */
function getStatusBadge(category) {
    const badges = {
        'SAFE_TO_ADD': '<span class="badge badge-safe">Safe to Add</span>',
        'QUALITY_UPGRADE': '<span class="badge badge-upgrade">Quality Upgrade</span>',
        'QUALITY_DOWNGRADE': '<span class="badge badge-downgrade">Quality Downgrade</span>',
        'SAME_QUALITY_DUPLICATE': '<span class="badge badge-duplicate">Duplicate</span>'
    };
    return badges[category] || '<span class="badge">Unknown</span>';
}

/**
 * Get recommendation badge HTML
 */
function getRecommendationBadge(recommendation) {
    const badges = {
        'ADD': '<span class="badge-rec badge-rec-add">Add</span>',
        'REPLACE': '<span class="badge-rec badge-rec-replace">Replace</span>',
        'SKIP': '<span class="badge-rec badge-rec-skip">Skip</span>'
    };
    return badges[recommendation] || '<span class="badge-rec">--</span>';
}

/**
 * Set conflict filter
 */
function setConflictFilter(filter) {
    currentFilterCategory = filter;

    // Update active button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });

    // Re-render table
    if (comparisonResults) {
        displayConflictsTable(comparisonResults.conflicts);
    }
}

/**
 * Export comparison report as CSV
 */
function exportComparisonReport() {
    if (!comparisonResults) return;

    const headers = ['Artist', 'Album', 'Title', 'Offline Format', 'Offline Bitrate', 'Plex Format', 'Plex Bitrate', 'Status', 'Recommendation'];
    const rows = [headers];

    comparisonResults.conflicts.forEach(conflict => {
        rows.push([
            conflict.offlineTrack.artist,
            conflict.offlineTrack.album,
            conflict.offlineTrack.title,
            conflict.offlineTrack.format || 'Unknown',
            conflict.offlineTrack.bitrate || '',
            conflict.plexTrack ? (conflict.plexTrack.codec || 'Unknown') : '',
            conflict.plexTrack ? (conflict.plexTrack.bitrate || '') : '',
            conflict.category,
            conflict.recommendation
        ]);
    });

    const csv = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plex-comparison-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    addScanLog('Comparison report exported to CSV', 'success');
}

/**
 * Reset Plex comparison
 */
function resetPlexComparison() {
    plexConnectionData = null;
    plexLibraries = null;
    selectedLibraryId = null;
    plexTracks = null;
    comparisonResults = null;
    currentFilterCategory = 'all';

    document.getElementById('plexSection').style.display = 'none';
    document.getElementById('plexLibraryPanel').style.display = 'none';
    document.getElementById('comparisonResults').style.display = 'none';
    document.getElementById('connectionStatus').style.display = 'none';

    addScanLog('Plex comparison reset', 'info');
}

/**
 * ================================================================================
 * MUSICBRAINZ INTEGRATION (Phase 3)
 * ================================================================================
 */

/**
 * Initialize MusicBrainz integration after deep scan completes
 */
function initMusicBrainzIntegration() {
    console.log('[MusicBrainz] Initializing MusicBrainz integration...');

    const mbSection = document.getElementById('musicbrainzSection');
    const mbArtistForm = document.getElementById('mbArtistSearchForm');
    const mbReleaseForm = document.getElementById('mbReleaseSearchForm');
    const mbRecordingForm = document.getElementById('mbRecordingSearchForm');

    // Show MusicBrainz section
    if (mbSection && scanData) {
        console.log('[MusicBrainz] Showing MusicBrainz section');
        mbSection.style.display = 'block';
        addScanLog('MusicBrainz metadata search enabled - scroll down to search', 'info');
    }

    // Setup event listeners
    if (mbArtistForm) {
        mbArtistForm.addEventListener('submit', handleMbArtistSearch);
    }

    if (mbReleaseForm) {
        mbReleaseForm.addEventListener('submit', handleMbReleaseSearch);
    }

    if (mbRecordingForm) {
        mbRecordingForm.addEventListener('submit', handleMbRecordingSearch);
    }
}

/**
 * Handle MusicBrainz artist search
 */
async function handleMbArtistSearch(e) {
    e.preventDefault();

    const artist = document.getElementById('mbArtistInput').value.trim();
    const resultsEl = document.getElementById('mbArtistResults');

    if (!artist) return;

    resultsEl.innerHTML = '<div class="loading">Searching MusicBrainz for artist...</div>';

    try {
        const response = await fetch('http://localhost:3000/api/musicbrainz/search-artist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artist })
        });

        const result = await response.json();

        if (result.success && result.results.length > 0) {
            displayMbArtistResults(result.results);
        } else {
            resultsEl.innerHTML = '<div class="no-results">No artists found</div>';
        }
    } catch (error) {
        resultsEl.innerHTML = `<div class="error">Error: ${error.message}</div>`;
    }
}

/**
 * Display MusicBrainz artist results
 */
function displayMbArtistResults(results) {
    const resultsEl = document.getElementById('mbArtistResults');

    let html = '<div class="mb-result-list">';

    results.forEach((artist, index) => {
        html += `
            <div class="mb-result-item" style="margin-bottom: 15px; padding: 15px; border: 1px solid #e1e8ed; border-radius: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <h4 style="margin: 0 0 8px 0; color: #2c3e50;">${artist.name}</h4>
                        <div style="font-size: 13px; color: #64748b; margin-bottom: 5px;">
                            <span class="format-badge" style="background-color: ${getConfidenceBadgeColor(artist.confidence)};">
                                ${artist.confidence}% match
                            </span>
                            ${artist.type ? `<span class="format-badge">${artist.type}</span>` : ''}
                            ${artist.country ? `<span class="format-badge">${artist.country}</span>` : ''}
                        </div>
                        ${artist.disambiguation ? `<div style="font-size: 13px; color: #94a3b8; margin-top: 5px;">${artist.disambiguation}</div>` : ''}
                        ${artist.aliases.length > 0 ? `
                            <div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">
                                <strong>Aliases:</strong> ${artist.aliases.slice(0, 3).map(a => a.name).join(', ')}
                                ${artist.aliases.length > 3 ? ` (+${artist.aliases.length - 3} more)` : ''}
                            </div>
                        ` : ''}
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; margin-left: 15px;">
                        ID: ${artist.id}
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    resultsEl.innerHTML = html;
}

/**
 * Handle MusicBrainz release search
 */
async function handleMbReleaseSearch(e) {
    e.preventDefault();

    const artist = document.getElementById('mbReleaseArtistInput').value.trim();
    const album = document.getElementById('mbReleaseAlbumInput').value.trim();
    const resultsEl = document.getElementById('mbReleaseResults');

    if (!artist || !album) return;

    resultsEl.innerHTML = '<div class="loading">Searching MusicBrainz for release...</div>';

    try {
        const response = await fetch('http://localhost:3000/api/musicbrainz/search-release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artist, album })
        });

        const result = await response.json();

        if (result.success && result.results.length > 0) {
            displayMbReleaseResults(result.results);
        } else {
            resultsEl.innerHTML = '<div class="no-results">No releases found</div>';
        }
    } catch (error) {
        resultsEl.innerHTML = `<div class="error">Error: ${error.message}</div>`;
    }
}

/**
 * Display MusicBrainz release results
 */
function displayMbReleaseResults(results) {
    const resultsEl = document.getElementById('mbReleaseResults');

    let html = '<div class="mb-result-list">';

    results.forEach((release, index) => {
        html += `
            <div class="mb-result-item" style="margin-bottom: 15px; padding: 15px; border: 1px solid #e1e8ed; border-radius: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <h4 style="margin: 0 0 8px 0; color: #2c3e50;">${release.title}</h4>
                        <div style="font-size: 14px; color: #64748b; margin-bottom: 8px;">by ${release.artist}</div>
                        <div style="font-size: 13px; color: #64748b; margin-bottom: 5px;">
                            <span class="format-badge" style="background-color: ${getConfidenceBadgeColor(release.confidence)};">
                                ${release.confidence}% match
                            </span>
                            ${release.date ? `<span class="format-badge">${release.date}</span>` : ''}
                            ${release.country ? `<span class="format-badge">${release.country}</span>` : ''}
                            ${release.trackCount ? `<span class="format-badge">${release.trackCount} tracks</span>` : ''}
                        </div>
                        ${release.status ? `<div style="font-size: 13px; color: #94a3b8;">Status: ${release.status}</div>` : ''}
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; margin-left: 15px;">
                        ID: ${release.id}
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    resultsEl.innerHTML = html;
}

/**
 * Handle MusicBrainz recording search
 */
async function handleMbRecordingSearch(e) {
    e.preventDefault();

    const artist = document.getElementById('mbRecordingArtistInput').value.trim();
    const album = document.getElementById('mbRecordingAlbumInput').value.trim();
    const title = document.getElementById('mbRecordingTitleInput').value.trim();
    const resultsEl = document.getElementById('mbRecordingResults');

    if (!artist || !album || !title) return;

    resultsEl.innerHTML = '<div class="loading">Searching MusicBrainz for recording...</div>';

    try {
        const response = await fetch('http://localhost:3000/api/musicbrainz/search-recording', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ artist, album, title })
        });

        const result = await response.json();

        if (result.success && result.results.length > 0) {
            displayMbRecordingResults(result.results);
        } else {
            resultsEl.innerHTML = '<div class="no-results">No recordings found</div>';
        }
    } catch (error) {
        resultsEl.innerHTML = `<div class="error">Error: ${error.message}</div>`;
    }
}

/**
 * Display MusicBrainz recording results
 */
function displayMbRecordingResults(results) {
    const resultsEl = document.getElementById('mbRecordingResults');

    let html = '<div class="mb-result-list">';

    results.forEach((recording, index) => {
        const duration = recording.length ? Math.floor(recording.length / 1000 / 60) + ':' + String(Math.floor((recording.length / 1000) % 60)).padStart(2, '0') : 'Unknown';

        html += `
            <div class="mb-result-item" style="margin-bottom: 15px; padding: 15px; border: 1px solid #e1e8ed; border-radius: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <h4 style="margin: 0 0 8px 0; color: #2c3e50;">${recording.title}</h4>
                        <div style="font-size: 14px; color: #64748b; margin-bottom: 8px;">by ${recording.artist}</div>
                        <div style="font-size: 13px; color: #64748b; margin-bottom: 5px;">
                            <span class="format-badge" style="background-color: ${getConfidenceBadgeColor(recording.confidence)};">
                                ${recording.confidence}% match
                            </span>
                            ${recording.length ? `<span class="format-badge">${duration}</span>` : ''}
                        </div>
                        ${recording.releases && recording.releases.length > 0 ? `
                            <div style="font-size: 12px; color: #94a3b8; margin-top: 8px;">
                                <strong>Found on:</strong> ${recording.releases.slice(0, 2).map(r => `${r.title}${r.date ? ` (${r.date})` : ''}`).join(', ')}
                                ${recording.releases.length > 2 ? ` (+${recording.releases.length - 2} more)` : ''}
                            </div>
                        ` : ''}
                    </div>
                    <div style="font-size: 11px; color: #94a3b8; margin-left: 15px;">
                        ID: ${recording.id}
                    </div>
                </div>
            </div>
        `;
    });

    html += '</div>';
    resultsEl.innerHTML = html;
}

/**
 * Get confidence badge color based on percentage
 */
function getConfidenceBadgeColor(confidence) {
    if (confidence >= 90) return '#10b981'; // green
    if (confidence >= 70) return '#f59e0b'; // amber
    return '#ef4444'; // red
}

// Register the organizer route
router.register('organizer', initOrganizer);
