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
                                // Initialize Plex, MusicBrainz, and Matcher integrations after deep scan
                                initPlexIntegration();
                                initMusicBrainzIntegration();
                                initMatcherIntegration();
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
                            // Initialize Plex, MusicBrainz, and Matcher integrations after deep scan
                            initPlexIntegration();
                            initMusicBrainzIntegration();
                            initMatcherIntegration();
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

/**
 * ================================================================================
 * AUTO-MATCH & RENAME ENGINE (Phase 3.5)
 * ================================================================================
 */

// Global state for matcher
let matchResults = [];
let renamePreviews = null;
let currentMatchFilter = 'all';

/**
 * Initialize Auto-Match & Rename integration after deep scan completes
 */
function initMatcherIntegration() {
    console.log('[Matcher] Initializing Auto-Match & Rename integration...');

    const matcherSection = document.getElementById('matcherSection');
    const startBatchMatchBtn = document.getElementById('startBatchMatchBtn');
    const previewRenamesBtn = document.getElementById('previewRenamesBtn');
    const executeDryRunBtn = document.getElementById('executeDryRunBtn');
    const executeRenameBtn = document.getElementById('executeRenameBtn');

    // Show matcher section
    if (matcherSection && scanData) {
        matcherSection.style.display = 'block';
        addScanLog('Auto-Match & Rename engine ready - scroll down to start', 'info');
    }

    // Setup event listeners
    if (startBatchMatchBtn) {
        startBatchMatchBtn.addEventListener('click', handleStartBatchMatch);
    }

    if (previewRenamesBtn) {
        previewRenamesBtn.addEventListener('click', handlePreviewRenames);
    }

    if (executeDryRunBtn) {
        executeDryRunBtn.addEventListener('click', () => handleExecuteRename(true));
    }

    if (executeRenameBtn) {
        executeRenameBtn.addEventListener('click', () => handleExecuteRename(false));
    }

    // Setup filter buttons
    const filterButtons = document.querySelectorAll('#matchResultsContainer .filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentMatchFilter = e.target.dataset.filter;
            displayMatchResults(matchResults, currentMatchFilter);
        });
    });
}

/**
 * Handle Start Batch Match button click
 */
async function handleStartBatchMatch() {
    console.log('[Matcher] Starting batch match...');

    if (!scanData || !scanData.files || scanData.files.length === 0) {
        addScanLog('No scanned files to match. Please run a deep scan first.', 'error');
        return;
    }

    const startBtn = document.getElementById('startBatchMatchBtn');
    const progressContainer = document.getElementById('matchProgressContainer');
    const progressText = document.getElementById('matchProgressText');
    const progressBar = document.getElementById('matchProgressBar');
    const statsContainer = document.getElementById('matchStatsContainer');

    // Show progress UI
    startBtn.disabled = true;
    progressContainer.style.display = 'block';
    statsContainer.style.display = 'none';

    try {
        const eventSource = await fetch('http://localhost:3000/api/matcher/batch-match', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: scanData.files })
        });

        const reader = eventSource.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));

                        if (data.type === 'progress') {
                            progressText.textContent = `Matching ${data.currentFile || ''}... (${data.processed}/${data.total})`;
                            progressBar.style.width = `${data.progress}%`;
                        } else if (data.type === 'complete') {
                            console.log('[Matcher] Batch match complete:', data);
                            matchResults = data.results;

                            progressText.textContent = data.message;
                            progressBar.style.width = '100%';

                            // Show statistics
                            displayMatchStatistics(data.stats);
                            statsContainer.style.display = 'block';

                            // Show match results
                            displayMatchResults(matchResults, 'all');
                            document.getElementById('matchResultsContainer').style.display = 'block';

                            addScanLog(`Batch matching complete! ${data.stats.matched}/${data.stats.total} files matched`, 'success');
                        } else if (data.type === 'error') {
                            progressText.textContent = `Error: ${data.error}`;
                            addScanLog(`Batch match error: ${data.error}`, 'error');
                        }
                    } catch (parseError) {
                        console.error('[Matcher] Parse error:', parseError);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[Matcher] Batch match error:', error);
        progressText.textContent = `Error: ${error.message}`;
        addScanLog(`Batch match error: ${error.message}`, 'error');
    } finally {
        startBtn.disabled = false;
    }
}

