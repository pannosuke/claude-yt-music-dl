/**
 * Artist Radar & Discovery Dashboard
 * Monitors rated artists for new releases and missing albums
 */

// State variables
let radarNewReleases = [];
let radarMissingAlbums = [];
let radarIgnoredReleases = [];
let radarCompilationOpportunities = [];
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
    const scanCompilationsBtn = document.getElementById('scanCompilationsBtn');
    const viewIgnoredBtn = document.getElementById('viewIgnoredBtn');

    if (testConnectionBtn) {
        testConnectionBtn.addEventListener('click', handleRadarTestConnection);
    }

    if (scanRadarBtn) {
        scanRadarBtn.addEventListener('click', handleRadarScan);
    }

    if (scanCompilationsBtn) {
        scanCompilationsBtn.addEventListener('click', handleCompilationsScan);
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
            document.getElementById('scanCompilationsBtn').disabled = false;
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
                            <button class="btn-download" onclick="handleDownloadRelease(this.dataset.artist, this.dataset.title, this.dataset.mbid, this.dataset.type)" data-artist="${release.artist.replace(/"/g, '&quot;')}" data-title="${release.title.replace(/"/g, '&quot;')}" data-mbid="${release.mbid || ''}" data-type="${release.type}">
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
                            <button class="btn-download" onclick="handleDownloadRelease(this.dataset.artist, this.dataset.title, this.dataset.mbid, this.dataset.type)" data-artist="${album.artist.replace(/"/g, '&quot;')}" data-title="${album.title.replace(/"/g, '&quot;')}" data-mbid="${album.mbid || ''}" data-type="${album.type}">
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

// State for duplicate cleanup modal
let pendingDownload = null;
let pendingDuplicates = [];

/**
 * Download a release via YouTube Music search
 * For compilations, checks for duplicates first
 */
async function handleDownloadRelease(artist, title, mbid, type) {
    console.log(`[Radar] Download requested: ${artist} - ${title} (MBID: ${mbid}, Type: ${type})`);

    // Check if this is a compilation type that might have duplicates
    const isCompilation = type === 'Compilation' ||
        /best of|greatest hits|collection|anthology|essential|the best|complete|definitive|ultimate/i.test(title);

    if (isCompilation && mbid) {
        console.log(`[Radar] This is a compilation - checking for duplicates first`);
        await showDuplicateModal(artist, title, mbid);
    } else {
        // Non-compilation or no MBID - just open YouTube Music
        openYouTubeMusic(artist, title);
    }
}

/**
 * Open YouTube Music search for a release
 */
function openYouTubeMusic(artist, title) {
    const searchQuery = `${artist} ${title}`;
    const ytMusicSearchUrl = `https://music.youtube.com/search?q=${encodeURIComponent(searchQuery)}`;
    window.open(ytMusicSearchUrl, '_blank');
}

/**
 * Show the duplicate cleanup modal
 */
async function showDuplicateModal(artist, title, mbid) {
    const modal = document.getElementById('duplicateCleanupModal');
    const loadingDiv = document.getElementById('duplicateModalLoading');
    const contentDiv = document.getElementById('duplicateModalContent');
    const errorDiv = document.getElementById('duplicateModalError');
    const deleteBtn = document.getElementById('deleteDuplicatesBtn');

    // Reset state
    pendingDownload = { artist, title, mbid };
    pendingDuplicates = [];

    // Show modal in loading state
    modal.style.display = 'block';
    loadingDiv.style.display = 'block';
    contentDiv.style.display = 'none';
    errorDiv.style.display = 'none';
    deleteBtn.disabled = true;

    try {
        // Get Plex config from the radar form
        const serverIp = document.getElementById('radarPlexServer')?.value || 'plex.local';
        const port = document.getElementById('radarPlexPort')?.value || '32400';
        const token = document.getElementById('radarPlexToken')?.value;

        if (!token) {
            throw new Error('Plex token not configured. Please set up Plex connection first.');
        }

        // Call API to find duplicates
        const response = await fetch('/api/radar/find-duplicates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serverIp,
                port,
                token,
                artistName: artist,
                releaseMbid: mbid,
                releaseTitle: title
            })
        });

        const data = await response.json();

        loadingDiv.style.display = 'none';

        if (!data.success) {
            // Show error but still allow proceeding
            errorDiv.innerHTML = `<p>⚠️ ${data.error}</p><p>You can still proceed to download.</p>`;
            errorDiv.style.display = 'block';
            deleteBtn.style.display = 'none';
            return;
        }

        // Store duplicates for deletion
        pendingDuplicates = data.duplicates;

        // Show content
        contentDiv.style.display = 'block';

        const descriptionEl = document.getElementById('duplicateModalDescription');
        const trackListEl = document.getElementById('duplicateTrackList');
        const summaryEl = document.getElementById('duplicateSummary');

        if (pendingDuplicates.length === 0) {
            descriptionEl.textContent = `No duplicate tracks found for "${title}" by ${artist}.`;
            trackListEl.innerHTML = '<p style="color: #888;">The compilation has ' +
                data.compilationTracks.length + ' tracks, but none match existing tracks in your library.</p>';
            summaryEl.innerHTML = '<p>✅ No cleanup needed - you can proceed to download.</p>';
            deleteBtn.style.display = 'none';
        } else {
            descriptionEl.textContent = `Found ${pendingDuplicates.length} duplicate track(s) that will be on the compilation "${title}":`;

            // Group duplicates by album
            const byAlbum = {};
            for (const dup of pendingDuplicates) {
                if (!byAlbum[dup.album]) {
                    byAlbum[dup.album] = [];
                }
                byAlbum[dup.album].push(dup);
            }

            trackListEl.innerHTML = Object.entries(byAlbum).map(([album, tracks]) => `
                <div style="margin-bottom: 15px; padding: 10px; background: #1a1a1a; border-radius: 5px;">
                    <div style="font-weight: bold; color: #888; margin-bottom: 8px;">📁 ${album}</div>
                    ${tracks.map(t => `
                        <div style="display: flex; align-items: center; padding: 5px 0; border-bottom: 1px solid #333;">
                            <input type="checkbox" class="duplicate-checkbox" data-path="${t.filePath}" checked style="margin-right: 10px;">
                            <span style="flex: 1;">${t.plexTrack}</span>
                            <span style="color: #666; font-size: 0.9em;">→ ${t.compilationTrack}</span>
                        </div>
                    `).join('')}
                </div>
            `).join('');

            summaryEl.innerHTML = `<p>⚠️ <strong>${pendingDuplicates.length} files</strong> will be permanently deleted from your library.</p>`;
            deleteBtn.style.display = 'inline-block';
            deleteBtn.disabled = false;
        }

    } catch (error) {
        loadingDiv.style.display = 'none';
        errorDiv.innerHTML = `<p>❌ Error: ${error.message}</p>`;
        errorDiv.style.display = 'block';
        deleteBtn.style.display = 'none';
    }
}

