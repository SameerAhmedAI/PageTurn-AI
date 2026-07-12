from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.database import init_db
from app.routers import admin, health, subjects


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


@app.exception_handler(RuntimeError)
def runtime_error_handler(_request: Request, exc: RuntimeError) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.on_event("startup")
def on_startup() -> None:
    init_db()


app.include_router(health.router)
app.include_router(admin.router)
app.include_router(subjects.router)
