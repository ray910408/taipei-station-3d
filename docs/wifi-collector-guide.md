# 北車 WiFi 指紋採集操作手冊

工具:`tools/wifi-collector`(Android APK)+ `npm run gen:rp`(產點腳本)。
資料流:產點 → 手機採集 → 匯出 JSONL → 離線 pipeline(另案)。

## 一、出發前(電腦)

1. 產 RP 清單與找點圖:

   ```
   npm run gen:rp -- --spacing 6 --svg
   ```

   看終端摘要的「每層點數 · 預估工時」,太多就調 `--spacing 8` 重跑。
   產物:`rp/rp-points.json`、`rp/maps/<樓層>.svg`。

2. SVG 找點圖每層印一張(或存手機相簿)——紅點編號就是現場行走順序。
3. 把 `rp-points.json` 傳進手機(USB 丟 Download、或 LINE/Drive 自傳)。
4. Build + 裝 APK(改過碼才需要):

   ```
   cd tools/wifi-collector && .\gradlew.bat :app:assembleDebug
   ```

   把 `tools/wifi-collector/app/build/outputs/apk/debug/app-debug.apk` 傳到手機(Drive/LINE/USB 檔案複製皆可),手機檔案管理器點開安裝,首次需允許「安裝未知應用程式」;不需要 USB 偵錯與 adb。

   備註:閃退查因才需要 USB + `adb logcat`。

## 二、手機設定(紅米 Note 11 Pro / MIUI,採集前一次搞定)

| 設定 | 路徑 |
|---|---|
| 關 Wi-Fi 掃描節流 ★最重要 | 設定 → 更多設定 → 開發者選項 → Wi-Fi 掃描節流(關) |
| 開定位服務 | 設定 → 位置資訊(開,不用連 GPS 也行) |
| WiFi 開啟 | 不用連任何網路,開著就好 |
| 螢幕別鎖 | app 會自動常亮,但把自動鎖定調長更保險 |
| 電量 | 掃描+螢幕常亮很吃電,帶行動電源 |

## 三、現場 SOP

1. 進站後**畫 8 字校正磁力計**(手機在胸前畫 ∞,約 10 秒)。
2. 開 app:三項檢查全綠 → 選 `rp-points.json` → 單朝向、N=10 → 新 session(或續採)→ 開始採集。
3. 對照紙圖走到目前點位(畫面大字 = 點 id + 座標 + 區域備註),**站定、手機平拿在胸前**。
4. 按「開始掃描」,站著別動 ~40 秒(按鈕顯示「掃描中 秒數 · k/N 次 · AP 數」;單次掃描要等幾秒,k 不是每秒跳)。完點自動跳下一點。
5. 特殊狀況:
   - 點被圍住/不可達 → 「跳過」填原因。
   - 剛剛那點有人牆擋著亂掃 → 「重採此點」。
   - 想先掃別區 → 「點位清單」跳點。
6. 換層:點位清單跳到該層第一點;**每層自成一段,別跨層亂跳**(指紋分層建庫)。
7. 離場前按「匯出」把 session 檔丟 Drive/LINE 備份。**檔案在手機本機,沒匯出也不會丟**,但備份是好習慣。
8. 下次來續採:setup 頁選「續採 sXXXXXXXX-XXXX」,已完成點自動跳過。

## 四、四朝向模式(進階,選用)

setup 選「四朝向」:每點要面向磁北 0°/東 90°/南 180°/西 270° 各掃一輪。
畫面會顯示「目標朝向 vs 目前羅盤」,轉到 ±20° 內按鈕才會亮。單點時間 ×4,先用單朝向鋪滿全站再說。

## 五、疑難排解

| 症狀 | 原因/處理 |
|---|---|
| 紅字「偵測到掃描節流」 | 開發者選項的節流又開了(系統更新會重開)——關掉,該點重採 |
| AP 數一直是 0 | 定位服務沒開,或權限被收回 → 回 setup 頁重新檢查 |
| 「成功掃描 <60%」 | WiFi 晶片忙/系統卡,原地重採一次;連續發生就重開 WiFi |
| 羅盤顯示 -- 或亂跳 | 磁力計沒校正 → 畫 8 字;梯廳/閘門邊本來就會亂,記錄照常(accuracy 有入檔) |
| 選不到 rp-points.json | 檔案 app 找 Download 資料夾;副檔名必須 .json |
| MIUI 裝不了 APK | 首次安裝要在彈窗允許「安裝未知應用程式」;若被 MIUI 純淨模式擋下,關閉純淨模式再裝 |

## 六、資料檔在哪、長怎樣

- 手機路徑:`Android/data/com.taipeistation.wififp/files/sessions/wifi-fp-s<日期-時間>.jsonl`
- 一行一筆:`session`(檔頭)/`point`(每點每朝向)/`skip`。
- `point` 含:模型座標 x/y、樓層、磁方位 headingDeg、N 批 `scans[].aps[]`(bssid/ssid/rssi/freq)、磁力統計 `mag`。
- 同一 (pointId, headingSlot) 出現多行 = 有重採,**離線一律取最後一行**。
- 重採請一次做完再離開 app(中途殺 app 會讓續採把舊資料當已完成)。
- 磁北 vs 模型北的固定偏角:現場找一條已知軸向走廊(如臺鐵站體長軸,模型 +X)面向走廊方向記下羅盤讀數一次,交給離線 pipeline。

## 七、Schema 對照

詳見 `docs/superpowers/specs/2026-07-24-wifi-fingerprint-collector-design.md` 的資料 schema 章節。
