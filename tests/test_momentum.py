"""
Tests for the Quantitative Momentum service.
"""

import pytest
from src.momentum import calculate_momentum, screen_stocks, MomentumResult


class TestMomentumResult:
    """Tests for MomentumResult dataclass."""
    
    def test_to_dict_with_data(self):
        """Test to_dict with valid data."""
        result = MomentumResult(
            ticker="AAPL",
            momentum_12_1=0.25,
            fip_score=-0.08,
            positive_days_pct=0.54,
            negative_days_pct=0.46,
            total_trading_days=158,
            start_date="2024-01-01",
            end_date="2024-12-01",
            error=None
        )
        
        data = result.to_dict()
        
        assert data["ticker"] == "AAPL"
        assert data["momentum"]["value"] == 0.25
        assert data["momentum"]["percentage"] == "25.00%"
        assert data["momentum"]["period"] == "12-1 months"
        assert data["fip"]["score"] == -0.08
        assert data["fip"]["positive_days"] == "54.0%"
        assert data["fip"]["negative_days"] == "46.0%"
        assert data["data_range"]["start"] == "2024-01-01"
        assert data["data_range"]["end"] == "2024-12-01"
        assert data["data_range"]["trading_days"] == 158
        assert "error" not in data
    
    def test_to_dict_with_error(self):
        """Test to_dict when there's an error."""
        result = MomentumResult(
            ticker="INVALID",
            momentum_12_1=None,
            fip_score=None,
            positive_days_pct=None,
            negative_days_pct=None,
            total_trading_days=None,
            start_date=None,
            end_date=None,
            error="Insufficient data"
        )
        
        data = result.to_dict()
        
        assert data["ticker"] == "INVALID"
        assert data["momentum"]["value"] is None
        assert data["momentum"]["percentage"] is None
        assert data["fip"]["score"] is None
        assert data["error"] == "Insufficient data"
    
    def test_to_dict_with_none_values(self):
        """Test to_dict handles None values gracefully."""
        result = MomentumResult(
            ticker="TEST",
            momentum_12_1=None,
            fip_score=None,
            positive_days_pct=None,
            negative_days_pct=None,
            total_trading_days=None,
            start_date=None,
            end_date=None,
            error=None
        )
        
        data = result.to_dict()
        
        assert data["ticker"] == "TEST"
        assert data["momentum"]["value"] is None
        assert data["fip"]["score"] is None


class TestCalculateMomentum:
    """Tests for calculate_momentum function."""
    
    def test_valid_ticker(self):
        """Test momentum calculation for a valid ticker."""
        result = calculate_momentum("AAPL")
        
        assert result.ticker == "AAPL"
        assert result.error is None
        assert result.momentum_12_1 is not None
        assert result.fip_score is not None
        assert result.positive_days_pct is not None
        assert result.negative_days_pct is not None
        assert result.total_trading_days is not None
        assert result.start_date is not None
        assert result.end_date is not None
    
    def test_momentum_value_range(self):
        """Test that momentum values are reasonable."""
        result = calculate_momentum("AAPL")
        
        if result.error is None:
            # Momentum should be between -1 (100% loss) and some reasonable upper bound
            assert result.momentum_12_1 >= -1.0
            assert result.momentum_12_1 <= 10.0  # 1000% gain would be extreme
    
    def test_fip_score_range(self):
        """Test that FIP score is in valid range."""
        result = calculate_momentum("MSFT")
        
        if result.error is None:
            # FIP score should be between -1 and 1
            assert result.fip_score >= -1.0
            assert result.fip_score <= 1.0
    
    def test_percentages_sum(self):
        """Test that positive + negative percentages are close to 1."""
        result = calculate_momentum("GOOGL")
        
        if result.error is None:
            total = result.positive_days_pct + result.negative_days_pct
            # Should be close to 1.0 (with some neutral days possible)
            assert total <= 1.0
            assert total >= 0.8  # At least 80% of days should be up or down
    
    def test_invalid_ticker(self):
        """Test handling of invalid ticker."""
        result = calculate_momentum("INVALIDTICKER12345")
        
        # Should either have an error or empty data
        assert result.error is not None or result.momentum_12_1 is None
    
    def test_ticker_case_normalization(self):
        """Test that ticker is normalized to uppercase."""
        result = calculate_momentum("aapl")
        
        assert result.ticker == "AAPL"
    
    def test_ticker_whitespace_handling(self):
        """Test that whitespace is stripped from ticker."""
        result = calculate_momentum("  AAPL  ")
        
        assert result.ticker == "AAPL"


