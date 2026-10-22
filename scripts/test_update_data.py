"""update_data.py のテスト。  python3 -m unittest discover -s scripts -v  で実行できます。"""
import json
import unittest

import update_data as ud

GAZETTEER = ud.Gazetteer.load()


def where(title: str) -> str | None:
    place = GAZETTEER.locate(title)
    return place["id"] if place else None


class LocateTest(unittest.TestCase):
    def test_headlines(self):
        cases = {
            "イスラエル軍、ガザ北部を空爆 少なくとも20人死亡": "gaza",
            "ウクライナ東部ハルキウにミサイル攻撃": "kharkiv",
            "米大統領、中国訪問へ調整": "us",
            "米中間選挙まで2週間 激戦州で接戦": "us",
            "NYダウ 一時500ドル安": "newyork",
            "東京都内で震度3の地震": "tokyo",
            "京都の観光地 外国人客でにぎわう": "kyoto",
            "インドネシアで地震 津波の心配なし": "id",
            "インド太平洋の安全保障で連携": None,
            "ワシントン州で大規模な山火事": "washingtonstate",
            "南米ペルーでM7の地震": "pe",
            "韓国国会で予算案可決": "kr",
            "台風10号 沖縄に接近": "okinawa",
            "能登半島地震から1年": "noto",
            "パリでテロ警戒強化": "paris",
            "対ロ制裁 EUが新たな措置": "ru",
            "日米首脳会談 関税で合意": "us",
            "日中首脳会談 来月にも": "cn",
            "米ロ首脳が電話会談": "us",
            "露大統領が声明": "ru",
            "英首相が辞任表明": "gb",
            "大谷翔平 2試合連続ホームラン": "dodgers",
            "ドジャース 地区優勝": "dodgers",
            "トランプ大統領 日本に到着": "us-hint",
            "トランプ大統領 ソウルで演説": "seoul",
            "国会 補正予算が成立": "jp-gov",
            "日経平均 3日ぶりに反落": "jp-gov",
            "東京電力福島第一原発の処理水": "fukushima1",
            "中国地方で大雨 土砂災害に警戒": "chugoku",
            "中国 北京で大規模イベント": "beijing",
            "国連安保理 緊急会合を開催": "un",
            "NATO首脳会議 オランダで開幕": "nl",
            "メキシコ湾でハリケーン": "mx",
            "ニューヨーク株式市場 最高値を更新": "newyork",
            "サウジアラビアとイランが会談": "sa",
            "南アフリカでG20": "za",
            "ホルムズ海峡で船舶が攻撃される": "hormuz",
            "全米オープン 日本選手が優勝": "us",
            "北朝鮮が弾道ミサイル発射": "kp",
            "米アップル 新型iPhoneを発表": "us",
            "米FRB 利下げを決定": "us",
            "台風30号 東シナ海を北上": "ecs",
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                self.assertEqual(where(title), expected)

    def test_words_that_look_like_places(self):
        # 「タイ」「米」「豪」「中国」などが別の意味で使われる見出し
        cases = [
            "備蓄米の放出 価格に影響",
            "備蓄米大量放出へ",
            "新米首相のもとで論戦",
            "豪雨被害 各地で続く",
            "タイミングを逃さない投資術",
            "阪神タイガースが優勝",
            "ゼロ金利解除から1年",
            "テロ対策を強化",
            "米価が高止まり",
            "披露宴の費用が上昇",
            "調印式が行われた",
            "独自の取り組み",
            "日中は気温が上がる見込み",
            "英語教育の見直し",
        ]
        for title in cases:
            with self.subTest(title=title):
                self.assertIsNone(where(title))

    def test_full_width_letters(self):
        self.assertEqual(where("ＮＡＴＯ首脳会議"), "nato")


GOOGLE_RSS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<title>トップニュース - Google ニュース</title>
<item>
<title>イスラエル軍、ガザ北部を空爆 - 日本経済新聞</title>
<link>https://news.google.com/rss/articles/AAA?oc=5</link>
<guid isPermaLink="false">AAA</guid>
<pubDate>Wed, 21 Oct 2026 22:41:00 GMT</pubDate>
<description>&lt;ol&gt;&lt;li&gt;&lt;a href="https://news.google.com/rss/articles/AAA?oc=5"&gt;イスラエル軍、ガザ北部を空爆&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;日本経済新聞&lt;/font&gt;&lt;/li&gt;&lt;li&gt;&lt;a href="https://news.google.com/rss/articles/AAB?oc=5"&gt;ガザで空爆&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;NHK&lt;/font&gt;&lt;/li&gt;&lt;/ol&gt;</description>
<source url="https://www.nikkei.com">日本経済新聞</source>
</item>
<item>
<title>日経平均、3日ぶり反落 - 読売新聞オンライン</title>
<link>https://news.google.com/rss/articles/BBB?oc=5</link>
<pubDate>Wed, 21 Oct 2026 06:10:00 GMT</pubDate>
<description>&lt;a href="https://news.google.com/rss/articles/BBB?oc=5"&gt;日経平均、3日ぶり反落&lt;/a&gt;</description>
<source url="https://www.yomiuri.co.jp">読売新聞オンライン</source>
</item>
<item>
<title>首相が記者会見 経済対策を表明 - 中国新聞</title>
<link>https://news.google.com/rss/articles/CCC?oc=5</link>
<pubDate>Wed, 21 Oct 2026 05:00:00 GMT</pubDate>
<description>&lt;a href="https://news.google.com/rss/articles/CCC?oc=5"&gt;首相が記者会見 経済対策を表明&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;中国新聞&lt;/font&gt;</description>
<source url="https://www.chugoku-np.co.jp">中国新聞</source>
</item>
</channel></rss>
""".encode()

WORLD_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
<title>イスラエル軍、ガザ北部を空爆 - 共同通信</title>
<link>https://news.google.com/rss/articles/DDD?oc=5</link>
<pubDate>Wed, 21 Oct 2026 22:00:00 GMT</pubDate>
<source url="https://www.kyodo.co.jp">共同通信</source>
</item>
<item>
<title>欧州で記録的な熱波 - BBC</title>
<link>https://news.google.com/rss/articles/EEE?oc=5</link>
<pubDate>Wed, 21 Oct 2026 20:00:00 GMT</pubDate>
<source url="https://www.bbc.com">BBC</source>
</item>
<item>
<title>国際会議が閉幕 - ロイター</title>
<link>https://news.google.com/rss/articles/FFF?oc=5</link>
<pubDate>Wed, 21 Oct 2026 19:00:00 GMT</pubDate>
<source url="https://jp.reuters.com">ロイター</source>
</item>
</channel></rss>
""".encode()


class NewsTest(unittest.TestCase):
    def test_parse_rss(self):
        items = ud.parse_rss(GOOGLE_RSS)
        self.assertEqual(len(items), 3)
        first = items[0]
        self.assertEqual(first["title"], "イスラエル軍、ガザ北部を空爆")
        self.assertEqual(first["source"], "日本経済新聞")
        self.assertEqual(first["published"], "2026-10-21T22:41:00Z")
        self.assertEqual(first["related"], 2)
        self.assertEqual(items[1]["related"], 1)

    def test_build_news(self):
        feeds = {"top": ud.parse_rss(GOOGLE_RSS), "world": ud.parse_rss(WORLD_RSS)}
        news = ud.build_news(feeds, GAZETTEER, {"top": 30, "world": 15})
        titles = [n["title"] for n in news]
        # 同じ見出しは1件にまとめ、トップニュースの順番を先にする
        self.assertEqual(titles, [
            "イスラエル軍、ガザ北部を空爆",
            "日経平均、3日ぶり反落",
            "首相が記者会見 経済対策を表明",
            "欧州で記録的な熱波",
            "国際会議が閉幕",
        ])
        gaza, nikkei, pm, europe, meeting = news
        self.assertEqual((gaza["category"], gaza["rank"], gaza["loc"]["name"]), ("国際", 1, "ガザ地区"))
        self.assertEqual((nikkei["category"], nikkei["loc"]["name"]), ("国内", "東京"))
        # 場所の手がかりがない国内ニュースは「日本（推定）」。媒体名の「中国新聞」を中国と間違えない
        self.assertTrue(pm["loc"]["approx"])
        self.assertEqual(pm["source"], "中国新聞")
        self.assertEqual((europe["rank"], europe["loc"]["name"]), (None, "ブリュッセル"))
        self.assertIsNone(meeting["loc"])  # 場所が分からない国際ニュースは地球儀に載せない

    def test_seas_near_japan_stay_domestic(self):
        rss = GOOGLE_RSS.replace("日経平均、3日ぶり反落".encode(), "台風30号 東シナ海を北上".encode())
        news = ud.build_news({"top": ud.parse_rss(rss)}, GAZETTEER, {"top": 30})
        typhoon = next(n for n in news if n["title"].startswith("台風"))
        self.assertEqual((typhoon["category"], typhoon["loc"]["name"]), ("国内", "東シナ海"))


def chart_payload(timestamps, closes, price, market_time, symbol="7203.T", offset=32400):
    return {
        "chart": {
            "result": [
                {
                    "meta": {
                        "symbol": symbol,
                        "regularMarketPrice": price,
                        "regularMarketTime": market_time,
                        "gmtoffset": offset,
                        "chartPreviousClose": 2500,
                        "instrumentType": "EQUITY",
                    },
                    "timestamp": timestamps,
                    "indicators": {"quote": [{"close": closes}]},
                }
            ],
            "error": None,
        }
    }


# 2026-10-19(月), 10-20(火), 10-21(水) の 9:00 JST
DAYS = [1792368000, 1792454400, 1792540800]


class ChartTest(unittest.TestCase):
    def test_last_bar_is_today(self):
        payload = chart_payload(DAYS, [2800.0, 2850.0, 2870.0], 2900.0, DAYS[2] + 6 * 3600)
        quote = ud.parse_chart(payload, "トヨタ自動車", "円", None)
        self.assertEqual(quote["price"], 2900)
        self.assertEqual(quote["prev"], 2850)
        self.assertEqual(quote["change"], 50)
        self.assertEqual(quote["changePct"], 1.75)
        self.assertEqual(quote["decimals"], 0)
        self.assertEqual(quote["history"][-1], ["2026-10-21", 2900])

    def test_today_missing_from_daily_bars(self):
        payload = chart_payload(DAYS[:2], [2800.0, 2850.5], 2830.0, DAYS[2] + 3600)
        quote = ud.parse_chart(payload, "トヨタ自動車", "円", None)
        self.assertEqual(quote["prev"], 2850.5)
        self.assertEqual(quote["decimals"], 1)
        self.assertEqual(quote["history"][-1], ["2026-10-21", 2830.0])
        self.assertEqual(len(quote["history"]), 3)

    def test_skips_missing_closes(self):
        payload = chart_payload(DAYS, [2800.0, None, 2870.0], 2870.0, DAYS[2] + 3600)
        quote = ud.parse_chart(payload, "", "円", 2)
        self.assertEqual(quote["prev"], 2800.0)
        self.assertEqual(quote["name"], "7203.T")

    def test_empty(self):
        self.assertIsNone(ud.parse_chart({"chart": {"result": None, "error": {}}}, "", "", 2))


class StocksTest(unittest.TestCase):
    def test_fallback_to_previous_when_requests_fail(self):
        original_get, original_sleep = ud.http_get, ud.time.sleep
        calls = []

        def broken(url, **kwargs):
            calls.append(url)
            raise OSError("network down")

        ud.http_get = broken
        ud.time.sleep = lambda seconds: None
        try:
            previous = {"indices": [{"symbol": "^N225", "name": "日経平均株価", "price": 1, "changePct": 0.5}]}
            log = []
            stocks = ud.fetch_stocks(previous, log)
        finally:
            ud.http_get, ud.time.sleep = original_get, original_sleep
        self.assertEqual([q["symbol"] for q in stocks["indices"]], ["^N225"])
        self.assertTrue(stocks["indices"][0]["stale"])
        # 4回続けて失敗したら、それ以上は問い合わせない
        self.assertLessEqual(len(calls), 8)
        json.dumps(stocks)


if __name__ == "__main__":
    unittest.main()
