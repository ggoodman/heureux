import { Tracer } from 'opentracing';

import { ILogger, IMetrics, ITracer } from './interfaces';

export type Config = { [key: string]: any };

export interface Services<T extends Config> {
  config: T;
  logger: ILogger;
  metrics: IMetrics;
  tracer: ITracer;
}

interface ServicesWithDefaultsOptions<T extends Config> {
  config: T;
  logger?: ILogger;
  metrics?: IMetrics;
  tracer?: ITracer;
}

class NoopLogger implements ILogger {
  trace(): void {}
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
  fatal(): void {}
  child(): ILogger {
    return new NoopLogger();
  }
}

class NoopMetrics implements IMetrics {
  increment() {}
  histogram() {}
  gauge() {}
}

class NoopTracer extends Tracer {}

export function createServices<T>(
  options: ServicesWithDefaultsOptions<T>
): Services<T> {
  return {
    config: options.config,
    logger: options.logger || new NoopLogger(),
    metrics: options.metrics || new NoopMetrics(),
    tracer: options.tracer || new NoopTracer(),
  };
}
