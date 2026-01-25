"""
Quantitative Momentum API

A FastAPI service implementing momentum screening based on
"Quantitative Momentum" by Wesley Gray and Jack Vogel.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import uvicorn

from .momentum import calculate_momentum, screen_stocks

app = FastAPI(
    title="Quantitative Momentum API",
    description="""
    Stock screening service based on the Quantitative Momentum methodology 
    by Wesley Gray and Jack Vogel.
    
    ## Key Concepts
    
    ### 12-1 Month Momentum
    Calculate returns over the past 12 months, excluding the most recent month.
    This avoids short-term reversal effects.
    
    ### Frog-in-the-Pan (FIP) Quality Score
    Measures how "smooth" or "lumpy" the momentum is:
    - **Smooth momentum** (many small gains) = higher quality
    - **Lumpy momentum** (few big jumps) = lower quality
    
    Formula: `FIP = sign(momentum) × (% negative days - % positive days)`
    
    For positive momentum stocks, a more negative FIP indicates smoother, 
    more consistent gains (preferred).
    """,
    version="1.0.0"
)


class ScreenRequest(BaseModel):
    """Request body for stock screening."""
    tickers: list[str] = Field(
        ..., 
        description="List of stock tickers to screen",
        min_length=1,
        max_length=100,
        json_schema_extra={"example": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"]}
    )
    top_n: Optional[int] = Field(
        None, 
        description="Return only top N stocks by momentum (optional)",
        ge=1
    )


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    service: str
    version: str


@app.get("/health", response_model=HealthResponse, tags=["Health"])
async def health_check():
    """
    Health check endpoint.
    
    Returns service status, name, and version.
    """
    return HealthResponse(
        status="healthy",
        service="quantitative-momentum",
        version="1.0.0"
    )


@app.get("/momentum/{ticker}", tags=["Momentum"])
async def get_momentum(ticker: str):
    """
    Get momentum data for a single stock.
    
    Returns:
    - **momentum_12_1**: 12-month return excluding most recent month (decimal)
    - **fip_score**: Frog-in-the-Pan quality score
    - **positive_days_pct**: Percentage of positive return days
    - **negative_days_pct**: Percentage of negative return days
    - **fip_interpretation**: Human-readable quality assessment
    
    Example: GET /momentum/AAPL
    """
    result = calculate_momentum(ticker.upper().strip())
    
    if result.error:
        raise HTTPException(status_code=400, detail=result.error)
    
    data = result.to_dict()
    
    # Add interpretation
    if result.momentum_12_1 is not None and result.fip_score is not None:
        if result.momentum_12_1 > 0:
            data['fip_interpretation'] = "smooth" if result.fip_score < -0.1 else "lumpy" if result.fip_score > 0.1 else "moderate"
        else:
            data['fip_interpretation'] = "smooth" if result.fip_score > 0.1 else "lumpy" if result.fip_score < -0.1 else "moderate"
    else:
        data['fip_interpretation'] = None
    
    # Add human-readable momentum
    if result.momentum_12_1 is not None:
        data['momentum_12_1_pct'] = f"{result.momentum_12_1 * 100:.2f}%"
    
    return data


@app.post("/screen", tags=["Screening"])
async def screen(request: ScreenRequest):
    """
    Screen multiple stocks using Quantitative Momentum methodology.
    
    Accepts a list of tickers and returns them ranked by:
    1. 12-1 month momentum (primary sort, descending)
    2. FIP quality score (secondary indicator)
    
    Each stock includes:
    - **momentum_rank**: Position in momentum ranking
    - **momentum_12_1**: 12-month return excluding most recent month
    - **fip_score**: Frog-in-the-Pan quality score
    - **fip_interpretation**: Quality assessment (smooth/moderate/lumpy)
    
    Example request body:
    ```json
    {
        "tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"],
        "top_n": 3
    }
    ```
    """
    if not request.tickers:
        raise HTTPException(status_code=400, detail="At least one ticker required")
    
    results = screen_stocks(request.tickers, request.top_n)
    return results


@app.get("/", tags=["Info"])
async def root():
    """
    API information and quick start guide.
    """
    return {
        "service": "Quantitative Momentum API",
        "version": "1.0.0",
        "description": "Stock screening based on Gray & Vogel's Quantitative Momentum",
        "endpoints": {
            "GET /health": "Health check",
            "GET /momentum/{ticker}": "Get momentum data for single stock",
            "POST /screen": "Screen multiple stocks"
        },
        "quick_start": {
            "single_stock": "curl http://localhost:8000/momentum/AAPL",
            "screen_stocks": "curl -X POST http://localhost:8000/screen -H 'Content-Type: application/json' -d '{\"tickers\": [\"AAPL\", \"MSFT\", \"GOOGL\"]}'"
        }
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
