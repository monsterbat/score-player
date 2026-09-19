// 互動樂譜播放器 —— 譜面與播放全部交給 alphaTab(它讀 Guitar Pro 檔,畫出來就是 Guitar Pro 的樣子)。
// 這支檔案只做兩件事:把 alphaTab 接起來,以及把它的功能接到畫面上的按鈕。

const one = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];

const ui = {
  app: one(".app"),
  songSelect: one("#song-select"), songMeta: one("#song-meta"),
  trackList: one("#track-list"), trackAll: one("#track-all"),
  surface: one("#alphatab"), overlay: one("#overlay"),
  play: one("#play"), stop: one("#stop"), toStart: one("#to-start"),
  prevBar: one("#prev-bar"), nextBar: one("#next-bar"),
  bar: one("#bar-readout"), time: one("#time-readout"), tempo: one("#tempo-readout"),
  loop: one("#loop"), metronome: one("#metronome"), countin: one("#countin"),
  speed: one("#speed"), speedLabel: one("#speed-label"), progress: one("#progress"),
  file: one("#score-file"), help: one("#help-button"), guide: one("#guide"),
  hint: one("#hint"),
  mixerButton: one("#mixer-button"), mixer: one("#mixer"), mixerRows: one("#mixer-rows"),
  mixerReset: one("#mixer-reset"),
  lookButton: one("#look-button"), look: one("#look"), lookReset: one("#look-reset"),
  cursorColors: one("#cursor-colors"),
  editButton: one("#edit-button"), editBar: one("#edit-bar"), editStatus: one("#edit-status"),
  editSave: one("#edit-save"), editUndo: one("#edit-undo"), editDelete: one("#edit-delete"),
  trainer: one("#trainer"), trainerRound: one("#trainer-round"),
  fretboardButton: one("#fretboard-button"), fretboardWrap: one("#fretboard-wrap"),
  fretboard: one("#fretboard"),
  keyBadge: one("#key-badge"),
  beatAdd: one("#beat-add"), beatDelete: one("#beat-delete"),
  printButton: one("#print-button"), transpose: one("#transpose"),
};

const state = {
  api: null, songIndex: 0, shownTracks: new Set(), muted: new Set(), soloed: new Set(),
  ready: false, playing: false, tick: 0, time: 0, endTime: 1, bar: 1, barCount: 1,
  stave: "ScoreTab", seeking: false, canPlay: true, lastClickBar: null,
  instruments: new Map(), theme: "paper", cursorColor: "#e03131",
  trainer: false, trainerRound: 0, trainerFrom: 100, transpose: 0,
};

// 雙擊 HTML 檔用的是 file:// ,而瀏覽器不讓 file:// 底下的網頁開背景執行緒。
// alphaTab 的合成器就住在背景執行緒裡 —— 所以譜看得到,但按播放不會有聲音。
// 不要讓它安靜地沒反應,要在畫面上講清楚原因。
const IS_FILE = location.protocol === "file:";

function hint(message, warn = false) {
  ui.hint.textContent = message;
  ui.hint.classList.toggle("is-warn", warn);
  ui.hint.classList.add("is-on");
  clearTimeout(hint.timer);
  hint.timer = setTimeout(() => ui.hint.classList.remove("is-on"), 3200);
}

