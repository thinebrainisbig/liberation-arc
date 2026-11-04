/* ============================================================
   YouTube mini card — la_youtube_token / la_youtube_playlists
   Same Google Identity Services (GIS) token-client mechanism the
   Calendar card uses (js/calendar.js), instantiated separately here
   with its own scope (youtube.readonly) and its own token storage
   so this widget's auth is independent of Calendar's — connecting
   one never silently grants or revokes the other. Playback goes
   through the YouTube IFrame Player API, rendered into a visually
   hidden 2x2 anchor (#youtube-player-anchor) since this widget draws
   its own now-playing UI rather than showing YouTube's chrome.

   Shared by every page (index.html, financial-subpage.html,
   screens/*.html). Byte-identical across all 5 pages before this
   extraction; verified via diff before moving here.

   Deliberately NOT wrapped in an IIFE (unlike js/core.js and
   js/weather-widget.js): several onclick="" handlers in the page
   markup reference `youtubePlayer` as a bare global
   (youtubePlayer.previousVideo()/.nextVideo()), not through a
   function call. A closure-scoped `var youtubePlayer` would make
   those handlers throw "youtubePlayer is not defined". Plain
   top-level `var`/`function` declarations in a script file become
   window properties automatically, same as they did when this code
   lived inline on each page — so this preserves that behavior
   exactly. Depends on loadJSON/saveJSON/escapeHtml from js/core.js
   (load that first).
============================================================ */
var YOUTUBE_CLIENT_ID = '498727289640-7aos1sr84bcc3ifrms2ao6bqqlbv4qva.apps.googleusercontent.com';
var YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
var YOUTUBE_PLAYLISTS_URL = 'https://www.googleapis.com/youtube/v3/playlists';
var YOUTUBE_TOKEN_KEY = 'la_youtube_token';
var YOUTUBE_PLAYLISTS_CACHE_KEY = 'la_youtube_playlists';
var YOUTUBE_PLAYLISTS_FRESH_MS = 60 * 60 * 1000; // 1 hour
var YOUTUBE_GIS_WAIT_INTERVAL_MS = 200;
var YOUTUBE_GIS_WAIT_MAX_ATTEMPTS = 100; // ~20s before giving up

var youtubeTokenClient = null;
var youtubeAccessToken = null;
var youtubeTokenExpiresAt = 0;
var youtubePlayer = null;
var youtubePlayerReady = false;
var youtubePlayerPendingCallback = null;
var youtubePlaylists = [];
var youtubePlayingId = null;
var youtubeShuffleOn = false;
var youtubeProgressTimer = null;
var youtubeViewMode = 'list'; // 'list' | 'player'
var youtubeVolume = (function(){ try{ var v = localStorage.getItem('la_youtube_volume'); return v !== null ? parseFloat(v) : 0.6; }catch(e){ return 0.6; } })();
var youtubeMutedVolume = null;
var youtubeVolumeDragging = false;

function getYoutubeTokenData(){ return loadJSON(YOUTUBE_TOKEN_KEY, null); }
function saveYoutubeTokenData(token, expiresInSec){
  youtubeAccessToken = token;
  youtubeTokenExpiresAt = Date.now() + (expiresInSec || 3600) * 1000;
  saveJSON(YOUTUBE_TOKEN_KEY, { accessToken: youtubeAccessToken, expiresAt: youtubeTokenExpiresAt });
}
function clearYoutubeTokenData(){
  youtubeAccessToken = null;
  youtubeTokenExpiresAt = 0;
  localStorage.removeItem(YOUTUBE_TOKEN_KEY);
}
function loadStoredYoutubeToken(){
  var data = getYoutubeTokenData();
  if(data && data.accessToken && data.expiresAt > Date.now()){
    youtubeAccessToken = data.accessToken;
    youtubeTokenExpiresAt = data.expiresAt;
  }
}

