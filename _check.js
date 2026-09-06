(function(){
  try{
    var t = localStorage.getItem("yoman.theme");
    if(t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  }catch(e){}
})();
</script>
<script>
(function(){
  "use strict";

  var PRIO = {urgent:{he:"דחוף",rank:0},high:{he:"חשוב",rank:1},normal:{he:"רגיל",rank:2}};
  var KIND = {task:"משימה",email:"מייל",meeting:"פגישה",shopping:"קניות"};

  var items = [], notes = [], loaded = false, savedAt = "";
  var state = {filter:"all", onlyUrgentWindow:false, view:"month", cursor:"", selected:null};

  /* ---------- helpers ---------- */
  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  function todayISO(d){
    d = d || new Date();
    return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  }
  function addDaysISO(iso,n){
    var p = iso.split("-");
    var d = new Date(+p[0],+p[1]-1,+p[2]);
    d.setDate(d.getDate()+n);
    return todayISO(d);
  }
  var TODAY = todayISO();
  var WEEK_END = addDaysISO(TODAY,7);

  var dayFmt = new Intl.DateTimeFormat("he-IL",{weekday:"long"});
  var dateFmt = new Intl.DateTimeFormat("he-IL",{day:"numeric",month:"short"});
  var longFmt = new Intl.DateTimeFormat("he-IL",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

  function toDate(iso){var p=iso.split("-");return new Date(+p[0],+p[1]-1,+p[2]);}
  function dueLabel(iso){
    if(!iso) return "";
    if(iso===TODAY) return "היום";
    if(iso===addDaysISO(TODAY,1)) return "מחר";
    if(iso===addDaysISO(TODAY,-1)) return "אתמול";
    var d = toDate(iso);
    if(iso>TODAY && iso<=WEEK_END) return dayFmt.format(d);
    return dateFmt.format(d);
  }
  function startOfWeekISO(iso){var d=toDate(iso);d.setDate(d.getDate()-d.getDay());return todayISO(d);}
  function firstOfMonthISO(iso,shift){var d=toDate(iso);return todayISO(new Date(d.getFullYear(),d.getMonth()+(shift||0),1));}
  var monthFmt = new Intl.DateTimeFormat("he-IL",{month:"long",year:"numeric"});
  var dayLongFmt = new Intl.DateTimeFormat("he-IL",{weekday:"long",day:"numeric",month:"long"});

  function isOverdue(it){return !it.done && it.due && it.due < TODAY;}
  function isToday(it){return !it.done && it.due === TODAY;}

  function sortItems(a,b){
    var pa = (PRIO[a.priority]||PRIO.normal).rank, pb = (PRIO[b.priority]||PRIO.normal).rank;
    var oa = isOverdue(a)?0:1, ob = isOverdue(b)?0:1;
    if(oa!==ob) return oa-ob;
    if(pa!==pb) return pa-pb;
    var da = a.due||"9999-99-99", db_ = b.due||"9999-99-99";
    if(da!==db_) return da<db_?-1:1;
    return (a.createdAt||"") < (b.createdAt||"") ? -1 : 1;
  }
  function sortByTime(a,b){
    var da=(a.due||"9999-99-99")+(a.time||"99:99"), db_=(b.due||"9999-99-99")+(b.time||"99:99");
    return da<db_?-1:da>db_?1:0;
  }

  /* ---------- data ---------- */
  function setStatus(kind,text){
    var el = document.getElementById("status");
    el.className = "statusdot " + kind;
    el.querySelector("span").textContent = text;
  }

  /* ---------- storage: private GitHub Gist + local cache ---------- */
  var CACHE_KEY = "yoman.cache.v1";
  var TOKEN_KEY = "yoman.gh.token";
  var GIST_KEY  = "yoman.gh.gist";
  var GIST_FILE = "yoman-data.json";
  var GIST_DESC = "yoman-dashboard \u2014 private data";

  var NOTE_COLORS = ["amber","mint","sky","rose"];
  var editingNote = null, focusNoteId = null, pendingUndo = null;

  var token = "", gistId = "";
  var dirty = false, pushTimer = null, syncBusy = false;
  try{ token  = localStorage.getItem(TOKEN_KEY) || ""; }catch(e){}
  try{ gistId = localStorage.getItem(GIST_KEY)  || ""; }catch(e){}

  var SEED = [
    {title:"לחזור ללקוח לגבי הצעת המחיר", domain:"work", kind:"task", priority:"urgent", due:addDaysISO(TODAY,0)},
    {title:"מייל ממפיץ בגרמניה - ממתין לתשובה", domain:"work", kind:"email", priority:"high", due:addDaysISO(TODAY,1), from:"dach-partner"},
    {title:"סנכרון שבועי צוות מכירות", domain:"work", kind:"meeting", priority:"normal", due:addDaysISO(TODAY,2), time:"10:00"},
    {title:"לחדש ביטוח רכב", domain:"personal", kind:"task", priority:"high", due:addDaysISO(TODAY,3)},
    {title:"חלב", domain:"personal", kind:"shopping", priority:"normal"}
  ];

  function newId(){ return "i" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  function snapshot(){ return {version:1, savedAt:savedAt, items:items, notes:notes}; }

  function saveCache(){
    try{ localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot())); }catch(e){}
  }
  function loadCache(){
    try{
      var raw = localStorage.getItem(CACHE_KEY);
      if(!raw) return false;
      var c = JSON.parse(raw);
      items = c.items || []; notes = c.notes || []; savedAt = c.savedAt || "";
      return true;
    }catch(e){ return false; }
  }
  function seed(){
    items = SEED.map(function(d){
      return {
        id:newId(), title:d.title, notes:"דוגמה - אפשר למחוק", domain:d.domain, kind:d.kind,
        priority:d.priority, due:d.due||"", time:d.time||"", from:d.from||"", link:"",
        done:false, doneAt:"", createdAt:new Date().toISOString(), sample:true
      };
    });
    notes = [];
    savedAt = new Date().toISOString();
    saveCache();
  }

  /* every mutation funnels through touch() */
  function touch(){
    savedAt = new Date().toISOString();
    dirty = true;
    saveCache();
    schedulePush();
  }
  function schedulePush(){
    if(!token || !gistId){ setSync("local"); return; }
    if(pushTimer) clearTimeout(pushTimer);
    setSync("pending");
    pushTimer = setTimeout(function(){ pushTimer = null; pushGist(); }, 900);
  }
  function setSync(kind, detail){
    var map = {
      ok:      ["on",  "נשמר בגיטהב"],
      pending: ["",    "שומר\u2026"],
      saving:  ["",    "מסנכרן\u2026"],
      local:   ["off", "מקומי בלבד"],
      error:   ["off", "שגיאת סנכרון"]
    };
    var m = map[kind] || ["", kind];
    setStatus(m[0], m[1] + (detail ? " \u00b7 " + detail : ""));
    var dc = document.getElementById("btn-disconnect");
    if(dc) dc.hidden = !(token && gistId);
    var co = document.getElementById("btn-connect-open");
    if(co) co.hidden = !!(token && gistId);
  }

  async function gh(method, path, body){
    var res = await fetch("https://api.github.com" + path, {
      method: method,
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if(!res.ok){
      var msg = "";
      try{ msg = (await res.json()).message || ""; }catch(e){}
      var err = new Error(res.status + (msg ? " " + msg : ""));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async function pushGist(){
    if(!token || !gistId || syncBusy) return;
    syncBusy = true; setSync("saving");
    try{
      var files = {};
      files[GIST_FILE] = {content: JSON.stringify(snapshot(), null, 1)};
      await gh("PATCH", "/gists/" + gistId, {files: files});
      dirty = false;
      setSync("ok");
    }catch(e){
      setSync("error", e.message);
    }
    syncBusy = false;
  }

  async function pullGist(adopt){
    if(!token || !gistId) return "";
    var g = await gh("GET", "/gists/" + gistId);
    var f = g.files && g.files[GIST_FILE];
    if(!f) return "";
    var content = f.content;
    if(f.truncated && f.raw_url){ content = await (await fetch(f.raw_url)).text(); }
    var remote = JSON.parse(content || "{}");
    if(adopt || (remote.savedAt || "") > (savedAt || "")){
      items = remote.items || [];
      notes = remote.notes || [];
      savedAt = remote.savedAt || "";
      dirty = false;
      saveCache();
      render(); renderNotes();
    }
    return remote.savedAt || "";
  }

  function persistCreds(){
    try{
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(GIST_KEY, gistId);
    }catch(e){}
  }

  async function connect(raw){
    var t = (raw || "").trim();
    if(!t){ document.getElementById("setup-err").textContent = "צריך להדביק טוקן."; return; }
    token = t;
    setSync("saving");
    document.getElementById("setup-err").textContent = "";
    try{
      var list = await gh("GET", "/gists?per_page=100");
      var found = null;
      for(var i = 0; i < list.length; i++){
        if(list[i].files && list[i].files[GIST_FILE]){ found = list[i]; break; }
      }
      if(found){
        gistId = found.id;
        persistCreds();
        var localItems = items.slice(), localNotes = notes.slice();
        await pullGist(true);
        var merged = false;
        localItems.forEach(function(it){
          /* seeded examples are disposable - never push them into the shared store,
             or every new browser adds another copy of them */
          if(it.sample) return;
          if(!items.some(function(x){ return x.id === it.id; })){ items.push(it); merged = true; }
        });
        localNotes.forEach(function(nt){
          if(!notes.some(function(x){ return x.id === nt.id; })){ notes.push(nt); merged = true; }
        });
        if(merged) touch();
      } else {
        gistId = "";
        var files = {};
        files[GIST_FILE] = {content: JSON.stringify(snapshot(), null, 1)};
        var created = await gh("POST", "/gists", {description: GIST_DESC, public: false, files: files});
        gistId = created.id;
        persistCreds();
      }
      setSync("ok");
      document.getElementById("setup").hidden = true;
      render(); renderNotes();
    }catch(e){
      token = "";
      var why;
      if(e.status === 401){
        why = "גיטהב דחה את הטוקן. אם הוא מתחיל ב-github_pat_ זו הסיבה: צריך טוקן קלאסי שמתחיל ב-ghp_.";
      } else if(e.status === 403 || e.status === 404){
        why = "לטוקן אין הרשאת gist. צור טוקן קלאסי חדש וסמן את התיבה gist.";
      } else if(String(e.message).indexOf("Failed to fetch") > -1){
        why = "אין תקשורת אל api.github.com. אם פתחת את הקובץ בלחיצה כפולה (כתובת file://) - זו הסיבה. הרץ את start.bat.";
      } else {
        why = "החיבור נכשל: " + e.message;
      }
      setSync("error");
      document.getElementById("setup-err").textContent = why;
    }
  }

  function disconnect(){
    token = ""; gistId = "";
    try{ localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(GIST_KEY); }catch(e){}
    setSync("local");
    document.getElementById("setup").hidden = false;
    document.getElementById("setup-err").textContent = "";
  }

  function exportData(){
    var blob = new Blob([JSON.stringify(snapshot(), null, 2)], {type:"application/json"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "yoman-backup-" + TODAY + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function importData(file){
    var fr = new FileReader();
    fr.onload = function(){
      try{
        var d = JSON.parse(fr.result);
        if(!d || !Array.isArray(d.items)) throw new Error("bad");
        items = d.items; notes = Array.isArray(d.notes) ? d.notes : [];
        touch(); render(); renderNotes();
        flash("הגיבוי יובא בהצלחה.");
      }catch(e){ flash("הקובץ לא תקין - צריך קובץ גיבוי של הדשבורד."); }
    };
    fr.readAsText(file);
  }

  (async function init(){
    document.getElementById("datestrip").textContent = longFmt.format(new Date());
    if(!loadCache() && !token) seed();
    loaded = true;
    render(); renderNotes();

    if(!token || !gistId){
      setSync("local");
      document.getElementById("setup").hidden = false;
      return;
    }

    setSync("saving");
    try{
      var remoteSaved = await pullGist(false);
      if((savedAt || "") > (remoteSaved || "")){ dirty = true; pushGist(); }
      else setSync("ok");
    }catch(e){
      if(e.status === 401){
        setSync("error", "הטוקן נדחה");
        document.getElementById("setup").hidden = false;
        document.getElementById("setup-err").textContent = "הטוקן נדחה על ידי גיטהב. ייתכן שפג תוקפו - צור טוקן חדש והתחבר מחדש.";
      } else {
        setSync("error", e.message);
      }
    }

    setInterval(function(){
      if(document.visibilityState === "visible" && !dirty && !syncBusy){
        pullGist(false).catch(function(){});
      }
    }, 60000);
    document.addEventListener("visibilitychange", function(){
      if(document.visibilityState === "visible" && !dirty && !syncBusy){
        pullGist(false).catch(function(){});
      }
    });
  })();

  function addItem(data){
    items.push({
      id: newId(),
      title: data.title, notes: data.notes || "",
      domain: data.domain || "work", kind: data.kind || "task",
      priority: data.priority || "normal",
      due: data.due || "", time: data.time || "",
      from: data.from || "", link: data.link || "",
      done: false, doneAt: "", createdAt: new Date().toISOString(), sample: false
    });
    touch(); render();
  }
  function toggleDone(id){
    var it = items.filter(function(x){ return x.id === id; })[0];
    if(!it) return;
    it.done = !it.done;
    it.doneAt = it.done ? new Date().toISOString() : "";
    touch(); render();
  }
  function removeItem(id){
    items = items.filter(function(x){ return x.id !== id; });
    touch(); render();
  }
  function snooze(id, days){
    var it = items.filter(function(x){ return x.id === id; })[0];
    if(!it) return;
    var base = it.due && it.due > TODAY ? it.due : TODAY;
    it.due = addDaysISO(base, days);
    touch(); render();
  }

  function addNote(doc){
    doc = doc || {text:"", color:NOTE_COLORS[notes.length % NOTE_COLORS.length], createdAt:new Date().toISOString()};
    if(!doc.id) doc.id = newId();
    notes.push(doc);
    focusNoteId = doc.id;
    touch(); renderNotes();
  }
  function saveNote(id, text){
    var nt = notes.filter(function(x){ return x.id === id; })[0];
    if(!nt || nt.text === text) return;
    nt.text = text;
    touch();
  }
  function cycleNoteColor(id){
    var nt = notes.filter(function(x){ return x.id === id; })[0];
    if(!nt) return;
    nt.color = NOTE_COLORS[(NOTE_COLORS.indexOf(nt.color || "amber") + 1) % NOTE_COLORS.length];
    touch(); renderNotes();
  }
  function deleteNote(id){
    var nt = notes.filter(function(x){ return x.id === id; })[0];
    if(!nt) return;
    var backup = {text:nt.text || "", color:nt.color || "amber", createdAt:nt.createdAt || new Date().toISOString()};
    notes = notes.filter(function(x){ return x.id !== id; });
    touch(); renderNotes();
    showUndo(backup);
  }

  function showUndo(backup){
    var b = document.getElementById("banner");
    pendingUndo = backup;
    b.innerHTML = '<div class="banner">הפתק נמחק. <button type="button" class="undo" data-noteact="undo">שחזור</button></div>';
    setTimeout(function(){
      if(pendingUndo === backup){
        pendingUndo = null;
        b.innerHTML = "";
      }
    }, 8000);
  }

  function noteHTML(nt){
    var d = nt.createdAt ? dateFmt.format(new Date(nt.createdAt)) : "";
    return '<div class="sticky c-'+esc(nt.color||"amber")+'" data-note="'+esc(nt.id)+'">'+
      '<textarea data-noteinput placeholder="לרשום לעצמי\u2026" aria-label="תוכן הפתק">'+esc(nt.text||"")+'</textarea>'+
      '<div class="notefoot">'+
        '<span class="notedate">'+esc(d)+'</span>'+
        '<button type="button" data-noteact="color" title="החלפת צבע" aria-label="החלפת צבע">\u25d0</button>'+
        '<button type="button" data-noteact="del" title="מחיקה" aria-label="מחיקת הפתק">\u2715</button>'+
      '</div></div>';
  }

  function renderNotes(){
    if(editingNote) return;
    var board = document.getElementById("noteboard");
    if(!board) return;
    var sorted = notes.slice().sort(function(a,b){
      return (a.createdAt||"") < (b.createdAt||"") ? -1 : 1;
    });
    board.innerHTML = sorted.map(noteHTML).join("") +
      '<button type="button" class="addnote-tile" data-noteact="add">+ פתק חדש</button>';
    if(focusNoteId){
      var el = board.querySelector('[data-note="'+focusNoteId+'"] textarea');
      focusNoteId = null;
      if(el) el.focus();
    }
  }

  function flash(msg){
    var b = document.getElementById("banner");
    b.innerHTML = '<div class="banner">'+esc(msg)+'</div>';
    setTimeout(function(){
      if(b.textContent.indexOf(msg)>-1) b.innerHTML = "";
    },4000);
  }

  /* ---------- render ---------- */
  var restoreShopFocus = null;

  function visible(list){
    if(state.selected) list = list.filter(function(i){return i.due===state.selected;});
    if(state.filter!=="all") list = list.filter(function(i){return i.domain===state.filter;});
    if(state.onlyUrgentWindow) list = list.filter(function(i){
      return i.done || isOverdue(i) || isToday(i) || i.priority==="urgent";
    });
    return list;
  }

  function rowHTML(it,opts){
    opts = opts||{};
    var cls = "row p-"+(PRIO[it.priority]?it.priority:"normal")+(it.done?" is-done":"");
    var chips = [];
    if(isOverdue(it)) chips.push('<span class="chip late">באיחור · '+esc(dueLabel(it.due))+'</span>');
    else if(isToday(it)) chips.push('<span class="chip today">היום'+(it.time?" · "+esc(it.time):"")+'</span>');
    else if(it.due) chips.push('<span class="chip">'+esc(dueLabel(it.due))+(it.time?" · "+esc(it.time):"")+'</span>');
    else if(it.time) chips.push('<span class="chip">'+esc(it.time)+'</span>');
    if(it.priority==="urgent") chips.push('<span class="chip urgent">דחוף</span>');
    else if(it.priority==="high") chips.push('<span class="chip high">חשוב</span>');
    if(opts.showDomain) chips.push('<span class="chip '+esc(it.domain)+'">'+(it.domain==="work"?"עבודה":"אישי")+'</span>');
    if(it.from) chips.push('<span class="chip">מאת '+esc(it.from)+'</span>');
    if(it.sample) chips.push('<span class="sample-tag">דוגמה</span>');

    var note = "";
    if(it.notes) note += '<div class="note">'+esc(it.notes)+'</div>';
    if(it.link) note += '<div class="note"><a href="'+esc(it.link)+'" target="_blank" rel="noopener">פתיחת הקישור</a></div>';

    return '<div class="'+cls+'" data-id="'+esc(it.id)+'">'+
      '<button class="tick" data-act="toggle" aria-label="'+(it.done?"ביטול סימון":"סימון כבוצע")+'">✓</button>'+
      '<div class="body"><div class="title">'+esc(it.title)+'</div>'+note+
        (chips.length?'<div class="meta">'+chips.join("")+'</div>':'')+
      '</div>'+
      '<div class="acts">'+
        (it.done?'':'<button data-act="snooze" title="דחייה ליום הבא">↩ מחר</button>')+
        '<button class="del" data-act="del" title="מחיקה">✕</button>'+
      '</div></div>';
  }

  function section(title,list,opts){
    opts = opts||{};
    var inner;
    if(!list.length){
      if(opts.hideWhenEmpty) return "";
      inner = '<div class="empty">'+esc(opts.empty||"אין פריטים פתוחים.")+'</div>';
    } else {
      inner = '<div class="rows">'+list.map(function(i){return rowHTML(i,opts);}).join("")+'</div>';
    }
    return '<div class="card"><h3>'+esc(title)+'<span class="n">'+list.length+'</span></h3>'+inner+'</div>';
  }

  function meetingsSection(list){
    if(!list.length) return '<div class="card"><h3>פגישות בשבוע הקרוב<span class="n">0</span></h3>'+
      '<div class="empty">אין פגישות רשומות לשבוע הקרוב.</div></div>';
    var html = "", lastDay = "";
    list.forEach(function(it){
      var key = it.due||"";
      if(key!==lastDay){
        lastDay = key;
        var label = key ? dueLabel(key)+" · "+dateFmt.format(toDate(key)) : "ללא תאריך";
        html += '<div class="timegroup">'+esc(label)+'</div>';
      }
      html += rowHTML(it,{});
    });
    return '<div class="card"><h3>פגישות בשבוע הקרוב<span class="n">'+list.length+'</span></h3>'+
      '<div class="rows">'+html+'</div></div>';
  }

  function shopRowHTML(it){
    return '<div class="row slim'+(it.done?" is-done":"")+'" data-id="'+esc(it.id)+'">'+
      '<button class="tick" data-act="toggle" aria-label="'+(it.done?"החזרה לרשימה":"סימון כנקנה")+'">\u2713</button>'+
      '<div class="body"><div class="title">'+esc(it.title)+'</div>'+
        (it.notes?'<div class="note">'+esc(it.notes)+'</div>':'')+'</div>'+
      '<div class="acts"><button class="del" data-act="del" title="מחיקה">\u2715</button></div>'+
    '</div>';
  }

  function shoppingSection(){
    var list = items.filter(function(i){return i.kind==="shopping";});
    var open = list.filter(function(i){return !i.done;})
      .sort(function(a,b){return (a.createdAt||"")<(b.createdAt||"")?-1:1;});
    var bought = list.filter(function(i){return i.done;})
      .sort(function(a,b){return (a.doneAt||"")<(b.doneAt||"")?-1:1;});
    var rows = open.concat(bought);
    return '<div class="card">'+
      '<h3>רשימת קניות<span class="n">'+open.length+'</span></h3>'+
      '<form class="shopadd" id="shopform">'+
        '<input type="text" id="s-title" placeholder="להוסיף פריט\u2026" autocomplete="off" aria-label="פריט חדש לרשימת הקניות">'+
        '<button type="submit" aria-label="הוספה לרשימה">+</button>'+
      '</form>'+
      (rows.length
        ? '<div class="rows">'+rows.map(shopRowHTML).join("")+'</div>'
        : '<div class="shopempty">הרשימה ריקה. אפשר להוסיף פריט למעלה.</div>')+
      (bought.length ? '<button type="button" class="clearbought" data-shop="clear">ניקוי שנקנו ('+bought.length+')</button>' : '')+
    '</div>';
  }

  function doneSection(list){
    if(!list.length) return "";
    return '<details class="card donebox"><summary>בוצע לאחרונה ('+list.length+')</summary>'+
      '<div class="rows">'+list.map(function(i){return rowHTML(i,{showDomain:state.filter==="all"});}).join("")+'</div></details>';
  }


  function calendarHTML(){
    var byDay = {};
    items.forEach(function(it){ if(it.due){ (byDay[it.due]=byDay[it.due]||[]).push(it); } });

    var cells = [], label = "", weekCls = "";
    if(state.view==="month"){
      var first = firstOfMonthISO(state.cursor,0);
      var fm = toDate(first).getMonth();
      var start = addDaysISO(first, -toDate(first).getDay());
      for(var i=0;i<42;i++) cells.push(addDaysISO(start,i));
      if(toDate(cells[35]).getMonth()!==fm) cells = cells.slice(0,35);
      label = monthFmt.format(toDate(first));
    } else {
      var ws = startOfWeekISO(state.cursor);
      for(var j=0;j<7;j++) cells.push(addDaysISO(ws,j));
      label = dateFmt.format(toDate(cells[0]))+" – "+dateFmt.format(toDate(cells[6]));
      weekCls = " week";
      var fm2 = toDate(cells[0]).getMonth();
    }
    var curMonth = toDate(state.view==="month" ? firstOfMonthISO(state.cursor,0) : cells[0]).getMonth();

    var dows = ["א","ב","ג","ד","ה","ו","ש"].map(function(d){return '<span class="dow">'+d+'</span>';}).join("");

    var days = cells.map(function(iso){
      var list = (byDay[iso]||[]).slice().sort(sortItems);
      var open = list.filter(function(x){return !x.done;});
      var dots = open.slice(0,3).map(function(x){
        var c = (isOverdue(x)||x.priority==="urgent") ? "u" : (x.domain==="work" ? "w" : "p");
        return '<i class="'+c+'"></i>';
      }).join("");
      var cls = "day";
      if(state.view==="month" && toDate(iso).getMonth()!==curMonth) cls += " off";
      if(iso===TODAY) cls += " today";
      if(iso===state.selected) cls += " sel";
      if(list.length && !open.length) cls += " done-only";
      var aria = dayLongFmt.format(toDate(iso)) + (open.length ? " – "+open.length+" פתוחים" : " – אין פריטים");
      return '<button type="button" class="'+cls+'" data-day="'+iso+'" aria-label="'+esc(aria)+'" aria-pressed="'+(iso===state.selected)+'">'+
             '<span>'+toDate(iso).getDate()+'</span><span class="dots">'+dots+'</span></button>';
    }).join("");

    return '<div class="card">'+
      '<div class="calhead">'+
        '<button type="button" class="navbtn" data-cal="prev" aria-label="הקודם">&#8250;</button>'+
        '<div class="calmonth">'+esc(label)+'</div>'+
        '<button type="button" class="navbtn" data-cal="next" aria-label="הבא">&#8249;</button>'+
      '</div>'+
      '<div class="calseg">'+
        '<button type="button" data-calview="month" aria-pressed="'+(state.view==="month")+'">חודש</button>'+
        '<button type="button" data-calview="week" aria-pressed="'+(state.view==="week")+'">שבוע</button>'+
        '<button type="button" data-cal="today">היום</button>'+
      '</div>'+
      '<div class="calgrid'+weekCls+'">'+dows+days+'</div>'+
      '<div class="callegend">'+
        '<span><i style="background:var(--urgent)"></i>דחוף</span>'+
        '<span><i style="background:var(--work)"></i>עבודה</span>'+
        '<span><i style="background:var(--personal)"></i>אישי</span>'+
      '</div></div>';
  }

  function render(){
    if(!state.cursor) state.cursor = TODAY;
    var act = document.activeElement;
    var keepShop = act && act.id==="s-title" ? act.value : null;
    restoreShopFocus = keepShop;
    document.getElementById("calendar").innerHTML = calendarHTML();

    var dc = document.getElementById("daychip");
    dc.innerHTML = state.selected
      ? '<button type="button" class="ghost on" data-cal="clearday">מציג: '+esc(dayLongFmt.format(toDate(state.selected)))+' &#10005;</button>'
      : "";

    var all = items.filter(function(i){return i.kind!=="shopping";});
    var open = all.filter(function(i){return !i.done;});
    var st = {
      open: open.length,
      today: open.filter(isToday).length,
      late: open.filter(isOverdue).length,
      doneToday: all.filter(function(i){return i.done && (i.doneAt||"").slice(0,10)===TODAY;}).length
    };
    document.getElementById("summary").innerHTML =
      '<div class="stat"><span class="n">'+st.open+'</span><span class="l">פתוח</span></div>'+
      '<div class="stat today"><span class="n">'+st.today+'</span><span class="l">להיום</span></div>'+
      '<div class="stat'+(st.late?" alert":"")+'"><span class="n">'+st.late+'</span><span class="l">באיחור</span></div>'+
      '<div class="stat"><span class="n">'+st.doneToday+'</span><span class="l">בוצע היום</span></div>';

    document.getElementById("btn-clear").hidden = !all.some(function(i){return i.sample;});

    if(!loaded){
      document.getElementById("work-sections").innerHTML = '<div class="card"><div class="empty">טוען…</div></div>';
      document.getElementById("personal-sections").innerHTML = '<div class="card"><div class="empty">טוען\u2026</div></div>';
      return;
    }

    var dayMode = !!state.selected;
    var pool = visible(all);
    var openPool = pool.filter(function(i){return !i.done;});

    function lane(domain){
      if(state.filter!=="all" && state.filter!==domain) return null;
      return openPool.filter(function(i){return i.domain===domain;});
    }

    var w = lane("work"), p = lane("personal");
    var workEl = document.getElementById("work-sections");
    var persEl = document.getElementById("personal-sections");
    var doneList = pool.filter(function(i){return i.done;})
      .sort(function(a,b){return (b.doneAt||"")<(a.doneAt||"")?-1:1;}).slice(0,30);

    document.querySelector(".lane.work").hidden = (w===null);
    document.querySelector(".lane.personal").hidden = (p===null);

    if(w){
      var wTasks = w.filter(function(i){return i.kind==="task";}).sort(sortItems);
      var wMail  = w.filter(function(i){return i.kind==="email";}).sort(sortItems);
      var wMeet  = w.filter(function(i){return i.kind==="meeting";})
                    .filter(function(i){return dayMode || !i.due || i.due>=TODAY;}).sort(sortByTime);
      document.getElementById("c-work").textContent = w.length+" פתוחים";
      workEl.innerHTML =
        section("משימות לטיפול",wTasks,{empty:dayMode?"אין משימות עבודה ליום זה.":"אין משימות עבודה פתוחות."})+
        section("מיילים לטיפול",wMail,{empty:dayMode?"אין מיילים ליום זה.":"אין מיילים ממתינים."})+
        meetingsSection(wMeet)+
        (state.filter==="work"?doneSection(doneList):"");
    }
    if(p){
      var pTasks = p.filter(function(i){return i.kind!=="meeting";}).sort(sortItems);
      var pEvents= p.filter(function(i){return i.kind==="meeting";})
                    .filter(function(i){return dayMode || !i.due || i.due>=TODAY;}).sort(sortByTime);
      document.getElementById("c-personal").textContent = p.length+" פתוחים";
      persEl.innerHTML =
        section("משימות אישיות",pTasks,{empty:dayMode?"אין משימות אישיות ליום זה.":"אין משימות אישיות פתוחות."})+
        section("אירועים ותאריכים",pEvents,{hideWhenEmpty:true})+
        shoppingSection()+
        (state.filter!=="work"?doneSection(doneList):"");
    }

    if(restoreShopFocus!==null){
      var si = document.getElementById("s-title");
      if(si){ si.value = restoreShopFocus; si.focus(); }
      restoreShopFocus = null;
    }
  }

  /* ---------- events ---------- */
  // keep the caret in a note while its own buttons are clicked
  document.addEventListener("mousedown",function(e){
    if(e.target.closest("[data-noteact]")) e.preventDefault();
  });

  document.addEventListener("focusin",function(e){
    if(e.target.matches("[data-noteinput]")){
      editingNote = e.target.closest("[data-note]").getAttribute("data-note");
    }
  });
  document.addEventListener("focusout",function(e){
    if(e.target.matches("[data-noteinput]")){
      var id = e.target.closest("[data-note]").getAttribute("data-note");
      editingNote = null;
      saveNote(id, e.target.value);
    }
  });

  document.addEventListener("click",function(e){
    var na = e.target.closest("[data-noteact]");
    if(na){
      var na_act = na.getAttribute("data-noteact");
      if(na_act === "add"){ addNote(); return; }
      if(na_act === "undo"){
        var back = pendingUndo;
        pendingUndo = null;
        document.getElementById("banner").innerHTML = "";
        if(back) addNote(back);
        return;
      }
      var card = na.closest("[data-note]");
      if(!card) return;
      var nid = card.getAttribute("data-note");
      var ta = card.querySelector("textarea");
      editingNote = null;
      if(ta) saveNote(nid, ta.value);
      if(na_act === "color") cycleNoteColor(nid);
      else if(na_act === "del") deleteNote(nid);
      return;
    }
    var btn = e.target.closest("[data-act]");
    if(btn){
      var id = btn.closest(".row").getAttribute("data-id");
      var act = btn.getAttribute("data-act");
      if(act==="toggle") toggleDone(id);
      else if(act==="del") removeItem(id);
      else if(act==="snooze") snooze(id,1);
      return;
    }
    var day = e.target.closest("[data-day]");
    if(day){
      var iso = day.getAttribute("data-day");
      state.selected = (state.selected===iso) ? null : iso;
      render();
      return;
    }
    var cv = e.target.closest("[data-calview]");
    if(cv){
      state.view = cv.getAttribute("data-calview");
      if(state.view==="week" && state.selected) state.cursor = state.selected;
      render();
      return;
    }
    var cal = e.target.closest("[data-cal]");
    if(cal){
      var a = cal.getAttribute("data-cal");
      if(a==="prev") state.cursor = state.view==="month" ? firstOfMonthISO(state.cursor,-1) : addDaysISO(state.cursor,-7);
      else if(a==="next") state.cursor = state.view==="month" ? firstOfMonthISO(state.cursor,1) : addDaysISO(state.cursor,7);
      else if(a==="today"){ state.cursor = TODAY; state.selected = null; }
      else if(a==="clearday") state.selected = null;
      render();
      return;
    }
    var sc = e.target.closest("[data-shop]");
    if(sc){
      items.filter(function(i){return i.kind==="shopping" && i.done;})
           .forEach(function(i){ removeItem(i.id); });
      return;
    }
    var f = e.target.closest("[data-filter]");
    if(f){
      state.filter = f.getAttribute("data-filter");
      document.querySelectorAll("[data-filter]").forEach(function(b){
        b.setAttribute("aria-pressed", b===f ? "true":"false");
      });
      render();
    }
  });

  document.getElementById("addnote").addEventListener("click",function(){ addNote(); });

  document.getElementById("btn-connect").addEventListener("click",function(){
    connect(document.getElementById("tokinput").value);
    document.getElementById("tokinput").value = "";
  });
  document.getElementById("tokinput").addEventListener("keydown",function(e){
    if(e.key === "Enter"){ e.preventDefault(); document.getElementById("btn-connect").click(); }
  });
  document.getElementById("btn-skip").addEventListener("click",function(){
    document.getElementById("setup").hidden = true;
  });
  document.getElementById("btn-connect-open").addEventListener("click",function(){
    document.getElementById("setup").hidden = false;
    document.getElementById("tokinput").focus();
  });
  var THEMES = [
    {v:"auto",  label:"ערכה: אוטומטית"},
    {v:"light", label:"ערכה: בהירה"},
    {v:"dark",  label:"ערכה: כהה"}
  ];
  function currentTheme(){
    var t;
    try{ t = localStorage.getItem("yoman.theme"); }catch(e){}
    return (t === "light" || t === "dark") ? t : "auto";
  }
  function paintThemeButton(){
    var v = currentTheme();
    var m = THEMES.filter(function(x){ return x.v === v; })[0];
    document.getElementById("btn-theme").textContent = m.label;
  }
  function cycleTheme(){
    var v = currentTheme();
    var next = THEMES[(THEMES.map(function(x){return x.v;}).indexOf(v) + 1) % THEMES.length].v;
    try{
      if(next === "auto") localStorage.removeItem("yoman.theme");
      else localStorage.setItem("yoman.theme", next);
    }catch(e){}
    if(next === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    paintThemeButton();
  }
  document.getElementById("btn-theme").addEventListener("click",cycleTheme);
  paintThemeButton();

  document.getElementById("btn-disconnect").addEventListener("click",disconnect);
  document.getElementById("btn-export").addEventListener("click",exportData);
  document.getElementById("file-import").addEventListener("change",function(e){
    if(e.target.files && e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });
  document.getElementById("btn-sync").addEventListener("click",function(){
    if(!token || !gistId){ flash("אין חיבור לגיטהב עדיין."); return; }
    if(dirty) pushGist();
    else pullGist(true).then(function(){ setSync("ok"); }).catch(function(err){ setSync("error", err.message); });
  });

  document.getElementById("btn-late").addEventListener("click",function(){
    state.onlyUrgentWindow = !state.onlyUrgentWindow;
    this.textContent = state.onlyUrgentWindow ? "הצגת הכל" : "רק באיחור ולהיום";
    this.style.borderColor = state.onlyUrgentWindow ? "var(--accent)" : "";
    this.style.color = state.onlyUrgentWindow ? "var(--accent)" : "";
    render();
  });

  document.getElementById("btn-clear").addEventListener("click",function(){
    items.filter(function(i){return i.sample;}).forEach(function(i){ removeItem(i.id); });
  });

  document.addEventListener("submit",function(e){
    if(e.target.id!=="shopform") return;
    e.preventDefault();
    var si = document.getElementById("s-title");
    var v = si.value.trim();
    if(!v) return;
    addItem({title:v, domain:"personal", kind:"shopping", priority:"normal"});
    si.value = "";
    si.focus();
  });

  document.getElementById("addform").addEventListener("submit",function(e){
    e.preventDefault();
    var t = document.getElementById("f-title");
    var title = t.value.trim();
    if(!title) return;
    addItem({
      title: title,
      domain: document.getElementById("f-domain").value,
      kind: document.getElementById("f-kind").value,
      priority: document.getElementById("f-priority").value,
      due: document.getElementById("f-due").value
    });
    t.value = "";
    document.getElementById("f-due").value = "";
    t.focus();
  });

  render();
  renderNotes();
})();
