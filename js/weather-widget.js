/* ============================================================
   Weather mini card — la_weather_location / la_weather_cache
   3-day forecast via Open-Meteo (free, no API key: both the
   geocoding and forecast endpoints are keyless, so there's no
   credential to mismanage or leak). Cache is keyed to the exact
   lat/lon so switching location always refetches, but reloading the
   same location within FRESH_MS reuses the cached forecast instead
   of re-hitting the network on every page load.

   Shared by every page (index.html, financial-subpage.html,
   screens/*.html). Byte-identical across all 5 pages before this
   extraction; verified via diff before moving here. Depends on
   loadJSON/saveJSON/escapeHtml from js/core.js (load that first).
============================================================ */
(function(){
  'use strict';

  var WEATHER_FRESH_MS = 20 * 60 * 1000;
  // [emoji, label, accent color, icon-chip background, description clause]
  var WEATHER_ICONS = {
    0:['☀️','Clear','#fbbf24','rgba(251,191,36,0.16)','clear skies'],
    1:['🌤️','Mainly Clear','#fbbf24','rgba(251,191,36,0.16)','mostly clear skies'],
    2:['⛅','Partly Cloudy','#7dd3fc','rgba(125,211,252,0.16)','a mix of sun and clouds'],
    3:['☁️','Overcast','#94a3b8','rgba(148,163,184,0.16)','overcast skies'],
    45:['🌫️','Fog','#cbd5e1','rgba(203,213,225,0.14)','foggy conditions'],
    48:['🌫️','Fog','#cbd5e1','rgba(203,213,225,0.14)','freezing fog'],
    51:['🌦️','Drizzle','#38bdf8','rgba(56,189,248,0.16)','light drizzle'],
    53:['🌦️','Drizzle','#38bdf8','rgba(56,189,248,0.16)','drizzle'],
    55:['🌦️','Drizzle','#38bdf8','rgba(56,189,248,0.16)','steady drizzle'],
    56:['🌧️','Freezing Drizzle','#38bdf8','rgba(56,189,248,0.16)','freezing drizzle'],
    57:['🌧️','Freezing Drizzle','#38bdf8','rgba(56,189,248,0.16)','freezing drizzle'],
    61:['🌧️','Rain','#38bdf8','rgba(56,189,248,0.16)','light rain'],
    63:['🌧️','Rain','#38bdf8','rgba(56,189,248,0.16)','rain'],
    65:['⛈️','Heavy Rain','#0ea5e9','rgba(14,165,233,0.18)','heavy rain'],
    66:['🌧️','Freezing Rain','#38bdf8','rgba(56,189,248,0.16)','freezing rain'],
    67:['🌧️','Freezing Rain','#38bdf8','rgba(56,189,248,0.16)','freezing rain'],
    80:['🌦️','Showers','#38bdf8','rgba(56,189,248,0.16)','scattered showers'],
    81:['🌦️','Showers','#38bdf8','rgba(56,189,248,0.16)','showers'],
    82:['⛈️','Heavy Showers','#0ea5e9','rgba(14,165,233,0.18)','heavy showers'],
    71:['🌨️','Snow','#a5f3fc','rgba(165,243,252,0.16)','light snow'],
    73:['🌨️','Snow','#a5f3fc','rgba(165,243,252,0.16)','snow'],
    75:['❄️','Heavy Snow','#67e8f9','rgba(103,232,249,0.18)','heavy snow'],
    77:['🌨️','Snow Grains','#a5f3fc','rgba(165,243,252,0.16)','snow grains'],
    85:['🌨️','Snow Showers','#a5f3fc','rgba(165,243,252,0.16)','snow showers'],
    86:['❄️','Snow Showers','#a5f3fc','rgba(165,243,252,0.16)','heavy snow showers'],
    95:['⛈️','Thunderstorm','#c084fc','rgba(192,132,252,0.18)','thunderstorms'],
    96:['⛈️','Thunderstorm','#c084fc','rgba(192,132,252,0.18)','thunderstorms with hail'],
    99:['⛈️','Thunderstorm','#c084fc','rgba(192,132,252,0.18)','severe thunderstorms']
  };
  function weatherIconFor(code){ return WEATHER_ICONS[code] || ['🌡️','—','#94a3b8','rgba(148,163,184,0.16)','changing conditions']; }
  function weatherDayLabel(iso, idx){
    if(idx === 0) return 'Today';
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days[new Date(iso + 'T00:00:00').getDay()];
  }
  function weatherDateLabel(iso){
    var d = new Date(iso + 'T00:00:00');
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function weatherSentence(d, clause){
    var s = clause.charAt(0).toUpperCase() + clause.slice(1) + ' expected, with a high of ' +
      Math.round(d.hi) + '&deg; and a low of ' + Math.round(d.lo) + '&deg;.';
    if(d.windMax != null && d.windMax >= 20){
      s += ' Breezy, gusting to ' + Math.round(d.windMax) + ' mph.';
    } else if(d.precipProb != null && d.precipProb >= 30){
      s += ' ' + Math.round(d.precipProb) + '% chance of precipitation.';
    }
    return s;
  }

  var US_STATE_ABBR = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
    'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
    'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
    'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
    'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
    'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
    'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
    'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
    'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
    'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
    'District of Columbia':'DC'
  };
  function abbreviateWeatherRegion(match){
    if(match.country_code === 'US' && match.admin1 && US_STATE_ABBR[match.admin1]){
      return US_STATE_ABBR[match.admin1];
    }
    if(match.admin1) return match.admin1;
    if(match.country_code) return match.country_code;
    return match.country || '';
  }
  function getWeatherLocation(){ return loadJSON('la_weather_location', null); }
  function saveWeatherLocation(loc){ saveJSON('la_weather_location', loc); }
  function getWeatherCache(){ return loadJSON('la_weather_cache', null); }
  function saveWeatherCache(cache){ saveJSON('la_weather_cache', cache); }
  function getWeatherViewMode(){ return loadJSON('la_weather_view_mode', '3d'); }
  function saveWeatherViewMode(mode){ saveJSON('la_weather_view_mode', mode); }

  function updateWeatherViewToggleUI(){
    var mode = getWeatherViewMode();
    var toggle = document.getElementById('weather-view-toggle');
    if(!toggle) return;
    var btns = toggle.querySelectorAll('.weather-view-btn');
    for(var i = 0; i < btns.length; i++){
      btns[i].classList.toggle('active', btns[i].getAttribute('data-view') === mode);
    }
    var card = document.querySelector('.weather-mini-card');
    if(card) card.classList.toggle('is-compact', mode === '1d');
  }

  function setWeatherViewMode(mode){
    saveWeatherViewMode(mode);
    updateWeatherViewToggleUI();
    var cache = getWeatherCache();
    if(cache && cache.days) renderWeatherDays(cache.days);
  }

  function renderWeatherBody(html){
    var body = document.getElementById('weather-mini-body');
    if(body) body.innerHTML = html;
  }

  function renderWeatherDays(days){
    updateWeatherViewToggleUI();
    var mode = getWeatherViewMode();
    var shown = mode === '1d' ? days.slice(0, 1) : days;
    renderWeatherBody(shown.map(function(d, i){
      var meta = weatherIconFor(d.code);
      return '<div class="weather-mini-row">' +
          '<div class="weather-mini-row-top">' +
            '<span class="weather-mini-icon" style="background:' + meta[3] + ';">' + meta[0] + '</span>' +
            '<div class="weather-mini-daycond">' +
              '<span class="weather-mini-day">' + weatherDayLabel(d.date, i) + '<span class="weather-mini-day-date">' + weatherDateLabel(d.date) + '</span></span>' +
              '<span class="weather-mini-cond" style="color:' + meta[2] + ';">' + meta[1] + '</span>' +
            '</div>' +
            '<span class="weather-mini-temps"><span class="hi">' + Math.round(d.hi) + '&deg;</span><span class="lo">' + Math.round(d.lo) + '&deg;</span></span>' +
          '</div>' +
          '<p class="weather-mini-sentence">' + weatherSentence(d, meta[4]) + '</p>' +
        '</div>';
    }).join(''));
  }

  function fetchWeather(loc){
    renderWeatherBody('<div class="weather-mini-empty">Loading forecast…</div>');
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(loc.lat) +
      '&longitude=' + encodeURIComponent(loc.lon) +
      '&current=weather_code' +
      '&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max' +
      '&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&forecast_days=3';
    fetch(url).then(function(res){
      if(!res.ok) throw new Error('Weather request failed');
      return res.json();
    }).then(function(data){
      var daily = data.daily;
      if(!daily || !daily.time){ throw new Error('Malformed weather response'); }
      // Today's daily weathercode is a whole-day aggregate and can read
      // "overcast" even while it's currently clear outside — the live
      // `current` reading is what's actually true right now, so it wins
      // for day 0. Future days have no "current" data, so the daily
      // aggregate is the best available signal for them.
      var currentCode = data.current ? data.current.weather_code : null;
      var days = daily.time.map(function(date, i){
        return {
          date: date, code: (i === 0 && currentCode != null) ? currentCode : daily.weathercode[i],
          hi: daily.temperature_2m_max[i], lo: daily.temperature_2m_min[i],
          precipProb: daily.precipitation_probability_max ? daily.precipitation_probability_max[i] : null,
          windMax: daily.windspeed_10m_max ? daily.windspeed_10m_max[i] : null
        };
      });
      saveWeatherCache({ lat: loc.lat, lon: loc.lon, fetchedAt: Date.now(), days: days });
      renderWeatherDays(days);
    }).catch(function(){
      renderWeatherBody('<div class="weather-mini-empty">Couldn&rsquo;t load the forecast. <span class="weather-mini-retry" onclick="loadWeather()">Retry</span></div>');
    });
  }

  function loadWeather(){
    updateWeatherViewToggleUI();
    var loc = getWeatherLocation();
    var labelEl = document.getElementById('weather-location-label');
    if(!loc){
      if(labelEl) labelEl.textContent = 'Weather';
      renderWeatherBody('<div class="weather-mini-empty">Set a location to see the forecast.</div>');
      return;
    }
    if(labelEl) labelEl.textContent = loc.name;
    var cache = getWeatherCache();
    if(cache && cache.lat === loc.lat && cache.lon === loc.lon && (Date.now() - cache.fetchedAt) < WEATHER_FRESH_MS){
      renderWeatherDays(cache.days);
      return;
    }
    fetchWeather(loc);
  }

  function openWeatherLocationEditor(){
    var editor = document.getElementById('weather-location-editor');
    var input = document.getElementById('weather-location-input');
    if(!editor || !input) return;
    editor.classList.add('open');
    editor.style.display = 'flex';
    var loc = getWeatherLocation();
    input.value = loc ? loc.name : '';
    input.focus();
    input.select();
  }

  function closeWeatherLocationEditor(){
    var editor = document.getElementById('weather-location-editor');
    if(editor) editor.style.display = 'none';
  }

  function handleWeatherLocationKeydown(e){
    if(e.key === 'Enter'){ e.preventDefault(); commitWeatherLocation(); }
    else if(e.key === 'Escape'){ e.preventDefault(); closeWeatherLocationEditor(); }
  }

  function commitWeatherLocation(){
    var input = document.getElementById('weather-location-input');
    if(!input) return;
    var query = input.value.trim();
    if(!query) return;
    renderWeatherBody('<div class="weather-mini-empty">Searching…</div>');
    fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&name=' + encodeURIComponent(query))
      .then(function(res){
        if(!res.ok) throw new Error('Geocoding request failed');
        return res.json();
      })
      .then(function(data){
        var match = data.results && data.results[0];
        if(!match){
          renderWeatherBody('<div class="weather-mini-empty">No location found for &ldquo;' + escapeHtml(query) + '&rdquo;. <span class="weather-mini-retry" onclick="openWeatherLocationEditor()">Try again</span></div>');
          return;
        }
        var region = abbreviateWeatherRegion(match);
        var name = match.name + (region ? ', ' + region : '');
        saveWeatherLocation({ name: name, lat: match.latitude, lon: match.longitude });
        closeWeatherLocationEditor();
        loadWeather();
      })
      .catch(function(){
        renderWeatherBody('<div class="weather-mini-empty">Couldn&rsquo;t search right now. <span class="weather-mini-retry" onclick="openWeatherLocationEditor()">Try again</span></div>');
      });
  }

  window.weatherIconFor = weatherIconFor;
  window.weatherDayLabel = weatherDayLabel;
  window.weatherDateLabel = weatherDateLabel;
  window.weatherSentence = weatherSentence;
  window.abbreviateWeatherRegion = abbreviateWeatherRegion;
  window.getWeatherLocation = getWeatherLocation;
  window.saveWeatherLocation = saveWeatherLocation;
  window.getWeatherCache = getWeatherCache;
  window.saveWeatherCache = saveWeatherCache;
  window.getWeatherViewMode = getWeatherViewMode;
  window.saveWeatherViewMode = saveWeatherViewMode;
  window.updateWeatherViewToggleUI = updateWeatherViewToggleUI;
  window.setWeatherViewMode = setWeatherViewMode;
  window.renderWeatherBody = renderWeatherBody;
  window.renderWeatherDays = renderWeatherDays;
  window.fetchWeather = fetchWeather;
  window.loadWeather = loadWeather;
  window.openWeatherLocationEditor = openWeatherLocationEditor;
  window.closeWeatherLocationEditor = closeWeatherLocationEditor;
  window.handleWeatherLocationKeydown = handleWeatherLocationKeydown;
  window.commitWeatherLocation = commitWeatherLocation;
})();