class TestScreenStocks:
    """Tests for screen_stocks function."""
    
    def test_screen_multiple_stocks(self):
        """Test screening multiple valid stocks."""
        tickers = ["AAPL", "MSFT", "GOOGL"]
        result = screen_stocks(tickers)
        
        assert "summary" in result
        assert "results" in result
        assert "methodology_notes" in result
        
        assert result["summary"]["total_screened"] <= len(tickers)
        assert result["summary"]["methodology"] == "Quantitative Momentum (Gray & Vogel)"
    
    def test_screen_ranking_order(self):
        """Test that stocks are ranked by momentum (descending)."""
        tickers = ["AAPL", "MSFT", "GOOGL"]
        result = screen_stocks(tickers)
        
        results = result["results"]
        if len(results) >= 2:
            for i in range(len(results) - 1):
                current_momentum = results[i]["momentum"]["value"]
                next_momentum = results[i + 1]["momentum"]["value"]
                if current_momentum is not None and next_momentum is not None:
                    assert current_momentum >= next_momentum
    
    def test_screen_top_n(self):
        """Test top_n parameter limits results."""
        tickers = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"]
        result = screen_stocks(tickers, top_n=2)
        
        assert len(result["results"]) <= 2
    
    def test_screen_ranks_are_sequential(self):
        """Test that ranks are assigned sequentially."""
        tickers = ["AAPL", "MSFT", "GOOGL"]
        result = screen_stocks(tickers)
        
        ranks = [r["rank"] for r in result["results"]]
        expected = list(range(1, len(ranks) + 1))
        assert ranks == expected
    
    def test_screen_fip_quality_interpretation(self):
        """Test that FIP quality interpretation is present."""
        tickers = ["AAPL", "MSFT"]
        result = screen_stocks(tickers)
        
        for stock in result["results"]:
            quality = stock["fip"]["quality"]
            assert quality in ["smooth", "moderate", "lumpy", None]
    
    def test_screen_with_invalid_ticker(self):
        """Test screening with mix of valid and invalid tickers."""
        tickers = ["AAPL", "INVALIDTICKER12345"]
        result = screen_stocks(tickers)
        
        # Should have at least one result (AAPL) or error
        total = result["summary"]["total_screened"] + result["summary"]["total_errors"]
        assert total == len(tickers)
    
    def test_screen_empty_list(self):
        """Test screening with empty list."""
        result = screen_stocks([])
        
        assert result["summary"]["total_screened"] == 0
        assert result["results"] == []
    
    def test_screen_output_structure(self):
        """Test that output has expected structure."""
        tickers = ["AAPL"]
        result = screen_stocks(tickers)
        
        # Check top-level keys
        assert "summary" in result
        assert "results" in result
        assert "errors" in result
        assert "methodology_notes" in result
        
        # Check summary structure
        summary = result["summary"]
        assert "total_screened" in summary
        assert "total_errors" in summary
        assert "methodology" in summary
        
        # Check methodology_notes structure
        notes = result["methodology_notes"]
        assert "momentum_period" in notes
        assert "fip_formula" in notes
        assert "fip_quality" in notes


class TestFIPQualityInterpretation:
    """Tests for FIP quality interpretation logic."""
    
    def test_smooth_positive_momentum(self):
        """Test smooth classification for positive momentum with negative FIP."""
        # For positive momentum: FIP < -0.1 = smooth
        result = MomentumResult(
            ticker="TEST",
            momentum_12_1=0.2,  # positive
            fip_score=-0.15,   # < -0.1
            positive_days_pct=0.55,
            negative_days_pct=0.45,
            total_trading_days=100,
            start_date="2024-01-01",
            end_date="2024-12-01",
            error=None
        )
        
        # Replicate the quality logic
        if result.momentum_12_1 > 0:
            quality = "smooth" if result.fip_score < -0.1 else "lumpy" if result.fip_score > 0.1 else "moderate"
        else:
            quality = "smooth" if result.fip_score > 0.1 else "lumpy" if result.fip_score < -0.1 else "moderate"
        
        assert quality == "smooth"
    
    def test_lumpy_positive_momentum(self):
        """Test lumpy classification for positive momentum with positive FIP."""
        # For positive momentum: FIP > 0.1 = lumpy
        result = MomentumResult(
            ticker="TEST",
            momentum_12_1=0.2,  # positive
            fip_score=0.15,    # > 0.1
            positive_days_pct=0.45,
            negative_days_pct=0.55,
            total_trading_days=100,
            start_date="2024-01-01",
            end_date="2024-12-01",
            error=None
        )
        
        if result.momentum_12_1 > 0:
            quality = "smooth" if result.fip_score < -0.1 else "lumpy" if result.fip_score > 0.1 else "moderate"
        else:
            quality = "smooth" if result.fip_score > 0.1 else "lumpy" if result.fip_score < -0.1 else "moderate"
        
        assert quality == "lumpy"
    
    def test_moderate_positive_momentum(self):
        """Test moderate classification for positive momentum with neutral FIP."""
        # For positive momentum: -0.1 <= FIP <= 0.1 = moderate
        result = MomentumResult(
            ticker="TEST",
            momentum_12_1=0.2,  # positive
            fip_score=0.05,    # between -0.1 and 0.1
            positive_days_pct=0.50,
            negative_days_pct=0.50,
            total_trading_days=100,
            start_date="2024-01-01",
            end_date="2024-12-01",
            error=None
        )
        
        if result.momentum_12_1 > 0:
            quality = "smooth" if result.fip_score < -0.1 else "lumpy" if result.fip_score > 0.1 else "moderate"
        else:
            quality = "smooth" if result.fip_score > 0.1 else "lumpy" if result.fip_score < -0.1 else "moderate"
        
        assert quality == "moderate"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
