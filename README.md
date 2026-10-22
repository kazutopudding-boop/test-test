# 🌏 ワールドダッシュボード

現在地の天気、世界のニュース（3D の地球儀つき）、注目株の値動きを1ページで見られるサイトです。
GitHub だけで動くので、自分のサーバーはいりません。

- **天気** … ブラウザの位置情報から現在地を調べ、今の天気・24時間・週間予報を表示
- **ニュース** … Google ニュースのトップニュースなどを表示。見出しの地名から場所を推定して地球儀に点で表示し、ニュースを選ぶとその場所まで地球儀が回って移動します
- **株価** … 日経平均・NYダウなどの指標と、日本株・米国株の注目銘柄の前日比と、日足のローソク足チャート（上昇・陽線は赤、下落・陰線は青）

## 公開のしかた（最初の1回だけ）

1. このリポジトリの **Settings → Pages** を開く
2. 「Build and deployment」の **Source** を **GitHub Actions** に変える
3. **Actions** タブ → 左の「ダッシュボードの更新」→ **Run workflow** を押す
   （main ブランチに変更を入れたときも自動で動きます）
4. 数分たつと `https://<ユーザー名>.github.io/<リポジトリ名>/` で見られます
   このリポジトリなら https://kazutopudding-boop.github.io/test-test/

そのあとは、1時間ごとに自動でニュースと株価が新しくなります。

## しくみ

```
GitHub Actions（1時間ごと）
  └ scripts/update_data.py がニュースと株価を集めて site/data/*.json を作る
  └ site/ フォルダをまるごと GitHub Pages に公開
ブラウザ
  └ site/data/*.json を読んでニュースと株価を表示
  └ 天気は Open-Meteo に直接問い合わせる（登録不要・無料）
```

| ファイル | 役割 |
|---|---|
| `site/index.html`, `site/assets/` | 公開されるページ（HTML・CSS・JavaScript） |
| `scripts/update_data.py` | ニュースと株価を集めるスクリプト（Python の標準機能だけで動きます） |
| `scripts/places.json` | 見出しから場所を探すための地名リスト（緯度・経度つき） |
| `scripts/test_update_data.py` | スクリプトのテスト |
| `.github/workflows/dashboard.yml` | 自動実行と公開の設定 |

## 自分好みに変える

- **株の銘柄を変える** … `scripts/update_data.py` の `JP_STOCKS`（日本株）と `US_STOCKS`（米国株）に「銘柄コード: 名前」を足したり消したりします。日本株のコードは末尾に `.T` を付けます（例: `"7203.T": "トヨタ自動車"`）
- **地名を足す** … `scripts/places.json` に1行足します。`rank` は場所の細かさ（4=都市, 3=県・州, 2=国, 1=広い地域や国際機関, 0=人物などの弱い手がかり）です
- **更新の間隔を変える** … `.github/workflows/dashboard.yml` の `cron` を変えます

## 手元で動かす

```sh
python3 scripts/update_data.py --out site/data   # データを作る
python3 -m http.server -d site 8000              # http://localhost:8000 を開く
python3 -m unittest discover -s scripts -v       # テスト
```

## 注意

- ニュースの場所は見出しの地名から自動で推定しているので、ずれることがあります。場所の手がかりがない国内ニュースは「日本（場所は推定）」として東京に置いています
- ニュースは見出しと元の記事へのリンクだけを表示しています
- 株価は Yahoo Finance の公開データを使っていて、遅れて表示されます。投資の判断には使わないでください
- GitHub は、リポジトリに60日間変更がないと定期実行を止めます。止まったときは Actions タブから再開できます

## 使っているもの

天気: [Open-Meteo](https://open-meteo.com/)（CC BY 4.0）／地名: [BigDataCloud](https://www.bigdatacloud.com/)／ニュース: [Google ニュース](https://news.google.com/)／株価: [Yahoo Finance](https://finance.yahoo.com/)／地球儀: [globe.gl](https://github.com/vasturiano/globe.gl)・NASA Blue Marble
