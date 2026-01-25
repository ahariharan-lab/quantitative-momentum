"""
Quantitative Momentum calculations based on Gray & Vogel's methodology.

Key concepts:
1. 12-1 Month Momentum: 12-month return excluding the most recent month
2. Frog-in-the-Pan (FIP): Information Discreteness measure for momentum quality
"""

import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass


@dataclass
class MomentumResult:
    """Result of momentum calculation for a single stock."""
    ticker: str
    momentum_12_1: Optional[float]  # 12-1 month momentum (percentage)
    fip_score: Optional[float]  # Frog-in-the-Pan score (-1 to 1)
    positive_days_pct: Optional[float]  # % of positive return days
    negative_days_pct: Optional[float]  # % of negative return days
    total_trading_days: Optional[int]
    start_date: Optional[str]
    end_date: Optional[str]
    error: Optional[str] = None
    
    def to_dict(self) -> dict:
        """Convert to well-formatted dictionary for JSON output."""
        result = {
            "ticker": self.ticker,
            "momentum": {
                "value": round(self.momentum_12_1, 4) if self.momentum_12_1 is not None else None,
                "percentage": f"{self.momentum_12_1 * 100:.2f}%" if self.momentum_12_1 is not None else None,
                "period": "12-1 months"
            },
            "fip": {
                "score": round(self.fip_score, 4) if self.fip_score is not None else None,
                "positive_days": f"{self.positive_days_pct * 100:.1f}%" if self.positive_days_pct is not None else None,
                "negative_days": f"{self.negative_days_pct * 100:.1f}%" if self.negative_days_pct is not None else None
            },
            "data_range": {
                "start": self.start_date,
                "end": self.end_date,
                "trading_days": self.total_trading_days
            }
        }
        
        if self.error:
            result["error"] = self.error
            
        return result


def calculate_momentum(ticker: str) -> MomentumResult:
    """
    Calculate 12-1 month momentum and FIP score for a single ticker.
    
    12-1 Month Momentum:
    - Look back 12 months from today
    - Skip the most recent month (to avoid short-term reversal)
    - Calculate cumulative return over months 2-12
    
    Frog-in-the-Pan (FIP) Score:
    - FIP = sign(momentum) × (% negative days - % positive days)
    - Higher FIP = smoother, more consistent momentum (better quality)
    - Stocks with smooth upward momentum have many small positive days
      → low % of negative days, high % of positive days
      → FIP = (+1) × (low - high) = negative... wait, let me reconsider.
    
    Per Gray & Vogel:
    - Information Discreteness = sign(2-12 mom) × (% neg - % pos)
    - For positive momentum stocks: we WANT more positive days (smooth up)
    - More positive days means (% neg - % pos) is negative
    - Multiplied by positive sign = negative FIP
    - So LOWER (more negative) FIP = smoother positive momentum
    
    Actually, let me re-read: they want to AVOID "discrete" information.
    Discrete = big jumps. Continuous = smooth daily moves.
    
    For a stock going up smoothly: many small positive days
    - % pos > % neg → (% neg - % pos) < 0
    - sign(momentum) = +1
    - FIP = +1 × negative = negative
    
    For a stock going up on a few big jumps: fewer positive days, some negative
    - % pos might be closer to % neg, or even % neg > % pos
    - FIP = +1 × (closer to 0 or positive) = less negative or positive
    
    So for positive momentum: MORE NEGATIVE FIP = BETTER (smoother)
    For negative momentum: the logic inverts.
    
    In the book, they rank by FIP and want HIGH quality = continuous information.
    Let me adjust: we want to rank such that higher = better.
    
    Alternative formulation: Quality = -FIP for sorting purposes.
    Or we just report raw FIP and let the user interpret.
    """
    try:
        # Calculate date range: need 13 months of data to get 12-1
        end_date = datetime.now()
        start_date = end_date - timedelta(days=400)  # ~13 months with buffer
        
        # Fetch data
        stock = yf.Ticker(ticker)
        df = stock.history(start=start_date, end=end_date)
        
        if df.empty or len(df) < 20:
            return MomentumResult(
                ticker=ticker,
                momentum_12_1=None,
                fip_score=None,
                positive_days_pct=None,
                negative_days_pct=None,
                total_trading_days=None,
                start_date=None,
                end_date=None,
                error="Insufficient data"
            )
        
        # Calculate daily returns
        df['daily_return'] = df['Close'].pct_change()
        df = df.dropna(subset=['daily_return'])
        
        # Identify the date boundaries
        # End of momentum period = 1 month ago (skip most recent month)
        # Start of momentum period = 12 months ago
        one_month_ago = end_date - timedelta(days=21)  # ~1 trading month
        twelve_months_ago = end_date - timedelta(days=252)  # ~12 trading months
        
        # Filter to the 12-1 month window
        mask = (df.index <= pd.Timestamp(one_month_ago)) & (df.index >= pd.Timestamp(twelve_months_ago))
        momentum_period = df[mask]
        
        if len(momentum_period) < 100:  # Need reasonable amount of data
            return MomentumResult(
                ticker=ticker,
                momentum_12_1=None,
                fip_score=None,
                positive_days_pct=None,
                negative_days_pct=None,
                total_trading_days=len(momentum_period),
                start_date=str(momentum_period.index[0].date()) if len(momentum_period) > 0 else None,
                end_date=str(momentum_period.index[-1].date()) if len(momentum_period) > 0 else None,
                error="Insufficient data in momentum period"
            )
        
        # Calculate 12-1 month momentum (cumulative return)
        start_price = momentum_period['Close'].iloc[0]
        end_price = momentum_period['Close'].iloc[-1]
        momentum_12_1 = (end_price - start_price) / start_price
        
        # Calculate FIP components
        positive_days = (momentum_period['daily_return'] > 0).sum()
        negative_days = (momentum_period['daily_return'] < 0).sum()
        total_days = len(momentum_period)
        
        positive_pct = positive_days / total_days
        negative_pct = negative_days / total_days
        
        # FIP = sign(momentum) × (% negative - % positive)
        momentum_sign = 1 if momentum_12_1 >= 0 else -1
        fip_score = momentum_sign * (negative_pct - positive_pct)
        
        return MomentumResult(
            ticker=ticker,
            momentum_12_1=momentum_12_1,
            fip_score=fip_score,
            positive_days_pct=positive_pct,
            negative_days_pct=negative_pct,
            total_trading_days=total_days,
            start_date=str(momentum_period.index[0].date()),
            end_date=str(momentum_period.index[-1].date()),
            error=None
        )
        
    except Exception as e:
        return MomentumResult(
            ticker=ticker,
            momentum_12_1=None,
            fip_score=None,
            positive_days_pct=None,
            negative_days_pct=None,
            total_trading_days=None,
            start_date=None,
            end_date=None,
            error=str(e)
        )


