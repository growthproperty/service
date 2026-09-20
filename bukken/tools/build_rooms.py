# イタンジBBから取得した生データ → 公開用 data/rooms.json に変換する
# 賃料：元賃料×1.2 を1,000円単位に切り上げ ＋ 見守りサービス 5,000円
# 礼金：元の月数 ＋ 1ヶ月
# ※元賃料は公開データに残さない（社内用は internal/ に別途出力）

import json, math, re, sys, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RATE = 1.2
WATCH_FEE = 5000

def yen(text):
    """'15.5万円' -> 155000"""
    m = re.match(r"([\d.]+)万円", text or "")
    return int(round(float(m.group(1)) * 10000)) if m else None

def fee(text):
    """'20,000円' -> 20000 / None"""
    if not text:
        return 0
    m = re.match(r"([\d,]+)円", text)
    return int(m.group(1).replace(",", "")) if m else 0

def months(text):
    """'1ヶ月' -> 1.0 / 'なし' -> 0"""
    m = re.match(r"([\d.]+)ヶ月", text or "")
    return float(m.group(1)) if m else 0.0

def months_text(v):
    if v == 0:
        return "なし"
    return f"{v:g}ヶ月"

def city_of(address):
    m = re.search(r"(?:東京都|北海道|(?:京都|大阪)府|.{2,3}県)(.+?市.+?区|.+?[市区町村])", address or "")
    return m.group(1) if m else ""

def walk_of(stations):
    mins = [int(m.group(1)) for s in stations if (m := re.search(r"徒歩(\d+)分", s))]
    return min(mins) if mins else None

def built_of(text):
    m = re.match(r"(\d{4})年(\d{1,2})月", text or "")
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)

def main(src):
    raw = json.loads(Path(src).read_text(encoding="utf-8"))
    buildings = {b[0]: b for b in raw["buildings"]}
    today = datetime.date.today()

    public, internal = [], []
    skipped = []
    for r in raw["rooms"]:
        bid, no, rent_t, kanri_t, shiki_t, rei_t, layout, area_t, move_in = r[:9]
        adv = r[9] if len(r) > 9 else "可"
        deal = r[10] if len(r) > 10 else ""
        if adv != "可":                       # 広告掲載不可はサイトに載せない
            skipped.append((bid, no, "広告不可"))
            continue
        b = buildings.get(bid)
        base = yen(rent_t)
        if not b or base is None:
            skipped.append((bid, no, "データ不足"))
            continue

        rent = math.ceil(base * RATE / 1000) * 1000 + WATCH_FEE
        y, mo = built_of(b[4])
        area = float(re.sub(r"[^\d.]", "", area_t or "0") or 0)
        rid = f"GP-{bid}-{no}"
        public.append({
            "id": rid,
            "building": b[1],
            "room": no,
            "address": b[2],
            "city": city_of(b[2]),
            "stations": b[3],
            "walk": walk_of(b[3]),
            "layout": layout,
            "area": area,
            "built": f"{y}年{mo}月" if y else "",
            "age": (today.year - y) if y else None,
            "story": b[5],
            "rent": rent,
            "admin_fee": fee(kanri_t),
            "deposit": shiki_t or "なし",
            "key_money": months_text(months(rei_t) + 1),
            "move_in": move_in,
            "watch_service": True,
            "status": "募集中",
        })
        internal.append({
            "id": rid, "building": b[1], "room": no,
            "base_rent": base, "site_rent": rent,
            "base_key_money": rei_t, "site_key_money": months_text(months(rei_t) + 1),
            "deal_type": deal, "ad": adv,
        })

    public.sort(key=lambda x: (x["city"], x["building"], x["room"]))
    out = {
        "updated": today.isoformat(),
        "next_update": (today + datetime.timedelta(days=14)).isoformat(),
        "source": "ITANDI BB（レジディア／伊藤忠アーバンコミュニティ／賃料15万円以上／申込ありを除く）",
        "rooms": public,
    }
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "rooms.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (ROOT / "internal").mkdir(exist_ok=True)
    (ROOT / "internal" / f"price_table_{today.isoformat()}.json").write_text(
        json.dumps(internal, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"公開: {len(public)}件 / 除外: {len(skipped)}件")
    print(f"更新日: {out['updated']} 次回: {out['next_update']}")

if __name__ == "__main__":
    main(sys.argv[1])