function getYoutubePlaylistsCache(){ return loadJSON(YOUTUBE_PLAYLISTS_CACHE_KEY, null); }
function saveYoutubePlaylistsCache(items){ saveJSON(YOUTUBE_PLAYLISTS_CACHE_KEY, { fetchedAt: Date.now(), items: items }); }

function renderYoutubeBody(html){
  var body = document.getElementById('youtube-mini-body');
  if(body) body.innerHTML = html;
}

function renderYoutubeConnectPrompt(){
  renderYoutubeBody('<button type="button" class="youtube-connect-btn" onclick="connectYoutube()">' +
    '<span class="material-symbols-outlined">smart_display</span>Connect YouTube</button>');
}

function setYoutubeViewMode(mode){
  youtubeViewMode = mode;
  var nowWrap = document.getElementById('youtube-now-playing-wrap');
  var listWrap = document.getElementById('youtube-list-wrap');
  var customIdRow = document.getElementById('youtube-custom-id-row');
  var backBtn = document.getElementById('youtube-back-btn');
  if(nowWrap) nowWrap.style.display = mode === 'player' ? '' : 'none';
  if(listWrap) listWrap.style.display = mode === 'list' ? '' : 'none';
  if(customIdRow) customIdRow.style.display = mode === 'list' ? 'flex' : 'none';
  if(backBtn) backBtn.style.display = mode === 'player' ? 'flex' : 'none';
}

function backToYoutubePlaylists(){
  if(youtubePlayer && youtubePlayer.stopVideo){ try { youtubePlayer.stopVideo(); } catch(e){} }
  stopYoutubeProgressTimer();
  youtubePlayingId = null;
  setYoutubeViewMode('list');
  renderYoutubePlaylists();
}

function handleYoutubeTokenResponse(resp){
  if(resp && resp.access_token){
    saveYoutubeTokenData(resp.access_token, resp.expires_in);
    renderYoutubeWidget();
  } else {
    renderYoutubeConnectPrompt();
  }
}

function initYoutubeTokenClient(){
  if(!window.google || !google.accounts || !google.accounts.oauth2) return null;
  return google.accounts.oauth2.initTokenClient({
    client_id: YOUTUBE_CLIENT_ID,
    scope: YOUTUBE_SCOPE,
    callback: handleYoutubeTokenResponse,
    error_callback: function(){ renderYoutubeConnectPrompt(); }
  });
}

function requestYoutubeToken(interactive){
  if(!youtubeTokenClient) return;
  youtubeTokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
}

function connectYoutube(){ requestYoutubeToken(true); }

function disconnectYoutube(){
  clearYoutubeTokenData();
  youtubePlaylists = [];
  youtubePlayingId = null;
  stopYoutubeProgressTimer();
  if(youtubePlayer && youtubePlayer.stopVideo){ try { youtubePlayer.stopVideo(); } catch(e){} }
  localStorage.removeItem(YOUTUBE_PLAYLISTS_CACHE_KEY);
  youtubeViewMode = 'list';
  var disconnectBtn = document.getElementById('youtube-disconnect-btn');
  if(disconnectBtn) disconnectBtn.style.display = 'none';
  var backBtn = document.getElementById('youtube-back-btn');
  if(backBtn) backBtn.style.display = 'none';
  renderYoutubeConnectPrompt();
}

function youtubeApiFetch(url){
  return fetch(url, { headers: { Authorization: 'Bearer ' + youtubeAccessToken } }).then(function(res){
    if(res.status === 401){
      clearYoutubeTokenData();
      requestYoutubeToken(false);
      throw new Error('YouTube token expired');
    }
    if(!res.ok) throw new Error('YouTube API request failed: ' + res.status);
    return res.json();
  });
}

