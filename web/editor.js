// 樂譜編輯 —— 點一個音符就能改它。
//
// 為什麼是這個做法:
//   alphaTab 已經把最難的兩件事做掉了(排譜、播放),而且它的音符資料是可以改的,
//   還能把整份譜寫回 Guitar Pro 檔。所以這裡只做「編輯操作」那一層:
//   選誰、改什麼、怎麼收回上一步、怎麼存出去。
//
// 改完資料 MUST 走 applyEdit(),它會重算樂譜內部狀態再重畫。
//    只改 note.fret 而不重畫,畫面不會動;重畫而不 finish(),音長與小節長度會算錯。

const editor = {
  on: false,
  note: null,        // 現在選到的音符
  beat: null,        // 現在選到的拍(沒有音符的拍也選得到,才加得了音)
  string: 1,         // 現在停在第幾弦,從 1 開始,1 是最細的那條
  undo: [],          // 每一步的反向操作
  typing: "",        // 正在輸入的格位數字,兩位數要連打
  typingTimer: null,
  dirty: false,      // 有沒有改過還沒存
};

const SELECT_RGB = [25, 113, 194];  // 選到的音符染成這個藍

function editorTrack() {
  const shown = [...state.shownTracks];
  return state.api?.score?.tracks[shown[0] ?? 0] ?? null;
}

// ── 選取:把音符染色,不要自己畫框 ──────────────────────────
// 畫框要自己算座標,而重畫之後座標就變了。染色是交給 alphaTab 畫,它自己會對位。
function paintNote(note, selected) {
  if (!note) return;
  if (!note.style) note.style = new alphaTab.model.NoteStyle();
  const value = selected ? new alphaTab.model.Color(...SELECT_RGB) : null;
  for (const part of [
    alphaTab.model.NoteSubElement.GuitarTabFretNumber,
    alphaTab.model.NoteSubElement.StandardNotationNoteHead,
  ]) {
    if (value) note.style.colors.set(part, value);
    else note.style.colors.delete(part);
  }
}

function selectNote(note, redraw = true) {
  if (note && !note.isStringed && editor.on) {
    hint("這個音沒有格位。上下方向鍵改音高,Delete 刪掉");
  }
  if (editor.note && editor.note !== note) paintNote(editor.note, false);
  editor.note = note ?? null;
  editor.beat = note ? note.beat : editor.beat;
  if (note) {
    editor.string = note.string;
    paintNote(note, true);
  }
  if (redraw) redrawKeepingPosition();
  showEditorStatus();
}

// 重畫會把捲動位置與播放位置洗掉,所以先記下來再接回去。
function redrawKeepingPosition() {
  const at = state.api.tickPosition;
  const scroll = ui.surface.scrollTop;
  state.api.renderScore(state.api.score, [...state.shownTracks]);
  requestAnimationFrame(() => {
    ui.surface.scrollTop = scroll;
    state.api.tickPosition = at;
  });
}

// 改完資料一定要走這裡:重算 → 重畫 → 記一步可以收回的操作
function applyEdit(label, undoFn) {
  state.api.score.finish(state.api.settings);
  editor.undo.push({ label, undo: undoFn });
  if (editor.undo.length > 200) editor.undo.shift();
  editor.dirty = true;
  redrawKeepingPosition();
  showEditorStatus();
}

function undoLast() {
  const step = editor.undo.pop();
  if (!step) {
    hint("沒有可以收回的動作了");
    return;
  }
  step.undo();
  state.api.score.finish(state.api.settings);
  editor.dirty = editor.undo.length > 0;
  redrawKeepingPosition();
  hint(`收回:${step.label}`);
  showEditorStatus();
}

function showEditorStatus() {
  if (!editor.on) {
    ui.editStatus.textContent = "";
    return;
  }
  if (!editor.note && !editor.beat) {
    ui.editStatus.textContent = "點譜上一個音符開始改";
    return;
  }
  const bar = editor.beat ? editor.beat.voice.bar.index + 1 : "?";
  const stringed = isStringedTrack();
  const where = stringed ? `第 ${bar} 小節 · 第 ${editor.string} 弦` : `第 ${bar} 小節`;
  const what = editor.note
    ? (editor.note.isStringed ? `第 ${editor.note.fret} 格` : "選到一個音")
    : (stringed ? "這條弦沒有音" : "這一拍沒有音");
  const typing = editor.typing ? ` · 正在輸入 ${editor.typing}` : "";
  const unsaved = editor.dirty ? " · 尚未存檔" : "";
  ui.editStatus.textContent = `${where} · ${what}${typing}${unsaved}`;
}

