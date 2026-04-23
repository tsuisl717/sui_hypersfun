'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  IChartApi,
  ColorType,
  CrosshairMode,
  LineSeries,
  CandlestickSeries,
  HistogramSeries,
  UTCTimestamp,
} from 'lightweight-charts';
import { Trade, ChartCandle } from './types';

interface PriceChartProps {
  trades: Trade[];
  currentPrice?: number;
  tokenSymbol?: string;
  loading?: boolean;
}

type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
type ChartType = 'candle' | 'line';

const INTERVAL_OPTIONS: { value: Interval; label: string; seconds: number }[] = [
  { value: '1m', label: '1m', seconds: 60 },
  { value: '5m', label: '5m', seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '1h', label: '1H', seconds: 3600 },
  { value: '4h', label: '4H', seconds: 14400 },
  { value: '1d', label: '1D', seconds: 86400 },
];

// Convert trades to candles
function tradesToCandles(trades: Trade[], intervalSeconds: number): ChartCandle[] {
  if (trades.length === 0) return [];

  const sortedTrades = [...trades].sort((a, b) => a.timestamp - b.timestamp);
  const candleMap = new Map<number, ChartCandle>();

  for (const trade of sortedTrades) {
    const price = parseFloat(trade.price) / 1_000_000;
    const volume = parseFloat(trade.usdcAmount) / 1_000_000;
    const candleTime = Math.floor(trade.timestamp / intervalSeconds) * intervalSeconds;

    const existing = candleMap.get(candleTime);
    if (existing) {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume = (existing.volume || 0) + volume;
    } else {
      candleMap.set(candleTime, {
        time: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
      });
    }
  }

  return Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
}

export default function PriceChart({ trades, currentPrice, tokenSymbol = 'TOKEN', loading }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const [intervalState, setIntervalState] = useState<Interval>('15m');
  const [chartType, setChartType] = useState<ChartType>('candle');
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);

  // Build chart with data
  const buildChart = useCallback(() => {
    if (!chartContainerRef.current) return;

    // Remove existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: 'rgba(42, 46, 57, 0.8)',
      },
      timeScale: {
        borderColor: 'rgba(42, 46, 57, 0.8)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    const intervalConfig = INTERVAL_OPTIONS.find(i => i.value === intervalState);
    const candles = tradesToCandles(trades, intervalConfig?.seconds || 900);

    // Create main price series using v5 API
    if (chartType === 'candle') {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderVisible: false,
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350',
      });

      if (candles.length > 0) {
        candleSeries.setData(candles.map(c => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        })));
      }
    } else {
      const lineSeries = chart.addSeries(LineSeries, {
        color: '#50d2c1',
        lineWidth: 2,
      });

      if (candles.length > 0) {
        lineSeries.setData(candles.map(c => ({
          time: c.time as UTCTimestamp,
          value: c.close,
        })));
      }
    }

    // Create volume series (below price)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Set volume data
    if (candles.length > 0) {
      volumeSeries.setData(candles.map(c => ({
        time: c.time as UTCTimestamp,
        value: c.volume || 0,
        color: c.close >= c.open ? 'rgba(38, 166, 154, 0.5)' : 'rgba(239, 83, 80, 0.5)',
      })));
    }

    // Update price info
    if (candles.length > 0) {
      const latest = candles[candles.length - 1];
      const first = candles[0];
      setLastPrice(latest.close);
      setPriceChange(first.open > 0 ? ((latest.close - first.open) / first.open) * 100 : 0);
    } else if (currentPrice) {
      setLastPrice(currentPrice);
    }

    // Fit content
    chart.timeScale().fitContent();
  }, [trades, intervalState, chartType, currentPrice]);

  // Initialize and update chart
  useEffect(() => {
    buildChart();

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [buildChart]);

  return (
    <div className="h-full flex flex-col bg-[#131722]">
      {/* Chart Header */}
      <div className="h-10 border-b border-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-bold text-white">{tokenSymbol}/USDC</span>
          {lastPrice !== null && (
            <>
              <span className="font-mono text-lg">${lastPrice.toFixed(6)}</span>
              <span className={`text-sm ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Chart Type Toggle */}
          <div className="flex bg-white/5 rounded">
            <button
              onClick={() => setChartType('candle')}
              className={`px-2 py-1 text-xs ${chartType === 'candle' ? 'bg-primary text-black' : 'text-gray-400'}`}
            >
              K
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`px-2 py-1 text-xs ${chartType === 'line' ? 'bg-primary text-black' : 'text-gray-400'}`}
            >
              L
            </button>
          </div>

          {/* Interval Selector */}
          <div className="flex bg-white/5 rounded">
            {INTERVAL_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setIntervalState(opt.value)}
                className={`px-2 py-1 text-xs ${intervalState === opt.value ? 'bg-primary text-black' : 'text-gray-400'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart Area */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 bg-[#131722] flex items-center justify-center z-10">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}
        {!loading && trades.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <p className="text-gray-500">No trade data yet</p>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
