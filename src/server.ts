import * as Boom from 'boom';
import * as Hapi from 'hapi';
import * as t from 'io-ts';
import { FORMAT_HTTP_HEADERS } from 'opentracing';
import {
  SPAN_KIND_RPC_SERVER,
  COMPONENT,
  SPAN_KIND,
  HTTP_METHOD,
  HTTP_URL,
  HTTP_STATUS_CODE,
} from 'opentracing/lib/ext/tags';

import { createServices, Services, Config } from './services';
import { ILogger, ISpan } from './interfaces';

export enum HttpMethod {
  GET = 'get',
  POST = 'post',
  PUT = 'put',
  PATCH = 'patch',
  DELETE = 'delete',
  OPTIONS = 'options',
}

interface EndpointValidations<
  Response extends t.Any,
  Params extends t.Any,
  Payload extends t.Any,
  Query extends t.Any
> {
  params?: Params;
  payload?: Payload;
  query?: Query;
  response: Response;
}

interface EndpointResponseObject<Response extends t.Any>
  extends Hapi.ResponseObject {
  source: t.TypeOf<Response> | Promise<t.TypeOf<Response>>;

  code(statusCode: number): EndpointResponseObject<Response>;
  created(uri: string): EndpointResponseObject<Response>;
  header(
    name: string,
    value: string,
    options?: Hapi.ResponseObjectHeaderOptions
  ): EndpointResponseObject<Response>;
  location(uri: string): EndpointResponseObject<Response>;
  redirect(uri: string): EndpointResponseObject<Response>;
}

interface EndpointResponseToolkit<Response extends t.Any>
  extends Hapi.ResponseToolkit {
  response(value?: t.TypeOf<Response>): EndpointResponseObject<Response>;
}

interface EndpointHandler<
  C extends Config,
  Response extends t.Any,
  Params extends t.Any,
  Payload extends t.Any,
  Query extends t.Any
> {
  (
    request: EndpointRequest<C, Params, Payload, Query>,
    h: EndpointResponseToolkit<Response>,
    err?: Error
  ): Promise<t.TypeOf<Response> | EndpointResponseObject<Response>>;
  (
    request: EndpointRequest<C, Params, Payload, Query>,
    h: EndpointResponseToolkit<t.VoidType>,
    err?: Error
  ): Promise<EndpointResponseObject<t.VoidType>>;
}

interface EndpointOptions<
  C extends Config,
  Response extends t.Any,
  Params extends t.Any,
  Payload extends t.Any,
  Query extends t.Any
> {
  readonly description?: string;
  readonly id?: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: EndpointHandler<C, Response, Params, Payload, Query>;
  readonly tags?: string[];
  readonly validate?: EndpointValidations<Response, Params, Payload, Query>;
}

interface EndpointRequest<
  C extends Config,
  Params extends t.Any,
  Payload extends t.Any,
  Query extends t.Any
>
  extends Pick<
    Hapi.Request,
    Exclude<keyof Hapi.Request, 'payload' | 'params'>
  > {
  logger: ILogger;
  readonly params: t.TypeOf<Params>;
  readonly payload: t.TypeOf<Payload>;
  readonly query: t.TypeOf<Query>;
  services: Services<C>;
  span: ISpan;
}

type ImplementedHapiApi = Pick<
  Hapi.Server,
  'info' | 'initialize' | 'inject' | 'load' | 'start' | 'stop' | 'table'
>;

export class Server<C extends Config = {}> implements ImplementedHapiApi {
  private readonly codecs = new Map<
    string,
    EndpointValidations<t.Any, t.Any, t.Any, t.Any>
  >();
  private nextAnonymousEndpointId = 0;
  private readonly server: Hapi.Server;
  public readonly services: Services<C>;

  constructor(options: Hapi.ServerOptions, services: Services<C>) {
    this.server = new Hapi.Server(options);
    this.services = createServices(services);
  }

