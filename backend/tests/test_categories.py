import pytest
from datetime import datetime, timedelta, timezone


async def test_categories_are_filtered_by_submission_type(client):
    concerns = await client.get("/api/categories", params={"type": "complaint"})
    services = await client.get("/api/categories", params={"type": "request"})
    assert concerns.status_code == services.status_code == 200
    assert concerns.json() == [
        "Streetlights", "Drainage", "Noise complaint", "Sanitation",
        "Roads and infrastructure", "Other",
    ]
    assert services.json() == [
        "Barangay clearance", "Certificate of residency", "Certificate of indigency",
        "Barangay business clearance", "Other",
    ]
    all_categories = await client.get("/api/categories")
    assert set(all_categories.json()) == set(concerns.json()) | set(services.json())
    assert len(all_categories.json()) == len(set(all_categories.json()))
    assert (await client.get("/api/categories?type=invalid")).status_code == 422


@pytest.mark.parametrize("category", [
    "Barangay clearance", "Certificate of residency", "Certificate of indigency",
    "Barangay business clearance", "Other",
])
async def test_resident_can_submit_service_categories(client, resident, category):
    response = await client.post(
        "/api/cases",
        headers={"Authorization": f"Bearer {resident['access_token']}"},
        json={
            "type": "request",
            "category": category,
            "subject": "Document request",
            "description": "Please provide this document for my application.",
            "appointment_date": (datetime.now(timezone(timedelta(hours=8))) + timedelta(days=1)).date().isoformat(),
        },
    )
    assert response.status_code == 201
    assert response.json()["type"] == "request"
    assert response.json()["category"] == category


@pytest.mark.parametrize(("case_type", "category"), [
    ("complaint", "Barangay clearance"),
    ("request", "Drainage"),
    ("request", "Unknown"),
])
async def test_category_must_match_submission_type(client, resident, case_type, category):
    response = await client.post(
        "/api/cases",
        headers={"Authorization": f"Bearer {resident['access_token']}"},
        json={
            "type": case_type,
            "category": category,
            "subject": "Invalid category",
            "description": "This category does not match the submission type.",
        },
    )
    assert response.status_code == 422
    assert "valid category" in response.json()["error"]["message"]
    assert (await client.get(
        "/api/cases", headers={"Authorization": f"Bearer {resident['access_token']}"},
    )).json() == []