function clock(milliseconds) {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const library = Array.isArray(window.SCORE_LIBRARY) ? window.SCORE_LIBRARY : [];
const bytesOf = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

// ── 啟動 alphaTab ────────────────────────────────────────────────
function createApi() {
  const source = document.getElementById("alphatab-src").textContent;
  (0, eval)(source);

  // 合成器在背景執行緒裡跑,它需要知道「去哪裡載 alphaTab」。
  // 這頁是單一檔案、旁邊沒有 .js 可以指,所以把原始碼包成一個網址給它。
  const scriptFile = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

  const settings = {
    core: {
      scriptFile,
      useWorkers: !IS_FILE,
      // 記下每個音符畫在哪裡。編輯要靠它才點得到音符;不開的話 noteMouseDown 永遠不觸發。
      includeNoteBounds: true,
      smuflFontSources: new Map([
        [alphaTab.FontFileFormat.Woff2, `data:font/woff2;base64,${window.AT_ASSETS.font}`],
      ]),
    },
    display: { staveProfile: state.stave, scale: 1.0 },
    notation: {
      // 譜面左邊那條直排的軌名關掉:左側清單已經標明現在看的是哪一軌,
      // 而且它常常被擠成半截字(「Lead & Sol」)。
      elements: new Map([[alphaTab.NotationElement.TrackNames, false]]),
    },
    player: {
      // enablePlayer 在 1.6 之後已經作廢,要用 playerMode。
      playerMode: IS_FILE ? "disabled" : "enabledAutomatic",
      // 官方文件:JavaScript 版「player.soundFont 必須設成音源檔的網址」。
      // 事後才呼叫 loadSoundFont 會直接回 false,而且不報錯 —— 游標照跑,只是沒有聲音。
      soundFont: IS_FILE ? null : `data:application/octet-stream;base64,${window.AT_ASSETS.soundfont}`,
      enableCursor: true,
      enableAnimatedBeatCursor: true,
      // 正在響的那幾個音符也要跟著變色,不然只有一條線在跑,看不出彈到哪一個音
      enableElementHighlighting: true,
      enableUserInteraction: true,
      // 不用 alphaTab 的自動捲動。實測 scrollOffsetY 會捲過頭 ——
      // 播到第 23 小節時游標跑到可視區上方外 234 像素,人就看不到自己彈到哪了。
      // 改成下面的 followCursor() 自己跟,規則講得死。
      scrollMode: "off",
    },
  };

  const api = new alphaTab.AlphaTabApi(ui.surface, settings);
  state.api = api;
  window.at = api;

  api.error.on((error) => {
    ui.overlay.hidden = false;
    ui.overlay.textContent = `讀不了這份譜:${error?.message ?? error}`;
  });

  api.scoreLoaded.on((score) => {
    state.barCount = score.masterBars.length;
    // 預設只看第一軌,跟 Guitar Pro 一樣。
    // 一度改成「8 軌全部疊起來」,結果一行只塞得下 2 小節,176 小節要捲 88 個畫面 ——
    // 比原本更難讀。要看哪一軌,左邊點一下就換。
    state.shownTracks = new Set([score.tracks[0]?.index ?? 0]);
    state.muted.clear();
    state.soloed.clear();
    renderTrackList(score);
    // 選單上本來顯示檔名。檔案裡有真正的歌名,讀到就換掉。
    const option = ui.songSelect.options[state.songIndex];
    if (option && score.title) {
      option.textContent = score.artist ? `${score.title} — ${score.artist}` : score.title;
    }
    ui.songMeta.textContent = [
      score.artist, score.album,
      `${score.tracks.length} 軌`, `${score.masterBars.length} 小節`,
    ].filter(Boolean).join(" · ");
  });

  api.renderStarted.on(() => { ui.overlay.hidden = false; ui.overlay.textContent = "正在排譜…"; });
  api.renderFinished.on(() => {
    ui.overlay.hidden = true;
    ui.app.dataset.appReady = "true";
    updateTempo();
  });

  api.playerReady.on(() => { state.ready = true; });

  // 實測過:開循環的時候每繞回去一次也會觸發這個事件,不是只有整首播完才觸發。
  api.playerFinished.on(() => stepUpSpeed());

  api.playerStateChanged.on((args) => {
    state.playing = args.state === 1;
    ui.play.textContent = state.playing ? "⏸" : "▶";
    ui.play.setAttribute("aria-label", state.playing ? "暫停" : "播放");
  });

  api.playerPositionChanged.on((args) => {
    state.tick = args.currentTick;
    state.time = args.currentTime;
    state.endTime = Math.max(1, args.endTime);
    updateReadout();
    followCursor();
  });

  // 點譜面就跳到那裡;按住拖過一段就是「選這幾小節」。
  // alphaTab 內建的拖曳選取會自己處理範圍,這裡只補「單擊 = 跳過去」那一半。
  let pressedBeat = null;
  api.beatMouseDown.on((beat) => { pressedBeat = beat; });
  api.beatMouseUp.on((beat) => {
    const sameBeat = pressedBeat && beat && beat === pressedBeat;
    if (sameBeat) {
      state.api.tickPosition = beat.absolutePlaybackStart;
      state.lastClickBar = barAtTick(beat.absolutePlaybackStart);
    }
    pressedBeat = null;
  });

  api.playbackRangeChanged.on((args) => {
    const range = args.playbackRange;
    if (!range) {
      ui.loop.classList.remove("is-on");
      return;
    }
    const from = barAtTick(range.startTick);
    const to = barAtTick(range.endTick);
    if (state.api.isLooping) {
      jumpIntoRange(range);
      hint(`改成重複第 ${from} 到 ${to} 小節`);
    } else {
      hint(`已選第 ${from} 到 ${to} 小節，按「🔁 循環」重複練這一段`);
    }
  });

  return api;
}

// ── 小節與位置 ──────────────────────────────────────────────────
function masterBars() {
  return state.api?.score?.masterBars ?? [];
}

function barAtTick(tick) {
  const bars = masterBars();
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if (tick >= bars[index].start) return index + 1;
  }
  return 1;
}

