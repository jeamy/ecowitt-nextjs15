export interface ThresholdDates {
  count: number;
  dates: string[]; // ISO dates YYYY-MM-DD
}

export interface TemperatureStats {
  max: number | null;
  maxDate: string | null; // YYYY-MM-DD
  min: number | null;
  minDate: string | null; // YYYY-MM-DD
  avg: number | null; // average temperature over the period
  over30: ThresholdDates; // days with max temp > 30°C
  over25: ThresholdDates; // days with max temp > 25°C
  over20: ThresholdDates; // days with max temp > 20°C
  under0: ThresholdDates; // days with min temp < 0°C
  under10: ThresholdDates; // days with min temp < -10°C
}

export interface PrecipitationStats {
  total: number | null; // sum of daily totals over the period (mm)
  maxDay: number | null; // maximum daily total in the period (mm)
  maxDayDate: string | null; // YYYY-MM-DD
  minDay: number | null; // minimum daily total in the period (mm)
  minDayDate: string | null; // YYYY-MM-DD
  over20mm: ThresholdDates; // days with daily total >= 20 mm
  over30mm: ThresholdDates; // days with daily total >= 30 mm
}

export interface WindStats {
  max: number | null; // maximum daily peak wind (km/h)
  maxDate: string | null; // YYYY-MM-DD
  gustMax: number | null; // maximum daily peak gust (km/h)
  gustMaxDate: string | null; // YYYY-MM-DD
  avg: number | null; // average of daily mean wind (km/h)
}

export interface MonthStats {
  year: number;
  month: number; // 1-12
  temperature: TemperatureStats;
  precipitation: PrecipitationStats;
  wind: WindStats;
}

export interface YearStats {
  year: number;
  temperature: TemperatureStats;
  precipitation: PrecipitationStats;
  wind: WindStats;
  months: MonthStats[];
}

export interface StatisticsPayload {
  updatedAt: string; // ISO timestamp
  years: YearStats[];
}