// ── 改格位 ──────────────────────────────────────────────────────
// 兩位數要連打(1 然後 2 = 12)。停手 900 毫秒就當這個數字輸入完了。
function typeFret(digit) {
  if (!editor.beat) {
    hint("先點一個音符或一個拍");
    return;
  }
  const next = (editor.typing + digit).slice(-2);
  const asNumber = Number(next);
  const track = editorTrack();
  const maxFret = track?.fretCount ?? 24;

  // 兩位數超出琴格範圍時,當成「重新從這一位開始輸入」
  editor.typing = asNumber > maxFret ? digit : next;
  setFret(Number(editor.typing));

  clearTimeout(editor.typingTimer);
  editor.typingTimer = setTimeout(() => {
    editor.typing = "";
    showEditorStatus();
  }, 900);
}

function isStringedTrack() {
  return editorTrack()?.staves?.[0]?.isStringed ?? false;
}

function setFret(fret) {
  if (!isStringedTrack()) {
    hint("這一軌沒有格位。用上下方向鍵改音高", true);
    return;
  }
  const existing = noteOnString(editor.beat, editor.string);
  if (existing) {
    const before = existing.fret;
    if (before === fret) return;
    existing.fret = fret;
    selectNote(existing, false);
    applyEdit(`把第 ${editor.string} 弦改成第 ${fret} 格`, () => {
      existing.fret = before;
    });
    return;
  }
  addNoteOnString(editor.string, fret);
}

function noteOnString(beat, string) {
  return beat?.notes.find((note) => note.string === string) ?? null;
}

// ── 加音符 ──────────────────────────────────────────────────────
// 在沒有音符的弦上輸入數字,就是新增一個音。跟「改」用同一套操作,不必另外記按鍵。
function addNoteOnString(string, fret) {
  if (!editor.beat) return;
  const note = new alphaTab.model.Note();
  note.string = string;
  note.fret = fret;
  editor.beat.addNote(note);
  selectNote(note, false);
  applyEdit(`在第 ${string} 弦加一個第 ${fret} 格的音`, () => {
    editor.beat.removeNote(note);
    if (editor.note === note) editor.note = null;
  });
}

// ── 刪音符 ──────────────────────────────────────────────────────
function deleteSelected() {
  const note = editor.note;
  if (!note) {
    hint("先點一個音符");
    return;
  }
  const beat = note.beat;
  const label = note.isStringed ? `第 ${note.string} 弦第 ${note.fret} 格` : "這個音";
  beat.removeNote(note);
  editor.note = null;
  editor.beat = beat;
  // 收回時把「原本那個物件」加回去。
  // 一度改成用 string/fret 重建一個新的,鋼琴那種沒有弦的音符音高就整個不見了,而且不報錯。
  applyEdit(`刪掉${label}`, () => {
    beat.addNote(note);
    selectNote(note, false);
  });
}

// ── 改音長 ──────────────────────────────────────────────────────
// 值就是「幾分音符」:1 全音符、2 二分、4 四分、8 八分、16 十六分、32 三十二分。
const DURATIONS = [
  [1, "全音符"], [2, "二分"], [4, "四分"], [8, "八分"], [16, "十六分"], [32, "三十二分"],
];

function setDuration(value) {
  if (!editor.beat) {
    hint("先點一個音符");
    return;
  }
  const beat = editor.beat;
  const before = beat.duration;
  if (before === value) return;
  beat.duration = value;
  const name = DURATIONS.find(([v]) => v === value)?.[1] ?? String(value);
  applyEdit(`音長改成${name}`, () => { beat.duration = before; });
  hint(`這一拍改成${name}音符`);
}

// ── 改音高(給鋼琴那種沒有弦的音軌用)────────────────────────────
// 弦樂器改的是「第幾格」,鍵盤樂器沒有格位,改的是音高本身。
// alphaTab 把音高拆成 octave 與 tone 兩個欄位,realValue = octave * 12 + tone(實測過)。
function transposeNote(semitones) {
  const note = editor.note;
  if (!note) {
    hint("先點一個音符");
    return;
  }
  const before = { octave: note.octave, tone: note.tone };
  const midi = note.octave * 12 + note.tone + semitones;
  if (midi < 12 || midi > 127) {
    hint("已經到音域的邊界了");
    return;
  }
  note.octave = Math.floor(midi / 12);
  note.tone = midi % 12;
  applyEdit(semitones > 0 ? "音高升高半音" : "音高降低半音", () => {
    note.octave = before.octave;
    note.tone = before.tone;
  });
}

