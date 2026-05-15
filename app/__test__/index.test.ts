/**
 * Smoke test das exportações públicas do index.ts.
 * Garante que VestaSDK e VestaSDKError estejam acessíveis via import padrão.
 */
import { VestaSDK, VestaSDKError } from '../src/index';

describe('index exports', () => {
  it('deve exportar VestaSDK como classe construtora', () => {
    expect(typeof VestaSDK).toBe('function');
    expect(VestaSDK.prototype).toBeDefined();
  });

  it('deve exportar VestaSDKError como classe de erro', () => {
    expect(typeof VestaSDKError).toBe('function');
    const err = new VestaSDKError(404, 'Not Found');
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(404);
    expect(err.apiMessage).toBe('Not Found');
    expect(err.message).toBe('VestaSDK [404]: Not Found');
  });

  it('VestaSDK deve ser instanciável com config mínima', () => {
    const sdk = new VestaSDK({ apiKey: 'test-key' });
    expect(sdk).toBeInstanceOf(VestaSDK);
    expect(typeof sdk.issueCredential).toBe('function');
    expect(typeof sdk.validateCredential).toBe('function');
    expect(typeof sdk.checkCredentialStatus).toBe('function');
    expect(typeof sdk.revokeCredential).toBe('function');
    expect(typeof sdk.getStoredCredential).toBe('function');
    expect(typeof sdk.submitProof).toBe('function');
    expect(typeof sdk.isPasskeySupported).toBe('function');
    expect(typeof sdk.deleteStoredCredential).toBe('function');
    expect(typeof sdk.listStoredCredentials).toBe('function');
  });
});
