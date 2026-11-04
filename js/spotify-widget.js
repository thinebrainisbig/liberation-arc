/* ============================================================
   Spotify mini card — la_spotify_auth
   Authorization Code + PKCE (client-side only, no client secret to
   leak). Requires a Spotify Developer app: create one at
   https://developer.spotify.com/dashboard, set SPOTIFY_CLIENT_ID
   below, and add this exact page URL (e.g.
   http://127.0.0.1:8934/index.html) as a Redirect URI in the app
   settings. Playback (play/pause/skip/start) requires a Premium
   account — Spotify's API rejects playback control for Free
   accounts regardless of how it's called.

   Shared by every page (index.html, financial-subpage.html,
   screens/*.html). Byte-identical across all 5 pages before this
   extraction; verified via diff before moving here.

   Deliberately NOT wrapped in an IIFE (unlike js/core.js and
   js/weather-widget.js): several onclick="" handlers in the page
   markup reference `spotifyPlayer` as a bare global
   (spotifyPlayer.previousTrack()/.togglePlay()/.nextTrack()), not
   through a function call. A closure-scoped `var spotifyPlayer`
   would make those handlers throw "spotifyPlayer is not defined".
   Plain top-level `var`/`function` declarations in a script file
   become window properties automatically, same as they did when
   this code lived inline on each page — so this preserves that
   behavior exactly. Depends on loadJSON/saveJSON/escapeHtml from
   js/core.js (load that first).
============================================================ */
var SPOTIFY_CLIENT_ID = 'eef9ea49d1f74cb1b84304c3bc3be877';
var SPOTIFY_REDIRECT_URI = window.location.origin + window.location.pathname;
var SPOTIFY_SCOPES = [
  'streaming', 'user-read-email', 'user-read-private',
  'user-read-playback-state', 'user-modify-playback-state',
  'playlist-read-private', 'playlist-read-collaborative'
].join(' ');
var spotifyPlayer = null;
var spotifyDeviceId = null;
var spotifyPlaylists = [];
var spotifyPlayingContext = null;
var spotifyProgressState = null; // { position, duration, paused, updatedAt }
var spotifyProgressTimer = null;
var spotifyViewMode = 'list'; // 'list' | 'player'
var spotifyVolume = (function(){ try{ var v = localStorage.getItem('la_spotify_volume'); return v !== null ? parseFloat(v) : 0.6; }catch(e){ return 0.6; } })();
var spotifyMutedVolume = null;
var spotifyVolumeDragging = false;

function getSpotifyAuth(){ return loadJSON('la_spotify_auth', null); }
function saveSpotifyAuth(auth){ saveJSON('la_spotify_auth', auth); }
function clearSpotifyAuth(){ localStorage.removeItem('la_spotify_auth'); }

function renderSpotifyBody(html){
  var body = document.getElementById('spotify-mini-body');
  if(body) body.innerHTML = html;
}

function spotifyRandomString(len){
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var out = '';
  var randoms = new Uint8Array(len);
  crypto.getRandomValues(randoms);
  for(var i = 0; i < len; i++){ out += chars[randoms[i] % chars.length]; }
  return out;
}

function spotifyBase64UrlEncode(buffer){
  var bytes = new Uint8Array(buffer);
  var str = '';
  for(var i = 0; i < bytes.length; i++){ str += String.fromCharCode(bytes[i]); }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function spotifyCodeChallenge(verifier){
  var data = new TextEncoder().encode(verifier);
  return crypto.subtle.digest('SHA-256', data).then(spotifyBase64UrlEncode);
}

function startSpotifyLogin(){
  if(!SPOTIFY_CLIENT_ID){
    renderSpotifyBody('<div class="spotify-mini-empty">Add your Spotify app&rsquo;s Client ID to <span class="mono">SPOTIFY_CLIENT_ID</span> in index.html to enable this widget.</div>');
    return;
  }
  var verifier = spotifyRandomString(64);
  sessionStorage.setItem('la_spotify_verifier', verifier);
  spotifyCodeChallenge(verifier).then(function(challenge){
    var params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: SPOTIFY_REDIRECT_URI,
      scope: SPOTIFY_SCOPES,
      code_challenge_method: 'S256',
      code_challenge: challenge
    });
    window.location.href = 'https://accounts.spotify.com/authorize?' + params.toString();
  });
}

function disconnectSpotify(){
  clearSpotifyAuth();
  if(spotifyPlayer){ spotifyPlayer.disconnect(); spotifyPlayer = null; }
  spotifyDeviceId = null;
  spotifyPlaylists = [];
  spotifyPlayingContext = null;
  stopSpotifyProgressTimer();
  spotifyProgressState = null;
  spotifyViewMode = 'list';
  var disconnectBtn = document.getElementById('spotify-disconnect-btn');
  if(disconnectBtn) disconnectBtn.style.display = 'none';
  var backBtn = document.getElementById('spotify-back-btn');
  if(backBtn) backBtn.style.display = 'none';
  renderSpotifyConnectPrompt();
}