function seekToBar(number) {
  const bars = masterBars();
  const target = bars[Math.max(0, Math.min(bars.length - 1, number - 1))];
  if (!target) return;
  state.api.tickPosition = target.start;
  // 跳過去之後畫面要跟著帶過去,不然人在看的還是原本那一段
  requestAnimationFrame(() => followCursor(true));
}

// 讓正在彈的那一行留在畫面上方,不要讓游標跑出去。
// 只在游標真的跑掉時才捲,不然每一拍都動會看得很暈。
const FOLLOW_TOP = 0.22;      // 捲完之後游標停在可視區上方 22% 的位置
const FOLLOW_BOTTOM = 0.62;   // 游標低於 62% 就該捲了
let followAt = 0;

function followCursor(force = false) {
  const now = performance.now();
  if (!force && now - followAt < 250) return;   // 讀座標會觸發重排,不要每一拍都算
  followAt = now;

  const cursor = ui.surface.querySelector(".at-cursor-beat");
  if (!cursor) return;
  const area = ui.surface.getBoundingClientRect();
  const box = cursor.getBoundingClientRect();
  if (!box.height) return;

  const y = box.top - area.top;
  const tooHigh = y < 0;
  const tooLow = y > area.height * FOLLOW_BOTTOM;
  if (!force && !tooHigh && !tooLow) return;

  const target = area.height * FOLLOW_TOP;
  const top = Math.max(0, ui.surface.scrollTop + (y - target));
  ui.surface.scrollTo({ top, behavior: force ? "auto" : "smooth" });
}

function updateReadout() {
  state.bar = barAtTick(state.tick);
  ui.bar.textContent = `${state.bar} / ${state.barCount}`;
  ui.time.textContent = `${clock(state.time)} / ${clock(state.endTime)}`;
  if (!state.seeking) ui.progress.value = String(Math.round((state.time / state.endTime) * 1000));
  updateTempo();
}

// 顯示「現在實際上是幾拍」:原譜速度乘上使用者拉的百分比。
// 慢速練習時要顯示的是 82,不是 165。
function updateTempo() {
  const base = state.api?.score?.tempo ?? 0;
  const speed = state.api?.playbackSpeed ?? 1;
  const now = Math.round(base * speed);
  ui.tempo.textContent = speed === 1 ? `♩ = ${base}` : `♩ = ${now}(原曲 ${base})`;
}

// ── 音軌清單:Guitar Pro 的左側面板 ──────────────────────────────
function renderTrackList(score) {
  ui.trackList.innerHTML = "";
  for (const track of score.tracks) {
    const item = document.createElement("li");
    item.className = "track";
    item.dataset.index = String(track.index);

    // 不要用「有沒有調弦資料」判斷是不是打擊樂器 —— 鋼琴也沒有調弦,
    //    會被誤判成打擊(例如鋼琴軌)。
    const staff = track.staves?.[0];
    const strings = staff?.stringTuning?.tunings?.length ?? 0;
    const kind = staff?.isPercussion ? "打擊" : strings ? `${strings} 弦` : "鍵盤／其他";

    const name = document.createElement("div");
    name.className = "track-name";
    name.textContent = track.name || `音軌 ${track.index + 1}`;
    const sub = document.createElement("span");
    sub.className = "track-sub";
    sub.textContent = kind;
    name.appendChild(sub);

    const mute = document.createElement("button");
    mute.className = "chip";
    mute.type = "button";
    mute.textContent = "M";
    mute.title = "靜音這一軌";

    const solo = document.createElement("button");
    solo.className = "chip";
    solo.type = "button";
    solo.textContent = "S";
    solo.title = "只聽這一軌";

    item.append(name, mute, solo);
    ui.trackList.appendChild(item);

    // 點軌名 = 只看這一軌的譜(Guitar Pro 的 focus 模式)
    name.addEventListener("click", () => showOnly(track));
    mute.addEventListener("click", (event) => { event.stopPropagation(); toggleMute(track); });
    solo.addEventListener("click", (event) => { event.stopPropagation(); toggleSolo(track); });
  }
  paintTrackList();
}

