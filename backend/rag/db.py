"""Supabase clients.

`service` uses the secret key and lives only inside FastAPI; never ship that key to the Flutter app.
`as_user(token)` acts as a logged-in person, so the database's own role checks apply.
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

load_dotenv(Path(__file__).resolve().parent.parent / ".env")   # backend/.env, whatever the working directory

URL = os.environ["SUPABASE_URL"]
service: Client = create_client(URL, os.environ["SUPABASE_SERVICE_KEY"])


def public() -> Client:
    """Client with the publishable key, used for logging in."""
    return create_client(URL, os.environ["SUPABASE_ANON_KEY"])


def as_user(access_token: str) -> Client:
    client = public()
    client.postgrest.auth(access_token)
    return client