def screen_stocks(tickers: list[str], top_n: Optional[int] = None) -> dict:
    """
    Screen a list of stocks using Quantitative Momentum methodology.
    
    Process:
    1. Calculate 12-1 momentum for all stocks
    2. Calculate FIP quality score for all stocks
    3. Rank by momentum (descending)
    4. Within momentum ranks, prefer higher FIP quality
    
    Returns ranked list with momentum and quality metrics.
    """
    results = []
    errors = []
    
    for ticker in tickers:
        result = calculate_momentum(ticker.upper().strip())
        if result.error:
            errors.append({"ticker": ticker, "error": result.error})
        else:
            results.append(result)
    
    # Sort by momentum (descending), then by FIP (ascending, since more negative = better for positive momentum)
    # Actually, for a combined ranking, we want:
    # - High momentum = good
    # - For positive momentum: low (negative) FIP = good (smooth)
    # - For negative momentum: high (positive) FIP = good (smooth decline, if shorting)
    
    # Simple approach: rank by momentum, use FIP as tiebreaker/quality indicator
    results.sort(key=lambda x: (x.momentum_12_1 or float('-inf')), reverse=True)
    
    # Assign ranks and build structured results
    ranked_results = []
    for i, result in enumerate(results):
        # Determine FIP quality interpretation
        if result.momentum_12_1 is not None and result.fip_score is not None:
            if result.momentum_12_1 > 0:
                quality = "smooth" if result.fip_score < -0.1 else "lumpy" if result.fip_score > 0.1 else "moderate"
            else:
                quality = "smooth" if result.fip_score > 0.1 else "lumpy" if result.fip_score < -0.1 else "moderate"
        else:
            quality = None
        
        ranked_results.append({
            "rank": i + 1,
            "ticker": result.ticker,
            "momentum": {
                "value": round(result.momentum_12_1, 4) if result.momentum_12_1 is not None else None,
                "percentage": f"{result.momentum_12_1 * 100:.2f}%" if result.momentum_12_1 is not None else None
            },
            "fip": {
                "score": round(result.fip_score, 4) if result.fip_score is not None else None,
                "quality": quality
            },
            "data_range": {
                "start": result.start_date,
                "end": result.end_date,
                "trading_days": result.total_trading_days
            }
        })
    
    if top_n:
        ranked_results = ranked_results[:top_n]
    
    return {
        "summary": {
            "total_screened": len(ranked_results),
            "total_errors": len(errors),
            "methodology": "Quantitative Momentum (Gray & Vogel)"
        },
        "results": ranked_results,
        "errors": errors if errors else None,
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
