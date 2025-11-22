/**
 * Quality Upgrader Module
 * Standalone module for upgrading 4-5 star rated tracks to FLAC quality from YouTube Music
 */

// Phase 5 state variables
let upgraderRatedTracks = [];
let upgraderUpgradeCandidates = [];
let upgraderSelectedUpgrades = new Set();
let upgraderUpgradeResults = [];
let upgraderSelectedLibraryId = null;

/**
 * Initialize the upgrader module
 */
function initUpgrader() {
    console.log('[Upgrader] Initializing Quality Upgrader module');

    // Load saved Plex settings
    loadPlexSettings();

    // Setup event listeners
    const testConnectionBtn = document.getElementById('upgraderTestConnectionBtn');
    const fetchRatedTracksBtn = document.getElementById('fetchRatedTracksBtn');
    const detectUpgradesBtn = document.getElementById('detectUpgradesBtn');
    const selectAllUpgradesBtn = document.getElementById('selectAllUpgradesBtn');
    const deselectAllUpgradesBtn = document.getElementById('deselectAllUpgradesBtn');
    const scrollToBottomUpgradesBtn = document.getElementById('scrollToBottomUpgradesBtn');
    const startBulkUpgradeBtn = document.getElementById('startBulkUpgradeBtn');

    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', handleTestConnection);
    }

    if (fetchRatedTracksBtn) {
        fetchRatedTracksBtn.addEventListener('click', handleFetchRatedTracks);
    }

    if (detectUpgradesBtn) {
        detectUpgradesBtn.addEventListener('click', handleDetectUpgrades);
    }

    if (selectAllUpgradesBtn) {
        selectAllUpgradesBtn.addEventListener('click', () => {
            document.querySelectorAll('.upgrade-checkbox').forEach(cb => {
                cb.checked = true;
                upgraderSelectedUpgrades.add(parseInt(cb.dataset.index));
            });
        });
    }

    if (deselectAllUpgradesBtn) {
        deselectAllUpgradesBtn.addEventListener('click', () => {
            document.querySelectorAll('.upgrade-checkbox').forEach(cb => {
                cb.checked = false;
                upgraderSelectedUpgrades.delete(parseInt(cb.dataset.index));
            });
        });
    }

    if (scrollToBottomUpgradesBtn) {
        scrollToBottomUpgradesBtn.addEventListener('click', () => {
            const bulkUpgradeBtn = document.getElementById('startBulkUpgradeBtn');
            if (bulkUpgradeBtn) {
                bulkUpgradeBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    }

    if (startBulkUpgradeBtn) {
        startBulkUpgradeBtn.addEventListener('click', handleBulkUpgrade);
    }

    // Show the module
    const module = document.getElementById('module-upgrader');
    if (module) {
        module.classList.add('active');
    }
}

/**
 * Load saved Plex settings from localStorage
 */
function loadPlexSettings() {
    const serverIp = localStorage.getItem('plexServerIp');
    const port = localStorage.getItem('plexPort');
    const token = localStorage.getItem('plexToken');

    if (serverIp) document.getElementById('upgraderPlexServer').value = serverIp;
    if (port) document.getElementById('upgraderPlexPort').value = port;
    if (token) document.getElementById('upgraderPlexToken').value = token;
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
 * Test Plex connection
 */
async function handleTestConnection() {
    console.log('[Upgrader] Testing Plex connection');

    const serverIp = document.getElementById('upgraderPlexServer').value;
    const port = document.getElementById('upgraderPlexPort').value;
    const token = document.getElementById('upgraderPlexToken').value;

    if (!serverIp || !port || !token) {
        alert('Please fill in all Plex settings');
        return;
    }

    const statusDiv = document.getElementById('upgraderConnectionStatus');
    const testBtn = document.getElementById('upgraderTestConnectionBtn');

    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';
    statusDiv.style.display = 'block';
    statusDiv.textContent = 'Testing connection...';
    statusDiv.className = '';

    try {
        const response = await fetch('http://localhost:3000/api/plex/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverIp, port, token })
        });

        const result = await response.json();

        if (result.success) {
            statusDiv.textContent = `✅ Connected to Plex! Server: ${result.serverName}`;
            statusDiv.className = 'success-message';

            // Save settings
            savePlexSettings(serverIp, port, token);

            // Fetch libraries
            await fetchLibraries(serverIp, port, token);
        } else {
            statusDiv.textContent = `❌ Connection failed: ${result.error}`;
            statusDiv.className = 'error-message';
        }
    } catch (error) {
        console.error('[Upgrader] Connection error:', error);
        statusDiv.textContent = `❌ Connection error: ${error.message}`;
        statusDiv.className = 'error-message';
    } finally {
        testBtn.disabled = false;
        testBtn.textContent = '🔌 Test Connection';
    }
}

/**
 * Fetch available Plex libraries
 */
async function fetchLibraries(serverIp, port, token) {
    try {
        const response = await fetch('http://localhost:3000/api/plex/libraries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverIp, port, token })
        });

        const result = await response.json();

        if (result.success) {
            displayLibraries(result.libraries);
            document.getElementById('upgraderLibraryContainer').style.display = 'block';
        }
    } catch (error) {
        console.error('[Upgrader] Error fetching libraries:', error);
    }
}

/**
 * Display Plex libraries
 */
function displayLibraries(libraries) {
    const container = document.getElementById('upgraderLibraryList');
    container.innerHTML = '';

    libraries.forEach(library => {
        const item = document.createElement('div');
        item.className = 'library-item';
        item.innerHTML = `
            <div class="library-item-title">${library.name}</div>
            <div class="library-item-subtitle">${library.type} • ${library.trackCount} items</div>
        `;

        item.addEventListener('click', () => {
            // Remove selected class from all items
            container.querySelectorAll('.library-item').forEach(i => i.classList.remove('selected'));
            // Add selected class to clicked item
            item.classList.add('selected');
            // Store selected library ID
            upgraderSelectedLibraryId = library.id;
            // Show settings container
            document.getElementById('upgraderSettingsContainer').style.display = 'block';
            console.log('[Upgrader] Selected library:', library.name, 'ID:', upgraderSelectedLibraryId);
        });

        container.appendChild(item);
    });
}

/**
 * Handle fetching rated tracks from Plex
 */
async function handleFetchRatedTracks() {
    console.log('[Upgrader] Fetching rated tracks from Plex');

    const minRating = parseInt(document.getElementById('upgradeMinRating').value);
    const fetchBtn = document.getElementById('fetchRatedTracksBtn');

    // Check if Plex settings are configured
    const serverIp = localStorage.getItem('plexServerIp');
    const port = localStorage.getItem('plexPort');
    const token = localStorage.getItem('plexToken');

    if (!serverIp || !port || !token || !upgraderSelectedLibraryId) {
        alert('Please configure Plex settings and select a library first');
        return;
    }

    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching...';

    // Show progress container
    document.getElementById('upgradeRatedProgressContainer').style.display = 'block';
    document.getElementById('upgradeRatedProgressText').textContent = 'Connecting to Plex...';
    document.getElementById('upgradeRatedProgressBar').style.width = '0%';

    try {
        const response = await fetch('http://localhost:3000/api/upgrader/fetch-rated-tracks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serverIp,
                port,
                token,
                libraryId: upgraderSelectedLibraryId,
                minRating
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));

                        // Update progress
                        if (data.progress !== undefined) {
                            document.getElementById('upgradeRatedProgressBar').style.width = `${data.progress}%`;
                        }

                        if (data.status) {
                            document.getElementById('upgradeRatedProgressText').textContent = data.status;
                        }

                        if (data.completed && data.ratedTracks) {
                            upgraderRatedTracks = data.ratedTracks;
                            console.log(`[Upgrader] Fetched ${upgraderRatedTracks.length} rated tracks`);

                            // Show summary
                            document.getElementById('upgradeSummaryContainer').style.display = 'block';
                            document.getElementById('upgradeTotalRated').textContent = upgraderRatedTracks.length;

                            // Hide progress
                            setTimeout(() => {
                                document.getElementById('upgradeRatedProgressContainer').style.display = 'none';
                            }, 1000);
                        }

                        if (data.error) {
                            console.error('[Upgrader] Fetch error:', data.error);
                            alert(`Error: ${data.error}`);
                        }
                    } catch (error) {
                        console.error('[Upgrader] Parse error:', error);
                    }
                }
            }
        }
    } catch (error) {
        console.error('[Upgrader] Fetch error:', error);
        alert(`Error fetching rated tracks: ${error.message}`);
    } finally {
        fetchBtn.disabled = false;
        fetchBtn.textContent = '🎵 Fetch Rated Tracks from Plex';
    }
}

