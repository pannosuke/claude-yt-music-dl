/**
 * Music Library Organizer Module
 * Organizes music files for optimal Plex Media Server compatibility
 */

// Module state
let scanData = null;
let selectedGroups = new Set();

// DOM elements
const organizerElements = {
    form: null,
    scanBtn: null,
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
    issuesList: null,
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
    organizerElements.issuesList = document.getElementById('issuesList');
    organizerElements.formatList = document.getElementById('formatList');
    organizerElements.groupGrid = document.getElementById('groupGrid');

    // Load saved settings
    loadSavedPath();

    // Setup event listeners
    organizerElements.form.addEventListener('submit', handleScanSubmit);
    organizerElements.newScanBtn.addEventListener('click', resetScan);

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

    // Clear progress
    organizerElements.progressContainer.style.display = 'none';
    organizerElements.logContainer.innerHTML = '';
}

/**
 * Display scan results
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
        organizerElements.issuesList.innerHTML = issuesHTML;
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
 * Display artist groups (alphabetical)
 */
function displayArtistGroups(groupedByArtist) {
    let groupsHTML = '';

    // Sort by letter
    const sortedLetters = Object.keys(groupedByArtist).sort();

    for (const letter of sortedLetters) {
        const group = groupedByArtist[letter];
        groupsHTML += `
            <div class="group-card" data-letter="${letter}">
                <div class="letter">${letter}</div>
                <div class="stats">
                    ${group.artistCount} artist${group.artistCount !== 1 ? 's' : ''}<br>
                    ${group.fileCount} file${group.fileCount !== 1 ? 's' : ''}
                </div>
            </div>
        `;
    }

    organizerElements.groupGrid.innerHTML = groupsHTML;

    // Add click handlers to group cards
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
        });
    });
}

/**
 * Handle scan form submission
 */
async function handleScanSubmit(e) {
    e.preventDefault();

    const musicPath = organizerElements.musicPathInput.value.trim();

    // Save path to localStorage
    savePath(musicPath);

    addScanLog(`Starting scan of: ${musicPath}`, 'info');

    // Show progress container
    organizerElements.progressContainer.style.display = 'block';
    organizerElements.logContainer.innerHTML = '';
    organizerElements.scanBtn.disabled = true;
    organizerElements.scanBtn.textContent = 'Scanning...';

    try {
        const response = await fetch('http://localhost:3000/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ musicPath })
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

                        if (data.summary) {
                            addScanLog(`Scan completed! ${data.summary.totalFiles} files processed.`, 'success');
                            displayScanResults(data);
                        }
                    }
                }
            }
        }
    } catch (error) {
        addScanLog(`Error: ${error.message}`, 'error');
        organizerElements.scanBtn.disabled = false;
        organizerElements.scanBtn.textContent = 'Scan Library';
    }
}

// Register the organizer route
router.register('organizer', initOrganizer);
