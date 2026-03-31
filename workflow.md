# Sofascore Request Authentication Workflow

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                        │
└─────────────────────────────────────────────────────────────────┘
          │
          │ 1. Load sofascore.com
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NEXT.JS PAGE BOOTSTRAP                       │
│                                                                 │
│  ┌──────────────────┐    ┌────────────────────────────────┐    │
│  │  /token/init     │    │  reCAPTCHA v2 (Google 3rd)     │    │
│  │                  │    │  site: 6Lc5BAkrAAAAA...        │    │
│  │  POST {          │    │                                │    │
│  │    uuid,         │    │  - Runs invisibly              │    │
│  │    deviceType,   │    │  - Score thấp → challenge      │    │
│  │    timezone,     │    │  - Score cao → silent pass     │    │
│  │    language      │    └──────────────┬─────────────────┘    │
│  │  }               │                   │                       │
│  │  → JWT 182 ngày  │           recaptcha_token                 │
│  └────────┬─────────┘                   │                       │
│           │                             ▼                       │
│    anonymous_session          ┌──────────────────┐             │
│           │                   │  /token/captcha  │             │
│           │                   │  POST {response} │             │
│           │                   │  → JWT ~30 phút  │             │
│           │                   └────────┬─────────┘             │
│           │                            │                        │
│           │                   localStorage[                     │
│           │                     "sofa.captcha.token",           │
│           │                     "sofa.captcha.expire"           │
│           │                   ]                                 │
└───────────┼────────────────────────────┼────────────────────────┘
            │                            │
            ▼                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    PER-REQUEST HEADERS                          │
│                                                                 │
│  x-requested-with = SHA-256(floor(now/1800))[:6]               │
│                     └─ đổi mỗi 30 phút, pure client-side ─┘   │
│                                                                 │
│  x-captcha        = localStorage["sofa.captcha.token"]         │
│                     └─ chỉ set nếu token tồn tại ─────────┘   │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API GATEWAY (Kong)                         │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Check 1: x-requested-with                              │   │
│  │  - Tính lại SHA-256(current_bucket)[:6]                 │   │
│  │  - Không match → 403 Forbidden                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │ pass                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Check 2: TLS Fingerprint (JA3/JA4)                     │   │
│  │  - curl/HTTP client → enforce x-captcha                 │   │
│  │  - Real browser fingerprint → pass through              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │ pass                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Check 3: x-captcha (chỉ với non-browser request)       │   │
│  │  - Verify JWT signature (HS256, server-side secret)     │   │
│  │  - Check exp                                            │   │
│  │  - Không có / hết hạn → 403 challenge                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │ pass                                 │
└──────────────────────────┼──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NODE SERVICE (Business Logic)                 │
│                  /api/v1/...                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Token Summary

| Token | Algorithm | TTL | Storage |
|-------|-----------|-----|---------|
| `x-requested-with` | `SHA-256(floor(now/1800))[:6]` | 30 phút | computed |
| `x-captcha` | reCAPTCHA → `/token/captcha` → JWT HS256 | ~30 phút | localStorage |
| `wsc_ias_accessToken` | `/token/init` → JWT RS256 | 24 giờ | localStorage |
| `wsc_ias_refreshToken` | `/token/init` → JWT RS256 | 182 ngày | localStorage |

## Bypass Matrix

| Request type | x-requested-with | x-captcha | Result |
|---|---|---|---|
| curl (no headers) | ✗ | ✗ | 403 Forbidden |
| curl (with xrw) | ✓ | ✗ | 403 challenge |
| Browser fetch (in-page) | ✓ | ✗ | ✅ 200 OK |
| curl (with xrw + captcha) | ✓ | ✓ | ✅ 200 OK |
