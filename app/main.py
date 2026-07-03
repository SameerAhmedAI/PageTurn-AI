from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import health


app = FastAPI(
    title="PageTurn AI API",
    description="Local, source-cited RAG study assistant backend.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
