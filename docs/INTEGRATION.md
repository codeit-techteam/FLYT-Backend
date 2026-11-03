# FLYT Frontend ↔ Backend Integration

## Gap analysis (Phase 1)

| Area | Customer (FLYT) | Pilot (FLYT-Pilot) | Admin (FLYT-ADMIN) | Backend |
|------|-----------------|-------------------|--------------------|---------|
| Auth OTP | Was mock/`123456` | Was mock | Demo localStorage | Live JWT OTP + admin password |
| API client | None → added | Partial → envelope unwrap | None → added | `{ success, data }` / `{ success:false, error }` |
| Env | No API URL → added | Had `API_BASE_URL` | Label-only → wired | Port **5050** locally |
| Dispatch paths | N/A | Docs paths `/pilot/dispatch/*` | N/A | Compat router added |
| Trip OTP length | N/A | Was 4 → **6** | N/A | Default 6 |
| Pricing | Client tariffs | N/A | Hardcoded cards | Server quotes + Silver |
| Socket.IO | None | Polling only | None | Server ready — clients TBD |
| Payments | Mock | Mock | Mock list | Razorpay/dev adapters |

## What was implemented in this pass

1. **Central API config** in all three apps (`config/api.ts`).
2. **HTTP clients** that unwrap backend envelopes + timeouts.
3. **Customer live auth + live pricing** when `EXPO_PUBLIC_DEMO_MODE=false`.
4. **Pilot live auth + existing HTTP dispatch/trips** pointed at backend via **compat routes**.
5. **Admin live login + live dashboard KPIs** when `NEXT_PUBLIC_DEMO_MODE=false`.
6. **Backend** `/api/v1/pilot/dispatch/*`, `/api/v1/pilot/trips/*`, `/api/v1/service-categories`.

## Still remaining (honest backlog)

- Customer: full `rideService` swap, Socket.IO tracking, Razorpay checkout UI, profile/emergency live PATCH.
- Pilot: Socket.IO `DispatchChannel`, KYC upload APIs, payment settlement UI.
- Admin: rides/customers/pilots/SOS list endpoints wired page-by-page; live map sockets.
- Shared: refresh-token rotation in mobile stores; production HTTPS URLs.

## Local startup

```bash
# Backend
cd FLYT-Backend && docker compose up -d postgres redis
npm run dev          # :5050
npm run dev:worker

# Apps — DEMO_MODE=false already in .env* from this integration
cd FLYT && npx expo start
cd FLYT-Pilot && npx expo start
cd FLYT-ADMIN && npm run dev
```

### Test accounts

| App | Credential |
|-----|------------|
| Admin | `admin@flyt.local` / `Admin@Flyt2026!` |
| Customer OTP | `+919876543210` (use `devOtp` from send-otp response) |
| Pilot OTP | `+919800011122` |

Physical devices: set `EXPO_PUBLIC_API_URL` to `http://<your-lan-ip>:5050/api/v1`.
