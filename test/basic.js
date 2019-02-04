//@ts-check
'use strict';

const Code = require('code');
const Lab = require('lab');

const Heureux = require('../dist');

const { describe, it } = (exports.lab = Lab.script());
const { expect } = Code;

describe('basic operation', () => {
  it('allows the creation of a server', async () => {
    const services = Heureux.createServices({
      config: {
        hello: 'world',
      },
    });
    const server = new Heureux.Server({}, services);

    expect(server.services).to.equal(services);
  });

  it('allows defining an endpoint', async () => {
    const services = Heureux.createServices({
      config: {
        hello: 'world',
      },
    });
    const server = new Heureux.Server({}, services);
    const id = server.endpoint({
      id: 'test',
      method: Heureux.HttpMethod.GET,
      path: '/test',
      async handler(_, h) {
        return h.response().code(204);
      },
    });

    expect(id).to.equal('test');

    const res = await server.inject('/test');

    expect(res.result).to.equal(null);
    expect(res.statusCode).to.equal(204);
  });
});
