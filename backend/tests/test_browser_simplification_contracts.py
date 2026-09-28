from app.main import app
from app.db.browser_favorite import BrowserFavorite


def test_retired_browser_routes_and_listing_filters_are_absent():
    schema = app.openapi()
    paths = schema["paths"]
    assert "/api/users/me/browser-favorites" in paths
    assert "/api/users/me/browser-presets" not in paths
    assert "/api/browser/buckets/{bucket_name}/write-preflight" not in paths
    assert "/api/browser/buckets/{bucket_name}/multipart/{upload_id}/parts" not in paths
    parameters = paths["/api/browser/buckets/{bucket_name}/objects"]["get"]["parameters"]
    names = {parameter["name"] for parameter in parameters}
    assert names.isdisjoint({"min_size", "max_size", "modified_after", "modified_before", "extensions"})
    assert {"query", "recursive", "item_type", "storage_class", "include_folder_markers"} <= names
    for definition in schema["components"]["schemas"].values():
        assert "local_recovery_id" not in definition.get("properties", {})


def test_path_favorite_schema_has_no_generic_payload_or_saved_view_state():
    assert set(BrowserFavorite.__table__.columns.keys()) == {
        "id", "user_id", "name", "surface", "workspace", "context", "bucket", "prefix",
        "revision", "created_at", "updated_at",
    }
