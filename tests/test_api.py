"""
Tests for the FastAPI endpoints.
"""

import pytest
from fastapi.testclient import TestClient
from src.main import app


client = TestClient(app)


class TestHealthEndpoint:
    """Tests for /health endpoint."""
    
    def test_health_check(self):
        """Test health check returns healthy status."""
        response = client.get("/health")
        
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "quantitative-momentum"
        assert data["version"] == "1.0.0"


class TestRootEndpoint:
    """Tests for / endpoint."""
    
    def test_root_returns_info(self):
        """Test root endpoint returns API info."""
        response = client.get("/")
        
        assert response.status_code == 200
        data = response.json()
        
        assert "service" in data
        assert "endpoints" in data
        assert "examples" in data
        assert "documentation" in data
        
        assert data["service"]["name"] == "Quantitative Momentum API"
    
    def test_root_endpoints_list(self):
        """Test root endpoint lists all endpoints."""
        response = client.get("/")
        data = response.json()
        
        endpoints = data["endpoints"]
        paths = [e["path"] for e in endpoints]
        
        assert "/health" in paths
        assert "/momentum/{ticker}" in paths
        assert "/screen" in paths


class TestMomentumEndpoint:
    """Tests for /momentum/{ticker} endpoint."""
    
    def test_get_momentum_valid_ticker(self):
        """Test getting momentum for valid ticker."""
        response = client.get("/momentum/AAPL")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "success"
        assert "data" in data
        assert data["data"]["ticker"] == "AAPL"
    
    def test_get_momentum_returns_all_fields(self):
        """Test momentum response contains all expected fields."""
        response = client.get("/momentum/MSFT")
        
        if response.status_code == 200:
            data = response.json()["data"]
            
            assert "ticker" in data
            assert "momentum" in data
            assert "fip" in data
            assert "data_range" in data
            
            # Check nested momentum structure
            assert "value" in data["momentum"]
            assert "percentage" in data["momentum"]
            assert "period" in data["momentum"]
            
            # Check nested fip structure
            assert "score" in data["fip"]
            assert "positive_days" in data["fip"]
            assert "negative_days" in data["fip"]
    
    def test_get_momentum_case_insensitive(self):
        """Test ticker is case insensitive."""
        response = client.get("/momentum/aapl")
        
        assert response.status_code == 200
        data = response.json()
        assert data["data"]["ticker"] == "AAPL"
    
    def test_get_momentum_invalid_ticker(self):
        """Test error handling for invalid ticker."""
        response = client.get("/momentum/INVALIDTICKER12345")
        
        # Should return 400 with error detail
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data


class TestScreenEndpoint:
    """Tests for /screen endpoint."""
    
    def test_screen_valid_request(self):
        """Test screening with valid tickers."""
        response = client.post(
            "/screen",
            json={"tickers": ["AAPL", "MSFT"]}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["status"] == "success"
        assert "summary" in data
        assert "results" in data
    
    def test_screen_with_top_n(self):
        """Test screening with top_n parameter."""
        response = client.post(
            "/screen",
            json={"tickers": ["AAPL", "MSFT", "GOOGL"], "top_n": 2}
        )
        
        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) <= 2
    
    def test_screen_empty_tickers(self):
        """Test error when no tickers provided."""
        response = client.post(
            "/screen",
            json={"tickers": []}
        )
        
        # Should return 422 (validation error) due to min_length=1
        assert response.status_code == 422
    
    def test_screen_results_ranked(self):
        """Test that results are ranked by momentum."""
        response = client.post(
            "/screen",
            json={"tickers": ["AAPL", "MSFT", "GOOGL"]}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        results = data["results"]
        # Check ranks are sequential
        ranks = [r["rank"] for r in results]
        assert ranks == list(range(1, len(ranks) + 1))
    
    def test_screen_response_structure(self):
        """Test screen response has complete structure."""
        response = client.post(
            "/screen",
            json={"tickers": ["AAPL"]}
        )
        
        assert response.status_code == 200
        data = response.json()
        
        # Check top-level structure
        assert "status" in data
        assert "summary" in data
        assert "results" in data
        assert "methodology_notes" in data
        
        # Check summary structure
        assert "total_screened" in data["summary"]
        assert "total_errors" in data["summary"]
        assert "methodology" in data["summary"]
        
        # Check methodology_notes structure  
        assert "momentum_period" in data["methodology_notes"]
        assert "fip_formula" in data["methodology_notes"]
        assert "fip_quality" in data["methodology_notes"]


class TestJSONFormatting:
    """Tests for JSON response formatting."""
    
    def test_response_is_valid_json(self):
        """Test that responses are valid JSON."""
        response = client.get("/health")
        
        # Should not raise an exception
        data = response.json()
        assert isinstance(data, dict)
    
    def test_response_content_type(self):
        """Test that response has JSON content type."""
        response = client.get("/health")
        
        assert "application/json" in response.headers["content-type"]


class TestErrorHandling:
    """Tests for error handling."""
    
    def test_invalid_endpoint_returns_404(self):
        """Test that invalid endpoints return 404."""
        response = client.get("/invalid/endpoint")
        
        assert response.status_code == 404
    
    def test_invalid_method_returns_405(self):
        """Test that invalid HTTP method returns 405."""
        response = client.post("/health")
        
        assert response.status_code == 405
    
    def test_invalid_json_body(self):
        """Test handling of invalid JSON body."""
        response = client.post(
            "/screen",
            content="not valid json",
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 422


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