// ── 加減「拍」──────────────────────────────────────────────────
// 加或刪一個拍會改變這一小節的總長度。Guitar Pro 也允許小節不滿或超過,
//    所以這裡不擋,但會在提示裡講出來,避免改完才發現小節長度不對。
function addBeatAfter() {
  const beat = editor.beat;
  if (!beat) {
    hint("先點一個音符或一個拍");
    return;
  }
  const voice = beat.voice;
  const fresh = new alphaTab.model.Beat();
  fresh.duration = beat.duration;   // 跟現在這一拍一樣長,是個休止符
  voice.insertBeat(beat, fresh);
  editor.beat = fresh;
  if (editor.note) paintNote(editor.note, false);
  editor.note = null;
  applyEdit("加一個拍", () => {
    const at = voice.beats.indexOf(fresh);
    if (at >= 0) voice.beats.splice(at, 1);
    editor.beat = beat;
  });
  hint("加了一個空拍,這一小節會變長。直接按數字就能填音進去");
}

function deleteBeat() {
  const beat = editor.beat;
  if (!beat) {
    hint("先點一個音符或一個拍");
    return;
  }
  const voice = beat.voice;
  if (voice.beats.length <= 1) {
    hint("這一小節只剩一個拍了,刪掉會變成空小節", true);
    return;
  }
  const at = voice.beats.indexOf(beat);
  if (at < 0) return;
  voice.beats.splice(at, 1);
  if (editor.note) paintNote(editor.note, false);
  editor.note = null;
  editor.beat = voice.beats[Math.min(at, voice.beats.length - 1)] ?? null;
  applyEdit("刪掉一個拍", () => {
    voice.beats.splice(at, 0, beat);
    editor.beat = beat;
  });
  hint("刪掉一個拍,這一小節會變短");
}

// ── 換弦、換音符 ────────────────────────────────────────────────
function moveString(step) {
  const track = editorTrack();
  const count = track?.staves?.[0]?.stringTuning?.tunings?.length || 6;
  editor.string = Math.max(1, Math.min(count, editor.string + step));
  const here = noteOnString(editor.beat, editor.string);
  if (here) selectNote(here);
  else {
    if (editor.note) paintNote(editor.note, false);
    editor.note = null;
    redrawKeepingPosition();
    showEditorStatus();
  }
}

function moveBeat(step) {
  const beat = editor.beat;
  if (!beat) return;
  const next = step > 0 ? beat.nextBeat : beat.previousBeat;
  if (!next) {
    hint(step > 0 ? "已經是最後一個拍了" : "已經是第一個拍了");
    return;
  }
  editor.beat = next;
  const here = noteOnString(next, editor.string) ?? next.notes[0] ?? null;
  if (here) selectNote(here);
  else {
    if (editor.note) paintNote(editor.note, false);
    editor.note = null;
    redrawKeepingPosition();
    showEditorStatus();
  }
}

