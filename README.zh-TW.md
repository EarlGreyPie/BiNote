# BiNote

[한국어](README.md) · [English](README.en.md) · [日本語](README.ja.md) · 繁體中文 · [简体中文](README.zh-Hans.md)

BiNote 是《瑪奇 Mobile》用的 MML 樂譜編輯器，可以在鋼琴卷簾或指法譜上寫 MML。
每個和弦聲部都是一條獨立的音軌。可以用多個音色包試聽，也能把 MML 最佳化、分割，以符合遊戲上限（每份樂譜的字數與和弦數）。

**立即使用：[binote.pages.dev](https://binote.pages.dev)**

**《瑪奇》**（PC 版）用的樂譜可能會有部分**相容性問題**，請參考下方「相容性」一節。

- 形式：TypeScript 網頁應用程式 + PWA（Windows、iPad、Android）
- 輸入：鋼琴卷簾、指法譜
- 操作：鍵盤、滑鼠、觸控
- 製作：EarlGreyPie

> 這是**非官方的個人粉絲自製工具**，與 Nexon、《瑪奇 Mobile》無關。遊戲名稱、樂器名稱與聲音的權利屬於 Nexon。

## 使用前須知

- **音色包**：沒有音色包也能編輯樂譜。若要聽到聲音，請自行取得瑪奇的音色包（.dls）並在應用程式中載入。音色包屬於 Nexon 的資產，BiNote 不附帶，本儲存庫也不散布。
- **儲存位置**：樂曲與音色包檔案不會上傳到任何伺服器，只會保留在你裝置上的瀏覽器中。應用程式沒有分析或廣告腳本。瀏覽器清理資料時可能會刪除它們，想保留的樂曲請儲存為專案（.mme）檔案。
- **語言**：한국어、English、日本語、繁體中文、简体中文。
- **翻譯**：韓文以外的翻譯尚未完全經過人工檢查。部分名稱是暫定譯名，例如在日本與台灣伺服器找不到官方名稱的樂器。若發現錯誤或不自然的文字，請在 [issues](../../issues/new/choose) 中用「翻譯回報」告訴我們。遊戲內的官方名稱對我們幫助很大。

## 使用方法

[使用指南](docs/guide/zh-TW.md)介紹畫面、輸入音符、匯出 MML、檔案格式與快速鍵。

## 測試版計畫

測試版網址：[beta.binote.pages.dev](https://beta.binote.pages.dev)

BiNote 另外設有測試新功能的測試版頁面。
新功能會先在測試版頁面測試一段時間，再加入正式頁面。

- 測試版頁面有仍在測試中的功能，可能不穩定。重要的樂曲請儲存為專案（.mme）檔案。
- 測試版頁面與正式頁面的儲存空間是分開的。一邊的樂曲與音色包在另一邊看不到，要移過去時請先存成檔案，再到另一邊的頁面開啟。
- 若在測試版頁面發現問題，請用 [Beta bug report](../../issues/new?template=beta.yml) 回報，對開發很有幫助。

## 問題與貢獻

- 問題與翻譯錯誤請在 [issues](../../issues/new/choose) 回報。請附上設定最下方顯示的版本，不要附上音色包檔案。
- 也歡迎用 issue 提出功能建議。目前不接受程式碼的 pull request。

## 檔案

- **專案（.mme）**：BiNote 自己的格式，用來保留作品。
- **相容格式**：3MLE .mml、MabiIcco .mmi、MIDI，以及貼到遊戲裡的 `MML@` 文字。

## 相容性

部分樂譜（連音）可能無法正確帶到《瑪奇》（PC 版）。不建議用 BiNote 製作給《瑪奇》（PC 版）用的複雜樂譜。

> 《瑪奇》使用整數 tick。《瑪奇 Mobile》也接受分數長度，BiNote 是以分數為基礎設計的。因此，部分 MML 在使用整數 tick 的工具或遊戲中可能會出錯。

## 關於開發

- 企劃、遊戲實測、QA：EarlGreyPie
- 程式碼：Claude
- 程式碼檢查：GPT
- 遊戲行為以我們在遊戲中親自錄音、測量的數值為準。測量資料：樂器音色邊界實測報告（[한국어](docs/measure/timbre-boundaries.md)、[日本語](docs/measure/timbre-boundaries.ja.md)）

**與現有工具的關係**

- BiNote 沒有使用現有編輯器 3MLE、MabiIcco（mmlTools）的程式碼，開發時只參考了它們的行為與功能。
- BiNote 計算長度的方式與這些工具不同。我們盡量維持相容，但並不完美。若發現問題，請在 GitHub 開 issue。

建置步驟與套件結構請見[韓文 README](README.md#개발)。

## 授權

BiNote 以 [GNU GPL v3](LICENSE)（GPL-3.0-only）發布。散布修改版時，必須以相同授權公開其原始碼。

- 內含函式庫（SpessaSynth Apache-2.0，CodeMirror、Svelte、VexFlow MIT 等）的聲明在 [`apps/web/public/licenses/third-party.txt`](apps/web/public/licenses/third-party.txt)，字型聲明（OFL）在 [`fonts.txt`](apps/web/public/licenses/fonts.txt)。
- 《瑪奇 Mobile》音色包、樂器名稱等遊戲資產的權利屬於 Nexon，不包含在本儲存庫中。
