<?php
// Cyber Shield: rooms for playing with a supporter. Plain PHP with files, so it runs on XAMPP as it is (no database, no
// extensions). It keeps no personal data: a room is a short code, two random tokens and two queues of small messages.
// The two players use it to find each other and to exchange connection details; the fight itself then goes straight
// from one browser to the other. When that direct connection cannot be made, the same queues carry the game (slower).
//
//   POST coop.php?a=create                      -> { room, token }                 (the main player)
//   POST coop.php?a=join&room=ABCDE             -> { token }                       (the supporter)
//   POST coop.php?a=send&room=..&token=..       body: { "msgs": [ ... ] }  -> { ok }
//   GET  coop.php?a=poll&room=..&token=..       -> { msgs: [ ... ], peer: true|false }
//   POST coop.php?a=leave&room=..&token=..      -> { ok }
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const ROOM_TTL = 7200;          // a room lives two hours at most
const MAX_BODY = 262144;        // one request: 256 KB
const MAX_QUEUE = 400;          // messages waiting for one player
const MAX_ROOMS = 500;
const STALE_AFTER = 9;         // seconds without a sign of life after which a supporter's place may be taken again
const MAX_QUEUE_BYTES = 600000; // all the messages waiting for one player
const LIMIT_WINDOW = 600;      // ten minutes
const LIMIT_CREATE = 40;       // rooms one address may open in that time (a whole class may share one address)
const LIMIT_JOIN = 120;        // codes one address may try in that time (guessing 33 million codes is hopeless)
const IDLE_TTL = 300;          // a room nobody has asked about for five minutes is abandoned

// A page of another site must not use this API with a visitor's browser: the request has to come from our own pages.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '') {
	$from = parse_url($origin, PHP_URL_HOST); $port = parse_url($origin, PHP_URL_PORT);
	// behind the development proxy the page's own host arrives in X-Forwarded-Host (a foreign page cannot add that header)
	$here = strtolower($_SERVER['HTTP_X_FORWARDED_HOST'] ?? $_SERVER['HTTP_HOST'] ?? '');
	if (!is_string($from) || (strtolower($from) !== $here && strtolower($from . ':' . $port) !== $here)) { http_response_code(403); echo '{"error":"foreign_origin"}'; exit; }
}

// The rooms may live outside the web folder (the Apache site sets COOP_ROOMS_DIR); otherwise beside this file.
$dir = (isset($_SERVER['COOP_ROOMS_DIR']) && $_SERVER['COOP_ROOMS_DIR'] !== '') ? rtrim(str_replace('\\', '/', $_SERVER['COOP_ROOMS_DIR']), '/') : __DIR__ . '/rooms';
if (!is_dir($dir)) { @mkdir($dir, 0775, true); @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n"); @file_put_contents($dir . '/index.html', ''); }

function out($data, $code = 200) { http_response_code($code); echo json_encode($data, JSON_UNESCAPED_UNICODE); exit; }
function fail($why, $code = 400) { out(['error' => $why], $code); }
function room_code() { $abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; $s = ''; for ($i = 0; $i < 5; $i++) $s .= $abc[random_int(0, strlen($abc) - 1)]; return $s; }
function room_path($dir, $room) { if (!preg_match('/^[A-Z2-9]{5}$/', $room)) fail('bad_room'); return $dir . '/' . $room . '.json'; }

/** Opens a room file under a lock, lets $fn change the room, and writes it back. $fn returns what to answer. */
function with_room($path, $fn, $create = false) {
	$h = @fopen($path, $create ? 'c+' : 'r+');
	if (!$h) fail('no_room', 404);
	flock($h, LOCK_EX);
	$raw = stream_get_contents($h);
	$room = $raw ? json_decode($raw, true) : null;
	if (!$create && (!is_array($room) || time() - ($room['at'] ?? 0) > ROOM_TTL)) { flock($h, LOCK_UN); fclose($h); @unlink($path); fail('no_room', 404); }
	$answer = $fn($room);
	if ($room === null) { flock($h, LOCK_UN); fclose($h); @unlink($path); }
	else { ftruncate($h, 0); rewind($h); fwrite($h, json_encode($room, JSON_UNESCAPED_UNICODE)); fflush($h); flock($h, LOCK_UN); fclose($h); }
	return $answer;
}
/** The visitor's address. Behind the Cloudflare Tunnel every request reaches Apache from the tunnel's own machine (this
 *  one, or another on the local network), and the real address is in CF-Connecting-IP. That header is believed only
 *  when the request comes from this machine or the local network: nobody on the internet can reach Apache directly,
 *  so nobody outside can forge it. */
function visitor() {
	$ip = $_SERVER['REMOTE_ADDR'] ?? '';
	$cf = $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '';
	$local = filter_var($ip, FILTER_VALIDATE_IP) && !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE);
	if ($local && filter_var($cf, FILTER_VALIDATE_IP)) $ip = $cf;
	return $ip;
}
/** Counts what one address does (only a hash of it is kept, never the address) and refuses past the limit. */
function limit($dir, $what, $max) {
	$path = $dir . '/_limit';
	if (!is_dir($path)) @mkdir($path, 0775, true);
	$file = $path . '/' . $what . '-' . substr(hash('sha256', visitor()), 0, 24) . '.txt';
	$h = @fopen($file, 'c+');
	if (!$h) return;                                                         // counting is a guard, never a reason to fail
	flock($h, LOCK_EX);
	$now = time();
	$times = array_values(array_filter(array_map('intval', explode(',', (string) stream_get_contents($h))), function ($t) use ($now) { return $t > $now - LIMIT_WINDOW; }));
	$over = count($times) >= $max;
	if (!$over) $times[] = $now;
	ftruncate($h, 0); rewind($h); fwrite($h, implode(',', $times)); fflush($h); flock($h, LOCK_UN); fclose($h);
	if (mt_rand(0, 60) === 0) foreach (glob($path . '/*.txt') ?: [] as $old) if ($now - @filemtime($old) > LIMIT_WINDOW) @unlink($old);
	if ($over) { header('Retry-After: ' . LIMIT_WINDOW); fail('slow_down', 429); }
}
/** Which side a token belongs to: 0 the main player, 1 the supporter. */
function side_of($room, $token) {
	if (is_string($token) && $token !== '') { if (hash_equals($room['tokens'][0], $token)) return 0; if ($room['tokens'][1] !== '' && hash_equals($room['tokens'][1], $token)) return 1; }
	fail('bad_token', 403);
}