function paintTrackList() {
  for (const item of all(".track")) {
    const index = Number(item.dataset.index);
    item.classList.toggle("is-shown", state.shownTracks.has(index));
    item.querySelector(".chip:nth-of-type(1)")?.classList.toggle("is-mute", state.muted.has(index));
    item.querySelector(".chip:nth-of-type(2)")?.classList.toggle("is-solo", state.soloed.has(index));
  }
}

function showOnly(track) {
  state.shownTracks = new Set([track.index]);
  state.api.renderTracks([track]);
  paintTrackList();
  hint(`只顯示「${track.name}」的譜。要看全部按右上角「全部顯示」`);
}

function showAll() {
  const tracks = state.api.score.tracks;
  state.shownTracks = new Set(tracks.map((track) => track.index));
  state.api.renderTracks(tracks);
  paintTrackList();
  if (tracks.length > 3) hint(`${tracks.length} 軌疊在一起,一行只放得下兩三個小節,會變得很長`);
}

function toggleMute(track) {
  const on = !state.muted.has(track.index);
  if (on) state.muted.add(track.index); else state.muted.delete(track.index);
  state.api.changeTrackMute([track], on);
  paintTrackList();
}

function toggleSolo(track) {
  const on = !state.soloed.has(track.index);
  if (on) state.soloed.add(track.index); else state.soloed.delete(track.index);
  state.api.changeTrackSolo([track], on);
  paintTrackList();
}

// ── 載入曲目 ────────────────────────────────────────────────────
function fillSongSelect() {
  ui.songSelect.innerHTML = library
    .map((song, index) => `<option value="${index}">${song.title}${song.artist ? ` — ${song.artist}` : ""}</option>`)
    .join("");
  ui.songSelect.hidden = library.length < 2;
}

// gp3/gp4/gp5 是 2007 年以前的格式,裡面的文字是用 Windows-1252 存的,不是 UTF-8。
// 用 UTF-8 去讀,「Percusión」會變成「Percusi◆n」—— 不會報錯,只是字壞掉。
// gpx(GP6)、gp(GP7)、MusicXML 則是 UTF-8。
function encodingFor(filename) {
  return /\.(gp3|gp4|gp5)$/i.test(filename) ? "windows-1252" : "utf-8";
}

function loadData(buffer, filename) {
  state.api.settings.importer.encoding = encodingFor(filename);
  state.api.updateSettings();
  state.api.load(buffer);
}

function loadSong(index) {
  const song = library[index];
  if (!song) return;
  state.songIndex = index;
  ui.songSelect.value = String(index);
  ui.overlay.hidden = false;
  ui.overlay.textContent = `正在載入《${song.title}》…`;
  ui.app.dataset.appReady = "false";
  state.instruments.clear();  // 音色是跟著某一首譜的,換歌就重來
  state.trainer = false;
  state.trainerRound = 0;
  paintTrainer();
  state.transpose = 0;
  ui.transpose.value = "0";
  ui.transpose.classList.remove("is-on");
  loadData(bytesOf(song.data).buffer, song.file);
}

// ── 畫面上的按鈕接到 alphaTab ───────────────────────────────────
ui.songSelect.addEventListener("change", () => {
  // 改了譜還沒存就換歌,改動會直接不見 —— 先問一聲。
  if (!askBeforeLosingEdits("換一首歌")) {
    ui.songSelect.value = String(state.songIndex);   // 選單彈回去,不然畫面跟實際不一致
    return;
  }
  loadSong(Number(ui.songSelect.value));
});