function renderSpotifyConnectPrompt(){
  renderSpotifyBody('<button type="button" class="spotify-connect-btn" onclick="startSpotifyLogin()">' +
    '<span class="material-symbols-outlined">graphic_eq</span>Connect Spotify</button>');
}

function setSpotifyViewMode(mode){
  spotifyViewMode = mode;
  var nowWrap = document.getElementById('spotify-now-playing-wrap');
  var listWrap = document.getElementById('spotify-list-wrap');
  var backBtn = document.getElementById('spotify-back-btn');
  if(nowWrap) nowWrap.style.display = mode === 'player' ? '' : 'none';
  if(listWrap) listWrap.style.display = mode === 'list' ? '' : 'none';
  if(backBtn) backBtn.style.display = mode === 'player' ? 'flex' : 'none';
}

function backToSpotifyPlaylists(){
  if(spotifyPlayer) spotifyPlayer.pause();
  stopSpotifyProgressTimer();
  spotifyPlayingContext = null;
  setSpotifyViewMode('list');
  renderSpotifyPlaylists();
}

function getSpotifyShuffleMode(){ return localStorage.getItem('la_spotify_shuffle_mode') || 'off'; }
function setSpotifyShuffleMode(mode){
  localStorage.setItem('la_spotify_shuffle_mode', mode);
  var wantsShuffleOn = mode !== 'off';
  var q = '?state=' + wantsShuffleOn + (spotifyDeviceId ? '&device_id=' + spotifyDeviceId : '');
  spotifyApiFetch('/me/player/shuffle' + q, { method: 'PUT' }).catch(function(){});
  if(spotifyPlayer){
    spotifyPlayer.getCurrentState().then(function(state){ if(state) renderSpotifyNowPlaying(state); });
  }
}

function handleSpotifyRedirect(){
  var params = new URLSearchParams(window.location.search);
  var code = params.get('code');
  if(!code) return Promise.resolve(false);
  var verifier = sessionStorage.getItem('la_spotify_verifier');
  window.history.replaceState({}, document.title, window.location.pathname);
  if(!verifier) return Promise.resolve(false);
  return fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: SPOTIFY_REDIRECT_URI,
      code_verifier: verifier
    })
  }).then(function(res){
    if(!res.ok) throw new Error('Spotify token exchange failed');
    return res.json();
  }).then(function(data){
    saveSpotifyAuth({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000)
    });
    return true;
  }).catch(function(){ return false; });
}

function refreshSpotifyToken(auth){
  return fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: auth.refresh_token
    })
  }).then(function(res){
    if(!res.ok) throw new Error('Spotify token refresh failed');
    return res.json();
  }).then(function(data){
    var updated = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || auth.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000)
    };
    saveSpotifyAuth(updated);
    return updated.access_token;
  });
}

function getSpotifyAccessToken(){
  var auth = getSpotifyAuth();
  if(!auth) return Promise.reject(new Error('Not connected'));
  if(Date.now() < auth.expires_at - 60000) return Promise.resolve(auth.access_token);
  return refreshSpotifyToken(auth);
}

function spotifyApiFetch(path, options){
  options = options || {};
  return getSpotifyAccessToken().then(function(token){
    options.headers = Object.assign({}, options.headers, { 'Authorization': 'Bearer ' + token });
    return fetch('https://api.spotify.com/v1' + path, options);
  });
}

function initSpotifyPlayer(){
  var script = document.createElement('script');
  script.src = 'https://sdk.scdn.co/spotify-player.js';
  document.head.appendChild(script);
}

window.onSpotifyWebPlaybackSDKReady = function(){
  spotifyPlayer = new Spotify.Player({
    name: 'Liberation Arc',
    getOAuthToken: function(cb){ getSpotifyAccessToken().then(cb); },
    volume: spotifyVolume
  });
  spotifyPlayer.addListener('ready', function(evt){ spotifyDeviceId = evt.device_id; spotifyPlayer.setVolume(spotifyVolume); });
  spotifyPlayer.addListener('player_state_changed', renderSpotifyNowPlaying);
  spotifyPlayer.connect();
};

