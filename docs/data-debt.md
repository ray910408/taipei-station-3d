# 資料債總帳

這份清單把散在各 floor-note、ADR 與測試註記裡的已知缺口收在一處。**每一條都要能回指
repo 裡的證據**（檔案行號、實測數字或測試豁免），不收「感覺怪怪的」。佐證只認 git 追蹤中的
檔案——引用未入 git 的本機工作區等於沒有佐證。還完的條目直接刪，不留劃線存根——git
history 就是存根。

信心欄位（`confidence` 1–3）與 `estimated` 旗標的語意見 `data-conventions.md`；
本檔只記「已知不足且尚未解決」的部分。

## 1. 幾何精度

### 1.1 B2 月台帶 y 系統性偏差 8–14m（根源）

臺鐵 B2 月台帶的 y 位置與 B3 轉乘豎井實測有系統性落差，`docs/floor-notes/tra-platform-b2.md`
記為「帶重錨待更佳來源」。底圖是示意圖、無可描輪廓，改幾個座標無法收斂——**要新來源才還得掉**。

下列兩組（`rctp`／`tptc`）都是它的症狀，不要當獨立問題各修各的：

| 症狀 | 實測 | 現況 |
|---|---|---|
| `c-elv-rctp-1` 兩端不垂直 | 錯位 8.8m | `tests/connectors.test.ts:105` 明文豁免，不入不變式斷言 |
| `c-elv-rctp-2` 兩端不垂直 | 錯位 14.1m | 同上 |
| `c-elv-tptc-1` 兩端不垂直 | 錯位 1.8m | 同上 |
| `c-elv-tptc-2` 兩端不垂直 | 錯位 1.7m | 同上 |

電梯的不變式是上下同 xy，這四支都借用了帶著偏差的 B2 月台節點當落點，但借的不是同一種點：

- `c-elv-rctp-1/2` 落在 P4／P3 的**轉乘梯口** `n-tp-001`(92.8, 30)／`n-tp-003`(91.7, 8.5)——
  這兩點是 B3 前廳 `n-rc-017`(92.8, 38.8)／`n-rc-018`(91.7, 22.6) 的垂直投影再 clamp 進帶內，
  clamp 位移就是 8.8m／14.1m。
- `c-elv-tptc-1/2` 落在 P4／P3 的**候車點** `n-tp-002`／`n-tp-004`（`tra-platform-b2.md`
  2026-07-19 段：帶 y 錯位未解前不新增帶內節點，維持單一代表點）。

同組的 stair／escalator 共用同一對端點，所以帶債的不只電梯：`rctp` 側 8 支
（`c-stair-rctp-1`＋`c-esc-rctp-1/2`＋`c-elv-rctp-1` 用 `n-rc-017`↔`n-tp-001`；
`c-stair-rctp-2`＋`c-esc-rctp-3/4`＋`c-elv-rctp-2` 用 `n-rc-018`↔`n-tp-003`），
`tptc` 側 8 支（同樣的 stair/esc×2/elv 分組，分別掛 `n-tp-002`↔`n-tc-007`、
`n-tp-004`↔`n-tc-008`），**合計 16 支**。

### 1.2 route-align ~8m（設計決策未裁定）

梯井在資料裡建成**單一垂直點**——`c-esc-rprc-1/2/3/4`、`c-stair-rprc-1`、`c-esc-bctc-1/2`、
`c-stair-bctc-1` 的兩端 xy 完全相同，run = 0。手扶梯與樓梯實體必有水平行程，builder 因此
在渲染時合成斜向 ramp，於是**畫出來的斜坡與路線節點／marker／PDR 座標分家約 8m**。

三個選項待裁定，動工前先定案，不要各自打補丁：

1. 降 `escalatorRun`——縮小合成斜度，偏差變小但斜坡更陡、視覺失真。
2. 只在 overview 打斜、nav 場景收直——兩種呈現各自自洽，但同一設施兩種樣子。
3. route link 座標隨合成斜向同步位移——路線貼合渲染，但路網座標不再等於資料座標。

### 1.3 `c-esc-rctc-1/2` 坡度 48.6°

