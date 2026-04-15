import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import (
    auth_routes, folder_routes, tag_routes, task_routes,
    subfolder_routes, reminder_routes,
    exercise_routes, routine_routes, session_routes,
    export_routes,
)
from app.database import init_db

app = FastAPI(title="TaskApp API", version="1.0.0")

# CORS: allow local dev origins + anything in CORS_ORIGINS env (comma-
# separated). Set CORS_ORIGINS to your deployed frontend URL in prod, e.g.
# `https://taskapp.vercel.app,https://taskapp-teric.vercel.app`.
_extra = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
_origins = [
    "http://localhost:8081",    # expo web
    "http://localhost:19006",   # older expo web
    "http://localhost:3000",
    *_extra,
]
# For quick setup, if CORS_ORIGINS is not set, fall back to allow-all. Swap
# to the locked list once your frontend URL is stable.
if not _extra:
    _origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # Auth is Bearer-token in the Authorization header (see app/auth.py
    # using HTTPBearer) — no cookies, no sessions. Keeping credentials off
    # avoids the spec gotcha where `*` origins/headers get silently
    # ignored on credentialed requests.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(folder_routes.router)
app.include_router(tag_routes.router)
app.include_router(task_routes.router)
app.include_router(subfolder_routes.router)
app.include_router(reminder_routes.router)
app.include_router(exercise_routes.router)
app.include_router(routine_routes.router)
app.include_router(session_routes.router)
app.include_router(export_routes.router)


@app.on_event("startup")
def startup():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}
