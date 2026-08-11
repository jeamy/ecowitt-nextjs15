export type StatisticsChatMode = "local_fallback" | "sidecar";

export type StatisticsChatOperation =
  | "threshold_days"
  | "top_days"
  | "compare_periods"
  | "extreme_day"
  | "count_days"
  | "day_summary"
  | "record_check"
  | "threshold_periods"
  | "aggregate_period"
  | "rank_periods"
  | "availability";

export interface StatisticsChatPeriod {
  label: string;
  start: string;
  end: string;
}

export interface StatisticsChatIntent {
  operation: StatisticsChatOperation;
  metric: string;
  dataset?: "main" | "allsensors";
  measurement?: "temperature" | "humidity" | "pressure" | "wind" | "gust" | "precipitation" | "solar" | "uv" | "pm" | "co2" | "battery" | "soil_moisture";
  channel?: string;
  operator?: ">" | ">=" | "<" | "<=";
  value?: number;
  conditionLabel?: string;
  aggregation?: "sum" | "avg" | "min" | "max";
  groupBy?: "day" | "month";
  unit: string;
  periods: StatisticsChatPeriod[];
  limit?: number;
}

export interface StatisticsChatFacts {
  operation: StatisticsChatOperation;
  metric: string;
  unit: string;
  dataset?: "main" | "allsensors";
  operator?: ">" | ">=" | "<" | "<=";
  value?: number;
  conditionLabel?: string;
  periods: StatisticsChatPeriod[];
  values?: Array<{
    label: string;
    value: number | null;
    unit: string;
    validDays: number;
    availableDays: number;
    expectedDays?: number;
    coverage?: number | null;
  }>;
  items?: Array<{ date: string; value: number; unit: string }>;
  winner?: string | null;
  differenceAbsolute?: number | null;
  differenceRelativePercent?: number | null;
  count?: number;
  warnings: string[];
  recordCheck?: {
    targetDate: string;
    targetLabel: string;
    targetValue: number | null;
    bestDate: string | null;
    bestValue: number | null;
    previousBestDate: string | null;
    previousBestValue: number | null;
    differenceToPreviousBest: number | null;
    isRecord: boolean | null;
    rank: number | null;
    totalDays: number;
    tiedRecordDays: number;
    comparison: "max" | "min";
  };
  daySummary?: {
    date: string;
    label: string;
    measurements: Array<{
      key: string;
      label: string;
      value: number | null;
      unit: string;
    }>;
    description: string[];
  };
}

export interface StatisticsChatAnswer {
  schema_version: "ecowitt.statistics-chat-answer.v1";
  answer: string;
  facts: StatisticsChatFacts;
  source: {
    granularity: "day";
    dataset: "main" | "allsensors";
    statisticsUpdatedAt: string | null;
    dataRevision: string;
  };
  warnings: string[];
  mode: StatisticsChatMode;
  cache?: { hit: boolean; keyVersion: "v1"; createdAt?: string };
  diagnostics?: StatisticsChatDiagnostics;
}

export interface StatisticsChatDiagnostics {
  requestId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  cache: {
    status: "hit" | "miss";
    key: string;
    createdAt?: string;
  };
  intent: StatisticsChatIntent;
  sidecar: {
    enabled: boolean;
    attempted: boolean;
    endpoint: string;
    provider: string;
    model: string;
    httpStatus?: number;
    ok?: boolean;
    durationMs?: number;
    error?: string;
    answer?: string;
    answerLength?: number;
    requestPayload?: unknown;
    responsePayload?: unknown;
  };
  events: Array<{
    at: string;
    direction: "browser" | "app" | "cache" | "sidecar" | "provider";
    label: string;
    detail?: unknown;
  }>;
}

export interface StatisticsChatTurn {
  message: string;
  result: StatisticsChatAnswer;
  createdAt: string;
  requestFingerprint: string;
  dataRevision: string;
}

export interface StatisticsChatHistory {
  schemaVersion: "ecowitt.statistics-chat-history.v1";
  conversationId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  turns: StatisticsChatTurn[];
  createdAt: string;
  updatedAt: string;
  dataRevision: string;
}
