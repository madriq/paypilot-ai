
import re
from contextlib import asynccontextmanager
from decimal import Decimal
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import settings
from app.paypal_client import create_order, capture_order, get_order
from app.database import (
    init_db,
    save_order,
    update_order_status,
    list_orders,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize the database when the application starts."""
    init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    description="Sandbox payment API for PayPilot AI",
    version="0.2.0",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreatePaymentRequest(BaseModel):
    amount: Decimal = Field(
        gt=0,
        le=10000,
        max_digits=8,
        decimal_places=2,
    )
    currency: Literal["USD"] = "USD"


def validate_order_id(order_id: str):
    """Reject malformed order IDs before making a PayPal request."""
    if not re.fullmatch(r"[A-Z0-9]+", order_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid order ID.",
        )


def validate_paypal_order(order: dict, expected_order_id: str):
    """Reject invalid or mismatched PayPal order responses."""
    if (
        not isinstance(order, dict)
        or order.get("id") != expected_order_id
    ):
        raise HTTPException(
            status_code=502,
            detail="PayPal returned an invalid or mismatched order ID.",
        )


def extract_capture_info(order: dict) -> dict:
    """Extract capture details without initiating a capture."""
    captures = []

    purchase_units = order.get("purchase_units", [])
    if isinstance(purchase_units, list):
        for unit in purchase_units:
            if not isinstance(unit, dict):
                continue

            payments = unit.get("payments", {})
            if not isinstance(payments, dict):
                continue

            unit_captures = payments.get("captures", [])
            if isinstance(unit_captures, list):
                captures.extend(
                    capture
                    for capture in unit_captures
                    if isinstance(capture, dict)
                )

    if not captures:
        return {
            "capture_status": "UNKNOWN",
            "capture_reason": None,
            "capture_id": None,
        }

    capture = captures[0]
    status_details = capture.get("status_details", {})
    if not isinstance(status_details, dict):
        status_details = {}

    return {
        "capture_status": capture.get("status", "UNKNOWN"),
        "capture_reason": status_details.get("reason"),
        "capture_id": capture.get("id"),
    }


def capture_message(capture_status: str) -> str:
    """Describe capture status without overstating settlement."""
    if capture_status == "COMPLETED":
        return "PayPal confirms the capture is completed."

    if capture_status == "PENDING":
        return (
            "Capture is pending. Do not treat this payment "
            "as settled yet."
        )

    if capture_status == "DECLINED":
        return "PayPal reports that the capture was declined."

    return (
        "Order status was returned by PayPal Sandbox, "
        "but capture completion has not been confirmed."
    )


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "app": settings.app_name,
        "payment_environment": "sandbox",
        "version": "0.2.0",
    }


@app.get("/api/payments/orders")
async def get_payment_history():
    """Return locally saved payment orders."""
    return {"orders": list_orders()}


@app.post("/api/payments/orders", status_code=201)
async def create_payment_order(request: CreatePaymentRequest):
    amount = format(request.amount, ".2f")

    order = await create_order(amount, request.currency)

    if not isinstance(order, dict):
        raise HTTPException(
            status_code=502,
            detail="PayPal returned an invalid order response.",
        )

    order_id = order.get("id")
    if not isinstance(order_id, str) or not order_id:
        raise HTTPException(
            status_code=502,
            detail="PayPal did not return a valid order ID.",
        )

    approval_url = next(
        (
            link["href"]
            for link in order.get("links", [])
            if isinstance(link, dict)
            and link.get("rel") in ("approve", "payer-action")
            and isinstance(link.get("href"), str)
        ),
        None,
    )

    status = order.get("status", "UNKNOWN")

    # Save only after PayPal successfully creates the order.
    save_order(
        order_id=order_id,
        amount=amount,
        currency=request.currency,
        status=status,
        approval_url=approval_url,
    )

    return {
        "order_id": order_id,
        "status": status,
        "amount": amount,
        "currency": request.currency,
        "approval_url": approval_url,
    }


@app.get("/api/payments/orders/{order_id}")
async def read_payment_order(order_id: str):
    """Refresh status from PayPal without capturing payment."""
    validate_order_id(order_id)

    order = await get_order(order_id)
    validate_paypal_order(order, order_id)

    status = order.get("status", "UNKNOWN")
    capture_info = extract_capture_info(order)

    purchase_units = order.get("purchase_units", [])
    if not isinstance(purchase_units, list):
        purchase_units = []

    amounts = [
        {
            "currency": unit.get("amount", {}).get("currency_code"),
            "value": unit.get("amount", {}).get("value"),
        }
        for unit in purchase_units
        if isinstance(unit, dict)
        and isinstance(unit.get("amount", {}), dict)
    ]

    # Preserve the PayPal order-level status in the existing database.
    update_order_status(order_id, status)

    return {
        "order_id": order_id,
        "status": status,
        "capture_status": capture_info["capture_status"],
        "capture_reason": capture_info["capture_reason"],
        "capture_id": capture_info["capture_id"],
        "amounts": amounts,
        "message": capture_message(
            capture_info["capture_status"]
        ),
    }


@app.post("/api/payments/orders/{order_id}/capture")
async def capture_payment_order(order_id: str):
    """Capture only approved orders and report capture status separately."""
    validate_order_id(order_id)

    # Fetch and validate the order before considering capture.
    order = await get_order(order_id)
    validate_paypal_order(order, order_id)

    current_status = order.get("status", "UNKNOWN")

    # Never capture an order that is already completed.
    if current_status == "COMPLETED":
        update_order_status(order_id, "COMPLETED")
        capture_info = extract_capture_info(order)

        return {
            "order_id": order_id,
            "status": "COMPLETED",
            **capture_info,
            "message": (
                "Order is already completed. "
                "No additional capture was attempted. "
                + capture_message(capture_info["capture_status"])
            ),
        }

    # Only PayPal-approved orders may proceed to capture.
    if current_status != "APPROVED":
        update_order_status(order_id, current_status)
        raise HTTPException(
            status_code=409,
            detail=(
                "Order is not approved for capture. "
                f"Current status: {current_status}"
            ),
        )

    # This is the only branch that initiates a capture request.
    result = await capture_order(order_id)
    validate_paypal_order(result, order_id)

    result_status = result.get("status", "UNKNOWN")
    capture_info = extract_capture_info(result)

    # Save the order-level status, not the capture-level status.
    update_order_status(order_id, result_status)

    return {
        "order_id": order_id,
        "status": result_status,
        **capture_info,
        "message": capture_message(
            capture_info["capture_status"]
        ),
        "details": result,
    }