function loadYoutubePlaylists(force){
  var cache = getYoutubePlaylistsCache();
  if(!force && cache && (Date.now() - cache.fetchedAt) < YOUTUBE_PLAYLISTS_FRESH_MS){
    youtubePlaylists = cache.items;
    renderYoutubePlaylists();
    return;
  }
  var wrap = document.getElementById('youtube-list-wrap');
  if(wrap) wrap.innerHTML = '<div class="youtube-mini-empty">Loading playlists&hellip;</div>';
  var url = YOUTUBE_PLAYLISTS_URL + '?part=snippet,contentDetails&mine=true&maxResults=50';
  youtubeApiFetch(url).then(function(data){
    youtubePlaylists = data.items || [];
    saveYoutubePlaylistsCache(youtubePlaylists);
    renderYoutubePlaylists();
  }).catch(function(){
    var w = document.getElementById('youtube-list-wrap');
    if(w) w.innerHTML = '<div class="youtube-mini-empty">Couldn&rsquo;t load playlists.</div>';
  });
}

function renderYoutubePlaylists(){
  var wrap = document.getElementById('youtube-list-wrap');
  if(!wrap) return;
  if(!youtubePlaylists.length){
    wrap.innerHTML = '<div class="youtube-mini-empty">No playlists found.</div>';
    return;
  }
  wrap.innerHTML = '<div class="youtube-playlists">' +
      youtubePlaylists.map(function(pl){
        var thumbs = pl.snippet && pl.snippet.thumbnails ? pl.snippet.thumbnails : {};
        var thumb = (thumbs.medium || thumbs.default || {}).url || '';
        var count = pl.contentDetails ? pl.contentDetails.itemCount : null;
        var isPlaying = youtubePlayingId === pl.id;
        return '<div class="youtube-playlist-row' + (isPlaying ? ' playing' : '') + '" onclick="playYoutubePlaylist(\'' + pl.id + '\')">' +
            '<div class="youtube-playlist-art" style="background-image:url(\'' + thumb + '\')"></div>' +
            '<div class="youtube-playlist-meta">' +
              '<span class="youtube-playlist-name">' + escapeHtml(pl.snippet.title) + '</span>' +
              (count != null ? '<span class="youtube-playlist-count">' + count + ' videos</span>' : '') +
            '</div>' +
            (isPlaying ? '<span class="material-symbols-outlined">volume_up</span>' : '') +
          '</div>';
      }).join('') +
    '</div>';
}

function ensureYoutubePlayer(callback){
  if(youtubePlayerReady && youtubePlayer){ callback(); return; }
  youtubePlayerPendingCallback = callback;
  if(window.YT && window.YT.Player){
    createYoutubePlayer();
    return;
  }
  if(!document.getElementById('youtube-iframe-api-script')){
    var tag = document.createElement('script');
    tag.id = 'youtube-iframe-api-script';
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  }
}

window.onYouTubeIframeAPIReady = function(){ createYoutubePlayer(); };

function createYoutubePlayer(){
  if(youtubePlayer){
    if(youtubePlayerReady && youtubePlayerPendingCallback){
      var cb = youtubePlayerPendingCallback;
      youtubePlayerPendingCallback = null;
      cb();
    }
    return;
  }
  youtubePlayer = new YT.Player('youtube-player-anchor', {
    height: '2', width: '2',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, origin: window.location.origin },
    events: {
      onReady: function(){
        youtubePlayerReady = true;
        if(youtubePlayer.setVolume) youtubePlayer.setVolume(youtubeVolume * 100);
        if(youtubePlayerPendingCallback){
          var cb = youtubePlayerPendingCallback;
          youtubePlayerPendingCallback = null;
          cb();
        }
      },
      onStateChange: onYoutubePlayerStateChange,
      onError: onYoutubePlayerError
    }
  });
}

function onYoutubePlayerStateChange(evt){
  renderYoutubeNowPlaying();
  if(evt.data === YT.PlayerState.PLAYING){ startYoutubeProgressTimer(); }
  else { stopYoutubeProgressTimer(); }
}

