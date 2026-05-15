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
  issuerId: 'bradesco',
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
  attestation: { id: 'att-001', vcHash: TEST_VC_HASH, verifierId: 'verifier_bradesco', kycLevel: 'complete', createdAt: '2025-01-15T10:00:00Z' },
};

// ─── Mock global de fetch ──────────────────────────────────────────────────────

function mockFetchOnce(body: unknown, status = 200): void {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as Response);
}

function mockFetchError(statusCode: number, message: string): void {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: false,
    status: statusCode,
    statusText: 'Error',
    json: () => Promise.resolve({ statusCode, message }),
  } as Response);
}

// ─── Mock do WebAuthn ─────────────────────────────────────────────────────────

function setupWebAuthnMocks(vcHash: string): { mockCreate: jest.Mock; mockGet: jest.Mock } {
  const mockCreate = jest.fn().mockResolvedValue({
    id: 'mock-cred-id',
    rawId: new TextEncoder().encode('mock-cred-id'),
    type: 'public-key',
    response: {},
    getClientExtensionResults: () => ({}),
  });

  const mockGet = jest.fn().mockResolvedValue({
    id: 'mock-cred-id',
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

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
      expect(url).toBe('https://api.vesta.id/public/credential');

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
      expect(headers['X-Vesta-Issuer-ID']).toBe('bradesco');
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
    const mockChallengeResponse = { challenge: 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899', expiresAt: Date.now() + 60000 };

    /**
     * Helper: 3 respostas sequenciais — issue, challenge (anti-replay), proof.
     */
    function mockFetchSequence(issue: unknown, proof: unknown): jest.Mock {
      const mockFn = jest.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(issue) })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(mockChallengeResponse) })
        .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK', json: () => Promise.resolve(proof) });
      global.fetch = mockFn;
      return mockFn;
    }

    it('deve autenticar via Passkey e chamar POST /public/proof/generate-and-submit', async () => {
      const fetchMock = mockFetchSequence(mockIssueApiResponse, mockGenerateResponse);

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
      expect(fetchMock).toHaveBeenCalledTimes(3);

      const [proofUrl] = fetchMock.mock.calls[2] as [string];
      expect(proofUrl).toBe('https://api.vesta.id/public/proof/generate-and-submit');
    });

    it('deve incluir a VC recuperada via Passkey no payload enviado à API', async () => {
      const fetchMock = mockFetchSequence(mockIssueApiResponse, mockGenerateResponse);

      await sdk.issueCredential({
        cpf: '12345678900', fullName: 'João da Silva', birthDate: '1990-03-15',
        kycLevel: 'complete', kycMethod: 'biometric_plus_document',
      });

      await sdk.validateCredential({
        privateInputs: { cpf: '12345678900', birthDate: '19900315', fullName: 'JOAO SILVA' },
        verifierId: 'verifier_bradesco',
        minKycLevel: 2,
      });

      // call[0] = issue, call[1] = challenge, call[2] = proof
      const [, options] = fetchMock.mock.calls[2] as [string, RequestInit];
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body['vc']).toEqual(mockVC);
      expect(body['vcHash']).toBe(TEST_VC_HASH);
      expect(body['verifierId']).toBe('verifier_bradesco');
      expect(body['minKycLevel']).toBe(2);
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
      expect(url).toBe('https://api.vesta.id/public/credential/verify');
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
        minKycLevel: 2,
      });

      expect(result.verified).toBe(true);
      const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
      expect(url).toBe('https://api.vesta.id/public/proof/submit');
    });
  });
});
