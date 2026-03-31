"""
Chạy: python3 fetching.py
- Tự navigate đến sofascore ratings page
- Poll chờ bạn solve captcha trong Brave
- Sau khi có token → test API luôn
"""
from playwright.sync_api import sync_playwright
import json, hashlib, time

def get_xrw():
    return hashlib.sha256(str(int(time.time() / 1800)).encode()).hexdigest()[:6]

with sync_playwright() as p:
    try:
        browser = p.chromium.connect_over_cdp("http://localhost:9222")
    except Exception as e:
        print(f"[-] Brave chưa mở với CDP. Chạy lệnh này trước:")
        print('    open -a "Brave Browser" --args --remote-debugging-port=9222 --user-data-dir=/tmp/brave_profile')
        exit(1)

    ctx = browser.contexts[0]

    # Tìm hoặc tạo tab sofascore
    page = next((pg for pg in ctx.pages if "sofascore" in pg.url), None)
    if not page:
        page = ctx.new_page()

    # Intercept /token/captcha
    captcha_result = {"token": None}
    def on_response(resp):
        if "/token/captcha" in resp.url and resp.status == 200:
            try:
                captcha_result["token"] = resp.json().get("token", "")
                print(f"\n[+] /token/captcha received!")
            except: pass
    page.on("response", on_response)

    # Chỉ mở homepage nếu chưa có tab sofascore
    if not page.url or "sofascore" not in page.url:
        try:
            page.goto("https://www.sofascore.com/", wait_until="domcontentloaded", timeout=15000)
        except:
            pass

    print(f"[*] Tab: {page.url[:60]}")
    print("[*] Polling... (solve captcha trong Brave nếu thấy popup)\n")

    for i in range(60):
        storage = page.evaluate("() => ({...localStorage})")
        ct = storage.get("sofa.captcha.token") or captcha_result["token"]

        if ct:
            ce = storage.get("sofa.captcha.expire")
            remaining = (int(ce) / 1000 - time.time()) if ce else 0
            print(f"[+] sofa.captcha.token found! còn {remaining:.0f}s")
            print(f"    {ct[:60]}...")

            xrw = get_xrw()
            print(f"\n[*] Testing API với x-requested-with={xrw}")

            for url, label in [
                ("https://www.sofascore.com/api/v1/unique-tournament/7/season/77356/standings/total", "standings"),
                ("https://www.sofascore.com/api/v1/unique-tournament/34/season/77356/top-ratings/overall", "top-ratings"),
            ]:
                r = page.evaluate(f"""
                    async () => {{
                        const res = await fetch("{url}", {{
                            headers: {json.dumps({"x-requested-with": xrw, "x-captcha": ct, "accept": "*/*"})}
                        }});
                        const b = await res.json();
                        const items = b.standings || b.topPlayers || [];
                        return {{ status: res.status, count: items.length, first: items[0], error: b.error }};
                    }}
                """)
                ok = r["status"] == 200 and not r.get("error")
                print(f"  {'✅' if ok else '❌'} {label}: status={r['status']}, count={r['count']}")
                if ok and r.get("first") and label == "top-ratings":
                    f = r["first"]
                    print(f"     #1: {f.get('player',{}).get('name')} — rating {f.get('statistics',{}).get('rating')}")
            break

        # Status mỗi 5s
        if i % 5 == 0:
            bframe_w = page.evaluate("() => { const f = document.querySelector('iframe[src*=\"bframe\"]'); return f ? f.getBoundingClientRect().width : 0; }")
            status = "captcha challenge visible!" if bframe_w > 0 else "no challenge yet"
            print(f"  [{i*2}s] {status}")

        time.sleep(2)
    else:
        print("\n[-] Timeout 120s — không nhận được token.")

    browser.close()
