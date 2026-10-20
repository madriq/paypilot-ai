from unittest.mock import AsyncMock, Mock

from fastapi.testclient import TestClient

from app import main


ORDER_ID = "TESTORDER123"
client = TestClient(main.app)


def test_unapproved_order_is_not_captured(monkeypatch):
    """An order that is CREATED must not reach the capture function."""
    get_order = AsyncMock(
        return_value={"id": ORDER_ID, "status": "CREATED"}
    )
    capture_order = AsyncMock()
    update_status = Mock(return_value=True)

    monkeypatch.setattr(main, "get_order", get_order)
    monkeypatch.setattr(main, "capture_order", capture_order)
    monkeypatch.setattr(main, "update_order_status", update_status)

    response = client.post(
        f"/api/payments/orders/{ORDER_ID}/capture"
    )

    assert response.status_code == 409
    assert "not approved" in response.json()["detail"].lower()
    capture_order.assert_not_awaited()
    update_status.assert_called_once_with(ORDER_ID, "CREATED")


def test_completed_order_is_not_captured_again(monkeypatch):
    """A completed PayPal order must not trigger another capture."""
    get_order = AsyncMock(
        return_value={"id": ORDER_ID, "status": "COMPLETED"}
    )
    capture_order = AsyncMock()
    update_status = Mock(return_value=True)

    monkeypatch.setattr(main, "get_order", get_order)
    monkeypatch.setattr(main, "capture_order", capture_order)
    monkeypatch.setattr(main, "update_order_status", update_status)

    response = client.post(
        f"/api/payments/orders/{ORDER_ID}/capture"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "COMPLETED"
    capture_order.assert_not_awaited()
    update_status.assert_called_once_with(ORDER_ID, "COMPLETED")


def test_approved_order_is_captured_and_status_saved(monkeypatch):
    """An approved order can be captured and its result persisted."""
    get_order = AsyncMock(
        return_value={"id": ORDER_ID, "status": "APPROVED"}
    )
    capture_order = AsyncMock(
        return_value={"id": ORDER_ID, "status": "COMPLETED"}
    )
    update_status = Mock(return_value=True)

    monkeypatch.setattr(main, "get_order", get_order)
    monkeypatch.setattr(main, "capture_order", capture_order)
    monkeypatch.setattr(main, "update_order_status", update_status)

    response = client.post(
        f"/api/payments/orders/{ORDER_ID}/capture"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "COMPLETED"
    capture_order.assert_awaited_once_with(ORDER_ID)
    update_status.assert_called_once_with(ORDER_ID, "COMPLETED")


def test_status_refresh_saves_latest_paypal_status(monkeypatch):
    """Reading an order refreshes the local status from PayPal."""
    get_order = AsyncMock(
        return_value={
            "id": ORDER_ID,
            "status": "APPROVED",
            "purchase_units": [
                {"amount": {"currency_code": "USD", "value": "10.00"}}
            ],
        }
    )
    update_status = Mock(return_value=True)

    monkeypatch.setattr(main, "get_order", get_order)
    monkeypatch.setattr(main, "update_order_status", update_status)

    response = client.get(
        f"/api/payments/orders/{ORDER_ID}"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"
    update_status.assert_called_once_with(ORDER_ID, "APPROVED")


def test_invalid_order_id_is_rejected_before_paypal_call(monkeypatch):
    """Malformed IDs must be rejected before contacting PayPal."""
    get_order = AsyncMock()
    capture_order = AsyncMock()

    monkeypatch.setattr(main, "get_order", get_order)
    monkeypatch.setattr(main, "capture_order", capture_order)

    response = client.post(
        "/api/payments/orders/invalid-id/capture"
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid order ID."
    get_order.assert_not_awaited()
    capture_order.assert_not_awaited()


def test_missing_status_does_not_trigger_capture(monkeypatch):
    """A response without a status must never trigger capture."""
    get_order = AsyncMock(
        return_value={"id": ORDER_ID}
    )
    capture_order = AsyncMock()
    update_status = Mock(return_value=True)

    monkeypatch.setattr(main, "get_order", get_order)
    monkeypatch.setattr(main, "capture_order", capture_order)
    monkeypatch.setattr(main, "update_order_status", update_status)

    response = client.post(
        f"/api/payments/orders/{ORDER_ID}/capture"
    )

    assert response.status_code == 409
    capture_order.assert_not_awaited()
    update_status.assert_called_once_with(ORDER_ID, "UNKNOWN")


def test_missing_order_id_from_paypal_is_rejected(monkeypatch):
    """Order lookup must not accept a different returned order ID."""
    get_order = AsyncMock(
        return_value={
            "id": "DIFFERENTORDER456",
            "status": "APPROVED",
        }
    )
    capture_order = AsyncMock()
    update_status = Mock(return_value=True)

    monkeypatch.setattr(main, "get_order", get_order)
    monkeypatch.setattr(main, "capture_order", capture_order)
    monkeypatch.setattr(main, "update_order_status", update_status)

    response = client.post(
        f"/api/payments/orders/{ORDER_ID}/capture"
    )

    # This assertion is intended to expose a missing safeguard.
    assert response.status_code == 502
    capture_order.assert_not_awaited()
