/* ============================================================
   Index (main dashboard) — extracted from index.html's inline
   <script> block (Phase B reorg). Page-specific logic only
   (progress wheel, notepad, deadlines, lab tasks, areas, social
   targets). Depends on js/core.js, js/weather-widget.js,
   js/spotify-widget.js, js/youtube-widget.js, js/calendar.js,
   js/core/daily-reset.js (load those first).
============================================================ */
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

  /* Apple Health import functions now live in js/widgets/health-import.js. */

  function selectSegment(btn){
    var group = btn.parentElement;
    group.querySelectorAll('button').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
  }

  function selectScale(btn){
    var group = btn.parentElement;
    group.querySelectorAll('.scale-dot').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
  }

  function sanitizeInt(input){
    input.value = input.value.replace(/[^0-9]/g,'');
  }

  function selectCalorieChip(btn, value){
    var group = btn.parentElement;
    group.querySelectorAll('button').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    document.getElementById('night-calorie-input').value = value;
  }

  function onCalorieInputTyped(input){
    input.value = input.value.replace(/[^0-9]/g,'');
    document.querySelectorAll('#night-calorie-chips button').forEach(function(b){ b.classList.remove('active'); });
  }

  /* ---- Check-in persistence ---- */

  function setSegmentActive(containerId, value){
    var container = document.getElementById(containerId);
    if(!container || !value) return;
    container.querySelectorAll('button').forEach(function(b){
      b.classList.toggle('active', b.textContent.trim() === value);
    });
  }

  function getSegmentValue(containerId){
    var container = document.getElementById(containerId);
    var activeBtn = container.querySelector('button.active');
    return activeBtn ? activeBtn.textContent.trim() : null;
  }

  function setScaleActive(containerId, value){
    var container = document.getElementById(containerId);
    if(!container || !value) return;
    container.querySelectorAll('.scale-dot').forEach(function(b){
      b.classList.toggle('active', b.textContent.trim() === String(value));
    });
  }

  function getScaleValue(containerId){
    var container = document.getElementById(containerId);
    var activeBtn = container.querySelector('.scale-dot.active');
    return activeBtn ? activeBtn.textContent.trim() : null;
  }

  function updateCheckinBadges(){
    var today = getAdjustedDate();
    var morningDone = !!localStorage.getItem('la_checkin_morning_' + today);
    var nightDone = !!localStorage.getItem('la_checkin_night_' + today);
    document.querySelectorAll('.daycycle-btn.morning').forEach(function(el){ el.classList.toggle('completed', morningDone); });
    document.querySelectorAll('.daycycle-btn.night').forEach(function(el){ el.classList.toggle('completed', nightDone); });
  }

  function populateMorningFromStorage(){
    var raw = localStorage.getItem('la_checkin_morning_' + getAdjustedDate());
    if(!raw) return;
    var data = JSON.parse(raw);
    if(data.mood) document.getElementById('morning-mood').value = data.mood;
    if(data.workload) document.getElementById('morning-workload').value = data.workload;
    if(data.sleepHours) document.getElementById('morning-sleep-hours').value = data.sleepHours;
    setScaleActive('morning-energy', data.energyLevel);
  }

  function populateNightFromStorage(targetDate){
    var dateKey = targetDate || getAdjustedDate();
    var nutritionCfg = loadJSON('la_nutrition', {target:2200, entries:{}});
    var todayCal = nutritionCfg.entries[dateKey];
    var calorieInput = document.getElementById('night-calorie-input');
    calorieInput.value = todayCal != null ? todayCal : '';
    document.querySelectorAll('#night-calorie-chips button').forEach(function(b){
      b.classList.toggle('active', todayCal != null && b.textContent.trim() === String(todayCal));
    });
    var raw = localStorage.getItem('la_checkin_night_' + dateKey);
    if(!raw) return;
    var data = JSON.parse(raw);
    if(data.mood) document.getElementById('night-mood').value = data.mood;
    document.getElementById('productivity-checkbox').checked = !!data.productive;
    document.getElementById('night-reflection').value = data.reflection || '';
    setSegmentActive('night-workout', data.workoutDone);
  }

  function openMorningModal(){
    populateMorningFromStorage();
    openModal('morning-modal');
  }

  function openNightModal(targetDate){
    var dateKey = targetDate || getAdjustedDate();
    populateNightFromStorage(dateKey);
    var modal = document.getElementById('night-modal');
    modal.dataset.targetDate = dateKey;
    var subtitle = document.getElementById('night-modal-subtitle');
    if(subtitle){
      if(targetDate){
        subtitle.textContent = 'Missed check-in for ' + targetDate;
        subtitle.style.display = '';
      } else {
        subtitle.style.display = 'none';
      }
    }
    openModal('night-modal');
  }

  function maybeAutoPromptNightCheckin(){
    if(!isNightCheckinMissed()) return;
    if(document.querySelector('.modal-overlay.open')) return;
    var prevDate = getPreviousProductivityDate();
    localStorage.setItem('la_night_checkin_prompted_' + prevDate, '1');
    openNightModal(prevDate);
  }

  function saveMorningCheckin(){
    var data = {
      mood: document.getElementById('morning-mood').value,
      workload: document.getElementById('morning-workload').value,
      sleepHours: document.getElementById('morning-sleep-hours').value,
      energyLevel: getScaleValue('morning-energy'),
      savedAt: new Date().toISOString()
    };
    localStorage.setItem('la_checkin_morning_' + getAdjustedDate(), JSON.stringify(data));
    updateCheckinBadges();
    notifyStateChange('la_checkin_morning_' + getAdjustedDate());
    closeModal('morning-modal');
  }

  function saveNightCheckin(){
    var modal = document.getElementById('night-modal');
    var dateKey = modal.dataset.targetDate || getAdjustedDate();
    var data = {
      mood: document.getElementById('night-mood').value,
      productive: document.getElementById('productivity-checkbox').checked,
      reflection: document.getElementById('night-reflection').value,
      workoutDone: getSegmentValue('night-workout'),
      savedAt: new Date().toISOString()
    };
    localStorage.setItem('la_checkin_night_' + dateKey, JSON.stringify(data));
    var calorieRaw = document.getElementById('night-calorie-input').value;
    if(calorieRaw !== ''){
      var nutritionCfg = loadJSON('la_nutrition', {target:2200, entries:{}});
      nutritionCfg.entries[dateKey] = Number(calorieRaw);
      saveJSON('la_nutrition', nutritionCfg);
      notifyStateChange('la_nutrition');
    }
    updateCheckinBadges();
    notifyStateChange('la_checkin_night_' + dateKey);
    closeModal('night-modal');
    delete modal.dataset.targetDate;
  }

  updateCheckinBadges();

  /* ============================================================
     Storage / date helpers
     (loadJSON/saveJSON/uid/escapeHtml/escapeAttr/isLateNightWindow/
     getAdjustedDate/notifyStateChange now live in js/core.js)
  ============================================================ */

  function todayISO(){
    /* Aliases the 5AM-adjusted "today" (todayISOAdjusted(), in
       js/core/daily-reset.js) so Deadlines' "Due Today" status
       agrees with Habits/Lab Tasks/Social Targets instead of flipping
       at real midnight while everything else flips at 5AM. */
    return todayISOAdjusted();
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
  function computeStatus(dueISO){
    if(!dueISO) return { text:'No date', cls:'status-normal' };
    var diff = daysBetween(dueISO);
    if(diff < 0) return { text:'Overdue', cls:'status-overdue' };
    if(diff === 0) return { text:'Due Today', cls:'status-today' };
    if(diff === 1) return { text:'1 day', cls:'status-tomorrow' };
    return { text: diff + ' days', cls:'status-normal' };
  }

  /* ============================================================
     Areas (shared tag list — synced with academic-subpage.html)
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
     Deadlines — la_deadlines (shared with academic-subpage.html)
     Dashboard shows only the 4 soonest upcoming tasks.
  ============================================================ */
  var currentDeadlineId = null;
  var currentDeadlineArea = null;
  var deadlineFilters = { dueSort:'asc', importance:'All', type:'All', area:'All' };

  function getDeadlines(){ return loadJSON('la_deadlines', []); }
  function saveDeadlines(list){ saveJSON('la_deadlines', list); }

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
    /* The Deadlines table card no longer renders on index.html (see
       the Phase 2 rebuild) — this table only lives on
       academic-subpage.html now. Guarded rather than deleted since
       deleteDeadlineImmediate()/saveDeadlineForm() (used by the
       Academic spoke panel + Add Deadline modal, both still present
       here) call it unconditionally. */
    if(!document.getElementById('deadlines-tbody')) return;
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
        '<td><span class="importance-badge imp-'+ (t.importance || 'Low').toLowerCase() +'">'+ (t.importance || 'Low') +'</span></td>' +
        '<td><span class="'+status.cls+'">'+status.text+'</span></td>' +
        '<td>'+ formatDateHuman(t.due) +'</td>' +
        '<td><span class="type-badge type-'+ (t.type || 'Asynch').toLowerCase() +'">'+ (t.type || 'Asynch') +'</span></td>' +
      '</tr>';
    }).join('');
  }

  function deleteDeadlineImmediate(id){
    saveDeadlines(getDeadlines().filter(function(t){ return t.id !== id; }));
    renderDeadlinesTable();
  }

  var selectedDeadlineDays = [];

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
    /* Previously bumped every overdue task's `due` to today on each
       render, which erased how overdue it actually was and made a
       persistent backlog impossible to compute. Original due dates
       now persist untouched — the wheel's research slice reads the
       live open count directly (see computeWheelFill()). */
    return getLabTasks(lab);
  }

  function autoGrowTaskInput(el){
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function renderLabTasks(lab){
    /* Kranker/Ballard Lab cards no longer render on index.html (see
       the Phase 2 rebuild) — guarded since addLabTask/updateLabTaskField/
       deleteLabTask still call this unconditionally, and the Research
       spoke panel calls those same mutators. */
    var list = rolloverOverdueLabTasks(lab);
    var ul = document.getElementById(lab + '-task-list');
    if(!ul) return;
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
    if(typeof renderSpokeResearch === 'function') renderSpokeResearch();
    var inputs = document.querySelectorAll('#'+lab+'-task-list .task-text-input, #spoke-research-list .task-text-input[data-lab="'+lab+'"]');
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
      if(field === 'due'){
        /* Full re-render only on due-date commit (like renderLabTasks
           below) — never on text-field oninput, which would wipe out
           the textarea's focus/caret on every keystroke. */
        renderLabTasks(lab);
        if(typeof renderSpokeResearch === 'function') renderSpokeResearch();
        if(typeof renderWheel === 'function') renderWheel();
      } else {
        renderLabDueSoonest(lab);
      }
    }
  }

  function deleteLabTask(lab, id){
    saveLabTasks(lab, getLabTasks(lab).filter(function(t){ return t.id !== id; }));
    renderLabTasks(lab);
  }

  function renderLabDueSoonest(lab){
    var list = getLabTasks(lab).filter(function(t){ return t.due; });
    var el = document.getElementById(lab + '-due-soonest');
    if(!el) return;
    if(!list.length){ el.textContent = '—'; return; }
    list.sort(function(a,b){ return a.due < b.due ? -1 : 1; });
    el.textContent = 'Due ' + formatDateHuman(list[0].due);
  }

  function loadLabStatus(lab){
    var el = document.getElementById(lab + '-status');
    if(el) el.value = loadJSON('la_' + lab + '_status', 'on-track');
  }

  /* ============================================================
     Manual weekly hours counters — la_kranker_hours / la_ballard_hours
  ============================================================ */
  function getLabHours(lab){ return parseFloat(loadJSON('la_' + lab + '_hours', 0)) || 0; }
  function renderLabHours(lab){
    var val = getLabHours(lab);
    var valueEl = document.getElementById(lab + '-hours-value');
    if(valueEl) valueEl.textContent = val.toFixed(1) + ' hrs';
    var input = document.getElementById(lab + '-hours-input');
    if(input) input.value = val.toFixed(1);
  }

  /* Pomodoro/Study-Streak/Notepad/Hobbies-summary/Currently-media
     removed from index.html — those cards no longer render here (see
     the Phase 2 rebuild), and academic-subpage.html keeps its own
     independent copies of the Pomodoro/Study Streak logic. */

  /* ============================================================
     Sidebar mood mini card — condensed morning/night check-in summary
     (la_checkin_morning_/night_). Replaces the old sidebar Study
     Streak widget and the standalone Physical Health/Mood card that
     used to live in the bottom-section grid.
  ============================================================ */
  var SIDEBAR_MOOD_MORNING_VALUES = { Energized:1.0, Calm:0.6, Content:0.3, Lethargic:-0.3, Anxious:-0.6, Stressed:-0.8 };
  var SIDEBAR_MOOD_NIGHT_VALUES = { Excited:1.0, Content:0.6, Calm:0.3, Drained:-0.3, Anxious:-0.6, Sad:-0.8, Depressed:-1.0 };
  var SIDEBAR_MOOD_EMOJI = { Energized:'⚡', Excited:'✨', Content:'😌', Calm:'🌊', Lethargic:'😴', Drained:'🪫', Anxious:'😰', Stressed:'🔥', Sad:'🌧️', Depressed:'🌑' };

  function sidebarMoodValue(period, mood){
    var map = period === 'morning' ? SIDEBAR_MOOD_MORNING_VALUES : SIDEBAR_MOOD_NIGHT_VALUES;
    return mood && map.hasOwnProperty(mood) ? map[mood] : null;
  }

  function sidebarMoodBlockHtml(period, mood){
    var label = period === 'morning' ? 'AM' : 'PM';
    if(!mood){
      return '<div class="mood-mini-block">' +
          '<span class="mood-mini-label mono">' + label + '</span>' +
          '<span class="mood-mini-empty-mark">—</span>' +
        '</div>';
    }
    var v = sidebarMoodValue(period, mood);
    var hue = v == null || v >= 0 ? 142 : 4;
    var mag = v == null ? 0 : Math.min(1, Math.abs(v));
    var sat = 60 + mag * 10;
    var bg = 'hsla(' + hue + ', ' + sat + '%, 50%, 0.14)';
    var border = 'hsla(' + hue + ', ' + sat + '%, 55%, 0.35)';
    var emoji = SIDEBAR_MOOD_EMOJI[mood] || '❔';
    return '<div class="mood-mini-block" style="background:' + bg + '; border-color:' + border + ';" title="' + escapeAttr(mood) + '">' +
        '<span class="mood-mini-label mono">' + label + '</span>' +
        '<span class="mood-mini-emoji">' + emoji + '</span>' +
      '</div>';
  }

  /* Notepad/Hobbies-summary/Currently-media removed from index.html
     (see the Pomodoro removal comment above — same rationale). */

  /* ============================================================
     Habit Tracker — la_habits
     Day resets at 5:00 AM (not midnight). Frequency-aware streaks.
  ============================================================ */
  var HABIT_COLORS = ['#4ade80','#60a5fa','#fb923c','#c084fc','#f87171','#facc15','#22d3ee','#f472b6'];
  var selectedHabitColor = HABIT_COLORS[0];
  var selectedHabitDays = [];
  var currentHabitId = null;
  var dragHabitId = null;
  var habitViewMode = 'all';

  function setHabitViewMode(mode){
    habitViewMode = mode;
    document.querySelectorAll('.habit-view-btn').forEach(function(b){
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    renderHabitGrid();
  }

  function habitColorRgba(hex, alpha){
    var h = (hex || '#4ade80').replace('#','');
    if(h.length === 3){ h = h.split('').map(function(c){ return c+c; }).join(''); }
    var r = parseInt(h.substring(0,2),16);
    var g = parseInt(h.substring(2,4),16);
    var b = parseInt(h.substring(4,6),16);
    return 'rgba('+r+','+g+','+b+','+alpha+')';
  }

  function getHabits(){ return loadJSON('la_habits', []); }
  function saveHabits(list){
    list.forEach(function(h){
      if(!h.completedDates) h.completedDates = [];
      if(h.bestStreak === undefined) h.bestStreak = 0;
      h.currentStreak = computeHabitStreak(h);
      var sorted = h.completedDates.slice().sort();
      h.lastCompletedDate = sorted.length ? sorted[sorted.length - 1] : null;
    });
    saveJSON('la_habits', list);
  }

  function getAdjustedDateFromTimestamp(ts){
    var d = new Date(ts);
    if(d.getHours() >= 0 && d.getHours() < 5){ d.setDate(d.getDate() - 1); }
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function isScheduledDay(habit, dateISO){
    var dow = new Date(dateISO + 'T00:00:00').getDay();
    if(habit.frequency === 'weekdays') return dow >= 1 && dow <= 5;
    if(habit.frequency === 'weekends') return dow === 0 || dow === 6;
    if(habit.frequency === 'custom') return (habit.customDays || []).indexOf(dow) !== -1;
    return true;
  }
  function computeHabitStreak(habit){
    var completed = habit.completedDates || [];
    var cursor = getAdjustedDate();
    if(isScheduledDay(habit, cursor) && completed.indexOf(cursor) === -1){
      cursor = addDaysISO(cursor, -1);
    }
    var streak = 0;
    var guard = 0;
    while(guard++ < 730){
      if(isScheduledDay(habit, cursor)){
        if(completed.indexOf(cursor) !== -1){
          streak++;
          cursor = addDaysISO(cursor, -1);
        } else {
          break;
        }
      } else {
        cursor = addDaysISO(cursor, -1);
      }
    }
    return streak;
  }

  function toggleHabitToday(id){
    var habits = getHabits();
    var habit = habits.find(function(h){ return h.id === id; });
    if(!habit) return;
    var today = getAdjustedDate();
    if(!habit.completedDates) habit.completedDates = [];
    var idx = habit.completedDates.indexOf(today);
    if(idx !== -1){
      habit.completedDates.splice(idx, 1);
    } else {
      habit.completedDates.push(today);
      habit.bestStreak = Math.max(habit.bestStreak || 0, computeHabitStreak(habit));
    }
    saveHabits(habits);
    renderSidebarHabits();
    if(document.getElementById('habit-modal').classList.contains('open')){ renderHabitGrid(); }
  }

  function deleteHabitDirect(id){
    saveHabits(getHabits().filter(function(h){ return h.id !== id; }));
    renderHabitGrid();
    renderSidebarHabits();
  }

  function renderSidebarHabits(){
    var today = getAdjustedDate();
    var habits = getHabits().filter(function(h){ return isScheduledDay(h, today); });
    var list = document.getElementById('habit-mini-list');
    var completedCount = habits.filter(function(h){ return (h.completedDates || []).indexOf(today) !== -1; }).length;
    document.getElementById('habit-mini-counter').textContent = completedCount + ' / ' + habits.length;
    if(!habits.length){
      list.innerHTML = '<div class="habit-mini-empty">No habits today</div>';
      return;
    }
    list.innerHTML = habits.map(function(h){
      var completed = (h.completedDates || []).indexOf(today) !== -1;
      var streak = computeHabitStreak(h);
      return '<div class="habit-mini-row" style="background:'+habitColorRgba(h.color, 0.38)+';">' +
          '<span class="habit-mini-dot" style="background:'+h.color+'; color:'+h.color+';"></span>' +
          '<span class="habit-mini-name">'+escapeHtml(h.name)+'</span>' +
          '<span class="habit-mini-streak mono">'+(streak > 1 ? '🔥 ' : '')+streak+'</span>' +
          '<input type="checkbox" class="habit-checkbox"'+(completed ? ' checked' : '')+' onclick="event.stopPropagation(); toggleHabitToday(\''+h.id+'\')">' +
        '</div>';
    }).join('');
    renderWheel();
  }

  function renderHabitGrid(){
    var today = getAdjustedDate();
    var allHabits = getHabits();
    var habits = habitViewMode === 'today' ? allHabits.filter(function(h){ return isScheduledDay(h, today); }) : allHabits;
    var dateLabel = document.getElementById('habit-modal-date');
    if(dateLabel) dateLabel.textContent = formatDateHuman(today);
    var grid = document.getElementById('habit-grid');
    if(!habits.length){
      grid.innerHTML = '<div class="habit-empty-msg">' + (habitViewMode === 'today' ? 'No habits scheduled today' : 'No habits yet — add one below') + '</div>';
      return;
    }
    grid.innerHTML = habits.map(function(h){
      var streak = computeHabitStreak(h);
      var completedToday = (h.completedDates || []).indexOf(today) !== -1;
      var scheduledToday = isScheduledDay(h, today);
      var checkRow = scheduledToday
        ? '<label class="habit-card-check-row"><input type="checkbox" class="habit-checkbox"'+(completedToday ? ' checked' : '')+' onclick="toggleHabitToday(\''+h.id+'\')"> '+(completedToday ? 'Completed today' : 'Mark complete')+'</label>'
        : '<div class="habit-card-unscheduled">Not scheduled today</div>';
      return '<div class="habit-card'+(completedToday ? ' completed' : '')+'" style="background:'+habitColorRgba(h.color, 0.12)+'; border-color:'+habitColorRgba(h.color, 0.3)+';" draggable="true" data-habit-id="'+h.id+'" ondragstart="habitDragStart(event,\''+h.id+'\')" ondragend="habitDragEnd(event)" ondragover="habitDragOver(event)" ondrop="habitDrop(event,\''+h.id+'\')">' +
          '<div class="habit-card-top">' +
            '<div>' +
              '<div class="habit-card-name" style="color:'+h.color+';">'+escapeHtml(h.name)+'</div>' +
              '<span class="habit-difficulty-badge habit-diff-'+h.difficulty+'">'+h.difficulty+'</span>' +
            '</div>' +
            '<div class="habit-card-actions">' +
              '<div class="habit-icon-btn" onclick="openHabitForm(\''+h.id+'\')" title="Edit"><span class="material-symbols-outlined">edit</span></div>' +
              '<div class="habit-icon-btn" onclick="deleteHabitDirect(\''+h.id+'\')" title="Delete"><span class="material-symbols-outlined">close</span></div>' +
            '</div>' +
          '</div>' +
          '<div class="habit-card-streaks">' +
            '<span class="streak-current">🔥 '+streak+'</span>' +
            '<span>Best: '+(h.bestStreak || 0)+'</span>' +
          '</div>' +
          checkRow +
        '</div>';
    }).join('');
  }

  function habitDragStart(e, id){
    dragHabitId = id;
    e.currentTarget.classList.add('dragging');
    if(e.dataTransfer){
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', id); } catch(err){}
    }
  }
  function habitDragEnd(e){
    e.currentTarget.classList.remove('dragging');
    dragHabitId = null;
  }
  function habitDragOver(e){
    e.preventDefault();
    if(e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }
  function habitDrop(e, targetId){
    e.preventDefault();
    e.stopPropagation();
    if(dragHabitId === targetId) return;
    reorderHabits(dragHabitId, targetId);
  }
  function habitGridDragOver(e){
    e.preventDefault();
  }
  function habitGridDrop(e){
    e.preventDefault();
    reorderHabits(dragHabitId, null);
  }
  function reorderHabits(fromId, targetId){
    if(!fromId) return;
    var habits = getHabits();
    var fromIdx = habits.findIndex(function(h){ return h.id === fromId; });
    if(fromIdx === -1) return;
    var moved = habits.splice(fromIdx, 1)[0];
    var toIdx = targetId ? habits.findIndex(function(h){ return h.id === targetId; }) : -1;
    if(toIdx === -1){ habits.push(moved); } else { habits.splice(toIdx, 0, moved); }
    saveHabits(habits);
    renderHabitGrid();
    renderSidebarHabits();
  }

  function openHabitModal(){
    cancelHabitForm();
    renderHabitGrid();
    openModal('habit-modal');
  }

  function toggleHabitCustomDays(){
    var freq = document.getElementById('habit-frequency-input').value;
    document.getElementById('habit-custom-days-group').classList.toggle('show', freq === 'custom');
  }

  function renderHabitDaysRow(){
    var labels = ['M','T','W','T','F','S','S'];
    var dows =   [1,2,3,4,5,6,0];
    var row = document.getElementById('habit-custom-days-row');
    row.innerHTML = dows.map(function(dow, i){
      var active = selectedHabitDays.indexOf(dow) !== -1;
      var style = active ? ' style="background:'+selectedHabitColor+'; border-color:'+selectedHabitColor+'; color:#0b0b10;"' : '';
      return '<button type="button" class="habit-day-btn'+(active ? ' active' : '')+'"'+style+' onclick="toggleHabitDay('+dow+')">'+labels[i]+'</button>';
    }).join('');
  }
  function toggleHabitDay(dow){
    var idx = selectedHabitDays.indexOf(dow);
    if(idx === -1){ selectedHabitDays.push(dow); } else { selectedHabitDays.splice(idx, 1); }
    renderHabitDaysRow();
  }

  function renderHabitColorSwatches(){
    var row = document.getElementById('habit-color-row');
    row.innerHTML = HABIT_COLORS.map(function(c){
      var sel = c === selectedHabitColor ? ' selected' : '';
      return '<div class="habit-color-swatch'+sel+'" style="background:'+c+';" onclick="selectHabitColor(\''+c+'\')"></div>';
    }).join('');
  }
  function selectHabitColor(c){
    selectedHabitColor = c;
    renderHabitColorSwatches();
    renderHabitDaysRow();
  }

  function openHabitForm(id){
    currentHabitId = id || null;
    document.getElementById('habit-add-form').style.display = 'block';
    document.getElementById('habit-add-toggle-btn').style.display = 'none';
    if(id){
      var h = getHabits().find(function(x){ return x.id === id; });
      document.getElementById('habit-form-title').textContent = 'Edit Habit';
      document.getElementById('habit-name-input').value = h.name;
      document.getElementById('habit-frequency-input').value = h.frequency;
      document.getElementById('habit-difficulty-input').value = h.difficulty;
      selectedHabitColor = h.color;
      selectedHabitDays = (h.customDays || []).slice();
    } else {
      document.getElementById('habit-form-title').textContent = 'Add Habit';
      document.getElementById('habit-name-input').value = '';
      document.getElementById('habit-frequency-input').value = 'daily';
      document.getElementById('habit-difficulty-input').value = 'medium';
      selectedHabitColor = HABIT_COLORS[0];
      selectedHabitDays = [];
    }
    toggleHabitCustomDays();
    renderHabitDaysRow();
    renderHabitColorSwatches();
  }

  function cancelHabitForm(){
    var form = document.getElementById('habit-add-form');
    var toggleBtn = document.getElementById('habit-add-toggle-btn');
    if(form) form.style.display = 'none';
    if(toggleBtn) toggleBtn.style.display = 'inline-flex';
    currentHabitId = null;
  }

  function saveHabitForm(){
    var name = document.getElementById('habit-name-input').value.trim();
    if(!name){ document.getElementById('habit-name-input').focus(); return; }
    var habits = getHabits();
    var habit = currentHabitId ? habits.find(function(h){ return h.id === currentHabitId; }) : null;
    if(!habit){
      habit = { id: uid(), completedDates: [], bestStreak: 0 };
      habits.push(habit);
    }
    habit.name = name;
    habit.frequency = document.getElementById('habit-frequency-input').value;
    habit.customDays = habit.frequency === 'custom' ? selectedHabitDays.slice() : [];
    habit.difficulty = document.getElementById('habit-difficulty-input').value;
    habit.color = selectedHabitColor;
    saveHabits(habits);
    cancelHabitForm();
    renderHabitGrid();
    renderSidebarHabits();
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
    /* Pomodoro/Hobbies/Notepad/Currently-media branches removed along
       with those cards (see the Phase 2 rebuild) — their storage keys
       are no longer rendered anywhere on this page. */
    if(e.key === 'la_deadlines'){ renderDeadlinesTable(); renderSpokeAcademic(); }
    else if(e.key === 'la_kranker_tasks'){ renderLabTasks('kranker'); renderSpokeResearch(); }
    else if(e.key === 'la_ballard_tasks'){ renderLabTasks('ballard'); renderSpokeResearch(); }
    else if(e.key === 'la_kranker_hours'){ renderLabHours('kranker'); }
    else if(e.key === 'la_ballard_hours'){ renderLabHours('ballard'); }
    else if(e.key === 'la_kranker_status'){ loadLabStatus('kranker'); }
    else if(e.key === 'la_ballard_status'){ loadLabStatus('ballard'); }
    else if(e.key === 'la_areas'){
      if(document.getElementById('deadline-modal').classList.contains('open')){ renderDeadlineAreaChips(); }
    }
    else if(e.key && e.key.indexOf('la_checkin_') === 0){ renderSpokeDay(); renderSpokeNight(); }
    else if(e.key === 'la_habits'){
      renderSidebarHabits();
      if(document.getElementById('habit-modal').classList.contains('open')){ renderHabitGrid(); }
    }
    else if(e.key === 'la_social_people'){
      renderSidebarSocial();
      if(document.getElementById('social-modal').classList.contains('open')){ renderSocialBoard(); }
    }
    else if(e.key && e.key.indexOf('la_wheel_done_') === 0){ renderWheel(); }
  }
  window.addEventListener('storage', handleStorageSync);
  window.addEventListener('state-change', function(e){ handleStorageSync({ key: e.detail.key }); });

  /* ============================================================
     Daily reset at 5AM — refresh check-in badges, social daily
     state, and nutrition entry for the new day. Only fires once
     per adjusted day (la_last_reset_date, 5AM-adjusted YYYY-MM-DD).
     checkDailyReset/performDailyReset/runClockTick/
     updateLateNightMode/updateSidebarDateTime/clearTodayNutritionEntry
     now live in js/core/daily-reset.js; this page just registers its
     extra reset/tick steps as hooks.
  ============================================================ */
  registerDailyResetHook(function(){
    updateCheckinBadges();
    renderSidebarSocial();
    clearTodayNutritionEntry();
    if(typeof renderNutritionCard === 'function'){ renderNutritionCard(); }
    if(typeof renderSpokeDay === 'function'){ renderSpokeDay(); }
    if(typeof renderSpokeNight === 'function'){ renderSpokeNight(); }
  });
  registerClockTickHook(maybeAutoPromptNightCheckin);

  /* ============================================================
     Social Targets — la_social_people
     Person: {id, name, color, importance, frequencyDays, lastContacted, plannedDate}
     importance is one of SOCIAL_IMPORTANCE, or absent/null while the
     person sits unassigned in the bottom "Name Bank". frequencyDays
     is the user-set contact-interval window in days (independent of
     importance, which is purely a priority tier for grouping).
  ============================================================ */
  var SOCIAL_COLORS = ['#3b82f6','#22c55e','#eab308','#ef4444','#a855f7','#ec4899','#14b8a6','#f97316'];
  var SOCIAL_IMPORTANCE = ['high','medium','low'];
  var DEFAULT_SOCIAL_FREQUENCY_DAYS = 7;
  /* Legacy per-category windows, used once to migrate pre-existing
     records that predate the frequencyDays field. */
  var LEGACY_CATEGORY_WINDOWS = { daily:1, 'semi-daily':3, weekly:7, monthly:30 };
  var LEGACY_CATEGORY_TO_IMPORTANCE = { daily:'high', 'semi-daily':'high', weekly:'medium', monthly:'low' };
  var selectedSocialColor = SOCIAL_COLORS[0];
  var dragPersonId = null;

  function migrateLegacySocialPerson(p){
    if(!p.category) return;
    p.importance = LEGACY_CATEGORY_TO_IMPORTANCE[p.category] || 'medium';
    p.frequencyDays = LEGACY_CATEGORY_WINDOWS[p.category] || DEFAULT_SOCIAL_FREQUENCY_DAYS;
    delete p.category;
  }

  function getSocialPeople(){
    var list = loadJSON('la_social_people', []);
    var migrated = false;
    list.forEach(function(p){
      if(p.category && !p.importance){ migrateLegacySocialPerson(p); migrated = true; }
    });
    if(migrated) saveJSON('la_social_people', list);
    return list;
  }
  function saveSocialPeople(list){ saveJSON('la_social_people', list); }

  /* Derived per-person state — recomputed live on every render, never
     persisted and never ticked by a setInterval countdown. */
  function computeSocialDerived(person, todayISO){
    if(person.plannedDate){
      if(person.plannedDate >= todayISO){
        return { state:'FROZEN', display:'Planned: ' + person.plannedDate, color:null, daysRemaining:Infinity, elapsedPct:0 };
      }
      return { state:'OVERDUE_PLANNED', display:'!!!', color:'red', daysRemaining:-Infinity, elapsedPct:Infinity };
    }
    var windowDays = person.frequencyDays || DEFAULT_SOCIAL_FREQUENCY_DAYS;
    var windowMs = windowDays * 86400000;
    var lastMs = person.lastContacted || Date.now();
    var elapsedPct = (Date.now() - lastMs) / windowMs;
    /* 50/40/10 split: green covers the first 50% of the window, yellow
       the next 40% (up to 90%), red the final 10% and beyond. */
    var color = elapsedPct < 0.5 ? 'green' : elapsedPct < 0.9 ? 'yellow' : 'red';
    var daysRemaining = windowDays - (elapsedPct * windowDays);
    var display;
    if(windowDays <= 1){
      /* A same-day window would just read "1d left"/"0d left" for
         hours at a stretch — show hours instead so the timer stays
         informative. */
      var remainingHours = (windowMs - (Date.now() - lastMs)) / 3600000;
      display = remainingHours > 0
        ? Math.max(1, Math.ceil(remainingHours)) + 'h left'
        : '+' + Math.max(1, Math.floor(-remainingHours)) + 'h overdue';
    } else if(elapsedPct > 1){
      var overdueDays = Math.max(1, Math.floor((elapsedPct * windowDays) - windowDays));
      display = '+' + overdueDays + ' overdue';
    } else {
      display = Math.max(0, Math.ceil(daysRemaining)) + 'd left';
    }
    return { state:'NORMAL', display:display, color:color, daysRemaining:daysRemaining, elapsedPct:elapsedPct };
  }

  /* Sort order within a column: OVERDUE_PLANNED (top) > NORMAL by
     elapsedPct descending > FROZEN (bottom). */
  function socialSortTier(derived){
    if(derived.state === 'OVERDUE_PLANNED') return 0;
    if(derived.state === 'FROZEN') return 2;
    return 1;
  }
  function compareSocialCards(a, b){
    var ta = socialSortTier(a.derived), tb = socialSortTier(b.derived);
    if(ta !== tb) return ta - tb;
    if(ta === 1) return b.derived.elapsedPct - a.derived.elapsedPct;
    return (a.person.plannedDate || '').localeCompare(b.person.plannedDate || '');
  }

  /* Wheel/card membership: people on a 1-day window always qualify;
     everyone else only joins once they're down to their last day or
     overdue. FROZEN people never qualify. */
  function isSocialRosterMember(derived){
    return derived.state !== 'FROZEN' && derived.daysRemaining <= 1;
  }

  function getSocialRoster(){
    var today = getAdjustedDate();
    var roster = [];
    getSocialPeople().forEach(function(p){
      if(!p.importance) return;
      var derived = computeSocialDerived(p, today);
      if(isSocialRosterMember(derived)) roster.push({ person:p, derived:derived });
    });
    return roster;
  }

  function computeSocialWheelFill(){
    var roster = getSocialRoster();
    var total = roster.length;
    var done = roster.filter(function(r){ return r.derived.color === 'green'; }).length;
    return { frac:computeCategoryFraction(done, total), done:done, total:total, open: total - done };
  }

  function renderSocialActionControlHtml(id, mini){
    return '<span class="social-action-wrap">' +
        '<select class="social-action-select'+(mini?' social-action-select-mini':'')+'" onchange="handleSocialCardAction(this,\''+id+'\')">' +
          '<option value="" selected disabled>Action…</option>' +
          '<option value="talked">Talked</option>' +
          '<option value="skip">Skip</option>' +
          '<option value="plan">Plan hangout</option>' +
        '</select>' +
        '<input type="date" class="social-plan-date-input" style="display:none" onchange="applySocialPlanDate(this,\''+id+'\')">' +
      '</span>';
  }

  function handleSocialCardAction(selectEl, id){
    var val = selectEl.value;
    selectEl.value = '';
    if(val === 'talked' || val === 'skip'){
      markSocialTalked(id);
    } else if(val === 'plan'){
      var dateInput = selectEl.parentElement.querySelector('.social-plan-date-input');
      var p = getSocialPeople().find(function(x){ return x.id === id; });
      dateInput.value = (p && p.plannedDate) || '';
      dateInput.style.display = 'inline-block';
      dateInput.focus();
      if(dateInput.showPicker){ try{ dateInput.showPicker(); }catch(e){} }
    }
  }

  function applySocialPlanDate(inputEl, id){
    if(!inputEl.value){ inputEl.style.display = 'none'; return; }
    var people = getSocialPeople();
    var p = people.find(function(x){ return x.id === id; });
    if(p){ p.plannedDate = inputEl.value; saveSocialPeople(people); }
    inputEl.style.display = 'none';
    notifyStateChange('la_social_people');
    renderAllSocialViews();
  }

  function markSocialTalked(id){
    var people = getSocialPeople();
    var p = people.find(function(x){ return x.id === id; });
    if(!p) return;
    /* A 1-day window is exactly one productivity day, so a same-day
       re-mark would just push the timer forward within the day it was
       already handled. Longer windows always benefit from an
       immediate reset — only the 1-day case needs this guard. */
    if((p.frequencyDays || DEFAULT_SOCIAL_FREQUENCY_DAYS) <= 1 && !p.plannedDate && p.lastContacted &&
       getAdjustedDateFromTimestamp(p.lastContacted) === getAdjustedDate()){
      return;
    }
    p.lastContacted = Date.now();
    p.plannedDate = null;
    saveSocialPeople(people);
    notifyStateChange('la_social_people');
    renderAllSocialViews();
  }

  function renderAllSocialViews(){
    renderSidebarSocial();
    if(document.getElementById('social-modal').classList.contains('open')){ renderSocialBoard(); }
  }

  function renderSidebarSocial(){
    var wrap = document.getElementById('social-widget-rows');
    if(!wrap) return;
    var today = getAdjustedDate();
    /* The wheel's fraction still counts only the roster (getSocialRoster,
       via computeSocialWheelFill in renderWheel) — this list is a
       separate always-visible overview of everyone so a timer turning
       red is never a surprise. Green people on a window longer than a
       day are greyed out, since a 1-day window is the only case whose
       green state is itself time-limited. */
    var all = getSocialPeople().filter(function(p){ return p.importance; })
      .map(function(p){ return { person:p, derived:computeSocialDerived(p, today) }; })
      .sort(compareSocialCards);
    wrap.innerHTML = !all.length
      ? '<div class="social-empty">No one tracked yet</div>'
      : all.map(function(r){
          var statusColor = r.derived.color === 'red' ? '#ef4444' : r.derived.color === 'yellow' ? '#eab308' : r.derived.color === 'green' ? '#22c55e' : 'var(--ink-faint)';
          var dim = r.derived.color === 'green' && (r.person.frequencyDays || DEFAULT_SOCIAL_FREQUENCY_DAYS) > 1;
          return '<div class="social-row'+(dim ? ' social-row-dim' : '')+'">' +
              '<div class="social-row-left">' +
                '<span class="dot" style="background:'+r.person.color+'; color:'+r.person.color+';"></span>' +
                '<span class="name">'+escapeHtml(r.person.name)+'</span>' +
                '<span class="social-status mono" style="color:'+statusColor+';">'+escapeHtml(r.derived.display)+'</span>' +
              '</div>' +
              renderSocialActionControlHtml(r.person.id, true) +
            '</div>';
        }).join('');
    renderWheel();
  }

  function renderPersonChipHtml(p){
    return '<div class="person-chip" draggable="true" style="border-color:'+habitColorRgba(p.color,0.5)+'; background:'+habitColorRgba(p.color,0.6)+';" data-person-id="'+p.id+'" ondragstart="personDragStart(event,\''+p.id+'\')" ondragend="personDragEnd(event)">' +
        '<span class="person-chip-dot" style="background:'+p.color+'; color:'+p.color+';"></span>' +
        '<span class="person-chip-name">'+escapeHtml(p.name)+'</span>' +
        '<span class="person-chip-del material-symbols-outlined" onclick="event.stopPropagation(); deleteSocialPerson(\''+p.id+'\')" title="Remove">close</span>' +
      '</div>';
  }

  function renderSocialKanbanCardHtml(p, derived){
    var statusColor = derived.color === 'red' ? '#ef4444' : derived.color === 'yellow' ? '#eab308' : derived.color === 'green' ? '#22c55e' : 'var(--ink-faint)';
    return '<div class="social-kanban-card" draggable="true" style="border-color:'+habitColorRgba(p.color,0.5)+';" data-person-id="'+p.id+'" ondragstart="personDragStart(event,\''+p.id+'\')" ondragend="personDragEnd(event)">' +
        '<div class="social-kanban-card-top">' +
          '<span class="dot" style="background:'+p.color+'; color:'+p.color+';"></span>' +
          '<span class="social-kanban-card-name">'+escapeHtml(p.name)+'</span>' +
          '<span class="person-chip-del material-symbols-outlined" onclick="event.stopPropagation(); deleteSocialPerson(\''+p.id+'\')" title="Remove">close</span>' +
        '</div>' +
        '<div class="social-kanban-card-status" style="color:'+statusColor+';">'+escapeHtml(derived.display)+'</div>' +
        '<div class="social-kanban-card-freq">' +
          '<label>Check in every</label>' +
          '<input type="number" min="1" step="1" class="social-freq-input" value="'+(p.frequencyDays || DEFAULT_SOCIAL_FREQUENCY_DAYS)+'" onclick="event.stopPropagation()" onchange="updateSocialFrequency(this,\''+p.id+'\')">' +
          '<span class="social-freq-unit">'+pluralizeDays(p.frequencyDays || DEFAULT_SOCIAL_FREQUENCY_DAYS)+'</span>' +
        '</div>' +
        renderSocialActionControlHtml(p.id, false) +
      '</div>';
  }

  function pluralizeDays(n){ return n === 1 ? 'day' : 'days'; }

  function updateSocialFrequency(inputEl, id){
    var days = Math.max(1, parseInt(inputEl.value, 10) || DEFAULT_SOCIAL_FREQUENCY_DAYS);
    inputEl.value = days;
    var people = getSocialPeople();
    var p = people.find(function(x){ return x.id === id; });
    if(!p) return;
    p.frequencyDays = days;
    saveSocialPeople(people);
    notifyStateChange('la_social_people');
    renderAllSocialViews();
  }

  function renderSocialBank(){
    var list = document.getElementById('social-bank-list');
    if(!list) return;
    var bank = getSocialPeople().filter(function(p){ return !p.importance; });
    list.innerHTML = bank.length
      ? bank.map(function(p){ return renderPersonChipHtml(p); }).join('')
      : '<div class="social-people-empty">No unassigned people — add or drag someone here</div>';
  }

  function renderSocialBoard(){
    var today = getAdjustedDate();
    var people = getSocialPeople();
    SOCIAL_IMPORTANCE.forEach(function(level){
      var rows = people.filter(function(p){ return p.importance === level; })
        .map(function(p){ return { person:p, derived:computeSocialDerived(p, today) }; })
        .sort(compareSocialCards);
      var countEl = document.getElementById('social-board-count-' + level);
      if(countEl) countEl.textContent = '· ' + rows.length;
      var cardsEl = document.getElementById('social-board-cards-' + level);
      if(cardsEl){
        cardsEl.innerHTML = rows.length
          ? rows.map(function(r){ return renderSocialKanbanCardHtml(r.person, r.derived); }).join('')
          : '<div class="social-people-empty">No one here yet</div>';
      }
    });
    renderSocialBank();
  }

  function openSocialModal(){
    cancelSocialPersonForm();
    renderSocialBoard();
    openModal('social-modal');
  }

  function personDragStart(e, id){
    dragPersonId = id;
    if(e.dataTransfer){ e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }
    e.currentTarget.classList.add('dragging');
  }
  function personDragEnd(e){
    e.currentTarget.classList.remove('dragging');
    dragPersonId = null;
  }
  function socialColumnDragOver(e){
    e.preventDefault();
    if(e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }
  function socialColumnDragEnter(e){ e.currentTarget.classList.add('drag-over'); }
  function socialColumnDragLeave(e){ e.currentTarget.classList.remove('drag-over'); }

  function assignSocialImportance(id, importance){
    var people = getSocialPeople();
    var p = people.find(function(x){ return x.id === id; });
    if(p && p.importance !== importance){
      var isNew = !p.importance;
      p.importance = importance;
      if(!p.frequencyDays) p.frequencyDays = DEFAULT_SOCIAL_FREQUENCY_DAYS;
      if(isNew){ p.lastContacted = Date.now(); p.plannedDate = null; }
      saveSocialPeople(people);
      notifyStateChange('la_social_people');
      renderAllSocialViews();
    }
  }

  function dropOnSocialColumn(e, importance){
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
    if(!dragPersonId) return;
    assignSocialImportance(dragPersonId, importance);
  }
  function dropOnSocialBank(e){
    e.preventDefault();
    if(!dragPersonId) return;
    var people = getSocialPeople();
    var p = people.find(function(x){ return x.id === dragPersonId; });
    if(p && p.importance){
      p.importance = null;
      saveSocialPeople(people);
      notifyStateChange('la_social_people');
      renderAllSocialViews();
    }
  }

  function openSocialPersonForm(){
    document.getElementById('social-add-form').style.display = 'flex';
    document.getElementById('social-people-add-btn').style.display = 'none';
    document.getElementById('social-person-name-input').value = '';
    document.getElementById('social-person-importance-input').value = '';
    document.getElementById('social-person-frequency-input').value = DEFAULT_SOCIAL_FREQUENCY_DAYS;
    selectedSocialColor = SOCIAL_COLORS[0];
    renderSocialColorSwatches();
    document.getElementById('social-person-name-input').focus();
  }
  function cancelSocialPersonForm(){
    var form = document.getElementById('social-add-form');
    var btn = document.getElementById('social-people-add-btn');
    if(form) form.style.display = 'none';
    if(btn) btn.style.display = 'flex';
  }
  function renderSocialColorSwatches(){
    var row = document.getElementById('social-color-row');
    if(!row) return;
    row.innerHTML = SOCIAL_COLORS.map(function(c){
      var sel = c === selectedSocialColor ? ' selected' : '';
      return '<div class="habit-color-swatch'+sel+'" style="background:'+c+';" onclick="selectSocialColor(\''+c+'\')"></div>';
    }).join('');
  }
  function selectSocialColor(c){
    selectedSocialColor = c;
    renderSocialColorSwatches();
  }
  function saveSocialPerson(){
    var input = document.getElementById('social-person-name-input');
    var name = input.value.trim();
    if(!name){ input.focus(); return; }
    var importance = document.getElementById('social-person-importance-input').value || null;
    var frequencyDays = Math.max(1, parseInt(document.getElementById('social-person-frequency-input').value, 10) || DEFAULT_SOCIAL_FREQUENCY_DAYS);
    var people = getSocialPeople();
    people.push({ id: uid(), name: name, color: selectedSocialColor, importance: importance, frequencyDays: frequencyDays, lastContacted: Date.now(), plannedDate: null });
    saveSocialPeople(people);
    cancelSocialPersonForm();
    notifyStateChange('la_social_people');
    renderAllSocialViews();
  }
  function deleteSocialPerson(id){
    saveSocialPeople(getSocialPeople().filter(function(p){ return p.id !== id; }));
    notifyStateChange('la_social_people');
    renderAllSocialViews();
  }

  /* ============================================================
     Progress Wheel — weighted composition of today's five
     categories. Habits/Checkins compute live off existing storage
     (nothing is ever deleted, so a fresh count each render is
     accurate). Academic deadlines and Lab tasks both get *deleted*
     when checked off (existing app behavior, unchanged here), which
     would erase them from a live "due today" count the instant
     they're completed — so those two categories track a small
     per-adjusted-date "completed today" counter (la_wheel_done_*)
     alongside the live remaining-count, and total = remaining + done.
     This keeps each category's fraction monotonic and bounded in
     [0,1] across a single day regardless of when items get checked
     off, while the *live* remaining count (not a frozen morning
     snapshot) is what lets yesterday's uncompleted backlog silently
     inflate tomorrow's starting total — satisfying "grows
     indefinitely, no cap" for the Research slice without the ratio
     ever exceeding 100%.
  ============================================================ */
  var WHEEL_WEIGHTS = { habits:20, academic:40, research:20, social:10, checkins:10 };

  function getWheelDoneCount(cat){
    return parseInt(loadJSON('la_wheel_done_' + cat + '_' + getAdjustedDate(), 0), 10) || 0;
  }
  function incrWheelDone(cat){
    saveJSON('la_wheel_done_' + cat + '_' + getAdjustedDate(), getWheelDoneCount(cat) + 1);
  }
  function computeCategoryFraction(done, total){
    if(total <= 0) return 1; // nothing due today => full credit for this slice
    return Math.max(0, Math.min(1, done / total));
  }

  function computeWheelFill(){
    var today = getAdjustedDate();

    var habitsToday = getHabits().filter(function(h){ return isScheduledDay(h, today); });
    var habitsDone = habitsToday.filter(function(h){ return (h.completedDates||[]).indexOf(today) !== -1; }).length;
    var habitsFrac = computeCategoryFraction(habitsDone, habitsToday.length);

    var academicOpenToday = getDeadlines().filter(function(t){ return t.due && t.due <= today; }).length;
    var academicDone = getWheelDoneCount('academic');
    var academicFrac = computeCategoryFraction(academicDone, academicOpenToday + academicDone);

    var researchOpen = getLabTasks('kranker').concat(getLabTasks('ballard'))
      .filter(function(t){ return t.due && t.due <= today; }).length;
    var researchDone = getWheelDoneCount('research');
    var researchFrac = computeCategoryFraction(researchDone, researchOpen + researchDone);

    var socialFill = computeSocialWheelFill();
    var socialFrac = socialFill.frac;

    var morningDone = !!localStorage.getItem('la_checkin_morning_' + today);
    var nightDone = !!localStorage.getItem('la_checkin_night_' + today);
    var checkinsDone = (morningDone ? 1 : 0) + (nightDone ? 1 : 0);
    var checkinsFrac = computeCategoryFraction(checkinsDone, 2);

    var totalPct =
      habitsFrac * WHEEL_WEIGHTS.habits +
      academicFrac * WHEEL_WEIGHTS.academic +
      researchFrac * WHEEL_WEIGHTS.research +
      socialFrac * WHEEL_WEIGHTS.social +
      checkinsFrac * WHEEL_WEIGHTS.checkins;

    return {
      totalPct: totalPct,
      habits: { frac:habitsFrac, done:habitsDone, total:habitsToday.length },
      academic: { frac:academicFrac, done:academicDone, total:academicOpenToday + academicDone, open:academicOpenToday },
      research: { frac:researchFrac, done:researchDone, total:researchOpen + researchDone, open:researchOpen },
      social: { frac:socialFrac, done:socialFill.done, total:socialFill.total, open:socialFill.open },
      checkins: { frac:checkinsFrac, done:checkinsDone, total:2, morningDone:morningDone, nightDone:nightDone }
    };
  }

  /* Green->blue interpolation along the filled arc: each generated stop's
     hue is a function of its OWN position on the ring (0% => hue 120/green,
     100% => hue 240/blue), not of the current total fill — so the color
     at a given point on the ring stays consistent as the wheel fills. */
  function wheelGradientCss(pct){
    if(pct <= 0){
      return 'conic-gradient(from 0deg, rgba(255,255,255,0.10) 0% 100%)';
    }
    var steps = Math.max(2, Math.round(pct / 4));
    var stops = [];
    for(var i = 0; i <= steps; i++){
      var p = (pct * i) / steps;
      var hue = 120 + (p / 100) * 120;
      stops.push('hsl(' + hue.toFixed(1) + ',42%,42%) ' + p.toFixed(2) + '%');
    }
    stops.push('rgba(255,255,255,0.10) ' + pct.toFixed(2) + '%');
    stops.push('rgba(255,255,255,0.10) 100%');
    return 'conic-gradient(from 0deg, ' + stops.join(', ') + ')';
  }

  /* Same green->blue hue interpolation as wheelGradientCss/
     wheelGlowGradientCss, but for a single solid color at one point on
     the ring (used by the two radial "cut edge" glow lines rather than
     a sweep). */
  function wheelEdgeHueColor(p){
    var hue = 120 + (p / 100) * 120;
    return 'hsl(' + hue.toFixed(1) + ',90%,60%)';
  }

  /* Same hue interpolation as wheelGradientCss, but transparent past
     pct (instead of translucent white) so the blurred glow layer only
     ever lights up the filled arc, never the remaining track. */
  function wheelGlowGradientCss(pct){
    if(pct <= 0) return 'transparent';
    var steps = Math.max(2, Math.round(pct / 4));
    var stops = [];
    for(var i = 0; i <= steps; i++){
      var p = (pct * i) / steps;
      var hue = 120 + (p / 100) * 120;
      stops.push('hsl(' + hue.toFixed(1) + ',90%,60%) ' + p.toFixed(2) + '%');
    }
    stops.push('transparent ' + pct.toFixed(2) + '%');
    stops.push('transparent 100%');
    return 'conic-gradient(from 0deg, ' + stops.join(', ') + ')';
  }

  /* Streak: a day "qualifies" the first time its wheel percentage
     reaches 70% (recorded once, never un-recorded if it later dips).
     Current streak counts consecutive qualified days backward from
     today — mirrors computeHabitStreak's "don't break the streak just
     because today isn't done yet" rule. */
  var WHEEL_STREAK_THRESHOLD = 70;
  function getWheelStreakDays(){ return loadJSON('la_wheel_streak_days', []); }
  function markWheelStreakQualified(dateISO){
    var days = getWheelStreakDays();
    if(days.indexOf(dateISO) === -1){
      days.push(dateISO);
      saveJSON('la_wheel_streak_days', days);
    }
  }
  function computeWheelStreak(){
    var days = getWheelStreakDays();
    var cursor = getAdjustedDate();
    if(days.indexOf(cursor) === -1){ cursor = addDaysISO(cursor, -1); }
    var streak = 0, guard = 0;
    while(days.indexOf(cursor) !== -1 && guard++ < 3650){
      streak++;
      cursor = addDaysISO(cursor, -1);
    }
    return streak;
  }

  function updateWheelSubstatus(){
    var el = document.getElementById('wheel-substatus');
    if(!el) return;
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var now = new Date();
    var hours = now.getHours();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    var h12 = hours % 12 || 12;
    var mins = now.getMinutes();
    var minStr = mins < 10 ? '0' + mins : '' + mins;
    var streak = computeWheelStreak();
    el.textContent = days[now.getDay()] + ', ' + h12 + ':' + minStr + ' ' + ampm + '  ·  ' + streak + 'd streak';
  }

  function saveWheelSnapshot(fill){
    saveJSON('la_wheel_history_' + getAdjustedDate(), {
      totalPct: fill.totalPct,
      habits: fill.habits,
      academic: fill.academic,
      research: fill.research,
      social: fill.social,
      checkins: fill.checkins
    });
  }

  function renderWheel(){
    var ring = document.getElementById('progress-wheel');
    if(!ring) return;
    var fill = computeWheelFill();
    var pct = Math.max(0, Math.min(100, fill.totalPct));
    ring.style.setProperty('--pct', pct + '%');
    ring.style.background = wheelGradientCss(pct);
    var pctEl = document.getElementById('wheel-pct');
    if(pctEl) pctEl.textContent = Math.round(pct) + '%';

    var glow = document.getElementById('progress-wheel-glow');
    if(glow){
      glow.style.setProperty('--pct', pct + '%');
      glow.style.background = wheelGlowGradientCss(pct);
    }
    var edge = document.getElementById('progress-wheel-edge');
    if(edge){
      edge.style.setProperty('--pct', pct + '%');
      edge.style.background = wheelGlowGradientCss(pct);
    }
    var edgeInner = document.getElementById('progress-wheel-edge-inner');
    if(edgeInner){
      edgeInner.style.setProperty('--pct', pct + '%');
      edgeInner.style.background = wheelGlowGradientCss(pct);
    }
    var showCutEdges = pct > 0 && pct < 100;
    var edgeStart = document.getElementById('wheel-radial-edge-start');
    if(edgeStart){
      edgeStart.style.opacity = showCutEdges ? '1' : '0';
      edgeStart.style.background = wheelEdgeHueColor(0);
    }
    var edgeEnd = document.getElementById('wheel-radial-edge-end');
    if(edgeEnd){
      edgeEnd.style.opacity = showCutEdges ? '1' : '0';
      edgeEnd.style.background = wheelEdgeHueColor(pct);
      edgeEnd.style.transform = 'translate(-50%,-100%) rotate(' + (pct * 3.6) + 'deg)';
    }
    if(pct >= WHEEL_STREAK_THRESHOLD){ markWheelStreakQualified(getAdjustedDate()); }
    updateWheelSubstatus();

    var habitsCounter = document.getElementById('habit-mini-counter');
    if(habitsCounter) habitsCounter.textContent = fill.habits.done + ' / ' + fill.habits.total;
    var academicCounter = document.getElementById('spoke-academic-count');
    if(academicCounter) academicCounter.textContent = fill.academic.done + ' / ' + fill.academic.total;
    var researchCounter = document.getElementById('spoke-research-count');
    if(researchCounter) researchCounter.textContent = fill.research.done + ' / ' + fill.research.total;
    var socialCounter = document.getElementById('spoke-social-count');
    if(socialCounter) socialCounter.textContent = fill.social.done + ' / ' + fill.social.total;

    saveWheelSnapshot(fill);
  }

  function completeAcademicDeadline(id){
    var d = getDeadlines().find(function(t){ return t.id === id; });
    if(d && d.due && d.due <= getAdjustedDate()){ incrWheelDone('academic'); }
    deleteDeadlineImmediate(id);
    renderSpokeAcademic();
    renderWheel();
  }

  function renderSpokeAcademic(){
    /* Shows every deadline in the Deadlines card (not just what's due
       soon) — the wheel's denominator (computeWheelFill) still only
       counts overdue + due-today, independently of what's shown here.
       The list itself scrolls (.spoke-panel-list) once it outgrows the
       card, so a full backlog stays reachable without inflating the
       card's footprint. */
    var list = document.getElementById('spoke-academic-list');
    if(!list) return;
    var items = getDeadlines().slice()
      .sort(function(a,b){
        if(a.due !== b.due) return (a.due || '') < (b.due || '') ? -1 : 1;
        return (a.importance === 'Critical' ? -1 : 0) - (b.importance === 'Critical' ? -1 : 0);
      });
    list.innerHTML = !items.length
      ? '<div class="spoke-empty">Nothing due soon</div>'
      : items.map(function(t){
          var areaVal = Array.isArray(t.areas) ? (t.areas[0] || '') : (t.areas || '');
          var areaChip = areaVal ? '<span class="area-chip" style="background:'+areaColor(areaVal).bg+'; color:'+areaColor(areaVal).fg+';">'+escapeHtml(areaVal)+'</span>' : '';
          var status = computeStatus(t.due);
          var impCls = t.importance === 'Critical' ? ' is-critical' : (t.importance === 'Moderate' ? ' is-moderate' : '');
          return '<div class="spoke-row spoke-academic-row'+impCls+'">' +
              '<span class="task-cell"><span class="name">'+escapeHtml(t.name || 'Untitled')+'</span></span>' +
              '<div class="chip-row">'+areaChip+'</div>' +
              '<span class="'+status.cls+'">'+status.text+'</span>' +
              '<input type="checkbox" class="habit-checkbox" onclick="completeAcademicDeadline(\''+t.id+'\')">' +
            '</div>';
        }).join('');
    renderWheel();
  }

  function completeLabTask(lab, id){
    var today = getAdjustedDate();
    var task = getLabTasks(lab).find(function(t){ return t.id === id; });
    if(task && task.due && task.due <= today){ incrWheelDone('research'); }
    deleteLabTask(lab, id);
    renderSpokeResearch();
    renderWheel();
  }

  function renderSpokeResearch(){
    /* Shows every open Kranker/Ballard task (not just today's
       backlog) so newly-added undated tasks stay visible/editable —
       the wheel's denominator (computeWheelFill) still only counts
       due &lt;= today, independently of what's shown here. */
    var list = document.getElementById('spoke-research-list');
    if(!list) return;
    var today = getAdjustedDate();
    var items = ['kranker','ballard'].reduce(function(acc, lab){
      return acc.concat(getLabTasks(lab).map(function(t){ return { lab:lab, task:t }; }));
    }, []);
    list.innerHTML = !items.length
      ? '<div class="spoke-empty">No tasks</div>'
      : items.map(function(entry){
          var lab = entry.lab, t = entry.task;
          var isBacklog = t.due && t.due <= today;
          return '<div class="spoke-row spoke-row-lab-task'+(isBacklog ? ' is-backlog' : '')+'">' +
              '<span class="spoke-row-lab">'+(lab === 'kranker' ? 'K' : 'B')+'</span>' +
              '<textarea class="task-text-input" data-lab="'+lab+'" rows="1" placeholder="Task" oninput="autoGrowTaskInput(this); updateLabTaskField(\''+lab+'\',\''+t.id+'\',\'text\',this.value)">'+escapeHtml(t.text)+'</textarea>' +
              '<input type="date" class="task-date-input" value="'+(t.due || '')+'" onchange="updateLabTaskField(\''+lab+'\',\''+t.id+'\',\'due\',this.value)">' +
              '<input type="checkbox" class="habit-checkbox" onclick="completeLabTask(\''+lab+'\',\''+t.id+'\')">' +
            '</div>';
        }).join('');
    document.querySelectorAll('#spoke-research-list .task-text-input').forEach(autoGrowTaskInput);
    renderWheel();
  }

  /* Day/Night spoke cards embed the actual Morning/Night buttons (moved
     from the sidebar, see the removed .daycycle-buttons block) as
     static markup — only the mood block underneath is JS-managed, so
     re-rendering never clobbers the live button. Mood icon carries over
     from the old sidebar Today's Mood card (shared helper, not
     duplicated). */
  function renderSpokeDay(){
    var moodEl = document.getElementById('spoke-day-mood');
    if(!moodEl) return;
    var mData = loadJSON('la_checkin_morning_' + getAdjustedDate(), null);
    moodEl.innerHTML = sidebarMoodBlockHtml('morning', mData ? mData.mood : null);
    renderWheel();
  }

  function renderSpokeNight(){
    var moodEl = document.getElementById('spoke-night-mood');
    if(!moodEl) return;
    var nData = loadJSON('la_checkin_night_' + getAdjustedDate(), null);
    moodEl.innerHTML = sidebarMoodBlockHtml('night', nData ? nData.mood : null);
    renderWheel();
  }

  /* Spoke panels branch off the wheel at irregular angles/radii (not
     an even 72° apart) so the layout reads as organic rather than a
     mechanical star — matches the ask for "semi-random" placement.
     Day/Night flank angle 0 (the wheel's 12-o'clock seam, where the
     ring both starts at 0% and completes at 100%), one on each side.
     All coordinates are percentages of the square .wheel-stage box,
     so the SVG leader lines (viewBox 0 0 100 100) and the panels'
     left/top positioning always agree regardless of the stage's
     actual pixel size. */
  var SPOKE_LAYOUT = [
    { id:'day',      angle:339, panelR:43 },
    { id:'night',    angle:21,  panelR:43 },
    { id:'social',   angle:78,  panelR:16 },
    { id:'research', angle:133, panelR:28 },
    { id:'academic', angle:180, panelR:45 },
    { id:'habits',   angle:262, panelR:40 }
  ];
  function spokePoint(angleDeg, r){
    var rad = (angleDeg - 0) * Math.PI / 180;
    return { x: 50 + r * Math.sin(rad), y: 50 - r * Math.cos(rad) };
  }

  /* Per-card pixel offset from its plotted spoke point — starts out as
     each card's hand-tuned nudge (previously baked into CSS transforms)
     and is overwritten in place once the user drags a card, then
     persisted so the custom layout survives a reload. */
  var SPOKE_OFFSETS = Object.assign({
    day:      { dx:12,   dy:-18 },
    night:    { dx:16,   dy:-11 },
    social:   { dx:0,    dy:-28 },
    research: { dx:0,    dy:0 },
    academic: { dx:-145, dy:0 },
    habits:   { dx:0,    dy:-220 }
  }, loadJSON('la_spoke_offsets', {}));

  /* Per-card custom width/height (px), set by dragging the native
     resize handle — see makeSpokeResizable. Persisted separately from
     position (SPOKE_OFFSETS) so moving a card never resets its size
     and vice versa. Cards default to their CSS width/auto-height
     until a user resize writes an entry here. */
  var SPOKE_SIZES = loadJSON('la_spoke_sizes', {});

  function applySpokeSize(spokeId){
    var panelEl = document.getElementById('spoke-panel-' + spokeId);
    var size = panelEl && SPOKE_SIZES[spokeId];
    if(!panelEl || !size) return;
    if(size.w) panelEl.style.width = size.w + 'px';
    if(size.h) panelEl.style.height = size.h + 'px';
  }

  /* Native `resize:both` needs no JS to actually resize the element —
     the browser handles the drag itself. This just watches for a
     pointerdown that started in the resize corner, and on the matching
     pointerup reads back whatever size the browser landed on and
     persists it. */
  function makeSpokeResizable(spokeId){
    var panelEl = document.getElementById('spoke-panel-' + spokeId);
    if(!panelEl) return;
    var resizing = false;
    panelEl.addEventListener('pointerdown', function(e){
      resizing = isInResizeCorner(panelEl, e);
    });
    window.addEventListener('pointerup', function(){
      if(!resizing) return;
      resizing = false;
      var rect = panelEl.getBoundingClientRect();
      SPOKE_SIZES[spokeId] = { w: Math.round(rect.width), h: Math.round(rect.height) };
      saveJSON('la_spoke_sizes', SPOKE_SIZES);
    });
  }

  function applySpokeTransform(spokeId){
    var panelEl = document.getElementById('spoke-panel-' + spokeId);
    if(!panelEl) return;
    var off = SPOKE_OFFSETS[spokeId] || { dx:0, dy:0 };
    panelEl.style.transform = 'translate(calc(-50% + ' + off.dx + 'px), calc(-50% + ' + off.dy + 'px))';
  }

  /* Free-form cards — no leader lines tethering them to the ring
     anymore. SPOKE_LAYOUT's angle/panelR is still used purely as each
     card's initial scattered starting position (so first-run layout
     still looks organic rather than stacked), but nothing draws a
     connection to it once placed. */
  function layoutSpokes(){
    SPOKE_LAYOUT.forEach(function(spoke){
      var panelEl = document.getElementById('spoke-panel-' + spoke.id);
      var outer = spokePoint(spoke.angle, spoke.panelR);
      if(panelEl){
        panelEl.style.left = outer.x + '%';
        panelEl.style.top = outer.y + '%';
      }
      applySpokeTransform(spoke.id);
    });
  }

  /* Dragging: pointerdown starts tracking (unless it landed on an
     interactive child — buttons, inputs, checkboxes — which should
     keep working normally, not initiate a drag). Movement past a small
     threshold marks it a real drag, live-updates the card's transform
     and tether line, and — since the browser still fires a `click`
     right after the drag's pointerup — flags the panel so a single
     capturing click listener can swallow that one synthetic click
     without touching any other click on the card (e.g. a checkbox
     toggle, or a header click that opens a modal, both still work
     normally when there was no drag). */
  /* The native CSS `resize:both` handle lives in this bottom-right
     corner (browser-drawn, not a real DOM element) — both the drag
     system and the resize-persistence listener need to agree on where
     it is so a resize gesture doesn't also register as a card move. */
  var RESIZE_CORNER_PX = 16;
  function isInResizeCorner(panelEl, e){
    var rect = panelEl.getBoundingClientRect();
    return (rect.right - e.clientX) <= RESIZE_CORNER_PX && (rect.bottom - e.clientY) <= RESIZE_CORNER_PX;
  }

  function makeSpokeDraggable(spokeId){
    var panelEl = document.getElementById('spoke-panel-' + spokeId);
    if(!panelEl) return;
    var dragging = false, moved = false, startX = 0, startY = 0, startOff = { dx:0, dy:0 };
    var THRESH = 4;

    var pointerId = null;

    panelEl.addEventListener('pointerdown', function(e){
      if(e.target.closest('button, input, select, textarea, a')) return;
      if(isInResizeCorner(panelEl, e)) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      pointerId = e.pointerId;
      var off = SPOKE_OFFSETS[spokeId] || { dx:0, dy:0 };
      startOff = { dx: off.dx, dy: off.dy };
      /* Pointer capture is deferred until movement is confirmed (below)
         — capturing immediately on pointerdown causes the browser to
         retarget the trailing `click` event to panelEl itself, which
         silently breaks onclick handlers on header/child elements even
         for plain, non-drag clicks. */
    });

    panelEl.addEventListener('pointermove', function(e){
      if(!dragging) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if(!moved && Math.hypot(dx, dy) < THRESH) return;
      if(!moved) panelEl.setPointerCapture(pointerId);
      moved = true;
      panelEl.classList.add('spoke-dragging');
      SPOKE_OFFSETS[spokeId] = { dx: startOff.dx + dx, dy: startOff.dy + dy };
      applySpokeTransform(spokeId);
    });

    function endDrag(e){
      if(!dragging) return;
      dragging = false;
      panelEl.classList.remove('spoke-dragging');
      if(moved){
        panelEl._wasDragged = true;
        saveJSON('la_spoke_offsets', SPOKE_OFFSETS);
      }
    }
    panelEl.addEventListener('pointerup', endDrag);
    panelEl.addEventListener('pointercancel', endDrag);

    panelEl.addEventListener('click', function(e){
      if(panelEl._wasDragged){
        e.preventDefault();
        e.stopPropagation();
        panelEl._wasDragged = false;
      }
    }, true);
  }

  /* ============================================================
     Notepad card — la_notepad_tabs / la_notepad_active_tab /
     la_notepad_note_<tabId>
     Freeform Apple-Notes-style surface: binder-tab "pages" on the
     left, each an independent contenteditable note; a small
     formatting toolbar (plain text / checklist / numbered list /
     indent) sits above the writing surface. Restored from the
     pre-Phase-2 build (see git history b37df01) with page reordering
     added on top.
  ============================================================ */
  function getNotepadTabs(){
    return loadJSON('la_notepad_tabs', [
      { id:'quick-tasks', name:'Quick Tasks' },
      { id:'projects', name:'Projects' },
      { id:'scratchpad', name:'Scratchpad' }
    ]);
  }
  function saveNotepadTabs(list){ saveJSON('la_notepad_tabs', list); }

  function getActiveNotepadTabId(){
    var tabs = getNotepadTabs();
    var id = loadJSON('la_notepad_active_tab', tabs[0].id);
    return tabs.some(function(t){ return t.id === id; }) ? id : tabs[0].id;
  }
  function setActiveNotepadTabId(id){ saveJSON('la_notepad_active_tab', id); }

  function getNoteContent(id){ return loadJSON('la_notepad_note_' + id, ''); }
  function saveNoteContent(id, html){ saveJSON('la_notepad_note_' + id, html); }

  function notepadSurface(){ return document.getElementById('notepad-surface'); }

  function renderNotepadTabs(){
    var tabs = getNotepadTabs();
    var activeId = getActiveNotepadTabId();
    var wrap = document.getElementById('notepad-tabs');
    if(!wrap) return;
    wrap.innerHTML = tabs.map(function(t, i){
      var upDisabled = i === 0 ? ' disabled' : '';
      var downDisabled = i === tabs.length - 1 ? ' disabled' : '';
      return '<button type="button" class="notepad-tab' + (t.id === activeId ? ' active' : '') + '" onclick="switchNotepadTab(\'' + t.id + '\')" ondblclick="event.stopPropagation(); startRenameNotepadTab(\'' + t.id + '\', this)" title="Double-click to rename">' +
          '<span class="notepad-tab-label">' + escapeHtml(t.name) + '</span>' +
          '<span class="notepad-tab-actions">' +
            '<span class="notepad-tab-move' + upDisabled + '" onclick="event.stopPropagation(); moveNotepadTab(\'' + t.id + '\', -1)" title="Move up">&#9650;</span>' +
            '<span class="notepad-tab-move' + downDisabled + '" onclick="event.stopPropagation(); moveNotepadTab(\'' + t.id + '\', 1)" title="Move down">&#9660;</span>' +
            (tabs.length > 1 ? '<span class="notepad-tab-remove" onclick="event.stopPropagation(); deleteNotepadTab(\'' + t.id + '\')" title="Delete page">&times;</span>' : '') +
          '</span>' +
        '</button>';
    }).join('');
  }

  function moveNotepadTab(id, dir){
    var tabs = getNotepadTabs();
    var i = tabs.findIndex(function(t){ return t.id === id; });
    var j = i + dir;
    if(i < 0 || j < 0 || j >= tabs.length) return;
    var tmp = tabs[i]; tabs[i] = tabs[j]; tabs[j] = tmp;
    saveNotepadTabs(tabs);
    renderNotepadTabs();
  }

  function updateNotepadPlaceholder(){
    var surface = notepadSurface();
    if(!surface) return;
    var empty = surface.textContent.replace(/​/g, '').trim() === '';
    surface.classList.toggle('is-empty', empty);
  }

  function loadActiveNote(){
    var surface = notepadSurface();
    if(!surface) return;
    surface.innerHTML = getNoteContent(getActiveNotepadTabId());
    updateNotepadPlaceholder();
  }

  function saveActiveNote(){
    var surface = notepadSurface();
    if(!surface) return;
    saveNoteContent(getActiveNotepadTabId(), surface.innerHTML);
  }

  function notepadOnInput(){
    saveActiveNote();
    updateNotepadPlaceholder();
  }

  function switchNotepadTab(id){
    if(id === getActiveNotepadTabId()) return;
    saveActiveNote();
    setActiveNotepadTabId(id);
    renderNotepadTabs();
    loadActiveNote();
  }

  /* Inline add/rename instead of window.prompt() — prompt() is a
     no-op (silently returns null) in the sandboxed/embedded webviews
     this app sometimes runs in, which made "+" look completely dead
     there even though the handler itself was firing correctly. */
  function startAddNotepadTab(){
    var input = document.getElementById('notepad-tab-add-input');
    var btn = document.getElementById('notepad-add-tab-btn');
    if(!input || !btn) return;
    btn.style.display = 'none';
    input.style.display = '';
    input.value = '';
    input.focus();
  }

  function commitNotepadAddTab(){
    var input = document.getElementById('notepad-tab-add-input');
    var btn = document.getElementById('notepad-add-tab-btn');
    if(!input || !btn || input.style.display === 'none') return;
    var name = input.value.trim();
    input.style.display = 'none';
    btn.style.display = '';
    if(!name) return;
    saveActiveNote();
    var tabs = getNotepadTabs();
    var id = uid();
    tabs.push({ id: id, name: name });
    saveNotepadTabs(tabs);
    setActiveNotepadTabId(id);
    renderNotepadTabs();
    loadActiveNote();
  }

  function handleNotepadAddTabKeydown(e){
    if(e.key === 'Enter'){
      e.preventDefault();
      commitNotepadAddTab();
    } else if(e.key === 'Escape'){
      e.preventDefault();
      var input = document.getElementById('notepad-tab-add-input');
      var btn = document.getElementById('notepad-add-tab-btn');
      input.value = '';
      input.style.display = 'none';
      btn.style.display = '';
    }
  }

  function startRenameNotepadTab(id, tabEl){
    var tabs = getNotepadTabs();
    var tab = tabs.find(function(t){ return t.id === id; });
    var labelEl = tabEl.querySelector('.notepad-tab-label');
    if(!tab || !labelEl) return;
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'notepad-tab-rename-input';
    input.value = tab.name;
    input.onclick = function(e){ e.stopPropagation(); };
    input.onkeydown = function(e){
      if(e.key === 'Enter'){ e.preventDefault(); input.blur(); }
      else if(e.key === 'Escape'){ e.preventDefault(); input.dataset.cancelled = '1'; input.blur(); }
    };
    input.onblur = function(){
      if(input.dataset.cancelled !== '1'){
        var name = input.value.trim();
        if(name){
          var tabsNow = getNotepadTabs();
          var t = tabsNow.find(function(x){ return x.id === id; });
          if(t){ t.name = name; saveNotepadTabs(tabsNow); }
        }
      }
      renderNotepadTabs();
    };
    labelEl.replaceWith(input);
    input.focus();
    input.select();
  }

  function deleteNotepadTab(id){
    var tabs = getNotepadTabs();
    if(tabs.length <= 1) return;
    if(!confirm('Delete this page and its note? This cannot be undone.')) return;
    tabs = tabs.filter(function(t){ return t.id !== id; });
    saveNotepadTabs(tabs);
    localStorage.removeItem('la_notepad_note_' + id);
    if(!tabs.some(function(t){ return t.id === getActiveNotepadTabId(); })){
      setActiveNotepadTabId(tabs[0].id);
    }
    renderNotepadTabs();
    loadActiveNote();
  }

  function toggleNotepadSidebar(){
    var el = document.getElementById('notepad-dividers');
    if(!el) return;
    el.classList.toggle('collapsed');
    saveJSON('la_notepad_sidebar_collapsed', el.classList.contains('collapsed'));
  }

  /* ---------- Formatting toolbar ---------- */
  function getCurrentBlock(){
    var surface = notepadSurface();
    var sel = window.getSelection();
    if(!surface || !sel.rangeCount) return null;
    var node = sel.getRangeAt(0).startContainer;
    if(node.nodeType === 3) node = node.parentNode;
    while(node && node.parentNode !== surface && node !== surface){ node = node.parentNode; }
    return (node === surface || !node) ? null : node;
  }

  function placeCaretAtEnd(el){
    if(!el) return;
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function ensureBlock(){
    var surface = notepadSurface();
    var block = getCurrentBlock();
    if(block) return block;
    block = document.createElement('div');
    block.className = 'note-line';
    block.innerHTML = '<br>';
    surface.appendChild(block);
    placeCaretAtEnd(block);
    return block;
  }

  function notepadExec(cmd, val){
    notepadSurface().focus();
    document.execCommand(cmd, false, val || null);
    saveActiveNote();
    updateNotepadToolbarState();
  }

  function convertChecklistLineToPlain(block){
    var textEl = block.querySelector('.note-text');
    var html = textEl ? textEl.innerHTML : '';
    block.classList.remove('note-checklist-item', 'done');
    block.innerHTML = (html && html !== '<br>') ? html : '<br>';
  }

  function notepadSetPlain(){
    var surface = notepadSurface();
    surface.focus();
    try{
      if(document.queryCommandState('insertUnorderedList')) document.execCommand('insertUnorderedList');
      if(document.queryCommandState('insertOrderedList')) document.execCommand('insertOrderedList');
    }catch(e){}
    var block = getCurrentBlock();
    if(block && block.classList.contains('note-checklist-item')){
      convertChecklistLineToPlain(block);
      placeCaretAtEnd(block);
    }
    saveActiveNote();
    updateNotepadToolbarState();
  }

  function notepadToggleChecklist(){
    var surface = notepadSurface();
    surface.focus();
    var block = ensureBlock();
    if(block.classList.contains('note-checklist-item')){
      convertChecklistLineToPlain(block);
      placeCaretAtEnd(block);
    } else {
      var html = block.innerHTML === '<br>' ? '' : block.innerHTML;
      block.classList.add('note-checklist-item');
      block.innerHTML = '<span class="note-checkbox" contenteditable="false" onmousedown="event.preventDefault();" onclick="notepadToggleCheckboxState(this)"></span><span class="note-text" contenteditable="true">' + (html || '<br>') + '</span>';
      placeCaretAtEnd(block.querySelector('.note-text'));
    }
    saveActiveNote();
    updateNotepadToolbarState();
  }

  function notepadToggleCheckboxState(el){
    var line = el.closest('.note-checklist-item');
    if(!line) return;
    line.classList.toggle('done');
    saveActiveNote();
  }

  function handleNotepadKeydown(e){
    if(e.key !== 'Enter') return;
    var block = getCurrentBlock();
    if(!block || !block.classList.contains('note-checklist-item')) return;
    var textEl = block.querySelector('.note-text');
    var isEmpty = !textEl || textEl.textContent.trim() === '';
    e.preventDefault();
    if(isEmpty){
      convertChecklistLineToPlain(block);
      placeCaretAtEnd(block);
    } else {
      var newBlock = document.createElement('div');
      newBlock.className = 'note-line note-checklist-item';
      newBlock.innerHTML = '<span class="note-checkbox" contenteditable="false" onmousedown="event.preventDefault();" onclick="notepadToggleCheckboxState(this)"></span><span class="note-text" contenteditable="true"><br></span>';
      block.parentNode.insertBefore(newBlock, block.nextSibling);
      placeCaretAtEnd(newBlock.querySelector('.note-text'));
    }
    saveActiveNote();
  }

  function updateNotepadToolbarState(){
    var checklistBtn = document.querySelector('.notepad-tool-btn[data-tool="checklist"]');
    var numberedBtn = document.querySelector('.notepad-tool-btn[data-tool="numbered"]');
    var block = getCurrentBlock();
    if(checklistBtn) checklistBtn.classList.toggle('active', !!(block && block.classList.contains('note-checklist-item')));
    if(numberedBtn){
      var isOL = false;
      try{ isOL = document.queryCommandState('insertOrderedList'); }catch(e){}
      numberedBtn.classList.toggle('active', isOL);
    }
  }

  function initNotepad(){
    var dividersEl = document.getElementById('notepad-dividers');
    if(dividersEl && loadJSON('la_notepad_sidebar_collapsed', false)) dividersEl.classList.add('collapsed');
    renderNotepadTabs();
    loadActiveNote();
    var surface = notepadSurface();
    if(surface){
      surface.addEventListener('mouseup', updateNotepadToolbarState);
      surface.addEventListener('keyup', updateNotepadToolbarState);
    }
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
  renderSidebarHabits();
  renderSidebarSocial();
  renderSpokeAcademic();
  renderSpokeResearch();
  renderSpokeDay();
  renderSpokeNight();
  layoutSpokes();
  SPOKE_LAYOUT.forEach(function(spoke){
    applySpokeSize(spoke.id);
    makeSpokeDraggable(spoke.id);
    makeSpokeResizable(spoke.id);
  });
  renderWheel();
  initNotepad();
  loadWeather();
  initSpotifyWidget();
  initYoutubeWidget();
  updateSidebarDateTime();
  setInterval(updateSidebarDateTime, 1000);
  updateWheelSubstatus();
  setInterval(updateWheelSubstatus, 1000);
  runClockTick();
  setInterval(runClockTick, 60000);
