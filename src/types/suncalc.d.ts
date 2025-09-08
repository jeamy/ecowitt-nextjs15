/**
 * Type declarations for the 'suncalc' library, which is used for astronomical calculations.
 */
declare module 'suncalc' {
  /**
   * Represents the various sun times for a given day at a specific location.
   */
  export type SunTimes = {
    sunrise?: Date;
    sunset?: Date;
    [k: string]: Date | undefined;
  };

  /**
   * Represents the moon rise and set times.
   */
  export type MoonTimes = {
    rise?: Date;
    set?: Date;
    alwaysUp?: boolean;
    alwaysDown?: boolean;
  };

  /**
   * Represents the illumination and phase of the moon.
   */
  export type MoonIllumination = {
    /** Moon phase, from 0 (new moon) to 1 (new moon). */
    phase: number;
    /** Illuminated fraction of the moon's disk. */
    fraction: number;
    /** Midpoint angle in radians of the illuminated limb of the moon. */
    angle: number;
  };

  /**
   * The main object provided by the suncalc library.
   */
  const SunCalc: {
    /** Calculates sun times for a given date and location. */
    getTimes(date: Date, lat: number, lon: number): SunTimes;
    /** Calculates moon times for a given date and location. */
    getMoonTimes(date: Date, lat: number, lon: number, inUtc?: boolean): MoonTimes;
    /** Calculates moon illumination data for a given date. */
    getMoonIllumination(date: Date): MoonIllumination;
  };

  export default SunCalc;
}