/**
 * Handle detecting upgrade candidates
 */
async function handleDetectUpgrades() {
    console.log('[Upgrader] Detecting upgrade candidates');

    const detectBtn = document.getElementById('detectUpgradesBtn');
    detectBtn.disabled = true;
    detectBtn.textContent = 'Detecting...';

    try {
        const response = await fetch('http://localhost:3000/api/upgrader/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: upgraderRatedTracks })
        });

        const result = await response.json();

        if (result.success) {
            upgraderUpgradeCandidates = result.candidates;
            const alreadyUpgraded = result.alreadyUpgraded || 0;

            console.log(`[Upgrader] Found ${upgraderUpgradeCandidates.length} candidates (${alreadyUpgraded} already upgraded)`);

            // Update summary
            document.getElementById('upgradeLowQualityCount').textContent = upgraderUpgradeCandidates.length;
            document.getElementById('upgradeAlreadyCount').textContent = alreadyUpgraded;

            // Display candidates
            displayUpgradeCandidates();

            // Show candidates container
            document.getElementById('upgradeCandidatesContainer').style.display = 'block';
        } else {
            alert(`Error detecting upgrades: ${result.error}`);
        }
    } catch (error) {
        console.error('[Upgrader] Detect error:', error);
        alert(`Error detecting upgrades: ${error.message}`);
    } finally {
        detectBtn.disabled = false;
        detectBtn.textContent = '🔍 Detect Upgrade Candidates';
    }
}

