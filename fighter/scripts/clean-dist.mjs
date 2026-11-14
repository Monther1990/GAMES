// After a build: rooms opened while developing (public/server/rooms) are never shipped. The PHP file makes its own
// empty, protected folder on the server the first time it is called.
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rooms = fileURLToPath(new URL('../dist/server/rooms', import.meta.url));
rmSync(rooms, { recursive: true, force: true });
console.log('dist/server/rooms removed (it is created again on the server)');
