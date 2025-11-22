/**
 * Artist Radar & Discovery Dashboard
 * Monitors rated artists for new releases and missing albums
 */

// State variables
let radarNewReleases = [];
let radarMissingAlbums = [];
let radarIgnoredReleases = [];
let radarSelectedLibraryId = null;

/**
 * Initialize the Artist Radar module
 */
function initRadar() {
    console.log('[Radar] Initializing Artist Radar module');

    // Load saved Plex settings
    loadPlexSettingsRadar();

    // Setup event listeners
    const testConnectionBtn = document.getElementById('radarTestConnectionBtn');
    const scanRadarBtn = document.getElementById('scanRadarBtn');
    const viewIgnoredBtn = document.getElementById('viewIgnoredBtn');

    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', handleRadarTestConnection);
    }

    if (scanRadarBtn) {
        scanRadarBtn.addEventListener('click', handleRadarScan);
    }

    if (viewIgnoredBtn) {
        viewIgnoredBtn.addEventListener('click', handleViewIgnored);
    }

    // Show the module
    const module = document.getElementById('module-radar');
    if (module) {
        module.classList.add('active');
    }
}

/**
 * Load Plex settings from localStorage
 */
function loadPlexSettingsRadar() {
    const serverIp = localStorage.getItem('plexServerIp');
    const port = localStorage.getItem('plexPort');
    const token = localStorage.getItem('plexToken');

    if (serverIp) document.getElementById('radarPlexServer').value = serverIp;
    if (port) document.getElementById('radarPlexPort').value = port;
    if (token) document.getElementById('radarPlexToken').value = token;
}

/**
 * Save Plex settings to localStorage
 */
function savePlexSettingsRadar() {
    const serverIp = document.getElementById('radarPlexServer').value.trim();
    const port = document.getElementById('radarPlexPort').value.trim();
    const token = document.getElementById('radarPlexToken').value.trim();

    localStorage.setItem('plexServerIp', serverIp);
    localStorage.setItem('plexPort', port);
    localStorage.setItem('plexToken', token);
}

/**
 * Test Plex connection
 */
async function handleRadarTestConnection() {
    const serverIp = document.getElementById('radarPlexServer').value.trim();
    const port = document.getElementById('radarPlexPort').value.trim();
    const token = document.getElementById('radarPlexToken').value.trim();

    if (!serverIp || !port || !token) {
        alert('Please fill in all Plex connection fields');
        return;
    }

    savePlexSettingsRadar();

    const statusDiv = document.getElementById('radarConnectionStatus');
    statusDiv.textContent = 'Testing connection...';
    statusDiv.className = 'status-message';

    try {
        const response = await fetch('/api/plex/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverIp, port, token })
        });

        const data = await response.json();

        if (data.success) {
            statusDiv.textContent = `✓ Connected to ${data.serverName} (v${data.version})`;
            statusDiv.className = 'status-message success';

            // Fetch libraries
            await fetchRadarLibraries();
        } else {
            statusDiv.textContent = `✗ Connection failed: ${data.error}`;
            statusDiv.className = 'status-message error';
        }

    } catch (error) {
        statusDiv.textContent = `✗ Connection error: ${error.message}`;
        statusDiv.className = 'status-message error';
    }
}

/**
 * Fetch Plex music libraries
 */
async function fetchRadarLibraries() {
    const serverIp = document.getElementById('radarPlexServer').value.trim();
    const port = document.getElementById('radarPlexPort').value.trim();
    const token = document.getElementById('radarPlexToken').value.trim();

    try {
        const response = await fetch('/api/plex/libraries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverIp, port, token })
        });

        const data = await response.json();

        if (data.success && data.libraries.length > 0) {
            const librarySelect = document.getElementById('radarPlexLibrary');
            librarySelect.innerHTML = data.libraries.map(lib =>
                `<option value="${lib.id}">${lib.name}</option>`
            ).join('');

            radarSelectedLibraryId = data.libraries[0].id;
            librarySelect.disabled = false;
            document.getElementById('scanRadarBtn').disabled = false;
        }

    } catch (error) {
        console.error('[Radar] Error fetching libraries:', error);
    }
}

/**
 * Scan rated artists for new releases and missing albums
 */
