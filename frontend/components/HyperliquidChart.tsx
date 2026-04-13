'use client';

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
} from 'lightweight-charts';

type Interval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

// Open order interface for TP/SL display
interface OpenOrder {
  oid: number;
  coin: string;
  side: 'B' | 'A'; // B=Buy, A=Ask(Sell)
  limitPx: string;
  sz: string;
  reduceOnly?: boolean;
}

interface HyperliquidChartProps {
  symbol: string;
  height?: number;
  compact?: boolean;
  minimal?: boolean; // 最小化模式：隱藏symbol/price，只保留時間選擇器和倉位資訊
  hideTimeScale?: boolean; // 隱藏底部時間軸
  szDecimals?: number; // Asset's size decimals (determines price precision: 6 - szDecimals)
  entryPrice?: number;
  positionSize?: number;
  liquidationPrice?: number;
  openOrders?: OpenOrder[]; // 已設置的訂單 (用於顯示止盈/止損線)
  onPriceClick?: (price: number) => void; // 點擊圖表設置價格回調
}

const HYPERLIQUID_INFO_API = 'https://api.hyperliquid.xyz/info';

const INTERVAL_OPTIONS: { value: Interval; label: string }[] = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
];

const intervalToMs: { [key: string]: number } = {
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
  '1d': 86400000,
};