/**
 * Display match statistics
 */
function displayMatchStatistics(stats) {
    document.getElementById('statAutoApprove').textContent = stats.byCategory.auto_approve || 0;
    document.getElementById('statReview').textContent = stats.byCategory.review || 0;
    document.getElementById('statManual').textContent = stats.byCategory.manual || 0;
    document.getElementById('statSkipped').textContent = stats.skipped + stats.errors;
}

/**
 * Display match results with filtering
 */
function displayMatchResults(results, filter = 'all') {
    const resultsList = document.getElementById('matchResultsList');

    if (!results || results.length === 0) {
        resultsList.innerHTML = '<div class="no-results">No match results to display</div>';
        return;
    }

    // Filter results
    let filteredResults = results;
    if (filter !== 'all') {
        filteredResults = results.filter(r => r.category === filter || (filter === 'skipped' && (r.status === 'skipped' || r.status === 'error' || r.status === 'no_match')));
    }

    let html = '';

    for (const result of filteredResults) {
        const category = result.category || 'skipped';
        const confidenceBadge = result.confidence > 0 ?
            `<span class="format-badge" style="background-color: ${getConfidenceBadgeColor(result.confidence)};">${result.confidence}% match</span>` : '';

        const mbMatch = result.mbMatch;
        const matchInfo = mbMatch ?
            `<strong>MusicBrainz Match:</strong> ${mbMatch.artist} - ${mbMatch.title}` :
            `<strong>Status:</strong> ${result.reason || 'No match found'}`;

        html += `
            <div class="match-result-item ${category}">
                <div class="match-result-header">
                    <div class="match-result-info">
                        <h4 class="match-result-title">${result.originalMetadata.title || 'Unknown Title'}</h4>
                        <div class="match-result-meta">
                            <strong>Original:</strong> ${result.originalMetadata.artist || 'Unknown'} - ${result.originalMetadata.album || 'Unknown'}
                        </div>
                        <div class="match-result-meta" style="margin-top: 5px;">
                            ${matchInfo}
                        </div>
                    </div>
                </div>
                <div class="match-result-badges">
                    ${confidenceBadge}
                    <span class="format-badge">${result.category === 'auto_approve' ? 'Auto-Approved' : result.category === 'review' ? 'Review' : result.category === 'manual' ? 'Manual' : 'Skipped'}</span>
                    ${result.fileInfo ? `<span class="format-badge">${result.fileInfo.codec || result.fileInfo.format}</span>` : ''}
                </div>
            </div>
        `;
    }

    resultsList.innerHTML = html || '<div class="no-results">No results match this filter</div>';
}

/**
 * Handle Preview Renames button click
 */
