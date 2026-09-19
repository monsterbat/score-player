// 指板圖 —— 播到哪裡,就顯示現在按哪幾格。
//
// 為什麼要有:六線譜上的數字要自己換算成「手放在指板哪裡」,初學者很難。
// Guitar Pro 8 畫面下方就有這一塊。
//
// 資料從哪來:alphaTab 的 activeBeatsChanged 事件會給「正在響的那幾拍」,
// 每個音符自己帶著 string 與 fret。不用自己從音高反推按法。

const FRETS = 15;              // 畫到第幾格
const MARKER_FRETS = [3, 5, 7, 9, 15];   // 指板上那些圓點記號
const DOUBLE_MARKER = 12;      // 第 12 格是兩個點

// 這個函式原本在 player.js,改用 alphaTab 時隨著自製六線譜一起移除;指板圖仍需要它,所以在這裡保留一份。
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function fretNoteName(midi, tuning = []) {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  // 吉他第 1 弦與第 6 弦都叫 E。同名時把高的那根寫成小寫,才分得出來。
  const same = tuning.filter((other) => ((other % 12) + 12) % 12 === ((midi % 12) + 12) % 12);
  return same.length > 1 && midi === Math.max(...same) ? name.toLowerCase() : name;
}

const fretboard = {
  on: false,
  tuning: [],        // 由高音弦到低音弦的 MIDI
  active: new Map(), // string → fret
  midi: null,        // 管樂用:譜上正在響的那個音
};

function fretboardTrack() {
  return state.api?.score?.tracks[[...state.shownTracks][0] ?? 0];
}

function fretboardTuning() {
  const track = fretboardTrack();
  const staff = track?.staves?.[0];
  if (staff?.isPercussion) return null;          // 打擊樂器沒有指板
  const tunings = staff?.stringTuning?.tunings;
  return tunings?.length ? [...tunings] : null;  // alphaTab 給的順序:第 1 弦(最高音)在前
}

function drawFretboard() {
  // 薩克斯風軌改畫按鍵圖。這個判斷只對「沒有弦與格位」的軌成立,
  // 所以有六線譜的軌(包括樂器編號剛好是薩克斯風、實際寫在六線譜上的主唱軌)行為完全不變。
  if (window.scoreSaxFingering?.isSaxTrack(fretboardTrack())) {
    fretboard.tuning = [];
    window.scoreSaxFingering.drawSaxFingering(fretboard.midi);
    return;
  }

  const tuning = fretboardTuning();
  fretboard.tuning = tuning ?? [];

  if (!tuning) {
    ui.fretboard.innerHTML = '<p class="fretboard-empty">這一軌沒有指板（打擊樂器或鍵盤）</p>';
    return;
  }

  const strings = tuning.length;
  const left = 44;               // 左邊留給空弦音名
  const nutX = 62;               // 琴枕
  const width = 1000;
  const cellW = (width - nutX - 12) / FRETS;
  const rowH = 17;
  const top = 16;
  const height = top * 2 + (strings - 1) * rowH;

  const y = (index) => top + index * rowH;
  const fretX = (fret) => nutX + (fret - 0.5) * cellW;   // 格子的中間

  const parts = [];

  // 品格線
  for (let fret = 0; fret <= FRETS; fret += 1) {
    const x = nutX + fret * cellW;
    const isNut = fret === 0;
    parts.push(
      `<line x1="${x}" y1="${y(0)}" x2="${x}" y2="${y(strings - 1)}" ` +
      `stroke="${isNut ? "#9aa5b6" : "#5a6273"}" stroke-width="${isNut ? 4 : 1.2}"/>`,
    );
  }

  // 指板上的圓點記號
  const midY = (y(0) + y(strings - 1)) / 2;
  for (const fret of MARKER_FRETS) {
    if (fret > FRETS) continue;
    parts.push(`<circle cx="${fretX(fret)}" cy="${midY}" r="3.5" fill="#4a5364"/>`);
  }
  if (DOUBLE_MARKER <= FRETS) {
    const gap = rowH * 1.2;
    parts.push(`<circle cx="${fretX(DOUBLE_MARKER)}" cy="${midY - gap}" r="3.5" fill="#4a5364"/>`);
    parts.push(`<circle cx="${fretX(DOUBLE_MARKER)}" cy="${midY + gap}" r="3.5" fill="#4a5364"/>`);
  }

  // 弦與空弦音名
  tuning.forEach((open, index) => {
    const rowY = y(index);
    const thickness = 0.9 + (index / Math.max(1, strings - 1)) * 1.5;   // 低音弦畫粗一點
    parts.push(
      `<line x1="${nutX}" y1="${rowY}" x2="${width - 12}" y2="${rowY}" stroke="#8793a3" stroke-width="${thickness}"/>`,
    );
    parts.push(
      `<text x="${left}" y="${rowY + 4}" text-anchor="middle" font-size="11" ` +
      `font-family="ui-monospace,monospace" fill="#9aa5b6">${fretNoteName(open, tuning)}</text>`,
    );
  });

  // 格號
  for (const fret of [1, 3, 5, 7, 9, 12, 15]) {
    if (fret > FRETS) continue;
    parts.push(
      `<text x="${fretX(fret)}" y="${height - 1}" text-anchor="middle" font-size="9" fill="#6b7686">${fret}</text>`,
    );
  }

  // 正在按的位置
  for (const [stringNumber, fret] of fretboard.active) {
    const index = stringNumber - 1;                 // 第 1 弦畫在最上面
    if (index < 0 || index >= strings) continue;
    const rowY = y(index);
    if (fret === 0) {
      // 空弦:畫在琴枕左邊的空心圈
      parts.push(`<circle cx="${nutX - 12}" cy="${rowY}" r="6" fill="none" stroke="var(--cursor)" stroke-width="2.5"/>`);
      continue;
    }
    if (fret > FRETS) continue;
    parts.push(`<circle cx="${fretX(fret)}" cy="${rowY}" r="8" fill="var(--cursor)"/>`);
    parts.push(
      `<text x="${fretX(fret)}" y="${rowY + 3.5}" text-anchor="middle" font-size="10" ` +
      `font-weight="700" fill="#ffffff">${fret}</text>`,
    );
  }

  ui.fretboard.innerHTML =
    `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="吉他指板">${parts.join("")}</svg>`;
}

