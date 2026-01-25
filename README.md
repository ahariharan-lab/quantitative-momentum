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

### Running Tests

```bash
# Install test dependencies
pip install pytest httpx

# Run all tests
pytest tests/ -v

# Run with coverage
pytest tests/ -v --cov=src
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
  "status": "success",
  "data": {
    "ticker": "AAPL",
    "momentum": {
      "value": 0.2534,
      "percentage": "25.34%",
      "period": "12-1 months"
    },
    "fip": {
      "score": -0.0892,
      "quality": "smooth",
      "positive_days": "54.5%",
      "negative_days": "45.5%"
    },
    "data_range": {
      "start": "2024-01-15",
      "end": "2024-12-15",
      "trading_days": 224
    }
  }
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
  "status": "success",
  "summary": {
    "total_screened": 3,
    "total_errors": 0,
    "methodology": "Quantitative Momentum (Gray & Vogel)"
  },
  "results": [
    {
      "rank": 1,
      "ticker": "NVDA",
      "momentum": {
        "value": 0.8921,
        "percentage": "89.21%"
      },
      "fip": {
        "score": -0.1234,
        "quality": "smooth"
      },
      "data_range": {
        "start": "2024-01-15",
        "end": "2024-12-15",
        "trading_days": 224
      }
    }
  ],
  "errors": null,
  "methodology_notes": {
    "momentum_period": "12-1 months (skip most recent month to avoid reversal)",
    "fip_formula": "sign(momentum) × (% negative days - % positive days)",
    "fip_quality": {
      "smooth": "Consistent, steady gains (preferred for positive momentum)",
      "moderate": "Mixed pattern of gains",
      "lumpy": "Volatile, concentrated gains (less reliable)"
    }
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