`n-rc-007`↔`n-tc-001` 平面距 11.46m，對 B3(−21m)→B1(−8m) 的 13m 高差，合 48.6°。
單支手扶梯不會這麼陡，研判是 B3→B1 的多段梯併成一支的建模近似。
`docs/floor-notes/mrt-r-concourse-b3.md:45` 另記「`c-esc-rctc-*` 的 B3 端口實際位置待考」，
兩者應為同一件事——還這筆要先定 B3 端口位置。

## 2. 未入模缺塊

範圍外或底圖無資訊，**不是錯誤，是空白**。補之前先確認落點是否已在模型範圍內，
否則寧可只留 note 也不要加孤兒節點。

- 板南線大廳→B1 站前地下街出口梯——上端落點在站前地下街，範圍外
  （`docs/floor-notes/mrt-bl-concourse-b2.md`：主帶納入 M3–M8，誠品與站前地下街不入模。
  底圖未把該梯對應到特定出口編號，別替它指定）。
- 誠品地下街、站前地下街連通道，以及資訊圖淡灰背景通道。
- 市民大道出口廊道（B3，`v < 518`、local `y > 47`）——Phase 2 劃在範圍外。
- 地面層完全未入模，而開放資料明載有兩支電梯通街面：
  `refs/opendata/elevator-locations.csv` 的 R10／BL12 列記「3號電梯：地面層（出口 M1 及
  出口 M2 中央）>B3層」、「5號電梯：出口 M4（忠孝西路靠臺鐵側）>B1層」。兩者的上端都在模型外。
- 板南線東西端隧道（不在資訊圖實線站體範圍內，未推估延伸）、月台門、梯群實際孔洞尺寸、
  中央垂直設施的設備外殼。
- **B1 柱網**：底圖無柱位標示，目前僅 3 支示意柱撐結構跨距，實際間距未知。

## 3. 語意推定（confidence ≤ 2）

樓層檔（`data/floors/*.json` 的 slab／areas／gates／units／pois）共 79 筆 `confidence ≤ 2`，
`data/connectors.json` 另有 39 筆（42 支連通器中的 39 支），**全站合計 118 筆**。
其中 4 筆為 `confidence = 1`：

- `p-rc-toilet-1`、`p-rc-exit-1`、`p-tc-toilet-1`、`p-tc-exit-1`——Phase 7 BUG-004 依公開資料
  推定的位置，**未經底圖描迹**。

另有兩處值得單獨盯：

- **板南線大廳整組票務邊界**（`a-bc-paid`、`a-bc-unpaid-*`、`g-bc-link-in/out/acc`）全為
  confidence 2：資訊圖未繪該閘門群，票務邊界、單向配置與無障礙道皆屬語意推定
  （`docs/floor-notes/mrt-bl-concourse-b2.md` 2026-07-31 段自述）。
  票務邊界是路網不變式的基礎，這組推定若錯，無障礙路線會跟著錯。
- **紅↔藍轉乘主梯的跨層歸屬**：`c-esc-rcbc-1/2` 與 `c-stair-rcbc-1` 都掛
  `n-rc-020`(98.5, −89) ↔ `n-bc-018`(93.1, −106.6)，source `trtc-info-b2`、confidence 2，
  note 自述「B3/B2 圖面梯口斜跨」。兩端平面距 18.4m，是全部 42 支連通器裡最大的一筆錯位，
  端點對應待現場核。

### 3.1 floor-note 未同步

`docs/floor-notes/mrt-bl-concourse-b2.md` 停在「本 task 不新增 connectors」，
未涵蓋後來加進來的 `c-esc-rcbc-1/2`、`c-stair-rcbc-1` 與節點 `n-bc-018`。
文件缺口，不是資料錯誤，但查圖的人會找不到這幾支的判讀依據。

## 4. 標高與方位全為估算

- `data/station.json` 六個樓層的 `elevation`／`height` **全部帶 `estimated: true`**。
  唯一手上的剖面圖（`S4`）圖面無尺寸、且自註僅供參考，**這條升級不了**，除非找到標尺寸的
  新來源。不要拿現有 refs 反覆重推，已經確認過推不動。