async function handlePreviewRenames() {
    console.log('[Matcher] Generating rename previews...');

    if (!matchResults || matchResults.length === 0) {
        addScanLog('No match results to preview. Please run batch match first.', 'error');
        return;
    }

    if (!scanData || !scanData.basePath) {
        addScanLog('Missing base path for rename preview', 'error');
        return;
    }

    const previewBtn = document.getElementById('previewRenamesBtn');
    previewBtn.disabled = true;

    try {
        const response = await fetch('http://localhost:3000/api/matcher/preview-rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                matchResults: matchResults,
                basePath: scanData.basePath
            })
        });

        const result = await response.json();

        if (result.success) {
            renamePreviews = result.previews;
            console.log('[Matcher] Rename previews generated:', renamePreviews);

            displayRenamePreviews(renamePreviews);
            document.getElementById('renamePreviewContainer').style.display = 'block';

            addScanLog(`Rename preview generated: ${renamePreviews.summary.autoApprove + renamePreviews.summary.review} files ready to rename`, 'success');
        } else {
            addScanLog(`Preview error: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('[Matcher] Preview error:', error);
        addScanLog(`Preview error: ${error.message}`, 'error');
    } finally {
        previewBtn.disabled = false;
    }
}

/**
 * Display rename previews
 */
function displayRenamePreviews(previews) {
    const previewList = document.getElementById('renamePreviewList');

    if (!previews) {
        previewList.innerHTML = '<div class="no-results">No previews to display</div>';
        return;
    }

    // Combine auto_approve and review items (skip manual and skipped for rename)
    const itemsToRename = [...previews.auto_approve, ...previews.review];

    if (itemsToRename.length === 0) {
        previewList.innerHTML = '<div class="no-results">No files ready to rename</div>';
        return;
    }

    let html = '';

    for (const item of itemsToRename.slice(0, 50)) { // Limit to first 50 for performance
        if (!item.renamePreview || !item.renamePreview.changed) continue;

        html += `
            <div class="rename-preview-item">
                <div class="rename-preview-path original">
                    <strong>Current:</strong> ${item.renamePreview.originalPath}
                </div>
                <div class="rename-preview-arrow">↓</div>
                <div class="rename-preview-path proposed">
                    <strong>Proposed:</strong> ${item.renamePreview.proposedPath}
                </div>
            </div>
        `;
    }

    if (itemsToRename.length > 50) {
        html += `<div class="no-results">... and ${itemsToRename.length - 50} more files</div>`;
    }

    previewList.innerHTML = html;
}

/**
 * Handle Execute Rename button click
 */
async function handleExecuteRename(dryRun = true) {
    console.log(`[Matcher] Executing rename (dryRun: ${dryRun})...`);

    if (!renamePreviews) {
        addScanLog('No rename previews available. Please click "Preview Renames" first.', 'error');
        return;
    }

    // Combine auto_approve and review items
    const itemsToRename = [...renamePreviews.auto_approve, ...renamePreviews.review];

    if (itemsToRename.length === 0) {
        addScanLog('No files to rename', 'error');
        return;
    }

    const dryRunBtn = document.getElementById('executeDryRunBtn');
    const renameBtn = document.getElementById('executeRenameBtn');
    const progressContainer = document.getElementById('renameProgressContainer');
    const progressText = document.getElementById('renameProgressText');
    const progressBar = document.getElementById('renameProgressBar');
    const resultsContainer = document.getElementById('renameResultsContainer');

    // Disable buttons and show progress
    dryRunBtn.disabled = true;
    renameBtn.disabled = true;
    progressContainer.style.display = 'block';
    resultsContainer.style.display = 'none';

    try {
        const eventSource = await fetch('http://localhost:3000/api/matcher/execute-rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                renameItems: itemsToRename,
                dryRun: dryRun
            })
        });

        const reader = eventSource.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));

                        if (data.type === 'progress') {
                            progressText.textContent = `${dryRun ? '[DRY RUN] ' : ''}Processing ${data.currentFile || ''}... (${data.processed}/${data.total})`;
                            progressBar.style.width = `${data.progress}%`;
                        } else if (data.type === 'complete') {
                            console.log('[Matcher] Rename complete:', data);

                            progressText.textContent = data.message;
                            progressBar.style.width = '100%';

                            // Display results
                            displayRenameResults(data.results, dryRun);
                            resultsContainer.style.display = 'block';

                            addScanLog(data.message, 'success');

                            // Initialize Phase 4 after successful rename (not dry-run)
                            if (!dryRun && data.results && data.results.length > 0) {
                                initMoveToLibrary();
                            }
                        } else if (data.type === 'error') {
                            progressText.textContent = `Error: ${data.error}`;
                            addScanLog(`Rename error: ${data.error}`, 'error');
                        }
                    } catch (parseError) {
                        console.error('[Matcher] Parse error:', parseError);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[Matcher] Rename error:', error);
        progressText.textContent = `Error: ${error.message}`;
        addScanLog(`Rename error: ${error.message}`, 'error');
    } finally {
        dryRunBtn.disabled = false;
        renameBtn.disabled = false;
    }
}

/**
 * Display rename execution results
 */
function displayRenameResults(results, dryRun) {
    const resultsList = document.getElementById('renameResultsList');

    if (!results || results.length === 0) {
        resultsList.innerHTML = '<div class="no-results">No results to display</div>';
        return;
    }

    let html = '';

    for (const result of results) {
        const statusClass = result.status.includes('success') ? 'success' : result.status === 'error' ? 'error' : 'skipped';
        const icon = statusClass === 'success' ? '✅' : statusClass === 'error' ? '❌' : '⏭️';

        html += `
            <div class="rename-result-item ${statusClass}">
                <span>${icon}</span>
                <span>${result.message || result.status}</span>
            </div>
        `;
    }

    resultsList.innerHTML = html;
}

/**
 * ================================================================================
 * MOVE TO LIVE PLEX LIBRARY (Phase 4)
 * ================================================================================
 */

// Phase 4 state
let movePlan = null;
let moveResults = null;

/**
 * Initialize Move to Live Library section after rename is complete
 */
function initMoveToLibrary() {
    console.log('[Move] Initializing Move to Live Library...');

    const moveSection = document.getElementById('moveToLibrarySection');
    const validatePathBtn = document.getElementById('validatePathBtn');
    const planMoveBtn = document.getElementById('planMoveBtn');
    const executeMoveBtn = document.getElementById('executeMoveBtn');
    const cancelPlanBtn = document.getElementById('cancelPlanBtn');
    const rollbackMoveBtn = document.getElementById('rollbackMoveBtn');
    const triggerPlexRefreshBtn = document.getElementById('triggerPlexRefreshBtn');
    const newMoveBtn = document.getElementById('newMoveBtn');
    const liveLibraryPathInput = document.getElementById('liveLibraryPath');

    // Show move section after rename completes
    if (moveSection && renamePreviews) {
        moveSection.style.display = 'block';
        addScanLog('Move to Live Library ready - scroll down to configure', 'info');
    }

    // Load saved live library path
    const savedLiveLibPath = localStorage.getItem('liveLibraryPath');
    if (savedLiveLibPath && liveLibraryPathInput) {
        liveLibraryPathInput.value = savedLiveLibPath;
    }

    // Setup event listeners
    if (validatePathBtn) {
        validatePathBtn.addEventListener('click', handleValidatePath);
    }

    if (planMoveBtn) {
        planMoveBtn.addEventListener('click', handlePlanMove);
    }

    if (executeMoveBtn) {
        executeMoveBtn.addEventListener('click', handleExecuteMove);
    }

    if (cancelPlanBtn) {
        cancelPlanBtn.addEventListener('click', handleCancelPlan);
    }

    if (rollbackMoveBtn) {
        rollbackMoveBtn.addEventListener('click', handleRollback);
    }

    if (triggerPlexRefreshBtn) {
        triggerPlexRefreshBtn.addEventListener('click', handleTriggerPlexRefresh);
    }

    if (newMoveBtn) {
        newMoveBtn.addEventListener('click', resetMoveSection);
    }

    // Add drag and drop support for live library path
    setupLiveLibraryDragAndDrop();
}

/**
 * Setup drag and drop for live library path input
 */
function setupLiveLibraryDragAndDrop() {
    const input = document.getElementById('liveLibraryPath');
    if (!input) return;

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
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry();
                    if (entry && entry.isDirectory) {
                        const folderName = entry.name;
                        const fullPath = prompt(
                            `You dropped the folder: "${folderName}"\n\n` +
                            `Please enter the FULL path to this folder:\n` +
                            `(e.g., /Users/yourname/Music/${folderName} or C:\\Users\\yourname\\Music\\${folderName})`,
                            ''
                        );

                        if (fullPath) {
                            input.value = fullPath;
                            localStorage.setItem('liveLibraryPath', fullPath);
                        }
                        break;
                    }
                }
            }
        }
    }, false);
}

/**
 * Handle path validation
 */
async function handleValidatePath() {
    const liveLibraryPath = document.getElementById('liveLibraryPath').value.trim();
    const statusEl = document.getElementById('pathValidationStatus');

    if (!liveLibraryPath) {
        showPathValidationStatus('error', 'Please enter a live library path');
        return;
    }

    // Save to localStorage
    localStorage.setItem('liveLibraryPath', liveLibraryPath);

    statusEl.style.display = 'block';
    statusEl.className = 'connection-status info';
    statusEl.textContent = 'Validating path...';

    try {
        const response = await fetch('http://localhost:3000/api/organizer/validate-path', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: liveLibraryPath })
        });

        const result = await response.json();

        if (result.success && result.writable) {
            showPathValidationStatus('success', '✓ Path is valid and writable');
            addScanLog(`Live library path validated: ${liveLibraryPath}`, 'success');
        } else if (result.success && !result.writable) {
            showPathValidationStatus('error', '⚠ Path exists but is not writable');
            addScanLog(`Live library path is not writable: ${liveLibraryPath}`, 'error');
        } else {
            showPathValidationStatus('error', `✗ ${result.error || 'Path validation failed'}`);
            addScanLog(`Path validation failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showPathValidationStatus('error', `Error: ${error.message}`);
        addScanLog(`Path validation error: ${error.message}`, 'error');
    }
}

