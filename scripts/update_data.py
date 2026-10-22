#!/usr/bin/env python3
"""ニュースと株価を集めて、サイトが読む JSON (site/data/news.json, stocks.json) を作るスクリプト。

GitHub Actions が1時間ごとに実行します。Python の標準ライブラリだけで動きます。

    python3 scripts/update_data.py --out site/data
    python3 scripts/update_data.py --out site/data --previous https://<ユーザー名>.github.io/<リポジトリ名>

--previous を付けると、取得に失敗した分を公開中のサイトにある前回のデータで補います。
"""
from __future__ import annotations

import argparse
import datetime as dt
import email.utils
import hashlib
import html
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from xml.etree import ElementTree as ET

HERE = Path(__file__).resolve().parent
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)


def http_get(url: str, timeout: float = 20, attempts: int = 3) -> bytes:
    """URL の中身を取得する。混雑(429)やサーバーエラー(5xx)のときは少し待って再試行する。"""
    error: Exception | None = None
    for attempt in range(attempts):
        request = urllib.request.Request(
            url, headers={"User-Agent": USER_AGENT, "Accept-Language": "ja,en;q=0.8"}
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            error = e
        except (urllib.error.URLError, TimeoutError) as e:
            error = e
        if attempt + 1 < attempts:
            time.sleep(2 * (attempt + 1) ** 2)
    assert error is not None
    raise error


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(moment: dt.datetime) -> str:
    return moment.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# 見出しから場所を探す


def normalize(text: str) -> str:
    """全角英数字を半角にするなど、表記ゆれをそろえる。"""
    return unicodedata.normalize("NFKC", text)


def _is_katakana(ch: str) -> bool:
    return "ァ" <= ch <= "ヺ" or ch == "ー"


def _is_latin(ch: str) -> bool:
    return ch.isascii() and ch.isalpha()


def _is_word_edge(text: str, start: int, end: int) -> bool:
    """カタカナ語・英単語の途中で切れていないか（「タイ」が「タイミング」に当たらないように）。"""
    before = text[start - 1] if start > 0 else ""
    after = text[end] if end < len(text) else ""
    first, last = text[start], text[end - 1]
    for same_kind in (_is_katakana, _is_latin):
        if same_kind(first) and before and same_kind(before):
            return False
        if same_kind(last) and after and same_kind(after):
            return False
    return True


class Gazetteer:
    """地名リスト (places.json) を使って、文章の中から場所を見つける。"""

    def __init__(self, places: list[dict]):
        self.names: dict[str, list[tuple[str, dict]]] = {}
        self.patterns: list[tuple[re.Pattern[str], dict]] = []
        for place in places:
            for name in place.get("names", []):
                name = normalize(name)
                self.names.setdefault(name[0], []).append((name, place))
            for pattern in place.get("patterns", []):
                self.patterns.append((re.compile(pattern), place))
        for candidates in self.names.values():
            candidates.sort(key=lambda c: -len(c[0]))

    @classmethod
    def load(cls, path: Path = HERE / "places.json") -> "Gazetteer":
        with open(path, encoding="utf-8") as f:
            return cls(json.load(f)["places"])

    def find_all(self, text: str) -> list[tuple[int, dict]]:
        """文中の地名を左から順に探す。同じ位置では一番長い名前を優先する。"""
        text = normalize(text)
        found: list[tuple[int, dict]] = []
        i = 0
        while i < len(text):
            match: tuple[str, dict] | None = None
            for name, place in self.names.get(text[i], ()):
                if text.startswith(name, i) and _is_word_edge(text, i, i + len(name)):
                    match = (name, place)
                    break
            for pattern, place in self.patterns:
                m = pattern.match(text, i)
                if m and (match is None or len(m.group()) > len(match[0])):
                    if _is_word_edge(text, i, m.end()):
                        match = (m.group(), place)
            if match is None:
                i += 1
                continue
            end = i + len(match[0])
            # 「中国語」「ロシア語」のような言葉の名前は場所ではない
            if not match[1].get("ignore") and text[end:end + 1] != "語":
                found.append((i, match[1]))
            i = end
        return found

    def locate(self, *texts: str) -> dict | None:
        """一番具体的な場所（rank が大きいもの、同じなら先に出てきたもの）を返す。"""
        for text in texts:
            found = self.find_all(text or "")
            if found:
                return max(found, key=lambda f: (f[1]["rank"], -f[0]))[1]
        return None


def is_domestic(place: dict) -> bool:
    return place["id"] == "jp" or place.get("country") == "日本" or place.get("domestic", False)


def place_to_loc(place: dict) -> dict:
    loc = {"name": place["label"], "lat": place["lat"], "lng": place["lng"]}
    if place.get("country"):
        loc["country"] = place["country"]
    return loc


# 国内ニュースで場所が見つからないときは、日本（東京）に置いて「推定」と表示する
JAPAN_GUESS = {"name": "日本", "country": "日本", "lat": 35.6812, "lng": 139.7671, "approx": True}


# ---------------------------------------------------------------------------
# ニュース

GOOGLE_NEWS = "https://news.google.com/rss{}?hl=ja&gl=JP&ceid=JP:ja"
# (種類, URL, 最大件数)。top はグーグルニュースの「トップニュース」で、並び順がそのまま注目度。
NEWS_FEEDS = [
    ("top", GOOGLE_NEWS.format(""), 30),
    ("world", GOOGLE_NEWS.format("/headlines/section/topic/WORLD"), 15),
    ("business", GOOGLE_NEWS.format("/headlines/section/topic/BUSINESS"), 8),
    ("nation", GOOGLE_NEWS.format("/headlines/section/topic/NATION"), 8),
]
# グーグルニュースが取れなかったときの予備
NHK_FEEDS = [
    ("top", "https://www3.nhk.or.jp/rss/news/cat0.xml", 30),
    ("world", "https://www3.nhk.or.jp/rss/news/cat6.xml", 15),
    ("business", "https://www3.nhk.or.jp/rss/news/cat5.xml", 8),
]
MAX_NEWS = 60


def _strip_tags(markup: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", markup))).strip()


def parse_rss(xml: bytes, default_source: str = "") -> list[dict]:
    """RSS の <item> を {title, url, source, published, summary, related} のリストにする。"""
    items = []
    for item in ET.fromstring(xml).iter("item"):
        title = _strip_tags(item.findtext("title") or "")
        url = (item.findtext("link") or "").strip()
        if not title or not url.startswith("http"):
            continue
        source = (item.findtext("source") or "").strip() or default_source
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3].strip()
        description = item.findtext("description") or ""
        published = None
        if item.findtext("pubDate"):
            try:
                published = iso(email.utils.parsedate_to_datetime(item.findtext("pubDate")))
            except (TypeError, ValueError):
                pass
        items.append(
            {
                "title": title,
                "url": url,
                "source": source,
                "published": published,
                # 本文の要約（NHK など）だけを場所探しに使う。グーグルニュースの説明文は
                # 関連記事の見出しと媒体名の一覧で、別の地名が混ざりやすいので使わない
                "summary": "" if "<a " in description else _strip_tags(description),
                # グーグルニュースは同じ話題の記事を <li> でまとめて載せる。多いほど注目度が高い。
                "related": max(1, description.count("<li")),
            }
        )
    return items


def _title_key(title: str) -> str:
    return re.sub(r"[\s「」『』【】（）()、。,.!?！？・:：\-－]", "", normalize(title))


def build_news(feeds: dict[str, list[dict]], gazetteer: Gazetteer, caps: dict[str, int]) -> list[dict]:
    """複数のフィードを1つのリストにまとめ、重複を除き、カテゴリと場所を付ける。"""
    membership: dict[str, set[str]] = {}
    for kind, items in feeds.items():
        for item in items:
            membership.setdefault(_title_key(item["title"]), set()).add(kind)

    chosen: list[tuple[str, int, dict]] = []
    seen: set[str] = set()
    for kind in ("top", "world", "business", "nation"):
        taken = 0
        for position, item in enumerate(feeds.get(kind, [])):
            key = _title_key(item["title"])
            if key in seen or item["url"] in seen:
                continue
            if taken >= caps.get(kind, 0):
                break
            seen.update((key, item["url"]))
            chosen.append((kind, position, item))
            taken += 1

    news = []
    for kind, position, item in chosen[:MAX_NEWS]:
        kinds = membership.get(_title_key(item["title"]), {kind})
        place = gazetteer.locate(item["title"], item["summary"])
        if "world" in kinds:
            category = "国際"
        elif "business" in kinds:
            category = "経済"
        elif place is not None and not is_domestic(place):
            category = "国際"
        else:
            category = "国内"
        if place is not None:
            loc = place_to_loc(place)
        elif category != "国際":
            loc = dict(JAPAN_GUESS)
        else:
            loc = None
        news.append(
            {
                "id": hashlib.sha1(item["url"].encode()).hexdigest()[:12],
                "title": item["title"],
                "url": item["url"],
                "source": item["source"],
                "published": item["published"],
                "category": category,
                "rank": position + 1 if kind == "top" else None,
                "related": item["related"],
                "loc": loc,
            }
        )
    return news


def fetch_news(gazetteer: Gazetteer, log: list[str]) -> list[dict]:
    for label, feed_list, default_source in (("Googleニュース", NEWS_FEEDS, ""), ("NHK", NHK_FEEDS, "NHK")):
        feeds: dict[str, list[dict]] = {}
        for kind, url, _ in feed_list:
            try:
                feeds[kind] = parse_rss(http_get(url), default_source)
                log.append(f"ニュース {label} {kind}: {len(feeds[kind])}件")
            except Exception as e:  # 1つのフィードが失敗しても残りは使う
                log.append(f"ニュース {label} {kind}: 失敗 ({e})")
        caps = {kind: cap for kind, _, cap in feed_list}
        news = build_news(feeds, gazetteer, caps)
        if len(news) >= 5:
            return news
    return []


# ---------------------------------------------------------------------------
# 株価（Yahoo Finance の公開チャートデータ）

CHART_URL = "https://{host}.finance.yahoo.com/v8/finance/chart/{symbol}?range=6mo&interval=1d"
TRENDING_URL = "https://query1.finance.yahoo.com/v1/finance/trending/US?count=20"

INDICES = [
    ("^N225", "日経平均株価", "円"),
    ("^DJI", "NYダウ", "ドル"),
    ("^GSPC", "S&P 500", ""),
    ("^IXIC", "ナスダック総合", ""),
    ("JPY=X", "ドル/円", "円"),
]
JP_STOCKS = {
    "7203.T": "トヨタ自動車",
    "6758.T": "ソニーグループ",
    "7974.T": "任天堂",
    "9984.T": "ソフトバンクグループ",
    "8035.T": "東京エレクトロン",
    "6857.T": "アドバンテスト",
    "8306.T": "三菱UFJ",
    "7011.T": "三菱重工業",
    "9983.T": "ファーストリテイリング",
    "6861.T": "キーエンス",
    "6501.T": "日立製作所",
    "4063.T": "信越化学工業",
    "8058.T": "三菱商事",
    "8316.T": "三井住友FG",
    "9432.T": "NTT",
    "6146.T": "ディスコ",
    "5803.T": "フジクラ",
    "7012.T": "川崎重工業",
    "4502.T": "武田薬品工業",
    "7267.T": "ホンダ",
    "6098.T": "リクルート",
    "4661.T": "オリエンタルランド",
    "8136.T": "サンリオ",
    "6920.T": "レーザーテック",
    "9434.T": "ソフトバンク",
}
US_STOCKS = {
    "NVDA": "エヌビディア",
    "AAPL": "アップル",
    "MSFT": "マイクロソフト",
    "AMZN": "アマゾン",
    "GOOGL": "アルファベット",
    "META": "メタ",
    "TSLA": "テスラ",
    "AVGO": "ブロードコム",
    "AMD": "AMD",
    "NFLX": "ネットフリックス",
    "PLTR": "パランティア",
    "TSM": "TSMC",
    "ORCL": "オラクル",
    "MU": "マイクロン",
    "INTC": "インテル",
}
MAX_TRENDING = 8
# 同じ会社の別の株（議決権の違いなど）は、ウォッチリストの銘柄にまとめる
SAME_COMPANY = {"GOOG": "GOOGL"}


def _round(value: float, decimals: int) -> float:
    rounded = round(value, decimals)
    return int(rounded) if decimals == 0 else rounded


def short_company_name(name: str) -> str:
    """「Chipotle Mexican Grill, Inc.」→「Chipotle Mexican Grill」のように会社の種類を省く"""
    for _ in range(2):
        name = re.sub(r",?\s+(Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Ltd\.?|plc|PLC|N\.V\.|S\.A\.|AG|SE|Holdings?|Group)$", "", name.strip())
    return name


def parse_chart(payload: dict, name: str, unit: str, decimals: int | None) -> dict | None:
    """Yahoo のチャートデータから、現在値・前日比・日足の推移を取り出す。

    decimals が None のときは、株価に小数があるかどうかで小数点以下の桁数（0 か 1）を決める。
    """
    results = (payload.get("chart") or {}).get("result") or []
    if not results:
        return None
    result = results[0]
    meta = result.get("meta") or {}
    quote = ((result.get("indicators") or {}).get("quote") or [{}])[0]
    tz = dt.timezone(dt.timedelta(seconds=meta.get("gmtoffset") or 0))

    daily: dict[str, float] = {}
    for stamp, close in zip(result.get("timestamp") or [], quote.get("close") or []):
        if close is not None:
            daily[dt.datetime.fromtimestamp(stamp, tz).date().isoformat()] = close
    history = sorted(daily.items())

    price = meta.get("regularMarketPrice")
    if price is None:
        if not history:
            return None
        price = history[-1][1]
    market_time = meta.get("regularMarketTime")
    if market_time:
        market_day = dt.datetime.fromtimestamp(market_time, tz).date().isoformat()
    elif history:
        market_day = history[-1][0]
    else:
        return None
    # 日足の最後が「今日」なら1つ前が前日終値。最後が前日までなら、今日の値を付け足す。
    if history and history[-1][0] >= market_day:
        history[-1] = (history[-1][0], price)
        previous = history[-2][1] if len(history) >= 2 else meta.get("chartPreviousClose")
    else:
        previous = history[-1][1] if history else meta.get("chartPreviousClose")
        history.append((market_day, price))
    if not previous:
        return None

    if decimals is None:
        recent = [close for _, close in history[-30:]] + [previous]
        decimals = 0 if all(float(v).is_integer() for v in recent) else 1
    change = price - previous
    return {
        "symbol": meta.get("symbol"),
        "name": name or short_company_name(meta.get("shortName") or "") or meta.get("symbol"),
        "type": meta.get("instrumentType"),
        "unit": unit,
        "decimals": decimals,
        "price": _round(price, decimals),
        "prev": _round(previous, decimals),
        "change": _round(change, decimals),
        "changePct": round(change / previous * 100, 2),
        "time": iso(dt.datetime.fromtimestamp(market_time, dt.timezone.utc)) if market_time else None,
        "history": [[day, _round(close, decimals)] for day, close in history],
    }


def fetch_quote(symbol: str, name: str, unit: str, decimals: int | None) -> dict:
    quoted = urllib.parse.quote(symbol, safe="")
    error: Exception | None = None
    for host in ("query1", "query2"):
        try:
            payload = json.loads(http_get(CHART_URL.format(host=host, symbol=quoted), attempts=2))
            quote = parse_chart(payload, name, unit, decimals)
            if quote:
                return quote
            error = ValueError("データが空でした")
        except Exception as e:
            error = e
    assert error is not None
    raise error


def fetch_trending(log: list[str]) -> list[str]:
    try:
        payload = json.loads(http_get(TRENDING_URL))
        quotes = payload["finance"]["result"][0]["quotes"]
        symbols = [q["symbol"] for q in quotes if re.fullmatch(r"[A-Z][A-Z.]{0,5}", q.get("symbol", ""))]
        symbols = list(dict.fromkeys(SAME_COMPANY.get(s, s) for s in symbols))
        log.append(f"米国の話題銘柄: {', '.join(symbols) or 'なし'}")
        return symbols
    except Exception as e:
        log.append(f"米国の話題銘柄: 取得失敗 ({e})")
        return []


def fetch_stocks(previous: dict | None, log: list[str]) -> dict:
    old = {}
    for group in ("indices", "jp", "us"):
        for quote in (previous or {}).get(group, []):
            old[quote["symbol"]] = quote

    failures_in_a_row = 0

    def get(symbol: str, name: str, unit: str, decimals: int | None) -> dict | None:
        nonlocal failures_in_a_row
        if failures_in_a_row < 4:  # 何度も続けて失敗したら、相手が混雑しているので取得をやめる
            time.sleep(0.4)  # 相手のサーバーに負担をかけないよう、少し間をあける
            try:
                quote = fetch_quote(symbol, name, unit, decimals)
                failures_in_a_row = 0
                return quote
            except Exception as e:
                failures_in_a_row += 1
                log.append(f"株価 {symbol}: 失敗 ({e})")
        if symbol in old:
            return {**old[symbol], "stale": True}
        return None

    indices = [q for s, n, u in INDICES if (q := get(s, n, u, 2))]
    # 日本株は整数の株価が多いので、小数点以下の桁数は自動で決める
    jp = [q for s, n in JP_STOCKS.items() if (q := get(s, n, "円", None))]

    trending = fetch_trending(log) if failures_in_a_row < 4 else []
    us = []
    for symbol in dict.fromkeys(list(US_STOCKS) + [s for s in trending if s not in US_STOCKS][:MAX_TRENDING]):
        quote = get(symbol, US_STOCKS.get(symbol, ""), "ドル", 2)
        if quote and (symbol in US_STOCKS or quote.get("type") == "EQUITY"):
            quote["trending"] = symbol in trending
            us.append(quote)

    # 「注目」の並び: 米国の話題銘柄を先に、あとは値動き（前日比％）が大きい順
    def attention(quote: dict) -> tuple:
        return (not quote.get("trending", False), -abs(quote["changePct"]))

    jp.sort(key=attention)
    us.sort(key=attention)
    for quote in indices + jp + us:
        quote.pop("type", None)
    log.append(f"株価: 指数 {len(indices)} / 日本株 {len(jp)} / 米国株 {len(us)}")
    return {"indices": indices, "jp": jp, "us": us}


# ---------------------------------------------------------------------------


def load_previous(base_url: str | None, name: str, log: list[str]) -> dict | None:
    if not base_url:
        return None
    try:
        return json.loads(http_get(f"{base_url.rstrip('/')}/data/{name}", attempts=1))
    except Exception as e:
        log.append(f"前回の {name}: 読めませんでした ({e})")
        return None


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def write_summary(news: list[dict], stocks: dict, log: list[str]) -> None:
    """GitHub Actions の実行結果ページに、取れたデータのまとめを表示する。"""
    lines = ["## 取得結果", ""]
    located = sum(1 for n in news if n["loc"] and not n["loc"].get("approx"))
    lines.append(f"- ニュース {len(news)}件（見出しから場所が分かったもの {located}件）")
    lines.append(
        f"- 株価 指数 {len(stocks['indices'])} / 日本株 {len(stocks['jp'])} / 米国株 {len(stocks['us'])}"
    )
    lines += ["", "| # | 見出し | 場所 | 分類 |", "|---|---|---|---|"]
    for i, n in enumerate(news, 1):
        loc = n["loc"]
        where = "—" if not loc else loc["name"] + ("（推定）" if loc.get("approx") else "")
        lines.append(f"| {i} | {n['title'].replace('|', '/')} | {where} | {n['category']} |")
    lines += ["", "| 銘柄 | 現在値 | 前日比 | 日付 |", "|---|---|---|---|"]
    for quote in stocks["indices"] + stocks["jp"][:5] + stocks["us"][:5]:
        mark = "（前回のデータ）" if quote.get("stale") else ""
        lines.append(
            f"| {quote['name']} ({quote['symbol']}){mark} | {quote['price']} | "
            f"{quote['change']:+} ({quote['changePct']:+.2f}%) | {quote['history'][-1][0]} |"
        )
    lines += ["", "<details><summary>ログ</summary>", "", *[f"- {line}" for line in log], "", "</details>"]
    text = "\n".join(lines) + "\n"
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as f:
            f.write(text)
    print(text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="site/data", help="JSON を書き出すフォルダ")
    parser.add_argument("--previous", default="", help="公開中のサイトの URL（失敗時の補完用）")
    args = parser.parse_args()
    out = Path(args.out)
    log: list[str] = []
    now = iso(utc_now())

    previous_news = load_previous(args.previous, "news.json", log)
    previous_stocks = load_previous(args.previous, "stocks.json", log)

    news = fetch_news(Gazetteer.load(), log)
    news_updated = now
    if not news and previous_news:
        log.append("ニュースが取れなかったので前回のデータを使います")
        news, news_updated = previous_news.get("items", []), previous_news.get("updated", now)

    stocks = fetch_stocks(previous_stocks, log)

    write_json(out / "news.json", {"updated": news_updated, "items": news})
    write_json(out / "stocks.json", {"updated": now, **stocks})
    write_summary(news, stocks, log)

    if not news and not any(stocks.values()):
        print("ニュースも株価も取得できませんでした", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