// editor.js 比這支晚載入,所以用的時候才去拿,不要在檔案開頭就抓。
function askBeforeLosingEdits(what) {
  return window.scoreEditorGuard?.confirmDiscardEdits(what) ?? true;
}
ui.trackAll.addEventListener("click", showAll);

ui.play.addEventListener("click", () => {
  if (!state.canPlay) {
    hint("雙擊檔案打開時沒有聲音，要用主控台的網址開才聽得到", true);
    return;
  }
  state.api.playPause();
});
ui.stop.addEventListener("click", () => state.api.stop());
ui.toStart.addEventListener("click", () => seekToBar(1));
ui.prevBar.addEventListener("click", () => seekToBar(state.bar - 1));
ui.nextBar.addEventListener("click", () => seekToBar(state.bar + 1));

ui.loop.addEventListener("click", () => {
  const on = !state.api.isLooping;
  state.api.isLooping = on;
  ui.loop.classList.toggle("is-on", on);
  if (!on) return;

  const range = state.api.playbackRange;
  if (!range) {
    hint("整首會重複播。想只練一段，先在譜上按住拖曳選起來");
    return;
  }
  // 播放位置如果不在選取範圍裡,按播放會從原本的位置開始 ——
  // 人會以為循環壞了。所以開循環的當下就把位置移到那一段的開頭。
  jumpIntoRange(range);
  hint(`會重複第 ${barAtTick(range.startTick)} 到 ${barAtTick(range.endTick)} 小節`);
});

function jumpIntoRange(range) {
  if (!range) return;
  if (state.tick < range.startTick || state.tick >= range.endTick) {
    state.api.tickPosition = range.startTick;
    requestAnimationFrame(() => followCursor(true));
  }
}

// ── 速度訓練器 ────────────────────────────────────────────────
// 練不熟的段落:框一段、開循環、把速度拉慢、開漸快。
// 每重複一輪自動加快 5%,回到原速就停下來。Guitar Pro 的 speed trainer 就是這個。
const TRAINER_STEP = 5;   // 每一輪加幾 %

function paintTrainer() {
  ui.trainer.classList.toggle("is-on", state.trainer);
  const showing = state.trainer && state.trainerRound > 0;
  ui.trainerRound.hidden = !showing;
  if (showing) ui.trainerRound.textContent = `第 ${state.trainerRound} 輪`;
}

function stepUpSpeed() {
  if (!state.trainer) return;
  const now = Math.round(state.api.playbackSpeed * 100);
  if (now >= 100) {
    state.trainer = false;
    state.trainerRound = 0;
    paintTrainer();
    hint("已經回到原速,漸快關掉了");
    return;
  }
  const next = Math.min(100, now + TRAINER_STEP);
  state.trainerRound += 1;
  ui.speed.value = String(next);
  ui.speedLabel.textContent = `${next}%`;
  state.api.playbackSpeed = next / 100;
  updateTempo();
  paintTrainer();
}

ui.trainer.addEventListener("click", () => {
  state.trainer = !state.trainer;
  state.trainerRound = 0;
  if (state.trainer) {
    state.trainerFrom = Number(ui.speed.value);
    if (state.trainerFrom >= 100) {
      hint("先把速度拉慢,漸快才有東西可以加", true);
    } else if (!state.api.isLooping) {
      hint(`從 ${state.trainerFrom}% 開始,每播完一次加 ${TRAINER_STEP}%。配循環用最好`);
    } else {
      hint(`從 ${state.trainerFrom}% 開始,每重複一輪加 ${TRAINER_STEP}%,到原速停`);
    }
  }
  paintTrainer();
});

ui.metronome.addEventListener("click", () => {
  const on = state.api.metronomeVolume === 0;
  state.api.metronomeVolume = on ? 1 : 0;
  ui.metronome.classList.toggle("is-on", on);
});

ui.countin.addEventListener("click", () => {
  const on = state.api.countInVolume === 0;
  state.api.countInVolume = on ? 1 : 0;
  ui.countin.classList.toggle("is-on", on);
});

