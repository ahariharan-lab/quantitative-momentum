"""
Quantitative Momentum API

A FastAPI service implementing momentum screening based on
"Quantitative Momentum" by Wesley Gray and Jack Vogel.
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, Any
import uvicorn
import json

try:
    from src.momentum import calculate_momentum, screen_stocks
except ImportError:
    from momentum import calculate_momentum, screen_stocks


class PrettyJSONResponse(JSONResponse):
    """Custom JSON response with pretty formatting."""
    def render(self, content: Any) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=2,
            separators=(",", ": ")
        ).encode("utf-8")


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
    version="1.0.0",
    default_response_class=PrettyJSONResponse
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
    
    Returns a well-structured JSON response with:
    - **momentum**: 12-1 month return with value and percentage
    - **fip**: Frog-in-the-Pan quality score with interpretation
    - **data_range**: Date range and trading days used
    
    Example: GET /momentum/AAPL
    """
    result = calculate_momentum(ticker.upper().strip())
    
    if result.error:
        raise HTTPException(status_code=400, detail={
            "error": result.error,
            "ticker": ticker.upper().strip()
        })
    
    data = result.to_dict()
    
    # Add FIP quality interpretation
    if result.momentum_12_1 is not None and result.fip_score is not None:
        if result.momentum_12_1 > 0:
            quality = "smooth" if result.fip_score < -0.1 else "lumpy" if result.fip_score > 0.1 else "moderate"
        else:
            quality = "smooth" if result.fip_score > 0.1 else "lumpy" if result.fip_score < -0.1 else "moderate"
        data["fip"]["quality"] = quality
    
    return {
        "status": "success",
        "data": data
    }


@app.post("/screen", tags=["Screening"])
async def screen(request: ScreenRequest):
    """
    Screen multiple stocks using Quantitative Momentum methodology.
    
    Accepts a list of tickers and returns them ranked by:
    1. 12-1 month momentum (primary sort, descending)
    2. FIP quality score (secondary indicator)
    
    Returns a well-structured JSON response with:
    - **summary**: Overview of screening results
    - **results**: Ranked list of stocks with momentum and FIP data
    - **methodology_notes**: Explanation of the scoring system
    
    Example request body:
    ```json
    {
        "tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"],
        "top_n": 3
    }
    ```
    """
    if not request.tickers:
        raise HTTPException(status_code=400, detail={
            "error": "At least one ticker required",
            "received": []
        })
    
    results = screen_stocks(request.tickers, request.top_n)
    return {
        "status": "success",
        **results
    }


@app.get("/", tags=["Info"])
async def root():
    """
    API information and quick start guide.
    """
    return {
        "service": {
            "name": "Quantitative Momentum API",
            "version": "1.0.0",
            "description": "Stock screening based on Gray & Vogel's Quantitative Momentum"
        },
        "endpoints": [
            {
                "method": "GET",
                "path": "/health",
                "description": "Health check"
            },
            {
                "method": "GET",
                "path": "/momentum/{ticker}",
                "description": "Get momentum data for a single stock"
            },
            {
                "method": "POST",
                "path": "/screen",
                "description": "Screen multiple stocks with ranking"
            }
        ],
        "examples": {
            "single_stock": {
                "command": "curl http://localhost:8000/momentum/AAPL",
                "description": "Get momentum data for Apple"
            },
            "screen_stocks": {
                "command": "curl -X POST http://localhost:8000/screen -H 'Content-Type: application/json' -d '{\"tickers\": [\"AAPL\", \"MSFT\", \"GOOGL\"]}'",
                "description": "Screen and rank multiple stocks"
            }
        },
        "documentation": "/docs"
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
