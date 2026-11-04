/* ============================================================
   Academic subpage — extracted from academic-subpage.html's
   inline <script> block (Phase B reorg). Page-specific logic
   only; depends on js/core.js, js/weather-widget.js,
   js/spotify-widget.js, js/youtube-widget.js (load those first).
============================================================ */
  function openModal(id){
    document.getElementById(id).classList.add('open');
  }
  function closeModal(id){
    document.getElementById(id).classList.remove('open');
  }
  document.querySelectorAll('.modal-overlay').forEach(function(overlay){
    overlay.addEventListener('click', function(e){
      if(e.target === overlay){
        overlay.classList.remove('open');
      }
    });
  });
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){
      document.querySelectorAll('.modal-overlay.open').forEach(function(o){ o.classList.remove('open'); });
    }
  });

  /* ============================================================
     Apple Health Import (export.xml, chunk-streamed, string-matched)
  ============================================================ */
  var HEALTH_TYPE_LABELS = {
    HKQuantityTypeIdentifierStepCount: 'steps',
    HKCategoryTypeIdentifierSleepAnalysis: 'sleep records',
    HKQuantityTypeIdentifierHeartRateVariabilitySDNN: 'HRV',
    HKQuantityTypeIdentifierRestingHeartRate: 'resting heart rate',
    HKQuantityTypeIdentifierBodyMass: 'weight',
    HKQuantityTypeIdentifierVO2Max: 'VO2 max',
    HKQuantityTypeIdentifierActiveEnergyBurned: 'active energy',
    Workout: 'workouts'
  };
  var HEALTH_SUMMARY_META = [
    { key:'la_health_steps', label:'Steps', unit:'days' },
    { key:'la_health_sleep', label:'Sleep', unit:'nights' },
    { key:'la_health_hrv', label:'HRV', unit:'days' },
    { key:'la_health_rhr', label:'Resting Heart Rate', unit:'days' },
    { key:'la_health_weight', label:'Weight', unit:'entries' },
    { key:'la_health_vo2', label:'VO2 Max', unit:'entries' },
    { key:'la_health_calories', label:'Active Calories', unit:'days' },
    { key:'la_health_workouts', label:'Workouts', unit:'workouts' }
  ];
  var HEALTH_CHUNK_SIZE = 10 * 1024 * 1024;
  var HEALTH_TAG_RE = /<(Record|Workout)\b([^>]*)>/g;
  var healthImportState = null;

  function openImportModal(){
    resetImportModal();
    openModal('import-modal');
  }
  function closeImportModal(){
    closeModal('import-modal');
    if(typeof renderHealthCards === 'function') renderHealthCards();
  }
  function resetImportModal(){
    healthImportState = null;
    document.getElementById('import-dropzone').style.display = 'flex';
    document.getElementById('import-progress-section').style.display = 'none';
    document.getElementById('import-summary-section').style.display = 'none';
    document.getElementById('import-progress-fill').style.width = '0%';
    document.getElementById('import-status-text').textContent = 'Reading file...';
    document.getElementById('import-file-input').value = '';
  }

  (function initImportDropzone(){
    var dropzone = document.getElementById('import-dropzone');
    var fileInput = document.getElementById('import-file-input');
    if(!dropzone || !fileInput) return;
    fileInput.addEventListener('change', function(){
      if(fileInput.files && fileInput.files[0]) startHealthImport(fileInput.files[0]);
    });
    ['dragenter','dragover'].forEach(function(evt){
      dropzone.addEventListener(evt, function(e){
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave','drop'].forEach(function(evt){
      dropzone.addEventListener(evt, function(e){
        e.preventDefault(); e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', function(e){
      var files = e.dataTransfer && e.dataTransfer.files;
      if(files && files[0]) startHealthImport(files[0]);
    });
  })();

  function formatHealthBytes(bytes){
    if(bytes > 1024*1024) return (bytes/(1024*1024)).toFixed(1) + ' MB';
    if(bytes > 1024) return (bytes/1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }

  function startHealthImport(file){
    document.getElementById('import-dropzone').style.display = 'none';
    document.getElementById('import-progress-section').style.display = 'block';
    document.getElementById('import-filename').textContent = file.name + ' · ' + formatHealthBytes(file.size);

    healthImportState = {
      offset: 0,
      buffer: '',
      fileSize: file.size,
      lastLabel: '',
      steps: {}, calories: {}, hrv: {}, rhr: {}, weight: {}, vo2: {},
      sleep: {}, workouts: []
    };
    readHealthChunk(file);
  }

  function readHealthChunk(file){
    var st = healthImportState;
    if(!st) return;
    if(st.offset >= st.fileSize){ finishHealthImport(); return; }
    var slice = file.slice(st.offset, st.offset + HEALTH_CHUNK_SIZE);
    var reader = new FileReader();
    reader.onload = function(e){
      st.offset += slice.size;
      st.buffer += e.target.result;
      processHealthBuffer();
      var pct = Math.min(100, Math.round((st.offset / st.fileSize) * 100));
      var fill = document.getElementById('import-progress-fill');
      if(fill) fill.style.width = pct + '%';
      setTimeout(function(){ readHealthChunk(file); }, 0);
    };
    reader.readAsText(slice);
  }

  function processHealthBuffer(){
    var st = healthImportState;
    HEALTH_TAG_RE.lastIndex = 0;
    var match, lastEnd = 0;
    while((match = HEALTH_TAG_RE.exec(st.buffer)) !== null){
      var tagName = match[1];
      var attrStr = match[2];
      if(attrStr.charAt(attrStr.length - 1) === '/') attrStr = attrStr.slice(0, -1);
      var attrs = parseHealthAttrs(attrStr);
      if(tagName === 'Record') handleHealthRecord(attrs);
      else handleHealthWorkout(attrs);
      lastEnd = HEALTH_TAG_RE.lastIndex;
    }
    st.buffer = st.buffer.slice(lastEnd);
  }

  function parseHealthAttrs(str){
    var attrs = {};
    var re = /(\w+)="([^"]*)"/g;
    var m;
    while((m = re.exec(str)) !== null){ attrs[m[1]] = m[2]; }
    return attrs;
  }

  function healthDateStr(s){ return s ? s.slice(0,10) : ''; }
  function healthHour(s){ return s ? parseInt(s.slice(11,13), 10) : 0; }
  function healthAddDays(dateStr, n){
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0,10);
  }

  function setHealthStatus(type){
    var st = healthImportState;
    var label = HEALTH_TYPE_LABELS[type];
    if(!label || label === st.lastLabel) return;
    st.lastLabel = label;
    var el = document.getElementById('import-status-text');
    if(el) el.textContent = 'Parsing ' + label + '...';
  }

  function handleHealthRecord(attrs){
    var st = healthImportState;
    var type = attrs.type;
    if(!type || !attrs.startDate) return;
    var date = healthDateStr(attrs.startDate);
    var value = parseFloat(attrs.value);

    if(type === 'HKQuantityTypeIdentifierStepCount'){
      setHealthStatus(type);
      if(!isNaN(value)) st.steps[date] = (st.steps[date] || 0) + value;
    } else if(type === 'HKQuantityTypeIdentifierActiveEnergyBurned'){
      setHealthStatus(type);
      if(!isNaN(value)) st.calories[date] = (st.calories[date] || 0) + value;
    } else if(type === 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN'){
      setHealthStatus(type);
      if(!isNaN(value)){
        var h = st.hrv[date] || { sum:0, count:0 };
        h.sum += value; h.count++;
        st.hrv[date] = h;
      }
    } else if(type === 'HKQuantityTypeIdentifierRestingHeartRate'){
      setHealthStatus(type);
      if(!isNaN(value)) st.rhr[date] = value;
    } else if(type === 'HKQuantityTypeIdentifierBodyMass'){
      setHealthStatus(type);
      if(!isNaN(value)){
        var unit = attrs.unit || 'lb';
        var lb = unit.toLowerCase().indexOf('kg') !== -1 ? value * 2.20462 : value;
        st.weight[date] = lb;
      }
    } else if(type === 'HKQuantityTypeIdentifierVO2Max'){
      setHealthStatus(type);
      if(!isNaN(value)) st.vo2[date] = value;
    } else if(type === 'HKCategoryTypeIdentifierSleepAnalysis'){
      setHealthStatus(type);
      handleHealthSleep(attrs);
    }
  }

  function handleHealthSleep(attrs){
    var st = healthImportState;
    if(!attrs.startDate || !attrs.endDate) return;
    var startDate = attrs.startDate, endDate = attrs.endDate;
    var minutes = (new Date(endDate) - new Date(startDate)) / 60000;
    if(!isFinite(minutes) || minutes <= 0) return;
    var night = healthHour(startDate) >= 18 ? healthAddDays(healthDateStr(startDate), 1) : healthDateStr(startDate);
    var bucket = st.sleep[night] || { deep:0, rem:0, core:0, awake:0 };
    var value = attrs.value || '';
    if(value.indexOf('Deep') !== -1) bucket.deep += minutes;
    else if(value.indexOf('REM') !== -1) bucket.rem += minutes;
    else if(value.indexOf('Awake') !== -1) bucket.awake += minutes;
    else if(value.indexOf('Core') !== -1 || value.indexOf('Asleep') !== -1) bucket.core += minutes;
    st.sleep[night] = bucket;
  }

  function handleHealthWorkout(attrs){
    var st = healthImportState;
    if(!attrs.startDate) return;
    setHealthStatus('Workout');
    var type = (attrs.workoutActivityType || 'Workout').replace(/^HKWorkoutActivityType/, '').replace(/([A-Z])/g, ' $1').trim();
    var distance = parseFloat(attrs.totalDistance);
    var calories = parseFloat(attrs.totalEnergyBurned);
    var duration = parseFloat(attrs.duration);
    st.workouts.push({
      date: healthDateStr(attrs.startDate),
      type: type || 'Workout',
      duration: isNaN(duration) ? 0 : duration,
      calories: isNaN(calories) ? 0 : calories,
      distance: isNaN(distance) ? 0 : distance
    });
  }

  function finishHealthImport(){
    var st = healthImportState;
    if(!st) return;

    var stepsArr = Object.keys(st.steps).sort().map(function(d){ return { date:d, steps:Math.round(st.steps[d]) }; });
    var caloriesArr = Object.keys(st.calories).sort().map(function(d){ return { date:d, calories:Math.round(st.calories[d]) }; });
    var hrvArr = Object.keys(st.hrv).sort().map(function(d){ var h = st.hrv[d]; return { date:d, value: Math.round((h.sum / h.count) * 10) / 10 }; });
    var rhrArr = Object.keys(st.rhr).sort().map(function(d){ return { date:d, value: Math.round(st.rhr[d]) }; });
    var weightArr = Object.keys(st.weight).sort().map(function(d){ return { date:d, value: Math.round(st.weight[d] * 10) / 10, unit:'lb' }; });
    var vo2Arr = Object.keys(st.vo2).sort().map(function(d){ return { date:d, value: Math.round(st.vo2[d] * 10) / 10 }; });
    var sleepArr = Object.keys(st.sleep).sort().map(function(d){
      var b = st.sleep[d];
      return {
        date:d,
        totalMinutes: Math.round(b.deep + b.rem + b.core),
        deep: Math.round(b.deep), rem: Math.round(b.rem), core: Math.round(b.core), awake: Math.round(b.awake)
      };
    });
    var workoutsArr = st.workouts.slice().sort(function(a,b){ return a.date < b.date ? 1 : -1; });

    localStorage.setItem('la_health_steps', JSON.stringify(stepsArr));
    localStorage.setItem('la_health_sleep', JSON.stringify(sleepArr));
    localStorage.setItem('la_health_hrv', JSON.stringify(hrvArr));
    localStorage.setItem('la_health_rhr', JSON.stringify(rhrArr));
    localStorage.setItem('la_health_weight', JSON.stringify(weightArr));
    localStorage.setItem('la_health_vo2', JSON.stringify(vo2Arr));
    localStorage.setItem('la_health_calories', JSON.stringify(caloriesArr));
    localStorage.setItem('la_health_workouts', JSON.stringify(workoutsArr));

    showHealthImportSummary({
      la_health_steps: stepsArr.length,
      la_health_sleep: sleepArr.length,
      la_health_hrv: hrvArr.length,
      la_health_rhr: rhrArr.length,
      la_health_weight: weightArr.length,
      la_health_vo2: vo2Arr.length,
      la_health_calories: caloriesArr.length,
      la_health_workouts: workoutsArr.length
    });
    healthImportState = null;
  }

  function showHealthImportSummary(counts){
    document.getElementById('import-progress-section').style.display = 'none';
    var list = document.getElementById('import-summary-list');
    list.innerHTML = '';
    HEALTH_SUMMARY_META.forEach(function(meta){
      var row = document.createElement('div');
      row.className = 'import-summary-row';
      row.innerHTML = '<span class="name"><span class="material-symbols-outlined">check_circle</span>' + meta.label + '</span>' +
        '<span class="count mono">' + (counts[meta.key] || 0) + ' ' + meta.unit + '</span>';
      list.appendChild(row);
    });
    document.getElementById('import-summary-section').style.display = 'block';
  }

  /* ============================================================
     Storage / date helpers
     (loadJSON/saveJSON/uid/escapeHtml/escapeAttr/syncData/
     triggerImportData/handleImportFileSelected/isLateNightWindow/
     getAdjustedDate/notifyStateChange now live in js/core.js)
  ============================================================ */

  function todayISO(){
    /* Deliberately NOT aliased to getAdjustedDate() here — on this
       page, Deadlines' "Due Today"/"Overdue" status should flip at
       real midnight, unlike Habits/Lab Tasks (and
       unlike index.html's Academic card, which still uses the
       5AM-adjusted date). This is an intentional divergence from
       index.html, not an oversight. */
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function daysBetween(dueISO){
    var due = new Date(dueISO + 'T00:00:00');
    var today = new Date(todayISO() + 'T00:00:00');
    return Math.round((due - today) / 86400000);
  }
  function daysBetweenAdjusted(dueISO){
    var due = new Date(dueISO + 'T00:00:00');
    var today = new Date(getAdjustedDate() + 'T00:00:00');
    return Math.round((due - today) / 86400000);
  }
  function formatDateHuman(iso){
    if(!iso) return '—';
    var d = new Date(iso + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate();
  }
  function computeStatus(dueISO){
    if(!dueISO) return { text:'No date', cls:'status-normal' };
    var diff = daysBetween(dueISO);
    if(diff < 0) return { text:'Overdue', cls:'status-overdue' };
    if(diff === 0) return { text:'Due Today', cls:'status-today' };
    return { text: diff + (diff === 1 ? ' day' : ' days'), cls:'status-normal' };
  }

  /* ============================================================
     Areas (shared tag list — synced with index.html)
  ============================================================ */
  var AREA_PALETTE = [
    {bg:'rgba(74,222,128,0.16)', fg:'#86efac'},
    {bg:'rgba(96,165,250,0.16)', fg:'#93c5fd'},
    {bg:'rgba(251,146,60,0.16)', fg:'#fdba74'},
    {bg:'rgba(192,132,252,0.16)', fg:'#d8b4fe'},
    {bg:'rgba(34,211,238,0.16)', fg:'#67e8f9'},
    {bg:'rgba(248,113,113,0.16)', fg:'#fca5a5'},
    {bg:'rgba(250,204,21,0.16)', fg:'#fde047'}
  ];
  function getAreaColors(){ return loadJSON('la_area_colors', {}); }
  function saveAreaColors(map){ saveJSON('la_area_colors', map); }
  function setAreaColor(name, hex){
    var map = getAreaColors();
    if(hex){ map[name] = hex; } else { delete map[name]; }
    saveAreaColors(map);
  }
  function habitColorRgba(hex, alpha){
    var h = (hex || '#4ade80').replace('#','');
    if(h.length === 3){ h = h.split('').map(function(c){ return c+c; }).join(''); }
    var r = parseInt(h.substring(0,2),16);
    var g = parseInt(h.substring(2,4),16);
    var b = parseInt(h.substring(4,6),16);
    return 'rgba('+r+','+g+','+b+','+alpha+')';
  }
  function areaColor(name){
    var custom = getAreaColors()[name];
    if(custom){ return { bg: habitColorRgba(custom, 0.16), fg: custom }; }
    var hash = 0;
    for(var i=0;i<name.length;i++){ hash = (hash*31 + name.charCodeAt(i)) >>> 0; }
    return AREA_PALETTE[hash % AREA_PALETTE.length];
  }
  function getAreas(){ return loadJSON('la_areas', ['Micro','Eco','PCS']); }
  function saveAreas(list){ saveJSON('la_areas', list); }
  function addArea(name){
    name = name.trim();
    if(!name) return;
    var areas = getAreas();
    if(areas.indexOf(name) === -1){ areas.push(name); saveAreas(areas); }
  }
  function removeArea(name){
    saveAreas(getAreas().filter(function(a){ return a !== name; }));
    setAreaColor(name, null);
  }

  /* ============================================================
     Deadlines task manager — la_deadlines (shared with index.html)
  ============================================================ */
  var currentDeadlineId = null;
  var currentDeadlineArea = null;
  var selectedDeadlineDays = [];
  var deadlineFilters = { dueSort:'asc', importance:'All', type:'All', area:'All' };

  function getDeadlines(){ return loadJSON('la_deadlines', []); }
  function saveDeadlines(list){ saveJSON('la_deadlines', list); }

  function applyDeadlineFilters(){
    deadlineFilters.dueSort = document.getElementById('filter-due-sort').value;
    deadlineFilters.importance = document.getElementById('filter-importance').value;
    deadlineFilters.type = document.getElementById('filter-type').value;
    deadlineFilters.area = document.getElementById('filter-area').value;
    renderDeadlinesTable();
  }

  function toggleDeadlineFilters(){
    document.getElementById('deadline-filter-bar').classList.toggle('open');
  }

  function renderDeadlineAreaFilterOptions(){
    var select = document.getElementById('filter-area');
    if(!select) return;
    var current = deadlineFilters.area || 'All';
    var areas = getAreas();
    if(current !== 'All' && areas.indexOf(current) === -1){ current = deadlineFilters.area = 'All'; }
    select.innerHTML = '<option value="All">All</option>' +
      areas.map(function(a){ return '<option value="'+escapeAttr(a)+'"'+(a === current ? ' selected' : '')+'>'+escapeHtml(a)+'</option>'; }).join('');
  }

  function renderDeadlinesTable(){
    var all = getDeadlines();
    var tasks = all.slice();
    if(deadlineFilters.importance !== 'All'){
      tasks = tasks.filter(function(t){ return (t.importance || 'Low') === deadlineFilters.importance; });
    }
    if(deadlineFilters.type !== 'All'){
      tasks = tasks.filter(function(t){ return (t.type || 'Asynch') === deadlineFilters.type; });
    }
    if(deadlineFilters.area !== 'All'){
      tasks = tasks.filter(function(t){
        var areaVal = Array.isArray(t.areas) ? (t.areas[0] || '') : (t.areas || '');
        return areaVal === deadlineFilters.area;
      });
    }
    tasks.sort(function(a,b){
      var da = a.due || '9999-99-99', db = b.due || '9999-99-99';
      if(deadlineFilters.dueSort === 'desc') return da < db ? 1 : -1;
      return da < db ? -1 : 1;
    });
    var tbody = document.getElementById('deadlines-tbody');
    renderDeadlineAreaFilterOptions();
    if(tasks.length === 0){
      var msg = all.length === 0 ? 'No deadlines yet' : 'No matching tasks';
      tbody.innerHTML = '<tr class="empty-row"><td colspan="7"><span class="material-symbols-outlined">event_available</span>'+msg+'</td></tr>';
      return;
    }
    tbody.innerHTML = tasks.map(function(t){
      var status = computeStatus(t.due);
      var areaVal = Array.isArray(t.areas) ? (t.areas[0] || '') : (t.areas || '');
      var areaChips = areaVal ? '<span class="area-chip" style="background:'+areaColor(areaVal).bg+'; color:'+areaColor(areaVal).fg+';">'+escapeHtml(areaVal)+'</span>' : '';
      return '<tr onclick="openDeadlineModal(\''+t.id+'\')" style="cursor:pointer;">' +
        '<td class="checkbox-col" onclick="event.stopPropagation();"><input type="checkbox" class="task-checkbox" onclick="deleteDeadlineImmediate(\''+t.id+'\')"></td>' +
        '<td><span class="task-cell"><span class="name">'+escapeHtml(t.name || 'Untitled')+'</span></span></td>' +
        '<td><div class="chip-row">'+ (areaChips || '<span class="due-placeholder">—</span>') +'</div></td>' +
        '<td>'+ formatDateHuman(t.due) +'</td>' +
        '<td><span class="'+status.cls+'">'+status.text+'</span></td>' +
        '<td><span class="importance-badge imp-'+ (t.importance || 'Low').toLowerCase() +'">'+ (t.importance || 'Low') +'</span></td>' +
        '<td><span class="type-badge type-'+ (t.type || 'Asynch').toLowerCase() +'">'+ (t.type || 'Asynch') +'</span></td>' +
      '</tr>';
    }).join('');
  }

  function deleteDeadlineImmediate(id){
    saveDeadlines(getDeadlines().filter(function(t){ return t.id !== id; }));
    renderDeadlinesTable();
  }

  /* ============================================================
     Deadlines table — draggable column widths (Task/Areas/Due/
     Status/Importance/Type). table-layout:fixed makes each <th>'s
     inline width authoritative; widths are independent per-column
     (no "push the neighbor" behavior), so widening one column past
     the card's edge grows the table itself and .table-scroll picks
     up a horizontal scrollbar instead of anything wrapping/breaking.
     Initial widths are seeded proportionally per DEADLINES_COL_RATIOS
     rather than split evenly; dragging still works freely from there.
     Status previously got a disproportionate 3/12 share (it doesn't
     need nearly that much once its own reduced .col-resizable padding
     is factored in) while Importance — the longest header label, with
     a badge that has its own internal padding on top — was squeezed
     to the same 1/12 share as short columns like Type, truncating
     into an ellipsis at typical widths. Rebalanced so Status gives up
     some of that share to Importance. */
  var DEADLINES_COL_MIN = 10;
  var DEADLINES_CHECKBOX_COL_WIDTH = 32;
  var DEADLINES_COL_RATIOS = [4, 1, 1, 2, 2, 1]; // Task, Areas, Due, Status, Importance, Type

  /* A <table width:auto> still fills its containing block like any
     other auto-width block box — table-layout:fixed does NOT make it
     shrink/grow to its columns' actual widths on its own. Without an
     explicit table width, the browser silently redistributes our
     per-column pixel widths proportionally to keep the total pinned
     at the container's width, so widening one column visibly shrinks
     the others instead of growing the table. Setting the table's own
     width to the true sum of its column widths is what lets it
     genuinely exceed .table-scroll's width and trigger a scrollbar. */
  function updateDeadlinesTableWidth(table, resizableThs){
    var sum = DEADLINES_CHECKBOX_COL_WIDTH;
    resizableThs.forEach(function(th){
      sum += parseFloat(th.style.width) || th.getBoundingClientRect().width;
    });
    table.style.width = sum + 'px';
  }

  function initDeadlinesColumnResize(){
    var table = document.getElementById('deadlines-table');
    if(!table) return;
    var scrollWrap = table.closest('.table-scroll');
    var card = table.closest('.deadlines-card');
    var resizableThs = Array.prototype.slice.call(table.querySelectorAll('th.col-resizable'));
    if(!resizableThs.length || !scrollWrap || !card) return;

    var available = scrollWrap.clientWidth - DEADLINES_CHECKBOX_COL_WIDTH;
    var ratioTotal = DEADLINES_COL_RATIOS.reduce(function(a, b){ return a + b; }, 0);
    resizableThs.forEach(function(th, i){
      var ratio = DEADLINES_COL_RATIOS[i] || 1;
      var widthPx = Math.max(DEADLINES_COL_MIN, Math.floor(available * ratio / ratioTotal));
      th.style.width = widthPx + 'px';
    });
    updateDeadlinesTableWidth(table, resizableThs);

    resizableThs.forEach(function(th){
      var handle = th.querySelector('.col-resize-handle');
      if(!handle) return;

      handle.addEventListener('mousedown', function(e){
        e.preventDefault();
        var startX = e.clientX;
        var startWidth = th.getBoundingClientRect().width;
        var maxWidth = card.getBoundingClientRect().width;
        handle.classList.add('dragging');

        function onMouseMove(e2){
          var delta = e2.clientX - startX;
          var newWidth = Math.min(maxWidth, Math.max(DEADLINES_COL_MIN, startWidth + delta));
          th.style.width = newWidth + 'px';
          updateDeadlinesTableWidth(table, resizableThs);
        }
        function onMouseUp(){
          handle.classList.remove('dragging');
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        }
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  function toggleRecurrenceFields(){
    var freq = document.getElementById('deadline-frequency').value;
    document.getElementById('recurrence-dates-group').classList.toggle('show', freq !== 'none');
    document.getElementById('deadline-custom-days-group').classList.toggle('show', freq === 'custom');
    document.getElementById('deadline-due-group').style.display = freq === 'custom' ? 'none' : '';
  }

  function renderDeadlineDaysRow(){
    var labels = ['M','T','W','T','F','S','S'];
    var dows =   [1,2,3,4,5,6,0];
    var row = document.getElementById('deadline-custom-days-row');
    row.innerHTML = dows.map(function(dow, i){
      var active = selectedDeadlineDays.indexOf(dow) !== -1;
      return '<button type="button" class="habit-day-btn'+(active ? ' active' : '')+'" onclick="toggleDeadlineDay('+dow+')">'+labels[i]+'</button>';
    }).join('');
  }
  function toggleDeadlineDay(dow){
    var idx = selectedDeadlineDays.indexOf(dow);
    if(idx === -1){ selectedDeadlineDays.push(dow); } else { selectedDeadlineDays.splice(idx, 1); }
    renderDeadlineDaysRow();
  }

  function showDeadlineFormError(msg){
    var el = document.getElementById('deadline-form-error');
    if(!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }
  function clearDeadlineFormError(){
    var el = document.getElementById('deadline-form-error');
    if(!el) return;
    el.style.display = 'none';
    el.textContent = '';
  }

  function openDeadlineModal(id){
    currentDeadlineId = id || null;
    clearDeadlineFormError();
    var deleteBtn = document.getElementById('deadline-delete-btn');
    deleteBtn.closest('.modal-actions-row').classList.toggle('has-delete', !!id);
    if(id){
      var task = getDeadlines().find(function(t){ return t.id === id; });
      document.getElementById('deadline-modal-title').textContent = 'Edit Task';
      deleteBtn.style.display = 'inline-block';
      document.getElementById('deadline-name').value = task.name || '';
      document.getElementById('deadline-due').value = task.due || '';
      document.getElementById('deadline-importance').value = task.importance || 'Low';
      document.getElementById('deadline-type').value = task.type || 'Asynch';
      document.getElementById('deadline-frequency').value = task.frequency || 'none';
      document.getElementById('deadline-start-date').value = task.startDate || '';
      document.getElementById('deadline-end-date').value = task.endDate || '';
      currentDeadlineArea = Array.isArray(task.areas) ? (task.areas[0] || null) : (task.areas || null);
      selectedDeadlineDays = (task.customDays || []).slice();
    } else {
      document.getElementById('deadline-modal-title').textContent = 'New Task';
      deleteBtn.style.display = 'none';
      document.getElementById('deadline-name').value = '';
      document.getElementById('deadline-due').value = '';
      document.getElementById('deadline-importance').value = 'Low';
      document.getElementById('deadline-type').value = 'Asynch';
      document.getElementById('deadline-frequency').value = 'none';
      document.getElementById('deadline-start-date').value = '';
      document.getElementById('deadline-end-date').value = '';
      currentDeadlineArea = null;
      selectedDeadlineDays = [];
    }
    toggleRecurrenceFields();
    renderDeadlineDaysRow();
    document.getElementById('deadline-area-input').value = '';
    document.getElementById('manage-areas-panel').style.display = 'none';
    renderDeadlineAreaChips();
    openModal('deadline-modal');
  }

  function renderDeadlineAreaChips(){
    var selectedWrap = document.getElementById('deadline-selected-areas');
    if(currentDeadlineArea){
      var c = areaColor(currentDeadlineArea);
      selectedWrap.innerHTML = '<span class="chip" style="background:'+c.bg+'; color:'+c.fg+';">'+escapeHtml(currentDeadlineArea)+' <span class="remove-x" onclick="removeSelectedArea()">&times;</span></span>';
    } else {
      selectedWrap.innerHTML = '<span class="due-placeholder" style="font-size:0.62rem;">No area selected</span>';
    }

    var suggWrap = document.getElementById('deadline-area-suggestions');
    var allAreas = getAreas().filter(function(a){ return a !== currentDeadlineArea; });
    suggWrap.innerHTML = allAreas.map(function(a){
      return '<span class="chip suggestion" onclick="addSelectedArea(\''+encodeURIComponent(a)+'\')">'+escapeHtml(a)+'</span>';
    }).join('');

    renderManageAreasList();
  }

  function addSelectedArea(encoded){
    currentDeadlineArea = decodeURIComponent(encoded);
    renderDeadlineAreaChips();
  }
  function removeSelectedArea(){
    currentDeadlineArea = null;
    renderDeadlineAreaChips();
  }

  function handleAreaInputKey(e){
    if(e.key === 'Enter' || e.key === ','){
      e.preventDefault();
      var input = document.getElementById('deadline-area-input');
      var name = input.value.trim().replace(/,$/,'');
      if(name){
        addArea(name);
        currentDeadlineArea = name;
        input.value = '';
        renderDeadlineAreaChips();
        renderDeadlineAreaFilterOptions();
      }
    }
  }

  function toggleManageAreas(){
    var panel = document.getElementById('manage-areas-panel');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    renderManageAreasList();
  }

  function renderManageAreasList(){
    var panel = document.getElementById('manage-areas-panel');
    if(panel.style.display === 'none') return;
    var areas = getAreas();
    panel.innerHTML = areas.length ? areas.map(function(a){
      var c = areaColor(a);
      return '<div class="manage-area-row">' +
          '<span style="color:'+c.fg+';">'+escapeHtml(a)+'</span>' +
          '<span class="manage-area-actions">' +
            '<input type="color" class="manage-area-color-input" value="'+c.fg+'" onchange="changeAreaColor(\''+encodeURIComponent(a)+'\', this.value)" title="Change color for '+escapeAttr(a)+'">' +
            '<span class="del-x" onclick="deleteAreaTag(\''+encodeURIComponent(a)+'\')">&times;</span>' +
          '</span>' +
        '</div>';
    }).join('') : '<div class="manage-area-row"><span style="color:var(--ink-faint);">No saved areas</span></div>';
  }

  function changeAreaColor(encoded, hex){
    var name = decodeURIComponent(encoded);
    setAreaColor(name, hex);
    renderDeadlineAreaChips();
    renderDeadlinesTable();
  }

  function deleteAreaTag(encoded){
    var name = decodeURIComponent(encoded);
    removeArea(name);
    if(currentDeadlineArea === name) currentDeadlineArea = null;
    renderDeadlineAreaChips();
    renderDeadlinesTable();
  }

  function nextOccurrenceDate(dueISO, frequency){
    if(frequency === 'daily') return addDaysISO(dueISO, 1);
    if(frequency === 'weekly') return addDaysISO(dueISO, 7);
    if(frequency === 'biweekly') return addDaysISO(dueISO, 14);
    if(frequency === 'monthly'){
      var d = new Date(dueISO + 'T00:00:00');
      d.setMonth(d.getMonth() + 1);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    return dueISO;
  }

  function generateRecurringInstances(base, frequency, startDate, endDate, customDays){
    var recurrenceId = uid();
    var instances = [];
    var maxInstances = endDate ? 60 : 24;

    if(frequency === 'custom' && customDays && customDays.length){
      var cursor = startDate;
      var scanGuard = 0;
      while(instances.length < maxInstances && scanGuard < 400){
        if(endDate && cursor > endDate) break;
        var dow = new Date(cursor + 'T00:00:00').getDay();
        if(customDays.indexOf(dow) !== -1){
          instances.push(Object.assign({}, base, {
            id: uid(),
            due: cursor,
            frequency: frequency,
            startDate: startDate,
            endDate: endDate || null,
            customDays: customDays.slice(),
            recurring: true,
            recurrenceId: recurrenceId
          }));
        }
        cursor = addDaysISO(cursor, 1);
        scanGuard++;
      }
      return instances;
    }

    var due = startDate;
    for(var i = 0; i < maxInstances; i++){
      if(endDate && due > endDate) break;
      instances.push(Object.assign({}, base, {
        id: uid(),
        due: due,
        frequency: frequency,
        startDate: startDate,
        endDate: endDate || null,
        recurring: true,
        recurrenceId: recurrenceId
      }));
      due = nextOccurrenceDate(due, frequency);
    }
    return instances;
  }

  function saveDeadlineForm(){
    var nameEl = document.getElementById('deadline-name');
    var name = nameEl.value.trim();
    var due = document.getElementById('deadline-due').value;
    var importance = document.getElementById('deadline-importance').value;
    var type = document.getElementById('deadline-type').value;
    var frequency = document.getElementById('deadline-frequency').value;
    var startDateEl = document.getElementById('deadline-start-date');
    var startDate = startDateEl.value;
    var endDate = document.getElementById('deadline-end-date').value;
    var customDays = selectedDeadlineDays.slice();

    // Every field required for this configuration to actually produce a
    // usable event is checked here up front — Save is blocked with a
    // visible error instead of silently falling back to a broken,
    // dateless task (the historical "Custom frequency" bug: picking
    // Repeat On days without also filling Start Date used to silently
    // create a single no-date entry rather than the intended series).
    var errors = [];
    var focusEl = null;
    if(!name){
      errors.push('Task Name is required.');
      focusEl = focusEl || nameEl;
    }
    if(frequency !== 'none' && !startDate){
      errors.push('Start Date is required when a repeat Frequency is selected.');
      focusEl = focusEl || startDateEl;
    }
    if(frequency === 'custom' && customDays.length === 0){
      errors.push('Pick at least one day under "Repeat On" for a Custom frequency.');
    }
    if(errors.length){
      showDeadlineFormError(errors.join(' '));
      if(focusEl) focusEl.focus();
      return;
    }
    clearDeadlineFormError();

    var canRecur = frequency !== 'none' && !!startDate && (frequency !== 'custom' || customDays.length > 0);
    var tasks = getDeadlines();
    if(currentDeadlineId){
      var idx = tasks.findIndex(function(t){ return t.id === currentDeadlineId; });
      if(idx > -1){
        var existing = tasks[idx];
        if(frequency === 'custom' && canRecur && !existing.recurrenceId){
          // Turning a plain (not-yet-expanded) task into a Custom recurring
          // series: replace it with one freshly generated entry per matching
          // occurrence, rather than overwriting it as a single dateless task.
          // Tasks that are already one occurrence of an existing series
          // (recurrenceId set) fall through to the in-place edit below, so
          // editing a single occurrence doesn't regenerate/duplicate the
          // whole series.
          tasks.splice(idx, 1);
          var base = { name: name, areas: currentDeadlineArea, importance: importance, type: type };
          tasks = tasks.concat(generateRecurringInstances(base, frequency, startDate, endDate || null, customDays));
        } else {
          tasks[idx] = {
            id: currentDeadlineId, name: name, areas: currentDeadlineArea, due: due,
            importance: importance, type: type, frequency: frequency,
            startDate: startDate || null, endDate: endDate || null,
            customDays: frequency === 'custom' ? customDays : [],
            recurring: canRecur,
            recurrenceId: existing.recurrenceId || null
          };
        }
      }
    } else if(canRecur){
      var base = { name: name, areas: currentDeadlineArea, importance: importance, type: type };
      tasks = tasks.concat(generateRecurringInstances(base, frequency, startDate, endDate || null, customDays));
    } else {
      tasks.push({ id: uid(), name: name, areas: currentDeadlineArea, due: due, importance: importance, type: type, frequency:'none', recurring:false });
    }
    saveDeadlines(tasks);
    renderDeadlinesTable();
    closeModal('deadline-modal');
  }

  function deleteDeadlineCurrent(){
    if(!currentDeadlineId) return;
    saveDeadlines(getDeadlines().filter(function(t){ return t.id !== currentDeadlineId; }));
    renderDeadlinesTable();
    closeModal('deadline-modal');
  }

  /* ============================================================
     Lab task lists (Kranker / Ballard) — la_kranker_tasks / la_ballard_tasks
  ============================================================ */
  function getLabTasks(lab){ return loadJSON('la_' + lab + '_tasks', []); }
  function saveLabTasks(lab, list){ saveJSON('la_' + lab + '_tasks', list); }

  function rolloverOverdueLabTasks(lab){
    /* No longer bumps overdue tasks' `due` to today — la_kranker_tasks/
       la_ballard_tasks are shared with index.html's wheel (research
       slice needs real due dates to compute an accurate backlog), so
       this file must not silently rewrite them either. See the
       matching fix + comment in index.html for the full rationale. */
    return getLabTasks(lab);
  }

  function autoGrowTaskInput(el){
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function renderLabTasks(lab){
    var list = rolloverOverdueLabTasks(lab);
    var ul = document.getElementById(lab + '-task-list');
    ul.innerHTML = list.map(function(task){
      var dueSoon = task.due && daysBetweenAdjusted(task.due) >= 0 && daysBetweenAdjusted(task.due) <= 1;
      return '<li class="lab-task-row'+ (dueSoon ? ' due-soon' : '') +'">' +
        '<input type="checkbox" class="task-checkbox" onclick="deleteLabTask(\''+lab+'\',\''+task.id+'\')">' +
        '<textarea class="task-text-input" rows="1" placeholder="Task description" oninput="autoGrowTaskInput(this); updateLabTaskField(\''+lab+'\',\''+task.id+'\',\'text\',this.value)">'+ escapeHtml(task.text) +'</textarea>' +
        '<input type="date" class="task-date-input" value="'+ (task.due || '') +'" onchange="updateLabTaskField(\''+lab+'\',\''+task.id+'\',\'due\',this.value)">' +
      '</li>';
    }).join('');
    document.querySelectorAll('#'+lab+'-task-list .task-text-input').forEach(autoGrowTaskInput);
    renderLabDueSoonest(lab);
  }

  function addLabTask(lab){
    var list = getLabTasks(lab);
    list.push({ id: uid(), text:'', due:'' });
    saveLabTasks(lab, list);
    renderLabTasks(lab);
    var inputs = document.querySelectorAll('#'+lab+'-task-list .task-text-input');
    if(inputs.length) inputs[inputs.length-1].focus();
  }

  function updateLabTaskField(lab, id, field, value){
    var list = getLabTasks(lab);
    var task = list.find(function(t){ return t.id === id; });
    if(task){
      task[field] = value;
      saveLabTasks(lab, list);
      /* Due-date edits change which rows qualify for the 1-day-out
         due-soon highlight, so they need the full row re-render (safe
         here since onchange only fires once the date picker commits —
         unlike the text field's oninput, a full rebuild won't steal
         keystroke focus). Text edits keep the lighter due-soonest-only
         update to avoid disrupting typing. */
      if(field === 'due'){ renderLabTasks(lab); }
      else { renderLabDueSoonest(lab); }
    }
  }

  function deleteLabTask(lab, id){
    saveLabTasks(lab, getLabTasks(lab).filter(function(t){ return t.id !== id; }));
    renderLabTasks(lab);
  }

  function renderLabDueSoonest(lab){
    var list = getLabTasks(lab).filter(function(t){ return t.due; });
    var el = document.getElementById(lab + '-due-soonest');
    if(!list.length){ el.textContent = '—'; return; }
    list.sort(function(a,b){ return a.due < b.due ? -1 : 1; });
    el.textContent = 'Due ' + formatDateHuman(list[0].due);
  }

  function saveLabStatus(lab, value){ saveJSON('la_' + lab + '_status', value); }
  function loadLabStatus(lab){
    document.getElementById(lab + '-status').value = loadJSON('la_' + lab + '_status', 'on-track');
  }

  /* ============================================================
     Manual weekly hours counters — la_kranker_hours / la_ballard_hours
  ============================================================ */
  function getLabHours(lab){ return parseFloat(loadJSON('la_' + lab + '_hours', 0)) || 0; }
  function saveLabHoursValue(lab, val){ saveJSON('la_' + lab + '_hours', val); }
  function adjustLabHours(lab, delta){
    var val = getLabHours(lab) + delta;
    if(val < 0) val = 0;
    val = Math.round(val * 10) / 10;
    saveLabHoursValue(lab, val);
    renderLabHours(lab);
  }
  function resetLabHours(lab){
    saveLabHoursValue(lab, 0);
    renderLabHours(lab);
  }
  function renderLabHours(lab){
    var val = getLabHours(lab);
    document.getElementById(lab + '-hours-value').textContent = val.toFixed(1) + ' hrs';
    var input = document.getElementById(lab + '-hours-input');
    if(input) input.value = val.toFixed(1);
  }
  function editLabHours(lab){
    var valueEl = document.getElementById(lab + '-hours-value');
    var input = document.getElementById(lab + '-hours-input');
    valueEl.style.display = 'none';
    input.style.display = '';
    input.value = getLabHours(lab).toFixed(1);
    input.focus();
    input.select();
  }
  function saveLabHoursText(lab, value){
    var valueEl = document.getElementById(lab + '-hours-value');
    var input = document.getElementById(lab + '-hours-input');
    var v = parseFloat(value);
    if(isNaN(v) || v < 0) v = getLabHours(lab);
    v = Math.round(v * 10) / 10;
    saveLabHoursValue(lab, v);
    input.style.display = 'none';
    valueEl.style.display = '';
    renderLabHours(lab);
  }

  /* Pomodoro/Study-Streak/Important-Tasks/Today-Focus removed from
     academic-subpage.html (see the Phase 2 rebuild) — those cards no
     longer render here, and index.html has its own separate wheel-
     based system now. */

  function addDaysISO(iso, delta){
    var d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function getPreviousProductivityDate(){
    return addDaysISO(getAdjustedDate(), -1);
  }
  function isNightCheckinMissed(){
    var prevDate = getPreviousProductivityDate();
    if(localStorage.getItem('la_checkin_night_' + prevDate)) return false;
    if(localStorage.getItem('la_night_checkin_prompted_' + prevDate)) return false;
    return true;
  }
  function maybeRedirectForNightCheckin(){
    if(isNightCheckinMissed()){ window.location.href = '../index.html'; }
  }
  /* ============================================================
     Cross-page live sync. handleStorageSync is the single source of
     truth for "what to re-render when key X changes" — it's wired to
     the native `storage` event (fires in OTHER tabs only, never the
     tab that made the change) AND to a local `state-change` CustomEvent
     dispatched by notifyStateChange(), so same-tab mutations (e.g. the
     Morning/Night modal save) get the identical re-render treatment
     instantly, without waiting for a refresh.
  ============================================================ */
  function handleStorageSync(e){
    /* Study-Streak/Weekly-Goal/Pomodoro/Important-Tasks branches
       removed along with those cards (see the Phase 2 rebuild). */
    if(e.key === 'la_deadlines'){ renderDeadlinesTable(); }
    else if(e.key === 'la_kranker_tasks'){ renderLabTasks('kranker'); }
    else if(e.key === 'la_ballard_tasks'){ renderLabTasks('ballard'); }
    else if(e.key === 'la_kranker_hours'){ renderLabHours('kranker'); }
    else if(e.key === 'la_ballard_hours'){ renderLabHours('ballard'); }
    else if(e.key === 'la_kranker_status'){ loadLabStatus('kranker'); }
    else if(e.key === 'la_ballard_status'){ loadLabStatus('ballard'); }
    else if(e.key === 'la_areas'){
      if(document.getElementById('deadline-modal').classList.contains('open')){ renderDeadlineAreaChips(); }
    }
  }
  window.addEventListener('storage', handleStorageSync);
  window.addEventListener('state-change', function(e){ handleStorageSync({ key: e.detail.key }); });

  /* ============================================================
     Late night mode — 12AM-5AM amber tint on "yesterday" elements
  ============================================================ */
  function updateLateNightMode(){
    document.body.classList.toggle('late-night', isLateNightWindow());
  }

  function runClockTick(){
    updateLateNightMode();
    checkDailyReset();
    maybeRedirectForNightCheckin();
  }

  /* ============================================================
     Daily reset at 5AM — refresh check-in badges and nutrition
     entry for the new day. Only fires once per adjusted day
     (la_last_reset_date, 5AM-adjusted YYYY-MM-DD).
  ============================================================ */
  function clearTodayNutritionEntry(){
    var cfg = loadJSON('la_nutrition', null);
    if(cfg && cfg.entries && cfg.entries[getAdjustedDate()] !== undefined){
      delete cfg.entries[getAdjustedDate()];
      saveJSON('la_nutrition', cfg);
    }
  }

  function performDailyReset(){
    clearTodayNutritionEntry();
    if(typeof renderMoodCard === 'function'){ renderMoodCard(); }
    if(typeof renderSplitPlanner === 'function'){ renderSplitPlanner(); }
    if(typeof renderSplitCalendar === 'function'){ renderSplitCalendar(); }
    if(typeof renderNutritionCard === 'function'){ renderNutritionCard(); }
  }

  function checkDailyReset(){
    var adjusted = getAdjustedDate();
    var last = localStorage.getItem('la_last_reset_date');
    if(last !== adjusted){
      performDailyReset();
      localStorage.setItem('la_last_reset_date', adjusted);
    }
  }

  /* ============================================================
     Sidebar live date/time
  ============================================================ */
  function updateSidebarDateTime(){
    var el = document.getElementById('sidebar-datetime');
    if(!el) return;
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var now = new Date();
    var hours = now.getHours();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    var h12 = hours % 12 || 12;
    var mins = now.getMinutes();
    var minStr = mins < 10 ? '0' + mins : '' + mins;
    el.textContent = days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate() +
      '  ·  ' + h12 + ':' + minStr + ' ' + ampm;
  }

  /* ============================================================
     Weather mini card — now lives in js/weather-widget.js
  ============================================================ */

  /* ============================================================
     Spotify mini card — now lives in js/spotify-widget.js
  ============================================================ */

  /* ============================================================
     YouTube mini card — now lives in js/youtube-widget.js
  ============================================================ */

  /* ============================================================
     Init
  ============================================================ */
  renderDeadlinesTable();
  initDeadlinesColumnResize();
  ['kranker','ballard'].forEach(function(lab){
    renderLabTasks(lab);
    loadLabStatus(lab);
    renderLabHours(lab);
  });
  loadWeather();
  initSpotifyWidget();
  initYoutubeWidget();
  updateSidebarDateTime();
  setInterval(updateSidebarDateTime, 1000);
  runClockTick();
  setInterval(runClockTick, 60000);
