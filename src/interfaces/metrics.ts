type StatsCb = (error: Error | undefined, bytes: any) => void;
type Tags = { [key: string]: string } | string[];

export interface IMetrics {
  increment(stat: string, tags?: Tags): void;
  increment(
    stat: string | string[],
    value: number,
    sampleRate?: number,
    tags?: Tags,
    callback?: StatsCb
  ): void;
  increment(
    stat: string | string[],
    value: number,
    tags?: Tags,
    callback?: StatsCb
  ): void;
  increment(stat: string | string[], value: number, callback?: StatsCb): void;
  increment(
    stat: string | string[],
    value: number,
    sampleRate?: number,
    callback?: StatsCb
  ): void;

  histogram(
    stat: string | string[],
    value: number,
    sampleRate?: number,
    tags?: Tags,
    callback?: StatsCb
  ): void;
  histogram(
    stat: string | string[],
    value: number,
    tags?: Tags,
    callback?: StatsCb
  ): void;
  histogram(stat: string | string[], value: number, callback?: StatsCb): void;
  histogram(
    stat: string | string[],
    value: number,
    sampleRate?: number,
    callback?: StatsCb
  ): void;

  gauge(
    stat: string | string[],
    value: number,
    sampleRate?: number,
    tags?: Tags,
    callback?: StatsCb
  ): void;
  gauge(
    stat: string | string[],
    value: number,
    tags?: Tags,
    callback?: StatsCb
  ): void;
  gauge(stat: string | string[], value: number, callback?: StatsCb): void;
  gauge(
    stat: string | string[],
    value: number,
    sampleRate?: number,
    callback?: StatsCb
  ): void;
}
