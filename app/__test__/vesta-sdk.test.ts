import 'fake-indexeddb/auto';

import { VestaSDK } from '../src/vesta-sdk';
import { VestaSDKError } from '../src/http/client';
import type {
  GenerateAndSubmitResponse,
  IssueCredentialResponse,
  VestaSDKConfig,
  VestaVC,
  VerifyCredentialResponse,
} from '../src/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockConfig: VestaSDKConfig = {
  apiKey: 'test-api-key',
  rpId: 'localhost',
};

const mockVC: VestaVC = {
  '@context': ['https://www.w3.org/2018/credentials/v1'],
  id: 'urn:uuid:sdk-test-789',
  type: ['VerifiableCredential', 'VestaKYCCredential'],
  issuer: { id: 'did:web:vesta.id:issuers:bradesco', name: 'Banco Bradesco S.A.' },
  issuance_date: '2025-01-15T10:00:00Z',
  expiration_date: '2099-12-31T23:59:59Z',
  credential_subject: {
    id: 'did:key:z6Mk...',
    cpf_hash: '1405822985',
    birth_date_hash: '15417048711',
    full_name_hash: '8703093882',
    kyc_level: 'complete',
    kyc_provider: 'serasa',
    kyc_method: 'biometric_plus_document',
    nationality: 'BR',
  },
  proof: {
    type: 'PoseidonSignature2024',
    created: '2025-01-15T10:00:00Z',
    verificationMethod: 'did:web:vesta.id:issuers:bradesco#key-1',
    proofPurpose: 'assertionMethod',
    proofValue: 'zMock',
  },
};

const TEST_VC_HASH = 'sdk00000000000000000000000000000000000000000000000000000000000000';

const mockIssueApiResponse: IssueCredentialResponse = {
  vc: mockVC,
  vcHash: TEST_VC_HASH,
  credentialId: 'cred-sdk-001',
  status: 'approved',
  expiresAt: '2099-12-31T23:59:59Z',
  alreadyExisted: false,
};

const mockVerifyResponse: VerifyCredentialResponse = {
  valid: true,
  vcHash: TEST_VC_HASH,
  kycLevel: 'complete',
  issuerId: 'bradesco',
  expiresAt: '2099-12-31T23:59:59Z',
  challengeNonce: 'nonce-abc-123',
};

const mockGenerateResponse: GenerateAndSubmitResponse = {
  verified: true,
  zkProof: { protocol: 'groth16', curve: 'bn128', publicSignals: ['2', '1'], proofHash: 'ph', mock: true },
  stellar: { txHash: 'MOCK_TX_001', ledger: 0, contractId: 'PLACEHOLDER', network: 'stellar:soroban:testnet', mock: true },
  attestation: { id: 'att-001', vcHash: TEST_VC_HASH, verifierId: 'verifier_bradesco', kycLevel: 'complete', userWalletAddress: null, createdAt: '2025-01-15T10:00:00Z' },
};

// ─── Mock global de fetch ──────────────────────────────────────────────────────

function mockFetchOnce(body: unknown, status = 200): void {
  global.fetch = createFetchMock([{ body, status }]);
}

function mockFetchError(statusCode: number, message: string): void {
  global.fetch = createFetchMock([{ body: { statusCode, message }, status: statusCode }]);
}

function createFetchMock(
  apiResponses: Array<{ body: unknown; status?: number }>,
): jest.Mock {
  return jest.fn(async (url: string, init: RequestInit) => {
    const requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    if (url.endsWith('/passkey/registration/options')) {
      return okResponse({
        challenge: Buffer.from('registration-challenge').toString('base64url'),
        rp: { id: 'localhost', name: 'Vesta' },
        user: { id: Buffer.from('opaque-user').toString('base64url'), name: 'holder', displayName: 'Holder' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: [],
      });
    }
    if (url.endsWith('/passkey/registration/verify')) {
      const webauthn = requestBody.response as { id: string };
      return okResponse({ verified: true, passkeyCredentialId: webauthn.id, vcHash: TEST_VC_HASH });
    }
    if (url.endsWith('/passkey/authentication/options')) {
      return okResponse({
        challenge: Buffer.from('authentication-challenge').toString('base64url'),
        rpId: 'localhost', userVerification: 'required', timeout: 60_000,
      });
    }
    if (url.endsWith('/passkey/authentication/verify')) {
      return okResponse({
        verified: true, vcHash: TEST_VC_HASH, proofChallenge: 'proof-challenge',
        privyCustomAuthToken: null,
      });
    }
    const next = apiResponses.shift();
    if (!next) throw new Error(`Resposta de teste ausente para ${url}`);
    const status = next.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status < 300 ? 'OK' : 'Error',
      json: async () => next.body,
    } as Response;
  });
}

