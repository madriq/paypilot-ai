
import sqlite3
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path(__file__).resolve().parent.parent / "paypilot.db"


def connect():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with connect() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                order_id TEXT PRIMARY KEY,
                amount TEXT NOT NULL,
                currency TEXT NOT NULL,
                status TEXT NOT NULL,
                approval_url TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)


def save_order(order_id, amount, currency, status, approval_url=None):
    now = datetime.now(timezone.utc).isoformat()

    with connect() as db:
        db.execute("""
            INSERT INTO orders (
                order_id, amount, currency, status,
                approval_url, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
                status = excluded.status,
                approval_url = COALESCE(
                    excluded.approval_url, orders.approval_url
                ),
                updated_at = excluded.updated_at
        """, (
            order_id, str(amount), currency, status,
            approval_url, now, now
        ))


def update_order_status(order_id, status):
    now = datetime.now(timezone.utc).isoformat()

    with connect() as db:
        cursor = db.execute("""
            UPDATE orders
            SET status = ?, updated_at = ?
            WHERE order_id = ?
        """, (status, now, order_id))

        return cursor.rowcount > 0


def list_orders():
    with connect() as db:
        rows = db.execute("""
            SELECT order_id, amount, currency, status,
                   approval_url, created_at, updated_at
            FROM orders
            ORDER BY created_at DESC
        """).fetchall()

        return [dict(row) for row in rows]


def find_order(order_id):
    with connect() as db:
        row = db.execute("""
            SELECT order_id, amount, currency, status,
                   approval_url, created_at, updated_at
            FROM orders
            WHERE order_id = ?
        """, (order_id,)).fetchone()

        return dict(row) if row else None