// 正在響的那幾拍 → 指板上該亮哪幾點
function updateFretboard(beats) {
  if (!fretboard.on) return;
  fretboard.active.clear();
  fretboard.midi = null;
  for (const beat of beats ?? []) {
    // 只看現在顯示的那一軌,不然八軌的音會全部疊在同一塊指板上
    if (!state.shownTracks.has(beat.voice.bar.staff.track.index)) continue;
    for (const note of beat.notes) {
      if (Number.isFinite(note.string) && Number.isFinite(note.fret) && note.string > 0) {
        fretboard.active.set(note.string, note.fret);
      }
      // 管樂一次只吹得出一個音。譜上有和聲時取最高的那個,主旋律通常在上面。
      // 要用 displayValue(譜上看到的),不是 realValue —— 指法表查的是記譜音。
      if (Number.isFinite(note.displayValue)) {
        fretboard.midi = Math.max(fretboard.midi ?? -1, note.displayValue);
      }
    }
  }
  drawFretboard();
}

function setFretboard(on) {
  fretboard.on = on;
  ui.fretboardButton.classList.toggle("is-on", on);
  ui.fretboardWrap.hidden = !on;
  if (on) drawFretboard();
  try {
    localStorage.setItem("scorePlayerFretboard", on ? "1" : "0");
  } catch { /* 存不了就算了,下次開回預設 */ }
}

ui.fretboardButton.addEventListener("click", () => setFretboard(!fretboard.on));

if (state.api) {
  state.api.activeBeatsChanged.on((args) => updateFretboard(args.activeBeats));
  // 換譜、換軌、停掉都要把亮點清掉,不要留著上一首的手型
  state.api.scoreLoaded.on(() => {
    fretboard.active.clear(); fretboard.midi = null;
    if (fretboard.on) drawFretboard();
  });
  state.api.renderFinished.on(() => { if (fretboard.on) drawFretboard(); });
  // 暫停時要「留著」最後那個手型 —— 人就是停在那裡看著練的。
  // 一暫停就清空,看起來會像指板壞了;只有按停止(回到開頭)才清空。
  ui.stop.addEventListener("click", () => {
    fretboard.active.clear();
    fretboard.midi = null;
    if (fretboard.on) drawFretboard();
  });
}

// 開機:記得上次的選擇
try {
  setFretboard(localStorage.getItem("scorePlayerFretboard") === "1");
} catch {
  setFretboard(false);
}

window.scoreFretboard = {
  getSnapshot: () => ({
    on: fretboard.on,
    strings: fretboard.tuning.length,
    active: [...fretboard.active].map(([s, f]) => ({ string: s, fret: f })),
    midi: fretboard.midi,
    sax: !!window.scoreSaxFingering?.isSaxTrack(fretboardTrack()),
    dots: ui.fretboard.querySelectorAll('circle[fill="var(--cursor)"]').length,
  }),
  setFretboard,
};