/**
 * Show path validation status
 */
function showPathValidationStatus(type, message) {
    const statusEl = document.getElementById('pathValidationStatus');
    statusEl.style.display = 'block';
    statusEl.className = `connection-status ${type}`;
    statusEl.textContent = message;
}

/**
 * Handle plan move (dry-run)
 */
async function handlePlanMove() {
    const liveLibraryPath = document.getElementById('liveLibraryPath').value.trim();
    const moveMode = document.querySelector('input[name="moveMode"]:checked').value;

    if (!liveLibraryPath) {
        showPathValidationStatus('error', 'Please enter a live library path');
        return;
    }

    if (!renamePreviews || (!renamePreviews.auto_approve.length && !renamePreviews.review.length)) {
        addScanLog('No renamed files to move. Please complete Phase 3.5 first.', 'error');
        return;
    }

    const planBtn = document.getElementById('planMoveBtn');
    planBtn.disabled = true;
    planBtn.textContent = 'Planning...';

    try {
        // Combine auto_approve and review files
        const filesToMove = [...renamePreviews.auto_approve, ...renamePreviews.review];

        const response = await fetch('http://localhost:3000/api/organizer/plan-move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: filesToMove,
                liveLibraryPath,
                plexTracks: plexTracks || null,
                mode: moveMode
            })
        });

        const result = await response.json();

        if (result.success) {
            movePlan = result.plan;
            displayMovePlan(movePlan);
            document.getElementById('movePlanContainer').style.display = 'block';
            addScanLog(`Move plan generated: ${movePlan.summary.newFiles + movePlan.summary.upgrades} files will be moved`, 'success');
        } else {
            addScanLog(`Plan error: ${result.error}`, 'error');
        }
    } catch (error) {
        addScanLog(`Plan error: ${error.message}`, 'error');
    } finally {
        planBtn.disabled = false;
        planBtn.textContent = '🔍 Plan Move (Dry-Run)';
    }
}

