"""
Test curl_cffi với Sofascore API
curl_cffi dùng TLS fingerprint của browser thật (chrome120) → bypass JA3/JA4 check
"""
import hashlib, time
from curl_cffi import requests

def get_xrw():
    return hashlib.sha256(str(int(time.time() / 1800)).encode()).hexdigest()[:6]

xrw = get_xrw()
print(f"[*] x-requested-with: {xrw}")

headers = {
    "x-requested-with": xrw,
    "accept": "*/*",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "referer": "https://www.sofascore.com/",
    "origin": "https://www.sofascore.com",
}

URLS = [
    ("https://www.sofascore.com/api/v1/unique-tournament/7/season/77356/standings/total", "standings"),
    ("https://www.sofascore.com/api/v1/unique-tournament/34/season/77356/top-ratings/overall", "top-ratings"),
    ("https://www.sofascore.com/api/v1/sport/football/events/live", "live-events"),
]

for url, label in URLS:
    r = requests.get(url, headers=headers, impersonate="chrome120")
    if r.status_code == 200:
        data = r.json()
        items = data.get("standings") or data.get("topPlayers") or data.get("events") or []
        print(f"  ✅ {label}: status=200, count={len(items)}")
        if items:
            first = items[0]
            if label == "top-ratings":
                print(f"     #1: {first.get('player',{}).get('name')} — rating {first.get('statistics',{}).get('rating')}")
            elif label == "standings":
                team = first.get("team", {})
                print(f"     #1: {team.get('name')} — pts {first.get('points')}")
            elif label == "live-events":
                e = first
                print(f"     first: {e.get('homeTeam',{}).get('name')} vs {e.get('awayTeam',{}).get('name')}")
    else:
        print(f"  ❌ {label}: status={r.status_code}")
        print(f"     {r.text[:200]}")
