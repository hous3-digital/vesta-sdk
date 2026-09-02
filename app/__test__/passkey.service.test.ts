import 'fake-indexeddb/auto';
import { PasskeyService } from '../src/passkey/passkey.service';
import type { VestaVC } from '../src/types';

const mockVC: VestaVC = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  id: 'urn:uuid:passkey-test',
  type: ['VerifiableCredential', 'VestaKYCCredential'],
  issuer: { id: 'did:web:vesta.id:issuers:test', name: 'Issuer' },
  issuance_date: '2025-01-15T10:00:00Z',
  expiration_date: '2027-01-15T10:00:00Z',
  credential_subject: {
    id: 'did:key:test', cpf_hash: '1', birth_date_hash: '2', full_name_hash: '3',
    kyc_level: 'complete', kyc_provider: 'test', kyc_method: 'test', nationality: 'BR',
  },
  proof: {
    type: 'PoseidonSignature2024', created: '2025-01-15T10:00:00Z',
    verificationMethod: 'did:web:vesta.id#key-1', proofPurpose: 'assertionMethod', proofValue: 'zMock',
  },
};
const VC_HASH = 'a1'.repeat(32);
const b64url = (value: string): string =>
  Buffer.from(value).toString('base64url');

function registrationCredential(id = 'credential-id'): PublicKeyCredential {
  return {
    id,
    rawId: new TextEncoder().encode(id),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({}),
    response: {
      clientDataJSON: new TextEncoder().encode('client-data'),
      attestationObject: new TextEncoder().encode('attestation'),
      getTransports: () => ['internal'],
    } as unknown as AuthenticatorAttestationResponse,
  } as unknown as PublicKeyCredential;
}

function authenticationCredential(id = 'credential-id'): PublicKeyCredential {
  return {
    id,
    rawId: new TextEncoder().encode(id),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    getClientExtensionResults: () => ({}),
    response: {
      clientDataJSON: new TextEncoder().encode('client-data'),
      authenticatorData: new TextEncoder().encode('authenticator-data'),
      signature: new TextEncoder().encode('signature'),
      userHandle: new TextEncoder().encode('opaque-user-handle'),
    } as unknown as AuthenticatorAssertionResponse,
  } as unknown as PublicKeyCredential;
}

describe('PasskeyService server-verified ceremonies', () => {
  let service: PasskeyService;
  let create: jest.Mock;
  let get: jest.Mock;
  let fetchMock: jest.Mock;
  let registeredHash: string;

  beforeEach(() => {
    registeredHash = VC_HASH;
    create = jest.fn().mockResolvedValue(registrationCredential());
    get = jest.fn().mockResolvedValue(authenticationCredential());
    Object.defineProperty(global, 'navigator', {
      value: { credentials: { create, get } }, configurable: true,
    });
    Object.defineProperty(window, 'PublicKeyCredential', {
      value: class PublicKeyCredential {}, configurable: true,
    });

    fetchMock = jest.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      if (url.endsWith('/registration/options')) {
        registeredHash = String(body.vcHash);
        return response({
          challenge: b64url('registration-challenge'),
          rp: { id: 'localhost', name: 'Vesta' },
          user: { id: b64url('opaque-user'), name: 'holder', displayName: 'Holder' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          excludeCredentials: [],
          timeout: 60_000,
        });
      }
      if (url.endsWith('/registration/verify')) {
        const webauthn = body.response as { id: string };
        return response({ verified: true, passkeyCredentialId: webauthn.id, vcHash: registeredHash });
      }
      if (url.endsWith('/authentication/options')) {
        return response({
          challenge: b64url('authentication-challenge'),
          rpId: 'localhost',
          userVerification: 'required',
          timeout: 60_000,
        });
      }
      if (url.endsWith('/public/credential/recover')) {
        return response({ vc: mockVC, vcHash: registeredHash });
      }
      return response({
        verified: true,
        vcHash: registeredHash,
        proofChallenge: 'proof-challenge',
        recoveryToken: 'recovery-token',
        privyCustomAuthToken: 'header.payload.signature',
      });
    });
    global.fetch = fetchMock;
    service = new PasskeyService('localhost', 'https://api.example.com', 'api-key');
  });

  it('detecta suporte WebAuthn', () => expect(service.isSupported()).toBe(true));

  it('obtém options no backend, verifica o attestation e só então persiste', async () => {
    const result = await service.register(mockVC, VC_HASH);
    expect(result).toEqual({ passkeyCredentialId: 'credential-id', vcHash: VC_HASH });
    expect(create.mock.calls[0][0].publicKey.authenticatorSelection.userVerification).toBe('required');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.example.com/public/auth/passkey/registration/options',
      'https://api.example.com/public/auth/passkey/registration/verify',
    ]);
    expect(await service.getStoredHashes()).toContain(VC_HASH);
  });

  it('não persiste quando o backend rejeita o registro', async () => {
    fetchMock.mockImplementationOnce(async () => response({
      challenge: b64url('registration-challenge'),
      rp: { id: 'localhost', name: 'Vesta' },
      user: { id: b64url('opaque-user'), name: 'holder', displayName: 'Holder' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    })).mockImplementationOnce(async () => ({
      ok: false,
      status: 400,
      json: async (): Promise<Record<string, never>> => ({}),
    }));
    await expect(service.register(mockVC, 'b2'.repeat(32))).rejects.toThrow('ceremony Passkey');
    expect(await service.getStoredHashes()).not.toContain('b2'.repeat(32));
  });

  it('verifica assertion no backend e retorna challenge de prova e token Privy', async () => {
    await service.register(mockVC, VC_HASH);
    const stored = await service.authenticate();
    expect(get.mock.calls[0][0].publicKey.userVerification).toBe('required');
    expect(stored.vcHash).toBe(VC_HASH);
    expect(stored.challengeUsed).toBe('proof-challenge');
    expect(stored.privyCustomAuthToken).toBe('header.payload.signature');
  });

  it('recupera e restaura a VC quando o Passkey sincronizado não tem IndexedDB local', async () => {
    registeredHash = 'ff'.repeat(32);
    const stored = await service.authenticate();
    expect(stored.vcHash).toBe(registeredHash);
    expect(await service.getStoredHashes()).toContain(registeredHash);
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain(
      'https://api.example.com/public/credential/recover',
    );
  });

  it('propaga cancelamento do prompt nativo', async () => {
    create.mockResolvedValueOnce(null);
    await expect(service.register(mockVC, VC_HASH)).rejects.toThrow('Criação do Passkey cancelada');
  });

  it('remove a credencial apenas do armazenamento local', async () => {
    await service.register(mockVC, VC_HASH);
    await service.deleteStored(VC_HASH);
    expect(await service.getStoredHashes()).not.toContain(VC_HASH);
  });
});

function response(data: unknown): Pick<Response, 'ok' | 'status' | 'json'> {
  return { ok: true, status: 200, json: async () => ({ data }) };
}
