# Relic Ledger

Warframe Prime 部件與 relic 路線的本機工具。它可以讀取 AlecaFrame 匯出的 `lastData.dat`，在瀏覽器本機解密與分析，不會上傳 inventory。

## 開發

```powershell
npm install
npm run update:catalog
npm run dev
```

## Catalog 更新

`npm run update:catalog` 會讀取公開的 WFCD Digital Extremes 掉落表、WFCD item catalog 與 Warframe world state，找出目前 Prime Resurgence 的 featured Prime items，並產生 `src/data/catalog.generated.json`。

當 relic 沒有出現在目前任務掉落表時，介面會標記為需要確認 Varzia / Aya，避免把過期任務誤顯示成可取得來源。

## Inventory parser

`src/lib/inventoryParser.ts` 是 AlecaFrame Inventory Parser 的本機實作，支援 AlecaFrame AES-CBC `.dat` 與解密後 JSON。也可以直接匯入 JSON 方便測試。