async function handleRadarScan() {
    const serverIp = document.getElementById('radarPlexServer').value.trim();
    const port = document.getElementById('radarPlexPort').value.trim();
    const token = document.getElementById('radarPlexToken').value.trim();
    const libraryKey = document.getElementById('radarPlexLibrary').value;
    const ratingFilter = document.getElementById('radarRatingFilter').value;

    if (!serverIp || !port || !token || !libraryKey) {
        alert('Please connect to Plex and select a library first');
        return;
    }

    savePlexSettingsRadar();

    const scanBtn = document.getElementById('scanRadarBtn');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';

    const progressDiv = document.getElementById('radarScanProgress');
    const resultsSection = document.getElementById('radarResults');

    progressDiv.style.display = 'block';
    progressDiv.innerHTML = '<p>Starting scan...</p>';
    resultsSection.style.display = 'none';

    try {
        const response = await fetch('/api/radar/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serverIp, port, token, libraryKey, ratingFilter })
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
                        progressDiv.innerHTML = `<p>${data.message}</p>`;
                    } else if (data.type === 'complete') {
                        console.log('[Radar] Received complete event:', data);
                        console.log('[Radar] New releases count:', data.newReleasesCount || 0);
                        console.log('[Radar] Missing albums count:', data.missingAlbumsCount || 0);

                        // Fetch the actual results from the server
                        progressDiv.innerHTML = `<p>Loading results...</p>`;
                        fetchRadarResults();
                    } else if (data.type === 'error') {
                        progressDiv.innerHTML = `<p class="error">Error: ${data.message}</p>`;
                    }
                }
            }
        }

    } catch (error) {
        progressDiv.innerHTML = `<p class="error">Scan error: ${error.message}</p>`;
    } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = 'Scan Artists';
    }
}

/**
 * Fetch radar results from the server
 */
async function fetchRadarResults() {
    const progressDiv = document.getElementById('radarScanProgress');
    const resultsSection = document.getElementById('radarResults');

    try {
        const response = await fetch('/api/radar/results');
        const data = await response.json();

        if (data.success) {
            radarNewReleases = data.newReleases || [];
            radarMissingAlbums = data.missingAlbums || [];

            console.log('[Radar] Loaded results - newReleases:', radarNewReleases.length, 'missingAlbums:', radarMissingAlbums.length);

            progressDiv.style.display = 'none';
            resultsSection.style.display = 'block';

            renderRadarResults();
        } else {
            progressDiv.innerHTML = `<p class="error">Error loading results: ${data.error}</p>`;
        }

    } catch (error) {
        progressDiv.innerHTML = `<p class="error">Error loading results: ${error.message}</p>`;
    }
}

/**
 * Render radar results (new releases + missing albums)
 */