// YT error codes: 2 invalid param, 5 HTML5 player error, 100 video
// not found/private, 101/150 embedding disabled by the uploader
// (the last one is the usual culprit when a playlist "loads" but
// never actually plays — it's a per-video toggle, unrelated to the
// playlist's own public/private/unlisted setting).
var YOUTUBE_ERROR_MESSAGES = {
  2: 'Invalid video/playlist parameter.',
  5: 'This video can&rsquo;t be played in the HTML5 player.',
  100: 'Video not found or private.',
  101: 'The uploader disabled embedding for this video.',
  150: 'The uploader disabled embedding for this video.'
};

function onYoutubePlayerError(evt){
  var msg = YOUTUBE_ERROR_MESSAGES[evt.data] || ('YouTube player error (code ' + evt.data + ').');
  console.warn('[youtube widget]', msg, evt);
  var wrap = document.getElementById('youtube-now-playing-wrap');
  if(wrap){
    wrap.innerHTML = '<div class="youtube-mini-empty">' + msg + ' Skipping&hellip;</div>';
  }
  stopYoutubeProgressTimer();
  if(youtubePlayer && youtubePlayer.nextVideo){
    setTimeout(function(){ youtubePlayer.nextVideo(); }, 1200);
  }
}

function playYoutubePlaylist(playlistId){
  youtubePlayingId = playlistId;
  renderYoutubePlaylists();
  setYoutubeViewMode('player');
  ensureYoutubePlayer(function(){
    youtubePlayer.loadPlaylist({ list: playlistId, listType: 'playlist' });
    youtubePlayer.playVideo();
    youtubeShuffleOn = false;
    if(youtubePlayer.setShuffle) youtubePlayer.setShuffle(false);
    renderYoutubeNowPlaying();
  });
}