/**
 * Close the duplicate modal
 */
function closeDuplicateModal() {
    document.getElementById('duplicateCleanupModal').style.display = 'none';
    pendingDownload = null;
    pendingDuplicates = [];
}

/**
 * Delete selected duplicates and then open YouTube Music
 */
async function deleteDuplicatesAndDownload() {
    const deleteBtn = document.getElementById('deleteDuplicatesBtn');
    deleteBtn.disabled = true;
    deleteBtn.textContent = '🔄 Deleting...';

    try {
        // Get selected file paths
        const checkboxes = document.querySelectorAll('.duplicate-checkbox:checked');
        const filePaths = Array.from(checkboxes).map(cb => cb.dataset.path).filter(Boolean);

        if (filePaths.length === 0) {
            alert('No files selected for deletion');
            return;
        }

        console.log(`[Radar] Deleting ${filePaths.length} duplicate files`);

        const response = await fetch('/api/radar/delete-duplicates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePaths })
        });

        const data = await response.json();

        if (data.success) {
            console.log(`[Radar] Deleted ${data.deleted} files, ${data.emptyAlbumsRemoved} empty albums removed`);

            // Show success briefly
            const summaryEl = document.getElementById('duplicateSummary');
            summaryEl.innerHTML = `<p style="color: #4caf50;">✅ Deleted ${data.deleted} file(s)${data.emptyAlbumsRemoved > 0 ? `, removed ${data.emptyAlbumsRemoved} empty album folder(s)` : ''}</p>`;

            // Wait a moment then open YouTube Music and close modal
            setTimeout(() => {
                closeDuplicateModal();
                if (pendingDownload) {
                    openYouTubeMusic(pendingDownload.artist, pendingDownload.title);
                }
            }, 1500);
        } else {
            throw new Error(data.error || 'Failed to delete files');
        }

    } catch (error) {
        alert(`Error deleting files: ${error.message}`);
        deleteBtn.disabled = false;
        deleteBtn.textContent = '🗑️ Delete Duplicates & Open YouTube';
    }
}

