declare module 'suncalc' {
  export type SunTimes = {
    sunrise?: Date;
    sunset?: Date;
    [k: string]: Date | undefined;
  };

  export type MoonTimes = {
    rise?: Date;
    set?: Date;
    alwaysUp?: boolean;
    alwaysDown?: boolean;
  };

  export type MoonIllumination = {
    phase: number; // 0..1
    fraction: number; // 0..1
    angle: number;
  };

  const SunCalc: {
    getTimes(date: Date, lat: number, lon: number): SunTimes;
    getMoonTimes(date: Date, lat: number, lon: number, inUtc?: boolean): MoonTimes;
    getMoonIllumination(date: Date): MoonIllumination;
  };

  export default SunCalc;
}