ui.speed.addEventListener("input", () => {
  const percent = Number(ui.speed.value);
  ui.speedLabel.textContent = `${percent}%`;
  state.api.playbackSpeed = percent / 100;
  updateTempo();
  state.trainerRound = 0;   // 手動調整速度時,輪數重新計算
  paintTrainer();
});

ui.progress.addEventListener("pointerdown", () => { state.seeking = true; });
ui.progress.addEventListener("change", () => {
  state.seeking = false;
  state.api.timePosition = (Number(ui.progress.value) / 1000) * state.endTime;
});

for (const button of all("[data-stave]")) {
  button.addEventListener("click", () => {
    state.stave = button.dataset.stave;
    all("[data-stave]").forEach((other) => other.classList.toggle("is-on", other === button));
    state.api.settings.display.staveProfile = alphaTab.StaveProfile[state.stave];
    state.api.updateSettings();
    state.api.render();
  });
}

// ── 列印 / 存 PDF ──
// alphaTab 內建的 print():它會另開一個乾淨的排版視窗,不是把整個介面印出來。
ui.printButton.addEventListener("click", () => {
  try {
    state.api.print();
    hint("列印視窗開了。要存 PDF 的話,在印表機那邊選「儲存為 PDF」");
  } catch (error) {
    hint(`列印開不起來:${error?.message ?? error}`, true);
  }
});

// ── 移調 ──
// 改的是「播出來的聲音」,譜上的音符不動 —— 練唱降 key、或想聽別的調時用。
// 這不是改樂譜。要真的改譜請用編輯模式。
ui.transpose.addEventListener("click", () => {});
ui.transpose.addEventListener("change", () => {
  const semitones = Number(ui.transpose.value);
  // 正確的方法叫 changeTrackTranspositionPitch,跟 changeTrackVolume 同一組。
  // 一度寫成 applyTranspositionPitches —— 那是合成器內部的方法,不在這個物件上,
  // 呼叫下去是「不是一個函式」,而移調就靜靜地沒發生。
  state.api.changeTrackTranspositionPitch(state.api.score.tracks, semitones);
  state.transpose = semitones;
  ui.transpose.classList.toggle("is-on", semitones !== 0);
  hint(semitones === 0 ? "回到原調" : `播出來的聲音移調 ${semitones > 0 ? "＋" : ""}${semitones} 個半音（譜沒有變）`);
});

ui.help.addEventListener("click", () => ui.guide.showModal());

// 說明視窗的四個分頁
for (const tab of all("[data-guide]")) {
  tab.addEventListener("click", () => {
    all("[data-guide]").forEach((other) => other.classList.toggle("is-on", other === tab));
    all(".guide-page").forEach((page) => { page.hidden = page.dataset.page !== tab.dataset.guide; });
  });
}

// 每個對話框右上角補一顆叉叉
for (const dialog of all("dialog")) {
  const close = document.createElement("button");
  close.className = "dlg-close";
  close.type = "button";
  close.textContent = "✕";
  close.setAttribute("aria-label", "關閉");
  close.addEventListener("click", () => dialog.close());
  dialog.prepend(close);
}

ui.file.addEventListener("change", async () => {
  const file = ui.file.files?.[0];
  if (!file) return;
  if (!askBeforeLosingEdits("開別的檔案")) {
    ui.file.value = "";
    return;
  }
  ui.overlay.hidden = false;
  ui.overlay.textContent = `正在讀 ${file.name}…`;
  try {
    loadData(await file.arrayBuffer(), file.name);
    ui.songSelect.selectedIndex = -1;
    hint(`已載入 ${file.name}`);
  } catch (error) {
    ui.overlay.textContent = `讀不了這個檔案:${error?.message ?? error}`;
  } finally {
    ui.file.value = "";
  }
});

document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
  if (typing || ui.guide.open) return;
  if (event.code === "Space") { event.preventDefault(); ui.play.click(); }
  if (event.code === "ArrowLeft") { event.preventDefault(); ui.prevBar.click(); }
  if (event.code === "ArrowRight") { event.preventDefault(); ui.nextBar.click(); }
});