function renderSpotifyNowPlaying(state){
  var wrap = document.getElementById('spotify-now-playing-wrap');
  if(!wrap) return;
  if(!state || !state.track_window || !state.track_window.current_track){
    stopSpotifyProgressTimer();
    spotifyProgressState = null;
    wrap.innerHTML = '<div class="spotify-mini-empty">Nothing playing. Pick a playlist below.</div>';
    return;
  }
  var track = state.track_window.current_track;
  if(state.context && state.context.uri) spotifyPlayingContext = state.context.uri;
  var art = track.album && track.album.images && track.album.images[0] ? track.album.images[0].url : '';
  var artists = track.artists.map(function(a){ return a.name; }).join(', ');
  var shuffleMode = getSpotifyShuffleMode();
  spotifyProgressState = { position: state.position, duration: state.duration, paused: state.paused, updatedAt: Date.now() };
  var initialPct = state.duration ? Math.min(100, (state.position / state.duration) * 100) : 0;
  wrap.innerHTML =
    '<div class="spotify-now-playing">' +
      '<div class="spotify-now-playing-top">' +
        '<div class="spotify-art" style="background-image:url(\'' + art + '\')"></div>' +
        '<div class="spotify-track-meta">' +
          '<span class="spotify-track-title">' + escapeHtml(track.name) + '</span>' +
          '<span class="spotify-track-artist">' + escapeHtml(artists) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="spotify-progress-row">' +
        '<span class="spotify-progress-time" id="spotify-progress-elapsed">' + spotifyFormatTime(state.position) + '</span>' +
        '<div class="spotify-progress-track" id="spotify-progress-track" onclick="seekSpotifyProgress(event)">' +
          '<div class="spotify-progress-fill" id="spotify-progress-fill" style="width:' + initialPct + '%"></div>' +
        '</div>' +
        '<span class="spotify-progress-time" id="spotify-progress-duration">' + spotifyFormatTime(state.duration) + '</span>' +
      '</div>' +
      '<div class="spotify-controls">' +
        '<button type="button" class="spotify-shuffle-toggle' + (shuffleMode !== 'off' ? ' active' : '') + '" onclick="setSpotifyShuffleMode(\'' + (shuffleMode === 'off' ? 'shuffle' : 'off') + '\')" title="Shuffle"><span class="material-symbols-outlined">shuffle</span></button>' +
        '<button type="button" onclick="spotifyPlayer.previousTrack()" title="Previous"><span class="material-symbols-outlined">skip_previous</span></button>' +
        '<button type="button" class="spotify-play-btn" onclick="spotifyPlayer.togglePlay()" title="Play/Pause"><span class="material-symbols-outlined">' + (state.paused ? 'play_arrow' : 'pause') + '</span></button>' +
        '<button type="button" onclick="spotifyPlayer.nextTrack()" title="Next"><span class="material-symbols-outlined">skip_next</span></button>' +
      '</div>' +
      '<div class="spotify-volume-row">' +
        '<span class="material-symbols-outlined" id="spotify-volume-icon" onclick="toggleSpotifyMute()">' + spotifyVolumeIcon() + '</span>' +
        '<div class="spotify-volume-track" id="spotify-volume-track" onmousedown="startSpotifyVolumeDrag(event)">' +
          '<div class="spotify-volume-fill" id="spotify-volume-fill" style="width:' + (spotifyVolume * 100) + '%"></div>' +
          '<div class="spotify-volume-thumb" id="spotify-volume-thumb" style="left:' + (spotifyVolume * 100) + '%"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  startSpotifyProgressTimer();
  renderSpotifyPlaylists();
}

function spotifyVolumeIcon(){
  if(spotifyVolume <= 0) return 'volume_off';
  if(spotifyVolume < 0.5) return 'volume_down';
  return 'volume_up';
}

function applySpotifyVolume(vol){
  spotifyVolume = Math.max(0, Math.min(1, vol));
  try{ localStorage.setItem('la_spotify_volume', spotifyVolume); }catch(e){}
  if(spotifyPlayer && spotifyPlayer.setVolume) spotifyPlayer.setVolume(spotifyVolume);
  var fill = document.getElementById('spotify-volume-fill');
  var thumb = document.getElementById('spotify-volume-thumb');
  var icon = document.getElementById('spotify-volume-icon');
  if(fill) fill.style.width = (spotifyVolume * 100) + '%';
  if(thumb) thumb.style.left = (spotifyVolume * 100) + '%';
  if(icon) icon.textContent = spotifyVolumeIcon();
}

function setSpotifyVolumeFromEvent(e){
  var track = document.getElementById('spotify-volume-track');
  if(!track) return;
  var rect = track.getBoundingClientRect();
  var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  applySpotifyVolume(ratio);
}

function startSpotifyVolumeDrag(e){
  spotifyVolumeDragging = true;
  setSpotifyVolumeFromEvent(e);
  e.preventDefault();
}

function toggleSpotifyMute(){
  if(spotifyVolume > 0){
    spotifyMutedVolume = spotifyVolume;
    applySpotifyVolume(0);
  } else {
    applySpotifyVolume(spotifyMutedVolume != null ? spotifyMutedVolume : 0.6);
  }
}

document.addEventListener('mousemove', function(e){ if(spotifyVolumeDragging) setSpotifyVolumeFromEvent(e); });
document.addEventListener('mouseup', function(){ spotifyVolumeDragging = false; });

