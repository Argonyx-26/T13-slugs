"""Creates the two demo logins with their roles, so nobody has to click through the Supabase dashboard.

    cd backend && python -m rag.setup_users              # create if missing, otherwise just fix the role
    cd backend && python -m rag.setup_users --recreate   # delete and create both accounts again

Roles go in app_metadata, which users cannot edit themselves (user_metadata they can).
The password comes from DEMO_USER_PASSWORD in backend/.env; if it isn't set, one is generated and printed once.
"""
import os
import secrets
import sys

from .db import service as sb

USERS = {"doctor@lumen.test": "doctor", "reception@lumen.test": "receptionist"}


def setup(recreate: bool = False) -> str:
    password = os.getenv("DEMO_USER_PASSWORD")
    generated = not password
    password = password or secrets.token_urlsafe(12)
    existing = {u.email: u for u in sb.auth.admin.list_users()}
    for email, role in USERS.items():
        user = existing.get(email)
        if user and recreate:
            sb.auth.admin.delete_user(user.id)
            user = None
        if user:
            sb.auth.admin.update_user_by_id(user.id, {"app_metadata": {"role": role}})
            print(f"{email}: exists, role set to {role} (password unchanged)")
        else:
            sb.auth.admin.create_user({"email": email, "password": password, "email_confirm": True,
                                       "app_metadata": {"role": role}})
            print(f"{email}: created as {role}")
    if generated and (recreate or len(existing.keys() & USERS.keys()) < len(USERS)):
        print(f"\nGenerated password: {password}\nAdd DEMO_USER_PASSWORD={password} to backend/.env")
    return password


if __name__ == "__main__":
    setup(recreate="--recreate" in sys.argv)