/**
 * Display move plan preview
 */
function displayMovePlan(plan) {
    // Update summary statistics
    document.getElementById('planStatNewFiles').textContent = plan.summary.newFiles;
    document.getElementById('planStatUpgrades').textContent = plan.summary.upgrades;
    document.getElementById('planStatDowngrades').textContent = plan.summary.downgrades;
    document.getElementById('planStatSameQuality').textContent = plan.summary.sameQuality;

    // Display operations to be performed
    const planList = document.getElementById('movePlanList');
    let html = '';

    // Show new files
    for (const op of plan.newFiles.slice(0, 20)) {
        html += `
            <div class="rename-preview-item">
                <div class="rename-preview-path original">
                    <strong>Source:</strong> ${op.sourcePath}
                </div>
                <div class="rename-preview-arrow">↓ ADD</div>
                <div class="rename-preview-path proposed">
                    <strong>Destination:</strong> ${op.destinationPath}
                </div>
            </div>
        `;
    }

    // Show upgrades
    for (const op of plan.upgrades.slice(0, 20)) {
        html += `
            <div class="rename-preview-item">
                <div class="rename-preview-path original">
                    <strong>Source:</strong> ${op.sourcePath}
                </div>
                <div class="rename-preview-arrow">↓ REPLACE (Quality Upgrade)</div>
                <div class="rename-preview-path proposed">
                    <strong>Destination:</strong> ${op.destinationPath}
                </div>
            </div>
        `;
    }

    // Show downgrades (will be skipped)
    for (const op of plan.downgrades.slice(0, 10)) {
        html += `
            <div class="rename-preview-item" style="opacity: 0.6;">
                <div class="rename-preview-path original">
                    <strong>Source:</strong> ${op.sourcePath}
                </div>
                <div class="rename-preview-arrow">⏭️ SKIP (Quality Downgrade)</div>
                <div class="rename-preview-path proposed">
                    <strong>Reason:</strong> ${op.reason}
                </div>
            </div>
        `;
    }

    const totalShown = Math.min(20, plan.newFiles.length + plan.upgrades.length) + Math.min(10, plan.downgrades.length);
    const totalOperations = plan.newFiles.length + plan.upgrades.length + plan.downgrades.length + plan.sameQuality.length;

    if (totalOperations > totalShown) {
        html += `<div class="no-results">... and ${totalOperations - totalShown} more operations</div>`;
    }

    planList.innerHTML = html;
}