/**
 * Skip deletion and just open YouTube Music
 */
function skipDuplicatesAndDownload() {
    closeDuplicateModal();
    if (pendingDownload) {
        openYouTubeMusic(pendingDownload.artist, pendingDownload.title);
    }
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
 * View ignored releases (compilations only)
 */
async function handleViewIgnored() {
    try {
        // Only show compilations
        const response = await fetch('/api/radar/ignored?compilationsOnly=true');
        const data = await response.json();

        if (data.success) {
            radarIgnoredReleases = data.ignored;

            if (radarIgnoredReleases.length === 0) {
                alert('No ignored compilations found');
                return;
            }

            // Show modal with ignored compilations
            showIgnoredCompilationsModal(radarIgnoredReleases);

        } else {
            alert(`Failed to load ignored releases: ${data.error}`);
        }

    } catch (error) {
        alert(`Error loading ignored releases: ${error.message}`);
    }
}

/**
 * Show modal with ignored compilations and unignore options
 */
function showIgnoredCompilationsModal(ignoredReleases) {
    // Create modal HTML
    const modalHtml = `
        <div id="ignoredCompilationsModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;">
            <div style="background: #1a1a1a; border: 2px solid #d32f2f; border-radius: 8px; max-width: 800px; max-height: 80vh; overflow-y: auto; padding: 20px;">
                <h2 style="color: #fff; margin-top: 0;">Ignored Compilations (${ignoredReleases.length})</h2>
                <p style="color: #999; margin-bottom: 20px;">Select compilations to un-ignore and they will appear in future scans:</p>
                <div id="ignoredCompilationsList" style="margin-bottom: 20px;">
                    ${ignoredReleases.map(release => `
                        <label style="display: block; padding: 10px; margin: 5px 0; background: #2a2a2a; border-radius: 4px; cursor: pointer; color: #fff;">
                            <input type="checkbox" value="${release.id}" style="margin-right: 10px;">
                            <strong>${release.artist_name}</strong> - ${release.release_title}
                            <span style="color: #999; font-size: 0.85em;">(${release.release_type || 'Unknown'})</span>
                        </label>
                    `).join('')}
                </div>
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button id="unignoreSelectedBtn" style="padding: 10px 20px; background: #d32f2f; color: #fff; border: none; border-radius: 4px; cursor: pointer;">
                        Un-ignore Selected
                    </button>
                    <button id="closeModalBtn" style="padding: 10px 20px; background: #444; color: #fff; border: none; border-radius: 4px; cursor: pointer;">
                        Close
                    </button>
                </div>
            </div>
        </div>
    `;

    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    // Add event listeners
    document.getElementById('closeModalBtn').addEventListener('click', () => {
        document.getElementById('ignoredCompilationsModal').remove();
    });

    document.getElementById('unignoreSelectedBtn').addEventListener('click', async () => {
        const checkboxes = document.querySelectorAll('#ignoredCompilationsList input[type="checkbox"]:checked');
        const selectedIds = Array.from(checkboxes).map(cb => parseInt(cb.value));

        if (selectedIds.length === 0) {
            alert('Please select at least one compilation to un-ignore');
            return;
        }

        await unignoreSelectedCompilations(selectedIds);
        document.getElementById('ignoredCompilationsModal').remove();
    });
}

/**
 * Un-ignore selected compilations
 */
async function unignoreSelectedCompilations(ids) {
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
        try {
            const response = await fetch(`/api/radar/ignore/${id}`, {
                method: 'DELETE'
            });

            const data = await response.json();

            if (data.success) {
                successCount++;
            } else {
                failCount++;
                console.error(`Failed to unignore ID ${id}: ${data.error}`);
            }

        } catch (error) {
            failCount++;
            console.error(`Error unignoring ID ${id}:`, error.message);
        }
    }

    if (successCount > 0) {
        alert(`Successfully un-ignored ${successCount} compilation(s)${failCount > 0 ? ` (${failCount} failed)` : ''}`);
    } else {
        alert(`Failed to un-ignore compilations: ${failCount} errors`);
    }
}