  endpoint<
    Response extends t.Any = t.VoidType,
    Params extends t.Any = t.UndefinedType,
    Payload extends t.Any = t.UndefinedType,
    Query extends t.Any = t.UndefinedType
  >(options: EndpointOptions<C, Response, Params, Payload, Query>): string {
    const id = options.id || `endpoint-${this.nextAnonymousEndpointId++}`;
    const routeOptions: Hapi.RouteOptions = {
      bind: this,
      description: options.description,
      ext: {
        onPreAuth: {
          method: async (request, h) => {
            const logger = this.services.logger.child({
              req: request.raw.req,
            });
            const parentSpanContext =
              this.services.tracer.extract(
                FORMAT_HTTP_HEADERS,
                request.headers
              ) || undefined;
            const span = this.services.tracer.startSpan(
              request.url.toString(),
              {
                childOf: parentSpanContext,
                startTime: request.info.received,
                tags: {
                  [COMPONENT]: this.services.config.service_name,
                  [SPAN_KIND]: SPAN_KIND_RPC_SERVER,
                  [HTTP_METHOD]: request.method,
                  [HTTP_URL]: request.url.toString(),
                },
              }
            );

            (<any>request).logger = logger;
            (<any>request).services = this.services;
            (<any>request).span = span;

            return h.continue;
          },
        },
        onPreResponse: {
          method: async (request, h) => {
            if (isHttpRequest(request)) {
              const response = request.response;

              if (response instanceof Boom) {
                request.logger.info(
                  {
                    latency: Date.now() - request.info.received,
                    err: response,
                    res: response.output,
                  },
                  'request error'
                );
                request.span.addTags({
                  [HTTP_STATUS_CODE]: response.output.statusCode,
                });

                request.span.finish();

                return h.continue;
              } else {
                request.logger.info(
                  {
                    latency: Date.now() - request.info.received,
                    res: response,
                  },
                  'sending response'
                );
              }

              request.span.finish();

              if (request.route.settings.id) {
                const codecs = this.codecs.get(request.route.settings.id);

                if (codecs) {
                  codecs.response.encode(response.source);
                }
              }
            }

            return h.continue;
          },
        },
      },
      handler: options.handler,
      id,
      tags: options.tags,
      validate: {},
    };
    const route: Hapi.ServerRoute = {
      method: options.method,
      path: options.path,
      options: routeOptions,
    };

    if (options.validate) {
      if (options.validate.params) {
        const codec = options.validate.params;

        routeOptions.validate!['params'] = async (
          input: object | Buffer | string
        ) => validate(input, codec, 'params');
      }

      if (options.validate.payload) {
        const codec = options.validate.payload;

        routeOptions.validate!['payload'] = async (
          input: object | Buffer | string
        ) => validate(input, codec, 'payload');
      }

      if (options.validate.query) {
        const codec = options.validate.query;

        routeOptions.validate!['query'] = async (
          input: object | Buffer | string
        ) => validate(input, codec, 'query');
      }
    }

    this.server.route(route);

    if (options.validate) {
      this.codecs.set(id, options.validate);
    }

    return id;
  }

  get info() {
    return this.server.info;
  }

  initialize() {
    return this.server.initialize();
  }

  inject(options: string | Hapi.ServerInjectOptions) {
    return this.server.inject(options);
  }

  get load() {
    return this.server.load;
  }

  start() {
    return this.server.start();
  }

  stop(options?: { timeout: number }) {
    return this.server.stop(options);
  }

  table(host?: string) {
    return this.server.table(host);
  }
}

type UnknownEndpointRequest = EndpointRequest<
  {},
  t.UnknownType,
  t.UnknownType,
  t.UnknownType
>;

function isHttpRequest(request: unknown): request is UnknownEndpointRequest {
  return !!(
    request &&
    typeof request === 'object' &&
    (<any>request).logger &&
    (<any>request).services &&
    (<any>request).span
  );
}

function stringify(v: any): string {
  return typeof v === 'function' ? t.getFunctionName(v) : JSON.stringify(v);
}

function getContextPath(context: t.Context): string {
  return context
    .reduce(
      (acc, { key, type }, i) => {
        if (i === 0) {
          acc.push(type.name);
        } else if (i === context.length - 1) {
          // Last segment
          acc.push(`${key}: ${type.name}`);
        } else if (key && !key.match(/^[0-9]+$/)) {
          acc.push(`${key}: ${type.name}`);
        }

        return acc;
      },
      [] as string[]
    )
    .join('/');
}

function failure(errors: t.ValidationError[]): string[] {
  return errors.map(err => {
    return `'${stringify(err.value)}' supplied to '${getContextPath(
      err.context
    )}'`;
  });
}

async function validate<T extends t.Any>(
  input: unknown,
  schema: T,
  source: string
): Promise<t.TypeOf<T>> {
  return schema.decode(input).getOrElseL(errors => {
    const err = Boom.badRequest(`Invalid request ${source} input`, {
      errors: failure(errors),
    });

    throw err;
  });
}
