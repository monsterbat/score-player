# Score Player

[English](#english) | [繁體中文](#繁體中文)

<a id="english"></a>

## English

An interactive music score player packaged as a single HTML file.
It renders Guitar Pro and MusicXML scores, plays them back with a built-in synthesizer,
and adds practice tools such as looping, a speed trainer, transposition, a guitar fretboard view,
and saxophone fingering charts.

### Features

- **Reads scores directly**: Guitar Pro 3–7 (`.gp`, `.gp3`, `.gp4`, `.gp5`, `.gpx`) and MusicXML (`.musicxml`, `.xml`, `.mxl`), with no conversion step.
- **Playback**: built-in synthesizer, metronome, count-in, per-track mute, solo, volume, and instrument selection.
- **Practice tools**: drag over the score to loop a passage, set the tempo from 25% to 150%,
  and use the speed trainer, which raises the tempo by 5% on every loop until the original speed is reached.
- **Following the music**: the current bar, beat, and sounding notes are highlighted, and the view scrolls line by line.
- **Fretboard view**: shows which frets are being played; saxophone tracks switch to a fingering chart automatically.
- **Key detection**: estimates the key from the notes in the score.
- **Transposition**: shifts playback by up to five semitones up or down.
- **Editing**: change frets, pitches, and note lengths with the keyboard, undo up to 200 steps, and save back to a Guitar Pro file.
- **Printing**: opens a clean print layout that can also be saved as PDF.
- **Themes**: three color themes, including a dark theme.

### Getting started

Requirements: Node.js 20 or later (required by Playwright).

```bash
npm install
npm run build      # writes output/score_player.html
```

Serve the output folder over HTTP and open the page in a browser:

```bash
python3 -m http.server --directory output 8000
# then open http://127.0.0.1:8000/score_player.html
```

The page must be opened over HTTP. The synthesizer runs in a Web Worker,
and browsers do not allow workers on pages opened directly from the file system;
in that case the score is displayed, playback is disabled, and the page explains why.

To add scores permanently, put the files in `scores/` and run `npm run build` again.
Scores can also be opened at any time with **Open file**.

### How it works

- `build_player.mjs` inlines the player code, the [alphaTab](https://github.com/CoderLine/alphaTab) engine,
  the music font, the SoundFont, and every score in `scores/` into one self-contained HTML file.
- `web/player.js` handles rendering, playback, looping, tempo, and the track mixer.
- `web/editor.js` implements note editing with undo and saving back to Guitar Pro.
- `web/fretboard.js` and `web/saxfingering.js` draw the guitar fretboard and the saxophone fingering chart.
- `web/keydetect.js` estimates the key by correlating note durations with the Krumhansl–Kessler major and minor key profiles.

### Testing

```bash
npm run check      # builds the player, then runs a Playwright test suite in Google Chrome
```

The test suite starts a local server, loads the built page, and checks rendering, playback,
the fretboard and fingering chart, the help dialog, layout overflow, and console errors.
Additional song-specific checks run when `scores/expected.json` describes a Guitar Pro test file;
those files are not included in this repository for copyright reasons.

### Sample score

`scores/Ode_to_Joy_sax.musicxml`: *Ode to Joy* (Ludwig van Beethoven, public domain).

### License

- Source code: MIT License. See [LICENSE](LICENSE).
- The built page bundles third-party assets under their own licenses:
  alphaTab (MPL-2.0), the Bravura music font (SIL Open Font License 1.1),
  and the SONiVOX SoundFont (Apache License 2.0).

---

<a id="繁體中文"></a>

## 繁體中文

**Score Player(互動樂譜播放器)**

打包成單一 HTML 檔的互動樂譜播放器。
可以直接顯示 Guitar Pro 與 MusicXML 樂譜、用內建合成器播放,
並提供循環練習、速度訓練、移調、吉他指板圖與薩克斯風指法圖等練習工具。

### 功能

- **直接讀取樂譜**:Guitar Pro 3–7(`.gp`、`.gp3`、`.gp4`、`.gp5`、`.gpx`)與 MusicXML(`.musicxml`、`.xml`、`.mxl`),不需要先轉檔。
- **播放**:內建合成器、節拍器、預備拍,以及每一軌的靜音、獨奏、音量與樂器選擇。
- **練習工具**:在譜上拖曳選取一段即可循環播放;速度可調整為 25% 到 150%;
  速度訓練器每循環一輪自動加快 5%,直到回到原速。
- **跟隨播放位置**:目前的小節、拍點與正在發聲的音符會標示出來,畫面逐行自動捲動。
- **指板圖**:顯示正在彈奏的格位;薩克斯風的軌會自動切換成指法圖。
- **調性判斷**:依譜上的音符估計樂曲的調性。
- **移調**:播放時可升降最多五個半音。
- **編輯**:用鍵盤修改格位、音高與音長,最多可復原 200 步,並可存回 Guitar Pro 檔。
- **列印**:開啟只有樂譜的列印版面,也可以儲存成 PDF。
- **配色**:三種配色,包含深色模式。

### 開始使用

需求:Node.js 20 以上(Playwright 的要求)。

```bash
npm install
npm run build      # 產生 output/score_player.html
```

用 HTTP 提供 output 資料夾,再用瀏覽器開啟:

```bash
python3 -m http.server --directory output 8000
# 接著開啟 http://127.0.0.1:8000/score_player.html
```

頁面必須透過 HTTP 開啟。合成器執行在 Web Worker 中,
而瀏覽器不允許直接從檔案系統開啟的頁面建立 Worker;
這種情況下仍可看譜,但無法播放,頁面上也會說明原因。

要把樂譜固定放進曲目清單,把檔案放進 `scores/` 後重新執行 `npm run build`。
也可以隨時用「開啟檔案」開啟其他樂譜。

### 運作方式

- `build_player.mjs` 把播放器程式、[alphaTab](https://github.com/CoderLine/alphaTab) 引擎、
  樂譜字型、SoundFont 與 `scores/` 中的所有樂譜,打包成一個獨立的 HTML 檔。
- `web/player.js`:排版、播放、循環、速度與音軌混音。
- `web/editor.js`:音符編輯、復原,以及存回 Guitar Pro 檔。
- `web/fretboard.js`、`web/saxfingering.js`:吉他指板圖與薩克斯風指法圖。
- `web/keydetect.js`:把音符時值的統計和 Krumhansl–Kessler 大小調調性輪廓做相關比對,估計樂曲的調性。

### 測試

```bash
npm run check      # 先建置播放器,再用 Playwright 在 Google Chrome 中執行測試
```

測試會啟動本機伺服器、載入建置好的頁面,並檢查排版、播放、指板圖與指法圖、說明視窗、版面溢出與主控台錯誤。
當 `scores/expected.json` 描述了 Guitar Pro 測試檔時,會另外執行針對該曲目的檢查;
這些檔案因版權因素沒有放在這個 repository 中。

### 範例樂譜

`scores/Ode_to_Joy_sax.musicxml`:《快樂頌》(貝多芬,公共領域)。

### 授權

- 程式碼:MIT License,見 [LICENSE](LICENSE)。
- 建置出的頁面包含依各自授權散布的第三方資源:
  alphaTab(MPL-2.0)、Bravura 樂譜字型(SIL Open Font License 1.1)、SONiVOX SoundFont(Apache License 2.0)。
