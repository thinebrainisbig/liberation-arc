/* ============================================================
   Google Calendar Day View — Google Identity Services (GIS) OAuth
   token flow + FullCalendar (timeGridDay).

   Access tokens are never exchanged through a backend: this is a
   pure client-side "token client" flow, scoped read-only, tokens
   cached in localStorage so a refresh doesn't force a re-login
   inside the token's lifetime.
============================================================ */
(function(){
  'use strict';

  var CLIENT_ID = '498727289640-7aos1sr84bcc3ifrms2ao6bqqlbv4qva.apps.googleusercontent.com';
  var SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
  var EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

  var TOKEN_STORAGE_KEY = 'la_gcal_token';
  var TIME_FILTER_STORAGE_KEY = 'la_calendar_time_filter';
  var DEFAULT_MIN_TIME = '00:00:00';
  var DEFAULT_MAX_TIME = '24:00:00';
  var SILENT_REFRESH_MS = 50 * 60 * 1000;   // 50 minutes
  var POLL_MS = 30 * 60 * 1000;             // 30 minutes
  var GIS_WAIT_INTERVAL_MS = 200;
  var GIS_WAIT_MAX_ATTEMPTS = 100;          // ~20s before giving up

  var tokenClient = null;
  var accessToken = null;
  var tokenExpiresAt = 0;
  var calendar = null;
  var refreshTimer = null;
  var pollTimer = null;

  function loadStoredToken(){
    try {
      var raw = localStorage.getItem(TOKEN_STORAGE_KEY);
      if(!raw) return;
      var data = JSON.parse(raw);
      if(data && data.accessToken && data.expiresAt > Date.now()){
        accessToken = data.accessToken;
        tokenExpiresAt = data.expiresAt;
      }
    } catch(e){ /* corrupt/blocked storage — treat as no token */ }
  }

  function storeToken(token, expiresInSec){
    accessToken = token;
    tokenExpiresAt = Date.now() + (expiresInSec || 3600) * 1000;
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify({
        accessToken: accessToken,
        expiresAt: tokenExpiresAt
      }));
    } catch(e){ /* storage unavailable — token still usable for this session */ }
  }

  function clearToken(){
    accessToken = null;
    tokenExpiresAt = 0;
    try { localStorage.removeItem(TOKEN_STORAGE_KEY); } catch(e){}
  }

  function showConnectPill(){
    var pill = document.getElementById('calendar-connect-pill');
    if(pill) pill.classList.add('show');
  }

  function hideConnectPill(){
    var pill = document.getElementById('calendar-connect-pill');
    if(pill) pill.classList.remove('show');
  }

  function handleTokenResponse(resp){
    if(resp && resp.access_token){
      storeToken(resp.access_token, resp.expires_in);
      hideConnectPill();
      fetchEvents();
      scheduleSilentRefresh();
    } else {
      showConnectPill();
    }
  }

  function initTokenClient(){
    if(!window.google || !google.accounts || !google.accounts.oauth2) return null;
    return google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: handleTokenResponse,
      error_callback: function(){ showConnectPill(); }
    });
  }

  function requestToken(interactive){
    if(!tokenClient) return;
    tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  }

  function scheduleSilentRefresh(){
    if(refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function(){ requestToken(false); }, SILENT_REFRESH_MS);
  }

  function schedulePolling(){
    if(pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(fetchEvents, POLL_MS);
  }

  function connectCalendar(){
    requestToken(true);
  }

  function fetchEvents(){
    if(!accessToken){
      showConnectPill();
      return;
    }
    var startOfDay = new Date();
    startOfDay.setHours(0,0,0,0);
    var endOfWindow = new Date(startOfDay.getTime() + 7 * 24 * 60 * 60 * 1000);

    var params = new URLSearchParams({
      timeMin: startOfDay.toISOString(),
      timeMax: endOfWindow.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50'
    });

    fetch(EVENTS_URL + '?' + params.toString(), {
      headers: { Authorization: 'Bearer ' + accessToken }
    }).then(function(res){
      if(res.status === 401){
        clearToken();
        requestToken(false);
        return null;
      }
      if(!res.ok) throw new Error('Calendar fetch failed: ' + res.status);
      return res.json();
    }).then(function(data){
      if(!data) return;
      hideConnectPill();
      renderEvents(data.items || []);
    }).catch(function(){
      showConnectPill();
    });
  }

  /* Google Calendar's own official event colors (colorId 1-11, per the
     Calendar API's fixed event-color palette) — used directly whenever
     an event carries a colorId, so it matches what the user sees in
     their actual Google Calendar. */
  var GOOGLE_EVENT_COLORS = {
    '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73',
    '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161',
    '9': '#3f51b5', '10': '#0b8043', '11': '#d50000'
  };

  /* Apple Calendar-style pastel palette: fallback for events with no
     colorId set. Colored deterministically by a stable key — the
     recurring series id (or title, for non-recurring events) — never
     the per-instance event id, which Google mints fresh per occurrence
     of a recurring event and would otherwise make the same recurring
     event (e.g. a gym class) render a different color on every day. */
  var EVENT_PALETTE = [
    { bg: 'rgba(147,197,253,0.25)', accent: '#93c5fd' }, // pastel blue
    { bg: 'rgba(253,186,116,0.25)', accent: '#fdba74' }, // pastel orange
    { bg: 'rgba(134,239,172,0.25)', accent: '#86efac' }  // pastel green
  ];

  function hexToRgba(hex, alpha){
    var r = parseInt(hex.slice(1,3), 16);
    var g = parseInt(hex.slice(3,5), 16);
    var b = parseInt(hex.slice(5,7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function paletteForKey(key){
    var hash = 0;
    var str = String(key || '');
    for(var i = 0; i < str.length; i++){
      hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return EVENT_PALETTE[hash % EVENT_PALETTE.length];
  }

  function paletteForEvent(event){
    var props = event.extendedProps || {};
    var googleHex = props.colorId && GOOGLE_EVENT_COLORS[props.colorId];
    if(googleHex) return { bg: hexToRgba(googleHex, 0.25), accent: googleHex };
    return paletteForKey(props.recurringEventId || event.title);
  }

  function renderEvents(items){
    if(!calendar) return;
    var events = items.map(function(item){
      var startInfo = item.start || {};
      var endInfo = item.end || {};
      return {
        id: item.id,
        title: item.summary || '(No title)',
        start: startInfo.dateTime || startInfo.date,
        end: endInfo.dateTime || endInfo.date,
        allDay: !startInfo.dateTime,
        extendedProps: {
          location: item.location || '',
          colorId: item.colorId || null,
          recurringEventId: item.recurringEventId || null
        }
      };
    });
    calendar.removeAllEventSources();
    calendar.addEventSource(events);
  }

  function loadStoredTimeFilter(){
    try {
      var raw = localStorage.getItem(TIME_FILTER_STORAGE_KEY);
      if(!raw) return null;
      var data = JSON.parse(raw);
      if(data && data.min && data.max) return data;
    } catch(e){ /* corrupt/blocked storage — fall back to default */ }
    return null;
  }

  function storeTimeFilter(minTime, maxTime){
    try {
      localStorage.setItem(TIME_FILTER_STORAGE_KEY, JSON.stringify({ min: minTime, max: maxTime }));
    } catch(e){ /* storage unavailable — filter still applied for this session */ }
  }

  function updateActiveRangeButton(minTime, maxTime){
    var presetBtns = document.querySelectorAll('.calendar-range-btn[data-min]');
    var matched = false;
    presetBtns.forEach(function(btn){
      var isMatch = btn.getAttribute('data-min') === minTime && btn.getAttribute('data-max') === maxTime;
      btn.classList.toggle('active', isMatch);
      if(isMatch) matched = true;
    });
    var customBtn = document.getElementById('calendar-range-custom-btn');
    if(customBtn) customBtn.classList.toggle('active', !matched);
  }

  function setCalendarTimeRange(minTime, maxTime){
    if(!calendar) return;
    calendar.setOption('slotMinTime', minTime);
    calendar.setOption('slotMaxTime', maxTime);
    storeTimeFilter(minTime, maxTime);
    updateActiveRangeButton(minTime, maxTime);
  }

  function closeRangePopover(){
    var popover = document.getElementById('calendar-range-popover');
    if(popover) popover.classList.remove('show');
  }

  function initFullCalendar(){
    var el = document.getElementById('calendar-body');
    if(!el || !window.FullCalendar) return;

    var storedFilter = loadStoredTimeFilter();
    var initialMin = storedFilter ? storedFilter.min : DEFAULT_MIN_TIME;
    var initialMax = storedFilter ? storedFilter.max : DEFAULT_MAX_TIME;

    // Center the red "now" line vertically in the card on load, rather
    // than pinning it to the top edge: scroll to ~4.5 hours before now.
    // Minute-level math (not just getHours()) since 4.5h isn't a whole
    // number of hours.
    var now = new Date();
    var nowMinutes = now.getHours() * 60 + now.getMinutes();
    var centeredMinutes = Math.max(0, nowMinutes - 4.5 * 60);
    var centeredHour = Math.floor(centeredMinutes / 60);
    var centeredMinute = Math.floor(centeredMinutes % 60);
    var scrollTimeString = String(centeredHour).padStart(2, '0') + ':' + String(centeredMinute).padStart(2, '0') + ':00';

    calendar = new FullCalendar.Calendar(el, {
      initialView: 'timeGridThreeDay',
      headerToolbar: false,
      allDaySlot: false,
      nowIndicator: true,
      height: '100%',
      expandRows: true,
      slotMinTime: initialMin,
      slotMaxTime: initialMax,
      scrollTime: scrollTimeString,
      scrollTimeReset: false,
      dayHeaderFormat: { month: 'numeric', day: 'numeric', weekday: 'short' },
      slotLabelContent: function(arg){
        var hours = arg.date.getHours();
        var minutes = arg.date.getMinutes();
        if(hours === 12 && minutes === 0) return 'Noon';
        var period = hours >= 12 ? 'PM' : 'AM';
        var displayHour = hours % 12;
        if(displayHour === 0) displayHour = 12;
        return minutes === 0
          ? (displayHour + ' ' + period)
          : (displayHour + ':' + String(minutes).padStart(2,'0') + ' ' + period);
      },
      eventContent: function(arg){
        // Direct children of FullCalendar's own `.fc-event-main` (not a
        // nested wrapper) so title + time render as inline flex siblings
        // on one line, e.g. "TB: BREAK! • 1:00 - 1:20".
        var titleEl = document.createElement('span');
        titleEl.className = 'fc-event-title';
        titleEl.textContent = arg.event.title;

        var nodes = [titleEl];

        var subtitleParts = [];
        if(arg.timeText) subtitleParts.push(arg.timeText);
        var location = arg.event.extendedProps && arg.event.extendedProps.location;
        if(location) subtitleParts.push(location);

        if(subtitleParts.length){
          var sepEl = document.createElement('span');
          sepEl.className = 'fc-la-event-sep';
          sepEl.textContent = '•';
          nodes.push(sepEl);

          var timeEl = document.createElement('span');
          timeEl.className = 'fc-event-time';
          timeEl.textContent = subtitleParts.join(' · ');
          nodes.push(timeEl);
        }
        return { domNodes: nodes };
      },
      eventDidMount: function(info){
        var palette = paletteForEvent(info.event);
        info.el.style.setProperty('--event-color', palette.accent);
        info.el.style.backgroundColor = palette.bg;
      },
      views: {
        timeGridThreeDay: {
          type: 'timeGrid',
          duration: { days: 3 },
          buttonText: '3 days'
        },
        timeGridFiveDay: {
          type: 'timeGrid',
          duration: { days: 5 },
          buttonText: '5 days'
        }
      }
    });
    calendar.render();

    updateActiveRangeButton(initialMin, initialMax);
    var startInput = document.getElementById('calendar-range-start');
    var endInput = document.getElementById('calendar-range-end');
    if(startInput) startInput.value = initialMin.slice(0,5);
    if(endInput) endInput.value = initialMax === '24:00:00' ? '00:00' : initialMax.slice(0,5);
  }

  var MOBILE_QUERY = '(max-width: 768px)';

  function applyResponsiveView(){
    if(!calendar) return;
    if(!window.matchMedia(MOBILE_QUERY).matches) return;
    if(calendar.view.type !== 'timeGridDay') calendar.changeView('timeGridDay');
    document.querySelectorAll('.calendar-tab').forEach(function(t){
      t.classList.toggle('active', t.getAttribute('data-view') === 'timeGridDay');
    });
  }

  function initResponsiveView(){
    applyResponsiveView();
    var mql = window.matchMedia(MOBILE_QUERY);
    var handler = function(e){ if(e.matches) applyResponsiveView(); };
    if(mql.addEventListener) mql.addEventListener('change', handler);
    else if(mql.addListener) mql.addListener(handler);
  }

  function initCalendarTabs(){
    var tabs = document.querySelectorAll('.calendar-tab');
    tabs.forEach(function(tab){
      tab.addEventListener('click', function(){
        var view = tab.getAttribute('data-view');
        if(!calendar || !view) return;
        calendar.changeView(view);
        tabs.forEach(function(t){ t.classList.remove('active'); });
        tab.classList.add('active');
      });
    });
  }

  function initTimeRangeControls(){
    var presetBtns = document.querySelectorAll('.calendar-range-btn[data-min]');
    presetBtns.forEach(function(btn){
      btn.addEventListener('click', function(){
        setCalendarTimeRange(btn.getAttribute('data-min'), btn.getAttribute('data-max'));
        closeRangePopover();
      });
    });

    var customBtn = document.getElementById('calendar-range-custom-btn');
    var popover = document.getElementById('calendar-range-popover');
    var startInput = document.getElementById('calendar-range-start');
    var endInput = document.getElementById('calendar-range-end');
    var applyBtn = document.getElementById('calendar-range-apply');

    if(customBtn && popover){
      customBtn.addEventListener('click', function(e){
        e.stopPropagation();
        popover.classList.toggle('show');
      });
      document.addEventListener('click', function(e){
        if(!popover.contains(e.target) && e.target !== customBtn){
          popover.classList.remove('show');
        }
      });
    }

    if(applyBtn){
      applyBtn.addEventListener('click', function(){
        if(!startInput.value || !endInput.value) return;
        var minTime = startInput.value + ':00';
        var maxTime = endInput.value === '00:00' ? '24:00:00' : endInput.value + ':00';
        setCalendarTimeRange(minTime, maxTime);
        closeRangePopover();
      });
    }
  }

  function boot(){
    tokenClient = initTokenClient();
    if(!tokenClient){
      showConnectPill();
      return;
    }
    if(accessToken && tokenExpiresAt > Date.now()){
      hideConnectPill();
      fetchEvents();
      scheduleSilentRefresh();
    } else {
      requestToken(false);
    }
    schedulePolling();
  }

  function waitForGis(){
    var attempts = 0;
    var waitTimer = setInterval(function(){
      attempts++;
      if(window.google && google.accounts && google.accounts.oauth2){
        clearInterval(waitTimer);
        boot();
      } else if(attempts >= GIS_WAIT_MAX_ATTEMPTS){
        clearInterval(waitTimer);
        showConnectPill();
      }
    }, GIS_WAIT_INTERVAL_MS);
  }

  function init(){
    initFullCalendar();
    initCalendarTabs();
    initTimeRangeControls();
    initResponsiveView();
    loadStoredToken();

    var pill = document.getElementById('calendar-connect-pill');
    if(pill) pill.addEventListener('click', connectCalendar);

    if(window.google && google.accounts && google.accounts.oauth2){
      boot();
    } else {
      waitForGis();
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