- `data/station.json` 的 `frame.bearing_status` 同樣是 `"estimated"`。已用北捷出入口 GPS
  開放資料核對過（`docs/data-conventions.md` 方位角段：local +Y 與真北差 0.02°±1.65°，
  僅隨機項），但**參考點是出口重心而非軌道點**，轉乘站的重心還會被另一條線拉走，
  系統性偏差開不出標準差——所以是「未被推翻」不是「已量測」。整條推導鏈釘在
  `tests/frame-bearing.test.ts`，那條測試紅了代表數字過期，要回去重推。
- `frame.origin_wgs84` 亦為 `status: "estimated"`（見 §5）。

## 5. POI 稀薄

各樓層只有 3–5 筆示範 POI，多數是 `sign`。真實 POI（ATM、哺集乳室、飲水機、M1–M8 出入口）
卡在同一個前置條件：要吃開放資料的經緯度，得先有 **WGS84→本地公尺的換算**。
缺的不是錨點——`data/station.json` 的 `frame.origin_wgs84` 已有 lat/lon（`status: "estimated"`，
取自臺鐵車站基本資料集 stationCode=1000，自註「僅供 GPS 粗定位錨定」）——
缺的是把經緯度轉進 local frame 的那一層函式，而且它要能承受 origin 本身只是粗定位、
`bearing_status` 也還是 estimated（§4）。`refs/sources.json` 各來源的 `calibration` 只有
`px_per_m`（像素→公尺）與控制點，補不上這一段。POI 管線本身已就緒，補資料即顯示。

## 6. WiFi 指紋線（非模型）

- **多 BSSID 同源合併判準兩個方向都不完備，待北車真實資料再裁定**（`CHANGELOG.md`
  「已知限制」）：
  - *過度合併*：`tools/fp-build.ts` 的 `mergeAnchors` 以「同 OUI ＋尾 3 bytes xor
    popcount ≤ 1」配對後跑 union-find，遞移會把同 OUI 的連號 MAC 串成一個錨點。
    合成資料踩不到——`tools/fp-sim.ts:110` 每顆 AP 的基底 MAC 是 `0x0a` 後接 5 個隨機
    byte，OUI 各不相同，永遠不會被分進同一組。真資料會。
  - *合併不足*：廠商把 IEEE locally-administered bit 設起來另開 BSSID，首 byte 一變就換
    OUI 群，同一台 AP 因此算成兩份獨立證據——**佔 Top-15 的 16.7%**
    （`tests/fixtures/real-home/README.md`；`tests/fp-real.test.ts:74` 以【已知缺口】特徵測試
    釘住現況，判準改了那兩條會紅）。
  兩個方向是同一個待決項，定案前不要只修一邊。
- 北車現場採集未做。**務必開新 session，不要續採家中那份**——家中 fixture
  （`tests/fixtures/real-home/session.jsonl` 檔頭）用的是 `rp/rp-pilot-spacing.json`、
  點號 P01–P08，與現行 `rp/rp-points.json`（353 點、`B1-001` 起）不是同一份清單。
  理由不是資料髒，是 `docs/wifi-collector-guide.md:99`：清單版本不符會**把同一個點號指到
  不同座標**，續採會靜默跳過不相干的新位置，而且混版無法合併建庫（`build:fp` 會擋）。
- **磁北↔模型北偏角需現場實測一次**：`tools/fp-build.ts` 的 `FpDb.magNorthOffsetDeg`
  目前是 `null` 佔位。這跟底圖的北無關——`docs/floor-notes/mrt-r-platform-b4.md:7` 記的
  「底圖北方相對 local 北方偏約 6.5°」是**示意圖繪製誤差**、已由相似變換吸收；
  `docs/data-conventions.md` 的結論是底圖指北針（12.3–14.3°）與出入口 GPS 相似變換（14.7°）
  兩者一致但不獨立、差約 0.4–2.4°，共用同一份底圖偏差。缺的是磁力計讀數對模型軸的偏角，
  只能現場量。
