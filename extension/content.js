(function () {
  // Prevent double-injection on SPA navigations
  if (window.__nyuOrganizerActive) return;
  window.__nyuOrganizerActive = true;

  var targetDoc = window.top.document;

  // Toolbar button toggles panel show/hide
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg.action !== 'togglePanel') return;
    var p = targetDoc.getElementById('__nyu-panel');
    if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
  });

  // ── Gather text from this page + all same-origin iframes ─────────────────
  function gatherText(doc) {
    var text = '';
    try { text += (doc.body.innerText || ''); } catch(e) {}
    try {
      var frames = doc.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        try { text += '\n' + gatherText(frames[i].contentDocument); } catch(e) {}
      }
    } catch(e) {}
    return text;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  var DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  var DAY_MAP = {
    mon:'Monday',tue:'Tuesday',wed:'Wednesday',thu:'Thursday',fri:'Friday',sat:'Saturday',sun:'Sunday',
    mo:'Monday',tu:'Tuesday',we:'Wednesday',th:'Thursday',fr:'Friday',sa:'Saturday',su:'Sunday'
  };

  function expandDays(str) {
    return str.split(/[,\s]+/).map(function(d) {
      return DAY_MAP[d.toLowerCase().slice(0,3)] || DAY_MAP[d.toLowerCase().slice(0,2)] || null;
    }).filter(Boolean);
  }

  function parseTime(str) {
    var m = str.trim().match(/^(\d{1,2})\.(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    var h = parseInt(m[1]), mn = parseInt(m[2]), ap = m[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + mn;
  }

  function fmt12(t) {
    if (t == null) return '';
    var h = Math.floor(t/60), m = t%60, ap = h>=12?'PM':'AM', h12=h%12||12;
    return h12+':'+(m<10?'0':'')+m+' '+ap;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function shortLoc(loc) {
    var r = loc.match(/Room\s+(\S+)/i), p = loc.match(/\(([^)]+)\)/);
    if (p && r) return p[1].split(/\s+/).map(function(w){return w[0];}).join('').toUpperCase()+' Rm '+r[1];
    return r ? 'Rm '+r[1] : loc.slice(0,30);
  }

  // ── Parser ────────────────────────────────────────────────────────────────
  function normalizeText(raw) {
    var lines = raw.split('\n'), out = [], i = 0;
    var schedStart = /^\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}/;
    while (i < lines.length) {
      var line = lines[i].trim();
      if (schedStart.test(line)) {
        var joined = line;
        while (i+1 < lines.length) {
          var next = lines[i+1].trim();
          if (!next) break;
          if (/^(Class#|Section|Class Status|Grading|Instruction|Course Location|Component|Notes|Visit|Select|Session):/.test(next)) break;
          if (/^[A-Z]{2,}-[A-Z]{2}\s+\d+/.test(next)) break;
          if (schedStart.test(next)) break;
          joined += ' ' + next;
          i++;
        }
        out.push(joined);
      } else {
        out.push(line);
      }
      i++;
    }
    return out.join('\n');
  }

  var SCHED_RE = /\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}\/\d{2}\/\d{4}\s+([\w,]+)\s+(\d{1,2}\.\d{2}\s*[AP]M)\s*-\s*(\d{1,2}\.\d{2}\s*[AP]M)\s+at\s+(.+?)(?:\s+with\s+(.+?))?(?:\s*(?:Notes?:|$))/i;

  function parse(raw) {
    var text = normalizeText(raw);
    var lines = text.split('\n'), sections = [], cur = null, blk = {};
    function flush() {
      if (!blk.sched) return;
      var m = blk.sched.match(SCHED_RE);
      if (!m) { blk={}; return; }
      var days=expandDays(m[1]), s=parseTime(m[2]), e=parseTime(m[3]);
      if (days.length && s!=null) {
        sections.push({ courseCode:blk.code||(cur&&cur.c)||'', section:blk.sec||'', classNum:blk.num||'', component:blk.comp||'', status:blk.stat||'', days:days, startMin:s, endMin:e, location:(m[4]||'').trim(), instructor:(m[5]||'').trim() });
      }
      blk={};
    }
    for (var i=0; i<lines.length; i++) {
      var ln=lines[i].trim(); if (!ln) continue;
      if (/^\s*[A-Z]{2,}-[A-Z]{2}\s+\d+\s*\|\s*\d+\s*units/.test(ln)) { var cm=ln.match(/([A-Z]{2,}-[A-Z]{2}\s+\d+)/); if(cm){cur={c:cm[1]};flush();} }
      else if (/^[A-Z]{2,}-[A-Z]{2}\s+\d+/.test(ln)&&ln.indexOf('Class#')!==0) { if(!blk.code)blk.code=ln.split(/\s+/).slice(0,2).join(' '); }
      else if (/^Class#:\s*(\d+)/.test(ln)) { flush(); blk.num=ln.match(/^Class#:\s*(\d+)/)[1]; if(cur)blk.code=cur.c; }
      else if (/^Section:\s*(\S+)/.test(ln)) { blk.sec=ln.match(/^Section:\s*(\S+)/)[1]; }
      else if (/^Class Status:\s*(.+)/.test(ln)) { blk.stat=ln.match(/^Class Status:\s*(.+)/)[1].trim(); }
      else if (/^Component:\s*(.+)/.test(ln)) { blk.comp=ln.match(/^Component:\s*(.+)/)[1].trim(); }
      else if (SCHED_RE.test(ln)) { blk.sched=ln; }
    }
    flush(); return sections;
  }

  // ── UI helpers ────────────────────────────────────────────────────────────
  var COLORS = {
    lecture:    {border:'#57068c',code:'#57068c',bdgBg:'#f3e8ff',bdgTxt:'#57068c'},
    recitation: {border:'#0062cc',code:'#0062cc',bdgBg:'#dbeafe',bdgTxt:'#1d4ed8'},
    lab:        {border:'#28a745',code:'#28a745',bdgBg:'#dcfce7',bdgTxt:'#166534'},
    seminar:    {border:'#fd7e14',code:'#fd7e14',bdgBg:'#ffedd5',bdgTxt:'#9a3412'},
    other:      {border:'#adb5bd',code:'#6c757d',bdgBg:'#e9ecef',bdgTxt:'#6c757d'}
  };
  var STATUS = {
    open:     {bg:'#dcfce7',txt:'#15803d'},
    waitlist: {bg:'#fef9c3',txt:'#854d0e'},
    closed:   {bg:'#fee2e2',txt:'#b91c1c'}
  };

  function compType(c) {
    if (!c) return 'other';
    var l = c.toLowerCase();
    if (l.indexOf('lecture')>=0)    return 'lecture';
    if (l.indexOf('recitation')>=0) return 'recitation';
    if (l.indexOf('lab')>=0)        return 'lab';
    if (l.indexOf('seminar')>=0)    return 'seminar';
    return 'other';
  }

  function statusInfo(s) {
    if (!s) return {key:'open',label:'Open'};
    var l = s.toLowerCase();
    if (l.indexOf('wait')>=0)                          return {key:'waitlist',label:'Wait'};
    if (l.indexOf('closed')>=0||l.indexOf('full')>=0) return {key:'closed',label:'Closed'};
    return {key:'open',label:'Open'};
  }

  function timeOptions(val, mode) {
    var def = mode==='start' ? 0 : 1440;
    var h = '<option value="'+def+'"'+(val===def?' selected':'')+'>Any</option>';
    for (var t=360; t<=1440; t+=30) {
      if (mode==='start'&&t===1440) continue;
      h += '<option value="'+t+'"'+(val===t?' selected':'')+'>'+fmt12(t)+'</option>';
    }
    return h;
  }

  // ── Filter state ──────────────────────────────────────────────────────────
  var allSections = [];
  var activeInstructors = {};

  function applyFilters() {
    var s0 = parseInt(targetDoc.getElementById('nf-start').value);
    var e0 = parseInt(targetDoc.getElementById('nf-end').value);
    var keys = Object.keys(activeInstructors);
    var filtered = allSections.filter(function(s) {
      return s.startMin>=s0 && s.endMin<=e0 && (keys.length===0 || !s.instructor || activeInstructors[s.instructor]);
    });
    renderSections(filtered, allSections.length);
  }

  function toggleInstructor(name) {
    if (activeInstructors[name]) delete activeInstructors[name]; else activeInstructors[name]=true;
    targetDoc.querySelectorAll('.nf-chip').forEach(function(c) {
      var active = activeInstructors[c.getAttribute('data-n')];
      c.style.background  = active ? '#57068c' : '#fff';
      c.style.color       = active ? '#fff'    : '#6c757d';
      c.style.borderColor = active ? '#57068c' : '#e9ecef';
    });
    applyFilters();
  }

  function resetFilters() {
    targetDoc.getElementById('nf-start').value = 0;
    targetDoc.getElementById('nf-end').value   = 1440;
    activeInstructors = {};
    targetDoc.querySelectorAll('.nf-chip').forEach(function(c){
      c.style.background='#fff'; c.style.color='#6c757d'; c.style.borderColor='#e9ecef';
    });
    applyFilters();
  }

  // ── Render sections ───────────────────────────────────────────────────────
  function renderSections(secs, total) {
    var el = targetDoc.getElementById('nf-results');
    if (!el) return;
    if (!secs.length) {
      el.innerHTML = '<p style="text-align:center;color:#6c757d;padding:24px;font-size:13px">No sections found.<br><small>Navigate to an Albert course listing page.</small></p>';
      return;
    }
    var byDay = {};
    secs.forEach(function(s) { s.days.forEach(function(d){if(!byDay[d])byDay[d]=[];byDay[d].push(s);}); });
    var html = secs.length!==total ? '<p style="font-size:11px;color:#6c757d;margin-bottom:8px">Showing <b>'+secs.length+'</b> of '+total+'</p>' : '';
    DAY_ORDER.forEach(function(day) {
      if (!byDay[day]) return;
      var sorted = byDay[day].slice().sort(function(a,b){return a.startMin-b.startMin;});
      html += '<div style="margin-bottom:14px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:5px"><span style="background:#57068c;color:#fff;font-size:10px;font-weight:700;padding:2px 10px;border-radius:10px;text-transform:uppercase;letter-spacing:.4px">'+day+'</span><div style="flex:1;height:1px;background:#e9ecef"></div></div><div style="display:flex;flex-direction:column;gap:4px">';
      sorted.forEach(function(s) {
        var ct=compType(s.component), col=COLORS[ct], st=statusInfo(s.status), stc=STATUS[st.key];
        var adays=s.days.map(function(d){return d.slice(0,3);}).join(', ');
        html += '<div style="background:#fff;border-radius:6px;padding:7px 9px;display:grid;grid-template-columns:72px 1fr auto;gap:0 8px;align-items:center;border-left:3px solid '+col.border+';box-shadow:0 1px 3px rgba(0,0,0,.07)">'
          +'<div style="text-align:right"><b style="font-size:12px;color:#343a40;display:block">'+fmt12(s.startMin)+'</b><span style="font-size:10px;color:#6c757d">'+fmt12(s.endMin)+'</span></div>'
          +'<div style="min-width:0"><div style="display:flex;align-items:baseline;gap:4px;flex-wrap:wrap;margin-bottom:1px">'
          +'<span style="font-size:11px;font-weight:700;text-transform:uppercase;color:'+col.code+'">'+esc(s.courseCode)+'</span>'
          +'<span style="font-size:10px;color:#6c757d;font-weight:600">&sect;'+esc(s.section)+'</span>'
          +'<span style="font-size:9px;font-weight:700;padding:1px 4px;border-radius:3px;text-transform:uppercase;background:'+col.bdgBg+';color:'+col.bdgTxt+'">'+esc(s.component||'?')+'</span>'
          +'</div><div style="font-size:10px;color:#6c757d;display:flex;flex-wrap:wrap;gap:5px">'
          +(s.days.length>1?'<span style="font-weight:600;color:#343a40">'+esc(adays)+'</span>':'')
          +(s.instructor?'<span>'+esc(s.instructor)+'</span>':'')
          +'</div></div>'
          +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">'
          +'<span style="font-size:9px;font-weight:700;padding:2px 6px;border-radius:8px;white-space:nowrap;background:'+stc.bg+';color:'+stc.txt+'">'+esc(st.label)+'</span>'
          +(s.classNum?'<span style="font-size:9px;color:#adb5bd;font-family:monospace">#'+esc(s.classNum)+'</span>':'')
          +'</div></div>';
      });
      html += '</div></div>';
    });
    el.innerHTML = html;
  }

  // ── Header stats ──────────────────────────────────────────────────────────
  function computeStats(sections) {
    var op=0, wl=0, cl=0, crs={};
    sections.forEach(function(s) {
      var st=s.status.toLowerCase();
      if(st.indexOf('wait')>=0) wl++;
      else if(st.indexOf('closed')>=0||st.indexOf('full')>=0) cl++;
      else op++;
      crs[s.courseCode]=1;
    });
    return {open:op, waitlist:wl, closed:cl, courses:Object.keys(crs).length};
  }

  function updateHeaderStats() {
    var el = targetDoc.getElementById('nf-stats');
    if (!el) return;
    var st = computeStats(allSections);
    el.innerHTML = allSections.length+' sections &bull; '+st.courses+' course'+(st.courses!==1?'s':'')+
      ' &bull; <span style="color:#86efac">'+st.open+' open</span>'+
      ' &bull; <span style="color:#fde68a">'+st.waitlist+' wait</span>'+
      ' &bull; <span style="color:#fca5a5">'+st.closed+' closed</span>';
  }

  // ── Instructor chips ──────────────────────────────────────────────────────
  function buildChips(sections) {
    var seen={}, instrs=[];
    sections.forEach(function(s){if(s.instructor&&!seen[s.instructor]){seen[s.instructor]=true;instrs.push(s.instructor);}});
    instrs.sort();
    var chipStyle='font-size:10px;font-weight:600;padding:2px 7px;border-radius:10px;border:1.5px solid #e9ecef;background:#fff;color:#6c757d;cursor:pointer;display:inline-block;margin:2px;user-select:none;';
    return instrs.map(function(n){
      return '<span style="'+chipStyle+'" class="nf-chip" data-n="'+esc(n)+'">'+esc(n)+'</span>';
    }).join('');
  }

  function rebuildChips() {
    var container = targetDoc.getElementById('nf-chips');
    if (!container) return;
    var newChips = buildChips(allSections);
    // Only rebuild if instructor set changed
    if (container.getAttribute('data-sig') === newChips) return;
    container.setAttribute('data-sig', newChips);
    container.innerHTML = newChips;
    // Reset active state (instructor set changed, old active selections are stale)
    activeInstructors = {};
  }

  // ── Build and inject floating panel ──────────────────────────────────────
  function buildPanel() {
    var st = computeStats(allSections);
    var chips = buildChips(allSections);

    var panel = targetDoc.createElement('div');
    panel.id = '__nyu-panel';
    panel.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'width:380px',
      'z-index:2147483647',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:13px',
      'line-height:1.4',
      'border-radius:12px',
      'box-shadow:0 4px 24px rgba(0,0,0,.35)',
      'overflow:hidden',
      'display:flex',
      'flex-direction:column'
    ].join(';');

    panel.innerHTML = [
      // Header
      '<div style="background:#57068c;color:#fff;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">',
        '<div>',
          '<div style="font-size:13px;font-weight:700">NYU Course Organizer</div>',
          '<div id="nf-stats" style="font-size:10px;opacity:.85;margin-top:1px">',
            allSections.length+' sections &bull; '+st.courses+' course'+(st.courses!==1?'s':'')+
            ' &bull; <span style="color:#86efac">'+st.open+' open</span>'+
            ' &bull; <span style="color:#fde68a">'+st.waitlist+' wait</span>'+
            ' &bull; <span style="color:#fca5a5">'+st.closed+' closed</span>',
          '</div>',
        '</div>',
        '<div style="display:flex;gap:5px">',
          '<button id="nf-minimize" style="background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:5px;padding:3px 9px;cursor:pointer;font-size:12px;line-height:1">&#9660;</button>',
          '<button id="nf-close" style="background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:5px;padding:3px 9px;cursor:pointer;font-size:12px;font-weight:700">&#215;</button>',
        '</div>',
      '</div>',
      // Body (filter + results — hidden when minimized)
      '<div id="nf-body" style="background:#f8f9fa;display:flex;flex-direction:column;max-height:70vh">',
        // Filter bar
        '<div style="background:#fff;padding:8px 10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-bottom:1px solid #e9ecef;flex-shrink:0">',
          '<div style="display:flex;align-items:center;gap:4px">',
            '<label style="font-size:9px;font-weight:700;color:#6c757d;text-transform:uppercase;letter-spacing:.3px">From</label>',
            '<select id="nf-start" style="border:1.5px solid #e9ecef;border-radius:5px;padding:3px 5px;font-size:11px;color:#343a40">'+timeOptions(0,'start')+'</select>',
          '</div>',
          '<div style="display:flex;align-items:center;gap:4px">',
            '<label style="font-size:9px;font-weight:700;color:#6c757d;text-transform:uppercase;letter-spacing:.3px">To</label>',
            '<select id="nf-end" style="border:1.5px solid #e9ecef;border-radius:5px;padding:3px 5px;font-size:11px;color:#343a40">'+timeOptions(1440,'end')+'</select>',
          '</div>',
          chips ? '<div id="nf-chips" style="display:flex;flex-wrap:wrap;gap:2px;flex:1">'+chips+'</div>' : '<div id="nf-chips" style="display:none"></div>',
          '<button id="nf-reset" style="background:none;border:none;color:#adb5bd;cursor:pointer;font-size:10px;font-weight:600;text-decoration:underline;padding:0">Reset</button>',
        '</div>',
        // Results
        '<div id="nf-results" style="padding:10px 12px;overflow-y:auto;flex:1"></div>',
      '</div>'
    ].join('');

    targetDoc.body.appendChild(panel);

    // Wire event listeners
    targetDoc.getElementById('nf-close').addEventListener('click', function() {
      panel.style.display = 'none';
    });

    var minimized = false;
    var minBtn = targetDoc.getElementById('nf-minimize');
    minBtn.addEventListener('click', function() {
      minimized = !minimized;
      targetDoc.getElementById('nf-body').style.display = minimized ? 'none' : '';
      minBtn.innerHTML = minimized ? '&#9650;' : '&#9660;';
    });

    targetDoc.getElementById('nf-start').addEventListener('change', applyFilters);
    targetDoc.getElementById('nf-end').addEventListener('change', applyFilters);
    targetDoc.getElementById('nf-reset').addEventListener('click', resetFilters);

    var chipsContainer = targetDoc.getElementById('nf-chips');
    chipsContainer.addEventListener('click', function(e) {
      if (e.target && e.target.classList.contains('nf-chip')) {
        toggleInstructor(e.target.getAttribute('data-n'));
      }
    });

    targetDoc.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') panel.style.display = 'none';
    });

    // Render initial results
    if (allSections.length) {
      renderSections(allSections, allSections.length);
    } else {
      targetDoc.getElementById('nf-results').innerHTML =
        '<p style="text-align:center;color:#6c757d;padding:24px;font-size:13px">Navigate to an Albert course listing — panel will update automatically.</p>';
    }
  }

  // ── Live update machinery ─────────────────────────────────────────────────
  var refreshTimer = null;

  function scheduledRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(doRefresh, 600);
  }

  function observeIframes() {
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      try {
        var iDoc = frames[i].contentDocument;
        if (!iDoc || !iDoc.body) continue;
        if (iDoc.body.__nyuObserved) continue;
        iDoc.body.__nyuObserved = true;
        new MutationObserver(scheduledRefresh).observe(iDoc.body, { childList: true, subtree: true });
      } catch(e) {}
    }
  }

  function doRefresh() {
    var newSections = parse(gatherText(document));
    if (newSections.length === allSections.length) return;
    allSections = newSections;
    updateHeaderStats();
    rebuildChips();
    applyFilters();
    observeIframes();
    // Auto-show panel when sections first appear
    var panel = targetDoc.getElementById('__nyu-panel');
    if (panel && newSections.length > 0 && panel.style.display === 'none') {
      panel.style.display = '';
    }
  }

  // Watch top-level document for new iframes injected by PeopleSoft navigation
  new MutationObserver(function(muts) {
    var hasNewFrame = muts.some(function(m) {
      return [].some.call(m.addedNodes, function(n) {
        return n.nodeName === 'IFRAME' ||
               (n.querySelectorAll && n.querySelectorAll('iframe').length > 0);
      });
    });
    if (hasNewFrame) setTimeout(observeIframes, 500);
  }).observe(document.body, { childList: true, subtree: true });

  // ── Boot ──────────────────────────────────────────────────────────────────
  function waitForIframesAndParse(cb) {
    var frames = document.querySelectorAll('iframe');
    var pending = 0;
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      try {
        if (f.contentDocument && f.contentDocument.readyState === 'complete') continue;
      } catch(e) { continue; }
      pending++;
      f.addEventListener('load', function() {
        if (--pending === 0) cb(parse(gatherText(document)));
      });
    }
    if (pending === 0) cb(parse(gatherText(document)));
  }

  waitForIframesAndParse(function(sections) {
    allSections = sections;
    buildPanel();
    observeIframes();
    // If no sections on load, hide panel until MutationObserver finds some
    if (!allSections.length) {
      targetDoc.getElementById('__nyu-panel').style.display = 'none';
    }
  });

})();
