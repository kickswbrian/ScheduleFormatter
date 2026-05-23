(function () {
  var targetDoc = window.top.document;

  // Toggle if already injected
  var existing = targetDoc.getElementById('__nyu-fmt-modal');
  if (existing) {
    existing.style.display = existing.style.display === 'none' ? 'flex' : 'none';
    return;
  }

  // ── Gather text from this page + all same-origin iframes recursively ─────────
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

  // ── Helpers ──────────────────────────────────────────────────────────────────
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

  // ── Parser ────────────────────────────────────────────────────────────────────
  function normalizeText(raw) {
    var lines = raw.split('\n');
    var out = [], i = 0;
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

  // ── UI helpers ────────────────────────────────────────────────────────────────
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
    if (l.indexOf('wait')>=0)                          return {key:'waitlist',label:s};
    if (l.indexOf('closed')>=0||l.indexOf('full')>=0) return {key:'closed',label:'Closed'};
    return {key:'open',label:'Open'};
  }

  function timeOptions(val, mode) {
    var def = mode==='start' ? 0 : 1440;
    var h = '<option value="'+def+'"'+(val===def?' selected':'')+'>Any time</option>';
    for (var t=360; t<=1440; t+=30) {
      if (mode==='start'&&t===1440) continue;
      h += '<option value="'+t+'"'+(val===t?' selected':'')+'>'+fmt12(t)+'</option>';
    }
    return h;
  }

  // ── Parse ─────────────────────────────────────────────────────────────────────
  var rawText = gatherText(document);
  var allSections = parse(rawText);

  console.log('[NYU Organizer] Found ' + allSections.length + ' sections. Text length: ' + rawText.length);

  // ── Filter state ──────────────────────────────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────────────────────────────
  function renderSections(secs, total) {
    var el = targetDoc.getElementById('nf-results');
    if (!secs.length) {
      el.innerHTML = '<p style="text-align:center;color:#6c757d;padding:32px;font-size:14px">No sections match filters.<br><small>Try scrolling through the full listing so all sections load, then click the icon again.</small></p>';
      return;
    }
    var byDay = {};
    secs.forEach(function(s) { s.days.forEach(function(d){if(!byDay[d])byDay[d]=[];byDay[d].push(s);}); });
    var html = secs.length!==total ? '<p style="font-size:12px;color:#6c757d;margin-bottom:10px">Showing <b>'+secs.length+'</b> of '+total+' sections</p>' : '';
    DAY_ORDER.forEach(function(day) {
      if (!byDay[day]) return;
      var sorted = byDay[day].slice().sort(function(a,b){return a.startMin-b.startMin;});
      html += '<div style="margin-bottom:18px"><div style="display:flex;align-items:center;gap:8px;margin-bottom:7px"><span style="background:#57068c;color:#fff;font-size:11px;font-weight:700;padding:3px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px">'+day+'</span><div style="flex:1;height:1px;background:#e9ecef"></div></div><div style="display:flex;flex-direction:column;gap:6px">';
      sorted.forEach(function(s) {
        var ct=compType(s.component), col=COLORS[ct], st=statusInfo(s.status), stc=STATUS[st.key];
        var adays=s.days.map(function(d){return d.slice(0,3);}).join(', ');
        html += '<div style="background:#fff;border-radius:8px;padding:11px 13px;display:grid;grid-template-columns:84px 1fr auto;gap:0 12px;align-items:center;border-left:4px solid '+col.border+';box-shadow:0 1px 5px rgba(0,0,0,.07)">'
          +'<div style="text-align:right"><b style="font-size:14px;color:#343a40;display:block">'+fmt12(s.startMin)+'</b><span style="font-size:11px;color:#6c757d">to '+fmt12(s.endMin)+'</span></div>'
          +'<div style="min-width:0"><div style="display:flex;align-items:baseline;gap:5px;flex-wrap:wrap;margin-bottom:2px">'
          +'<span style="font-size:12px;font-weight:700;text-transform:uppercase;color:'+col.code+'">'+esc(s.courseCode)+'</span>'
          +'<span style="font-size:11px;color:#6c757d;font-weight:600">&sect;'+esc(s.section)+'</span>'
          +'<span style="font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;text-transform:uppercase;background:'+col.bdgBg+';color:'+col.bdgTxt+'">'+esc(s.component||'?')+'</span>'
          +'</div><div style="font-size:11px;color:#6c757d;display:flex;flex-wrap:wrap;gap:8px">'
          +(s.days.length>1?'<span style="font-weight:600;color:#343a40">'+esc(adays)+'</span>':'')
          +(s.location?'<span>&#128205; '+esc(shortLoc(s.location))+'</span>':'')
          +(s.instructor?'<span>&#128100; '+esc(s.instructor)+'</span>':'')
          +'</div></div>'
          +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">'
          +'<span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;white-space:nowrap;background:'+stc.bg+';color:'+stc.txt+'">'+esc(st.label)+'</span>'
          +(s.classNum?'<span style="font-size:10px;color:#adb5bd;font-family:monospace">#'+esc(s.classNum)+'</span>':'')
          +'</div></div>';
      });
      html += '</div></div>';
    });
    el.innerHTML = html;
  }

  // ── Build instructor chips ────────────────────────────────────────────────────
  var seen={}, instrs=[];
  allSections.forEach(function(s){if(s.instructor&&!seen[s.instructor]){seen[s.instructor]=true;instrs.push(s.instructor);}});
  instrs.sort();
  var chipStyle = 'font-size:11px;font-weight:600;padding:3px 9px;border-radius:12px;border:1.5px solid #e9ecef;background:#fff;color:#6c757d;cursor:pointer;display:inline-block;margin:2px;user-select:none;';
  var chips = instrs.map(function(n){
    return '<span style="'+chipStyle+'" class="nf-chip" data-n="'+esc(n)+'">'+esc(n)+'</span>';
  }).join('');

  // ── Stats ─────────────────────────────────────────────────────────────────────
  var op=0,wl=0,cl=0,crs={};
  allSections.forEach(function(s){
    var st=s.status.toLowerCase();
    if(st.indexOf('wait')>=0)wl++;
    else if(st.indexOf('closed')>=0||st.indexOf('full')>=0)cl++;
    else op++;
    crs[s.courseCode]=1;
  });
  var nc=Object.keys(crs).length;

  // ── Build and inject modal ────────────────────────────────────────────────────
  var modal = targetDoc.createElement('div');
  modal.id = '__nyu-fmt-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,.55);padding:20px;box-sizing:border-box;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;line-height:1.4;';

  modal.innerHTML = [
    '<div style="background:#f8f9fa;border-radius:12px;width:100%;max-width:820px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.3);margin-top:12px">',
    '<div style="background:#57068c;color:#fff;padding:14px 18px;display:flex;align-items:center;justify-content:space-between">',
    '<div><div style="font-size:15px;font-weight:700">NYU Course Organizer</div>',
    '<div style="font-size:11px;opacity:.8">'+allSections.length+' sections &bull; '+nc+' course'+(nc!==1?'s':'')+' &bull; <span style="color:#86efac">'+op+' open</span> &bull; <span style="color:#fde68a">'+wl+' waitlist</span> &bull; <span style="color:#fca5a5">'+cl+' closed</span></div></div>',
    '<button id="nf-close" style="background:rgba(255,255,255,.18);border:none;color:#fff;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;font-weight:700">&times; Close</button>',
    '</div>',
    '<div style="background:#fff;padding:12px 18px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;border-bottom:1px solid #e9ecef">',
    '<div style="display:flex;flex-direction:column;gap:3px"><label style="font-size:10px;font-weight:700;color:#6c757d;text-transform:uppercase;letter-spacing:.4px">No earlier than</label><select id="nf-start" style="border:1.5px solid #e9ecef;border-radius:6px;padding:5px 8px;font-size:13px;color:#343a40">'+timeOptions(0,'start')+'</select></div>',
    '<div style="display:flex;flex-direction:column;gap:3px"><label style="font-size:10px;font-weight:700;color:#6c757d;text-transform:uppercase;letter-spacing:.4px">No later than</label><select id="nf-end" style="border:1.5px solid #e9ecef;border-radius:6px;padding:5px 8px;font-size:13px;color:#343a40">'+timeOptions(1440,'end')+'</select></div>',
    chips ? '<div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:160px"><label style="font-size:10px;font-weight:700;color:#6c757d;text-transform:uppercase;letter-spacing:.4px">Instructor</label><div id="nf-chips">'+chips+'</div></div>' : '',
    '<button id="nf-reset" style="background:none;border:none;color:#adb5bd;cursor:pointer;font-size:11px;font-weight:600;text-decoration:underline;padding:0;align-self:flex-end">Reset</button>',
    '</div>',
    '<div id="nf-results" style="padding:14px 18px;max-height:62vh;overflow-y:auto"></div>',
    '</div>'
  ].join('');

  targetDoc.body.appendChild(modal);

  // ── Wire up event listeners (no inline handlers — content scripts run in isolated world) ──
  targetDoc.getElementById('nf-close').addEventListener('click', function() { modal.style.display='none'; });
  targetDoc.getElementById('nf-start').addEventListener('change', applyFilters);
  targetDoc.getElementById('nf-end').addEventListener('change', applyFilters);
  targetDoc.getElementById('nf-reset').addEventListener('click', resetFilters);

  var chipsContainer = targetDoc.getElementById('nf-chips');
  if (chipsContainer) {
    chipsContainer.addEventListener('click', function(e) {
      var chip = e.target;
      if (chip && chip.classList.contains('nf-chip')) {
        toggleInstructor(chip.getAttribute('data-n'));
      }
    });
  }

  modal.addEventListener('click', function(e) { if(e.target===modal) modal.style.display='none'; });
  targetDoc.addEventListener('keydown', function(e) { if(e.key==='Escape'){var m=targetDoc.getElementById('__nyu-fmt-modal');if(m)m.style.display='none';} });

  if (!allSections.length) {
    targetDoc.getElementById('nf-results').innerHTML = '<p style="text-align:center;color:#6c757d;padding:32px;font-size:14px">No course sections found.<br><small>Make sure the Albert page shows course listings with dates and times, then click the icon again.</small></p>';
  } else {
    renderSections(allSections, allSections.length);
  }

})();
