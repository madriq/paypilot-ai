
import httpx
from fastapi import HTTPException

from app.config import settings


def require_credentials():
    if not settings.paypal_client_id or not settings.paypal_client_secret:
        raise HTTPException(
            status_code=503,
            detail="PayPal Sandbox credentials are not configured.",
        )


async def get_access_token(client: httpx.AsyncClient) -> str:
    require_credentials()

    try:
        response = await client.post(
            f"{settings.paypal_base_url}/v1/oauth2/token",
            auth=(
                settings.paypal_client_id,
                settings.paypal_client_secret,
            ),
            data={"grant_type": "client_credentials"},
            headers={"Accept": "application/json"},
        )
        response.raise_for_status()
        token = response.json().get("access_token")
        if not token:
            raise HTTPException(
                status_code=502,
                detail="PayPal did not return an access token.",
            )
        return token
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail="PayPal authentication failed. Check Sandbox credentials.",
        ) from exc
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not connect to PayPal Sandbox.",
        ) from exc


async def paypal_request(
    method: str,
    path: str,
    payload: dict | None = None,
) -> dict:
    async with httpx.AsyncClient(timeout=20.0) as client:
        token = await get_access_token(client)

        try:
            response = await client.request(
                method,
                f"{settings.paypal_base_url}{path}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            return response.json()

        except httpx.HTTPStatusError as exc:
            # Identify missing orders during PayPal Sandbox lookups.
            if (
                exc.response.status_code == 404
                and method.upper() == "GET"
                and path.startswith("/v2/checkout/orders/")
                and "/capture" not in path
            ):
                raise HTTPException(
                    status_code=404,
                    detail=(
                        "PayPal Sandbox could not find this order. "
                        "The local order record has been preserved."
                    ),
                ) from exc

            # Avoid exposing raw PayPal responses or credentials.
            raise HTTPException(
                status_code=502,
                detail=(
                    f"PayPal request failed with status "
                    f"{exc.response.status_code}."
                ),
            ) from exc

        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502,
                detail="Could not connect to PayPal Sandbox.",
            ) from exc


async def create_order(amount: str, currency: str) -> dict:
    return await paypal_request(
        "POST",
        "/v2/checkout/orders",
        {
            "intent": "CAPTURE",
            "purchase_units": [
                {
                    "amount": {
                        "currency_code": currency,
                        "value": amount,
                    }
                }
            ],
        },
    )


async def capture_order(order_id: str) -> dict:
    return await paypal_request(
        "POST",
        f"/v2/checkout/orders/{order_id}/capture",
        {},
    )


async def get_order(order_id: str) -> dict:
    return await paypal_request(
        "GET",
        f"/v2/checkout/orders/{order_id}",
    )