function HyperliquidChart({ symbol, height = 300, compact = false, minimal = false, hideTimeScale = false, szDecimals = 2, entryPrice, positionSize, liquidationPrice, openOrders = [], onPriceClick }: HyperliquidChartProps) {
  // Calculate price decimals based on szDecimals (Hyperliquid formula: 6 - szDecimals, min 0, max 6)
  const priceDecimals = Math.max(0, Math.min(6, 6 - szDecimals));

  // Helper function to format price with correct decimals
  const formatPrice = (price: number): string => {
    if (price === 0) return '0';
    // Use more decimals for very small prices
    const effectiveDecimals = price < 0.01 ? Math.max(priceDecimals, 6) : price < 1 ? Math.max(priceDecimals, 4) : priceDecimals;
    return price.toFixed(effectiveDecimals);
  };

  // Helper for size formatting based on szDecimals
  const formatSize = (size: number): string => {
    return Math.abs(size).toFixed(szDecimals);
  };
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const entryPriceLineRef = useRef<any>(null);
  const liqPriceLineRef = useRef<any>(null);
  const orderPriceLinesRef = useRef<any[]>([]); // 訂單價格線
  const onPriceClickRef = useRef(onPriceClick); // 保存最新的回調
  const isLoadingRef = useRef(false);
  const lastLoadTimeRef = useRef(0);

  // 保持 ref 與 prop 同步
  useEffect(() => {
    onPriceClickRef.current = onPriceClick;
  }, [onPriceClick]);

  const [interval, setIntervalState] = useState<Interval>('1h');
  const [error, setError] = useState<string | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);

  // Load candle data - memoized
  const loadData = useCallback(async (currentSymbol: string, currentInterval: Interval, force = false) => {
    if (!candlestickSeriesRef.current || !volumeSeriesRef.current) return;
    if (isLoadingRef.current) return;

    // Throttle: minimum 5 seconds between loads unless forced
    const now = Date.now();
    if (!force && now - lastLoadTimeRef.current < 5000) return;
    lastLoadTimeRef.current = now;

    isLoadingRef.current = true;

    try {
      const endTime = Date.now();
      const startTime = endTime - intervalToMs[currentInterval] * 300; // 300 candles for more data

      const response = await fetch(HYPERLIQUID_INFO_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: {
            coin: currentSymbol,
            interval: currentInterval,
            startTime: startTime,
            endTime: endTime,
          },
        }),
      });

      if (!response.ok) throw new Error('Failed to fetch candles');

      const data = await response.json();

      if (!data || data.length === 0) {
        setError('No data');
        return;
      }

      const candleData: CandlestickData<Time>[] = data.map((candle: any) => ({
        time: Math.floor(candle.t / 1000) as Time,
        open: parseFloat(candle.o),
        high: parseFloat(candle.h),
        low: parseFloat(candle.l),
        close: parseFloat(candle.c),
      }));

      const volumeData = data.map((candle: any) => ({
        time: Math.floor(candle.t / 1000) as Time,
        value: parseFloat(candle.v),
        color: parseFloat(candle.c) >= parseFloat(candle.o)
          ? 'rgba(38, 166, 154, 0.5)'
          : 'rgba(239, 83, 80, 0.5)',
      }));

      if (candlestickSeriesRef.current && volumeSeriesRef.current) {
        candlestickSeriesRef.current.setData(candleData);
        volumeSeriesRef.current.setData(volumeData);

        if (candleData.length > 0) {
          const latest = candleData[candleData.length - 1];
          const first = candleData[0];
          setLastPrice(latest.close);
          setPriceChange(((latest.close - first.open) / first.open) * 100);
        }
      }
      setError(null);
    } catch (err) {
      setError('Load failed');
    } finally {
      isLoadingRef.current = false;
    }
  }, []);

  // Initialize chart once
  useEffect(() => {
    if (!chartContainerRef.current || chartRef.current) return;
    if (typeof window === 'undefined') return;

    let chart: IChartApi;
    try {
      chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: height,
        layout: {
          background: { color: '#131722' },
          textColor: '#d1d4dc',
        },
        grid: {
          vertLines: { color: 'rgba(42, 46, 57, 0.3)' },
          horzLines: { color: 'rgba(42, 46, 57, 0.3)' },
        },
        crosshair: {
          mode: CrosshairMode.Normal,
        },
        rightPriceScale: {
          borderColor: 'rgba(42, 46, 57, 0.5)',
          scaleMargins: { top: 0.1, bottom: 0.2 },
          minimumWidth: 80, // Wider price scale for labels
        },
        timeScale: {
          borderColor: 'rgba(42, 46, 57, 0.5)',
          timeVisible: !hideTimeScale,
          secondsVisible: false,
          visible: !hideTimeScale,
        },
      });
    } catch (err) {
      return;
    }

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceFormat: {
        type: 'price',
        precision: priceDecimals,
        minMove: Math.pow(10, -priceDecimals),
      },
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    volumeSeriesRef.current = volumeSeries;

    // Initial load
    loadData(symbol, interval, true);

    // Handle resize with ResizeObserver for panel resize support
    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (chartContainerRef.current && chartRef.current) {
          const newWidth = chartContainerRef.current.clientWidth;
          const newHeight = chartContainerRef.current.clientHeight || height;
          chartRef.current.applyOptions({ width: newWidth, height: newHeight });
        }
      }, 50); // Reduced timeout for smoother resize
    };

    // Use ResizeObserver for container resize (works with resizable panels)
    const resizeObserver = new ResizeObserver(handleResize);
    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    // Also listen to window resize as fallback
    window.addEventListener('resize', handleResize);

    // Handle chart click for price selection
    const handleChartClick = (param: any) => {
      if (!param.point || !candlestickSeriesRef.current) return;

      // Get the price at the click position
      const price = candlestickSeriesRef.current.coordinateToPrice(param.point.y);
      console.log('[Chart Click] y:', param.point.y, 'price:', price);
      if (price && price > 0 && onPriceClickRef.current) {
        console.log('[Chart Click] Calling onPriceClick with price:', price);
        onPriceClickRef.current(price);
      }
    };
    chart.subscribeClick(handleChartClick);

    return () => {
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      chart.unsubscribeClick(handleChartClick);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      candlestickSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [height]);

  // Load data when symbol/interval changes
  useEffect(() => {
    if (chartRef.current && candlestickSeriesRef.current) {
      loadData(symbol, interval, true);
    }
  }, [symbol, interval, loadData]);

  // Auto refresh every 60s (increased from 30s)
  useEffect(() => {
    // Stagger refresh based on symbol hash to avoid all charts refreshing at once
    const staggerDelay = (symbol.charCodeAt(0) % 4) * 5000; // 0-15s stagger

    const timer = setInterval(() => {
      if (chartRef.current && candlestickSeriesRef.current) {
        loadData(symbol, interval);
      }
    }, 60000); // 60 seconds

    // Initial staggered load
    const staggerTimer = setTimeout(() => {
      if (chartRef.current && candlestickSeriesRef.current) {
        loadData(symbol, interval);
      }
    }, staggerDelay);

    return () => {
      clearInterval(timer);
      clearTimeout(staggerTimer);
    };
  }, [symbol, interval, loadData]);

  // Update price lines when position changes
  useEffect(() => {
    if (!candlestickSeriesRef.current) return;


    // Remove existing lines
    if (entryPriceLineRef.current) {
      try {
        candlestickSeriesRef.current.removePriceLine(entryPriceLineRef.current);
      } catch (e) {}
      entryPriceLineRef.current = null;
    }
    if (liqPriceLineRef.current) {
      try {
        candlestickSeriesRef.current.removePriceLine(liqPriceLineRef.current);
      } catch (e) {}
      liqPriceLineRef.current = null;
    }

    // Add entry price line (label on right price axis)
    if (entryPrice && entryPrice > 0) {
      const isLong = positionSize && positionSize > 0;
      entryPriceLineRef.current = candlestickSeriesRef.current.createPriceLine({
        price: entryPrice,
        color: isLong ? '#2962FF' : '#FF6D00',
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '', // No left label, only right axis label
      });
    }

    // Add liquidation price line (label on right price axis)
    if (liquidationPrice && liquidationPrice > 0) {
      liqPriceLineRef.current = candlestickSeriesRef.current.createPriceLine({
        price: liquidationPrice,
        color: '#FF1744',
        lineWidth: 2,
        lineStyle: 1,
        axisLabelVisible: true,
        title: '', // No left label, only right axis label
      });
    }
  }, [symbol, entryPrice, positionSize, liquidationPrice]);

  // Update order price lines (TP/SL orders)
  useEffect(() => {
    if (!candlestickSeriesRef.current) return;

    // Remove existing order lines
    orderPriceLinesRef.current.forEach((line) => {
      try {
        candlestickSeriesRef.current?.removePriceLine(line);
      } catch (e) {}
    });
    orderPriceLinesRef.current = [];

    // Add price lines for open orders
    openOrders.forEach((order) => {
      if (!candlestickSeriesRef.current) return;

      const price = parseFloat(order.limitPx);
      const size = parseFloat(order.sz);
      if (price <= 0 || size <= 0) return;

      const isSell = order.side === 'A';
      const isTP = isSell && order.reduceOnly; // Sell reduce-only = Take Profit for long

      const line = candlestickSeriesRef.current.createPriceLine({
        price: price,
        color: isSell ? '#26a69a' : '#ef5350', // Green for sell (TP), Red for buy
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: '', // No left label, only right axis label
      });

      orderPriceLinesRef.current.push(line);
    });
  }, [openOrders]);

  return (
    <div className={minimal ? "" : "bg-[#131722] border border-gray-700/50 overflow-hidden"}>
      {/* Header - 最小化模式只顯示時間選擇器和倉位資訊 */}
      <div className={`flex items-center justify-between ${minimal ? 'p-2 bg-gray-800/30' : `border-b border-gray-700 ${compact ? 'p-2' : 'p-3'}`}`}>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 非最小化模式才顯示 symbol 和價格 */}
          {!minimal && (
            <>
              <span className={`font-bold ${compact ? 'text-sm' : 'text-lg'}`}>{symbol}</span>
              {lastPrice !== null && (
                <>
                  <span className={`font-mono ${compact ? 'text-xs' : 'text-sm'}`}>
                    ${formatPrice(lastPrice)}
                  </span>
                  <span className={`${compact ? 'text-xs' : 'text-sm'} ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                  </span>
                </>
              )}
            </>
          )}
          {/* Position info (only show when has position) */}
          {positionSize && positionSize !== 0 && (
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 border ${positionSize > 0 ? 'bg-green-500/10 text-green-400 border-green-500/30' : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
              {symbol} {positionSize > 0 ? 'L' : 'S'} {formatSize(positionSize)}
            </span>
          )}
          {/* Entry/Liq price */}
          {entryPrice && entryPrice > 0 && (
            <span className="text-[10px] font-mono text-primary">
              Entry: ${formatPrice(entryPrice)}
            </span>
          )}
          {liquidationPrice && liquidationPrice > 0 && (
            <span className="text-[10px] font-mono text-red-400">
              Liq: ${formatPrice(liquidationPrice)}
            </span>
          )}
        </div>

        {/* Interval Selector */}
        <div className="flex gap-0">
          {INTERVAL_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setIntervalState(opt.value)}
              className={`px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                interval === opt.value
                  ? 'bg-primary text-black'
                  : 'bg-white/5 text-gray-500 hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative">
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#131722]/80 z-10">
            <span className="text-red-400 text-xs">{error}</span>
          </div>
        )}
        {/* Click to set limit price hint */}
        {onPriceClick && (
          <div className="absolute top-1 left-1 z-20 bg-primary/80 text-black text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 pointer-events-none select-none">
            Click chart to set limit price
          </div>
        )}
        <div
          ref={chartContainerRef}
          style={{ height, cursor: onPriceClick ? 'crosshair' : 'default' }}
          title={onPriceClick ? "Click chart to set limit price" : undefined}
          onClick={(e) => {
            if (!onPriceClickRef.current || !candlestickSeriesRef.current || !chartContainerRef.current) return;

            // 計算相對於圖表容器的 Y 座標
            const rect = chartContainerRef.current.getBoundingClientRect();
            const y = e.clientY - rect.top;

            // 將 Y 座標轉換為價格
            const price = candlestickSeriesRef.current.coordinateToPrice(y);
            console.log('[DIV Click] clientY:', e.clientY, 'rect.top:', rect.top, 'y:', y, 'price:', price);

            if (price && price > 0) {
              onPriceClickRef.current(price);
            }
          }}
        />
      </div>
    </div>
  );
}

export default memo(HyperliquidChart);