/**
 * Handle execute move
 */
async function handleExecuteMove() {
    if (!movePlan) {
        addScanLog('No move plan available. Please click "Plan Move" first.', 'error');
        return;
    }

    const confirmed = confirm(
        `You are about to move ${movePlan.summary.newFiles + movePlan.summary.upgrades} files to your live Plex library.\n\n` +
        `This operation will:\n` +
        `- Add ${movePlan.summary.newFiles} new files\n` +
        `- Replace ${movePlan.summary.upgrades} files with higher quality versions\n` +
        `- Skip ${movePlan.summary.downgrades + movePlan.summary.sameQuality} duplicates/downgrades\n\n` +
        `Do you want to proceed?`
    );

    if (!confirmed) return;

    const executeBtn = document.getElementById('executeMoveBtn');
    const progressContainer = document.getElementById('moveProgressContainer');
    const progressText = document.getElementById('moveProgressText');
    const progressBar = document.getElementById('moveProgressBar');
    const resultsContainer = document.getElementById('moveResultsContainer');

    executeBtn.disabled = true;
    progressContainer.style.display = 'block';
    resultsContainer.style.display = 'none';

    // Combine operations to execute (new files + upgrades)
    const operationsToExecute = [...movePlan.newFiles, ...movePlan.upgrades];

    try {
        const response = await fetch('http://localhost:3000/api/organizer/execute-move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operations: operationsToExecute,
                dryRun: false
            })
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
                    try {
                        const data = JSON.parse(line.slice(6));

                        if (data.type === 'progress') {
                            progressText.textContent = `Moving ${data.currentFile || ''}... (${data.processed}/${data.total})`;
                            progressBar.style.width = `${data.progress}%`;
                        } else if (data.type === 'complete') {
                            console.log('[Move] Move complete:', data);
                            moveResults = data.results;

                            progressText.textContent = data.message;
                            progressBar.style.width = '100%';

                            // Display results
                            displayMoveResults(data.results);
                            resultsContainer.style.display = 'block';

                            addScanLog(data.message, 'success');
                        } else if (data.type === 'error') {
                            progressText.textContent = `Error: ${data.error}`;
                            addScanLog(`Move error: ${data.error}`, 'error');
                        }
                    } catch (parseError) {
                        console.error('[Move] Parse error:', parseError);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[Move] Move error:', error);
        progressText.textContent = `Error: ${error.message}`;
        addScanLog(`Move error: ${error.message}`, 'error');
    } finally {
        executeBtn.disabled = false;
    }
}

