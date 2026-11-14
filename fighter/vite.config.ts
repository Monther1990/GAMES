import { defineConfig } from 'vite';

// base './' : the built folder works from any path on the platform (e.g. https://platform/games/athar/).
export default defineConfig({
	base: './',
	build: { outDir: 'dist', assetsInlineLimit: 0, chunkSizeWarningLimit: 6000, target: 'es2020' },
	// The room API for playing with a supporter is PHP (public/server/coop.php). In development PHP's own server runs it:
	//   php -S 127.0.0.1:5260 -t public        and requests to /server/ are passed on to it. In production the built
	// folder is served by Apache (XAMPP), which runs the PHP file itself.
	server: { host: true, port: 5173, proxy: { '/server': { target: 'http://127.0.0.1:5260', xfwd: true } } }
});