// ── 音色 ──────────────────────────────────────────────────────
// General MIDI 的 128 種樂器裡挑常用的。編號是標準的,不要自己改號碼。
const INSTRUMENTS = [
  ["鋼琴", [[0, "平台鋼琴"], [4, "電鋼琴"], [6, "大鍵琴"]]],
  ["木吉他", [[24, "尼龍弦"], [25, "鋼弦"]]],
  ["電吉他", [[26, "爵士"], [27, "乾淨"], [28, "悶音"], [29, "破音"], [30, "失真"], [31, "泛音"]]],
  ["貝斯", [[32, "木貝斯"], [33, "指彈電貝斯"], [34, "撥片電貝斯"], [35, "無格貝斯"], [38, "合成貝斯"]]],
  ["弦樂", [[40, "小提琴"], [42, "大提琴"], [45, "撥弦"], [48, "弦樂合奏"], [49, "慢起弦樂"]]],
  ["管樂", [[56, "小號"], [57, "長號"], [65, "中音薩克斯風"], [73, "長笛"]]],
  ["人聲", [[52, "合唱"], [53, "啊"], [54, "合成人聲"]]],
  ["合成器", [[80, "方波"], [81, "鋸齒波"], [88, "新世紀"], [91, "合成襯底"]]],
  ["風琴", [[16, "電風琴"], [19, "教堂風琴"], [21, "手風琴"]]],
];

function instrumentOptions(current) {
  const groups = INSTRUMENTS.map(([label, items]) => {
    const options = items
      .map(([program, name]) => `<option value="${program}"${program === current ? " selected" : ""}>${name}</option>`)
      .join("");
    return `<optgroup label="${label}">${options}</optgroup>`;
  }).join("");
  // 原譜指定的樂器可能不在上面的精選清單裡,那就額外補一個,免得下拉顯示成別的樂器
  const known = INSTRUMENTS.some(([, items]) => items.some(([program]) => program === current));
  const extra = known ? "" : `<option value="${current}" selected>原譜設定(第 ${current} 號)</option>`;
  return extra + groups;
}

function openMixer() {
  const score = state.api?.score;
  if (!score) return;
  ui.mixerRows.innerHTML = "";
  for (const track of score.tracks) {
    const info = track.playbackInfo;
    const percussion = track.staves?.[0]?.isPercussion ?? false;
    const row = document.createElement("div");
    row.className = `mixer-row${percussion ? " is-percussion" : ""}`;
    row.innerHTML = `
      <div class="name" title="${track.name}">${track.name}</div>
      <select data-track="${track.index}" ${percussion ? "disabled" : ""}>
        ${percussion ? '<option>打擊組(固定)</option>' : instrumentOptions(info.program)}
      </select>
      <input type="range" min="0" max="16" value="${info.volume}" data-volume="${track.index}">`;
    ui.mixerRows.appendChild(row);
  }

  for (const select of ui.mixerRows.querySelectorAll("select[data-track]")) {
    select.addEventListener("change", () => setInstrument(Number(select.dataset.track), Number(select.value)));
  }
  for (const slider of ui.mixerRows.querySelectorAll("input[data-volume]")) {
    slider.addEventListener("input", () => {
      const track = score.tracks[Number(slider.dataset.volume)];
      state.api.changeTrackVolume([track], Number(slider.value) / 16);
    });
  }
  ui.mixer.showModal();
}

// 換樂器 = 改那一軌的 MIDI 樂器編號,然後叫 alphaTab 重新產生一次 MIDI。
// 只改 playbackInfo.program 不會有任何反應 —— 聲音是照已經產好的 MIDI 在播的。
function setInstrument(trackIndex, program) {
  const track = state.api.score.tracks[trackIndex];
  if (!track) return;
  track.playbackInfo.program = program;
  state.instruments.set(trackIndex, program);
  const wasPlaying = state.playing;
  const at = state.api.tickPosition;
  state.api.renderScore(state.api.score, [...state.shownTracks]);
  state.api.tickPosition = at;
  if (wasPlaying) state.api.play();
  hint(`「${track.name}」換成新的音色了`);
}

function resetMixer() {
  state.instruments.clear();
  const index = state.songIndex;
  ui.mixer.close();
  loadSong(index);
  hint("音色與音量都還原成原譜的設定");
}

// ── 外觀 ──────────────────────────────────────────────────────
const CURSOR_COLORS = [
  ["#e03131", "紅"], ["#f08c00", "橙"], ["#1971c2", "藍"], ["#2f9e44", "綠"], ["#9c36b5", "紫"],
];

