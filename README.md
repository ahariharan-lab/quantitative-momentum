# Quantitative Momentum API

A FastAPI web service implementing stock screening based on **"Quantitative Momentum"** by Wesley Gray and Jack Vogel.

## Key Methodology

### 12-1 Month Momentum
Calculate returns over the past 12 months, **excluding the most recent month**. This avoids short-term reversal effects that can distort momentum signals.

### Frog-in-the-Pan (FIP) Quality Score
The FIP score measures how "smooth" or "lumpy" the momentum is:

```
FIP = sign(momentum) × (% negative days - % positive days)
```

- **Smooth momentum** (many small daily gains) = Higher quality, preferred
- **Lumpy momentum** (few big jumps) = Lower quality, potentially news-driven

For positive momentum stocks, a **more negative FIP** indicates smoother, more consistent gains.

## Installation

### Using Docker (Recommended)

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/quantitative-momentum.git
cd quantitative-momentum

# Build and run with Docker Compose
docker-compose up --build

# Or build manually
docker build -t quantitative-momentum .
docker run -p 8000:8000 quantitative-momentum
```

### Local Development

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

## API Endpoints

### Health Check
```bash
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "quantitative-momentum",
  "version": "1.0.0"
}
```

### Single Stock Momentum
```bash
GET /momentum/{ticker}
```

**Example:**
```bash
curl http://localhost:8000/momentum/AAPL
```

**Response:**
```json
{
  "ticker": "AAPL",
  "momentum_12_1": 0.2534,
  "momentum_12_1_pct": "25.34%",
  "fip_score": -0.0892,
  "positive_days_pct": 0.5446,
  "negative_days_pct": 0.4554,
  "total_trading_days": 224,
  "start_date": "2024-01-15",
  "end_date": "2024-12-15",
  "fip_interpretation": "smooth",
  "error": null
}
```

### Screen Multiple Stocks
```bash
POST /screen
```

**Request Body:**
```json
{
  "tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"],
  "top_n": 5
}
```

**Example:**
```bash
curl -X POST http://localhost:8000/screen \
  -H "Content-Type: application/json" \
  -d '{"tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA"], "top_n": 3}'
```

**Response:**
```json
{
  "screened_count": 3,
  "error_count": 0,
  "stocks": [
    {
      "ticker": "NVDA",
      "momentum_12_1": 0.8921,
      "fip_score": -0.1234,
      "positive_days_pct": 0.5617,
      "negative_days_pct": 0.4383,
      "total_trading_days": 224,
      "start_date": "2024-01-15",
      "end_date": "2024-12-15",
      "momentum_rank": 1,
      "fip_interpretation": "smooth"
    },
    ...
  ],
  "errors": [],
  "methodology": {
    "momentum": "12-1 month return (skip most recent month to avoid reversal)",
    "fip": "Frog-in-the-Pan: sign(momentum) × (% negative days - % positive days)",
    "fip_interpretation": "For positive momentum: negative FIP = smooth/consistent gains (preferred)"
  }
}
```

## Interpreting Results

### Momentum Score
- **Positive**: Stock has gained value over the 12-1 month period
- **Negative**: Stock has lost value
- Higher absolute values indicate stronger momentum

### FIP Score Interpretation
For **positive momentum** stocks:
| FIP Score | Interpretation | Quality |
|-----------|----------------|---------|
| < -0.1 | Smooth | ✅ High quality - consistent daily gains |
| -0.1 to 0.1 | Moderate | ⚠️ Medium quality |
| > 0.1 | Lumpy | ❌ Low quality - driven by few big moves |

For **negative momentum** stocks, the interpretation is reversed.

## Example Use Cases

### Screen S&P 500 Sector Leaders
```bash
curl -X POST http://localhost:8000/screen \
  -H "Content-Type: application/json" \
  -d '{
    "tickers": ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B", "UNH", "JNJ"],
    "top_n": 5
  }'
```

### Build a Momentum Portfolio
1. Screen your universe (e.g., S&P 500 components)
2. Select top momentum stocks (e.g., top decile)
3. Filter for high FIP quality (smooth momentum preferred)
4. Rebalance monthly or quarterly

## API Documentation

Interactive API documentation is available at:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## References

- Gray, W. R., & Vogel, J. R. (2016). *Quantitative Momentum: A Practitioner's Guide to Building a Momentum-Based Stock Selection System*. Wiley.

## License

MIT License
