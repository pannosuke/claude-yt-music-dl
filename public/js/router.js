/**
 * Simple hash-based router for tab navigation
 */

class Router {
    constructor() {
        this.routes = {};
        this.currentRoute = null;

        // Listen for hash changes
        window.addEventListener('hashchange', () => this.handleRoute());

        // Handle initial route on page load
        window.addEventListener('DOMContentLoaded', () => this.handleRoute());
    }

    /**
     * Register a route with its handler
     * @param {string} path - The route path (without #)
     * @param {Function} handler - Function to call when route is active
     */
    register(path, handler) {
        this.routes[path] = handler;
    }

    /**
     * Navigate to a route
     * @param {string} path - The route path (without #)
     */
    navigate(path) {
        window.location.hash = path;
    }

    /**
     * Handle the current route
     */
    handleRoute() {
        // Get current hash without the #
        let hash = window.location.hash.slice(1);

        // Default to 'downloader' if no hash
        if (!hash) {
            hash = 'downloader';
            window.location.hash = hash;
            return;
        }

        // Deactivate current route
        if (this.currentRoute && this.routes[this.currentRoute]) {
            this.deactivateRoute(this.currentRoute);
        }

        // Activate new route
        if (this.routes[hash]) {
            this.currentRoute = hash;
            this.routes[hash]();
            this.updateTabButtons(hash);
        } else {
            // Route not found, redirect to downloader
            this.navigate('downloader');
        }
    }

    /**
     * Deactivate a route by hiding its module
     * @param {string} path - The route path
     */
    deactivateRoute(path) {
        const module = document.getElementById(`module-${path}`);
        if (module) {
            module.classList.remove('active');
        }
    }

    /**
     * Update tab button active states
     * @param {string} activePath - The currently active route
     */
    updateTabButtons(activePath) {
        const buttons = document.querySelectorAll('.tab-button');
        buttons.forEach(button => {
            const route = button.getAttribute('data-route');
            if (route === activePath) {
                button.classList.add('active');
            } else {
                button.classList.remove('active');
            }
        });
    }
}

// Create global router instance
const router = new Router();
