import { API_VERSION, SERVICE_NAME, SERVICE_VERSION } from '../constants';
import { VersionController } from './version.controller';

describe('VersionController', () => {
  it('reports the API contract and deployed service versions', () => {
    const controller = new VersionController();

    expect(controller.getVersion()).toEqual({
      apiVersion: API_VERSION,
      service: SERVICE_NAME,
      serviceVersion: SERVICE_VERSION,
    });
  });
});
