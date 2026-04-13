/**
 * Hyperliquid WebSocket Integration
 * Real-time price updates for L1 assets
 */

const WS_URL = 'wss://api.hyperliquid.xyz/ws';

export interface MidPrice {
  coin: string;
  price: number;
}

export interface WsMessage {
  channel: string;
  data: any;
}

type PriceCallback = (prices: Map<string, number>) => void;
type ConnectionCallback = (connected: boolean) => void;

class HyperliquidWebSocket {
  private ws: WebSocket | null = null;
  private priceCallbacks: Set<PriceCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private prices: Map<string, number> = new Map();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private subscribedCoins: Set<string> = new Set();

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      this.ws = new WebSocket(WS_URL);

      this.ws.onopen = () => {
        this.isConnecting = false;
        console.log('[HyperliquidWS] Connected');
        this.notifyConnection(true);

        // Subscribe to allMids for real-time price updates
        this.subscribe();

        // Start ping to keep connection alive
        this.startPing();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          // Ignore parse errors
        }
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        console.log('[HyperliquidWS] Disconnected');
        this.notifyConnection(false);
        this.stopPing();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
        // WebSocket errors are usually network issues, will auto-reconnect
        console.debug('[HyperliquidWS] Connection error, will retry...');
      };
    } catch (error) {
      this.isConnecting = false;
      console.error('[HyperliquidWS] Failed to connect:', error);
      this.scheduleReconnect();
    }
  }

  private subscribe() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;

    // Subscribe to all mid prices
    this.ws.send(JSON.stringify({
      method: 'subscribe',
      subscription: { type: 'allMids' }
    }));
  }

  private handleMessage(msg: any) {
    if (msg.channel === 'allMids' && msg.data?.mids) {
      // Update prices from allMids
      const mids = msg.data.mids;
      let updated = false;

      for (const [coin, price] of Object.entries(mids)) {
        const priceNum = parseFloat(price as string);
        if (!isNaN(priceNum)) {
          this.prices.set(coin, priceNum);
          updated = true;
        }
      }

      if (updated) {
        this.notifyPrices();
      }
    }
  }

  private notifyPrices() {
    this.priceCallbacks.forEach(cb => cb(this.prices));
  }

  private notifyConnection(connected: boolean) {
    this.connectionCallbacks.forEach(cb => cb(connected));
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: 'ping' }));
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000); // Reconnect after 3 seconds
  }

  disconnect() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onPriceUpdate(callback: PriceCallback) {
    this.priceCallbacks.add(callback);
    // Immediately send current prices if available
    if (this.prices.size > 0) {
      callback(this.prices);
    }
    return () => this.priceCallbacks.delete(callback);
  }

  onConnectionChange(callback: ConnectionCallback) {
    this.connectionCallbacks.add(callback);
    // Immediately notify current state
    callback(this.ws?.readyState === WebSocket.OPEN);
    return () => this.connectionCallbacks.delete(callback);
  }

  getPrice(coin: string): number | null {
    return this.prices.get(coin) ?? null;
  }

  getAllPrices(): Map<string, number> {
    return new Map(this.prices);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Singleton instance
export const hyperliquidWs = new HyperliquidWebSocket();

// React hook for using WebSocket prices
export function useHyperliquidPrices(coins: string[]): {
  prices: Map<string, number>;
  connected: boolean;
} {
  // This is a placeholder - actual React hook implementation would use useState/useEffect
  // The component will implement this directly
  return {
    prices: hyperliquidWs.getAllPrices(),
    connected: hyperliquidWs.isConnected(),
  };
}

// Calculate real-time PnL for positions
export function calculatePositionPnL(
  positions: { coin: string; size: number; entryPrice: number }[],
  prices: Map<string, number>
): { coin: string; size: number; entryPrice: number; currentPrice: number; pnl: number }[] {
  return positions.map(pos => {
    const currentPrice = prices.get(pos.coin) ?? pos.entryPrice;
    const pnl = pos.size * (currentPrice - pos.entryPrice);
    return {
      ...pos,
      currentPrice,
      pnl,
    };
  });
}

// Calculate total unrealized PnL
export function calculateTotalPnL(
  positions: { coin: string; size: number; entryPrice: number }[],
  prices: Map<string, number>
): number {
  return positions.reduce((total, pos) => {
    const currentPrice = prices.get(pos.coin) ?? pos.entryPrice;
    return total + pos.size * (currentPrice - pos.entryPrice);
  }, 0);
}
