# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Tomás Neto
import requests

def test_users():

    response = requests.get("http://localhost:3000")

    assert response.status_code == 200