function applyLook() {
  document.documentElement.style.setProperty("--cursor", state.cursorColor);
  ui.surface.dataset.theme = state.theme;
  for (const button of all("[data-theme]")) button.classList.toggle("is-on", button.dataset.theme === state.theme);
  for (const swatch of all(".swatch")) swatch.classList.toggle("is-on", swatch.dataset.color === state.cursorColor);
  try {
    localStorage.setItem("scorePlayerLook", JSON.stringify({ theme: state.theme, cursorColor: state.cursorColor }));
  } catch { /* 瀏覽器不給存就算了,下次開回預設值而已 */ }
}

function restoreLook() {
  try {
    const saved = JSON.parse(localStorage.getItem("scorePlayerLook") ?? "{}");
    if (typeof saved.theme === "string") state.theme = saved.theme;
    if (typeof saved.cursorColor === "string") state.cursorColor = saved.cursorColor;
  } catch { /* 存壞了就用預設值 */ }
}

function buildLookDialog() {
  ui.cursorColors.innerHTML = CURSOR_COLORS
    .map(([color, name]) => `<button class="swatch" type="button" data-color="${color}" style="background:${color}" title="${name}" aria-label="${name}色游標"></button>`)
    .join("");
  for (const swatch of all(".swatch")) {
    swatch.addEventListener("click", () => { state.cursorColor = swatch.dataset.color; applyLook(); });
  }
  for (const button of all("[data-theme]")) {
    button.addEventListener("click", () => { state.theme = button.dataset.theme; applyLook(); });
  }
}

ui.mixerButton.addEventListener("click", openMixer);
ui.mixerReset.addEventListener("click", resetMixer);
ui.lookButton.addEventListener("click", () => ui.look.showModal());
ui.lookReset.addEventListener("click", () => {
  state.theme = "paper";
  state.cursorColor = "#e03131";
  applyLook();
});

// 給自動測試用的:一次拿到現在的所有狀態
window.scorePlayer = {
  getSnapshot: () => ({
    ready: ui.app.dataset.appReady === "true",
    playerReady: state.ready,
    canPlay: state.canPlay,
    title: state.api?.score?.title ?? null,
    artist: state.api?.score?.artist ?? null,
    songCount: library.length,
    songIndex: state.songIndex,
    trackCount: state.api?.score?.tracks.length ?? 0,
    trackNames: state.api?.score?.tracks.map((track) => track.name) ?? [],
    shownTracks: [...state.shownTracks],
    muted: [...state.muted],
    soloed: [...state.soloed],
    barCount: state.barCount,
    bar: state.bar,
    tick: state.tick,
    time: state.time,
    playing: state.playing,
    stave: state.stave,
    lastClickBar: state.lastClickBar,
    theme: state.theme,
    cursorColor: state.cursorColor,
    programs: state.api?.score?.tracks.map((track) => track.playbackInfo.program) ?? [],
    volumes: state.api?.score?.tracks.map((track) => track.playbackInfo.volume) ?? [],
    speed: state.api?.playbackSpeed ?? 1,
    metronome: (state.api?.metronomeVolume ?? 0) > 0,
    countIn: (state.api?.countInVolume ?? 0) > 0,
    trainer: state.trainer,
    trainerRound: state.trainerRound,
    transpose: state.transpose,
    looping: state.api?.isLooping ?? false,
    range: state.api?.playbackRange
      ? { startTick: state.api.playbackRange.startTick, endTick: state.api.playbackRange.endTick }
      : null,
  }),
  seekToBar,
  showAll,
};

// ── 開機 ────────────────────────────────────────────────────────
(() => {
  all("[data-stave]").forEach((button) => button.classList.toggle("is-on", button.dataset.stave === state.stave));
  ui.speedLabel.textContent = `${ui.speed.value}%`;
  if (!library.length) {
    ui.overlay.textContent = "這份播放器裡沒有任何樂譜";
    return;
  }
  restoreLook();
  buildLookDialog();
  applyLook();
  fillSongSelect();
  createApi();
  if (IS_FILE) {
    state.canPlay = false;
    hint("雙擊打開只能看譜，要聽聲音請用主控台的網址開", true);
  }
  loadSong(0);
})();