/**
 * Display upgrade candidates
 */
function displayUpgradeCandidates() {
    const container = document.getElementById('upgradeCandidatesList');
    container.innerHTML = '';

    if (upgraderUpgradeCandidates.length === 0) {
        container.innerHTML = '<div class="no-results">No upgrade candidates found. All your rated tracks are already high quality!</div>';
        return;
    }

    upgraderUpgradeCandidates.forEach((candidate, index) => {
        const card = document.createElement('div');
        card.className = 'upgrade-candidate-card';

        const stars = '⭐'.repeat(candidate.userRating);

        card.innerHTML = `
            <div class="upgrade-candidate-header">
                <input type="checkbox" class="upgrade-checkbox" data-index="${index}" checked>
                <div class="upgrade-candidate-info">
                    <div class="upgrade-track-title">
                        <strong>${candidate.artist}</strong> - ${candidate.title}
                    </div>
                    <div class="upgrade-track-subtitle">
                        Album: ${candidate.album} ${candidate.year ? `(${candidate.year})` : ''}
                    </div>
                    <div class="upgrade-rating">${stars} ${candidate.userRating} stars</div>
                </div>
            </div>
            <div class="upgrade-quality-comparison">
                <div class="quality-current">
                    <span class="label">Current:</span>
                    <span class="badge badge-warning">${candidate.currentQuality.codec} ${candidate.currentQuality.bitrate}kbps</span>
                </div>
                <div class="quality-arrow">→</div>
                <div class="quality-target">
                    <span class="label">Target:</span>
                    <span class="badge badge-success">${candidate.targetQuality.codec} ${candidate.targetQuality.bitrate}kbps</span>
                </div>
            </div>
        `;

        // Add to selection by default
        upgraderSelectedUpgrades.add(index);

        container.appendChild(card);
    });

    // Add event listeners to checkboxes
    container.querySelectorAll('.upgrade-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            if (e.target.checked) {
                upgraderSelectedUpgrades.add(index);
            } else {
                upgraderSelectedUpgrades.delete(index);
            }
            console.log(`[Upgrader] Selected: ${upgraderSelectedUpgrades.size}/${upgraderUpgradeCandidates.length}`);
        });
    });
}

/**
 * Handle bulk upgrade
 */
