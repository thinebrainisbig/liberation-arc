/* ============================================================
   Hobbies subpage — extracted from hobbies-subpage.html's
   inline <script> block (Phase B reorg). Page-specific logic
   only; depends on js/core.js, js/weather-widget.js,
   js/spotify-widget.js, js/youtube-widget.js, js/core/daily-reset.js
   (load those first).
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


  /* ============================================================
     Storage helpers
     (loadJSON/saveJSON/uid/escapeHtml/escapeAttr/syncData/
     triggerImportData/handleImportFileSelected/isLateNightWindow/
     getAdjustedDate/notifyStateChange now live in js/core.js)
  ============================================================ */

  function todayISO(){
    return todayISOMidnight();
  }
  /* ============================================================
     Genre tags (shared free-text chip system — same pattern as
     academic-subpage.html's Areas)
  ============================================================ */
  var GENRE_PALETTE = [
    {bg:'rgba(251,146,60,0.16)', fg:'#fdba74'},
    {bg:'rgba(96,165,250,0.16)', fg:'#93c5fd'},
    {bg:'rgba(74,222,128,0.16)', fg:'#86efac'},
    {bg:'rgba(192,132,252,0.16)', fg:'#d8b4fe'},
    {bg:'rgba(34,211,238,0.16)', fg:'#67e8f9'},
    {bg:'rgba(248,113,113,0.16)', fg:'#fca5a5'},
    {bg:'rgba(250,204,21,0.16)', fg:'#fde047'}
  ];
  function genreColor(name){
    var hash = 0;
    for(var i=0;i<name.length;i++){ hash = (hash*31 + name.charCodeAt(i)) >>> 0; }
    return GENRE_PALETTE[hash % GENRE_PALETTE.length];
  }
  function getGenres(){ return loadJSON('la_hobbies_genres', ['Sci-Fi','Drama','Comedy']); }
  function saveGenres(list){ saveJSON('la_hobbies_genres', list); }
  function addGenre(name){
    name = name.trim();
    if(!name) return;
    var genres = getGenres();
    if(genres.indexOf(name) === -1){ genres.push(name); saveGenres(genres); }
  }
  function removeGenre(name){
    saveGenres(getGenres().filter(function(g){ return g !== name; }));
  }

  var currentHobbyGenres = [];

  function renderHobbyGenreChips(){
    var selectedWrap = document.getElementById('hobby-selected-genres');
    selectedWrap.innerHTML = currentHobbyGenres.map(function(g){
      var c = genreColor(g);
      return '<span class="chip" style="background:'+c.bg+'; color:'+c.fg+';">'+escapeHtml(g)+' <span class="remove-x" onclick="removeSelectedGenre(\''+encodeURIComponent(g)+'\')">&times;</span></span>';
    }).join('') || '<span class="due-placeholder" style="font-size:0.62rem;">No genres selected</span>';

    var suggWrap = document.getElementById('hobby-genre-suggestions');
    var allGenres = getGenres().filter(function(g){ return currentHobbyGenres.indexOf(g) === -1; });
    suggWrap.innerHTML = allGenres.map(function(g){
      return '<span class="chip suggestion" onclick="addSelectedGenre(\''+encodeURIComponent(g)+'\')">'+escapeHtml(g)+'</span>';
    }).join('');

    renderManageGenresList();
  }

  function addSelectedGenre(encoded){
    var name = decodeURIComponent(encoded);
    if(currentHobbyGenres.indexOf(name) === -1) currentHobbyGenres.push(name);
    renderHobbyGenreChips();
  }
  function removeSelectedGenre(encoded){
    var name = decodeURIComponent(encoded);
    currentHobbyGenres = currentHobbyGenres.filter(function(g){ return g !== name; });
    renderHobbyGenreChips();
  }

  function handleGenreInputKey(e){
    if(e.key === 'Enter' || e.key === ','){
      e.preventDefault();
      var input = document.getElementById('hobby-genre-input');
      var name = input.value.trim().replace(/,$/,'');
      if(name){
        addGenre(name);
        if(currentHobbyGenres.indexOf(name) === -1) currentHobbyGenres.push(name);
        input.value = '';
        renderHobbyGenreChips();
      }
    }
  }

  function toggleManageGenres(){
    var panel = document.getElementById('manage-genres-panel');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
    renderManageGenresList();
  }

  function renderManageGenresList(){
    var panel = document.getElementById('manage-genres-panel');
    if(panel.style.display === 'none') return;
    var genres = getGenres();
    panel.innerHTML = genres.length ? genres.map(function(g){
      return '<div class="manage-area-row"><span>'+escapeHtml(g)+'</span><span class="del-x" onclick="deleteGenreTag(\''+encodeURIComponent(g)+'\')">&times;</span></div>';
    }).join('') : '<div class="manage-area-row"><span style="color:var(--ink-faint);">No saved genres</span></div>';
  }

  function deleteGenreTag(encoded){
    var name = decodeURIComponent(encoded);
    removeGenre(name);
    currentHobbyGenres = currentHobbyGenres.filter(function(g){ return g !== name; });
    renderHobbyGenreChips();
  }

  /* ============================================================
     Books / Movies / Shows — la_books / la_movies / la_shows
     Shared CRUD + render across all three cards (type = 'books' | 'movies' | 'shows')
  ============================================================ */
  var currentHobbyType = null;
  var currentHobbyId = null;

  function getHobbyItems(type){ return loadJSON('la_' + type, []); }
  function saveHobbyItems(type, list){ saveJSON('la_' + type, list); }

  function typeLabel(type){
    return type === 'books' ? 'Book' : (type === 'movies' ? 'Movie' : 'Show');
  }
  function typeIcon(type){
    return type === 'books' ? 'book' : (type === 'movies' ? 'movie' : 'tv');
  }
  function parseSeasonEpisode(text){
    var m = /S\s*(\d+)\s*E\s*(\d+)/i.exec(text || '');
    if(m) return { season: parseInt(m[1],10), episode: parseInt(m[2],10) };
    return { season: 1, episode: 1 };
  }

  function renderHobbyCard(type){
    var items = getHobbyItems(type);
    var queue = items.filter(function(i){ return i.status === 'queue'; }).sort(function(a,b){ return (a.order||0)-(b.order||0); });

    if(type !== 'movies'){
      var currently = items.filter(function(i){ return i.status === 'currently'; });
      renderHobbyCurrently(type, currently);
    }
    renderHobbyQueue(type, queue);
    renderHobbyRatings(type);
  }

  function renderCurrentlyBox(type, item){
    if(type === 'books'){
      return '<div class="media-box">' +
          '<div class="hobby-clickable" onclick="openHobbyModal(\'books\',\''+item.id+'\')">' +
            '<div class="title">'+escapeHtml(item.title)+'</div>' +
            '<div class="subtitle">'+escapeHtml(item.author||'')+'</div>' +
          '</div>' +
          '<input type="range" class="hobby-progress-slider" min="0" max="100" step="1" value="'+(item.progress||0)+'" oninput="updateBookProgress(\''+item.id+'\', this.value)">' +
          '<div class="hobby-progress-label mono">'+(item.progress||0)+'%</div>' +
        '</div>';
    }
    var sophiaClass = item.sophia ? ' hobby-sophia-box' : '';
    var episodeClass = item.sophia ? ' sophia' : '';
    return '<div class="media-box'+sophiaClass+'">' +
        '<div class="hobby-clickable" onclick="openHobbyModal(\'shows\',\''+item.id+'\')">' +
          '<div class="title">'+escapeHtml(item.title)+'</div>' +
          '<div class="hobby-episode-subtitle'+episodeClass+'">S'+(item.season||1)+' E'+String(item.episode||1).padStart(2,'0')+'</div>' +
        '</div>' +
        '<button type="button" class="hobby-episode-btn" onclick="incrementEpisode(\'shows\',\''+item.id+'\')">+1 Episode</button>' +
      '</div>';
  }

  function renderHobbyCurrently(type, items){
    var wrap = document.getElementById(type + '-currently');
    if(!items.length){
      wrap.innerHTML = '<div class="media-empty">Nothing ' + (type === 'books' ? 'reading' : 'watching') + ' right now</div>';
      return;
    }
    wrap.innerHTML = '<div class="hobby-currently-stack">' + items.map(function(item){ return renderCurrentlyBox(type, item); }).join('') + '</div>';
  }

  function renderHobbyQueue(type, queue){
    var wrap = document.getElementById(type + '-queue');
    if(!queue.length){
      wrap.innerHTML = '<li class="media-empty" style="list-style:none;">' + (type === 'movies' ? 'Watchlist is empty' : 'Queue is empty') + '</li>';
      return;
    }
    if(type === 'movies'){
      wrap.innerHTML = queue.map(function(item){
        var sophiaTag = item.sophia ? ' <span class="hobby-sophia-tag">♥ Sophia</span>' : '';
        var sophiaClass = item.sophia ? ' hobby-sophia-box' : '';
        return '<li class="hobby-watchlist-item'+sophiaClass+'" draggable="true" data-id="'+item.id+'" ' +
          'ondragstart="handleHobbyDragStart(event,\'movies\',\''+item.id+'\')" ' +
          'ondragover="handleHobbyDragOver(event, this)" ' +
          'ondragleave="handleHobbyDragLeave(event, this)" ' +
          'ondrop="handleHobbyDrop(event,\'movies\',\''+item.id+'\')" ' +
          'onclick="openHobbyModal(\'movies\',\''+item.id+'\')">' +
          '<span class="material-symbols-outlined hobby-drag-handle">drag_indicator</span>' +
          '<span class="title">'+escapeHtml(item.title)+sophiaTag+'</span>' +
        '</li>';
      }).join('');
      return;
    }
    wrap.innerHTML = queue.map(function(item){
      var sub = (type === 'books' && item.author) ? ' <span class="hobby-queue-sub">— '+escapeHtml(item.author)+'</span>' : '';
      var sophiaTag = (type === 'shows' && item.sophia) ? ' <span class="hobby-sophia-tag">♥ Sophia</span>' : '';
      var sophiaClass = (type === 'shows' && item.sophia) ? ' hobby-sophia-row' : '';
      return '<li class="hobby-queue-item'+sophiaClass+'" draggable="true" data-id="'+item.id+'" ' +
        'ondragstart="handleHobbyDragStart(event,\''+type+'\',\''+item.id+'\')" ' +
        'ondragover="handleHobbyDragOver(event, this)" ' +
        'ondragleave="handleHobbyDragLeave(event, this)" ' +
        'ondrop="handleHobbyDrop(event,\''+type+'\',\''+item.id+'\')" ' +
        'onclick="openHobbyModal(\''+type+'\',\''+item.id+'\')">' +
        '<span class="material-symbols-outlined hobby-drag-handle">drag_indicator</span>' +
        '<span class="hobby-queue-text">'+escapeHtml(item.title)+sub+sophiaTag+'</span>' +
      '</li>';
    }).join('');
  }

  /* Rating → highlight color scale */
  var RATING_COLOR_STEPS = [
    { below:3,   hex:'#e74c3c' },
    { below:5,   hex:'#e67e22' },
    { below:7,   hex:'#f1c40f' },
    { below:8.5, hex:'#2ecc71' },
    { below:9.5, hex:'#1abc9c' },
    { below:Infinity, hex:'#3498db' }
  ];
  function getRatingColor(rating){
    if(rating === undefined || rating === null || isNaN(rating)) return null;
    for(var i=0;i<RATING_COLOR_STEPS.length;i++){
      if(rating < RATING_COLOR_STEPS[i].below) return RATING_COLOR_STEPS[i].hex;
    }
    return RATING_COLOR_STEPS[RATING_COLOR_STEPS.length-1].hex;
  }
  function hexToRgba(hex, alpha){
    var r = parseInt(hex.slice(1,3),16);
    var g = parseInt(hex.slice(3,5),16);
    var b = parseInt(hex.slice(5,7),16);
    return 'rgba('+r+','+g+','+b+','+alpha+')';
  }

  function formatCompletedDate(iso){
    if(!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  var hobbyRatingEditing = {};

  function renderHobbyRatings(type){
    var completed = getHobbyItems(type).filter(function(i){ return i.status === 'completed'; });
    var sortSelect = document.getElementById(type + '-sort');
    var sortVal = sortSelect ? sortSelect.value : 'default';
    if(sortVal === 'rating'){
      completed = completed.slice().sort(function(a,b){ return (b.rating||0) - (a.rating||0); });
    } else if(sortVal === 'date-desc'){
      completed = completed.slice().sort(function(a,b){ return (b.completedDate||'').localeCompare(a.completedDate||''); });
    } else if(sortVal === 'date-asc'){
      completed = completed.slice().sort(function(a,b){ return (a.completedDate||'').localeCompare(b.completedDate||''); });
    }
    var wrap = document.getElementById(type + '-ratings');
    if(!completed.length){
      wrap.innerHTML = '<div class="media-empty">Nothing completed yet</div>';
      return;
    }
    wrap.innerHTML = completed.map(function(item){
      var color = getRatingColor(item.rating);
      var rowStyle = color ? ('border-left-color:'+color+'; box-shadow:inset 3px 0 10px -6px '+hexToRgba(color,0.6)+';') : '';
      var titleStyle = color ? ('color:'+color+';') : '';
      var badgeStyle = color ? ('background:'+hexToRgba(color,0.18)+'; border-color:'+hexToRgba(color,0.55)+'; color:'+color+';') : '';
      var dateText = item.completedDate ? ' <span class="hobby-rating-date">· '+formatCompletedDate(item.completedDate)+'</span>' : '';
      var editing = !!hobbyRatingEditing[type+'|'+item.id];
      var ratingHtml;
      if(item.rating !== undefined && !editing){
        ratingHtml = '<span class="hobby-rating-value mono hobby-clickable" style="color:'+color+';" onclick="event.stopPropagation(); editHobbyRating(\''+type+'\',\''+item.id+'\');">'+item.rating+'</span>';
      } else {
        ratingHtml = '<input type="number" class="hobby-rating-input mono" data-rating-id="'+item.id+'" min="0" max="10" step="0.1" value="'+(item.rating !== undefined ? item.rating : '')+'" placeholder="—" style="'+badgeStyle+'" onclick="event.stopPropagation();" onchange="updateHobbyRating(\''+type+'\',\''+item.id+'\', this.value)" onblur="finishHobbyRatingEdit(\''+type+'\',\''+item.id+'\')">';
      }
      return '<div class="hobby-rating-row" style="'+rowStyle+'">' +
        '<span class="hobby-rating-title hobby-clickable" onclick="openHobbyModal(\''+type+'\',\''+item.id+'\')" title="'+escapeAttr(item.title)+'" style="'+titleStyle+'">'+escapeHtml(item.title)+dateText+'</span>' +
        ratingHtml +
      '</div>';
    }).join('');

    var focusId = Object.keys(hobbyRatingEditing).filter(function(k){ return hobbyRatingEditing[k] && k.indexOf(type+'|') === 0; })[0];
    if(focusId){
      var input = wrap.querySelector('input[data-rating-id="'+focusId.split('|')[1]+'"]');
      if(input){ input.focus(); input.select(); }
    }
  }

  function editHobbyRating(type, id){
    hobbyRatingEditing[type+'|'+id] = true;
    renderHobbyRatings(type);
  }

  function finishHobbyRatingEdit(type, id){
    delete hobbyRatingEditing[type+'|'+id];
    renderHobbyRatings(type);
  }

  function updateHobbyRating(type, id, value){
    var items = getHobbyItems(type);
    var item = items.find(function(i){ return i.id === id; });
    if(!item) return;
    var v = parseFloat(value);
    item.rating = isNaN(v) ? undefined : Math.max(0, Math.min(10, Math.round(v*10)/10));
    saveHobbyItems(type, items);
    delete hobbyRatingEditing[type+'|'+id];
    renderHobbyRatings(type);
  }

  function openHobbyModal(type, id){
    currentHobbyType = type;
    currentHobbyId = id || null;
    var deleteBtn = document.getElementById('hobby-delete-btn');
    deleteBtn.closest('.modal-actions-row').classList.toggle('has-delete', !!id);
    document.getElementById('hobby-author-group').style.display = type === 'books' ? 'block' : 'none';
    document.getElementById('hobby-episode-group').style.display = type === 'shows' ? 'block' : 'none';
    document.getElementById('hobby-sophia-group').style.display = (type === 'movies' || type === 'shows') ? 'block' : 'none';
    document.getElementById('hobby-status-currently-option').style.display = type === 'movies' ? 'none' : '';
    document.getElementById('hobby-modal-icon').textContent = typeIcon(type);

    if(id){
      var item = getHobbyItems(type).find(function(i){ return i.id === id; });
      document.getElementById('hobby-modal-title').textContent = 'Edit ' + typeLabel(type);
      deleteBtn.style.display = 'inline-block';
      document.getElementById('hobby-title').value = item.title || '';
      document.getElementById('hobby-author').value = item.author || '';
      document.getElementById('hobby-episode-input').value = item.season ? ('S'+item.season+' E'+String(item.episode||1).padStart(2,'0')) : '';
      document.getElementById('hobby-sophia').checked = !!item.sophia;
      document.getElementById('hobby-status').value = item.status || 'queue';
      currentHobbyGenres = (item.genres || []).slice();
    } else {
      document.getElementById('hobby-modal-title').textContent = 'Add ' + typeLabel(type);
      deleteBtn.style.display = 'none';
      document.getElementById('hobby-title').value = '';
      document.getElementById('hobby-author').value = '';
      document.getElementById('hobby-episode-input').value = '';
      document.getElementById('hobby-sophia').checked = false;
      document.getElementById('hobby-status').value = 'queue';
      currentHobbyGenres = [];
    }
    document.getElementById('hobby-genre-input').value = '';
    document.getElementById('manage-genres-panel').style.display = 'none';
    renderHobbyGenreChips();
    openModal('hobby-modal');
  }

  function saveHobbyForm(){
    var title = document.getElementById('hobby-title').value.trim();
    if(!title){ document.getElementById('hobby-title').focus(); return; }
    var type = currentHobbyType;
    var status = document.getElementById('hobby-status').value;
    var items = getHobbyItems(type);

    var item = currentHobbyId ? items.find(function(i){ return i.id === currentHobbyId; }) : null;
    if(!item){
      item = { id: uid() };
      items.push(item);
    }
    var prevStatus = item.status;
    item.title = title;
    item.genres = currentHobbyGenres.slice();

    if(type === 'books'){
      item.author = document.getElementById('hobby-author').value.trim();
      if(item.progress === undefined) item.progress = 0;
    } else if(type === 'movies'){
      item.sophia = document.getElementById('hobby-sophia').checked;
    } else if(type === 'shows'){
      var parsed = parseSeasonEpisode(document.getElementById('hobby-episode-input').value);
      item.season = parsed.season;
      item.episode = parsed.episode;
      item.sophia = document.getElementById('hobby-sophia').checked;
    }

    if(status === 'queue' && prevStatus !== 'queue'){
      var maxOrder = items.filter(function(i){ return i.status === 'queue' && i.id !== item.id; })
        .reduce(function(m,i){ return Math.max(m, i.order||0); }, -1);
      item.order = maxOrder + 1;
    }

    if(status === 'completed' && prevStatus !== 'completed'){
      openCompleteModal(type, items, item);
      return;
    }

    item.status = status;
    saveHobbyItems(type, items);
    renderHobbyCard(type);
    closeModal('hobby-modal');
  }

  /* ---- Mark as Completed modal (prompts for a completion date) ---- */
  var pendingComplete = null;

  function openCompleteModal(type, items, item){
    pendingComplete = { type: type, items: items, item: item };
    document.getElementById('complete-modal-item-title').textContent = item.title;
    document.getElementById('complete-date-input').value = todayISO();
    closeModal('hobby-modal');
    openModal('complete-modal');
  }

  function setCompleteDateToday(){
    document.getElementById('complete-date-input').value = todayISO();
  }

  function cancelCompleteModal(){
    pendingComplete = null;
    closeModal('complete-modal');
  }

  function confirmCompleteModal(){
    if(!pendingComplete) return;
    var dateVal = document.getElementById('complete-date-input').value || todayISO();
    pendingComplete.item.status = 'completed';
    pendingComplete.item.completedDate = dateVal;
    saveHobbyItems(pendingComplete.type, pendingComplete.items);
    renderHobbyCard(pendingComplete.type);
    closeModal('complete-modal');
    pendingComplete = null;
  }

  function deleteHobbyItem(){
    if(!currentHobbyId) return;
    var type = currentHobbyType;
    saveHobbyItems(type, getHobbyItems(type).filter(function(i){ return i.id !== currentHobbyId; }));
    renderHobbyCard(type);
    closeModal('hobby-modal');
  }

  function incrementEpisode(type, id){
    var items = getHobbyItems(type);
    var item = items.find(function(i){ return i.id === id; });
    if(!item) return;
    item.episode = (item.episode || 1) + 1;
    saveHobbyItems(type, items);
    renderHobbyCard(type);
  }

  function updateBookProgress(id, value){
    var items = getHobbyItems('books');
    var item = items.find(function(i){ return i.id === id; });
    if(!item) return;
    item.progress = parseInt(value, 10);
    saveHobbyItems('books', items);
    var label = document.querySelector('#books-currently .hobby-progress-label');
    if(label) label.textContent = item.progress + '%';
  }

  /* ---- Queue drag-to-reorder ---- */
  var dragHobby = { type:null, id:null };

  function handleHobbyDragStart(e, type, id){
    dragHobby = { type: type, id: id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }
  function handleHobbyDragOver(e, el){
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drag-over');
  }
  function handleHobbyDragLeave(e, el){
    el.classList.remove('drag-over');
  }
  function handleHobbyDrop(e, type, targetId){
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    if(dragHobby.type !== type || !dragHobby.id || dragHobby.id === targetId){
      dragHobby = { type:null, id:null };
      return;
    }
    var items = getHobbyItems(type);
    var queue = items.filter(function(i){ return i.status === 'queue'; }).sort(function(a,b){ return (a.order||0)-(b.order||0); });
    var fromIdx = queue.findIndex(function(i){ return i.id === dragHobby.id; });
    var toIdx = queue.findIndex(function(i){ return i.id === targetId; });
    if(fromIdx === -1 || toIdx === -1){
      dragHobby = { type:null, id:null };
      return;
    }
    var moved = queue.splice(fromIdx,1)[0];
    queue.splice(toIdx,0,moved);
    queue.forEach(function(item,idx){ item.order = idx; });
    saveHobbyItems(type, items);
    renderHobbyCard(type);
    dragHobby = { type:null, id:null };
  }

  /* ============================================================
     Certifications & Courses — la_certifications
  ============================================================ */
  var currentCertId = null;

  function getCertifications(){ return loadJSON('la_certifications', []); }
  function saveCertifications(list){ saveJSON('la_certifications', list); }

  function renderCertifications(){
    var items = getCertifications();
    var active = items.filter(function(i){ return i.status === 'in_progress'; });
    var queued = items.filter(function(i){ return i.status === 'queued'; });
    var completed = items.filter(function(i){ return i.status === 'completed'; });

    var activeWrap = document.getElementById('cert-active-list');
    activeWrap.innerHTML = active.length ? active.map(function(item){
      var pct = item.progress || 0;
      return '<div class="cert-block hobby-clickable" onclick="openCertModal(\''+item.id+'\')">' +
          '<div class="cert-head">' +
            '<div>' +
              '<div class="title">'+escapeHtml(item.name)+'</div>' +
              '<div class="sub">'+escapeHtml(item.provider||'')+'</div>' +
            '</div>' +
            '<span class="pct">'+pct+'%</span>' +
          '</div>' +
          '<div class="cert-track"><div class="cert-fill" style="width:'+pct+'%;"></div></div>' +
        '</div>';
    }).join('') : '<div class="media-empty">No active courses</div>';

    var queueWrap = document.getElementById('cert-queue-list');
    queueWrap.innerHTML = queued.length ? queued.map(function(item){
      var sub = item.provider ? ' <span class="hobby-queue-sub">— '+escapeHtml(item.provider)+'</span>' : '';
      return '<li class="hobby-queue-item" onclick="openCertModal(\''+item.id+'\')">' +
          '<span class="hobby-queue-text">'+escapeHtml(item.name)+sub+'</span>' +
        '</li>';
    }).join('') : '<li class="media-empty" style="list-style:none;">Nothing queued</li>';

    var completedWrap = document.getElementById('cert-completed-list');
    completedWrap.innerHTML = completed.length ? completed.map(function(item){
      return '<div class="cert-completed-item" onclick="openCertModal(\''+item.id+'\')">' +
          '<span class="material-symbols-outlined" style="color:#6ee7b7; font-size:16px; flex-shrink:0;">check_circle</span>' +
          '<div class="cert-completed-text">' +
            '<div class="title">'+escapeHtml(item.name)+'</div>' +
            '<div class="sub">'+escapeHtml(item.provider||'')+'</div>' +
          '</div>' +
        '</div>';
    }).join('') : '<div class="media-empty" style="grid-column:1/-1;">Nothing completed yet</div>';
  }

  function openCertModal(id){
    currentCertId = id || null;
    var deleteBtn = document.getElementById('cert-delete-btn');
    deleteBtn.closest('.modal-actions-row').classList.toggle('has-delete', !!id);
    if(id){
      var item = getCertifications().find(function(i){ return i.id === id; });
      document.getElementById('cert-modal-title').textContent = 'Edit Course';
      deleteBtn.style.display = 'inline-block';
      document.getElementById('cert-name').value = item.name || '';
      document.getElementById('cert-provider').value = item.provider || '';
      document.getElementById('cert-progress').value = item.progress || 0;
      document.getElementById('cert-progress-value').textContent = (item.progress||0) + '%';
      document.getElementById('cert-status').value = item.status || 'in_progress';
      document.getElementById('cert-link').value = item.link || '';
    } else {
      document.getElementById('cert-modal-title').textContent = 'Add Course';
      deleteBtn.style.display = 'none';
      document.getElementById('cert-name').value = '';
      document.getElementById('cert-provider').value = '';
      document.getElementById('cert-progress').value = 0;
      document.getElementById('cert-progress-value').textContent = '0%';
      document.getElementById('cert-status').value = 'in_progress';
      document.getElementById('cert-link').value = '';
    }
    openModal('cert-modal');
  }

  function saveCertForm(){
    var name = document.getElementById('cert-name').value.trim();
    if(!name){ document.getElementById('cert-name').focus(); return; }
    var items = getCertifications();
    var item = currentCertId ? items.find(function(i){ return i.id === currentCertId; }) : null;
    if(!item){
      item = { id: uid() };
      items.push(item);
    }
    item.name = name;
    item.provider = document.getElementById('cert-provider').value.trim();
    item.progress = parseInt(document.getElementById('cert-progress').value, 10) || 0;
    item.status = document.getElementById('cert-status').value;
    item.link = document.getElementById('cert-link').value.trim();
    saveCertifications(items);
    renderCertifications();
    closeModal('cert-modal');
  }

  function deleteCertification(){
    if(!currentCertId) return;
    saveCertifications(getCertifications().filter(function(i){ return i.id !== currentCertId; }));
    renderCertifications();
    closeModal('cert-modal');
  }

  /* addDaysISO/getPreviousProductivityDate/isNightCheckinMissed/
     maybeRedirectForNightCheckin now live in js/core/daily-reset.js. */

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
    if(e.key === 'la_books'){ renderHobbyCard('books'); }
    else if(e.key === 'la_movies'){ renderHobbyCard('movies'); }
    else if(e.key === 'la_shows'){ renderHobbyCard('shows'); }
    else if(e.key === 'la_hobbies_genres'){
      if(document.getElementById('hobby-modal').classList.contains('open')){ renderHobbyGenreChips(); }
    }
    else if(e.key === 'la_certifications'){ renderCertifications(); }
  }
  window.addEventListener('storage', handleStorageSync);
  window.addEventListener('state-change', function(e){ handleStorageSync({ key: e.detail.key }); });

  /* ============================================================
     Daily reset at 5AM — refresh check-in badges and nutrition
     entry for the new day. Only fires once
     per adjusted day (la_last_reset_date, 5AM-adjusted YYYY-MM-DD).
     checkDailyReset/performDailyReset/runClockTick/
     updateLateNightMode/updateSidebarDateTime/clearTodayNutritionEntry
     now live in js/core/daily-reset.js; this page just registers its
     extra reset steps as a hook.
  ============================================================ */
  registerDailyResetHook(function(){
    clearTodayNutritionEntry();
    if(typeof renderMoodCard === 'function'){ renderMoodCard(); }
    if(typeof renderSplitPlanner === 'function'){ renderSplitPlanner(); }
    if(typeof renderSplitCalendar === 'function'){ renderSplitCalendar(); }
    if(typeof renderNutritionCard === 'function'){ renderNutritionCard(); }
  });

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
  ['books','movies','shows'].forEach(function(type){ renderHobbyCard(type); });
  renderCertifications();
  loadWeather();
  initSpotifyWidget();
  initYoutubeWidget();
  updateSidebarDateTime();
  setInterval(updateSidebarDateTime, 1000);
  runClockTick();
  setInterval(runClockTick, 60000);