function spotifyFormatTime(ms){
  if(ms == null || isNaN(ms)) return '0:00';
  var totalSec = Math.floor(ms / 1000);
  var m = Math.floor(totalSec / 60);
  var s = totalSec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function startSpotifyProgressTimer(){
  if(spotifyProgressTimer) return;
  spotifyProgressTimer = setInterval(tickSpotifyProgress, 500);
}

function stopSpotifyProgressTimer(){
  if(spotifyProgressTimer){ clearInterval(spotifyProgressTimer); spotifyProgressTimer = null; }
}

function tickSpotifyProgress(){
  if(!spotifyProgressState){ stopSpotifyProgressTimer(); return; }
  var fill = document.getElementById('spotify-progress-fill');
  var elapsedEl = document.getElementById('spotify-progress-elapsed');
  if(!fill || !elapsedEl) return;
  var pos = spotifyProgressState.position;
  if(!spotifyProgressState.paused){ pos += (Date.now() - spotifyProgressState.updatedAt); }
  if(spotifyProgressState.duration){ pos = Math.min(pos, spotifyProgressState.duration); }
  var pct = spotifyProgressState.duration ? (pos / spotifyProgressState.duration) * 100 : 0;
  fill.style.width = pct + '%';
  elapsedEl.textContent = spotifyFormatTime(pos);
}

function seekSpotifyProgress(e){
  if(!spotifyPlayer || !spotifyProgressState || !spotifyProgressState.duration) return;
  var track = document.getElementById('spotify-progress-track');
  if(!track) return;
  var rect = track.getBoundingClientRect();
  var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  var seekMs = Math.round(ratio * spotifyProgressState.duration);
  spotifyPlayer.seek(seekMs);
  spotifyProgressState.position = seekMs;
  spotifyProgressState.updatedAt = Date.now();
  tickSpotifyProgress();
}

function loadSpotifyPlaylists(){
  spotifyApiFetch('/me/playlists?limit=50').then(function(res){
    if(!res.ok) throw new Error('Failed to load playlists');
    return res.json();
  }).then(function(data){
    spotifyPlaylists = data.items || [];
    renderSpotifyPlaylists();
  }).catch(function(){
    var wrap = document.getElementById('spotify-list-wrap');
    if(wrap) wrap.innerHTML = '<div class="spotify-mini-empty">Couldn&rsquo;t load playlists.</div>';
  });
}

function renderSpotifyPlaylists(){
  var wrap = document.getElementById('spotify-list-wrap');
  if(!wrap) return;
  if(!spotifyPlaylists.length){
    wrap.innerHTML = '<div class="spotify-mini-empty">No playlists found.</div>';
    return;
  }
  wrap.innerHTML = '<div class="spotify-playlists">' +
      spotifyPlaylists.map(function(pl){
        var art = pl.images && pl.images[0] ? pl.images[0].url : '';
        var isPlaying = spotifyPlayingContext === pl.uri;
        return '<div class="spotify-playlist-row' + (isPlaying ? ' playing' : '') + '" onclick="playSpotifyPlaylist(\'' + pl.uri + '\')">' +
            '<div class="spotify-playlist-art" style="background-image:url(\'' + art + '\')"></div>' +
            '<span class="spotify-playlist-name">' + escapeHtml(pl.name) + '</span>' +
            (isPlaying ? '<span class="material-symbols-outlined">volume_up</span>' : '') +
          '</div>';
      }).join('') +
    '</div>';
}

function playSpotifyPlaylist(contextUri){
  if(!spotifyDeviceId){
    renderSpotifyBody('<div class="spotify-mini-empty">Player still connecting&hellip; try again in a moment.</div>');
    setTimeout(renderSpotifyWidget, 1500);
    return;
  }
  spotifyPlayingContext = contextUri;
  renderSpotifyPlaylists();
  setSpotifyViewMode('player');
  spotifyApiFetch('/me/player/play?device_id=' + spotifyDeviceId, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context_uri: contextUri })
  }).catch(function(){});
}

function renderSpotifyWidget(){
  renderSpotifyBody(
    '<div id="spotify-now-playing-wrap"></div>' +
    '<div id="spotify-list-wrap"><div class="spotify-mini-empty">Loading playlists&hellip;</div></div>'
  );
  setSpotifyViewMode('list');
  var disconnectBtn = document.getElementById('spotify-disconnect-btn');
  if(disconnectBtn) disconnectBtn.style.display = 'flex';
  loadSpotifyPlaylists();
}

function initSpotifyWidget(){
  handleSpotifyRedirect().then(function(){
    var auth = getSpotifyAuth();
    if(!auth){ renderSpotifyConnectPrompt(); return; }
    renderSpotifyWidget();
    initSpotifyPlayer();
  });
}