function renderRadarResults() {
    console.log('[Radar] renderRadarResults called');
    console.log('[Radar] radarNewReleases:', radarNewReleases);
    console.log('[Radar] radarMissingAlbums:', radarMissingAlbums);

    const newReleasesDiv = document.getElementById('radarNewReleases');
    const missingAlbumsDiv = document.getElementById('radarMissingAlbums');

    console.log('[Radar] newReleasesDiv:', newReleasesDiv);
    console.log('[Radar] missingAlbumsDiv:', missingAlbumsDiv);

    // Render new releases
    if (radarNewReleases.length === 0) {
        newReleasesDiv.innerHTML = '<p class="empty-state">No new releases found</p>';
    } else {
        newReleasesDiv.innerHTML = `
            <h3>🆕 NEW RELEASES (Last 30-180 Days)</h3>
            <p class="release-count">${radarNewReleases.length} new releases</p>
            <div class="release-grid">
                ${radarNewReleases.map((release, index) => `
                    <div class="release-card" data-index="${index}">
                        <div class="release-header">
                            <strong>${release.artist}</strong>
                            <span class="rating-stars">${'⭐'.repeat(release.artistRating)}</span>
                        </div>
                        <div class="release-title">
                            ${release.mbid ? `<a href="https://musicbrainz.org/release-group/${release.mbid}" target="_blank" rel="noopener noreferrer">${release.title}</a>` : release.title}
                        </div>
                        <div class="release-meta">
                            <span class="release-date">${release.releaseDate}</span>
                            <span class="release-type ${release.type.toLowerCase()}">${release.type}</span>
                            <span class="days-ago">${release.daysAgo} days ago</span>
                        </div>
                        <div class="release-actions">
                            <button class="btn-download" onclick="handleDownloadRelease(this.dataset.artist, this.dataset.title)" data-artist="${release.artist.replace(/"/g, '&quot;')}" data-title="${release.title.replace(/"/g, '&quot;')}">
                                ⬇️ Download
                            </button>
                            <button class="btn-ignore" onclick="handleIgnoreRelease(this.dataset.artist, this.dataset.title, this.dataset.mbid, this.dataset.type)" data-artist="${release.artist.replace(/"/g, '&quot;')}" data-title="${release.title.replace(/"/g, '&quot;')}" data-mbid="${release.mbid || ''}" data-type="${release.type}">
                                ⏭️ Ignore
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // Render missing albums
    if (radarMissingAlbums.length === 0) {
        missingAlbumsDiv.innerHTML = '<p class="empty-state">No missing albums found</p>';
    } else {
        missingAlbumsDiv.innerHTML = `
            <h3>📀 MISSING ALBUMS (Discography Gaps)</h3>
            <p class="release-count">${radarMissingAlbums.length} missing albums</p>
            <div class="release-grid">
                ${radarMissingAlbums.map((album, index) => `
                    <div class="release-card" data-index="${index}">
                        <div class="release-header">
                            <strong>${album.artist}</strong>
                            <span class="rating-stars">${'⭐'.repeat(album.artistRating)}</span>
                        </div>
                        <div class="release-title">
                            ${album.mbid ? `<a href="https://musicbrainz.org/release-group/${album.mbid}" target="_blank" rel="noopener noreferrer">${album.title}</a>` : album.title}
                        </div>
                        <div class="release-meta">
                            <span class="release-date">${album.releaseDate}</span>
                            <span class="release-type ${album.type.toLowerCase()}">${album.type}</span>
                        </div>
                        <div class="release-actions">
                            <button class="btn-download" onclick="handleDownloadRelease(this.dataset.artist, this.dataset.title)" data-artist="${album.artist.replace(/"/g, '&quot;')}" data-title="${album.title.replace(/"/g, '&quot;')}">
                                ⬇️ Download
                            </button>
                            <button class="btn-ignore" onclick="handleIgnoreRelease(this.dataset.artist, this.dataset.title, this.dataset.mbid, this.dataset.type)" data-artist="${album.artist.replace(/"/g, '&quot;')}" data-title="${album.title.replace(/"/g, '&quot;')}" data-mbid="${album.mbid || ''}" data-type="${album.type}">
                                ⏭️ Ignore
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

/**
 * Download a release via YouTube Music search
 */
async function handleDownloadRelease(artist, title) {
    console.log(`[Radar] Opening YouTube Music search for: ${artist} - ${title}`);

    // Construct YouTube Music search URL
    const searchQuery = `${artist} ${title}`;
    const ytMusicSearchUrl = `https://music.youtube.com/search?q=${encodeURIComponent(searchQuery)}`;

    // Open YouTube Music search in new tab
    window.open(ytMusicSearchUrl, '_blank');
}

/**
 * Ignore a release
 */
async function handleIgnoreRelease(artist, title, mbid, type) {
    try {
        const response = await fetch('/api/radar/ignore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                artistName: artist,
                releaseTitle: title,
                releaseMbid: mbid,
                releaseType: type
            })
        });

        const data = await response.json();

        if (data.success) {
            // Remove from current results
            radarNewReleases = radarNewReleases.filter(r =>
                !(r.artist === artist && r.title === title)
            );
            radarMissingAlbums = radarMissingAlbums.filter(a =>
                !(a.artist === artist && a.title === title)
            );

            // Re-render
            renderRadarResults();

            console.log(`[Radar] Ignored: ${artist} - ${title}`);
        } else {
            alert(`Failed to ignore release: ${data.error}`);
        }

    } catch (error) {
        alert(`Error ignoring release: ${error.message}`);
    }
}

/**
 * View ignored releases
 */
async function handleViewIgnored() {
    try {
        const response = await fetch('/api/radar/ignored');
        const data = await response.json();

        if (data.success) {
            radarIgnoredReleases = data.ignored;

            if (radarIgnoredReleases.length === 0) {
                alert('No ignored releases');
                return;
            }

            const ignoredList = radarIgnoredReleases.map(r =>
                `• ${r.artist_name} - ${r.release_title} (${r.release_type || 'Unknown'})`
            ).join('\n');

            alert(`Ignored Releases (${radarIgnoredReleases.length}):\n\n${ignoredList}\n\nTo un-ignore, remove from the database manually or implement UI for it.`);

        } else {
            alert(`Failed to load ignored releases: ${data.error}`);
        }

    } catch (error) {
        alert(`Error loading ignored releases: ${error.message}`);
    }
}

// Register route with router
router.register('radar', initRadar);