function okResponse(data: unknown): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => ({ data }) } as Response;
}

// ─── Mock do WebAuthn ─────────────────────────────────────────────────────────

function setupWebAuthnMocks(vcHash: string): { mockCreate: jest.Mock; mockGet: jest.Mock } {
  const mockCreate = jest.fn().mockResolvedValue({
    id: 'mock-cred-id',
    rawId: new TextEncoder().encode('mock-cred-id'),
    type: 'public-key',
    response: {
      clientDataJSON: new TextEncoder().encode('client-data'),
      attestationObject: new TextEncoder().encode('attestation'),
      getTransports: () => ['internal'],
    },
    getClientExtensionResults: () => ({}),
  });

  const mockGet = jest.fn().mockResolvedValue({
    id: 'mock-cred-id',
    rawId: new TextEncoder().encode('mock-cred-id'),
    type: 'public-key',
    response: {
      userHandle: new TextEncoder().encode(vcHash),
      authenticatorData: new ArrayBuffer(0),
      clientDataJSON: new ArrayBuffer(0),
      signature: new ArrayBuffer(0),
    },
    getClientExtensionResults: () => ({}),
  });

  Object.defineProperty(global, 'navigator', {
    value: { credentials: { create: mockCreate, get: mockGet } },
    writable: true,
    configurable: true,
  });

  Object.defineProperty(global.window, 'PublicKeyCredential', {
    value: class PublicKeyCredential {},
    writable: true,
    configurable: true,
  });

  return { mockCreate, mockGet };
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('VestaSDK', () => {
  let sdk: VestaSDK;

  beforeEach(() => {
    sdk = new VestaSDK(mockConfig);
    setupWebAuthnMocks(TEST_VC_HASH);
  });

  // ── issueCredential ────────────────────────────────────────────────────────

  describe('issueCredential()', () => {
    it('deve chamar POST /credentials e registrar Passkey em seguida', async () => {
      mockFetchOnce(mockIssueApiResponse);

      const result = await sdk.issueCredential({
        cpf: '12345678900',
        fullName: 'João da Silva',
        birthDate: '1990-03-15',
        kycLevel: 'complete',
        kycMethod: 'biometric_plus_document',
      });

      expect(global.fetch).toHaveBeenCalledTimes(3);
      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
      expect(url).toBe('https://vesta.trust-staging.com/public/credential');

      expect(result.vcHash).toBe(TEST_VC_HASH);
      expect(result.passkeyCredentialId).toBe('mock-cred-id');
      expect(result.alreadyExisted).toBe(false);
    });

    it('deve enviar o header X-Api-Key correto', async () => {
      mockFetchOnce(mockIssueApiResponse);

      await sdk.issueCredential({
        cpf: '12345678900',
        fullName: 'João da Silva',
        birthDate: '1990-03-15',
        kycLevel: 'complete',
        kycMethod: 'biometric_plus_document',
      });

      const [, options] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['X-Api-Key']).toBe('test-api-key');
      expect(headers['X-Vesta-Issuer-ID']).toBeUndefined();
    });

    it('deve lançar erro descritivo se Passkey falhar após emissão bem-sucedida', async () => {
      mockFetchOnce(mockIssueApiResponse);

      // Simula cancelamento do usuário
      Object.defineProperty(global, 'navigator', {
        value: {
          credentials: {
            create: jest.fn().mockResolvedValueOnce(null),
            get: jest.fn(),
          },
        },
        writable: true,
        configurable: true,
      });

      await expect(
        sdk.issueCredential({
          cpf: '12345678900',
          fullName: 'João da Silva',
          birthDate: '1990-03-15',
          kycLevel: 'complete',
          kycMethod: 'biometric_plus_document',
        }),
      ).rejects.toThrow(/Credencial emitida.*registro do Passkey falhou/);
    });

    it('deve propagar VestaSDKError 401 da API', async () => {
      mockFetchError(401, 'Unauthorized');

      await expect(
        sdk.issueCredential({
          cpf: '12345678900',
          fullName: 'João da Silva',
          birthDate: '1990-03-15',
          kycLevel: 'complete',
          kycMethod: 'biometric_plus_document',
        }),
      ).rejects.toBeInstanceOf(VestaSDKError);
    });
  });

  // ── validateCredential ────────────────────────────────────────────────────

  describe('validateCredential()', () => {
    // A two-phase proof flow has prepare returning the unsigned XDR with the
    // legacy fallback (requiresUserSignature=false), and submit-signed
    // returning the final attestation. In the legacy path the SDK passes the
    // XDR through unchanged — Privy signing is exercised only when the issuer
    // has privyEnabled=true on the backend, which we cover separately.
    const mockPrepareResponse = {
      prepareSessionId: 'prep_test_001',
      unsignedTxXdr: 'AAAAAgAAAAA...unsigned',
      requiresUserSignature: false,
      userWalletAddress: null,
      stellarNetworkPassphrase: 'Test SDF Network ; September 2015',
      zkProof: { protocol: 'groth16', curve: 'bn128', publicSignals: ['2', '1'], proofHash: 'ph', mock: true },
    };

    /**
     * As ceremonies Passkey são respondidas por rota; a fila contém apenas
     * issue, prepare e submit-signed.
     */
    function mockFetchSequence(issue: unknown, prepare: unknown, submitSigned: unknown): jest.Mock {
      const mockFn = createFetchMock([
        { body: issue },
        { body: prepare },
        { body: submitSigned },
      ]);
      global.fetch = mockFn;
      return mockFn;
    }

    it('deve autenticar via Passkey e fazer o fluxo two-phase prepare + submit-signed', async () => {
      const fetchMock = mockFetchSequence(mockIssueApiResponse, mockPrepareResponse, mockGenerateResponse);

      await sdk.issueCredential({
        cpf: '12345678900', fullName: 'João da Silva', birthDate: '1990-03-15',
        kycLevel: 'complete', kycMethod: 'biometric_plus_document',
      });

      const result = await sdk.validateCredential({
        privateInputs: { cpf: '12345678900', birthDate: '19900315', fullName: 'JOAO SILVA' },
        verifierId: 'verifier_bradesco',
        minKycLevel: 2,
      });

      expect(result.verified).toBe(true);
      expect(result.stellar.txHash).toBe('MOCK_TX_001');
      expect(fetchMock).toHaveBeenCalledTimes(7);

      // issue + registration options/verify + authentication options/verify + proof two-phase
      const [prepareUrl] = fetchMock.mock.calls[5] as [string];
      expect(prepareUrl).toBe('https://vesta.trust-staging.com/public/proof/prepare');
      const [submitUrl] = fetchMock.mock.calls[6] as [string];
      expect(submitUrl).toBe('https://vesta.trust-staging.com/public/proof/submit-signed');
    });

    it('deve incluir a VC recuperada via Passkey no payload do prepare', async () => {
      const fetchMock = mockFetchSequence(mockIssueApiResponse, mockPrepareResponse, mockGenerateResponse);

      await sdk.issueCredential({
        cpf: '12345678900', fullName: 'João da Silva', birthDate: '1990-03-15',
        kycLevel: 'complete', kycMethod: 'biometric_plus_document',
      });

      await sdk.validateCredential({
        privateInputs: { cpf: '12345678900', birthDate: '19900315', fullName: 'JOAO SILVA' },
        verifierId: 'verifier_bradesco',
        minKycLevel: 2,
      });

      const [, prepareOptions] = fetchMock.mock.calls[5] as [string, RequestInit];
      const prepareBody = JSON.parse(prepareOptions.body as string) as Record<string, unknown>;
      expect(prepareBody['vc']).toEqual(mockVC);
      expect(prepareBody['verifierId']).toBe('verifier_bradesco');
      expect(prepareBody['minKycLevel']).toBe(2);
      expect(prepareBody['challenge']).toBeDefined();
      expect(prepareBody).not.toHaveProperty('vcHash');
      expect(prepareBody).not.toHaveProperty('subjectDid');

      const [, submitOptions] = fetchMock.mock.calls[6] as [string, RequestInit];
      const submitBody = JSON.parse(submitOptions.body as string) as Record<string, unknown>;
      expect(submitBody['prepareSessionId']).toBe('prep_test_001');
      expect(submitBody['signedTxXdr']).toBe('AAAAAgAAAAA...unsigned');
    });

    it('troca o custom-auth JWT antes do prepare e envia o access token após assinar', async () => {
      const authenticateWithCustomAuthToken = jest.fn().mockResolvedValue({
        userId: 'privy-user', walletAddress: 'GSTELLAR', accessToken: 'privy-access-token',
      });
      const prepare = jest.fn().mockResolvedValue({
        ...mockPrepareResponse,
        requiresUserSignature: true,
        userWalletAddress: 'GSTELLAR',
      });
      const signStellarTx = jest.fn().mockResolvedValue('signed-xdr');
      const submitSigned = jest.fn().mockResolvedValue(mockGenerateResponse);
      const internals = sdk as unknown as {
        passkey: { authenticate: jest.Mock };
        wallet: {
          authenticateWithCustomAuthToken: jest.Mock;
          isAvailable: jest.Mock;
          signStellarTx: jest.Mock;
        };
        proofs: { prepare: jest.Mock; submitSigned: jest.Mock };
      };
      internals.passkey = { authenticate: jest.fn().mockResolvedValue({
        vc: mockVC,
        vcHash: TEST_VC_HASH,
        storedAt: new Date().toISOString(),
        passkeyCredentialId: 'passkey-id',
        challengeUsed: 'proof-challenge',
        privyCustomAuthToken: 'header.payload.signature',
      }) };
      internals.wallet = {
        authenticateWithCustomAuthToken,
        isAvailable: jest.fn().mockReturnValue(true),
        signStellarTx,
      };
      internals.proofs = { prepare, submitSigned };

      await sdk.validateCredential({
        privateInputs: { cpf: '12345678900', birthDate: '19900315', fullName: 'JOAO SILVA' },
        verifierId: 'verifier',
        minKycLevel: 2,
      });

      expect(authenticateWithCustomAuthToken).toHaveBeenCalledWith('header.payload.signature');
      expect(authenticateWithCustomAuthToken.mock.invocationCallOrder[0]).toBeLessThan(
        prepare.mock.invocationCallOrder[0],
      );
      expect(signStellarTx).toHaveBeenCalledWith(
        mockPrepareResponse.unsignedTxXdr,
        mockPrepareResponse.stellarNetworkPassphrase,
      );
      expect(submitSigned).toHaveBeenCalledWith(expect.objectContaining({
        signedTxXdr: 'signed-xdr',
        privyIdentityToken: 'privy-access-token',
      }));
    });
  });

  // ── checkCredentialStatus ─────────────────────────────────────────────────

  describe('checkCredentialStatus()', () => {
    it('deve chamar POST /credentials/verify e retornar status', async () => {
      mockFetchOnce(mockVerifyResponse);

      const result = await sdk.checkCredentialStatus({ vcHash: TEST_VC_HASH });

      expect(result.valid).toBe(true);
      expect(result.challengeNonce).toBe('nonce-abc-123');

      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
      expect(url).toBe('https://vesta.trust-staging.com/public/credential/verify');
    });
  });

  // ── revokeCredential ──────────────────────────────────────────────────────

  describe('revokeCredential()', () => {
    it('deve chamar POST /credentials/revoke e retornar confirmação', async () => {
      mockFetchOnce({ success: true, vcHash: TEST_VC_HASH, status: 'revoked', reason: 'fraud' });

      const result = await sdk.revokeCredential({ vcHash: TEST_VC_HASH, reason: 'fraud' });

      expect(result.success).toBe(true);
      expect(result.status).toBe('revoked');
    });
  });

  // ── isPasskeySupported ────────────────────────────────────────────────────

  describe('isPasskeySupported()', () => {
    it('deve retornar true quando PublicKeyCredential está disponível', () => {
      expect(sdk.isPasskeySupported()).toBe(true);
    });
  });

  // ── listStoredCredentials / deleteStoredCredential ────────────────────────

  describe('listStoredCredentials() e deleteStoredCredential()', () => {
    it('deve listar e remover credenciais do armazenamento local', async () => {
      // Registra
      mockFetchOnce(mockIssueApiResponse);
      await sdk.issueCredential({
        cpf: '12345678900', fullName: 'João da Silva', birthDate: '1990-03-15',
        kycLevel: 'complete', kycMethod: 'biometric_plus_document',
      });

      let hashes = await sdk.listStoredCredentials();
      expect(hashes).toContain(TEST_VC_HASH);

      await sdk.deleteStoredCredential(TEST_VC_HASH);

      hashes = await sdk.listStoredCredentials();
      expect(hashes).not.toContain(TEST_VC_HASH);
    });
  });

  // ── submitProof ───────────────────────────────────────────────────────────

  describe('submitProof()', () => {
    it('deve chamar POST /proofs/submit com a prova fornecida', async () => {
      mockFetchOnce(mockGenerateResponse);

      const result = await sdk.submitProof({
        proof: { pi_a: ['1', '2', '1'], pi_b: [['3', '4'], ['5', '6'], ['1', '0']], pi_c: ['7', '8', '1'] },
        publicSignals: ['2', '1'],
        verifierId: 'verifier_bradesco',
        vcHash: TEST_VC_HASH,
      });

      expect(result.verified).toBe(true);
      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
      expect(url).toBe('https://vesta.trust-staging.com/public/proof/submit');
    });
  });
});