/**
 * Display move results
 */
function displayMoveResults(results) {
    const resultsList = document.getElementById('moveResultsList');

    if (!results || results.length === 0) {
        resultsList.innerHTML = '<div class="no-results">No results to display</div>';
        return;
    }

    let html = '';

    for (const result of results) {
        const statusClass = result.status.includes('success') ? 'success' : result.status === 'error' ? 'error' : 'skipped';
        const icon = statusClass === 'success' ? '✅' : statusClass === 'error' ? '❌' : '⏭️';

        const actionText = result.action === 'REPLACE' ? 'Replaced (upgrade)' : result.action || result.status;

        html += `
            <div class="rename-result-item ${statusClass}">
                <span>${icon}</span>
                <span><strong>${actionText}:</strong> ${result.destinationPath || result.sourcePath}</span>
            </div>
        `;
    }

    resultsList.innerHTML = html;
}

/**
 * Handle cancel plan
 */
function handleCancelPlan() {
    movePlan = null;
    document.getElementById('movePlanContainer').style.display = 'none';
    addScanLog('Move plan cancelled', 'info');
}

/**
 * Handle rollback
 */
async function handleRollback() {
    const confirmed = confirm(
        'This will attempt to undo the last move operation.\n\n' +
        'Note: Deleted files (from quality upgrades) cannot be restored.\n\n' +
        'Do you want to proceed?'
    );

    if (!confirmed) return;

    const rollbackBtn = document.getElementById('rollbackMoveBtn');
    rollbackBtn.disabled = true;
    rollbackBtn.textContent = 'Rolling back...';

    try {
        const response = await fetch('http://localhost:3000/api/organizer/rollback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();

        if (result.success) {
            addScanLog(`Rollback complete: ${result.summary.restored} files restored, ${result.summary.deleted} files deleted`, 'success');
            alert(`Rollback completed.\n\nRestored: ${result.summary.restored}\nDeleted: ${result.summary.deleted}\nFailed: ${result.summary.failed}`);
        } else {
            addScanLog(`Rollback error: ${result.error}`, 'error');
        }
    } catch (error) {
        addScanLog(`Rollback error: ${error.message}`, 'error');
    } finally {
        rollbackBtn.disabled = false;
        rollbackBtn.textContent = '↩️ Rollback Last Move';
    }
}

/**
 * Handle trigger Plex refresh
 */
async function handleTriggerPlexRefresh() {
    if (!plexConnectionData || !selectedLibraryId) {
        addScanLog('Plex connection data not available. Please complete Phase 2.5 first.', 'error');
        return;
    }

    const { serverIp, port, token } = plexConnectionData;
    const refreshBtn = document.getElementById('triggerPlexRefreshBtn');
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing...';

    try {
        const response = await fetch('http://localhost:3000/api/organizer/plex-refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverIp, port, token, libraryId: selectedLibraryId })
        });

        const result = await response.json();

        if (result.success) {
            addScanLog('Plex library refresh triggered successfully', 'success');
            alert('Plex library refresh triggered! Your Plex server will now scan for new files.');
        } else {
            addScanLog(`Plex refresh error: ${result.message}`, 'error');
        }
    } catch (error) {
        addScanLog(`Plex refresh error: ${error.message}`, 'error');
    } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = '🔄 Trigger Plex Refresh';
    }
}

/**
 * Reset move section for new operation
 */
function resetMoveSection() {
    movePlan = null;
    moveResults = null;
    document.getElementById('movePlanContainer').style.display = 'none';
    document.getElementById('moveProgressContainer').style.display = 'none';
    document.getElementById('moveResultsContainer').style.display = 'none';
    document.getElementById('pathValidationStatus').style.display = 'none';
    addScanLog('Move section reset', 'info');
}

// Register the organizer route
router.register('organizer', initOrganizer);