async function handleBulkUpgrade() {
    if (upgraderSelectedUpgrades.size === 0) {
        alert('Please select at least one track to upgrade');
        return;
    }

    console.log(`[Upgrader] Starting bulk upgrade for ${upgraderSelectedUpgrades.size} tracks`);

    const startBtn = document.getElementById('startBulkUpgradeBtn');
    startBtn.disabled = true;

    // Show progress container
    document.getElementById('upgradeProgressContainer').style.display = 'block';
    document.getElementById('upgradeResultsContainer').style.display = 'none';

    // Reset counters
    let completed = 0;
    let failed = 0;
    upgraderUpgradeResults = [];

    // Get cookies and PO token from localStorage
    const cookies = localStorage.getItem('cookiesPath');
    const poToken = localStorage.getItem('poToken');

    const selectedIndices = Array.from(upgraderSelectedUpgrades);
    const totalTracks = selectedIndices.length;

    for (let i = 0; i < selectedIndices.length; i++) {
        const index = selectedIndices[i];
        const track = upgraderUpgradeCandidates[index];

        console.log(`[Upgrader] Processing ${i + 1}/${totalTracks}: ${track.artist} - ${track.title}`);

        document.getElementById('upgradeInProgressCount').textContent = '1';
        document.getElementById('upgradeCurrentTrack').textContent = `${track.artist} - ${track.title}`;

        try {
            // Step 1: Search YouTube Music
            const searchResponse = await fetch('http://localhost:3000/api/upgrader/search-youtube', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    track,
                    cookies,
                    poToken,
                    useMusicBrainz: false // Try Plex metadata first
                })
            });

            const searchResult = await searchResponse.json();

            if (!searchResult.success || !searchResult.result) {
                // Try with MusicBrainz fallback
                console.log(`[Upgrader] Retrying with MusicBrainz fallback`);
                const searchResponse2 = await fetch('http://localhost:3000/api/upgrader/search-youtube', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        track,
                        cookies,
                        poToken,
                        useMusicBrainz: true
                    })
                });

                const searchResult2 = await searchResponse2.json();

                if (!searchResult2.success || !searchResult2.result) {
                    throw new Error('No match found on YouTube Music');
                }
            }

            const youtubeUrl = searchResult.result.url;

            // Step 2: Download and replace
            const downloadResponse = await fetch('http://localhost:3000/api/upgrader/download-upgrade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    track,
                    youtubeUrl,
                    cookies,
                    poToken
                })
            });

            const reader = downloadResponse.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.progress !== undefined) {
                                const overallProgress = ((i + data.progress / 100) / totalTracks) * 100;
                                document.getElementById('upgradeProgressBar').style.width = `${overallProgress}%`;
                                document.getElementById('upgradeProgressText').textContent =
                                    `Downloading ${i + 1}/${totalTracks}: ${Math.round(data.progress)}%`;
                            }

                            if (data.completed) {
                                if (data.success) {
                                    completed++;
                                    upgraderUpgradeResults.push({
                                        track,
                                        success: true,
                                        message: `Upgraded to FLAC`
                                    });
                                } else {
                                    failed++;
                                    upgraderUpgradeResults.push({
                                        track,
                                        success: false,
                                        message: data.error || 'Download failed'
                                    });
                                }
                            }
                        } catch (error) {
                            console.error('[Upgrader] Parse error:', error);
                        }
                    }
                }
            }

            document.getElementById('upgradeCompletedCount').textContent = completed;
            document.getElementById('upgradeFailedCount').textContent = failed;

        } catch (error) {
            console.error('[Upgrader] Error:', error);
            failed++;
            upgraderUpgradeResults.push({
                track,
                success: false,
                message: error.message
            });
            document.getElementById('upgradeFailedCount').textContent = failed;
        }

        document.getElementById('upgradeInProgressCount').textContent = '0';
    }

    // Show results
    document.getElementById('upgradeProgressBar').style.width = '100%';
    document.getElementById('upgradeProgressText').textContent = `Completed ${completed}/${totalTracks} upgrades`;
    displayUpgradeResults();
    document.getElementById('upgradeResultsContainer').style.display = 'block';

    startBtn.disabled = false;
    console.log(`[Upgrader] Upgrade complete: ${completed} succeeded, ${failed} failed`);
}

/**
 * Display upgrade results
 */
function displayUpgradeResults() {
    const container = document.getElementById('upgradeResultsList');
    container.innerHTML = '';

    upgraderUpgradeResults.forEach(result => {
        const item = document.createElement('div');
        item.className = `rename-result-item ${result.success ? 'success' : 'error'}`;

        item.innerHTML = `
            <div class="status-icon">${result.success ? '✅' : '❌'}</div>
            <div class="result-info">
                <div class="track-name">${result.track.artist} - ${result.track.title}</div>
                <div class="result-message">${result.message}</div>
            </div>
        `;

        container.appendChild(item);
    });
}

// Register the upgrader route
router.register('upgrader', initUpgrader);
