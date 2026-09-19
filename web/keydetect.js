// 判斷這首歌是什麼調:讓只熟悉彈奏、不熟悉樂理的使用者,也能快速知道樂曲的調性。
//
// 先查過現成的:npm 上的 key detection 套件(bpm-key-finder、pyKeyFinder 那一類)
//    全部是「從音訊猜」的,要先做 chroma 特徵抽取。我們手上已經有精確的音符與時值,
//    那一整層不需要,只需要它們共用的統計方法。所以這裡自己實作那 40 行。
//
// 方法:Krumhansl-Schmuckler。把每個音級(C, C#, D…)在整首歌裡響了多久加起來,
// 得到 12 個數字,再跟 24 組「典型的大小調輪廓」比對相關係數,最像的那個就是答案。

// Krumhansl & Kessler (1982) 量出來的調性輪廓。不要自己改這些數字。
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PITCH_NAMES_ZH = ["C", "C♯/D♭", "D", "D♯/E♭", "E", "F", "F♯/G♭", "G", "G♯/A♭", "A", "A♯/B♭", "B"];

// 譜上寫的調號 → 調名。keySignature 是升降記號的數量,負數是降記號。
const MAJOR_BY_FIFTHS = {
  "-7": "C♭", "-6": "G♭", "-5": "D♭", "-4": "A♭", "-3": "E♭", "-2": "B♭", "-1": "F",
  0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F♯", 7: "C♯",
};
const MINOR_BY_FIFTHS = {
  "-7": "A♭", "-6": "E♭", "-5": "B♭", "-4": "F", "-3": "C", "-2": "G", "-1": "D",
  0: "A", 1: "E", 2: "B", 3: "F♯", 4: "C♯", 5: "G♯", 6: "D♯", 7: "A♯",
};

function correlation(a, b) {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let top = 0;
  let leftSq = 0;
  let rightSq = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    top += da * db;
    leftSq += da * da;
    rightSq += db * db;
  }
  const bottom = Math.sqrt(leftSq * rightSq);
  return bottom === 0 ? 0 : top / bottom;
}

// 走過整份譜,把每個音級響了多久加起來。
// 用「時值」加權而不是「出現次數」—— 一個全音符的 C 對調性的影響,
//    本來就比一個十六分音符的 C 大得多。
function pitchProfile(score, trackIndexes) {
  const weights = new Array(12).fill(0);
  let notes = 0;
  // 換歌的瞬間這棵樹可能還沒長好(曾出現過一次
  //    「Cannot read properties of undefined (reading 'bars')」,後來重現不出來)。
  //    這條路每次重新排版都會走一遍,壞掉就整個徽章不見,所以每一層都擋。
  for (const track of score.tracks ?? []) {
    if (trackIndexes && !trackIndexes.has(track.index)) continue;
    for (const staff of track?.staves ?? []) {
      if (staff?.isPercussion) continue;   // 打擊樂器沒有音高,算進去只會干擾
      for (const bar of staff?.bars ?? []) {
        for (const voice of bar?.voices ?? []) {
          for (const beat of voice?.beats ?? []) {
            const length = Math.max(1, beat.playbackDuration || 0);
            for (const note of beat?.notes ?? []) {
              const midi = note.isStringed
                ? (staff.stringTuning?.tunings?.[note.string - 1] ?? 0) + note.fret
                : note.octave * 12 + note.tone;
              if (midi <= 0) continue;
              weights[((midi % 12) + 12) % 12] += length;
              notes += 1;
            }
          }
        }
      }
    }
  }
  return { weights, notes };
}

function detectKey(score, trackIndexes) {
  const { weights, notes } = pitchProfile(score, trackIndexes);
  if (notes < 8) return null;   // 音太少,算出來只是噪音

  const results = [];
  for (let root = 0; root < 12; root += 1) {
    const rotated = weights.map((_, i) => weights[(i + root) % 12]);
    results.push({ root, mode: "大調", score: correlation(rotated, MAJOR_PROFILE) });
    results.push({ root, mode: "小調", score: correlation(rotated, MINOR_PROFILE) });
  }
  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  const second = results[1];
  return {
    name: `${PITCH_NAMES_ZH[best.root]} ${best.mode}`,
    score: best.score,
    runnerUp: `${PITCH_NAMES_ZH[second.root]} ${second.mode}`,
    gap: best.score - second.score,
    notes,
  };
}

function writtenKey(score) {
  const first = score.masterBars[0];
  if (!first) return null;
  const fifths = first.keySignature;
  const minor = first.keySignatureType === 1;   // 0 大調 1 小調
  const table = minor ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS;
  const name = table[String(fifths)];
  return name ? `${name} ${minor ? "小調" : "大調"}` : null;
}

function refreshKey() {
  const score = state.api?.score;
  if (!score?.tracks?.length) return;
  const written = writtenKey(score);
  const heard = detectKey(score, state.shownTracks);

  if (!heard) {
    ui.keyBadge.textContent = written ? `調號 ${written}` : "";
    ui.keyBadge.title = "";
    ui.keyBadge.hidden = !written;
    return;
  }

  // 把握程度:跟第二名差多少。差很少代表這首歌本身就在兩個調之間游移。
  const sure = heard.gap >= 0.06 ? "" : "（不太確定）";
  const same = written && written.replace(/[♯♭]/g, (m) => m) === heard.name;
  ui.keyBadge.hidden = false;
  ui.keyBadge.textContent = `🎼 ${heard.name}${sure}`;
  ui.keyBadge.classList.toggle("is-mismatch", Boolean(written) && !same);
  ui.keyBadge.title = [
    `聽起來像:${heard.name}(相關係數 ${heard.score.toFixed(2)},第二名 ${heard.runnerUp})`,
    written ? `譜上標的調號:${written}` : "譜上沒有標調號",
    `依據 ${heard.notes} 個音的時值統計(Krumhansl-Schmuckler)`,
    Boolean(written) && !same ? "⚠️ 兩者不一致 —— 常見於轉調的歌,或譜的調號本來就標得不準" : "",
  ].filter(Boolean).join("\n");
}

if (state.api) {
  state.api.renderFinished.on(() => refreshKey());
}

window.scoreKey = {
  getSnapshot: () => {
    const score = state.api?.score;
    return {
      written: score ? writtenKey(score) : null,
      heard: score ? detectKey(score, state.shownTracks) : null,
      badge: ui.keyBadge.textContent,
      visible: !ui.keyBadge.hidden,
    };
  },
  detectKey,
  refreshKey,
};