// ── 存檔 ────────────────────────────────────────────────────────
// 寫回 Guitar Pro 7 格式(.gp)。TuxGuitar 與 Guitar Pro 都讀得懂,我們自己也讀得懂。
function saveScore() {
  try {
    const clean = withoutSelectionColor(() => {
      const exporter = new alphaTab.exporter.Gp7Exporter();
      return exporter.export(state.api.score, state.api.settings);
    });
    const name = (state.api.score.title || "score").replace(/[\\/:*?"<>|]+/g, "_");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([clean], { type: "application/octet-stream" }));
    link.download = `${name}.gp`;
    link.click();
    URL.revokeObjectURL(link.href);
    editor.dirty = false;
    showEditorStatus();
    hint(`已存成 ${name}.gp,存到你的「下載」資料夾`);
  } catch (error) {
    hint(`存檔失敗:${error?.message ?? error}`, true);
  }
}

// 選取用的藍色不能跟著存進檔案 —— 那是畫面上的東西,不是樂譜的內容。
function withoutSelectionColor(fn) {
  const note = editor.note;
  if (note) paintNote(note, false);
  try {
    return fn();
  } finally {
    if (note) paintNote(note, true);
  }
}

// ── 開關編輯模式 ────────────────────────────────────────────────
function setEditMode(on) {
  editor.on = on;
  ui.app.dataset.editing = String(on);
  ui.editButton.classList.toggle("is-on", on);
  ui.editBar.hidden = !on;
  if (on) {
    state.api.pause();
    // 編輯時要點得到音符。這個設定要開,alphaTab 才會記每個音符的位置。
    hint("點譜上一個音符,然後用鍵盤改它");
  } else {
    if (editor.note) paintNote(editor.note, false);
    editor.note = null;
    editor.beat = null;
    redrawKeepingPosition();
  }
  showEditorStatus();
}

// ── 接上畫面 ────────────────────────────────────────────────────
function wireEditor(api) {
  api.noteMouseDown.on((note) => {
    if (!editor.on) return;
    selectNote(note);
  });
  api.beatMouseDown.on((beat) => {
    if (!editor.on || !beat) return;
    // 點到小節裡沒有音符的位置也要選得到,不然加不了新的音
    if (!beat.notes.length) {
      if (editor.note) paintNote(editor.note, false);
      editor.note = null;
      editor.beat = beat;
      redrawKeepingPosition();
      showEditorStatus();
    }
  });
}

ui.editButton.addEventListener("click", () => setEditMode(!editor.on));
ui.editSave.addEventListener("click", saveScore);
ui.editUndo.addEventListener("click", undoLast);
ui.editDelete.addEventListener("click", deleteSelected);
ui.beatAdd.addEventListener("click", addBeatAfter);
ui.beatDelete.addEventListener("click", deleteBeat);

for (const button of all("[data-duration]")) {
  button.addEventListener("click", () => setDuration(Number(button.dataset.duration)));
}

document.addEventListener("keydown", (event) => {
  if (!editor.on) return;
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (document.querySelector("dialog[open]")) return;

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoLast();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveScore();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault();
    typeFret(event.key);
    return;
  }
  switch (event.key) {
    // 上下鍵:有弦的樂器是換弦,鍵盤樂器沒有弦可換,改的是音高
    case "ArrowUp":
      event.preventDefault();
      if (isStringedTrack()) moveString(-1); else transposeNote(1);
      break;
    case "ArrowDown":
      event.preventDefault();
      if (isStringedTrack()) moveString(1); else transposeNote(-1);
      break;
    case "ArrowLeft": event.preventDefault(); moveBeat(-1); break;
    case "ArrowRight": event.preventDefault(); moveBeat(1); break;
    case "Backspace":
    case "Delete": event.preventDefault(); deleteSelected(); break;
    case "Escape": event.preventDefault(); selectNote(null); break;
    default: break;
  }
}, true);

// 改了東西還沒存就想關掉視窗,要攔一下
window.addEventListener("beforeunload", (event) => {
  if (!editor.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

// 換歌、開別的檔也一樣會把改動洗掉,而且比關分頁更容易誤按。
// 沒有這一步時,改完直接換歌會讓改動消失,而且不會有任何提示。
// 這個函式給 player.js 在換譜之前呼叫。
function confirmDiscardEdits(what) {
  if (!editor.dirty) return true;
  const ok = window.confirm(
    `你改了譜還沒存。${what}會把改動丟掉。\n\n` +
    "按「取消」回去存檔（編輯工具列的「💾 存成 .gp 檔」），按「確定」丟掉改動。",
  );
  if (ok) {
    editor.dirty = false;
    editor.undo.length = 0;
    editor.note = null;
    editor.beat = null;
    showEditorStatus();
  }
  return ok;
}

window.scoreEditorGuard = { confirmDiscardEdits, isDirty: () => editor.dirty };

// 給自動測試用
window.scoreEditor = {
  getSnapshot: () => ({
    on: editor.on,
    dirty: editor.dirty,
    undoDepth: editor.undo.length,
    string: editor.string,
    fret: editor.note?.fret ?? null,
    hasNote: Boolean(editor.note),
    hasBeat: Boolean(editor.beat),
    duration: editor.beat?.duration ?? null,
    stringed: isStringedTrack(),
    midi: editor.note && !editor.note.isStringed
      ? editor.note.octave * 12 + editor.note.tone : null,
    beatsInBar: editor.beat?.voice?.beats.length ?? null,
    typing: editor.typing,
    status: ui.editStatus.textContent,
  }),
  setEditMode,
  selectFirstNote: () => {
    const track = editorTrack();
    for (const staff of track?.staves ?? []) {
      for (const bar of staff?.bars ?? []) {
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.notes.length) { selectNote(beat.notes[0]); return true; }
          }
        }
      }
    }
    return false;
  },
  typeFret,
  setDuration,
  deleteSelected,
  undoLast,
  moveString,
  moveBeat,
  transposeNote,
  addBeatAfter,
  deleteBeat,
  exportBytes: () => withoutSelectionColor(() =>
    new alphaTab.exporter.Gp7Exporter().export(state.api.score, state.api.settings).length),
};

// editor.js 在 player.js 之後才執行,所以這時 state.api 已經建好了。
if (state.api) wireEditor(state.api);