/**
 * Scan for compilation opportunities
 */
async function handleCompilationsScan() {
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

    const scanBtn = document.getElementById('scanCompilationsBtn');
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning...';

    const compilationsSection = document.getElementById('radarCompilationsSection');
    const progressDiv = document.getElementById('radarCompilationsProgress');
    const resultsDiv = document.getElementById('radarCompilationsResults');

    compilationsSection.style.display = 'block';
    progressDiv.style.display = 'block';
    progressDiv.innerHTML = '<p>Starting compilation scan...</p>';
    resultsDiv.style.display = 'none';

    try {
        const response = await fetch('/api/radar/compilations', {
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
                        console.log('[Radar] Compilation scan complete:', data.opportunitiesCount);

                        // Fetch the actual results
                        progressDiv.innerHTML = `<p>Loading results...</p>`;
                        await fetchCompilationResults();
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
        scanBtn.textContent = 'Find Compilations';
    }
}

/**
 * Fetch compilation results from server
 */
async function fetchCompilationResults() {
    const progressDiv = document.getElementById('radarCompilationsProgress');
    const resultsDiv = document.getElementById('radarCompilationsResults');

    try {
        const response = await fetch('/api/radar/compilations');
        const data = await response.json();

        if (data.success) {
            radarCompilationOpportunities = data.opportunities || [];

            console.log('[Radar] Loaded compilation opportunities:', radarCompilationOpportunities.length);

            progressDiv.style.display = 'none';
            resultsDiv.style.display = 'block';

            renderCompilationOpportunities();
        } else {
            progressDiv.innerHTML = `<p class="error">Error loading results: ${data.error}</p>`;
        }

    } catch (error) {
        progressDiv.innerHTML = `<p class="error">Error loading results: ${error.message}</p>`;
    }
}

/**
 * Render compilation opportunities
 */
function renderCompilationOpportunities() {
    console.log('[Radar] renderCompilationOpportunities called');
    console.log('[Radar] radarCompilationOpportunities:', radarCompilationOpportunities);

    const resultsDiv = document.getElementById('radarCompilationsResults');

    if (radarCompilationOpportunities.length === 0) {
        resultsDiv.innerHTML = '<p class="empty-state">No compilation opportunities found</p>';
        return;
    }

    resultsDiv.innerHTML = `
        <h3>💿 COMPILATION OPPORTUNITIES</h3>
        <p class="release-count">${radarCompilationOpportunities.length} compilations can replace existing tracks</p>
        <div class="release-grid">
            ${radarCompilationOpportunities.map((opp, index) => `
                <div class="compilation-card" data-index="${index}">
                    <div class="compilation-header">
                        <strong>${opp.artist}</strong>
                        <span class="rating-stars">${'⭐'.repeat(opp.artistRating)}</span>
                    </div>
                    <div class="compilation-title">
                        ${opp.compilation.mbid ? `<a href="https://musicbrainz.org/release-group/${opp.compilation.mbid}" target="_blank" rel="noopener noreferrer">${opp.compilation.title}</a>` : opp.compilation.title}
                    </div>
                    <div class="compilation-meta">
                        <span class="release-date">${opp.compilation.releaseDate}</span>
                        <span class="track-count">${opp.compilation.trackCount} tracks</span>
                        <span class="match-badge match-${opp.matchPercentage >= 80 ? 'high' : opp.matchPercentage >= 50 ? 'medium' : 'low'}">${opp.matchPercentage}% match</span>
                    </div>
                    <div class="compilation-stats">
                        <p><strong>${opp.matchingTracks.length}/${opp.compilation.trackCount} tracks</strong> already in library (${opp.replaceable} can be replaced)</p>
                    </div>
                    <details class="track-details">
                        <summary>View matching tracks (${opp.matchingTracks.length})</summary>
                        <ul class="track-list">
                            ${opp.matchingTracks.map(track => `
                                <li>
                                    <strong>${track.compilationTrack}</strong>
                                    <br>
                                    <span class="track-source">From: ${track.plexAlbum}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </details>
                    <div class="compilation-actions">
                        <button class="btn-download" onclick="handleDownloadCompilation(this.dataset.artist, this.dataset.title)" data-artist="${opp.artist.replace(/"/g, '&quot;')}" data-title="${opp.compilation.title.replace(/"/g, '&quot;')}">
                            ⬇️ Download
                        </button>
                        <button class="btn-replace" onclick="handleReplaceTracksWithCompilation(${index})">
                            🗑️ Replace Tracks
                        </button>
                        <button class="btn-ignore" onclick="handleIgnoreCompilation(this.dataset.artist, this.dataset.title, this.dataset.mbid)" data-artist="${opp.artist.replace(/"/g, '&quot;')}" data-title="${opp.compilation.title.replace(/"/g, '&quot;')}" data-mbid="${opp.compilation.mbid || ''}">
                            ⏭️ Ignore
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

/**
 * Download a compilation via YouTube Music search
 */
async function handleDownloadCompilation(artist, title) {
    console.log(`[Radar] Opening YouTube Music search for compilation: ${artist} - ${title}`);

    // Construct YouTube Music search URL
    const searchQuery = `${artist} ${title}`;
    const ytMusicSearchUrl = `https://music.youtube.com/search?q=${encodeURIComponent(searchQuery)}`;

    // Open YouTube Music search in new tab
    window.open(ytMusicSearchUrl, '_blank');
}

/**
 * Replace tracks with compilation
 * Moves matching tracks to recycle bin
 */
async function handleReplaceTracksWithCompilation(opportunityIndex) {
    const opp = radarCompilationOpportunities[opportunityIndex];

    if (!opp) {
        alert('Compilation opportunity not found');
        return;
    }

    const trackCount = opp.matchingTracks.length;
    const confirmMsg = `⚠️ This will move ${trackCount} track${trackCount !== 1 ? 's' : ''} to the Recycle Bin:\n\n` +
        opp.matchingTracks.map(t => `• ${t.compilationTrack} (from ${t.plexAlbum})`).join('\n') +
        `\n\nProceed?`;

    if (!confirm(confirmMsg)) {
        return;
    }

    console.log(`[Radar] Replacing tracks for compilation: ${opp.artist} - ${opp.compilation.title}`);

    // Get Plex configuration
    const serverIp = document.getElementById('radarPlexServer').value.trim();
    const port = document.getElementById('radarPlexPort').value.trim();
    const token = document.getElementById('radarPlexToken').value.trim();

    try {
        // Extract track keys from matching tracks
        const trackKeys = opp.matchingTracks.map(t => t.plexKey);

        const response = await fetch('/api/radar/replace-tracks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serverIp,
                port,
                token,
                trackKeys,
                artist: opp.artist,
                compilation: opp.compilation.title
            })
        });

        const data = await response.json();

        if (data.success) {
            alert(`✅ Successfully moved ${data.movedCount} track${data.movedCount !== 1 ? 's' : ''} to Recycle Bin`);

            // Remove this opportunity from the list
            radarCompilationOpportunities.splice(opportunityIndex, 1);
            renderCompilationOpportunities();
        } else {
            alert(`❌ Failed to replace tracks: ${data.error}`);
        }

    } catch (error) {
        alert(`❌ Error replacing tracks: ${error.message}`);
    }
}

/**
 * Ignore a compilation
 */
async function handleIgnoreCompilation(artist, title, mbid) {
    try {
        const response = await fetch('/api/radar/ignore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                artistName: artist,
                releaseTitle: title,
                releaseMbid: mbid,
                releaseType: 'Compilation'
            })
        });

        const data = await response.json();

        if (data.success) {
            // Remove from current results
            radarCompilationOpportunities = radarCompilationOpportunities.filter(opp =>
                !(opp.artist === artist && opp.compilation.title === title)
            );

            // Re-render
            renderCompilationOpportunities();

            console.log(`[Radar] Ignored compilation: ${artist} - ${title}`);
        } else {
            alert(`Failed to ignore compilation: ${data.error}`);
        }

    } catch (error) {
        alert(`Error ignoring compilation: ${error.message}`);
    }
}

// Register route with router
router.register('radar', initRadar);
