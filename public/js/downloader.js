/**
 * YouTube Music Downloader Module
 */

// Module state
let currentDownloadId = null;

// DOM elements
const downloaderElements = {
    form: null,
    downloadBtn: null,
    cancelBtn: null,
    progressContainer: null,
    progressBar: null,
    progressText: null,
    logContainer: null,
    totalTracksEl: null,
    completedTracksEl: null,
    remainingTracksEl: null,
    failedTracksEl: null,
    currentArtistEl: null,
    currentAlbumEl: null,
    currentTitleEl: null,
    formatBadgeEl: null,
    fileProgressBarEl: null,
    errorsPanelEl: null,
    errorListEl: null
};

/**
 * Initialize the downloader module
 */
function initDownloader() {
    // Cache DOM elements
    downloaderElements.form = document.getElementById('downloadForm');
    downloaderElements.downloadBtn = document.getElementById('downloadBtn');
    downloaderElements.cancelBtn = document.getElementById('cancelBtn');
    downloaderElements.progressContainer = document.getElementById('progressContainer');
    downloaderElements.progressBar = document.getElementById('progressBar');
    downloaderElements.progressText = document.getElementById('progressText');
    downloaderElements.logContainer = document.getElementById('logContainer');
    downloaderElements.totalTracksEl = document.getElementById('totalTracks');
    downloaderElements.completedTracksEl = document.getElementById('completedTracks');
    downloaderElements.remainingTracksEl = document.getElementById('remainingTracks');
    downloaderElements.failedTracksEl = document.getElementById('failedTracks');
    downloaderElements.currentArtistEl = document.getElementById('currentArtist');
    downloaderElements.currentAlbumEl = document.getElementById('currentAlbum');
    downloaderElements.currentTitleEl = document.getElementById('currentTitle');
    downloaderElements.formatBadgeEl = document.getElementById('formatBadge');
    downloaderElements.fileProgressBarEl = document.getElementById('fileProgressBar');
    downloaderElements.errorsPanelEl = document.getElementById('errorsPanel');
    downloaderElements.errorListEl = document.getElementById('errorList');

    // Load saved settings
    loadSavedSettings();

    // Setup event listeners
    downloaderElements.form.addEventListener('submit', handleDownloadSubmit);
    downloaderElements.cancelBtn.addEventListener('click', handleCancelDownload);

    // Show the module
    const module = document.getElementById('module-downloader');
    if (module) {
        module.classList.add('active');
    }
}

/**
 * Load saved settings from localStorage
 */
function loadSavedSettings() {
    const savedPlaylistUrl = localStorage.getItem('playlistUrl');
    const savedOutputPath = localStorage.getItem('outputPath');
    const savedCookiesPath = localStorage.getItem('cookiesPath');
    const savedPoToken = localStorage.getItem('poToken');

    if (savedPlaylistUrl) {
        document.getElementById('playlistUrl').value = savedPlaylistUrl;
    }
    if (savedOutputPath) {
        document.getElementById('outputPath').value = savedOutputPath;
    }
    if (savedCookiesPath) {
        document.getElementById('cookiesPath').value = savedCookiesPath;
    }
    if (savedPoToken) {
        document.getElementById('poToken').value = savedPoToken;
    }
}

/**
 * Save settings to localStorage
 */
function saveSettings(playlistUrl, outputPath, cookiesPath, poToken) {
    localStorage.setItem('playlistUrl', playlistUrl);
    localStorage.setItem('outputPath', outputPath);
    localStorage.setItem('cookiesPath', cookiesPath || '');
    localStorage.setItem('poToken', poToken || '');
}

/**
 * Add a log entry
 */
function addLog(message, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logEntry.textContent = `[${timestamp}] ${message}`;
    downloaderElements.logContainer.appendChild(logEntry);
    downloaderElements.logContainer.scrollTop = downloaderElements.logContainer.scrollHeight;
    console.log(`[${type.toUpperCase()}] ${message}`);
}

/**
 * Update progress bar
 */
function updateProgress(percent, text) {
    downloaderElements.progressBar.style.width = percent + '%';
    downloaderElements.progressText.textContent = text;
}

/**
 * Update dashboard with download status
 */
function updateDashboard(data) {
    // Update statistics cards
    if (data.totalTracks !== undefined) {
        downloaderElements.totalTracksEl.textContent = data.totalTracks;
    }
    if (data.completedTracks !== undefined) {
        downloaderElements.completedTracksEl.textContent = data.completedTracks;
    }
    if (data.remaining !== undefined) {
        downloaderElements.remainingTracksEl.textContent = data.remaining;
    }
    if (data.failedCount !== undefined) {
        downloaderElements.failedTracksEl.textContent = data.failedCount;
    }

    // Update current track info
    if (data.currentTrackInfo) {
        if (data.currentTrackInfo.artist) {
            downloaderElements.currentArtistEl.textContent = data.currentTrackInfo.artist;
        }
        if (data.currentTrackInfo.album) {
            downloaderElements.currentAlbumEl.textContent = data.currentTrackInfo.album;
        }
        if (data.currentTrackInfo.title) {
            downloaderElements.currentTitleEl.textContent = data.currentTrackInfo.title;
        }
    }

    // Update format badge
    if (data.format) {
        downloaderElements.formatBadgeEl.textContent = data.format;
    }

    // Update file progress bar
    if (data.downloadProgress !== undefined) {
        downloaderElements.fileProgressBarEl.style.width = data.downloadProgress + '%';
    }

    // Update overall progress
    if (data.progress !== undefined) {
        updateProgress(data.progress, data.status || downloaderElements.progressText.textContent);
    }

    // Handle errors and warnings
    if (data.failedCount > 0 || data.unavailableCount > 0) {
        downloaderElements.errorsPanelEl.classList.add('has-errors');
        updateErrorList(data);
    }
}

