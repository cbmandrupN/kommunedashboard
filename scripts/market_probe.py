import json
import os
from urllib.parse import urlencode
from pipeline import _request_json

for south, west in [(54, 7), (55.5, 12)]:
    query = urlencode({
        "coordinateX1": south, "coordinateY1": west,
        "coordinateX2": south + 0.5, "coordinateY2": west + 1,
        "pageNumber": 1, "pageSize": 1000,
    })
    payload = _request_json(
        "https://emoweb.dk/emodata/EMOData.svc/GetEnergyLabelInArea?" + query,
        os.environ["EMODATA_USERNAME"], os.environ["EMODATA_PASSWORD"],
    )
    print(json.dumps({
        "tile": [south, west], "status": payload.get("ResponseStatus"),
        "rowsType": type(payload.get("SearchResults")).__name__,
        "rows": len(payload.get("SearchResults") or []),
    }), flush=True)