function youtubeFormatTime(sec){
  if(sec == null || isNaN(sec)) return '0:00';
  sec = Math.floor(sec);
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function renderYoutubeNowPlaying(){
  var wrap = document.getElementById('youtube-now-playing-wrap');
  if(!wrap) return;
  var data = youtubePlayer && youtubePlayer.getVideoData ? youtubePlayer.getVideoData() : null;
  if(!data || !data.video_id){
    stopYoutubeProgressTimer();
    wrap.innerHTML = '';
    return;
  }
  var state = youtubePlayer.getPlayerState();
  var isPaused = state !== YT.PlayerState.PLAYING;
  var duration = youtubePlayer.getDuration() || 0;
  var position = youtubePlayer.getCurrentTime() || 0;
  var pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  var thumb = 'https://i.ytimg.com/vi/' + data.video_id + '/mqdefault.jpg';
  wrap.innerHTML =
    '<div class="youtube-now-playing">' +
      '<div class="youtube-now-playing-top">' +
        '<div class="youtube-art" style="background-image:url(\'' + thumb + '\')"></div>' +
        '<div class="youtube-track-meta">' +
          '<span class="youtube-track-title">' + escapeHtml(data.title || '') + '</span>' +
          '<span class="youtube-track-artist">' + escapeHtml(data.author || '') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="youtube-progress-row">' +
        '<span class="youtube-progress-time" id="youtube-progress-elapsed">' + youtubeFormatTime(position) + '</span>' +
        '<div class="youtube-progress-track" id="youtube-progress-track" onclick="seekYoutubeProgress(event)">' +
          '<div class="youtube-progress-fill" id="youtube-progress-fill" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<span class="youtube-progress-time" id="youtube-progress-duration">' + youtubeFormatTime(duration) + '</span>' +
      '</div>' +
      '<div class="youtube-controls">' +
        '<button type="button" class="youtube-shuffle-toggle' + (youtubeShuffleOn ? ' active' : '') + '" onclick="setYoutubeShuffle(' + (!youtubeShuffleOn) + ')" title="Shuffle"><span class="material-symbols-outlined">shuffle</span></button>' +
        '<button type="button" onclick="youtubePlayer.previousVideo()" title="Previous"><span class="material-symbols-outlined">skip_previous</span></button>' +
        '<button type="button" class="youtube-play-btn" onclick="toggleYoutubePlayback()" title="Play/Pause"><span class="material-symbols-outlined">' + (isPaused ? 'play_arrow' : 'pause') + '</span></button>' +
        '<button type="button" onclick="youtubePlayer.nextVideo()" title="Next"><span class="material-symbols-outlined">skip_next</span></button>' +
      '</div>' +
      '<div class="youtube-volume-row">' +
        '<span class="material-symbols-outlined" id="youtube-volume-icon" onclick="toggleYoutubeMute()">' + youtubeVolumeIcon() + '</span>' +
        '<div class="youtube-volume-track" id="youtube-volume-track" onmousedown="startYoutubeVolumeDrag(event)">' +
          '<div class="youtube-volume-fill" id="youtube-volume-fill" style="width:' + (youtubeVolume * 100) + '%"></div>' +
          '<div class="youtube-volume-thumb" id="youtube-volume-thumb" style="left:' + (youtubeVolume * 100) + '%"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  if(!isPaused) startYoutubeProgressTimer(); else stopYoutubeProgressTimer();
}

function youtubeVolumeIcon(){
  if(youtubeVolume <= 0) return 'volume_off';
  if(youtubeVolume < 0.5) return 'volume_down';
  return 'volume_up';
}

function applyYoutubeVolume(vol){
  youtubeVolume = Math.max(0, Math.min(1, vol));
  try{ localStorage.setItem('la_youtube_volume', youtubeVolume); }catch(e){}
  if(youtubePlayer && youtubePlayer.setVolume) youtubePlayer.setVolume(youtubeVolume * 100);
  var fill = document.getElementById('youtube-volume-fill');
  var thumbEl = document.getElementById('youtube-volume-thumb');
  var icon = document.getElementById('youtube-volume-icon');
  if(fill) fill.style.width = (youtubeVolume * 100) + '%';
  if(thumbEl) thumbEl.style.left = (youtubeVolume * 100) + '%';
  if(icon) icon.textContent = youtubeVolumeIcon();
}

function setYoutubeVolumeFromEvent(e){
  var track = document.getElementById('youtube-volume-track');
  if(!track) return;
  var rect = track.getBoundingClientRect();
  var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  applyYoutubeVolume(ratio);
}

function startYoutubeVolumeDrag(e){
  youtubeVolumeDragging = true;
  setYoutubeVolumeFromEvent(e);
  e.preventDefault();
}

function toggleYoutubeMute(){
  if(youtubeVolume > 0){
    youtubeMutedVolume = youtubeVolume;
    applyYoutubeVolume(0);
  } else {
    applyYoutubeVolume(youtubeMutedVolume != null ? youtubeMutedVolume : 0.6);
  }
}

document.addEventListener('mousemove', function(e){ if(youtubeVolumeDragging) setYoutubeVolumeFromEvent(e); });
document.addEventListener('mouseup', function(){ youtubeVolumeDragging = false; });

function toggleYoutubePlayback(){
  if(!youtubePlayer) return;
  var state = youtubePlayer.getPlayerState();
  if(state === YT.PlayerState.PLAYING) youtubePlayer.pauseVideo();
  else youtubePlayer.playVideo();
}

function setYoutubeShuffle(on){
  youtubeShuffleOn = on;
  if(youtubePlayer && youtubePlayer.setShuffle) youtubePlayer.setShuffle(on);
  renderYoutubeNowPlaying();
}

function startYoutubeProgressTimer(){
  if(youtubeProgressTimer) return;
  youtubeProgressTimer = setInterval(tickYoutubeProgress, 500);
}

function stopYoutubeProgressTimer(){
  if(youtubeProgressTimer){ clearInterval(youtubeProgressTimer); youtubeProgressTimer = null; }
}

function tickYoutubeProgress(){
  if(!youtubePlayer || !youtubePlayer.getCurrentTime){ stopYoutubeProgressTimer(); return; }
  var fill = document.getElementById('youtube-progress-fill');
  var elapsedEl = document.getElementById('youtube-progress-elapsed');
  if(!fill || !elapsedEl) return;
  var duration = youtubePlayer.getDuration() || 0;
  var position = youtubePlayer.getCurrentTime() || 0;
  var pct = duration ? Math.min(100, (position / duration) * 100) : 0;
  fill.style.width = pct + '%';
  elapsedEl.textContent = youtubeFormatTime(position);
}

function seekYoutubeProgress(e){
  if(!youtubePlayer || !youtubePlayer.seekTo) return;
  var duration = youtubePlayer.getDuration();
  if(!duration) return;
  var track = document.getElementById('youtube-progress-track');
  if(!track) return;
  var rect = track.getBoundingClientRect();
  var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  youtubePlayer.seekTo(ratio * duration, true);
  tickYoutubeProgress();
}

function renderYoutubeWidget(){
  renderYoutubeBody(
    '<div id="youtube-now-playing-wrap"></div>' +
    '<div class="youtube-custom-id-row" id="youtube-custom-id-row">' +
      '<input type="text" id="youtube-custom-id-input" placeholder="Paste playlist ID or URL" value="' + escapeHtml(getYoutubeCustomPlaylistId()) + '" onkeydown="if(event.key===\'Enter\'){playCustomYoutubePlaylist();}">' +
      '<button type="button" onclick="playCustomYoutubePlaylist()" title="Play playlist"><span class="material-symbols-outlined">play_arrow</span></button>' +
    '</div>' +
    '<div id="youtube-list-wrap"><div class="youtube-mini-empty">Loading playlists&hellip;</div></div>'
  );
  setYoutubeViewMode('list');
  var disconnectBtn = document.getElementById('youtube-disconnect-btn');
  if(disconnectBtn) disconnectBtn.style.display = 'flex';
  loadYoutubePlaylists(false);
}

var YOUTUBE_CUSTOM_PLAYLIST_KEY = 'la_youtube_custom_playlist_id';

function getYoutubeCustomPlaylistId(){
  try{ return localStorage.getItem(YOUTUBE_CUSTOM_PLAYLIST_KEY) || ''; }catch(e){ return ''; }
}

function saveYoutubeCustomPlaylistId(id){
  try{ localStorage.setItem(YOUTUBE_CUSTOM_PLAYLIST_KEY, id); }catch(e){}
}

function extractYoutubePlaylistId(raw){
  if(!raw) return '';
  raw = raw.trim();
  var match = raw.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if(match) return match[1];
  return raw;
}

function playCustomYoutubePlaylist(){
  var input = document.getElementById('youtube-custom-id-input');
  if(!input) return;
  var id = extractYoutubePlaylistId(input.value);
  if(!id) return;
  input.value = id;
  saveYoutubeCustomPlaylistId(id);
  playYoutubePlaylist(id);
}

function bootYoutubeWidget(){
  youtubeTokenClient = initYoutubeTokenClient();
  if(!youtubeTokenClient){ renderYoutubeConnectPrompt(); return; }
  if(youtubeAccessToken && youtubeTokenExpiresAt > Date.now()){
    renderYoutubeWidget();
  } else {
    renderYoutubeConnectPrompt();
    requestYoutubeToken(false);
  }
}

function waitForGisYoutube(){
  var attempts = 0;
  var waitTimer = setInterval(function(){
    attempts++;
    if(window.google && google.accounts && google.accounts.oauth2){
      clearInterval(waitTimer);
      bootYoutubeWidget();
    } else if(attempts >= YOUTUBE_GIS_WAIT_MAX_ATTEMPTS){
      clearInterval(waitTimer);
      renderYoutubeConnectPrompt();
    }
  }, YOUTUBE_GIS_WAIT_INTERVAL_MS);
}

function initYoutubeWidget(){
  loadStoredYoutubeToken();
  if(window.google && google.accounts && google.accounts.oauth2){
    bootYoutubeWidget();
  } else {
    waitForGisYoutube();
  }
}