/**
 * Update error list display
 */
function updateErrorList(data) {
    if (!data.failedCount && !data.unavailableCount) return;

    let html = '';

    if (data.failedCount > 0) {
        html += `<div><strong>Failed Downloads: ${data.failedCount}</strong></div>`;

        // Display detailed error messages
        if (data.failedTracks && data.failedTracks.length > 0) {
            data.failedTracks.forEach((track, index) => {
                const errorType = track.type.charAt(0).toUpperCase() + track.type.slice(1);
                html += `<div class="error-list-item">`;
                html += `<strong>${index + 1}. ${errorType}</strong><br>`;
                html += `<span style="font-size: 11px; opacity: 0.9;">${track.message}</span>`;
                html += `</div>`;
            });
        }
    }

    if (data.unavailableCount > 0 && data.unavailableVideos && data.unavailableVideos.length > 0) {
        html += `<div style="margin-top: 10px;"><strong>Unavailable Video IDs:</strong></div>`;
        html += '<div class="error-list-item" style="font-family: monospace; font-size: 10px;">' +
               data.unavailableVideos.join(', ') + '</div>';
    }

    downloaderElements.errorListEl.innerHTML = html;
}

/**
 * Handle cancel download button
 */
async function handleCancelDownload() {
    if (!currentDownloadId) return;

    addLog('Sending cancel request...', 'warning');
    downloaderElements.cancelBtn.disabled = true;

    try {
        const response = await fetch('http://localhost:3000/api/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ downloadId: currentDownloadId })
        });

        const result = await response.json();
        if (result.success) {
            addLog('Download cancellation requested', 'warning');
        } else {
            addLog('Failed to cancel download', 'error');
        }
    } catch (error) {
        addLog(`Cancel error: ${error.message}`, 'error');
    }
}

/**
 * Handle download form submission
 */
async function handleDownloadSubmit(e) {
    e.preventDefault();

    const formData = new FormData();
    const playlistUrl = document.getElementById('playlistUrl').value;
    const outputPath = document.getElementById('outputPath').value;
    const cookiesPath = document.getElementById('cookiesPath').value;
    const poToken = document.getElementById('poToken').value;

    // Save settings to localStorage for future use
    saveSettings(playlistUrl, outputPath, cookiesPath, poToken);

    formData.append('playlistUrl', playlistUrl);
    formData.append('outputPath', outputPath);
    formData.append('cookiesPath', cookiesPath);

    if (poToken) {
        formData.append('poToken', poToken);
    }

    addLog(`Starting download request...`, 'debug');
    addLog(`Playlist: ${playlistUrl}`, 'debug');
    addLog(`Output: ${outputPath}`, 'debug');
    addLog(`Cookies: ${cookiesPath}`, 'debug');
    addLog(`PO Token: ${poToken ? 'Provided' : 'Not provided'}`, 'debug');

    // Show progress container
    downloaderElements.progressContainer.style.display = 'block';
    downloaderElements.logContainer.innerHTML = '';
    downloaderElements.downloadBtn.disabled = true;
    downloaderElements.downloadBtn.textContent = 'Downloading...';
    downloaderElements.downloadBtn.style.display = 'none';
    downloaderElements.cancelBtn.style.display = 'block';
    downloaderElements.cancelBtn.disabled = false;

    try {
        const response = await fetch('http://localhost:3000/api/download', {
            method: 'POST',
            body: formData
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

                    // Store download ID
                    if (data.downloadId && !currentDownloadId) {
                        currentDownloadId = data.downloadId;
                        addLog(`Download ID: ${currentDownloadId}`, 'debug');
                    }

                    // Update dashboard with new data
                    updateDashboard(data);

                    // Log raw data for debugging
                    if (data.debug) {
                        addLog(data.debug, 'debug');
                    }

                    if (data.status) {
                        addLog(data.status, 'info');
                    }

                    if (data.error) {
                        addLog(data.error, 'error');
                    }

                    if (data.warning) {
                        addLog(data.warning, 'warning');
                    }

                    if (data.rawOutput) {
                        addLog(data.rawOutput, 'debug');
                    }

                    if (data.completed) {
                        downloaderElements.downloadBtn.disabled = false;
                        downloaderElements.downloadBtn.textContent = 'Start Download';
                        downloaderElements.downloadBtn.style.display = 'block';
                        downloaderElements.cancelBtn.style.display = 'none';
                        currentDownloadId = null;

                        if (data.cancelled) {
                            addLog('Download was cancelled', 'warning');
                        } else if (data.progress === 100) {
                            addLog(`Download completed! ${data.downloadedCount || 0} track(s) processed.`, 'success');
                        }
                    }
                }
            }
        }
    } catch (error) {
        addLog(`Error: ${error.message}`, 'error');
        downloaderElements.downloadBtn.disabled = false;
        downloaderElements.downloadBtn.textContent = 'Start Download';
        downloaderElements.downloadBtn.style.display = 'block';
        downloaderElements.cancelBtn.style.display = 'none';
        currentDownloadId = null;
    }
}

// Register the downloader route
router.register('downloader', initDownloader);