$a = $_GET['a'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($a !== 'poll' && $method !== 'POST') fail('post_only', 405);

if ($a === 'create') {
	limit($dir, 'create', LIMIT_CREATE);
	// old rooms are swept away here, so the folder never grows without end
	$files = glob($dir . '/*.json') ?: [];
	foreach ($files as $f) if (time() - @filemtime($f) > IDLE_TTL) @unlink($f);   // every question from a player rewrites the file, so an old file is a dead room
	clearstatcache(); $files = glob($dir . "/*.json") ?: [];
	if (count($files) > MAX_ROOMS) fail('busy', 503);
	for ($try = 0; $try < 20; $try++) {
		$room = room_code(); $path = $dir . '/' . $room . '.json';
		if (file_exists($path)) continue;
		$token = bin2hex(random_bytes(12));
		with_room($path, function (&$r) use ($token) { $r = ['at' => time(), 'tokens' => [$token, ''], 'queues' => [[], []], 'seen' => [time(), 0]]; return true; }, true);
		out(['room' => $room, 'token' => $token]);
	}
	fail('busy', 503);
}

$path = room_path($dir, strtoupper($_GET['room'] ?? ''));

if ($a === 'join') {
	limit($dir, 'join', LIMIT_JOIN);
	$token = bin2hex(random_bytes(12));
	$ok = with_room($path, function (&$r) use ($token) {
		if ($r['tokens'][1] !== '') {
			if (time() - $r['seen'][1] < STALE_AFTER) return false;                 // a supporter is there and alive
			$r['queues'][0][] = ['t' => 'left'];                                    // the old one closed the page without leaving: the place is free again
		}
		$r['tokens'][1] = $token; $r['seen'][1] = time(); $r['queues'][1] = []; $r['queues'][0][] = ['t' => 'joined'];
		return true;
	});
	if (!$ok) fail('full', 409);
	out(['token' => $token]);
}

$token = $_GET['token'] ?? '';

if ($a === 'send') {
	$body = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
	if (strlen($body) > MAX_BODY) fail('too_large', 413);
	$data = json_decode($body, true);
	if (!is_array($data) || !isset($data['msgs']) || !is_array($data['msgs'])) fail('bad_body');
	with_room($path, function (&$r) use ($token, $data) {
		$me = side_of($r, $token); $other = 1 - $me;
		$r['seen'][$me] = time();
		foreach ($data['msgs'] as $m) $r['queues'][$other][] = $m;
		if (count($r['queues'][$other]) > MAX_QUEUE) $r['queues'][$other] = array_slice($r['queues'][$other], -MAX_QUEUE);   // the newest matter most
		while (count($r['queues'][$other]) > 1 && strlen(json_encode($r['queues'][$other])) > MAX_QUEUE_BYTES) $r['queues'][$other] = array_slice($r['queues'][$other], (int) ceil(count($r['queues'][$other]) / 2));
		return true;
	});
	out(['ok' => true]);
}

if ($a === 'poll') {
	$answer = with_room($path, function (&$r) use ($token) {
		$me = side_of($r, $token); $other = 1 - $me;
		$r['seen'][$me] = time();
		$msgs = $r['queues'][$me]; $r['queues'][$me] = [];
		return ['msgs' => $msgs, 'peer' => $r['tokens'][$other] !== '' && time() - $r['seen'][$other] < 20];
	});
	out($answer);
}

if ($a === 'leave') {
	with_room($path, function (&$r) use ($token) {
		$me = side_of($r, $token);
		if ($me === 0) { $r = null; return true; }                              // the main player closes the room
		$r['tokens'][1] = ''; $r['queues'][1] = []; $r['queues'][0][] = ['t' => 'left'];
		return true;
	});
	out(['ok' => true]);
}

fail('unknown_action');
