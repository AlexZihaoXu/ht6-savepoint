"""Smoke tests for the health and root endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from savepoint_server.main import app

client = TestClient(app)


def test_health_ok() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_root_returns_name() -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert "name" in body
    assert isinstance(body["name"], str)
    assert body["name"]
