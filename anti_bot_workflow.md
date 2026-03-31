# Anti-Bot Infrastructure Workflow

## Overview — Defense in Depth

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  LAYER 1: EDGE (CDN/WAF)                            │
│  Cloudflare / Fastly / AWS CloudFront               │
│                                                     │
│  • TLS Fingerprint (JA3/JA4)                        │
│    - curl/python-requests → block                   │
│    - curl_cffi chrome → pass (hard to stop)         │
│                                                     │
│  • IP Reputation                                    │
│    - ASN check: datacenter IP → challenge           │
│    - Known VPN/proxy/Tor exit → challenge           │
│    - Residential IP → pass                          │
│                                                     │
│  • HTTP/2 Fingerprint (ALPN, frame order)           │
│  • Rate limiting: IP / IP+path / IP+UA              │
└───────────────────────┬─────────────────────────────┘
                        │ pass
                        ▼
┌─────────────────────────────────────────────────────┐
│  LAYER 2: CHALLENGE (Bot Score)                     │
│  Cloudflare Turnstile / DataDome / PerimeterX       │
│                                                     │
│  Thu thập passive signals (không cần user action):  │
│  • Canvas fingerprint                               │
│  • WebGL renderer + vendor                          │
│  • AudioContext fingerprint                         │
│  • Font enumeration                                 │
│  • Screen resolution, timezone, language            │
│  • navigator.webdriver === true → bot               │
│  • Chrome DevTools Protocol presence                │
│  • Headless browser tells (missing plugins, etc.)   │
│                                                     │
│  → Risk Score 0-100                                 │
│    score < 30  → pass silently                      │
│    score 30-70 → invisible challenge (CAPTCHA v3)   │
│    score > 70  → hard challenge / block             │
└───────────────────────┬─────────────────────────────┘
                        │ pass + challenge_token
                        ▼
┌─────────────────────────────────────────────────────┐
│  LAYER 3: API GATEWAY (Kong / Nginx / Envoy)        │
│                                                     │
│  • Verify challenge_token (JWT từ layer 2)          │
│    - sig check, exp check                           │
│    - bind token to session (chống reuse)            │
│                                                     │
│  • Request signing                                  │
│    - HMAC(path + timestamp + session_id, secret)    │
│    - Rotate secret mỗi N phút                       │
│    - Chống replay attack (nonce/timestamp window)   │
│                                                     │
│  • Per-user rate limiting                           │
│    - Token bucket: 100 req/min normal               │
│    - Burst detection: >10 req/s → throttle          │
│                                                     │
│  • Anomaly detection                                │
│    - Same IP, 50 different endpoints/s → flag       │
│    - Exact same headers order mọi request → flag    │
└───────────────────────┬─────────────────────────────┘
                        │ pass
                        ▼
┌─────────────────────────────────────────────────────┐
│  LAYER 4: APPLICATION (Business Logic)              │
│                                                     │
│  • Session binding                                  │
│    - Token tied to: IP + UA + TLS fingerprint hash  │
│    - Token used from different fingerprint → revoke │
│                                                     │
│  • Behavioral analysis (async, không block request) │
│    - Mouse movement entropy                         │
│    - Click patterns (bot click: pixel-perfect)      │
│    - Scroll velocity                                │
│    - Time between actions (too fast = bot)          │
│    - Navigation path (bot: A→Z, human: random)      │
│                                                     │
│  • Honeypot endpoints                               │
│    - /api/v1/hidden-endpoint (not in UI, not linked)│
│    - Bất kỳ request nào tới đây → ban ngay          │
│                                                     │
│  • Response poisoning (cho scraper)                 │
│    - 5% request trả data sai nếu bot-score cao      │
│    - Bot k biết data sai, human không bao giờ thấy │
└─────────────────────────────────────────────────────┘
```

## Risk Score Pipeline

```
Request đến
    │
    ├── TLS fingerprint score      (0-20)
    ├── IP reputation score        (0-20)
    ├── Browser fingerprint score  (0-20)
    ├── Behavioral score           (0-20)
    └── Historical score (session) (0-20)
                                    ─────
                              Total: 0-100

0-30   → PASS
31-60  → Invisible challenge (Turnstile/v3)
61-80  → Visible challenge (image CAPTCHA)
81-100 → Block + honeypot response
```

## Tech Stack Reference

| Layer | OSS option | Managed option |
|-------|-----------|----------------|
| Edge TLS check | Nginx + lua-resty-ja3 | Cloudflare |
| Bot challenge | Anubis (self-host) | Turnstile, DataDome |
| API Gateway | Kong, Envoy | AWS API GW |
| Rate limiting | Redis + token bucket | Upstash |
| Behavioral | Custom JS collector | PerimeterX |
| Risk scoring | Custom rule engine | Arkose Labs |

## Điểm yếu không thể vá hoàn toàn

```
curl_cffi + residential proxy + real browser profile
→ TLS: ✅ pass (Chrome fingerprint)
→ IP: ✅ pass (residential)
→ Browser FP: ❌ có thể bị detect nếu dùng headless
→ Behavioral: ❌ nếu dùng real browser với CDP thì rất khó detect

→ Không có hệ thống nào chặn được 100%
   Trade-off: security tăng → friction cho real user tăng
```

## Practical: Thứ tự ưu tiên triển khai

```
1. Cloudflare (free tier) → xử lý 80% bot ngay lập tức
2. Rate limiting (Redis)  → chặn abuse đơn giản
3. Turnstile invisible    → chặn thêm 15%
4. Behavioral collector  → detect automation tinh vi
5. Response poisoning     → passive defense cho scraper
```
